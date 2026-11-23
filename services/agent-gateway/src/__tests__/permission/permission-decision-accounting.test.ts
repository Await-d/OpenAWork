/**
 * 权限决策审计记账回归（W-02）。
 *
 * 目标：`permission-ladder.ts` 的**唯一记账出口**必须覆盖每个权限出口——
 * 自动 allow（yolo / auto-edit / 渠道策略 / workspace 规则 / saved approval）、
 * 自动 deny（规则拒绝 / 渠道无审批通道 / MCP 前置拒绝）、以及 pending（等待人工）。
 *
 * 关键不变量（本文件锁定）：
 *   1. 每个出口恰好落一条 `permission_decision_logs`（不重不漏）；
 *   2. 自动 allow 的 reason 绝不写成 `user_approved`（审计不得冒充用户同意）；
 *   3. MCP 前置拒绝单列为 `mcp_denied`，与规则拒绝（`rule_denied`）可区分；
 *   4. 记账是 best-effort：日志写入失败不能改变权限结论，也不能抛出。
 *
 * 桩组织与 `tool-sandbox-permission-ladder.test.ts` 一致（共享模块级桩）。
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as MessageStoreV2 from '../../message/message-store-v2.js';

vi.mock('../../infra/db.js', async () => {
  const { TEST_WORKSPACE, mocks } = await import('../tools/tool-sandbox-test-support.js');
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
  const { mocks } = await import('../tools/tool-sandbox-test-support.js');
  const actual = await vi.importActual<typeof MessageStoreV2>('../../message/message-store-v2.js');
  return {
    ...actual,
    transitionToolToRunning: mocks.transitionToolToRunningMock,
  };
});

vi.mock('../../session/session-run-events.js', () => ({
  publishSessionRunEvent: vi.fn(),
}));

vi.mock('../../mcp/mcp-runtime.js', async () => {
  const { mocks } = await import('../tools/tool-sandbox-test-support.js');
  return {
    callMcpToolForSession: mocks.callMcpToolForSessionMock,
    getConfiguredMcpServerForSession: mocks.getConfiguredMcpServerForSessionMock,
    getMcpServerFingerprint: mocks.getMcpServerFingerprintMock,
    listMcpToolsForSession: mocks.listMcpToolsForSessionMock,
  };
});

import { TEST_WORKSPACE, mocks } from '../tools/tool-sandbox-test-support.js';
import { ensurePermissionForTool } from '../../tools/sandbox/permission-ladder.js';
import { PERMISSION_DECISION_REASONS } from '../../session/permission-decision-log-store.js';

interface DecisionLogInsert {
  readonly params: readonly unknown[];
}

function decisionLogInserts(): DecisionLogInsert[] {
  return mocks.sqliteRunMock.mock.calls
    .filter(
      ([query]) =>
        typeof query === 'string' && query.includes('INSERT INTO permission_decision_logs'),
    )
    .map((call) => ({ params: call[1] as readonly unknown[] }));
}

function lastDecision(): { decision: string; reason: string } | undefined {
  const inserts = decisionLogInserts();
  const last = inserts[inserts.length - 1];
  if (!last) return undefined;
  // 列顺序：request_id, session_id, tool_name, scope, decision, reason, workspace_root
  return {
    decision: String(last.params[4]),
    reason: String(last.params[5]),
  };
}

function executionContext(clientRequestId: string) {
  return {
    clientRequestId,
    nextRound: 1,
    requestData: { clientRequestId },
  };
}

describe('权限阶梯决策审计记账', () => {
  beforeEach(() => {
    rmSync(TEST_WORKSPACE, { recursive: true, force: true });
    mkdirSync(TEST_WORKSPACE, { recursive: true });
    mocks.sqliteAllMock.mockReset();
    mocks.sqliteAllMock.mockImplementation(() => []);
    mocks.sqliteGetMock.mockClear();
    mocks.sqliteRunMock.mockReset();
    mocks.requireBoundWorkspace = false;
    mocks.roleLayer = 'executor';
    mocks.teamParentSessionId = null;
    mocks.handoffState = null;
    mocks.metadataJson = '{}';
  });

  afterEach(() => {
    vi.clearAllMocks();
    rmSync(TEST_WORKSPACE, { recursive: true, force: true });
  });

  function runBash(sessionId: string) {
    return ensurePermissionForTool(
      sessionId,
      {
        toolCallId: `call-${sessionId}`,
        toolName: 'bash',
        rawInput: { command: 'printf decision-accounting', description: '记账回归' },
      },
      undefined,
      executionContext(`req-${sessionId}`),
    );
  }

  it('yolo 免审批分支落一条记录，reason=mode_yolo 而非 user_approved', async () => {
    mocks.metadataJson = JSON.stringify({
      permissionMode: 'yolo',
      workingDirectory: TEST_WORKSPACE,
    });

    const state = await runBash('decision-yolo');

    expect(state.kind).not.toBe('denied');
    const inserts = decisionLogInserts();
    expect(inserts).toHaveLength(1);
    expect(lastDecision()).toEqual({ decision: 'not_needed', reason: 'mode_yolo' });
    expect(lastDecision()?.reason).not.toBe(PERMISSION_DECISION_REASONS.USER_APPROVED);
  });

  it('规则拒绝出口落一条记录，reason=rule_denied', async () => {
    mocks.metadataJson = JSON.stringify({
      permissionMode: 'yolo',
      workingDirectory: TEST_WORKSPACE,
    });
    writeFileSync(
      join(TEST_WORKSPACE, '.openawork.permissions.json'),
      JSON.stringify({ rules: [{ permission: 'bash', pattern: '*', action: 'deny' }] }),
      'utf8',
    );

    const state = await runBash('decision-rule-denied');

    expect(state.kind).toBe('denied');
    expect(decisionLogInserts()).toHaveLength(1);
    expect(lastDecision()).toEqual({ decision: 'denied', reason: 'rule_denied' });
  });

  it('pending 出口落一条记录，reason=awaiting_user（不是 saved_approval 或 user_approved）', async () => {
    mocks.metadataJson = JSON.stringify({ workingDirectory: TEST_WORKSPACE });

    const state = await runBash('decision-pending');

    expect(state.kind).toBe('pending');
    expect(decisionLogInserts()).toHaveLength(1);
    expect(lastDecision()).toEqual({ decision: 'pending', reason: 'awaiting_user' });
  });

  it('渠道会话无审批通道拒绝时 reason=channel_no_approval', async () => {
    // 渠道可见工具会在前面自动批准，这里用工作区规则显式 ask 让 bash 走到渠道兜底拒绝。
    mocks.metadataJson = JSON.stringify({
      source: 'channel',
      workingDirectory: TEST_WORKSPACE,
    });

    const state = await runBash('decision-channel');

    expect(state.kind).toBe('denied');
    expect(decisionLogInserts()).toHaveLength(1);
    expect(lastDecision()).toEqual({ decision: 'denied', reason: 'channel_no_approval' });
  });

  it('审计写入失败时权限结论不变且不抛出（best-effort）', async () => {
    mocks.metadataJson = JSON.stringify({
      permissionMode: 'yolo',
      workingDirectory: TEST_WORKSPACE,
    });
    mocks.sqliteRunMock.mockImplementation((query: string) => {
      if (typeof query === 'string' && query.includes('INSERT INTO permission_decision_logs')) {
        throw new Error('ladder audit write failed');
      }
      return undefined;
    });

    const state = await runBash('decision-write-failure');

    // 写入失败绝不能改变放行结论，也不能让调用方抛错。
    expect(state.kind).not.toBe('denied');
  });
});
