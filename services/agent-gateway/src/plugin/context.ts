/**
 * Plugin context builder — constructs the domain API object handed to a
 * plugin's `effect` / `setup`.
 *
 * Every hook registered through the context is tracked in
 * `registrations` so the registry can dispose it on unload even when the
 * plugin never keeps the returned handle.
 */

import type {
  Disposable,
  HookCallback,
  PermissionHookName,
  PluginContext,
  PluginHookName,
  PluginInfo,
  SessionHookName,
  StorageDomain,
  ToolHookName,
} from '@openAwork/plugin-sdk';
import { createPluginEventDomain } from './events.js';
import type { PluginHooksRegistry, HookRegistration } from './hooks.js';
import { createToolEditor, getPluginToolRegistry } from './tool-registry.js';

export interface PluginContextOptions {
  readonly hooks: PluginHooksRegistry;
  readonly pluginId: string;
  readonly source: string;
  readonly options: Readonly<Record<string, unknown>>;
  readonly app: { readonly name: string; readonly version: string };
  readonly listPlugins: () => readonly PluginInfo[];
  readonly storage: StorageDomain;
  /** Aborted when the plugin unloads; subscriptions die with the plugin. */
  readonly eventSignal: AbortSignal;
}

export interface BuiltPluginContext {
  readonly context: PluginContext;
  /** Hook registrations created through this context. */
  readonly registrations: Disposable[];
}

export function buildPluginContext(opts: PluginContextOptions): BuiltPluginContext {
  const registrations: HookRegistration[] = [];

  const register = <Name extends PluginHookName>(
    name: Name,
    callback: HookCallback<Name>,
  ): Disposable => {
    const registration = opts.hooks.register(opts.source, name, callback);
    registrations.push(registration);
    return registration;
  };

  const context: PluginContext = {
    app: opts.app,
    options: opts.options,
    tool: {
      hook<Name extends ToolHookName>(name: Name, callback: HookCallback<`tool.${Name}`>) {
        return register(`tool.${name}`, callback);
      },
      transform: (callback) => {
        callback(createToolEditor(opts.pluginId));
        return {
          dispose: () => getPluginToolRegistry().removeByPlugin(opts.pluginId),
        };
      },
    },
    session: {
      hook<Name extends SessionHookName>(name: Name, callback: HookCallback<`session.${Name}`>) {
        return register(`session.${name}`, callback);
      },
    },
    permission: {
      hook<Name extends PermissionHookName>(
        name: Name,
        callback: HookCallback<`permission.${Name}`>,
      ) {
        return register(`permission.${name}`, callback);
      },
    },
    plugin: {
      list: () => opts.listPlugins(),
    },
    storage: opts.storage,
    event: {
      subscribe: (options) =>
        createPluginEventDomain().subscribe({
          ...options,
          signal:
            options?.signal === undefined
              ? opts.eventSignal
              : AbortSignal.any([opts.eventSignal, options.signal]),
        }),
    },
  };

  return { context, registrations };
}
