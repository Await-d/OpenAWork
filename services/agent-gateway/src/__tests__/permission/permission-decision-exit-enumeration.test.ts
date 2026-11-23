/**
 * 权限阶梯「每个出口恰好一条审计」枚举回归（R-02 对抗式复核）。
 *
 * 目标：把 `ensurePermissionForTool` 的**每条 return 路径都真实走一遍**，断言
 * 每个出口恰好落一条 `permission_decision_logs`，且 reason 与其真实优先级档位一致。
 * 这比逐个读代码更能抓到「漏记 / 重复记 / 记错理由」。
 *
 * 与 permission-ladder.ts 的 return 出口一一对应的真实清单（本文件用 `it` 逐条
 * 走通可触达出口）：
 *   出口A. 工具级 deny 早退 → rule_denied（scope='*'）                          [覆盖]
 *   出口B. MCP flat/legacy 派生异常前置拒绝（toolLevel allow 检查之前）→ mcp_denied [覆盖]
 *   出口B'. context.denialReason（toolLevel 非 allow 之后）→ mcp_denied
 *         —— 仅 MCP 派生器会产出 denialReason，而 MCP 工具的通配符动作恒为 ask，
 *            走不到 allow 早退，故出口B 总是先于 B' 命中；B' 对当前派生器是不可达
 *            分支（保留为纵深防御），本文件不为其造假用例。                       [不可达]
 *   出口C. 工具级 allow → rule_allowed                                          [覆盖]
 *   出口D. context 为 null（派生器声明免审批；规则可能为 ask，放行来自派生器）
 *         → deriver_not_required                                                 [覆盖]
 *   出口E. 作用域级 allow → rule_allowed                                        [覆盖]
 *   出口F. 作用域级 deny → rule_denied                                          [覆盖]
 *   出口G. yolo 免审批 → mode_yolo                                              [覆盖]
 *   出口H. team 后台免审批 → team_background                                     [覆盖]
 *   出口I. 派生子代理无人值守 → delegation_unattended                            [覆盖]
 *   出口I'. reception 只读免审批 → reception_readonly                            [覆盖]
 *   出口J. auto-edit 档位 → mode_auto_edit                                      [覆盖]
 *   出口K. 渠道策略自动批准 → channel_policy                                     [覆盖]
 *   出口L. workspace 永久规则 → workspace_rule
 *         （本文件未单列；由 permission-decision-accounting.test.ts 与
 *           tool-sandbox 系列相邻用例覆盖）                                       [见邻文件]
 *   出口M. saved approval → saved_approval                                      [覆盖]
 *   出口N. 插件在 ask 阶段拒绝 → plugin_denied                                   [覆盖]
 *   出口O. 插件把内置 allow（yolo 档）降级为 deny → plugin_denied（不是 mode_yolo）[覆盖]
 *   出口P. 渠道无审批通道 → channel_no_approval                                  [覆盖]
 *   出口Q. 新建 pending → awaiting_user                                          [覆盖]
 *   出口R. 复用已有 pending → awaiting_user                                      [覆盖]
 *
 * 桩组织与 `permission-decision-accounting.test.ts` 一致（共享模块级桩）。
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
import {
  PERMISSION_DECISION_REASONS,
  type PermissionDecisionReason,
} from '../../session/permission-decision-log-store.js';
import { _registerPluginForTest, _resetPluginsForTest } from '../../runtime/plugin-host.js';

/** 可枚举理由词表的取值集合——每个出口的 reason 必须落在其中。 */
const REASON_VOCABULARY: ReadonlySet<string> = new Set(Object.values(PERMISSION_DECISION_REASONS));

function decisionLogInserts(): ReadonlyArray<readonly unknown[]> {
  return mocks.sqliteRunMock.mock.calls
    .filter(
      ([query]) =>
        typeof query === 'string' && query.includes('INSERT INTO permission_decision_logs'),
    )
    .map((call) => call[1] as readonly unknown[]);
}

/**
 * 读取最后一条审计行的 `decision` / `reason`。
 *
 * 顺带强制校验 reason 落在可枚举词表内：任何「漏记成自由文本 / 记错词」的出口
 * 都会在此直接失败，而不只是与期望值不等——这是比逐例等值断言更强的守卫。
 */
function lastDecision(): { decision: string; reason: PermissionDecisionReason } | undefined {
  const inserts = decisionLogInserts();
  const last = inserts[inserts.length - 1];
  if (!last) return undefined;
  // 列顺序：request_id, session_id, tool_name, scope, decision, reason, workspace_root
  const reason = String(last[5]);
  expect(REASON_VOCABULARY.has(reason)).toBe(true);
  return {
    decision: String(last[4]),
    reason: reason as PermissionDecisionReason,
  };
}

function executionContext(clientRequestId: string) {
  return {
    clientRequestId,
    nextRound: 1,
    requestData: { clientRequestId },
  };
}

async function run(
  sessionId: string,
  toolName: string,
  rawInput: Record<string, unknown>,
): Promise<Awaited<ReturnType<typeof ensurePermissionForTool>>> {
  return ensurePermissionForTool(
    sessionId,
    { toolCallId: `call-${sessionId}`, toolName, rawInput },
    undefined,
    executionContext(`req-${sessionId}`),
  );
}

function writePermissionRule(rule: {
  permission: string;
  pattern: string;
  action: 'allow' | 'deny' | 'ask';
}): void {
  writeFileSync(
    join(TEST_WORKSPACE, '.openawork.permissions.json'),
    JSON.stringify({ rules: [rule] }),
    'utf8',
  );
}

describe('权限阶梯出口枚举——每出口恰好一条审计', () => {
  beforeEach(() => {
    rmSync(TEST_WORKSPACE, { recursive: true, force: true });
    mkdirSync(TEST_WORKSPACE, { recursive: true });
    _resetPluginsForTest();
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
    _resetPluginsForTest();
    vi.clearAllMocks();
    rmSync(TEST_WORKSPACE, { recursive: true, force: true });
  });

  it('出口1: 工具级 deny 早退 → rule_denied / denied（恰好一条）', async () => {
    mocks.metadataJson = JSON.stringify({ workingDirectory: TEST_WORKSPACE });
    writePermissionRule({ permission: 'bash', pattern: '*', action: 'deny' });

    const state = await run('exit-tool-deny', 'bash', { command: 'printf x', description: 'd' });

    expect(state.kind).toBe('denied');
    expect(decisionLogInserts()).toHaveLength(1);
    expect(lastDecision()).toEqual({ decision: 'denied', reason: 'rule_denied' });
  });

  it('出口3: 工具级 allow → rule_allowed / not_needed（恰好一条）', async () => {
    mocks.metadataJson = JSON.stringify({ workingDirectory: TEST_WORKSPACE });
    // read 类别默认 allow（DEFAULT_PERMISSION_RULES 通配符 allow）。
    const targetPath = join(TEST_WORKSPACE, 'tool-level-allow.txt');
    writeFileSync(targetPath, 'content', 'utf8');

    const state = await run('exit-tool-allow', 'read', { filePath: targetPath });

    expect(state.kind).not.toBe('denied');
    expect(decisionLogInserts()).toHaveLength(1);
    expect(lastDecision()).toEqual({ decision: 'not_needed', reason: 'rule_allowed' });
  });

  it('出口2: MCP 前置拒绝（通配符 allow 检查之前）→ mcp_denied / denied（恰好一条）', async () => {
    mocks.metadataJson = JSON.stringify({ workingDirectory: TEST_WORKSPACE });
    // MCP 派生器在配置解析失败时产出 denialReason；该出口在任何 allow / saved
    // approval 之前拦下，审计 reason 单列为 mcp_denied（不得记成 rule_denied）。
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mocks.getConfiguredMcpServerForSessionMock.mockImplementationOnce(() => {
      throw new Error('mcp config unavailable');
    });
    try {
      const state = await run('exit-mcp-predeny', 'mcp_call', {
        serverId: 'github',
        toolName: 'create_issue',
        arguments: {},
      });

      expect(state.kind).toBe('denied');
      expect(decisionLogInserts()).toHaveLength(1);
      expect(lastDecision()).toEqual({ decision: 'denied', reason: 'mcp_denied' });
    } finally {
      warn.mockRestore();
    }
  });

  it('出口6: 作用域级 allow → rule_allowed（恰好一条）', async () => {
    mocks.metadataJson = JSON.stringify({ workingDirectory: TEST_WORKSPACE });
    // 工具级通配符对 edit 是 ask（默认），作用域级对具体路径 allow。
    // 作用域是工作区相对路径（无目录分隔符），故 glob 用 `*.txt`。
    writePermissionRule({ permission: 'edit', pattern: '*.txt', action: 'allow' });
    const targetPath = join(TEST_WORKSPACE, 'scoped-allow.txt');
    writeFileSync(targetPath, 'before', 'utf8');

    const state = await run('exit-scoped-allow', 'edit', {
      filePath: targetPath,
      oldString: 'before',
      newString: 'after',
    });

    // 作用域级 allow 分支合成 requestId='workspace-rule' → outcome='approved'。
    expect(state.kind).toBe('approved');
    expect(decisionLogInserts()).toHaveLength(1);
    expect(lastDecision()).toEqual({ decision: 'approved', reason: 'rule_allowed' });
  });

  it('出口7: 作用域级 deny → rule_denied（恰好一条）', async () => {
    mocks.metadataJson = JSON.stringify({ workingDirectory: TEST_WORKSPACE });
    writePermissionRule({ permission: 'edit', pattern: 'blocked.txt', action: 'deny' });
    const targetPath = join(TEST_WORKSPACE, 'blocked.txt');
    writeFileSync(targetPath, 'before', 'utf8');

    const state = await run('exit-scoped-deny', 'edit', {
      filePath: targetPath,
      oldString: 'before',
      newString: 'after',
    });

    expect(state.kind).toBe('denied');
    expect(decisionLogInserts()).toHaveLength(1);
    expect(lastDecision()).toEqual({ decision: 'denied', reason: 'rule_denied' });
  });

  it('出口8: yolo 免审批 → mode_yolo（恰好一条）', async () => {
    mocks.metadataJson = JSON.stringify({
      permissionMode: 'yolo',
      workingDirectory: TEST_WORKSPACE,
    });

    const state = await run('exit-yolo', 'bash', { command: 'printf y', description: 'd' });

    expect(state.kind).not.toBe('denied');
    expect(decisionLogInserts()).toHaveLength(1);
    expect(lastDecision()).toEqual({ decision: 'not_needed', reason: 'mode_yolo' });
  });

  it('出口9: team 后台免审批 → team_background（恰好一条）', async () => {
    mocks.requireBoundWorkspace = true;
    mocks.roleLayer = 'executor';
    mocks.teamParentSessionId = 'team-root';
    mocks.handoffState = '{"status":"running"}';
    mocks.metadataJson = JSON.stringify({ workingDirectory: TEST_WORKSPACE });

    const state = await run('exit-team-bg', 'write', {
      path: join(TEST_WORKSPACE, 'team-bg.txt'),
      content: 'demo',
    });

    expect(state.kind).not.toBe('denied');
    expect(decisionLogInserts()).toHaveLength(1);
    expect(lastDecision()).toEqual({ decision: 'not_needed', reason: 'team_background' });
  });

  it('出口10: delegation 无人值守免审批 → delegation_unattended（恰好一条）', async () => {
    mocks.metadataJson = JSON.stringify({
      source: 'cron',
      workingDirectory: TEST_WORKSPACE,
    });
    // cron 无人值守仅放行委派类别（工具名 `task` → 类别 `task_run`）。
    // taskPermissionDeriver 需要 rawInput.description 才会派生上下文。
    const state = await run('exit-delegation', 'task', {
      description: 'do delegated work',
    });

    expect(state.kind).not.toBe('denied');
    expect(decisionLogInserts()).toHaveLength(1);
    expect(lastDecision()).toEqual({ decision: 'not_needed', reason: 'delegation_unattended' });
  });

  it('出口10b: reception 只读免审批 → reception_readonly（恰好一条）', async () => {
    mocks.requireBoundWorkspace = true;
    mocks.roleLayer = 'reception';
    mocks.teamParentSessionId = 'team-root';
    mocks.handoffState = '{"status":"running"}';
    mocks.metadataJson = JSON.stringify({ workingDirectory: TEST_WORKSPACE });
    writePermissionRule({ permission: 'read', pattern: '*', action: 'ask' });
    const targetPath = join(TEST_WORKSPACE, 'reception-read.txt');
    writeFileSync(targetPath, 'reception', 'utf8');

    const state = await run('exit-reception', 'read', { filePath: targetPath });

    expect(state.kind).not.toBe('denied');
    expect(decisionLogInserts()).toHaveLength(1);
    expect(lastDecision()).toEqual({ decision: 'not_needed', reason: 'reception_readonly' });
  });

  it('出口11: auto-edit 档位 → mode_auto_edit（恰好一条）', async () => {
    mocks.metadataJson = JSON.stringify({
      permissionMode: 'auto-edit',
      workingDirectory: TEST_WORKSPACE,
    });
    writePermissionRule({ permission: 'write', pattern: '**/*.txt', action: 'ask' });
    const targetPath = join(TEST_WORKSPACE, 'auto-edit.txt');

    const state = await run('exit-auto-edit', 'write', { path: targetPath, content: 'demo' });

    expect(state.kind).not.toBe('denied');
    expect(decisionLogInserts()).toHaveLength(1);
    expect(lastDecision()).toEqual({ decision: 'not_needed', reason: 'mode_auto_edit' });
  });

  it('出口12: 渠道会话已启用工具 → channel_policy（恰好一条）', async () => {
    // 渠道会话 + 该工具在渠道可见（isGatewayToolEnabledForSessionMetadata 为真）。
    // 需要 `channelLlmToolsEnabled=true` 且 `channel.tools.read=true`；用工作区规则 ask
    // 把 read 强制推到 channel_policy 分支。
    mocks.metadataJson = JSON.stringify({
      source: 'channel',
      channelLlmToolsEnabled: true,
      channel: { tools: { read: true } },
      workingDirectory: TEST_WORKSPACE,
    });
    writePermissionRule({ permission: 'read', pattern: '*', action: 'ask' });
    const targetPath = join(TEST_WORKSPACE, 'channel-read.txt');
    writeFileSync(targetPath, 'channel', 'utf8');

    const state = await run('exit-channel-policy', 'read', { filePath: targetPath });

    // 渠道可见工具应自动批准（state.kind='approved'，requestId='channel-policy'），
    // reason = channel_policy。
    expect(state.kind).toBe('approved');
    expect(decisionLogInserts()).toHaveLength(1);
    expect(lastDecision()).toEqual({ decision: 'approved', reason: 'channel_policy' });
  });

  it('出口14: 插件在 ask 阶段拒绝 → plugin_denied（恰好一条）', async () => {
    mocks.metadataJson = JSON.stringify({ workingDirectory: TEST_WORKSPACE });
    _registerPluginForTest('deny-ask', {
      'permission.evaluate': (event) => {
        event.effect = 'deny';
        event.message = '插件拒绝询问阶段';
      },
    });

    const state = await run('exit-plugin-ask', 'bash', { command: 'printf p', description: 'd' });

    expect(state).toMatchObject({ kind: 'denied' });
    expect(decisionLogInserts()).toHaveLength(1);
    expect(lastDecision()).toEqual({ decision: 'denied', reason: 'plugin_denied' });
  });

  it('出口15: 插件把 yolo 内置 allow 降级为 deny → plugin_denied 而非 mode_yolo（恰好一条）', async () => {
    mocks.metadataJson = JSON.stringify({
      permissionMode: 'yolo',
      workingDirectory: TEST_WORKSPACE,
    });
    _registerPluginForTest('deny-yolo', {
      'permission.evaluate': (event) => {
        event.effect = 'deny';
        event.message = '插件覆盖 yolo';
      },
    });

    const state = await run('exit-plugin-yolo', 'bash', { command: 'printf q', description: 'd' });

    expect(state.kind).toBe('denied');
    expect(decisionLogInserts()).toHaveLength(1);
    expect(lastDecision()).toEqual({ decision: 'denied', reason: 'plugin_denied' });
  });

  it('出口16: 渠道无审批通道 → channel_no_approval（恰好一条）', async () => {
    mocks.metadataJson = JSON.stringify({
      source: 'channel',
      workingDirectory: TEST_WORKSPACE,
    });

    // bash 在渠道默认不可见 → 走到渠道兜底拒绝。
    const state = await run('exit-channel-no-approval', 'bash', {
      command: 'printf c',
      description: 'd',
    });

    expect(state.kind).toBe('denied');
    expect(decisionLogInserts()).toHaveLength(1);
    expect(lastDecision()).toEqual({ decision: 'denied', reason: 'channel_no_approval' });
  });

  it('出口17: 新建 pending → awaiting_user / pending（恰好一条）', async () => {
    mocks.metadataJson = JSON.stringify({ workingDirectory: TEST_WORKSPACE });
    mocks.sqliteGetMock.mockImplementation((query: string) => {
      if (query.includes('SELECT id') && query.includes('status = ' + "'pending'"))
        return undefined;
      if (query.includes('SELECT metadata_json FROM sessions')) {
        return { metadata_json: mocks.metadataJson };
      }
      if (query.includes('SELECT user_id FROM sessions')) return { user_id: 'user-1' };
      return undefined;
    });

    const state = await run('exit-pending-new', 'bash', { command: 'printf n', description: 'd' });

    expect(state.kind).toBe('pending');
    expect(decisionLogInserts()).toHaveLength(1);
    expect(lastDecision()).toEqual({ decision: 'pending', reason: 'awaiting_user' });
  });

  it('出口19: 复用已有 pending → awaiting_user / pending（恰好一条，不新建）', async () => {
    mocks.metadataJson = JSON.stringify({ workingDirectory: TEST_WORKSPACE });
    mocks.sqliteGetMock.mockImplementation((query: string) => {
      if (query.includes('SELECT id') && query.includes("status = 'pending'")) {
        return { id: 'existing-pending' };
      }
      if (query.includes('SELECT user_id FROM sessions')) return { user_id: 'user-1' };
      if (query.includes('SELECT metadata_json FROM sessions')) {
        return { metadata_json: mocks.metadataJson };
      }
      return undefined;
    });

    const state = await run('exit-pending-reuse', 'bash', {
      command: 'printf n',
      description: 'd',
    });

    expect(state).toMatchObject({ kind: 'pending', requestId: 'existing-pending', created: false });
    expect(decisionLogInserts()).toHaveLength(1);
    expect(lastDecision()).toEqual({ decision: 'pending', reason: 'awaiting_user' });
  });

  it('出口5: 派生器声明免审批（context 为 null）→ deriver_not_required / not_needed（恰好一条）', async () => {
    mocks.metadataJson = JSON.stringify({ workingDirectory: TEST_WORKSPACE });
    // `memory_manage` 的通配符规则是 ask（defaultAction='ask'），但其派生器对
    // 所有 action 返回 null（工具已提议化，真正的写入门是提议决策路由）。此处
    // 的自动放行来自派生器而非规则，审计必须记 deriver_not_required，不得记
    // rule_allowed（否则把「规则 ask、派生器放行」误记成「规则放行」）。
    const state = await run('exit-deriver-not-required', 'memory_manage', {
      action: 'add',
      memory: { type: 'preference', key: 'editor', value: '偏好 Vim 键位' },
    });

    expect(state.kind).toBe('not_needed');
    expect(decisionLogInserts()).toHaveLength(1);
    expect(lastDecision()).toEqual({ decision: 'not_needed', reason: 'deriver_not_required' });
  });

  it('出口13: saved approval → saved_approval / approved（恰好一条）', async () => {
    mocks.metadataJson = JSON.stringify({ workingDirectory: TEST_WORKSPACE });
    mocks.sqliteAllMock.mockImplementation((query?: string, params?: readonly unknown[]) => {
      if (typeof query === 'string' && query.includes('FROM permission_grants')) {
        return params?.[0] === 'user-1'
          ? [{ id: 'grant-1', user_id: 'user-1', tool_name: 'bash', scope: '*' }]
          : [];
      }
      return [];
    });

    const state = await run('exit-saved-approval', 'bash', {
      command: 'printf s',
      description: 'd',
    });

    expect(state.kind).toBe('approved');
    expect(decisionLogInserts()).toHaveLength(1);
    expect(lastDecision()).toEqual({ decision: 'approved', reason: 'saved_approval' });
  });
});
