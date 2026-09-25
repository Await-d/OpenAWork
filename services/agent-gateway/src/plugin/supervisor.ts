/**
 * Plugin supervisor — lifecycle guards for the plugin platform.
 *
 * This phase ships the `guarded` invariant: internal plugins can never
 * be removed by declarative config (aligned with opencode v2's
 * `PluginInternal.guarded`). Enable/disable state, pre/post slots and
 * the `Plugin.Event.Updated` broadcast land with the management API in
 * a later phase.
 *
 * Guarded ids are matched against a candidate's spec / basename during
 * config-removal filtering; once internal plugins carry their own spec
 * in the guarded set (P5), removal via config is a no-op for them.
 */

const guardedIds = new Set<string>();

/** Mark a plugin id as guarded (internal plugin; config cannot remove it). */
export function markPluginGuarded(id: string): void {
  guardedIds.add(id);
}

export function isPluginGuarded(id: string): boolean {
  return guardedIds.has(id);
}

export function guardedPluginIds(): readonly string[] {
  return [...guardedIds];
}

/** Test-only: clear the guarded set. */
export function _resetPluginSupervisorForTest(): void {
  guardedIds.clear();
}
