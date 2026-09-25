/**
 * Plugin enable/disable state (v2 plugin platform).
 *
 * A plugin is enabled unless a `plugin_state` row marks it disabled.
 * The loader skips activation for disabled plugins (they stay tracked so
 * hot reload / enable can bring them back), and the management API
 * projects them as `state: 'disabled'` in `GET /plugins`.
 */

import { sqliteAll, sqliteGet, sqliteRun } from '../infra/db.js';

export function isPluginDisabled(pluginId: string): boolean {
  // Preference lookup, not a security gate: before migrations run (or in
  // lightweight contexts that never open the DB) nothing is disabled, so
  // a missing/unreachable table fails open to "enabled".
  try {
    const row = sqliteGet<{ enabled: number }>(
      'SELECT enabled FROM plugin_state WHERE plugin_id = ?',
      [pluginId],
    );
    return row !== undefined && row.enabled === 0;
  } catch {
    return false;
  }
}

export function setPluginDisabled(pluginId: string, disabled: boolean): void {
  sqliteRun(
    `INSERT INTO plugin_state (plugin_id, enabled, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(plugin_id) DO UPDATE SET enabled = excluded.enabled, updated_at = datetime('now')`,
    [pluginId, disabled ? 0 : 1],
  );
}

export function listDisabledPluginIds(): readonly string[] {
  return sqliteAll<{ plugin_id: string }>(
    'SELECT plugin_id FROM plugin_state WHERE enabled = 0 ORDER BY plugin_id',
  ).map((row) => row.plugin_id);
}
