import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type SqliteGetMockRow = {
  readonly handoff_state?: string | null;
  readonly id?: string;
  readonly metadata_json?: string;
  readonly parent_id?: string;
  readonly role_layer?: string | null;
  readonly team_parent_session_id?: string | null;
  readonly user_id?: string;
};

type PermissionApprovalCandidateRow = {
  readonly id: string;
  readonly decision: 'once' | 'session' | 'permanent';
  readonly scope: string;
  readonly always_json: string | null;
};

const mcpScope = 'github:create_issue:fp-github';

const mocks = vi.hoisted(() => ({
  callMcpToolForSessionMock: vi.fn(),
  getConfiguredMcpServerForSessionMock: vi.fn((_sessionId: string, serverId: string) => ({
    id: serverId,
    name: serverId.toUpperCase(),
    transport: 'stdio',
    enabled: true,
  })),
  getMcpServerFingerprintMock: vi.fn((server: { readonly id: string }) => `fp-${server.id}`),
  listMcpToolsForSessionMock: vi.fn(async () => []),
  sqliteAllMock: vi.fn(
    (
      _query?: string,
      _params?: readonly unknown[],
    ): readonly PermissionApprovalCandidateRow[] => [],
  ),
  sqliteGetMock: vi.fn((query: string): SqliteGetMockRow | undefined => {
    if (query.includes('SELECT user_id FROM sessions')) {
      return { user_id: 'user-1' };
    }
    if (query.includes('SELECT role_layer, team_parent_session_id, handoff_state')) {
      return { role_layer: null, team_parent_session_id: null, handoff_state: null };
    }
    if (query.includes('SELECT metadata_json')) {
      return { metadata_json: '{}' };
    }
    return undefined;
  }),
  sqliteRunMock: vi.fn(),
  sqliteRunWithRowIdMock: vi.fn(() => 1),
}));

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

import { createDefaultSandbox } from '../../tools/tool-sandbox.js';

function executionContext(clientRequestId: string) {
  return {
    clientRequestId,
    nextRound: 1,
    requestData: { clientRequestId },
  };
}

function permissionInsertParams(): readonly unknown[] | undefined {
  return mocks.sqliteRunMock.mock.calls.find(
    ([query]) => typeof query === 'string' && query.includes('INSERT INTO permission_requests'),
  )?.[1];
}

describe('tool-sandbox flat MCP permission boundary', () => {
  beforeEach(() => {
    mocks.callMcpToolForSessionMock.mockReset();
    mocks.callMcpToolForSessionMock.mockResolvedValue({
      serverId: 'github',
      toolName: 'create_issue',
      content: [{ type: 'text', text: 'ok' }],
      isError: false,
    });
    mocks.sqliteAllMock.mockReset();
    mocks.sqliteAllMock.mockReturnValue([]);
    mocks.sqliteGetMock.mockClear();
    mocks.sqliteRunMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('stores flat MCP pending permission requests under the legacy mcp_call category', async () => {
    const result = await createDefaultSandbox().execute(
      {
        toolCallId: 'call-flat-pending',
        toolName: 'mcp__github__create_issue',
        rawInput: { title: 'Bug', body: 'Repro' },
      },
      new AbortController().signal,
      'session-1',
      executionContext('req-flat-pending'),
    );

    expect(result.pendingPermissionRequestId).toBeDefined();
    expect(permissionInsertParams()).toEqual(expect.arrayContaining(['mcp_call', mcpScope]));
    expect(mocks.callMcpToolForSessionMock).not.toHaveBeenCalled();
  });

  it('reuses approved legacy mcp_call permission for flat MCP calls with the same scope', async () => {
    mocks.sqliteAllMock.mockImplementation(
      (_query?: string, params?: readonly unknown[]): readonly PermissionApprovalCandidateRow[] =>
        params?.[0] === 'mcp_call'
          ? [{ id: 'approved-legacy', decision: 'session', scope: mcpScope, always_json: null }]
          : [],
    );

    const result = await createDefaultSandbox().execute(
      {
        toolCallId: 'call-flat-approved',
        toolName: 'mcp__github__create_issue',
        rawInput: { title: 'Bug' },
      },
      new AbortController().signal,
      'session-1',
      executionContext('req-flat-approved'),
    );

    expect(result.isError).toBe(false);
    expect(permissionInsertParams()).toBeUndefined();
    expect(mocks.callMcpToolForSessionMock).toHaveBeenCalledTimes(1);
  });

  it('reuses pending legacy mcp_call permission for flat MCP calls with the same scope', async () => {
    mocks.sqliteGetMock.mockImplementation((query: string, params?: readonly unknown[]) => {
      if (query.includes('SELECT user_id FROM sessions')) {
        return { user_id: 'user-1' };
      }
      if (query.includes('SELECT metadata_json')) {
        return { metadata_json: '{}' };
      }
      if (
        query.includes('FROM permission_requests') &&
        params?.[1] === 'mcp_call' &&
        params?.[2] === mcpScope
      ) {
        return { id: 'pending-legacy' };
      }
      return undefined;
    });

    const result = await createDefaultSandbox().execute(
      {
        toolCallId: 'call-flat-pending-reuse',
        toolName: 'mcp__github__create_issue',
        rawInput: { title: 'Bug' },
      },
      new AbortController().signal,
      'session-1',
      executionContext('req-flat-pending-reuse'),
    );

    expect(result.pendingPermissionRequestId).toBe('pending-legacy');
    expect(result.output).toContain('is still pending');
    expect(permissionInsertParams()).toBeUndefined();
    expect(mocks.callMcpToolForSessionMock).not.toHaveBeenCalled();
  });
});
