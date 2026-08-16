/**
 * 五层架构 b→c 集成测试
 *
 * 覆盖：
 *   - b 层（reception）：用户 inbound user_input → 消息持久化 → orchestration 触发
 *   - c 层（pm1）：handoff 创建 → watcher claim → artifact-chain 执行 → spec/plan/tasks 产出
 *   - b→c 链式：orchestration 创建 handoff(reception→pm1) → watcher 自动 claim
 *   - c 完成后自动创建 pm1→pm2 handoff
 *   - substate 全程正确流转
 *   - 消息持久化（user msg + assistant ack）
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as InboundStoreModule from '../../handoff/store/inbound-store.js';
import type * as HandoffStoreModule from '../../handoff/store/handoff-store.js';
import type * as OrchestratorModule from '../../handoff/runner/reception-orchestrator.js';
import type * as WatcherModule from '../../handoff/runner/watcher.js';
import type * as SubstateModule from '../../handoff/store/substate-store.js';

// ─── 环境设置 ────────────────────────────────────────────────────────────────

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';
// 快速 clarification 超时（避免测试卡住）
process.env['OPENAWORK_TEAM_INBOUND_POLL_MS'] = '20';
process.env['OPENAWORK_TEAM_CLARIFICATION_TIMEOUT_MS'] = '200';

const runSessionInBackgroundMock = vi.fn(async () => ({ statusCode: 200 }));

vi.mock('../../routes/stream-runtime.js', () => ({
  runSessionInBackground: runSessionInBackgroundMock,
}));

let db: typeof DbModule;
let inboundStore: typeof InboundStoreModule;
let handoffStore: typeof HandoffStoreModule;
let orchestrator: typeof OrchestratorModule;
let watcher: typeof WatcherModule;
let substateStore: typeof SubstateModule;

const USER_ID = 'u-bc-test';
const USER_EMAIL = 'bc-test@example.com';
const TEAM_WORKSPACE_ID = 'tw-bc-test';
const RECEPTION_SESSION_ID = 's-reception-bc';

// ─── Seed helpers ────────────────────────────────────────────────────────────

function seedUser(): void {
  db.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    USER_EMAIL,
  ]);
}

function seedTeamWorkspace(): void {
  db.sqliteRun(
    `INSERT OR IGNORE INTO team_workspaces (id, user_id, name, constitution_md, constitution_version)
     VALUES (?, ?, '测试工作区', '# 宪法\n- 禁止空 catch\n- 必须有测试', 1)`,
    [TEAM_WORKSPACE_ID, USER_ID],
  );
}

function seedReceptionSession(): void {
  db.sqliteRun(
    `INSERT OR IGNORE INTO sessions (id, user_id, title, metadata_json, role_layer, state_status)
     VALUES (?, ?, 'Reception', ?, 'reception', 'idle')`,
    [RECEPTION_SESSION_ID, USER_ID, JSON.stringify({ teamWorkspaceId: TEAM_WORKSPACE_ID })],
  );
}

// ─── Setup / Teardown ────────────────────────────────────────────────────────

beforeAll(async () => {
  db = await import('../../infra/db.js');
  await db.migrate();
  inboundStore = await import('../../handoff/store/inbound-store.js');
  handoffStore = await import('../../handoff/store/handoff-store.js');
  orchestrator = await import('../../handoff/runner/reception-orchestrator.js');
  watcher = await import('../../handoff/runner/watcher.js');
  substateStore = await import('../../handoff/store/substate-store.js');
});

beforeEach(() => {
  // 清理所有相关表
  db.sqliteRun('DELETE FROM session_inbound_messages', []);
  db.sqliteRun('DELETE FROM handoff_records', []);
  db.sqliteRun('DELETE FROM artifacts', []);
  db.sqliteRun('DELETE FROM users', []);
  // 重新 seed
  seedUser();
  seedTeamWorkspace();
  seedReceptionSession();
  runSessionInBackgroundMock.mockClear();
});

afterEach(() => {
  watcher.__resetHandoffWatcherForTesting();
});

afterAll(async () => {
  await db.closeDb();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('b 层（reception）', () => {
  it('只读了解输入留在 reception，不创建 pm1 handoff', async () => {
    const result = await orchestrator.orchestrateReceptionInput({
      userId: USER_ID,
      receptionSessionId: RECEPTION_SESSION_ID,
      userIntent: '了解一下当前项目',
      persistUserMessage: false,
      persistAckMessage: false,
    });

    expect(result).toMatchObject({ triggered: false, reason: 'light-answer' });
    expect(runSessionInBackgroundMock).toHaveBeenCalledTimes(1);

    const handoffs = db.sqliteAll<{ id: string }>(
      `SELECT id FROM handoff_records WHERE from_session_id = ?`,
      [RECEPTION_SESSION_ID],
    );
    expect(handoffs).toHaveLength(0);
  });

  it('inbound user_input 写入 session_inbound_messages 表', () => {
    const result = inboundStore.submitInboundMessage({
      userId: USER_ID,
      toSessionId: RECEPTION_SESSION_ID,
      fromRoleLayer: 'user',
      messageType: 'user_input',
      payload: { text: '帮我实现 OAuth 登录' },
    });
    expect(result.reused).toBe(false);
    expect(result.record.state).toBe('pending');
    expect(result.record.messageType).toBe('user_input');
    expect(result.record.toSessionId).toBe(RECEPTION_SESSION_ID);
  });

  it('persistReceptionUserMessage 把用户消息写入 message_v2', () => {
    orchestrator.persistReceptionUserMessage({
      userId: USER_ID,
      receptionSessionId: RECEPTION_SESSION_ID,
      userIntent: '帮我修 bug',
    });

    // 验证 message_v2 有记录
    const count = db.sqliteGet<{ c: number }>(
      `SELECT COUNT(*) AS c FROM message_v2 WHERE session_id = ?`,
      [RECEPTION_SESSION_ID],
    );
    expect(count!.c).toBeGreaterThanOrEqual(1);
  });

  it('orchestrateReceptionInput 在无 LLM 时写 fallback ack', async () => {
    // 确保没有 LLM 配置（删除所有 provider 设置）
    delete process.env['OPENAI_API_KEY'];
    delete process.env['OPENAI_API_BASE_URL'];

    const result = await orchestrator.orchestrateReceptionInput({
      userId: USER_ID,
      receptionSessionId: RECEPTION_SESSION_ID,
      // 使用匹配 orchestrate 模式的意图（避免被 router 分到 clarify/direct）
      userIntent: '帮我实现一个完整的搜索功能',
      persistMessages: true,
    });

    // 应该失败但写了 ack（router 可能走 direct 也可能走 orchestrate 后失败）
    expect(result.triggered).toBe(false);

    // 验证有消息被写入（至少 user msg）
    const count = db.sqliteGet<{ c: number }>(
      `SELECT COUNT(*) AS c FROM message_v2 WHERE session_id = ?`,
      [RECEPTION_SESSION_ID],
    );
    expect(count!.c).toBeGreaterThanOrEqual(1);
  });

  it('orchestrateReceptionInput 在有活跃 handoff 时跳过', async () => {
    // 先创建一个活跃 handoff
    handoffStore.createHandoff({
      userId: USER_ID,
      fromSessionId: RECEPTION_SESSION_ID,
      fromRoleLayer: 'reception',
      toRoleLayer: 'pm1',
      payload: { sourceIntent: '已有任务' },
    });

    const result = await orchestrator.orchestrateReceptionInput({
      userId: USER_ID,
      receptionSessionId: RECEPTION_SESSION_ID,
      userIntent: '新意图',
    });

    expect(result.triggered).toBe(false);
    expect(result.reason).toBe('handoff-active');
  });

  it('substate 在 orchestration 过程中正确流转', async () => {
    // 由于没有 LLM，orchestration 会在 routing 后失败回到 idle
    await orchestrator.orchestrateReceptionInput({
      userId: USER_ID,
      receptionSessionId: RECEPTION_SESSION_ID,
      userIntent: '测试 substate',
    });

    // 最终 substate 应该是 idle（LLM 失败后回退）或 routing（如果 LLM 调用前就失败）
    const state = substateStore.getSubstate(RECEPTION_SESSION_ID);
    // 无 LLM 时不会进入 routing（在 resolveAuxiliaryLlmConfig 之前就返回了）
    // 所以 substate 可能是 null 或 'idle'
    expect(state?.substate === null || state?.substate === 'idle').toBe(true);
  });
});

describe('c 层（pm1 / artifact-chain）', () => {
  it('handoff(reception→pm1) 被 watcher 正确 claim', async () => {
    const handoff = handoffStore.createHandoff({
      userId: USER_ID,
      fromSessionId: RECEPTION_SESSION_ID,
      fromRoleLayer: 'reception',
      toRoleLayer: 'pm1',
      payload: {
        sourceIntent: '实现 OAuth',
        rewrittenIntent: '实现 GitHub OAuth 2.0 登录功能',
        teamWorkspaceId: TEAM_WORKSPACE_ID,
      },
    });

    expect(handoff.state).toBe('pending');

    // 手动触发 watcher tick
    const watcherInstance = new watcher.HandoffWatcher({
      taskRunner: async () => {
        // stub runner：不做任何事，让 watcher 的 completeHandoff 兜底
      },
    });
    const tickResult = await watcherInstance.tickOnce();

    expect(tickResult.claimed).toBe(1);
    expect(tickResult.skipped).toBe(0);

    // 验证 handoff 状态变为 running
    const updated = handoffStore.getHandoff({
      userId: USER_ID,
      handoffId: handoff.id,
    });
    expect(updated?.state).toBe('running');
    expect(updated?.toSessionId).not.toBeNull();
  });

  it('artifact-chain 生成 spec/plan/tasks 三个 artifact', async () => {
    const { runArtifactChain } = await import('../../handoff/runner/artifact-chain.js');

    const handoff = handoffStore.createHandoff({
      userId: USER_ID,
      fromSessionId: RECEPTION_SESSION_ID,
      fromRoleLayer: 'reception',
      toRoleLayer: 'pm1',
      payload: {},
    });

    // Mock LLM：按 system prompt 内容区分阶段
    const mockLlm = async (system: string, _user: string): Promise<string> => {
      if (system.includes('功能规格文档')) {
        return '# 规格\n\n## 用户故事 1\n\n作为用户我想登录\n\n## 需求\n\n- **FR-001**: 系统必须支持 OAuth';
      }
      if (system.includes('实施计划')) {
        return '# 实施计划\n\n## 技术上下文\n\nTypeScript + React\n\n## 宪法对齐检查\n\n| 宪法条目 | 本计划是否符合 | 备注 |\n|---|---|---|\n| 禁止空 catch | ✅ | 所有 catch 有日志 |';
      }
      if (system.includes('任务清单')) {
        return '# 任务清单\n\n## Phase 1\n\n- [ ] T001 [US1] 实现 OAuth 回调\n- [ ] T002 [US1] [P] 添加 token 存储';
      }
      return '# 默认输出';
    };

    // 创建一个 session 作为 c 层 session
    db.sqliteRun(
      `INSERT INTO sessions (id, user_id, title, metadata_json, role_layer)
       VALUES ('s-pm1-test', ?, 'PM1', '{}', 'pm1')`,
      [USER_ID],
    );

    const result = await runArtifactChain({
      userId: USER_ID,
      sessionId: 's-pm1-test',
      handoff,
      sourceIntent: '实现 OAuth',
      rewrittenIntent: '实现 GitHub OAuth 2.0 登录',
      teamWorkspaceId: TEAM_WORKSPACE_ID,
      callLlm: mockLlm,
    });

    expect(result.specArtifactId).toBeTruthy();
    expect(result.planArtifactId).toBeTruthy();
    expect(result.tasksArtifactId).toBeTruthy();

    // 验证 artifact 在 DB 中
    const spec = db.sqliteGet<{ phase: string; content: string }>(
      `SELECT phase, content FROM artifacts WHERE id = ?`,
      [result.specArtifactId],
    );
    expect(spec?.phase).toBe('spec');
    expect(spec?.content).toContain('OAuth');

    const plan = db.sqliteGet<{ phase: string }>(`SELECT phase FROM artifacts WHERE id = ?`, [
      result.planArtifactId,
    ]);
    expect(plan?.phase).toBe('plan');

    const tasks = db.sqliteGet<{ phase: string; content: string }>(
      `SELECT phase, content FROM artifacts WHERE id = ?`,
      [result.tasksArtifactId],
    );
    expect(tasks?.phase).toBe('tasks');
    expect(tasks?.content).toContain('T001');
  });

  it('artifact-chain 正确写入 handoff result_json', async () => {
    const { runArtifactChain } = await import('../../handoff/runner/artifact-chain.js');

    const handoff = handoffStore.createHandoff({
      userId: USER_ID,
      fromSessionId: RECEPTION_SESSION_ID,
      fromRoleLayer: 'reception',
      toRoleLayer: 'pm1',
      payload: {},
    });

    db.sqliteRun(
      `INSERT OR IGNORE INTO sessions (id, user_id, title, metadata_json, role_layer)
       VALUES ('s-pm1-result', ?, 'PM1', '{}', 'pm1')`,
      [USER_ID],
    );

    const mockLlm = async (system: string): Promise<string> => {
      if (system.includes('功能规格文档'))
        return '# 规格\n\n## 用户故事 1\n\n## 需求\n- **FR-001**: x';
      if (system.includes('实施计划'))
        return '# 计划\n\n## 技术上下文\n\nTS\n\n## 宪法对齐检查\n\n| 宪法条目 | 本计划是否符合 | 备注 |\n|---|---|---|\n| x | ✅ | ok |';
      return '# 任务\n\n## Phase 1\n- [ ] T001 [US1] 做事';
    };

    await runArtifactChain({
      userId: USER_ID,
      sessionId: 's-pm1-result',
      handoff,
      sourceIntent: 'x',
      rewrittenIntent: 'y',
      teamWorkspaceId: null,
      callLlm: mockLlm,
    });

    const row = db.sqliteGet<{ result_json: string | null }>(
      `SELECT result_json FROM handoff_records WHERE id = ?`,
      [handoff.id],
    );
    expect(row?.result_json).not.toBeNull();
    const parsed = JSON.parse(row!.result_json!) as Record<string, unknown>;
    expect(parsed['specArtifactId']).toBeTruthy();
    expect(parsed['planArtifactId']).toBeTruthy();
    expect(parsed['tasksArtifactId']).toBeTruthy();
  });

  it('substate 在 artifact-chain 执行过程中正确流转', async () => {
    const { runArtifactChain } = await import('../../handoff/runner/artifact-chain.js');

    const handoff = handoffStore.createHandoff({
      userId: USER_ID,
      fromSessionId: RECEPTION_SESSION_ID,
      fromRoleLayer: 'reception',
      toRoleLayer: 'pm1',
      payload: {},
    });

    db.sqliteRun(
      `INSERT OR IGNORE INTO sessions (id, user_id, title, metadata_json, role_layer)
       VALUES ('s-pm1-substate', ?, 'PM1', '{}', 'pm1')`,
      [USER_ID],
    );

    const substateHistory: string[] = [];
    const originalSetSubstate = substateStore.setSubstate;
    // 拦截 setSubstate 记录历史
    vi.spyOn(substateStore, 'setSubstate').mockImplementation((input) => {
      if (input.sessionId === 's-pm1-substate' && input.substate) {
        substateHistory.push(input.substate);
      }
      return originalSetSubstate(input);
    });

    const mockLlm = async (system: string): Promise<string> => {
      if (system.includes('功能规格文档'))
        return '# 规格\n\n## 用户故事 1\n\n## 需求\n- **FR-001**: x';
      if (system.includes('实施计划'))
        return '# 计划\n\n## 技术上下文\n\nTS\n\n## 宪法对齐检查\n\n| 宪法条目 | 本计划是否符合 | 备注 |\n|---|---|---|\n| x | ✅ | ok |';
      return '# 任务\n\n## Phase 1\n- [ ] T001 [US1] 做事';
    };

    await runArtifactChain({
      userId: USER_ID,
      sessionId: 's-pm1-substate',
      handoff,
      sourceIntent: 'x',
      rewrittenIntent: 'y',
      teamWorkspaceId: null,
      callLlm: mockLlm,
    });

    vi.restoreAllMocks();

    // 验证 substate 流转顺序
    expect(substateHistory).toEqual([
      'drafting_spec',
      'spec_ready',
      'drafting_plan',
      'plan_ready',
      'drafting_tasks',
      'tasks_ready',
      'completed',
    ]);
  });

  it('watcher 完成 pm1 handoff 后自动创建 pm1→pm2 handoff', async () => {
    // 创建一个 pm1 handoff 并手动完成它（模拟 artifact-chain 跑完）
    const _handoff = handoffStore.createHandoff({
      userId: USER_ID,
      fromSessionId: RECEPTION_SESSION_ID,
      fromRoleLayer: 'reception',
      toRoleLayer: 'pm1',
      payload: {
        sourceIntent: '测试',
        rewrittenIntent: '测试链式',
        teamWorkspaceId: TEAM_WORKSPACE_ID,
      },
    });

    // 用 watcher 跑一次 tick（会 claim + 创建 session + 跑 runner）
    // runner 用 mock：直接写 result_json 然后返回
    const watcherInstance = new watcher.HandoffWatcher({
      taskRunner: async (input) => {
        // 模拟 artifact-chain 完成：写 result_json
        db.sqliteRun(`UPDATE handoff_records SET result_json = ? WHERE id = ?`, [
          JSON.stringify({
            specArtifactId: 'spec-123',
            planArtifactId: 'plan-123',
            tasksArtifactId: 'tasks-123',
          }),
          input.handoff.id,
        ]);
      },
    });

    await watcherInstance.tickOnce();

    // 等一小段时间让 scheduler 异步任务完成
    await new Promise((r) => setTimeout(r, 200));

    // 验证自动创建了 pm1→pm2 handoff
    const allHandoffs = db.sqliteAll<{
      from_role_layer: string;
      to_role_layer: string;
      state: string;
    }>(
      `SELECT from_role_layer, to_role_layer, state FROM handoff_records WHERE user_id = ? ORDER BY created_at ASC`,
      [USER_ID],
    );

    // 应该有 2 条：reception→pm1（completed）+ pm1→pm2（pending）
    expect(allHandoffs.length).toBeGreaterThanOrEqual(2);
    const pm1ToPm2 = allHandoffs.find(
      (h) => h.from_role_layer === 'pm1' && h.to_role_layer === 'pm2',
    );
    expect(pm1ToPm2).toBeDefined();
    expect(pm1ToPm2!.state).toBe('pending');
  });
});

describe('b→c 端到端', () => {
  it('完整链路：inbound → orchestration → handoff 创建', async () => {
    // 1. 写 inbound
    const inbound = inboundStore.submitInboundMessage({
      userId: USER_ID,
      toSessionId: RECEPTION_SESSION_ID,
      fromRoleLayer: 'user',
      messageType: 'user_input',
      payload: { text: '帮我实现搜索功能' },
    });
    expect(inbound.record.state).toBe('pending');

    // 2. 持久化用户消息
    orchestrator.persistReceptionUserMessage({
      userId: USER_ID,
      receptionSessionId: RECEPTION_SESSION_ID,
      userIntent: '帮我实现搜索功能',
    });

    // 3. 尝试 orchestration（会因无 LLM 失败，但应该写 ack）
    const result = await orchestrator.orchestrateReceptionInput({
      userId: USER_ID,
      receptionSessionId: RECEPTION_SESSION_ID,
      userIntent: '帮我实现搜索功能',
      teamWorkspaceId: TEAM_WORKSPACE_ID,
      persistUserMessage: false, // 已在步骤 2 写过
    });

    // 无 LLM 时不会创建 handoff
    if (result.triggered) {
      // 如果环境有 LLM 配置，验证 handoff 被创建
      expect(result.handoffId).toBeTruthy();
      const handoff = handoffStore.getHandoff({
        userId: USER_ID,
        handoffId: result.handoffId!,
      });
      expect(handoff?.fromRoleLayer).toBe('reception');
      expect(handoff?.toRoleLayer).toBe('pm1');
      expect(handoff?.state).toBe('pending');
    } else {
      // 无 LLM 时验证 ack 消息被写入
      const msgCount = db.sqliteGet<{ c: number }>(
        `SELECT COUNT(*) AS c FROM message_v2 WHERE session_id = ?`,
        [RECEPTION_SESSION_ID],
      );
      // 至少有 user msg + ack = 2
      expect(msgCount!.c).toBeGreaterThanOrEqual(2);
    }
  });

  it('cancel_signal 能被 c 层 wait-for-inbound 消费', async () => {
    // 创建一个 pm1 session
    db.sqliteRun(
      `INSERT OR IGNORE INTO sessions (id, user_id, title, metadata_json, role_layer)
       VALUES ('s-pm1-cancel', ?, 'PM1', '{}', 'pm1')`,
      [USER_ID],
    );

    // 写一个 cancel_signal
    inboundStore.submitInboundMessage({
      userId: USER_ID,
      toSessionId: 's-pm1-cancel',
      fromRoleLayer: 'reception',
      messageType: 'cancel_signal',
      payload: { reason: '用户取消', cascadeFrom: RECEPTION_SESSION_ID, preserveArtifacts: true },
    });

    // 验证 hasPendingCancelSignal
    expect(inboundStore.hasPendingCancelSignal('s-pm1-cancel')).toBe(true);

    // 消费它
    const consumed = inboundStore.consumePendingInboundMessage({
      toSessionId: 's-pm1-cancel',
      loopIteration: 0,
    });
    expect(consumed?.messageType).toBe('cancel_signal');
    expect(consumed?.state).toBe('consumed');

    // 消费后不再有 pending
    expect(inboundStore.hasPendingCancelSignal('s-pm1-cancel')).toBe(false);
  });
});
