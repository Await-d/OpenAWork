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
  loadConfiguredMcpServersForUser,
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
    builtinKind: server.builtinKind,
    enabled: server.enabled,
    headers: server.headers,
    disabledTools: server.disabledTools,
    source: server.source,
  }));
  dbMock.rows.set(dbMock.keyOf(USER_ID, 'mcp_servers'), JSON.stringify(userServers));
}

function setRawUserMcpServers(servers: readonly unknown[]): void {
  dbMock.rows.set(dbMock.keyOf(USER_ID, 'mcp_servers'), JSON.stringify(servers));
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

  it('merges virtual builtin management patches onto the runtime virtual builtin', async () => {
    setUserMcpServers([
      {
        id: 'codegraph',
        name: 'codegraph',
        transport: 'stdio',
        enabled: true,
        builtin: true,
        source: 'system',
        disabledTools: ['codegraph_status'],
      },
    ]);

    const catalogs = await listMcpToolsForUser(USER_ID, { serverId: 'codegraph' });
    const toolNames = catalogs[0]?.tools.map((tool) => tool.name) ?? [];

    expect(catalogs[0]?.status).toBe('connected');
    expect(toolNames).not.toContain('codegraph_status');
    expect(toolNames).toContain('codegraph_search');
    expect(poolMock.withOperationRetryMock).not.toHaveBeenCalled();
  });

  it('normalizes stale persisted protected builtin rows before runtime use', async () => {
    setRawUserMcpServers([
      {
        id: 'codegraph',
        name: 'stale-codegraph',
        type: 'stdio',
        source: 'user',
        command: 'malicious-fake-command',
        url: 'https://fake.invalid/codegraph',
        enabled: false,
        disabledTools: ['codegraph_status', 'codegraph_status'],
      },
      {
        id: 'omo',
        name: 'stale-omo',
        transport: 'stdio',
        command: 'malicious-omo-command',
        url: 'https://fake.invalid/omo',
        enabled: true,
      },
      {
        id: 'local-user-stdio',
        name: 'Local user stdio',
        transport: 'stdio',
        source: 'user',
        command: 'node',
        args: ['server.js'],
        enabled: true,
      },
      {
        id: 'remote-user-sse',
        name: 'Remote user sse',
        transport: 'sse',
        source: 'user',
        url: 'https://example.com/mcp',
        enabled: true,
      },
    ]);

    const servers = loadConfiguredMcpServersForUser(USER_ID);
    const codegraph = servers.find((server) => server.id === 'codegraph');
    const omo = servers.find((server) => server.id === 'omo');
    const localUser = servers.find((server) => server.id === 'local-user-stdio');
    const remoteUser = servers.find((server) => server.id === 'remote-user-sse');

    expect(codegraph).toMatchObject({
      id: 'codegraph',
      name: 'codegraph',
      transport: 'stdio',
      builtin: true,
      builtinKind: 'virtual',
      source: 'user',
      enabled: false,
      disabledTools: ['codegraph_status'],
    });
    expect(codegraph?.command).toBeUndefined();
    expect(codegraph?.url).toBeUndefined();
    expect(omo).toMatchObject({
      id: 'omo',
      name: 'omo',
      transport: 'stdio',
      builtin: true,
      builtinKind: 'adapter',
      source: 'system',
      enabled: true,
    });
    expect(omo?.command).toBeUndefined();
    expect(omo?.url).toBeUndefined();
    expect(localUser).toMatchObject({
      id: 'local-user-stdio',
      command: 'node',
      args: ['server.js'],
      source: 'user',
    });
    expect(remoteUser).toMatchObject({
      id: 'remote-user-sse',
      url: 'https://example.com/mcp',
      source: 'user',
    });
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
    const result = await retryMcpConnectionForUser(USER_ID, 'open_websearch');

    expect(result.status).toBe('connected');
    // builtin-mcps.ts 已把 open_websearch 的 `search` 默认收口
    // （联网搜索由网关原生 websearch 工具承担），只剩取正文 / README。
    expect(result.toolCount).toBe(2);
    expect(result.error).toBeUndefined();
    expect(poolMock.withOperationRetryMock).not.toHaveBeenCalled();
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

describe('getMcpPoolKey config fingerprint', () => {
  it('rotates the pool key when auth headers change', () => {
    const withoutAuth = getMcpPoolKey({ ...STDIO_BASE });
    const withAuth = getMcpPoolKey({
      ...STDIO_BASE,
      headers: { authorization: 'Bearer fixed' },
    });

    expect(withAuth).not.toBe(withoutAuth);
  });

  it('rotates the pool key when the OAuth config changes', () => {
    const sseBase: ConfiguredMCPServer = {
      id: 'remote',
      name: 'remote',
      transport: 'sse',
      url: 'https://example.com/mcp',
      enabled: true,
    };
    const withoutOauth = getMcpPoolKey(sseBase);
    const withOauth = getMcpPoolKey({
      ...sseBase,
      oauth: { clientId: 'client-1', scope: 'read' },
    });

    expect(withOauth).not.toBe(withoutOauth);
  });

  it('produces a stable key for an unchanged config', () => {
    const first = getMcpPoolKey({ ...STDIO_BASE, headers: { a: 'b' } });
    const second = getMcpPoolKey({ ...STDIO_BASE, headers: { a: 'b' } });

    expect(second).toBe(first);
  });
});

/**
 * 回归：`disabledTools` 必须在**目录**与**执行**两侧语义一致。
 *
 * 修复前 pool 路径（含 `tools/list_changed` 推送刷新）写入快照时不过滤，
 * 而 `callMcpToolForSession` 在调用时拒绝 —— 模型因此会看到一个永远调不通的
 * 工具，白白消耗一次调用（与排障包里 `tool_invoke` 反复失败同一类问题）。
 * 现在过滤统一收敛在 `setCatalogSnapshot` 的写入入口。
 */
describe('catalog snapshot —— disabledTools 写入即过滤', () => {
  /** MCPToolDef 的最小合法形状（与同文件其它用例保持一致）。 */
  const toolDef = (name: string) => ({ name, description: '', inputSchema: {} as never });

  beforeEach(() => {
    dbMock.rows.clear();
    poolMock.resetSpies();
    clearAllCatalogSnapshots();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('推送刷新写入的快照排除被禁用的工具', () => {
    const configured: ConfiguredMCPServer = { ...STDIO_BASE, disabledTools: ['write_file'] };
    setUserMcpServers([configured]);
    const poolKey = getMcpPoolKey(configured);

    // 模拟 pool 的 `tools/list_changed` 推送路径：拿到的是服务端全量工具。
    setCatalogSnapshot(USER_ID, poolKey, 'fs', [toolDef('read_file'), toolDef('write_file')]);

    expect(getCatalogSnapshot(USER_ID, poolKey)).toEqual([toolDef('read_file')]);
  });

  it('没有 disabledTools 配置时快照原样保留', () => {
    const configured: ConfiguredMCPServer = { ...STDIO_BASE };
    setUserMcpServers([configured]);
    const poolKey = getMcpPoolKey(configured);

    setCatalogSnapshot(USER_ID, poolKey, 'fs', [toolDef('read_file'), toolDef('write_file')]);

    expect(getCatalogSnapshot(USER_ID, poolKey)).toEqual([
      toolDef('read_file'),
      toolDef('write_file'),
    ]);
  });

  it('禁用的工具不在目录返回值里（不是只在调用时拒绝）', async () => {
    const configured: ConfiguredMCPServer = { ...STDIO_BASE, disabledTools: ['write_file'] };
    setUserMcpServers([configured]);
    poolMock.withOperationRetryMock.mockImplementation(async (_userId, _poolKey, _ref, op) => {
      const fakeAdapter = {
        listTools: vi.fn(async () => [toolDef('read_file'), toolDef('write_file')]),
      };
      return op(fakeAdapter as unknown as never, 'fs');
    });

    const catalogs = await listMcpToolsForUser(USER_ID, { serverId: 'fs' });
    const tools = catalogs[0]?.tools ?? [];
    expect(tools.map((entry) => entry.name)).toEqual(['read_file']);
  });
});

/**
 * 回归（2026-10-12 线上排障）：`tool_invoke` 的 `serverId` 是模型的入参，模型
 * 把**展示名**当 id 传了（`Open WebSearch`，真实 id 是 `open_websearch`），
 * 旧文案只有 `Configured MCP server not found: Open WebSearch` —— 既不给可用
 * id，也不指出「你传的是名称」，调用方只能原样重试。现在必须能自纠正。
 */
describe('callMcpToolForSession — 未知 serverId 的可自我纠正提示', () => {
  beforeEach(() => {
    dbMock.rows.clear();
    poolMock.resetSpies();
    clearAllCatalogSnapshots();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('传入内置 server 的展示名时，直接给出正确 id', async () => {
    await expect(
      callMcpToolForSession('session-1', { serverId: 'Open WebSearch', toolName: 'search' }),
    ).rejects.toThrow(/正确 id 是 "open_websearch"/);
  });

  it('无论是否命中展示名，都附上可用 id 列表', async () => {
    const error = await callMcpToolForSession('session-1', {
      serverId: 'does-not-exist',
      toolName: 'search',
    }).then(
      () => null,
      (err: unknown) => err as Error,
    );

    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toContain('Configured MCP server not found: does-not-exist');
    expect(error?.message).toContain('可用 id：');
    // 内置 MCP 始终在可用集合里，模型据此即可改对。
    expect(error?.message).toContain('open_websearch');
  });

  it('用户自定义 server 也参与展示名反查', async () => {
    setUserMcpServers([{ ...STDIO_BASE, id: 'my-fs', name: 'My Filesystem' }]);

    await expect(
      callMcpToolForSession('session-1', { serverId: 'My Filesystem', toolName: 'read_file' }),
    ).rejects.toThrow(/正确 id 是 "my-fs"/);
  });
});

/**
 * 快照优先读路径（2026-10-12 性能排障）：连接池空闲 5 分钟即清理连接，
 * 此前空闲后的第一次 `listMcpToolsForUser` 要在请求路径上真实重连每个
 * server（stdio spawn / SSE 握手，单 server 握手超时 30s）。现在命中
 * 快照时必须立即返回缓存目录，把重连挪到后台刷新。
 */
describe('listMcpToolsForUser — 快照优先读路径', () => {
  beforeEach(() => {
    dbMock.rows.clear();
    poolMock.resetSpies();
    clearAllCatalogSnapshots();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('空闲清理后命中快照时立即返回缓存目录，并在后台重连刷新', async () => {
    setUserMcpServers([STDIO_BASE]);
    const poolKey = getMcpPoolKey({ ...STDIO_BASE });
    const CACHED_TOOLS = [{ name: 'cached_tool', description: '', inputSchema: {} as never }];
    setCatalogSnapshot(USER_ID, poolKey, 'fs', CACHED_TOOLS);

    poolMock.isConnectedMock.mockReturnValue(false);
    // 后台刷新挂起不返回——若实现错误地 await 了它，本测试会超时。
    let resolveRefresh!: (tools: Array<{ name: string }>) => void;
    poolMock.withOperationRetryMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRefresh = resolve;
      }),
    );

    const catalogs = await listMcpToolsForUser(USER_ID, { serverId: 'fs' });

    expect(catalogs).toHaveLength(1);
    expect(catalogs[0]?.status).toBe('connected');
    expect(catalogs[0]?.tools).toEqual(CACHED_TOOLS);
    // 后台刷新已排队（去重键只放行一个在途刷新）。
    expect(poolMock.withOperationRetryMock).toHaveBeenCalledTimes(1);

    resolveRefresh([{ name: 'fresh_tool' }]);
    await vi.waitFor(() => {
      expect(getCatalogSnapshot(USER_ID, poolKey)).toEqual([{ name: 'fresh_tool' }]);
    });
  });

  it('同一 server 的并发读取只触发一次后台刷新', async () => {
    setUserMcpServers([STDIO_BASE]);
    setCatalogSnapshot(USER_ID, getMcpPoolKey({ ...STDIO_BASE }), 'fs', []);

    poolMock.isConnectedMock.mockReturnValue(false);
    poolMock.withOperationRetryMock.mockResolvedValue([]);

    const [first, second] = await Promise.all([
      listMcpToolsForUser(USER_ID, { serverId: 'fs' }),
      listMcpToolsForUser(USER_ID, { serverId: 'fs' }),
    ]);

    expect(first[0]?.status).toBe('connected');
    expect(second[0]?.status).toBe('connected');
    expect(poolMock.withOperationRetryMock).toHaveBeenCalledTimes(1);
  });

  it('后台刷新失败时丢弃快照，下次读取回到真实连接路径', async () => {
    setUserMcpServers([STDIO_BASE]);
    const poolKey = getMcpPoolKey({ ...STDIO_BASE });
    setCatalogSnapshot(USER_ID, poolKey, 'fs', [
      { name: 'cached_tool', description: '', inputSchema: {} as never },
    ]);

    poolMock.isConnectedMock.mockReturnValue(false);
    poolMock.withOperationRetryMock.mockRejectedValueOnce(new Error('connection lost'));

    // 请求本身立即拿到缓存目录；后台刷新失败在稍后清理快照。
    const staleCatalogs = await listMcpToolsForUser(USER_ID, { serverId: 'fs' });
    expect(staleCatalogs[0]?.tools).toEqual([
      { name: 'cached_tool', description: '', inputSchema: {} },
    ]);

    await vi.waitFor(() => {
      expect(getCatalogSnapshot(USER_ID, poolKey)).toBeNull();
    });

    // 快照已被丢弃 → 下一次读取必须走 withOperationRetry 真实连接。
    poolMock.withOperationRetryMock.mockImplementation(async (_u, _k, _r, op) => {
      const fakeAdapter = { listTools: vi.fn(async () => [{ name: 'read_file' }]) };
      return op(fakeAdapter as unknown as never, 'fs');
    });
    const catalogs = await listMcpToolsForUser(USER_ID, { serverId: 'fs' });

    expect(catalogs[0]?.status).toBe('connected');
    expect(catalogs[0]?.tools).toEqual([{ name: 'read_file' }]);
    expect(poolMock.withOperationRetryMock).toHaveBeenCalledTimes(2);
  });

  it('无快照（冷启动）时仍在请求路径上真实连接', async () => {
    setUserMcpServers([STDIO_BASE]);
    poolMock.isConnectedMock.mockReturnValue(false);
    poolMock.withOperationRetryMock.mockImplementation(async (_u, _k, _r, op) => {
      const fakeAdapter = { listTools: vi.fn(async () => [{ name: 'read_file' }]) };
      return op(fakeAdapter as unknown as never, 'fs');
    });

    const catalogs = await listMcpToolsForUser(USER_ID, { serverId: 'fs' });

    expect(catalogs[0]?.status).toBe('connected');
    expect(catalogs[0]?.tools).toEqual([{ name: 'read_file' }]);
    expect(poolMock.withOperationRetryMock).toHaveBeenCalledTimes(1);
  });

  it('池内连接仍存活时不读快照，照常走 listTools 并回写快照', async () => {
    setUserMcpServers([STDIO_BASE]);
    const poolKey = getMcpPoolKey({ ...STDIO_BASE });
    setCatalogSnapshot(USER_ID, poolKey, 'fs', [
      { name: 'cached_tool', description: '', inputSchema: {} as never },
    ]);

    poolMock.isConnectedMock.mockReturnValue(true);
    poolMock.withOperationRetryMock.mockImplementation(async (_u, _k, _r, op) => {
      const fakeAdapter = { listTools: vi.fn(async () => [{ name: 'fresh_tool' }]) };
      return op(fakeAdapter as unknown as never, 'fs');
    });

    const catalogs = await listMcpToolsForUser(USER_ID, { serverId: 'fs' });

    expect(catalogs[0]?.tools).toEqual([{ name: 'fresh_tool' }]);
    expect(getCatalogSnapshot(USER_ID, poolKey)).toEqual([{ name: 'fresh_tool' }]);
  });
});
