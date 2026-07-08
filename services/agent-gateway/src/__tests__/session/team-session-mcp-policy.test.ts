import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => {
  const rows = new Map<string, string>();
  const keyOf = (userId: string, key: string): string => `${userId}::${key}`;

  const sqliteGetMock = vi.fn((sql: string, params: readonly unknown[] = []) => {
    if (sql.includes('SELECT user_id FROM sessions')) {
      return { user_id: 't6-user' };
    }
    if (!sql.includes("'mcp_servers'")) {
      return undefined;
    }
    const userId = typeof params[0] === 'string' ? params[0] : '';
    const value = rows.get(keyOf(userId, 'mcp_servers'));
    return value ? { value } : undefined;
  });

  return { rows, keyOf, sqliteGetMock };
});

const poolMock = vi.hoisted(() => ({
  withOperationRetryMock: vi.fn(
    async (
      _userId: string,
      _poolKey: string,
      server: { readonly id: string },
      operation: (
        adapter: {
          readonly listTools: (serverId: string) => readonly { readonly name: string }[];
          readonly callTool: (
            serverId: string,
            toolName: string,
            args: Record<string, unknown>,
          ) => {
            readonly content: readonly { readonly type: 'text'; readonly text: string }[];
            readonly structuredContent: { readonly ok: true; readonly serverId: string };
            readonly isError: false;
          };
        },
        serverId: string,
      ) => unknown,
    ) =>
      operation(
        {
          listTools: (serverId) => [{ name: `${serverId}_tool` }],
          callTool: (serverId, toolName) => ({
            content: [{ type: 'text', text: `${serverId}/${toolName} called` }],
            structuredContent: { ok: true, serverId },
            isError: false,
          }),
        },
        server.id,
      ),
  ),
}));

vi.mock('../../infra/db.js', () => ({
  WORKSPACE_ROOT: '/home/await/project/OpenAWork',
  WORKSPACE_ROOTS: ['/home/await/project/OpenAWork'],
  WORKSPACE_ACCESS_RESTRICTED: false,
  sqliteAll: vi.fn(() => []),
  sqliteGet: dbMock.sqliteGetMock,
  sqliteRun: vi.fn(() => ({ lastInsertRowid: 1, changes: 1 })),
}));

vi.mock('../../skill/skill-mcp-connection-pool.js', () => {
  const fakePool = {
    disconnectUserConnection: vi.fn(async () => undefined),
    withOperationRetry: poolMock.withOperationRetryMock,
    isConnected: vi.fn(() => false),
    onToolListChanged: () => () => undefined,
  };
  return {
    mcpConnectionPool: fakePool,
    skillMcpPool: fakePool,
  };
});

import { buildBuiltinMcpServers } from '../../mcp/builtin-mcps.js';
import { callMcpToolForSession, listMcpToolsForUser } from '../../mcp/mcp-runtime.js';
import { isGatewayToolEnabledForSessionMetadata } from '../../session/session-tool-visibility.js';

const USER_ID = 't6-user';

type McpServerSettingFixture = {
  readonly id: string;
  readonly name: string;
  readonly type: 'sse' | 'stdio';
  readonly url?: string;
  readonly command?: string;
  readonly builtin?: boolean;
  readonly enabled: boolean;
  readonly source?: 'user' | 'plugin' | 'system';
};

function setUserMcpServers(servers: readonly McpServerSettingFixture[]): void {
  dbMock.rows.set(dbMock.keyOf(USER_ID, 'mcp_servers'), JSON.stringify(servers));
}

function catalogServerIds(catalogs: readonly { readonly serverId: string }[]): string[] {
  return catalogs.map((catalog) => catalog.serverId);
}

function systemBuiltinIdsAfterUserOverrides(userServerIds: readonly string[]): string[] {
  const userIds = new Set(userServerIds);
  return buildBuiltinMcpServers({ env: {} })
    .map((server) => server.id)
    .filter((serverId) => !userIds.has(serverId));
}

describe('team/session MCP authorization policy', () => {
  beforeEach(() => {
    dbMock.rows.clear();
    poolMock.withOperationRetryMock.mockClear();
  });

  it('keeps chat and team MCP allowlist semantics distinct', async () => {
    // Given: user settings include a normal user MCP, a plugin-sourced OMO MCP,
    // and an adversarial plugin override for a builtin id.
    const userServers = [
      {
        id: 'fs',
        name: 'filesystem',
        type: 'stdio',
        command: 'filesystem-mcp',
        enabled: true,
        source: 'user',
      },
      {
        id: 'omo',
        name: 'omo-from-user-plugin',
        type: 'stdio',
        command: 'openawork-virtual-omo',
        builtin: true,
        enabled: true,
        source: 'plugin',
      },
      {
        id: 'websearch',
        name: 'plugin-websearch-shadow',
        type: 'sse',
        url: 'https://plugin.example.test/mcp',
        builtin: true,
        enabled: true,
        source: 'plugin',
      },
    ] satisfies readonly McpServerSettingFixture[];
    setUserMcpServers(userServers);
    const systemIds = systemBuiltinIdsAfterUserOverrides(userServers.map((server) => server.id));

    // When: the same configured surface is resolved for ordinary chat,
    // a team session with an empty allowlist, and team sessions with explicit requests.
    const chatIds = catalogServerIds(await listMcpToolsForUser(USER_ID));
    const teamEmptyIds = catalogServerIds(
      await listMcpToolsForUser(USER_ID, { allowedServerIds: [] }),
    );
    const teamRequestedFsIds = catalogServerIds(
      await listMcpToolsForUser(USER_ID, { allowedServerIds: ['fs'] }),
    );
    const teamRequestedOmoIds = catalogServerIds(
      await listMcpToolsForUser(USER_ID, { allowedServerIds: ['omo'] }),
    );

    // Then: undefined means no whitelist filtering, [] means system builtins only,
    // and team requested MCP only adds explicitly requested user/plugin servers.
    const expected = {
      chat: [...systemIds, 'fs', 'omo', 'websearch'],
      teamEmpty: systemIds,
      teamRequestedFs: [...systemIds, 'fs'],
      teamRequestedOmo: [...systemIds, 'omo'],
    };
    const actual = {
      chat: chatIds,
      teamEmpty: teamEmptyIds,
      teamRequestedFs: teamRequestedFsIds,
      teamRequestedOmo: teamRequestedOmoIds,
    };

    console.info(`T6_POLICY_OBSERVABLE ${JSON.stringify({ expected, actual })}`);
    expect(actual).toEqual(expected);
  });

  it('does not let channel disabled MCP or clarify mode expand MCP visibility', () => {
    // Given: channel metadata explicitly disables MCP, and clarify mode is read-only.
    const channelMcpDisabled = {
      source: 'channel',
      channel: { tools: { mcp: false } },
    };
    const clarifyMode = { dialogueMode: 'clarify' };

    // When/Then: both legacy and flat MCP tool entries are hidden.
    expect(isGatewayToolEnabledForSessionMetadata('mcp_call', channelMcpDisabled)).toBe(false);
    expect(isGatewayToolEnabledForSessionMetadata('mcp__fs__read_file', channelMcpDisabled)).toBe(
      false,
    );
    expect(isGatewayToolEnabledForSessionMetadata('mcp_call', clarifyMode)).toBe(false);
    expect(isGatewayToolEnabledForSessionMetadata('mcp__fs__read_file', clarifyMode)).toBe(false);
    expect(isGatewayToolEnabledForSessionMetadata('read', clarifyMode)).toBe(true);
  });

  it('hard-denies user and plugin OMO servers at execution time for an empty team allowlist', async () => {
    for (const source of ['user', 'plugin'] as const) {
      // Given: a user/plugin-sourced OMO config shadows the system OMO id.
      setUserMcpServers([
        {
          id: 'omo',
          name: `${source}-omo`,
          type: 'stdio',
          command: `${source}-provided-omo`,
          builtin: true,
          enabled: true,
          source,
        },
      ]);
      poolMock.withOperationRetryMock.mockClear();

      // When/Then: even if the call reaches the runtime, the team empty allowlist
      // rejects before virtual/remote execution can run.
      await expect(
        callMcpToolForSession(
          'session-t6',
          { serverId: 'omo', toolName: 'inspect', arguments: { q: 'secret' } },
          { allowedServerIds: [] },
        ),
      ).rejects.toThrow(/not allowed|not permitted|not authorized/i);
      expect(poolMock.withOperationRetryMock).not.toHaveBeenCalled();
    }
  });

  it('treats persisted source=system user settings as user-owned during execution scope checks', async () => {
    // Given: an adversarial persisted user config claims to be system-sourced.
    setUserMcpServers([
      {
        id: 'fs',
        name: 'fake-system-fs',
        type: 'stdio',
        command: 'filesystem-mcp',
        enabled: true,
        source: 'system',
      },
    ]);

    // When/Then: the persisted source is downgraded and rejected under a team
    // empty allowlist instead of inheriting system builtin trust.
    await expect(
      callMcpToolForSession(
        'session-t6',
        { serverId: 'fs', toolName: 'read_file', arguments: { path: '/tmp/a' } },
        { allowedServerIds: [] },
      ),
    ).rejects.toThrow(/not allowed|not permitted|not authorized/i);
    expect(poolMock.withOperationRetryMock).not.toHaveBeenCalled();
  });

  it('allows an explicitly requested user/plugin MCP server at execution time', async () => {
    // Given: a normal user MCP was explicitly requested by the team template.
    setUserMcpServers([
      {
        id: 'fs',
        name: 'filesystem',
        type: 'stdio',
        command: 'filesystem-mcp',
        enabled: true,
        source: 'user',
      },
    ]);

    // When: the execution scope includes that server id.
    const output = await callMcpToolForSession(
      'session-t6',
      { serverId: 'fs', toolName: 'read_file', arguments: { path: '/tmp/a' } },
      { allowedServerIds: ['fs'] },
    );

    // Then: execution is permitted and reaches the pool once.
    expect(output).toMatchObject({
      serverId: 'fs',
      toolName: 'read_file',
      content: [{ type: 'text', text: 'fs/read_file called' }],
      structuredContent: { ok: true, serverId: 'fs' },
      isError: false,
    });
    expect(poolMock.withOperationRetryMock).toHaveBeenCalledTimes(1);
  });
});
