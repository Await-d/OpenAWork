/**
 * Effect plugin entrypoint (`@openAwork/plugin-sdk/effect`).
 *
 * ```ts
 * import { define } from '@openAwork/plugin-sdk/effect';
 * import { Effect } from 'effect';
 *
 * export default define({
 *   id: 'my-plugin',
 *   effect: (ctx) =>
 *     Effect.gen(function* () {
 *       ctx.tool.hook('execute.before', (event) => {
 *         // sanitize event.args ...
 *       });
 *     }),
 * });
 * ```
 *
 * Registrations live for the plugin's lifetime: the gateway runs `effect`
 * inside a long-lived `Scope` and closes it on unload, so
 * `Effect.acquireRelease` / `Scope.addFinalizer` resources are cleaned up
 * automatically. Hooks registered through the context are disposed by the
 * gateway as well; the returned `Disposable` exists for early removal.
 */

import type { Effect, Scope } from 'effect';
import type { PluginContext } from './domains.js';

export interface EffectPlugin<R = Scope.Scope> {
  readonly id: string;
  readonly effect: (context: PluginContext) => Effect.Effect<void, never, R>;
}

/** Identity helper that pins the plugin definition's types. */
export function define<R = Scope.Scope>(plugin: EffectPlugin<R>): EffectPlugin<R> {
  return plugin;
}
