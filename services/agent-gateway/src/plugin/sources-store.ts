/**
 * Plugin market sources — GitHub repositories the market aggregates.
 *
 * A source is stored by its natural key `owner/repo` (stable, deduped).
 * `ref` is optional (defaults to the repo default branch via `HEAD`).
 */

import { parseGitHubRef } from '@openAwork/skill-registry';
import { sqliteAll, sqliteGet, sqliteRun } from '../infra/db.js';

export interface PluginSource {
  /** Natural key: `owner/repo`. */
  readonly id: string;
  readonly name: string;
  readonly repo: string;
  readonly ref?: string;
  readonly enabled: boolean;
  readonly createdAt: string;
}

export class PluginSourceError extends Error {
  override name = 'PluginSourceError';
}

interface PluginSourceRow {
  readonly id: string;
  readonly name: string;
  readonly repo: string;
  readonly ref: string | null;
  readonly enabled: number;
  readonly created_at: string;
}

function toSource(row: PluginSourceRow): PluginSource {
  return {
    id: row.id,
    name: row.name,
    repo: row.repo,
    ...(row.ref === null ? {} : { ref: row.ref }),
    enabled: row.enabled === 1,
    createdAt: row.created_at,
  };
}

/**
 * Normalize user input into `{ repo, ref }`. Accepts `owner/repo`,
 * `owner/repo@tag`, and `https://github.com/owner/repo` (parsed by the
 * skill-registry helper for consistent validation).
 */
export function normalizePluginRepoInput(input: string): { repo: string; ref?: string } {
  let parsed: { owner: string; repo: string; ref?: string };
  try {
    parsed = parseGitHubRef(input.trim());
  } catch (err) {
    throw new PluginSourceError(err instanceof Error ? err.message : String(err));
  }
  return {
    repo: `${parsed.owner}/${parsed.repo}`,
    ...(parsed.ref === undefined ? {} : { ref: parsed.ref }),
  };
}

export function listPluginSources(): readonly PluginSource[] {
  return sqliteAll<PluginSourceRow>(
    'SELECT id, name, repo, ref, enabled, created_at FROM plugin_sources ORDER BY created_at ASC, id ASC',
  ).map(toSource);
}

export function getPluginSource(id: string): PluginSource | undefined {
  const row = sqliteGet<PluginSourceRow>(
    'SELECT id, name, repo, ref, enabled, created_at FROM plugin_sources WHERE id = ? LIMIT 1',
    [id],
  );
  return row === undefined ? undefined : toSource(row);
}

export function addPluginSource(input: {
  readonly repo: string;
  readonly ref?: string;
  readonly name?: string;
}): PluginSource {
  const normalized = normalizePluginRepoInput(input.repo);
  const ref = input.ref?.trim() || normalized.ref;
  const name = input.name?.trim() || normalized.repo;
  sqliteRun(
    `INSERT INTO plugin_sources (id, name, repo, ref, enabled, updated_at)
     VALUES (?, ?, ?, ?, 1, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       ref = excluded.ref,
       enabled = 1,
       updated_at = datetime('now')`,
    [normalized.repo, name, normalized.repo, ref ?? null],
  );
  const source = getPluginSource(normalized.repo);
  if (!source) {
    throw new PluginSourceError(`保存插件源失败：${normalized.repo}`);
  }
  return source;
}

export function removePluginSource(id: string): boolean {
  const existing = getPluginSource(id);
  if (!existing) return false;
  sqliteRun('DELETE FROM plugin_sources WHERE id = ?', [id]);
  return true;
}
