/**
 * `mcp_manage_servers` 在 tool-sandbox 中的接线与权限门控回归。
 *
 * 关注三件事：
 *   1. 默认 ask 档位：变更类动作产生 pending 审批，执行器不被调用；
 *   2. 只读 list 免审批：直接派发（与 `mcp_list_tools` 同类）；
 *   3. team 后台会话即使被权限层自动免审批，仍会被工具内的会话守卫拒绝
 *      （defense-in-depth：team 成员不得修改用户 MCP 配置）。
 *
 * 依赖 `tool-sandbox-test-support.ts` 的共享桩；MCP runtime 被整体替换，
 * 因此不触达真实连接与网络。
 */
import { mkdirSync, rmSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as MessageStoreV2 from '../../message/message-store-v2.js';

vi.mock('../../infra/db.js', async () => {
  const { TEST_WORKSPACE, mocks } = await import('./tool-sandbox-test-support.js');
  return {
    WORKSPACE_ACCESS_RESTRICTED: false,
    WORKSPACE_ROOT: TEST_WORKSPACE,
    WORKSPACE_ROOTS: [TEST_WORKSPACE],
    sqliteAll: mocks.sqliteAllMock,
    sqliteGet: mocks.sqliteGetMock,
    sqliteRun: mocks.sqliteRunMock,
    sqliteRunWithRowId: vi.fn(() => 1),
  };
});

vi.mock('../../message/message-store-v2.js', async () => {
  const { mocks } = await import('./tool-sandbox-test-support.js');
  const actual = await vi.importActual<typeof MessageStoreV2>('../../message/message-store-v2.js');
  return {
    ...actual,
    transitionToolToRunning: mocks.transitionToolToRunningMock,
  };
});

vi.mock('../../session/session-run-events.js', () => ({
  publishSessionRunEvent: vi.fn(),
}));

const runtimeMock = vi.hoisted(() => ({
  loadConfiguredMcpServersForUserMock: vi.fn(),
  retryMcpConnectionForUserMock: vi.fn(),
  getMcpPoolKeyMock: vi.fn((server: { id?: string }) => `pool-${server.id ?? 'unknown'}`),
  disconnectUserConnectionMock: vi.fn(async () => undefined),
}));

vi.mock('../../mcp/mcp-runtime.js', async () => {
  const { mocks } = await import('./tool-sandbox-test-support.js');
  return {
    callMcpToolForSession: mocks.callMcpToolForSessionMock,
    getConfiguredMcpServerForSession: mocks.getConfiguredMcpServerForSessionMock,
    getMcpServerFingerprint: mocks.getMcpServerFingerprintMock,
    listMcpToolsForSession: mocks.listMcpToolsForSessionMock,
    getMcpPoolKey: runtimeMock.getMcpPoolKeyMock,
    loadConfiguredMcpServersForUser: runtimeMock.loadConfiguredMcpServersForUserMock,
    retryMcpConnectionForUser: runtimeMock.retryMcpConnectionForUserMock,
  };
});

vi.mock('../../skill/skill-mcp-connection-pool.js', () => {
  const fakePool = {
    disconnectUserConnection: runtimeMock.disconnectUserConnectionMock,
    onToolListChanged: () => () => undefined,
    withOperationRetry: vi.fn(),
    isConnected: vi.fn(() => false),
  };
  return { mcpConnectionPool: fakePool, skillMcpPool: fakePool };
});

import { TEST_WORKSPACE, mocks } from './tool-sandbox-test-support.js';
import { createDefaultSandbox } from '../../tools/tool-sandbox.js';

const WEBSEARCH_SERVER = {
  id: 'websearch',
  name: 'Exa Web Search',
  transport: 'sse' as const,
  url: 'https://mcp.exa.ai/mcp?tools=web_search_exa',
  enabled: true,
  builtin: true,
  builtinKind: 'system' as const,
  source: 'system' as const,
};

async function executeManageTool(input: Record<string, unknown>, sessionId: string) {
  const sandbox = createDefaultSandbox();
  return sandbox.execute(
    {
      toolCallId: `call-${sessionId}`,
      toolName: 'mcp_manage_servers',
      rawInput: input,
    },
    new AbortController().signal,
    sessionId,
    {
      clientRequestId: `req-${sessionId}`,
      nextRound: 1,
      requestData: { clientRequestId: `req-${sessionId}` },
    },
  );
}

describe('tool-sandbox · mcp_manage_servers 接线与门控', () => {
  beforeEach(() => {
    rmSync(TEST_WORKSPACE, { recursive: true, force: true });
    mkdirSync(TEST_WORKSPACE, { recursive: true });
    mocks.sqliteAllMock.mockReset();
    mocks.sqliteAllMock.mockImplementation(() => []);
    mocks.sqliteGetMock.mockClear();
    mocks.sqliteRunMock.mockReset();
    mocks.transitionToolToRunningMock.mockReset();
    mocks.roleLayer = null;
    mocks.teamParentSessionId = null;
    mocks.handoffState = null;
    mocks.requireBoundWorkspace = false;
    mocks.metadataJson = JSON.stringify({ workingDirectory: TEST_WORKSPACE });
    runtimeMock.loadConfiguredMcpServersForUserMock.mockReset();
    runtimeMock.loadConfiguredMcpServersForUserMock.mockReturnValue([WEBSEARCH_SERVER]);
    runtimeMock.retryMcpConnectionForUserMock.mockReset();
    runtimeMock.retryMcpConnectionForUserMock.mockImplementation(
      async (userId: string, serverId: string) => ({
        serverId,
        serverName: serverId,
        status: 'connected' as const,
        toolCount: 2,
        durationMs: 1,
      }),
    );
    runtimeMock.disconnectUserConnectionMock.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
    rmSync(TEST_WORKSPACE, { recursive: true, force: true });
  });

  it('默认 ask 档位：disable 产生 pending 审批，执行器不被调用', async () => {
    const result = await executeManageTool(
      { action: 'disable', serverId: 'websearch' },
      'plain-session',
    );

    expect(result.isError).toBe(true);
    expect(typeof result.pendingPermissionRequestId).toBe('string');
    expect(String(result.output)).toContain('requires approval');
    expect(runtimeMock.retryMcpConnectionForUserMock).not.toHaveBeenCalled();
    expect(runtimeMock.disconnectUserConnectionMock).not.toHaveBeenCalled();
  });

  it('只读 list 免审批：直接派发并返回服务器列表', async () => {
    const result = await executeManageTool({ action: 'list' }, 'plain-session');

    expect(result.isError).toBe(false);
    expect(result.pendingPermissionRequestId).toBeUndefined();
    const output = JSON.parse(String(result.output)) as {
      servers: Array<{ id: string }>;
    };
    expect(output.servers.map((server) => server.id)).toContain('websearch');
  });

  it('yolo 档位：免审批派发并执行 disable', async () => {
    mocks.metadataJson = JSON.stringify({
      workingDirectory: TEST_WORKSPACE,
      permissionMode: 'yolo',
    });

    const result = await executeManageTool(
      { action: 'disable', serverId: 'websearch' },
      'yolo-session',
    );

    expect(result.isError).toBe(false);
    const output = JSON.parse(String(result.output)) as {
      ok: boolean;
      serverId: string;
      connect: { status: string };
    };
    expect(output).toMatchObject({ ok: true, serverId: 'websearch' });
    expect(output.connect.status).toBe('disabled');
    expect(runtimeMock.disconnectUserConnectionMock).toHaveBeenCalled();
  });

  it('team 后台会话：权限层自动免审批，但工具内守卫仍拒绝', async () => {
    mocks.requireBoundWorkspace = true;
    mocks.roleLayer = 'executor';
    mocks.teamParentSessionId = 'parent-1';
    mocks.handoffState = 'running';

    const result = await executeManageTool(
      { action: 'disable', serverId: 'websearch' },
      'team-executor-session',
    );

    expect(result.isError).toBe(true);
    expect(String(result.output)).toContain('团队会话');
    expect(runtimeMock.disconnectUserConnectionMock).not.toHaveBeenCalled();
  });
});
