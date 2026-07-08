import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type SqliteGetMockRow = {
  readonly handoff_state?: string | null;
  readonly metadata_json?: string;
  readonly role_layer?: string | null;
  readonly team_parent_session_id?: string | null;
  readonly user_id?: string;
};

type McpCallScope = {
  readonly allowedServerIds?: readonly string[];
};

const mocks = vi.hoisted(() => {
  let sessionMetadata: Record<string, unknown> = {};

  return {
    callMcpToolForSessionMock: vi.fn(),
    getConfiguredMcpServerForSessionMock: vi.fn((_sessionId: string, serverId: string) => ({
      id: serverId,
      name: serverId.toUpperCase(),
      transport: 'stdio',
      enabled: true,
    })),
    getMcpServerFingerprintMock: vi.fn((server: { readonly id: string }) => `fp-${server.id}`),
    listMcpToolsForSessionMock: vi.fn(async () => []),
    setSessionMetadata: (metadata: Record<string, unknown>) => {
      sessionMetadata = metadata;
    },
    sqliteAllMock: vi.fn(() => []),
    sqliteGetMock: vi.fn((query: string): SqliteGetMockRow | undefined => {
      if (query.includes('SELECT user_id FROM sessions')) {
        return { user_id: 'user-1' };
      }
      if (query.includes('SELECT role_layer, team_parent_session_id, handoff_state')) {
        return {
          role_layer:
            typeof sessionMetadata.roleLayer === 'string' ? sessionMetadata.roleLayer : null,
          team_parent_session_id:
            typeof sessionMetadata.teamParentSessionId === 'string'
              ? sessionMetadata.teamParentSessionId
              : null,
          handoff_state:
            typeof sessionMetadata.handoffState === 'string' ? sessionMetadata.handoffState : null,
        };
      }
      if (query.includes('SELECT metadata_json')) {
        return { metadata_json: JSON.stringify(sessionMetadata) };
      }
      return undefined;
    }),
    sqliteRunMock: vi.fn(),
    sqliteRunWithRowIdMock: vi.fn(() => 1),
  };
});

vi.mock('../../infra/db.js', () => ({
  WORKSPACE_ACCESS_RESTRICTED: false,
  WORKSPACE_ROOT: '/home/await/project/OpenAWork',
  WORKSPACE_ROOTS: ['/home/await/project/OpenAWork'],
  sqliteAll: mocks.sqliteAllMock,
  sqliteGet: mocks.sqliteGetMock,
  sqliteRun: mocks.sqliteRunMock,
  sqliteRunWithRowId: mocks.sqliteRunWithRowIdMock,
}));

vi.mock('../../mcp/mcp-runtime.js', () => ({
  callMcpToolForSession: mocks.callMcpToolForSessionMock,
  getConfiguredMcpServerForSession: mocks.getConfiguredMcpServerForSessionMock,
  getMcpServerFingerprint: mocks.getMcpServerFingerprintMock,
  listMcpToolsForSession: mocks.listMcpToolsForSessionMock,
}));

import { _registerPluginForTest, _resetPluginsForTest } from '../../runtime/plugin-host.js';
import { createDefaultSandbox } from '../../tools/tool-sandbox.js';

function executionContext(clientRequestId: string) {
  return {
    clientRequestId,
    nextRound: 1,
    requestData: { clientRequestId },
  };
}

describe('tool-sandbox OMO MCP hook boundary', () => {
  beforeEach(() => {
    _resetPluginsForTest();
    mocks.callMcpToolForSessionMock.mockReset();
    mocks.setSessionMetadata({ yoloMode: true });
  });

  afterEach(() => {
    _resetPluginsForTest();
    vi.clearAllMocks();
  });

  it('calls mcp__omo__adapter_catalog through the sandbox path and records audit', async () => {
    mocks.callMcpToolForSessionMock.mockResolvedValueOnce({
      serverId: 'omo',
      toolName: 'adapter_catalog',
      content: [{ type: 'text', text: 'catalog ok' }],
      isError: false,
    });

    const result = await createDefaultSandbox().execute(
      {
        toolCallId: 'call-omo-catalog',
        toolName: 'mcp__omo__adapter_catalog',
        rawInput: { includeDisabled: false },
      },
      new AbortController().signal,
      'session-1',
      executionContext('req-omo-catalog'),
    );

    expect(mocks.callMcpToolForSessionMock).toHaveBeenCalledWith(
      'session-1',
      {
        serverId: 'omo',
        toolName: 'adapter_catalog',
        arguments: { includeDisabled: false },
      },
      undefined,
    );
    expect(result.isError).toBe(false);
    expect(
      mocks.sqliteRunMock.mock.calls.some(
        ([query, params]) =>
          typeof query === 'string' &&
          query.includes('INSERT INTO audit_logs') &&
          Array.isArray(params) &&
          params[1] === 'mcp__omo__adapter_catalog',
      ),
    ).toBe(true);
  });

  it('denies flat OMO execution when the session MCP scope is empty', async () => {
    mocks.setSessionMetadata({
      yoloMode: true,
      roleLayer: 'executor',
      teamParentSessionId: 'parent-1',
      handoffState: 'running',
      requestedMcpServers: [],
    });
    mocks.callMcpToolForSessionMock.mockImplementationOnce(
      async (_sessionId: string, _input: unknown, scope?: McpCallScope) => {
        if (scope?.allowedServerIds?.length === 0) {
          throw new Error('MCP server omo is not allowed for this session');
        }
        return { content: [{ type: 'text', text: 'unexpected' }], isError: false };
      },
    );

    const result = await createDefaultSandbox().execute(
      {
        toolCallId: 'call-omo-denied',
        toolName: 'mcp__omo__adapter_catalog',
        rawInput: {},
      },
      new AbortController().signal,
      'session-1',
      executionContext('req-omo-denied'),
    );

    expect(mocks.callMcpToolForSessionMock).toHaveBeenCalledWith(
      'session-1',
      { serverId: 'omo', toolName: 'adapter_catalog', arguments: {} },
      { allowedServerIds: [] },
    );
    expect(result.isError).toBe(true);
    expect(result.output).toContain('not allowed');
  });

  it('uses hook-mutated legacy mcp_call arguments for permission context before execution', async () => {
    mocks.setSessionMetadata({});
    _registerPluginForTest('mutate-legacy-mcp', {
      'tool.execute.before': (_input, output) => {
        output.args = { serverId: 'omo', toolName: 'adapter_catalog', arguments: {} };
      },
    });

    const result = await createDefaultSandbox().execute(
      {
        toolCallId: 'call-legacy-mutated',
        toolName: 'mcp_call',
        rawInput: { serverId: 'github', toolName: 'create_issue', arguments: {} },
      },
      new AbortController().signal,
      'session-1',
      executionContext('req-legacy-mutated'),
    );

    const permissionInsert = mocks.sqliteRunMock.mock.calls.find(
      ([query]) => typeof query === 'string' && query.includes('INSERT INTO permission_requests'),
    );
    expect(mocks.callMcpToolForSessionMock).not.toHaveBeenCalled();
    expect(result.pendingPermissionRequestId).toBeDefined();
    expect(permissionInsert?.[1]).toEqual(
      expect.arrayContaining(['mcp_call', 'omo:adapter_catalog:fp-omo']),
    );
  });

  it('allows after hooks to observe and rewrite OMO output without changing execution path', async () => {
    _registerPluginForTest('wrap-output', {
      'tool.execute.after': (_input, output) => {
        output.output = { observed: true, original: output.output };
      },
    });
    mocks.callMcpToolForSessionMock.mockResolvedValueOnce({
      serverId: 'omo',
      toolName: 'adapter_catalog',
      content: [{ type: 'text', text: 'raw' }],
      isError: false,
    });

    const result = await createDefaultSandbox().execute(
      {
        toolCallId: 'call-omo-after',
        toolName: 'mcp__omo__adapter_catalog',
        rawInput: {},
      },
      new AbortController().signal,
      'session-1',
      executionContext('req-omo-after'),
    );

    expect(result.output).toMatchObject({
      observed: true,
      original: { serverId: 'omo', toolName: 'adapter_catalog' },
    });
    expect(mocks.callMcpToolForSessionMock).toHaveBeenCalledTimes(1);
  });

  it('keeps hook-thrown and unregistered tools from executing', async () => {
    _registerPluginForTest('cannot-add-tool', {
      'tool.execute.before': () => {
        throw new Error('hook failed');
      },
    });

    const result = await createDefaultSandbox().execute(
      {
        toolCallId: 'call-unregistered',
        toolName: 'unregistered_omo_escape',
        rawInput: { serverId: 'omo', toolName: 'adapter_catalog', arguments: {} },
      },
      new AbortController().signal,
      'session-1',
      executionContext('req-unregistered'),
    );

    expect(mocks.callMcpToolForSessionMock).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(result.output).toContain('is not allowed');
  });

  it.each([
    ['disabled OMO server', 'Configured MCP server is disabled: omo'],
    ['unregistered OMO tool', 'Unknown OMO MCP tool: missing_tool'],
  ])('returns a tool error for %s', async (_caseName, message) => {
    mocks.callMcpToolForSessionMock.mockRejectedValueOnce(new Error(message));

    const result = await createDefaultSandbox().execute(
      {
        toolCallId: 'call-omo-error',
        toolName: 'mcp__omo__missing_tool',
        rawInput: {},
      },
      new AbortController().signal,
      'session-1',
      executionContext('req-omo-error'),
    );

    expect(result.isError).toBe(true);
    expect(result.output).toContain(message);
  });
});
