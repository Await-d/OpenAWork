/**
 * `memory_manage` 在 tool-sandbox 中的接线与权限门控回归。
 *
 * 与 MCP 版本同构：
 *   1. 默认 ask 档位：变更类动作产生 pending 审批，执行器不被调用；
 *   2. 只读 list 免审批：直接派发并返回结果；
 *   3. yolo 档位：免审批派发并执行 add；
 *   4. team 后台会话即使被权限层自动免审批，仍会被工具内的会话守卫拒绝。
 *
 * 依赖 `tool-sandbox-test-support.ts` 的共享桩（真实 memory-admin-tools 模块 +
 * mock DB），因此守卫与输出归一都是真实链路。
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

async function executeMemoryTool(input: Record<string, unknown>, sessionId: string) {
  const sandbox = createDefaultSandbox();
  return sandbox.execute(
    {
      toolCallId: `call-${sessionId}`,
      toolName: 'memory_manage',
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

describe('tool-sandbox · memory_manage 接线与门控', () => {
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
  });

  afterEach(() => {
    vi.clearAllMocks();
    rmSync(TEST_WORKSPACE, { recursive: true, force: true });
  });

  it('默认 ask 档位：delete 产生 pending 审批，执行器不被调用', async () => {
    const result = await executeMemoryTool({ action: 'delete', memoryId: 'm-1' }, 'plain-session');

    expect(result.isError).toBe(true);
    expect(typeof result.pendingPermissionRequestId).toBe('string');
    expect(String(result.output)).toContain('requires approval');
    expect(
      mocks.sqliteRunMock.mock.calls.some(
        ([query]) => typeof query === 'string' && query.includes('DELETE FROM memories'),
      ),
    ).toBe(false);
  });

  it('只读 list 免审批：直接派发并返回结果', async () => {
    const result = await executeMemoryTool({ action: 'list' }, 'plain-session');

    expect(result.isError).toBe(false);
    expect(result.pendingPermissionRequestId).toBeUndefined();
    const output = JSON.parse(String(result.output)) as {
      ok: boolean;
      action: string;
      count: number;
    };
    expect(output).toMatchObject({ ok: true, action: 'list', count: 0 });
  });

  it('yolo 档位：免审批派发并执行 add', async () => {
    mocks.metadataJson = JSON.stringify({
      workingDirectory: TEST_WORKSPACE,
      permissionMode: 'yolo',
    });

    const result = await executeMemoryTool(
      { action: 'add', memory: { type: 'fact', key: 'k', value: 'v' } },
      'yolo-session',
    );

    expect(result.isError).toBe(false);
    const output = JSON.parse(String(result.output)) as {
      ok: boolean;
      action: string;
      memory: { source: string };
    };
    expect(output).toMatchObject({ ok: true, action: 'add' });
    expect(output.memory.source).toBe('manual');
    expect(
      mocks.sqliteRunMock.mock.calls.some(
        ([query]) => typeof query === 'string' && query.includes('INSERT INTO memories'),
      ),
    ).toBe(true);
  });

  it('team 后台会话：权限层自动免审批，但工具内守卫仍拒绝', async () => {
    mocks.requireBoundWorkspace = true;
    mocks.roleLayer = 'executor';
    mocks.teamParentSessionId = 'parent-1';
    mocks.handoffState = 'running';

    const result = await executeMemoryTool({ action: 'delete', memoryId: 'm-1' }, 'team-session');

    expect(result.isError).toBe(true);
    expect(String(result.output)).toContain('团队会话');
    expect(
      mocks.sqliteRunMock.mock.calls.some(
        ([query]) => typeof query === 'string' && query.includes('DELETE FROM memories'),
      ),
    ).toBe(false);
  });
});
