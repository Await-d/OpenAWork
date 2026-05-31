/**
 * Regression: the MCP tool-catalog cache keys on (userId, mcpPoolKey) where
 * mcpPoolKey = `${serverId}:${fingerprint}`. The fingerprint rotates when a
 * user edits an MCP server config, and idle cleanup / the pool's disconnect
 * paths drop connections without clearing the catalog — only connect-error
 * clears. So over a long-lived process the cache grows with
 * (users x servers x config edits) and was never bounded. The retention guard
 * now caps the snapshot count, evicting oldest-by-capturedAt first.
 *
 * The pool is mocked so importing the catalog doesn't pull in a real MCP
 * connection pool; these tests only exercise the size-cap via seams.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../skill/skill-mcp-connection-pool.js', () => ({
  mcpConnectionPool: {
    onToolListChanged: vi.fn(() => () => undefined),
    tryGetAdapter: vi.fn(),
  },
}));

import {
  __seedCatalogSnapshotForTest,
  __getCatalogSnapshotCountForTest,
  __pruneCatalogSnapshotsForTest,
  clearAllCatalogSnapshots,
  __CATALOG_SNAPSHOT_MAX_ENTRIES_FOR_TEST as MAX,
} from '../../mcp/mcp-tool-catalog.js';

afterEach(() => {
  clearAllCatalogSnapshots();
});

describe('mcp tool-catalog cache retention guard', () => {
  it('超过容量上限时按 capturedAt 最旧优先淘汰，回落到上限', () => {
    const now = Date.now();
    const total = MAX + 30;
    for (let i = 0; i < total; i += 1) {
      // i=0 oldest, i=total-1 newest, so eviction order is deterministic.
      __seedCatalogSnapshotForTest('user', `srv:${i}`, now - (total - i) * 10);
    }
    expect(__getCatalogSnapshotCountForTest()).toBe(total);

    __pruneCatalogSnapshotsForTest();

    expect(__getCatalogSnapshotCountForTest()).toBe(MAX);
  });

  it('未超上限时 prune 不删任何条目', () => {
    const now = Date.now();
    __seedCatalogSnapshotForTest('user', 'srv:a', now);
    __seedCatalogSnapshotForTest('user', 'srv:b', now - 1000);
    __pruneCatalogSnapshotsForTest();
    expect(__getCatalogSnapshotCountForTest()).toBe(2);
  });
});
