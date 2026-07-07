/**
 * Tests for `retryMcpConnectionForUser` and `isMcpServerConnectedForUser`.
 *
 * The retry helper is the backend half of the MCP management page's
 * "重试连接 / 安装" button. It MUST:
 *   1. Short-circuit `enabled: false` servers without touching the
 *      connection pool — the user explicitly disabled them and we
 *      shouldn't be silently re-spawning subprocesses behind their
 *      back.
 *   2. Always start from a clean slate by calling
 *      `disconnectUserConnection` before re-attempting, so a stale
 *      half-broken adapter doesn't keep returning the same cached
 *      error.
 *   3. Surface the SDK / transport error message verbatim — the
 *      whole point of the manual button is to let the user read
 *      "command not found" / "ECONNREFUSED" / etc.
 *   4. 404 (via thrown error) when the requested server id doesn't
 *      exist in the user's settings or built-in list.
 *
 * `isMcpServerConnectedForUser` is a peek-only `Map.has` against the
 * pool. We assert it stays peek-only — a buggy implementation that
 * eagerly connected here would defeat the whole point of polling
 * `/settings/mcp-status` (every poll would warm the connection).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => {
  const rows = new Map<string, string>();
  const keyOf = (userId: string, key: string): string => `${userId}::${key}`;

  // Crude SQL-string sniffer: `loadConfiguredMcpServersForUser`
  // hardcodes `key = 'mcp_servers'` in the WHERE clause and passes
  // only `[userId]`, while other call sites bind the key as a
  // second parameter. We sniff the SQL text to figure out which
  // shape we got.
  const inferKeyFromSql = (sql: string, params: readonly unknown[]): string | undefined => {
    if (sql.includes("'mcp_servers'")) return 'mcp_servers';
    return typeof params[1] === 'string' ? params[1] : undefined;
  };

  return {
    rows,
    keyOf,
    sqliteAllMock: vi.fn(() => [] as Array<{ user_id: string; value: string }>),
    sqliteGetMock: vi.fn((sql: string, params: readonly unknown[] = []) => {
      if (sql.includes('SELECT user_id FROM sessions')) {
        return { user_id: 'user-1' };
      }
      const userId = params[0] as string;
      const key = inferKeyFromSql(sql, params);
      if (!key) return undefined;
      const value = rows.get(keyOf(userId, key));
      return value ? { value } : undefined;
    }),
    sqliteRunMock: vi.fn((sql: string, params: readonly unknown[] = []) => {
      const userId = params[0] as string;
      const key = inferKeyFromSql(sql, params) ?? 'mcp_servers';
      rows.set(keyOf(userId, key), params[2] as string);
      return { lastInsertRowid: 1, changes: 1 };
    }),
  };
});

const poolMock = vi.hoisted(() => ({
  disconnectUserConnectionMock: vi.fn(async () => undefined),
  withOperationRetryMock: vi.fn(),
  isConnectedMock: vi.fn(() => false),
  // Spies for assertions in individual cases.
  resetSpies(): void {
    this.disconnectUserConnectionMock.mockClear();
    this.withOperationRetryMock.mockReset();
    this.isConnectedMock.mockReset();
  },
}));

vi.mock('../../infra/db.js', () => ({
  WORKSPACE_ROOT: '/home/await',
  WORKSPACE_ROOTS: ['/home/await'],
  WORKSPACE_ACCESS_RESTRICTED: false,
  sqliteAll: dbMock.sqliteAllMock,
  sqliteGet: dbMock.sqliteGetMock,
  sqliteRun: dbMock.sqliteRunMock,
}));

vi.mock('../../skill/skill-mcp-connection-pool.js', () => {
  // The pool's `onToolListChanged` is called by `ensureToolCatalogPoolListener`
  // at mcp-runtime module-load time — must be a no-op function, not
  // an absent property, otherwise importing mcp-runtime throws.
  const fakePool = {
    disconnectUserConnection: poolMock.disconnectUserConnectionMock,
    withOperationRetry: poolMock.withOperationRetryMock,
    isConnected: poolMock.isConnectedMock,
    onToolListChanged: () => () => undefined,
  };
  return {
    mcpConnectionPool: fakePool,
    skillMcpPool: fakePool,
  };
});

import {
  callMcpToolForSession,
  getMcpPoolKey,
  isMcpServerConnectedForUser,
  listMcpToolsForUser,
  retryMcpConnectionForUser,
  type ConfiguredMCPServer,
} from '../../mcp/mcp-runtime.js';
import {
  clearAllCatalogSnapshots,
  getCatalogSnapshot,
  setCatalogSnapshot,
} from '../../mcp/mcp-tool-catalog.js';

const USER_ID = 'user-1';

/** Helper: write a user_settings row that the runtime will read. */
function setUserMcpServers(servers: ConfiguredMCPServer[]): void {
  // The runtime stores the user's raw JSON under the
  // `mcp_servers` setting key (see `loadConfiguredMcpServersForUser`).
  // We bypass `setOAuthEntry`-style helpers here because the test
  // wants to control the exact shape, including invalid edge cases.
  const userServers = servers.map((server) => ({
    id: server.id,
    name: server.name,
    type: server.transport,
    url: server.url,
    command: server.command,
    args: server.args,
    builtin: server.builtin,
    enabled: server.enabled,
    headers: server.headers,
    disabledTools: server.disabledTools,
  }));
  dbMock.rows.set(dbMock.keyOf(USER_ID, 'mcp_servers'), JSON.stringify(userServers));
}

const STDIO_BASE: ConfiguredMCPServer = {
  id: 'fs',
  name: 'filesystem',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-filesystem'],
  enabled: true,
};

describe('retryMcpConnectionForUser', () => {
  beforeEach(() => {
    dbMock.rows.clear();
    poolMock.resetSpies();
    // Cache is module-scoped — wipe between tests so a successful
    // case from one test doesn't leak into the failure-clear case.
    clearAllCatalogSnapshots();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("short-circuits with status 'disabled' when the server is opted out", async () => {
    setUserMcpServers([{ ...STDIO_BASE, enabled: false }]);

    const result = await retryMcpConnectionForUser(USER_ID, 'fs');

    expect(result.status).toBe('disabled');
    expect(result.toolCount).toBe(0);
    expect(result.durationMs).toBe(0);
    // Critically: we do NOT touch the pool for disabled servers —
    // the user explicitly turned them off, this would be silently
    // re-spawning a subprocess behind their back.
    expect(poolMock.disconnectUserConnectionMock).not.toHaveBeenCalled();
    expect(poolMock.withOperationRetryMock).not.toHaveBeenCalled();
  });

  it('returns connected + toolCount on a successful reconnect', async () => {
    setUserMcpServers([STDIO_BASE]);
    poolMock.withOperationRetryMock.mockImplementation(async (_userId, _poolKey, _ref, op) => {
      const fakeAdapter = {
        listTools: vi.fn(async () => [
          { name: 'read_file' },
          { name: 'write_file' },
          { name: 'list_dir' },
        ]),
      };
      return op(fakeAdapter as unknown as never, 'fs');
    });

    const result = await retryMcpConnectionForUser(USER_ID, 'fs');

    expect(result.status).toBe('connected');
    expect(result.toolCount).toBe(3);
    expect(result.error).toBeUndefined();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    // We always disconnect first to drop a stale half-broken adapter.
    expect(poolMock.disconnectUserConnectionMock).toHaveBeenCalledTimes(1);
    expect(poolMock.withOperationRetryMock).toHaveBeenCalledTimes(1);
  });

  it("returns status 'error' with the SDK message verbatim on failure", async () => {
    setUserMcpServers([STDIO_BASE]);
    poolMock.withOperationRetryMock.mockRejectedValueOnce(
      new Error('command not found: filesystem-mcp'),
    );

    const result = await retryMcpConnectionForUser(USER_ID, 'fs');

    expect(result.status).toBe('error');
    expect(result.error).toBe('command not found: filesystem-mcp');
    expect(result.toolCount).toBe(0);
    // Disconnect was still attempted — fresh-slate guarantee.
    expect(poolMock.disconnectUserConnectionMock).toHaveBeenCalledTimes(1);
  });

  it('serialises non-Error rejections to a string in the error field', async () => {
    setUserMcpServers([STDIO_BASE]);
    poolMock.withOperationRetryMock.mockRejectedValueOnce('plain string failure');

    const result = await retryMcpConnectionForUser(USER_ID, 'fs');

    expect(result.status).toBe('error');
    expect(result.error).toBe('plain string failure');
  });

  it('throws when the requested server id does not exist (route maps to 404)', async () => {
    setUserMcpServers([STDIO_BASE]);

    // Built-in `websearch` / `grep_app` exist by default, but
    // `nonexistent-id` does not — the helper should throw with a
    // clear message so the route layer can return 404.
    await expect(retryMcpConnectionForUser(USER_ID, 'nonexistent-id')).rejects.toThrow();
    // And no pool work happened — there was nothing to retry.
    expect(poolMock.disconnectUserConnectionMock).not.toHaveBeenCalled();
    expect(poolMock.withOperationRetryMock).not.toHaveBeenCalled();
  });

  it('connects virtual builtin MCP servers without touching the stdio pool', async () => {
    const result = await retryMcpConnectionForUser(USER_ID, 'codegraph');

    expect(result.status).toBe('connected');
    expect(result.toolCount).toBeGreaterThan(0);
    expect(poolMock.disconnectUserConnectionMock).not.toHaveBeenCalled();
    expect(poolMock.withOperationRetryMock).not.toHaveBeenCalled();
  });

  it('lists virtual builtin MCP tools without touching the stdio pool', async () => {
    const catalogs = await listMcpToolsForUser(USER_ID, { serverId: 'lsp' });

    expect(catalogs).toHaveLength(1);
    expect(catalogs[0]?.serverId).toBe('lsp');
    expect(catalogs[0]?.status).toBe('connected');
    expect(catalogs[0]?.tools.map((tool) => tool.name)).toContain('goto_definition');
    expect(poolMock.withOperationRetryMock).not.toHaveBeenCalled();
  });

  it('filters disabled tools from virtual builtin MCP catalogs and retry counts', async () => {
    setUserMcpServers([
      {
        id: 'codegraph',
        name: 'codegraph',
        transport: 'stdio',
        command: 'openawork-virtual-codegraph',
        enabled: true,
        builtin: true,
        disabledTools: ['codegraph_status'],
      },
    ]);

    const catalogs = await listMcpToolsForUser(USER_ID, { serverId: 'codegraph' });
    const toolNames = catalogs[0]?.tools.map((tool) => tool.name) ?? [];
    const retryResult = await retryMcpConnectionForUser(USER_ID, 'codegraph');

    expect(catalogs[0]?.status).toBe('connected');
    expect(toolNames).not.toContain('codegraph_status');
    expect(toolNames).toContain('codegraph_search');
    expect(retryResult.status).toBe('connected');
    expect(retryResult.toolCount).toBe(toolNames.length);
    expect(poolMock.withOperationRetryMock).not.toHaveBeenCalled();
  });

  it('honors user overrides of virtual builtin ids instead of forcing the virtual bridge', async () => {
    setUserMcpServers([
      {
        id: 'codegraph',
        name: 'custom-codegraph',
        transport: 'sse',
        url: 'https://example.test/codegraph-mcp',
        enabled: true,
      },
    ]);
    poolMock.withOperationRetryMock.mockImplementation(async (_userId, _poolKey, _ref, op) => {
      const fakeAdapter = {
        listTools: vi.fn(async () => [{ name: 'remote_codegraph_search' }]),
      };
      return op(fakeAdapter as unknown as never, 'codegraph');
    });

    const result = await retryMcpConnectionForUser(USER_ID, 'codegraph');

    expect(result.status).toBe('connected');
    expect(result.toolCount).toBe(1);
    expect(poolMock.disconnectUserConnectionMock).toHaveBeenCalledTimes(1);
    expect(poolMock.withOperationRetryMock).toHaveBeenCalledTimes(1);
  });

  it('writes the tool catalog snapshot on success and clears it on failure', async () => {
    setUserMcpServers([STDIO_BASE]);
    const poolKey = getMcpPoolKey({ ...STDIO_BASE });

    // 1) First retry succeeds → cache MUST be populated.
    poolMock.withOperationRetryMock.mockImplementationOnce(async (_userId, _poolKey, _ref, op) => {
      const fakeAdapter = {
        listTools: vi.fn(async () => [{ name: 'read_file' }, { name: 'write_file' }]),
      };
      return op(fakeAdapter as unknown as never, 'fs');
    });
    const ok = await retryMcpConnectionForUser(USER_ID, 'fs');
    expect(ok.status).toBe('connected');
    expect(getCatalogSnapshot(USER_ID, poolKey)).toEqual([
      { name: 'read_file' },
      { name: 'write_file' },
    ]);

    // 2) Second retry fails → cache MUST be cleared so a future
    //    `listMcpToolsForSession` reader doesn't surface the stale
    //    success-snapshot as if the server were still connected.
    poolMock.withOperationRetryMock.mockRejectedValueOnce(new Error('connection lost'));
    const fail = await retryMcpConnectionForUser(USER_ID, 'fs');
    expect(fail.status).toBe('error');
    expect(getCatalogSnapshot(USER_ID, poolKey)).toBeNull();
  });

  it('does NOT touch the catalog cache for disabled servers', () => {
    setUserMcpServers([{ ...STDIO_BASE, enabled: false }]);
    const poolKey = getMcpPoolKey({ ...STDIO_BASE, enabled: false });

    // Pre-seed cache with whatever was there from a previous lifetime
    // (e.g. user enabled, connected, then disabled). We are
    // deliberately NOT clearing here — the disabled short-circuit
    // path doesn't run any pool ops, so it has no business
    // mutating the catalog state either.
    const STALE_TOOL = { name: 'stale', description: '', inputSchema: {} as never };
    setCatalogSnapshot(USER_ID, poolKey, 'fs', [STALE_TOOL]);

    return retryMcpConnectionForUser(USER_ID, 'fs').then((result) => {
      expect(result.status).toBe('disabled');
      // Snapshot survives — stale data is the existing
      // `enabled: false` semantics, retry doesn't claim to
      // garbage-collect it.
      expect(getCatalogSnapshot(USER_ID, poolKey)).toEqual([STALE_TOOL]);
    });
  });

  it('works for built-in MCPs (no user override needed)', async () => {
    // No user_settings row at all — the runtime should still find
    // `websearch` via `mergeBuiltinAndConfiguredMcps`.
    poolMock.withOperationRetryMock.mockImplementation(async (_userId, _poolKey, _ref, op) => {
      const fakeAdapter = {
        listTools: vi.fn(async () => [{ name: 'web_search_exa' }]),
      };
      return op(fakeAdapter as unknown as never, 'websearch');
    });

    const result = await retryMcpConnectionForUser(USER_ID, 'websearch');

    expect(result.status).toBe('connected');
    expect(result.toolCount).toBe(1);
  });
});

describe('isMcpServerConnectedForUser', () => {
  beforeEach(() => {
    dbMock.rows.clear();
    poolMock.resetSpies();
  });

  it('returns false for disabled servers without consulting the pool', () => {
    poolMock.isConnectedMock.mockReturnValue(true); // would lie; we shouldn't ask
    const result = isMcpServerConnectedForUser(USER_ID, { ...STDIO_BASE, enabled: false });
    expect(result).toBe(false);
    expect(poolMock.isConnectedMock).not.toHaveBeenCalled();
  });

  it('returns the pool answer for enabled servers (peek-only)', () => {
    poolMock.isConnectedMock.mockReturnValue(true);
    expect(isMcpServerConnectedForUser(USER_ID, STDIO_BASE)).toBe(true);

    poolMock.isConnectedMock.mockReturnValue(false);
    expect(isMcpServerConnectedForUser(USER_ID, STDIO_BASE)).toBe(false);

    // No connection attempts were made — purely peek.
    expect(poolMock.disconnectUserConnectionMock).not.toHaveBeenCalled();
    expect(poolMock.withOperationRetryMock).not.toHaveBeenCalled();
  });
});

describe('callMcpToolForSession virtual builtins', () => {
  beforeEach(() => {
    dbMock.rows.clear();
    poolMock.resetSpies();
  });

  it('routes lsp virtual MCP calls through the in-process bridge without stdio pool usage', async () => {
    const result = await callMcpToolForSession('session-1', {
      serverId: 'lsp',
      toolName: 'status',
      arguments: {},
    });

    expect(result.serverId).toBe('lsp');
    expect(result.toolName).toBe('status');
    expect(result.content[0]?.type).toBe('text');
    expect(result.content[0]?.text).toContain('servers');
    expect(poolMock.withOperationRetryMock).not.toHaveBeenCalled();
  });
});
