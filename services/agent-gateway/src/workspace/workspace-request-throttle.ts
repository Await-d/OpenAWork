/**
 * In-memory request throttle for expensive workspace endpoints.
 *
 * `GET /workspace/files/search` builds a full workspace file index on first
 * touch: a cache miss walks the whole workspace with `readdir` (~0.6–1s of I/O
 * on a ~4.4k-file repository). The web client debounces mention searches by
 * 120ms, but that only bounds *typing* traffic — an authenticated client can
 * still send distinct `path` / `q` combinations back to back and force one
 * full walk per request.
 *
 * This is a sliding-window counter keyed by an opaque string (the search route
 * uses `userId::workspaceRoot`). A rejected call does NOT consume budget and
 * reports how long until the oldest in-window hit falls out of the window, so
 * the caller can answer with `Retry-After`.
 *
 * Deliberately in-memory and dependency-free (no Redis, no Fastify plugin):
 * the gateway is single-process, so a process-local guard still caps the
 * abuse. Memory is bounded two ways — expired hits are pruned on access and a
 * full sweep runs at most once per window, while `maxEntries` evicts the least
 * recently active keys under a key-varying flood, so one key per user can
 * never grow the map without limit.
 */

export interface WorkspaceRequestThrottleOptions {
  /** Requests allowed per key within the sliding window. */
  limit: number;
  /** Sliding window length in milliseconds. */
  windowMs: number;
  /** Injectable clock for deterministic tests. Defaults to `Date.now`. */
  now?: () => number;
  /** Hard cap on tracked keys (anti-leak under key-varying floods). Default 5_000. */
  maxEntries?: number;
}

export type WorkspaceRequestThrottleResult =
  { allowed: true } | { allowed: false; retryAfterMs: number };

export interface WorkspaceRequestThrottle {
  /**
   * Consume one unit of budget for `key`. Returns `allowed: false` (without
   * consuming) plus the number of ms until a slot frees up once the key is
   * over budget.
   */
  tryConsume(key: string): WorkspaceRequestThrottleResult;
  /** Drop all tracked state. Test/ops helper. */
  reset(): void;
  /** Current number of tracked keys. Test/diagnostics helper. */
  size(): number;
}

const DEFAULT_MAX_ENTRIES = 5_000;

export function createWorkspaceRequestThrottle(
  options: WorkspaceRequestThrottleOptions,
): WorkspaceRequestThrottle {
  const { limit, windowMs } = options;
  const now = options.now ?? (() => Date.now());
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  /** key → in-window hit timestamps, ascending. */
  const hitsByKey = new Map<string, number[]>();
  let lastSweepAt = 0;

  /** Drop hits that fell out of the window; keys left empty are evicted. */
  function pruneExpiredHits(nowMs: number): void {
    for (const [key, hits] of hitsByKey) {
      const live = hits.filter((ts) => nowMs - ts < windowMs);
      if (live.length === 0) {
        hitsByKey.delete(key);
      } else if (live.length !== hits.length) {
        hitsByKey.set(key, live);
      }
    }
  }

  /** Evict least-recently-active keys until back at the cap. */
  function evictOverCap(): void {
    const excess = hitsByKey.size - maxEntries;
    if (excess <= 0) return;
    const byActivity = [...hitsByKey.entries()].sort((left, right) => {
      const leftLast = left[1][left[1].length - 1] ?? 0;
      const rightLast = right[1][right[1].length - 1] ?? 0;
      return leftLast - rightLast;
    });
    for (let index = 0; index < excess; index += 1) {
      const victim = byActivity[index];
      if (victim) hitsByKey.delete(victim[0]);
    }
  }

  return {
    tryConsume(key: string): WorkspaceRequestThrottleResult {
      const nowMs = now();
      const previous = hitsByKey.get(key) ?? [];
      const hits = previous.filter((ts) => nowMs - ts < windowMs);

      if (hits.length >= limit) {
        // Keep the pruned list so a rejected key does not pin stale memory.
        hitsByKey.set(key, hits);
        const oldest = hits[0] ?? nowMs;
        return { allowed: false, retryAfterMs: Math.max(1, oldest + windowMs - nowMs) };
      }

      hits.push(nowMs);
      hitsByKey.set(key, hits);
      // Amortized sweep: at most one full pass per window, plus an immediate
      // pass once the map is over the cap. The touched key carries the newest
      // timestamp, so the least-recently-active eviction below never drops it.
      if (hitsByKey.size > maxEntries || nowMs - lastSweepAt >= windowMs) {
        lastSweepAt = nowMs;
        pruneExpiredHits(nowMs);
      }
      if (hitsByKey.size > maxEntries) {
        evictOverCap();
      }
      return { allowed: true };
    },

    reset(): void {
      hitsByKey.clear();
      lastSweepAt = 0;
    },

    size(): number {
      return hitsByKey.size;
    },
  };
}
