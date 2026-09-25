/**
 * Plugin hook bus — v2 runtime.
 *
 * Replaces the module-level `loadedPlugins` array of the original
 * PR-D-Plugin host with a registry that keys callbacks by fully-qualified
 * hook name and supports disposal (plugin unload).
 *
 * Kept deliberately free of Effect: hook dispatch sits on the hot path
 * (every tool call, every model request), so triggering stays a plain
 * `await` over registered callbacks. Effect only enters at plugin
 * activation time (see `registry.ts`).
 *
 * Isolation invariant (unchanged from PR-D-Plugin): a throwing callback
 * is logged as a warning and never breaks the main flow or downstream
 * callbacks.
 */

import type { HookCallback, PluginHookEvents, PluginHookName } from '@openAwork/plugin-sdk';

/** Handle returned by `register`; `dispose()` unregisters the callback. */
export interface HookRegistration {
  dispose(): void;
}

interface HookEntry {
  readonly source: string;
  /** Type-erased invoker; the concrete event type is restored by the caller. */
  readonly invoke: (event: unknown) => void | Promise<void>;
  disposed: boolean;
}

export class PluginHooksRegistry {
  private readonly entries = new Map<PluginHookName, HookEntry[]>();

  register<Name extends PluginHookName>(
    source: string,
    name: Name,
    callback: HookCallback<Name>,
  ): HookRegistration {
    const entry: HookEntry = {
      source,
      // The callback is typed against its concrete event; dispatch passes
      // the event the gateway built for this hook name, so the cast is
      // sound by construction (one registry slot per hook name).
      invoke: (event) => callback(event as PluginHookEvents[Name]),
      disposed: false,
    };
    const list = this.entries.get(name);
    if (list) list.push(entry);
    else this.entries.set(name, [entry]);
    return {
      dispose: () => {
        if (entry.disposed) return;
        entry.disposed = true;
        const current = this.entries.get(name);
        if (!current) return;
        this.entries.set(
          name,
          current.filter((item) => item !== entry),
        );
      },
    };
  }

  /**
   * Run every callback registered for `name` in registration order.
   * Callbacks mutate the same event object, so later plugins observe
   * earlier mutations. Errors are isolated per callback.
   */
  async trigger<Name extends PluginHookName>(
    name: Name,
    event: PluginHookEvents[Name],
  ): Promise<void> {
    const list = this.entries.get(name);
    if (!list || list.length === 0) return;
    // Snapshot: a callback may dispose itself or other registrations
    // mid-dispatch; the snapshot keeps iteration deterministic.
    for (const entry of [...list]) {
      if (entry.disposed) continue;
      try {
        await entry.invoke(event);
      } catch (err) {
        console.warn(
          `[plugin] "${entry.source}" hook "${name}" threw: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  has(name: PluginHookName): boolean {
    const list = this.entries.get(name);
    return list !== undefined && list.some((entry) => !entry.disposed);
  }

  /** Test-only: drop every registration. */
  reset(): void {
    this.entries.clear();
  }
}

let registryInstance: PluginHooksRegistry | undefined;

/** Process-wide hook registry (one gateway instance per process). */
export function getPluginHooks(): PluginHooksRegistry {
  registryInstance ??= new PluginHooksRegistry();
  return registryInstance;
}

/** Test-only: replace the process-wide registry with a fresh one. */
export function _resetPluginHooksForTest(): void {
  registryInstance = new PluginHooksRegistry();
}
