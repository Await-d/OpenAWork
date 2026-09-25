/**
 * Shared plugin SDK types.
 *
 * The SDK is consumed by plugin authors (Effect entrypoint at
 * `@openAwork/plugin-sdk/effect`, Promise entrypoint at
 * `@openAwork/plugin-sdk`). The gateway implements the matching runtime
 * contracts in `services/agent-gateway/src/plugin/`.
 */

/** Cleanup returned by a Promise plugin's `setup`. */
export type Cleanup = () => Promise<void> | void;

/** Handle returned by hook registration; call `dispose()` to unregister. */
export interface Disposable {
  dispose(): void;
}

/** Runtime state of a loaded plugin, as reported by `context.plugin.list()`. */
export interface PluginInfo {
  readonly id: string;
  readonly source?: string;
  readonly state:
    | { readonly status: 'active' }
    | { readonly status: 'disabled' }
    | { readonly status: 'failed'; readonly error: string };
}

/** Arbitrary per-plugin options (reserved for declarative config). */
export type PluginOptions = Readonly<Record<string, unknown>>;

/** Metadata about the running gateway, available to plugins. */
export interface AppInfo {
  readonly name: string;
  readonly version: string;
}
