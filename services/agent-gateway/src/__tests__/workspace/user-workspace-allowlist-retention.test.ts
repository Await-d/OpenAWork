/**
 * Regression: allowlistCache (workspace/user-workspace-allowlist.ts) keys on
 * userId and its TTL (expiresAt) was only checked on read — expired entries
 * were never deleted, so the map grew one entry per user who ever hit a
 * workspace endpoint. The retention guard now sweeps expired entries and caps
 * total size, evicting soonest-to-expire first.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  __seedAllowlistCacheForTest,
  __getAllowlistCacheSizeForTest,
  __pruneAllowlistCacheForTest,
  __resetUserWorkspaceAllowlistCacheForTest,
  __ALLOWLIST_CACHE_MAX_ENTRIES_FOR_TEST as MAX,
} from '../../workspace/user-workspace-allowlist.js';

afterEach(() => {
  __resetUserWorkspaceAllowlistCacheForTest();
});

describe('user-workspace allowlistCache retention guard', () => {
  it('已过期的条目在 prune 时被删除', () => {
    const now = Date.now();
    __seedAllowlistCacheForTest('u-fresh', now + 30_000);
    __seedAllowlistCacheForTest('u-expired', now - 1000);
    expect(__getAllowlistCacheSizeForTest()).toBe(2);

    __pruneAllowlistCacheForTest();

    expect(__getAllowlistCacheSizeForTest()).toBe(1);
  });

  it('超过容量上限时按 expiresAt 最早优先淘汰，回落到上限', () => {
    const now = Date.now();
    const total = MAX + 25;
    for (let i = 0; i < total; i += 1) {
      // All in the future (unexpired), increasing expiresAt for deterministic order.
      __seedAllowlistCacheForTest(`u-${i}`, now + 60_000 + i * 10);
    }
    expect(__getAllowlistCacheSizeForTest()).toBe(total);

    __pruneAllowlistCacheForTest();

    expect(__getAllowlistCacheSizeForTest()).toBe(MAX);
  });
});
