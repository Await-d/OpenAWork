/**
 * Plugin storage domain — per-plugin durable JSON key/value store.
 *
 * Backed by the `plugin_storage` table (see `infra/db.ts`), scoped by
 * `plugin_id` so two plugins never observe each other's keys. Values
 * must be JSON-serializable; a single value is capped at 256 KiB.
 */

import type { PluginContext, StorageScanOptions, StorageScanResult } from '@openAwork/plugin-sdk';
import { sqliteAll, sqliteGet, sqliteRun } from '../infra/db.js';

const MAX_VALUE_BYTES = 256 * 1024;
const DEFAULT_SCAN_LIMIT = 100;
const MAX_SCAN_LIMIT = 1000;

/** Escape LIKE wildcards so a literal prefix never widens the match. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function parseStoredValue(raw: string, key: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch (err) {
    console.warn(
      `[plugin] storage value for "${key}" is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
    return undefined;
  }
}

export function createPluginStorage(pluginId: string): PluginContext['storage'] {
  return {
    async get(key: string): Promise<unknown> {
      const row = sqliteGet<{ value: string }>(
        'SELECT value FROM plugin_storage WHERE plugin_id = ? AND key = ? LIMIT 1',
        [pluginId, key],
      );
      if (!row) return undefined;
      return parseStoredValue(row.value, key);
    },

    async set(key: string, value: unknown): Promise<void> {
      const serialized = JSON.stringify(value);
      if (serialized === undefined) {
        throw new Error('Plugin storage values must be JSON-serializable.');
      }
      const bytes = Buffer.byteLength(serialized, 'utf8');
      if (bytes > MAX_VALUE_BYTES) {
        throw new Error(`Plugin storage value exceeds ${MAX_VALUE_BYTES} bytes (got ${bytes}).`);
      }
      sqliteRun(
        `INSERT INTO plugin_storage (plugin_id, key, value, updated_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(plugin_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
        [pluginId, key, serialized],
      );
    },

    async remove(key: string): Promise<void> {
      sqliteRun('DELETE FROM plugin_storage WHERE plugin_id = ? AND key = ?', [pluginId, key]);
    },

    async scan(options?: StorageScanOptions): Promise<StorageScanResult> {
      const prefix = options?.prefix ?? '';
      const requested = options?.limit ?? DEFAULT_SCAN_LIMIT;
      const limit = Math.max(1, Math.min(requested, MAX_SCAN_LIMIT));
      const rows = sqliteAll<{ key: string; value: string }>(
        `SELECT key, value FROM plugin_storage
         WHERE plugin_id = ? AND key LIKE ? ESCAPE '\\'
         ORDER BY key ASC LIMIT ?`,
        [pluginId, `${escapeLike(prefix)}%`, limit],
      );
      return {
        entries: rows.map((row) => ({
          key: row.key,
          value: parseStoredValue(row.value, row.key),
        })),
      };
    },
  };
}

/** Delete every storage row owned by a plugin (uninstall cleanup). */
export function deletePluginStorage(pluginId: string): void {
  sqliteRun('DELETE FROM plugin_storage WHERE plugin_id = ?', [pluginId]);
}
