/**
 * `mcp_manage_servers` 工具的核心回归。
 *
 * 覆盖：工具契约（list/add/update/remove/enable/disable）、内置保护语义、
 * 密钥不回显 / 不落库、写后探活、以及 team / cron / channel 会话守卫。
 *
 * 只 mock 外部 I/O 边界（db / 连接池），MCP runtime 与 settings schema 走真实实现，
 * 保证「工具写入的配置 = 设置页 / runtime 读取的配置」这一同规性由真实链路验证。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => {
  const rows = new Map<string, string>();
  const keyOf = (userId: string, key: string): string => `${userId}::${key}`;
  let sessionRow: Record<string, unknown> | null = {
    user_id: 'user-1',
    metadata_json: '{}',
    role_layer: null,
    team_parent_session_id: null,
    handoff_state: null,
  };

  const inferKeyFromSql = (sql: string, params: readonly unknown[]): string | undefined => {
    if (sql.includes("'mcp_servers'")) return 'mcp_servers';
    return typeof params[1] === 'string' ? params[1] : undefined;
  };

  return {
    rows,
    keyOf,
    setSessionRow(row: Record<string, unknown> | null): void {
      sessionRow = row;
    },
    sqliteGetMock: vi.fn((sql: string, params: readonly unknown[] = []) => {
      if (sql.includes('FROM sessions')) {
        return sessionRow ?? undefined;
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
      // upsert SQL 把 key 写成字面量，绑定参数为 [userId, value]；兼容 [userId, key, value]。
      const value = params.length > 2 ? params[2] : params[1];
      rows.set(keyOf(userId, key), value as string);
      return { lastInsertRowid: 1, changes: 1 };
    }),
  };
});

interface FakeAdapter {
  listTools(serverId: string): Promise<Array<{ name: string; description: string }>>;
}

const poolMock = vi.hoisted(() => ({
  disconnectUserConnectionMock: vi.fn(async () => undefined),
  withOperationRetryMock: vi.fn(
    async (
      _userId: string,
      _poolKey: string,
      serverRef: { id: string },
      operation: (adapter: FakeAdapter, serverId: string) => Promise<unknown>,
    ): Promise<unknown> =>
      operation(
        { listTools: async () => [{ name: 'echo', description: 'echo tool' }] },
        serverRef.id,
      ),
  ),
}));

vi.mock('../../infra/db.js', () => ({
  WORKSPACE_ROOT: '/home/await',
  WORKSPACE_ROOTS: ['/home/await'],
  WORKSPACE_ACCESS_RESTRICTED: false,
  sqliteAll: vi.fn(() => []),
  sqliteGet: dbMock.sqliteGetMock,
  sqliteRun: dbMock.sqliteRunMock,
}));

vi.mock('../../skill/skill-mcp-connection-pool.js', () => {
  const fakePool = {
    disconnectUserConnection: poolMock.disconnectUserConnectionMock,
    withOperationRetry: poolMock.withOperationRetryMock,
    isConnected: vi.fn(() => false),
    onToolListChanged: () => () => undefined,
  };
  return { mcpConnectionPool: fakePool, skillMcpPool: fakePool };
});

import {
  MCP_MANAGE_SERVERS_TOOL_NAME,
  mcpManageServersInputSchema,
  mcpManageServersToolDefinition,
  resolveMcpManageSessionDenial,
  runMcpManageServersTool,
} from '../../mcp/mcp-admin-tools.js';
import { loadConfiguredMcpServersForUser } from '../../mcp/mcp-runtime.js';

const USER_ID = 'user-1';
const SESSION_ID = 'session-1';

const DEFAULT_SESSION_ROW: Record<string, unknown> = {
  user_id: USER_ID,
  metadata_json: '{}',
  role_layer: null,
  team_parent_session_id: null,
  handoff_state: null,
};

function run(input: Record<string, unknown>): Promise<string> {
  return runMcpManageServersTool({
    userId: USER_ID,
    sessionId: SESSION_ID,
    input: mcpManageServersInputSchema.parse(input),
  });
}

function readStored(): Array<Record<string, unknown>> {
  const raw = dbMock.rows.get(dbMock.keyOf(USER_ID, 'mcp_servers'));
  return raw ? (JSON.parse(raw) as Array<Record<string, unknown>>) : [];
}

function setStored(servers: readonly unknown[]): void {
  dbMock.rows.set(dbMock.keyOf(USER_ID, 'mcp_servers'), JSON.stringify(servers));
}

beforeEach(() => {
  dbMock.rows.clear();
  dbMock.setSessionRow({ ...DEFAULT_SESSION_ROW });
  poolMock.disconnectUserConnectionMock.mockClear();
  poolMock.withOperationRetryMock.mockClear();
  delete process.env['EXA_API_KEY'];
});

describe('mcp_manage_servers · 工具契约', () => {
  it('工具名常量与定义一致（防漂移）', () => {
    expect(MCP_MANAGE_SERVERS_TOOL_NAME).toBe('mcp_manage_servers');
    expect(mcpManageServersToolDefinition.name).toBe(MCP_MANAGE_SERVERS_TOOL_NAME);
  });

  it('输入 schema：list 免参；add 需要 server；remove 需要 serverId；sse 需要 url', () => {
    expect(mcpManageServersInputSchema.safeParse({ action: 'list' }).success).toBe(true);
    expect(mcpManageServersInputSchema.safeParse({ action: 'add' }).success).toBe(false);
    expect(mcpManageServersInputSchema.safeParse({ action: 'remove' }).success).toBe(false);
    expect(
      mcpManageServersInputSchema.safeParse({
        action: 'add',
        server: { name: 'x', transport: 'sse' },
      }).success,
    ).toBe(false);
    expect(
      mcpManageServersInputSchema.safeParse({
        action: 'add',
        server: { name: 'x', transport: 'stdio', command: 'npx' },
      }).success,
    ).toBe(true);
  });
});

describe('mcp_manage_servers · list', () => {
  it('返回合并列表，且不包含 url / headers / env 等潜在机密字段', async () => {
    process.env['EXA_API_KEY'] = 'exa-super-secret';
    const output = await run({ action: 'list' });
    expect(output).not.toContain('exa-super-secret');
    expect(output).not.toContain('https://mcp.exa.ai');

    const parsed = JSON.parse(output) as { servers: Array<Record<string, unknown>> };
    const ids = parsed.servers.map((server) => server['id']);
    expect(ids).toContain('websearch');
    expect(ids).toContain('grep_app');
    for (const server of parsed.servers) {
      expect(server).not.toHaveProperty('url');
      expect(server).not.toHaveProperty('headers');
      expect(server).not.toHaveProperty('env');
    }
  });
});

describe('mcp_manage_servers · add / update', () => {
  it('add：写入 sse 配置、探活并让 runtime 立即可见；用户条目不带 source', async () => {
    const output = await run({
      action: 'add',
      server: {
        id: 'github',
        name: 'GitHub',
        transport: 'sse',
        url: 'https://mcp.example.com/sse',
      },
    });

    const parsed = JSON.parse(output) as {
      ok: boolean;
      serverId: string;
      connect: { status: string; toolCount: number };
    };
    expect(parsed).toMatchObject({ ok: true, serverId: 'github' });
    expect(parsed.connect.status).toBe('connected');
    expect(parsed.connect.toolCount).toBe(1);

    expect(readStored()).toEqual([
      {
        id: 'github',
        name: 'GitHub',
        transport: 'sse',
        url: 'https://mcp.example.com/sse',
        enabled: true,
      },
    ]);
    expect(loadConfiguredMcpServersForUser(USER_ID).map((server) => server.id)).toContain('github');
  });

  it('add：stdio + env 落库；缺省 id 由 name 派生', async () => {
    const output = await run({
      action: 'add',
      server: {
        name: 'My FS',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', 'fs-mcp'],
        env: { TOKEN: 't-1' },
      },
    });

    const parsed = JSON.parse(output) as { serverId: string };
    expect(parsed.serverId).toBe('my-fs');
    expect(readStored()[0]).toMatchObject({
      id: 'my-fs',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'fs-mcp'],
      env: { TOKEN: 't-1' },
    });
  });

  it('update：未提供的 args / env / enabled 保留原值', async () => {
    setStored([
      {
        id: 'fs',
        name: 'FS',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', 'fs-mcp'],
        env: { TOKEN: 't-1' },
        enabled: false,
      },
    ]);

    await run({
      action: 'update',
      server: { id: 'fs', name: 'FS 2', transport: 'stdio', command: 'npx' },
    });

    expect(readStored()[0]).toMatchObject({
      id: 'fs',
      name: 'FS 2',
      args: ['-y', 'fs-mcp'],
      env: { TOKEN: 't-1' },
      enabled: false,
    });
  });

  it('add：拒绝覆盖系统内置 MCP 端点', async () => {
    await expect(
      run({
        action: 'add',
        server: {
          id: 'websearch',
          name: 'websearch',
          transport: 'sse',
          url: 'https://evil.example.com/mcp',
        },
      }),
    ).rejects.toThrow(/系统内置/);
    expect(readStored()).toEqual([]);
  });

  it('update：受保护内置（virtual / adapter）拒绝端点字段', async () => {
    await expect(
      run({
        action: 'update',
        serverId: 'lsp',
        server: { id: 'lsp', name: 'LSP', transport: 'sse', url: 'https://evil.example.com/mcp' },
      }),
    ).rejects.toThrow(/受保护/);
    expect(readStored()).toEqual([]);
  });

  it('连接失败不阻塞保存：配置已写入，错误原样回传', async () => {
    poolMock.withOperationRetryMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const output = await run({
      action: 'add',
      server: { id: 'down', name: 'Down', transport: 'sse', url: 'https://down.example.com' },
    });

    const parsed = JSON.parse(output) as {
      ok: boolean;
      connect: { status: string; error?: string };
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.connect.status).toBe('error');
    expect(parsed.connect.error).toContain('ECONNREFUSED');
    expect(readStored()).toHaveLength(1);
  });

  it('连接错误里的 URL query 会被脱敏（不把密钥带回会话）', async () => {
    poolMock.withOperationRetryMock.mockRejectedValueOnce(
      new Error('fetch failed for https://mcp.example.com/sse?key=super-secret'),
    );

    const output = await run({
      action: 'add',
      server: {
        id: 'leaky',
        name: 'Leaky',
        transport: 'sse',
        url: 'https://mcp.example.com/sse?key=super-secret',
      },
    });

    expect(output).not.toContain('super-secret');
    expect(output).toContain('https://mcp.example.com/sse');
  });
});

describe('mcp_manage_servers · enable / disable', () => {
  it('disable：系统内置写完整覆盖条目，不持久化密钥 header', async () => {
    process.env['EXA_API_KEY'] = 'exa-super-secret';

    const output = await run({ action: 'disable', serverId: 'websearch' });

    const parsed = JSON.parse(output) as { connect: { status: string } };
    expect(parsed.connect.status).toBe('disabled');

    const stored = readStored();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      id: 'websearch',
      enabled: false,
      url: 'https://mcp.exa.ai/mcp?tools=web_search_exa',
    });
    expect(JSON.stringify(stored)).not.toContain('exa-super-secret');
    expect(JSON.stringify(stored)).not.toContain('headers');

    const websearch = loadConfiguredMcpServersForUser(USER_ID).find(
      (server) => server.id === 'websearch',
    );
    expect(websearch?.enabled).toBe(false);
    expect(poolMock.disconnectUserConnectionMock).toHaveBeenCalled();
  });

  it('disable / enable：受保护内置只落管理字段（无 command）', async () => {
    await run({ action: 'disable', serverId: 'codegraph' });
    const stored = readStored();
    expect(stored[0]).toMatchObject({
      id: 'codegraph',
      transport: 'stdio',
      builtin: true,
      builtinKind: 'virtual',
      source: 'system',
      enabled: false,
    });
    expect(stored[0]).not.toHaveProperty('command');

    await run({ action: 'enable', serverId: 'codegraph' });
    expect(readStored()[0]).toMatchObject({ enabled: true });
  });

  it('enable / disable：未知 serverId 报错', async () => {
    await expect(run({ action: 'enable', serverId: 'nope' })).rejects.toThrow(/未找到/);
  });
});

describe('mcp_manage_servers · remove', () => {
  it('remove：删除用户条目', async () => {
    setStored([{ id: 'fs', name: 'FS', transport: 'stdio', command: 'npx', enabled: true }]);

    const output = await run({ action: 'remove', serverId: 'fs' });
    expect(JSON.parse(output)).toMatchObject({ removed: true, builtinRestored: false });
    expect(readStored()).toEqual([]);

    await expect(run({ action: 'remove', serverId: 'nope' })).rejects.toThrow(/未找到/);
  });

  it('remove：内置覆盖被移除后恢复默认', async () => {
    // grep_app 默认启用，能直接验证「移除覆盖 → 回到内置默认」。
    await run({ action: 'disable', serverId: 'grep_app' });
    expect(
      loadConfiguredMcpServersForUser(USER_ID).find((server) => server.id === 'grep_app')?.enabled,
    ).toBe(false);

    const output = await run({ action: 'remove', serverId: 'grep_app' });
    expect(JSON.parse(output)).toMatchObject({ removed: true, builtinRestored: true });

    const restored = loadConfiguredMcpServersForUser(USER_ID).find(
      (server) => server.id === 'grep_app',
    );
    expect(restored?.enabled).toBe(true);
    expect(restored?.builtin).toBe(true);
  });

  it('remove：无用户覆盖的内置项给出说明而非报错', async () => {
    const output = await run({ action: 'remove', serverId: 'grep_app' });
    expect(JSON.parse(output)).toMatchObject({ removed: false });
    expect(output).toContain('无需移除');
  });
});

describe('mcp_manage_servers · 会话守卫', () => {
  it('team 会话（role_layer + 父会话）拒绝所有动作', async () => {
    dbMock.setSessionRow({
      metadata_json: '{}',
      role_layer: 'executor',
      team_parent_session_id: 'parent-1',
      handoff_state: 'running',
    });
    await expect(run({ action: 'list' })).rejects.toThrow(/团队会话/);
  });

  it('cron / channel 会话拒绝', async () => {
    dbMock.setSessionRow({
      metadata_json: JSON.stringify({ source: 'cron' }),
      role_layer: null,
      team_parent_session_id: null,
      handoff_state: null,
    });
    await expect(run({ action: 'list' })).rejects.toThrow(/定时任务/);

    dbMock.setSessionRow({
      metadata_json: JSON.stringify({ source: 'channel' }),
      role_layer: null,
      team_parent_session_id: null,
      handoff_state: null,
    });
    await expect(run({ action: 'list' })).rejects.toThrow(/消息渠道/);
  });

  it('resolveMcpManageSessionDenial：team 元数据 / 普通会话 / 缺行', () => {
    expect(
      resolveMcpManageSessionDenial({
        metadata_json: JSON.stringify({ teamWorkspaceId: 'ws-1' }),
        role_layer: null,
        team_parent_session_id: null,
        handoff_state: null,
      }),
    ).toContain('团队会话');
    expect(
      resolveMcpManageSessionDenial({
        metadata_json: '{}',
        role_layer: null,
        team_parent_session_id: null,
        handoff_state: null,
      }),
    ).toBeNull();
    expect(resolveMcpManageSessionDenial(null)).toContain('已拒绝');
  });
});
