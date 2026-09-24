/**
 * `tool_invoke` 沙箱接线回归：
 *   1. allowlist 内的折叠工具被解包并按真实工具执行；
 *   2. allowlist 之外的工具直接拒绝（不降级放行）；
 *   3. 会话内已禁用的内层工具（clarify 模式下的 bash）拒绝；
 *   4. 嵌套 tool_invoke / tool_search 拒绝。
 *
 * 权限语义靠「解包早于权限阶梯」结构性保证：解包后请求以内层工具名走
 * `ensurePermissionForTool`，deny/ask/审批与直接调用完全一致。
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

import { TEST_WORKSPACE, mocks } from './tool-sandbox-test-support.js';
import { createDefaultSandbox } from '../../tools/tool-sandbox.js';

async function executeTool(toolName: string, rawInput: Record<string, unknown>, sessionId: string) {
  const sandbox = createDefaultSandbox();
  return sandbox.execute(
    {
      toolCallId: `call-${sessionId}-${toolName}`,
      toolName,
      rawInput,
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

describe('tool-sandbox · tool_invoke 解包与门控', () => {
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
    mocks.metadataJson = JSON.stringify({
      workingDirectory: TEST_WORKSPACE,
      toolInvokeAllowlist: ['session_list'],
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    rmSync(TEST_WORKSPACE, { recursive: true, force: true });
  });

  it('allowlist 内的折叠工具被解包并按真实工具执行', async () => {
    const result = await executeTool('tool_invoke', { tool: 'session_list' }, 'invoke-ok');

    expect(result.isError).toBe(false);
    expect(String(result.output)).toContain('No sessions found.');
    expect(String(result.output)).not.toContain('not available');
  });

  it('allowlist 之外的工具直接拒绝', async () => {
    const result = await executeTool(
      'tool_invoke',
      { tool: 'bash', arguments: { command: 'echo hi' } },
      'invoke-reject',
    );

    expect(result.isError).toBe(true);
    expect(String(result.output)).toContain('not available in this session');
  });

  it('会话内已禁用的内层工具拒绝（clarify 模式的 bash）', async () => {
    mocks.metadataJson = JSON.stringify({
      workingDirectory: TEST_WORKSPACE,
      dialogueMode: 'clarify',
      toolInvokeAllowlist: ['bash'],
    });

    const result = await executeTool('tool_invoke', { tool: 'bash' }, 'invoke-clarify');

    expect(result.isError).toBe(true);
    expect(String(result.output)).toContain('disabled for this session');
  });

  it('拒绝嵌套 tool_invoke / tool_search', async () => {
    for (const inner of ['tool_invoke', 'tool_search']) {
      const result = await executeTool(
        'tool_invoke',
        { tool: inner, arguments: {} },
        'invoke-nested',
      );
      expect(result.isError).toBe(true);
      expect(String(result.output)).toContain('不能嵌套');
    }
  });
});
