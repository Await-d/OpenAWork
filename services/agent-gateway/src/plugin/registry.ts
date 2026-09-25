/**
 * Plugin registry — activation, lifecycle and inventory for loaded
 * plugins (v2 runtime).
 *
 * Both plugin styles are accepted:
 *   - Effect plugins (`{ id, effect }`) run inside a long-lived `Scope`;
 *     closing the scope releases `acquireRelease` resources on unload.
 *   - Promise plugins (`{ id, setup }`) may return a cleanup function.
 *
 * Hooks registered through the context are tracked per plugin and
 * disposed on unload. Activation failures are isolated: the failure is
 * recorded (visible via `list()`), registrations are rolled back, and
 * the gateway keeps running.
 */

import { Effect, Exit, Scope } from 'effect';
import type {
  Cleanup,
  Disposable,
  EffectPlugin,
  PluginInfo,
  PromisePlugin,
} from '@openAwork/plugin-sdk';
import { loadAppVersion } from '../app/app-version.js';
import { buildPluginContext } from './context.js';
import { getPluginHooks, type PluginHooksRegistry } from './hooks.js';
import { createPluginStorage } from './storage.js';
import { getPluginToolRegistry } from './tool-registry.js';
import { registerV1Hooks, type V1PluginHooks } from './v1-shim.js';

/** Unified definition accepted by `activate` (both API styles). */
export type PluginDefinition = EffectPlugin | PromisePlugin;

export interface PluginActivationOptions {
  /** Where the plugin was loaded from (env path / package specifier). */
  readonly source: string;
  readonly options?: Readonly<Record<string, unknown>>;
}

interface ActivePlugin {
  readonly id: string;
  readonly source: string;
  readonly registrations: Disposable[];
  readonly scope?: Scope.Closeable;
  readonly cleanup?: Cleanup;
  readonly eventAbort?: AbortController;
}

function resolveAppInfo(): { name: string; version: string } {
  return { name: 'openAwork', version: loadAppVersion() };
}

export class PluginRegistry {
  private readonly plugins = new Map<string, ActivePlugin>();
  private readonly failures = new Map<string, string>();

  constructor(private readonly hooks: PluginHooksRegistry) {}

  /**
   * Activate a plugin definition. Never throws: activation failures are
   * recorded and reported through `list()`.
   */
  async activate(definition: PluginDefinition, opts: PluginActivationOptions): Promise<void> {
    const id = definition.id;
    if (this.plugins.has(id) || this.failures.has(id)) {
      console.warn(`[plugin] duplicate plugin id "${id}" — skipping "${opts.source}"`);
      return;
    }

    const eventAbort = new AbortController();
    const { context, registrations } = buildPluginContext({
      hooks: this.hooks,
      pluginId: id,
      source: opts.source,
      options: opts.options ?? {},
      app: resolveAppInfo(),
      listPlugins: () => this.list(),
      storage: createPluginStorage(id),
      eventSignal: eventAbort.signal,
    });

    try {
      if ('effect' in definition) {
        await this.activateEffect(definition, id, opts.source, context, registrations, eventAbort);
      } else {
        await this.activatePromise(definition, id, opts.source, context, registrations, eventAbort);
      }
    } catch (err) {
      eventAbort.abort();
      this.disposeRegistrations(registrations);
      const message = err instanceof Error ? err.message : String(err);
      this.failures.set(id, message);
      console.warn(`[plugin] failed to activate "${id}" (${opts.source}): ${message}`);
    }
  }

  /**
   * Activate a legacy V1 hook map (the original PR-D-Plugin shape).
   * Kept for `OPENAWORK_PLUGINS` backwards compatibility; the returned
   * registrations live until `deactivate` / `close`.
   *
   * V1 has no plugin-id concept and the original host allowed the same
   * source label to be registered repeatedly (each registration took
   * effect). Ids therefore pick the first free `v1:<source>` slot —
   * which also makes hot reload stable: after `deactivate` the original
   * id is free again and gets reused.
   */
  activateV1(source: string, hooks: V1PluginHooks): void {
    const registrations = registerV1Hooks(source, hooks, this.hooks);
    let id = `v1:${source}`;
    let suffix = 1;
    while (this.plugins.has(id)) {
      suffix += 1;
      id = `v1:${source}#${suffix}`;
    }
    this.plugins.set(id, { id, source, registrations });
  }

  private async activateEffect(
    definition: EffectPlugin,
    id: string,
    source: string,
    context: ReturnType<typeof buildPluginContext>['context'],
    registrations: Disposable[],
    eventAbort: AbortController,
  ): Promise<void> {
    const scope = await Effect.runPromise(Scope.make());
    try {
      await Effect.runPromise(
        definition.effect(context).pipe(Effect.provideService(Scope.Scope, scope)),
      );
    } catch (err) {
      await Effect.runPromise(Scope.close(scope, Exit.void)).catch(() => undefined);
      throw err;
    }
    this.plugins.set(id, { id, source, registrations, scope, eventAbort });
  }

  private async activatePromise(
    definition: PromisePlugin,
    id: string,
    source: string,
    context: ReturnType<typeof buildPluginContext>['context'],
    registrations: Disposable[],
    eventAbort: AbortController,
  ): Promise<void> {
    const cleanup = await definition.setup(context);
    this.plugins.set(id, {
      id,
      source,
      registrations,
      eventAbort,
      ...(typeof cleanup === 'function' ? { cleanup } : {}),
    });
  }

  /** Unload a plugin: dispose hooks, run cleanup, close the Effect scope. */
  async deactivate(id: string): Promise<void> {
    const plugin = this.plugins.get(id);
    if (!plugin) return;
    this.plugins.delete(id);

    // Stop event subscriptions first: a subscription callback must never
    // observe a half-unloaded plugin.
    plugin.eventAbort?.abort();

    // Drop plugin-contributed tools (definitions + sandbox whitelist are
    // rebuilt per turn, so the next turn no longer sees them).
    getPluginToolRegistry().removeByPlugin(id);

    this.disposeRegistrations(plugin.registrations);

    if (plugin.cleanup) {
      try {
        await plugin.cleanup();
      } catch (err) {
        console.warn(
          `[plugin] cleanup for "${id}" threw: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (plugin.scope) {
      await Effect.runPromise(Scope.close(plugin.scope, Exit.void)).catch((err: unknown) => {
        console.warn(
          `[plugin] scope close for "${id}" threw: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }
  }

  /** True when a plugin with this id is currently active. */
  hasActive(id: string): boolean {
    return this.plugins.has(id);
  }

  /** Active and failed plugins, in registration order. */
  list(): readonly PluginInfo[] {
    return [
      ...[...this.plugins.values()].map((plugin): PluginInfo => ({
        id: plugin.id,
        source: plugin.source,
        state: { status: 'active' },
      })),
      ...[...this.failures.entries()].map(([id, error]): PluginInfo => ({
        id,
        state: { status: 'failed', error },
      })),
    ];
  }

  /** Unload every plugin (gateway shutdown). */
  async close(): Promise<void> {
    for (const id of [...this.plugins.keys()]) {
      await this.deactivate(id);
    }
    this.failures.clear();
  }

  private disposeRegistrations(registrations: Disposable[]): void {
    for (const registration of [...registrations].reverse()) {
      registration.dispose();
    }
    registrations.length = 0;
  }
}

let registryInstance: PluginRegistry | undefined;

/** Process-wide plugin registry (one gateway instance per process). */
export function getPluginRegistry(): PluginRegistry {
  registryInstance ??= new PluginRegistry(getPluginHooks());
  return registryInstance;
}

/** Test-only: replace the process-wide registry with a fresh one. */
export function _resetPluginRegistryForTest(): void {
  registryInstance = new PluginRegistry(getPluginHooks());
}
