/**
 * Coverage for the MCP tool-catalog cache + change broadcaster.
 *
 * The catalog is a pure in-memory module with two responsibilities:
 *   1. Hold per-(userId, mcpPoolKey) tool snapshots so PR-C's
 *      flattened LLM tool dictionary can read deterministic state.
 *   2. Republish whenever a snapshot mutates — either via direct
 *      `setCatalogSnapshot` writes (warmup path) or via the pool's
 *      `notifications/tools/list_changed` fan-out (push path).
 *
 * These tests stay at the unit-test layer: the pool is mocked so we
 * can drive notifications synchronously without a real MCP server.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as McpToolCatalogModule from '../mcp-tool-catalog.js';

const poolMock = vi.hoisted(() => ({
  // Registered listener captured here so individual tests can fire
  // synthetic ToolListChanged events without a real MCP server.
  capturedListener: null as
    | null
    | ((evt: { userId: string; mcpName: string; serverId: string }) => void | Promise<void>),
  onToolListChanged: vi.fn(
    (
      listener: (evt: {
        userId: string;
        mcpName: string;
        serverId: string;
      }) => void | Promise<void>,
    ) => {
      poolMock.capturedListener = listener;
      return () => {
        poolMock.capturedListener = null;
      };
    },
  ),
  tryGetAdapter: vi.fn(),
}));

vi.mock('../skill-mcp-connection-pool.js', () => ({
  mcpConnectionPool: poolMock,
}));

const SAMPLE_TOOLS = [
  { name: 'fetch_issue', description: 'Read a GitHub issue', inputSchema: {} },
  { name: 'create_issue', description: 'Create a GitHub issue', inputSchema: {} },
];

// We import the catalog dynamically inside each test so the
// module-level `poolListenerInstalled` guard is reset between cases.
// Otherwise the first test that calls `ensureToolCatalogPoolListener`
// captures the listener but later cases (which need to fire the
// listener too) see a stale closure because beforeEach nulls
// `poolMock.capturedListener` and the guard skips re-registration.
async function loadCatalog(): Promise<typeof McpToolCatalogModule> {
  vi.resetModules();
  return import('../mcp-tool-catalog.js');
}

describe('mcp-tool-catalog', () => {
  beforeEach(() => {
    poolMock.capturedListener = null;
    poolMock.onToolListChanged.mockClear();
    poolMock.tryGetAdapter.mockReset();
  });

  afterEach(async () => {
    const catalog = await loadCatalog();
    catalog.clearAllCatalogSnapshots();
  });

  it('stores and retrieves snapshots scoped by (userId, mcpPoolKey)', async () => {
    const { setCatalogSnapshot, getCatalogSnapshot } = await loadCatalog();
    setCatalogSnapshot('user-1', 'gh:abc123', 'gh-server', SAMPLE_TOOLS);
    expect(getCatalogSnapshot('user-1', 'gh:abc123')).toEqual(SAMPLE_TOOLS);

    // Different user → no leak.
    expect(getCatalogSnapshot('user-2', 'gh:abc123')).toBeNull();
    // Different pool key (e.g. config fingerprint changed) → no leak.
    expect(getCatalogSnapshot('user-1', 'gh:def456')).toBeNull();
  });

  it('notifies subscribers on every snapshot write with the originating tuple', async () => {
    const { setCatalogSnapshot, subscribeToolCatalogChanges } = await loadCatalog();
    const events: Array<{
      userId: string;
      mcpPoolKey: string;
      serverId: string;
      toolCount: number;
    }> = [];
    const unsubscribe = subscribeToolCatalogChanges((evt) => {
      events.push({
        userId: evt.userId,
        mcpPoolKey: evt.mcpPoolKey,
        serverId: evt.serverId,
        toolCount: evt.tools.length,
      });
    });

    setCatalogSnapshot('user-1', 'gh:abc123', 'gh-server', SAMPLE_TOOLS);
    setCatalogSnapshot('user-1', 'gh:abc123', 'gh-server', SAMPLE_TOOLS.slice(0, 1));

    expect(events).toEqual([
      { userId: 'user-1', mcpPoolKey: 'gh:abc123', serverId: 'gh-server', toolCount: 2 },
      { userId: 'user-1', mcpPoolKey: 'gh:abc123', serverId: 'gh-server', toolCount: 1 },
    ]);

    unsubscribe();
    setCatalogSnapshot('user-1', 'gh:abc123', 'gh-server', []);
    // After unsubscribe no further events should arrive.
    expect(events).toHaveLength(2);
  });

  it('refreshes the cache when the pool fans out a tools/list_changed push', async () => {
    const {
      ensureToolCatalogPoolListener,
      setCatalogSnapshot,
      subscribeToolCatalogChanges,
      getCatalogSnapshot,
    } = await loadCatalog();
    ensureToolCatalogPoolListener();
    expect(poolMock.capturedListener).not.toBeNull();

    // Seed an initial snapshot so we can prove the push refreshes it
    // rather than just appending.
    setCatalogSnapshot('user-1', 'gh:abc123', 'gh-server', SAMPLE_TOOLS);

    // Adapter peek returns a fake adapter whose listTools resolves with
    // a NEW tool list — simulating the server having added a tool.
    const refreshedTools = [
      ...SAMPLE_TOOLS,
      { name: 'close_issue', description: 'Close a GitHub issue', inputSchema: {} },
    ];
    const fakeAdapter = {
      listTools: vi.fn(async (serverId: string) => {
        expect(serverId).toBe('gh-server');
        return refreshedTools;
      }),
    };
    poolMock.tryGetAdapter.mockReturnValue(fakeAdapter);

    const events: Array<number> = [];
    subscribeToolCatalogChanges((evt) => {
      events.push(evt.tools.length);
    });

    await poolMock.capturedListener!({
      userId: 'user-1',
      mcpName: 'gh:abc123',
      serverId: 'gh-server',
    });

    // listTools must have been called via the peek path (not via a
    // fresh withOperationRetry connect — that's the contract for
    // post-push refreshes).
    expect(fakeAdapter.listTools).toHaveBeenCalledTimes(1);
    expect(getCatalogSnapshot('user-1', 'gh:abc123')).toEqual(refreshedTools);
    expect(events).toEqual([3]);
  });

  it('clears the cache on a push when the connection has already been idle-cleaned', async () => {
    const { ensureToolCatalogPoolListener, setCatalogSnapshot, getCatalogSnapshot } =
      await loadCatalog();
    ensureToolCatalogPoolListener();
    setCatalogSnapshot('user-1', 'gh:abc123', 'gh-server', SAMPLE_TOOLS);
    poolMock.tryGetAdapter.mockReturnValue(null);

    await poolMock.capturedListener!({
      userId: 'user-1',
      mcpName: 'gh:abc123',
      serverId: 'gh-server',
    });

    expect(getCatalogSnapshot('user-1', 'gh:abc123')).toBeNull();
  });

  it('is idempotent — ensureToolCatalogPoolListener only registers one pool listener per module load', async () => {
    const { ensureToolCatalogPoolListener } = await loadCatalog();
    ensureToolCatalogPoolListener();
    ensureToolCatalogPoolListener();
    ensureToolCatalogPoolListener();
    // The guard inside the catalog module installs the listener at
    // most once across the module's lifetime. Since `loadCatalog`
    // resets modules, this assertion holds within a single test run.
    expect(poolMock.onToolListChanged.mock.calls.length).toBe(1);
  });
});
