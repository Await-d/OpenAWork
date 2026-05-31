/**
 * Regression: catalogCache (provider/provider-catalog.ts) keys on userId and
 * its 30s TTL was only checked on read — expired entries were never deleted,
 * so the map grew one (heavyweight ProviderManagerImpl-holding) entry per user
 * who ever issued a request. The retention guard now sweeps expired entries and
 * caps total size, evicting oldest-first. These tests pin both behaviours.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  __seedCatalogCacheForTest,
  __getCatalogCacheSizeForTest,
  __pruneCatalogCacheForTest,
  invalidateAllCatalogs,
  __CATALOG_CACHE_MAX_ENTRIES_FOR_TEST as MAX,
  __CATALOG_CACHE_TTL_MS_FOR_TEST as TTL,
} from '../../provider/provider-catalog.js';

afterEach(() => {
  invalidateAllCatalogs();
});

describe('provider catalogCache retention guard', () => {
  it('过期（超过 TTL）的条目在 prune 时被删除', () => {
    const now = Date.now();
    __seedCatalogCacheForTest('u-fresh', now);
    __seedCatalogCacheForTest('u-expired', now - TTL - 1000);
    expect(__getCatalogCacheSizeForTest()).toBe(2);

    __pruneCatalogCacheForTest();

    expect(__getCatalogCacheSizeForTest()).toBe(1);
  });

  it('超过容量上限时按 builtAt 最旧优先淘汰，回落到上限', () => {
    const now = Date.now();
    const total = MAX + 25;
    for (let i = 0; i < total; i += 1) {
      // All within TTL, increasing builtAt so eviction order is deterministic.
      __seedCatalogCacheForTest(`u-${i}`, now - (total - i) * 10);
    }
    expect(__getCatalogCacheSizeForTest()).toBe(total);

    __pruneCatalogCacheForTest();

    expect(__getCatalogCacheSizeForTest()).toBe(MAX);
  });
});
