/**
 * Promise plugin entrypoint (`@openAwork/plugin-sdk`, the package root).
 *
 * ```ts
 * import { define } from '@openAwork/plugin-sdk';
 *
 * export default define({
 *   id: 'my-plugin',
 *   setup(ctx) {
 *     ctx.tool.hook('execute.before', (event) => {
 *       // sanitize event.args ...
 *     });
 *     // Optional cleanup for timers / sockets / subprocesses.
 *     return () => { ... };
 *   },
 * });
 * ```
 *
 * Hook registrations are scoped to the plugin and cleaned up on unload;
 * the returned cleanup function covers everything else the plugin owns.
 */

import type { PluginContext } from './domains.js';
import type { Cleanup } from './types.js';

export interface PromisePlugin {
  readonly id: string;
  readonly setup: (context: PluginContext) => Promise<Cleanup | void> | Cleanup | void;
}

/** Identity helper that pins the plugin definition's types. */
export function define(plugin: PromisePlugin): PromisePlugin {
  return plugin;
}
