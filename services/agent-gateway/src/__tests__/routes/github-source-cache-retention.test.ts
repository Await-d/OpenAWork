/**
 * Regression: githubSourceCache (routes/skills.ts) keys code-search sources on
 * `${source.id}::${query}` where `query` comes from the authenticated
 * `/skills/search?q=` request. The TTL only gated reads — entries were never
 * deleted, so the map grew one entry per distinct query forever. The retention
 * guard now (a) drops entries past the stale-if-error window and (b) caps total
 * size, evicting oldest-first. These tests pin both behaviours.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  __seedGitHubSourceCacheForTest,
  __getGitHubSourceCacheSizeForTest,
  __pruneGitHubSourceCacheForTest,
  __clearGitHubSourceCacheForTest,
  __GITHUB_SOURCE_CACHE_MAX_ENTRIES_FOR_TEST as MAX,
  __GITHUB_SOURCE_STALE_IF_ERROR_MS_FOR_TEST as STALE_MS,
} from '../../routes/skills.js';

afterEach(() => {
  __clearGitHubSourceCacheForTest();
});

describe('githubSourceCache retention guard', () => {
  it('过期（超过 stale-if-error 窗口）的条目在 prune 时被删除', () => {
    const now = Date.now();
    // Fresh entry stays; fully-expired entry is dropped.
    __seedGitHubSourceCacheForTest('src::fresh', now);
    __seedGitHubSourceCacheForTest('src::expired', now - STALE_MS - 1000);
    expect(__getGitHubSourceCacheSizeForTest()).toBe(2);

    __pruneGitHubSourceCacheForTest();

    expect(__getGitHubSourceCacheSizeForTest()).toBe(1);
  });

  it('超过容量上限时按 fetchedAt 最旧优先淘汰，回落到上限', () => {
    const now = Date.now();
    // Seed MAX + 50 fresh-but-distinct-query entries (all within the window),
    // each older as the index grows so eviction order is deterministic.
    const total = MAX + 50;
    for (let i = 0; i < total; i += 1) {
      // i=0 is oldest, i=total-1 is newest (all within stale window).
      __seedGitHubSourceCacheForTest(`src::q-${i}`, now - (total - i) * 1000);
    }
    expect(__getGitHubSourceCacheSizeForTest()).toBe(total);

    __pruneGitHubSourceCacheForTest();

    // Capped back to the ceiling.
    expect(__getGitHubSourceCacheSizeForTest()).toBe(MAX);
  });

  it('未超上限且未过期时 prune 不删任何条目', () => {
    const now = Date.now();
    __seedGitHubSourceCacheForTest('src::a', now);
    __seedGitHubSourceCacheForTest('src::b', now - 1000);
    __pruneGitHubSourceCacheForTest();
    expect(__getGitHubSourceCacheSizeForTest()).toBe(2);
  });
});
