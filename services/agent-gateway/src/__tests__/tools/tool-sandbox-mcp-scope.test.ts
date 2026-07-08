import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type SqliteGetMockRow = {
  readonly handoff_state?: string;
  readonly metadata_json?: string;
  readonly role_layer?: string;
  readonly team_parent_session_id?: string;
  readonly user_id?: string;
};

type McpCallScope = {
  readonly allowedServerIds?: readonly string[];
};

const mocks = vi.hoisted(() => ({
  callMcpToolForSessionMock: vi.fn(),
  listMcpToolsForSessionMock: vi.fn(async () => []),
  getConfiguredMcpServerForSessionMock: vi.fn(),
  getMcpServerFingerprintMock: vi.fn(() => 'fingerprint-abc'),
  sqliteAllMock: vi.fn(() => []),
  sqliteGetMock: vi.fn((query: string): SqliteGetMockRow | undefined => {
    if (query.includes('SELECT user_id FROM sessions')) {
      return { user_id: 'user-1' };
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
  listMcpToolsForSession: mocks.listMcpToolsForSessionMock,
  getConfiguredMcpServerForSession: mocks.getConfiguredMcpServerForSessionMock,
  getMcpServerFingerprint: mocks.getMcpServerFingerprintMock,
}));

import { createDefaultSandbox } from '../../tools/tool-sandbox.js';

function mockRunningTeamSessionWithEmptyMcpAllowlist(): void {
  mocks.sqliteGetMock.mockImplementation((query: string) => {
    if (query.includes('SELECT user_id FROM sessions')) {
      return { user_id: 'user-1' };
    }
    if (query.includes('SELECT role_layer, team_parent_session_id, handoff_state')) {
      return {
        role_layer: 'executor',
        team_parent_session_id: 'parent-session',
        handoff_state: 'running',
      };
    }
    if (query.includes('SELECT metadata_json')) {
      return {
        metadata_json: JSON.stringify({
          requestedMcpServers: [],
          createdByTool: 'task',
          yoloMode: true,
          teamRoleInstance: { roleLayer: 'executor' },
        }),
      };
    }
    return undefined;
  });
}

describe('tool-sandbox MCP execution scope', () => {
  beforeEach(() => {
    mocks.callMcpToolForSessionMock.mockReset();
    mocks.listMcpToolsForSessionMock.mockReset();
    mocks.listMcpToolsForSessionMock.mockResolvedValue([]);
    mocks.getConfiguredMcpServerForSessionMock.mockReset();
    mocks.getConfiguredMcpServerForSessionMock.mockReturnValue({
      id: 'omo',
      name: 'OMO',
      transport: 'stdio',
      enabled: true,
    });
    mockRunningTeamSessionWithEmptyMcpAllowlist();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('keeps team sessions on an empty MCP allowlist when no server is explicitly requested', async () => {
    const sandbox = createDefaultSandbox();

    const result = await sandbox.execute(
      {
        toolCallId: 'call-mcp-list-team-empty',
        toolName: 'mcp_list_tools',
        rawInput: {},
      },
      new AbortController().signal,
      'session-1',
      {
        clientRequestId: 'req-mcp-list-team-empty',
        nextRound: 1,
        requestData: { clientRequestId: 'req-mcp-list-team-empty' },
      },
    );

    expect(result.isError).toBe(false);
    expect(mocks.listMcpToolsForSessionMock).toHaveBeenCalledWith('session-1', {
      allowedServerIds: [],
    });
    expect(mocks.callMcpToolForSessionMock).not.toHaveBeenCalled();
  });

  it('passes an empty team MCP allowlist into flat MCP execution and returns a tool error', async () => {
    mocks.callMcpToolForSessionMock.mockImplementationOnce(
      async (_sessionId: string, _input: unknown, scope?: McpCallScope) => {
        if (scope?.allowedServerIds?.length === 0) {
          throw new Error('MCP server omo is not allowed for this session');
        }
        return {
          serverId: 'omo',
          toolName: 'inspect',
          content: [{ type: 'text', text: 'should not execute' }],
          isError: false,
        };
      },
    );
    const sandbox = createDefaultSandbox();

    const result = await sandbox.execute(
      {
        toolCallId: 'call-flat-mcp-team-empty',
        toolName: 'mcp__omo__inspect',
        rawInput: { q: 'secret' },
      },
      new AbortController().signal,
      'session-1',
      {
        clientRequestId: 'req-flat-mcp-team-empty',
        nextRound: 1,
        requestData: { clientRequestId: 'req-flat-mcp-team-empty' },
      },
    );

    expect(mocks.callMcpToolForSessionMock).toHaveBeenCalledWith(
      'session-1',
      { serverId: 'omo', toolName: 'inspect', arguments: { q: 'secret' } },
      { allowedServerIds: [] },
    );
    expect(result.isError).toBe(true);
    expect(result.output).toContain('not allowed');
  });
});
