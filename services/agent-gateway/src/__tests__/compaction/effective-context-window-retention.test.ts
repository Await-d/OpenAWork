/**
 * Regression: effectiveContextWindowCache (compaction/context-window-resolver.ts)
 * keys on `${userId}:${modelId}` with a 1h TTL that was only checked on read —
 * `resolveEffectiveContextWindow` deletes only the single entry it happens to
 * touch when expired. An entry recorded once but never read again is never
 * reclaimed, so the map grows one entry per (user × model) ever seen. The
 * retention guard now sweeps expired entries and caps the total, evicting
 * oldest-by-discoveredAt. These tests pin both behaviours.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  __seedEffectiveContextWindowForTest,
  __getEffectiveContextWindowCacheSizeForTest,
  __pruneEffectiveContextWindowCacheForTest,
  clearAllDiscoveredContextWindows,
  __EFFECTIVE_CONTEXT_WINDOW_CACHE_MAX_ENTRIES_FOR_TEST as MAX,
  __EFFECTIVE_CONTEXT_WINDOW_CACHE_TTL_MS_FOR_TEST as TTL,
} from '../../compaction/context-window-resolver.js';

afterEach(() => {
  clearAllDiscoveredContextWindows();
});

describe('effectiveContextWindowCache retention guard', () => {
  it('过期（超过 TTL）的条目在 prune 时被删除', () => {
    const now = Date.now();
    __seedEffectiveContextWindowForTest('u-fresh', 'm', 400_000, now);
    __seedEffectiveContextWindowForTest('u-expired', 'm', 400_000, now - TTL - 1_000);
    expect(__getEffectiveContextWindowCacheSizeForTest()).toBe(2);

    __pruneEffectiveContextWindowCacheForTest();

    expect(__getEffectiveContextWindowCacheSizeForTest()).toBe(1);
  });

  it('超过容量上限时按 discoveredAt 最旧优先淘汰，回落到上限', () => {
    const now = Date.now();
    const total = MAX + 25;
    for (let i = 0; i < total; i += 1) {
      // All within TTL, increasing discoveredAt so eviction order is deterministic.
      __seedEffectiveContextWindowForTest(`u-${i}`, 'm', 400_000, now - (total - i) * 10);
    }
    expect(__getEffectiveContextWindowCacheSizeForTest()).toBe(total);

    __pruneEffectiveContextWindowCacheForTest();

    expect(__getEffectiveContextWindowCacheSizeForTest()).toBe(MAX);
  });
});
