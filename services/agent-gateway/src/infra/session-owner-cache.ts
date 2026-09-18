/**
 * Short-TTL cache for `sessions.user_id`.
 *
 * The streaming hot path resolves the session owner once per persisted row
 * (RunEvent rows in session-run-events.ts, SessionEvent rows in
 * session-entry-store.ts, message/part rows in the V2 projectors). Session
 * ownership is immutable for the lifetime of a row, so caching is safe; the
 * only edge is deletion, which feeds a stale id into an INSERT whose FK check
 * rejects it — every caller already tolerates that (drop + log). Deletion
 * entry points additionally call `invalidateSessionOwnerCache` so the window
 * stays at zero in practice.
 */
import { sqliteGet } from './db.js';

interface CachedSessionOwner {
  expiresAt: number;
  userId: string | null;
}

const CACHE_TTL_MS = 30_000;
const CACHE_MAX_ENTRIES = 500;

const cache = new Map<string, CachedSessionOwner>();

/** Resolve the session owner, serving repeat lookups from a short-TTL cache. */
export function getSessionOwnerUserId(sessionId: string): string | null {
  const now = Date.now();
  const cached = cache.get(sessionId);
  if (cached && cached.expiresAt > now) {
    return cached.userId;
  }

  const row = sqliteGet<{ user_id: string }>('SELECT user_id FROM sessions WHERE id = ? LIMIT 1', [
    sessionId,
  ]);
  const userId = row?.user_id ?? null;

  if (cache.size >= CACHE_MAX_ENTRIES) {
    // Ownership rows are tiny: drop expired entries, and if that is not
    // enough fall back to a full reset — the next lookup re-derives from the
    // primary-key index anyway.
    for (const [key, entry] of cache) {
      if (entry.expiresAt <= now) cache.delete(key);
    }
    if (cache.size >= CACHE_MAX_ENTRIES) cache.clear();
  }
  cache.set(sessionId, { expiresAt: now + CACHE_TTL_MS, userId });
  return userId;
}

/**
 * Drop cached owner rows — call after deleting a session, and from tests that
 * mutate the `sessions` table behind the cache's back.
 */
export function invalidateSessionOwnerCache(sessionId?: string): void {
  if (sessionId === undefined) {
    cache.clear();
    return;
  }
  cache.delete(sessionId);
}
