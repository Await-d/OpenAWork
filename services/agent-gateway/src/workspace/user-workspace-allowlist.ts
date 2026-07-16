/**
 * Per-user workspace allowlist.
 *
 * The frontend persists the user's "saved workspace paths" in
 * localStorage, but the backend has no equivalent table. The result
 * is that any logged-in user can read any path under
 * `WORKSPACE_ROOTS` simply by hitting `/workspace/file?path=...` —
 * which is too permissive for installations where a single login
 * owns several unrelated projects.
 *
 * Until a dedicated `user_workspaces` table lands, we derive the
 * allowlist by scanning the user's own sessions for
 * `metadata_json.workingDirectory` values. A user can only point
 * filesystem reads at directories they have actually opened a
 * session against — which matches the UX flow (the frontend always
 * registers a workspace via "open workspace" before reads happen).
 *
 * The result is cached for a short window per user since:
 *   - Sessions metadata changes infrequently.
 *   - The allowlist is checked on every workspace endpoint call.
 *   - Even a single SQL roundtrip per click adds up over a session.
 */

import { sqliteAll } from '../infra/db.js';
import { isPathWithinRoot, validateWorkspacePath } from './workspace-paths.js';

interface SessionRow {
  metadata_json: string | null;
}

const ALLOWLIST_CACHE_TTL_MS = 30_000;
/**
 * Hard ceiling on the per-user allowlist cache. Entries key on userId and the
 * TTL (`expiresAt`) was only ever checked on *read* — expired entries were
 * never deleted, so the map grew one entry per user who ever hit a workspace
 * endpoint and never shrank. We sweep expired entries opportunistically and
 * cap the total, evicting soonest-to-expire first.
 */
const ALLOWLIST_CACHE_MAX_ENTRIES = 5_000;
const allowlistCache = new Map<string, { roots: string[]; expiresAt: number }>();

/**
 * Bound `allowlistCache`. Called after each insert: drop already-expired
 * entries (a stale entry is rebuilt from DB on next read anyway), then if still
 * over the cap evict soonest-to-expire first until back at the ceiling.
 */
function pruneAllowlistCache(): void {
  const now = Date.now();
  for (const [userId, entry] of allowlistCache) {
    if (entry.expiresAt <= now) {
      allowlistCache.delete(userId);
    }
  }
  if (allowlistCache.size <= ALLOWLIST_CACHE_MAX_ENTRIES) {
    return;
  }
  const byExpiry = [...allowlistCache.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt);
  const excess = allowlistCache.size - ALLOWLIST_CACHE_MAX_ENTRIES;
  for (let i = 0; i < excess; i += 1) {
    const victim = byExpiry[i];
    if (victim) allowlistCache.delete(victim[0]);
  }
}

/**
 * Read all distinct `workingDirectory` values referenced by the
 * user's sessions. Falsy / non-string entries are skipped, leading
 * `~` paths are not expanded (we expect absolute paths from session
 * setup), and nested duplicates are collapsed to the shallowest.
 */
function fetchUserWorkspaceRootsFromDb(userId: string): string[] {
  const rows = sqliteAll<SessionRow>('SELECT metadata_json FROM sessions WHERE user_id = ?', [
    userId,
  ]);
  const roots = new Set<string>();
  for (const row of rows) {
    if (!row.metadata_json) continue;
    try {
      const meta = JSON.parse(row.metadata_json) as { workingDirectory?: unknown };
      const cwd = typeof meta.workingDirectory === 'string' ? meta.workingDirectory.trim() : '';
      if (cwd.length === 0) continue;
      const normalized = validateWorkspacePath(cwd);
      if (!normalized) continue;
      roots.add(normalized);
    } catch {
      /* malformed metadata — skip */
    }
  }
  return Array.from(roots);
}

export function getUserWorkspaceAllowlist(userId: string): string[] {
  const cached = allowlistCache.get(userId);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.roots;
  const roots = fetchUserWorkspaceRootsFromDb(userId);
  allowlistCache.set(userId, { roots, expiresAt: now + ALLOWLIST_CACHE_TTL_MS });
  pruneAllowlistCache();
  return roots;
}

/**
 * Returns true when `targetPath` lives inside any of the user's
 * registered workspace roots. Empty allowlists fail closed:
 * a brand-new user with no sessions yet can't read anything via
 * workspace endpoints. This is a deliberate trade-off — the very
 * first workspace open creates a session, after which the user
 * has access; before that their token only grants login state.
 */
export function isPathInUserAllowlist(userId: string, targetPath: string): boolean {
  const roots = getUserWorkspaceAllowlist(userId);
  if (roots.length === 0) return false;
  return roots.some((root) => isPathWithinRoot(targetPath, root));
}

/** Clear the cache when sessions are updated — call after writes. */
export function invalidateUserWorkspaceAllowlist(userId: string): void {
  allowlistCache.delete(userId);
}

/** Test hook. */
export function __resetUserWorkspaceAllowlistCacheForTest(): void {
  allowlistCache.clear();
}

/** Test-only seams for the retention guard (cap / expiry verifiable in-memory). */
export function __seedAllowlistCacheForTest(userId: string, expiresAtMs: number): void {
  allowlistCache.set(userId, { roots: [], expiresAt: expiresAtMs });
}
export function __getAllowlistCacheSizeForTest(): number {
  return allowlistCache.size;
}
export function __pruneAllowlistCacheForTest(): void {
  pruneAllowlistCache();
}
export const __ALLOWLIST_CACHE_MAX_ENTRIES_FOR_TEST = ALLOWLIST_CACHE_MAX_ENTRIES;
