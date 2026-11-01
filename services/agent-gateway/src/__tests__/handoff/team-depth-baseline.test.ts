/**
 * T-01 编排深度基线（Phase 0，不改运行行为）
 *
 * 目的：为四类输入记录**改前水位**——产生的 handoff 数、接待层 LLM 轮次、以及
 * 直接回答（不建 handoff）的分支。后续 T-14/T-15/T-16 的深度分级要用它做对比：
 * 「单文件文案」这类 L1 输入当前会走完整 `reception → pm1` 链路，T-16 落地后
 * 必须降为 0 条 handoff，而本文件是这条对比的起点。
 *
 * 数值同时写入方案文档 `## Notes` 的基线表，本文件只用不变量断言 + 打印实测值，
 * 避免把易变的具体数字写死成假通过的快照。
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as OrchestratorModule from '../../handoff/runner/reception-orchestrator.js';
import type { HandleStreamResult } from '../../routes/stream-types.js';

const llmCompletion = vi.fn(async (cfg: { prompt: string }) => {
  if (cfg.prompt.includes('初始项目记忆骨架')) return '# 项目记忆';
  return '【改写结果】实现目标功能\n【推荐角色】planner\n【下一步】拆解并派发';
});
const runSessionInBackgroundMock = vi.fn<() => Promise<HandleStreamResult>>(async () => ({
  statusCode: 200,
  stopReason: 'end_turn',
}));

vi.mock('../../routes/workflow-llm.js', () => ({
  requestWorkflowLlmCompletion: (cfg: { prompt: string }) => llmCompletion(cfg),
}));
vi.mock('../../routes/stream-runtime.js', () => ({
  runSessionInBackground: runSessionInBackgroundMock,
}));

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let orchestrator: typeof OrchestratorModule;

const USER_ID = 'u-depth-baseline';
const SESSION_ID = 's-depth-baseline-reception';
const TEAM_WORKSPACE_ID = 'tw-depth-baseline';

interface BaselineRow {
  kind: string;
  intent: string;
  handoffs: number;
  handoffTargets: string;
  llmCalls: number;
  directStreamCalls: number;
  reason: string;
}

const baseline: BaselineRow[] = [];

function seedUser(): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    'depth-baseline@example.com',
  ]);
}

function seedReception(): void {
  dbModule.sqliteRun(
    `INSERT OR IGNORE INTO sessions (id, user_id, title, metadata_json, role_layer)
     VALUES (?, ?, 'reception', ?, 'reception')`,
    [SESSION_ID, USER_ID, JSON.stringify({ teamWorkspaceId: TEAM_WORKSPACE_ID })],
  );
}

function measure(kind: string, intent: string, reason: string): void {
  const handoffs = dbModule.sqliteAll<{ to_role_layer: string }>(
    `SELECT to_role_layer FROM handoff_records WHERE from_session_id = ?`,
    [SESSION_ID],
  );
  baseline.push({
    kind,
    intent,
    handoffs: handoffs.length,
    handoffTargets: handoffs.map((row) => row.to_role_layer).join(','),
    llmCalls: llmCompletion.mock.calls.length,
    directStreamCalls: runSessionInBackgroundMock.mock.calls.length,
    reason,
  });
}

async function runCase(kind: string, intent: string): Promise<string> {
  llmCompletion.mockClear();
  runSessionInBackgroundMock.mockClear();
  const result = await orchestrator.orchestrateReceptionInput({
    userId: USER_ID,
    receptionSessionId: SESSION_ID,
    userIntent: intent,
    persistAckMessage: false,
    // 基线只看路由与派发深度，不让自动初始化步骤混进模型轮次统计
    autoRunInit: false,
  });
  measure(kind, intent, result.reason ?? '');
  return result.reason ?? '';
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.migrate();
  orchestrator = await import('../../handoff/runner/reception-orchestrator.js');
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM handoff_records', []);
  dbModule.sqliteRun('DELETE FROM message_v2', []);
  dbModule.sqliteRun('DELETE FROM part_v2', []);
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  // 走 orchestrate 分支需要可用的辅助模型配置，否则只会得到 no-llm-config
  process.env['AI_API_BASE_URL'] = 'https://example.test/v1';
  process.env['AI_API_KEY'] = 'sk-test';
  process.env['AI_DEFAULT_MODEL'] = 'gpt-test';
  seedUser();
  seedReception();
});

afterAll(async () => {
  delete process.env['AI_API_BASE_URL'];
  delete process.env['AI_API_KEY'];
  delete process.env['AI_DEFAULT_MODEL'];
  // 基线表是 T-14/T-16 的对比依据，必须打印出来而不是只留在断言里
  console.log('[team-depth-baseline]', JSON.stringify(baseline, null, 2));
  await dbModule.closeDb();
});

describe('编排深度基线（Phase 0）', () => {
  it('只读研究不建 handoff，由接待层直接回答', async () => {
    const reason = await runCase('L0-只读研究', '解释一下这个模块是怎么工作的');
    expect(reason).toBe('light-answer');
    expect(dbModule.sqliteAll(`SELECT id FROM handoff_records`, [])).toHaveLength(0);
    expect(runSessionInBackgroundMock).toHaveBeenCalledTimes(1);
  });

  it('单文件文案走 L1 快车道：0 条 handoff、0 次改写调用，直接由接待层执行', async () => {
    // T-16 验收判据：基线中 L1 为 1 条 reception→pm1 handoff + 1 次意图改写，
    // 现在必须降为 0/0，并改为复用接待层后台执行。
    const reason = await runCase('L1-单文件文案', '修改登录按钮的文案');
    expect(reason).toBe('l1-fast-lane');
    expect(dbModule.sqliteAll(`SELECT id FROM handoff_records`, [])).toHaveLength(0);
    expect(llmCompletion).not.toHaveBeenCalled();
    expect(runSessionInBackgroundMock).toHaveBeenCalledTimes(1);
  });

  it('L1 快车道不吞掉用户原始需求，仍以原意图发起执行', async () => {
    await runCase('L1-单文件文案（载荷核对）', '修改登录按钮的文案');
    expect(runSessionInBackgroundMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: SESSION_ID,
        requestData: expect.objectContaining({ message: '修改登录按钮的文案' }),
      }),
    );
  });

  it('单模块功能同样进入完整链路，基线无法与单文件区分（T-15 需引入判据）', async () => {
    await runCase('L2-单模块功能', '实现订单提交接口并让前端调用');
    const targets = dbModule.sqliteAll<{ to_role_layer: string }>(
      `SELECT to_role_layer FROM handoff_records WHERE from_session_id = ?`,
      [SESSION_ID],
    );
    expect(targets.map((row) => row.to_role_layer)).toEqual(['pm1']);
  });

  it('跨模块输入先进入澄清拷问，此阶段不产生 handoff', async () => {
    const reason = await runCase('L3-跨模块', '重构整个系统架构');
    expect(reason).toBe('grill-started');
    expect(dbModule.sqliteAll(`SELECT id FROM handoff_records`, [])).toHaveLength(0);
  });
});
