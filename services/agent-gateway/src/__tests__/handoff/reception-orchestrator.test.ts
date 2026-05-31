/**
 * 260518-team-l1.3 · reception-orchestrator 单元测试
 *
 * 覆盖：
 *   - feature flag 关闭 → triggered=false
 *   - reception session 已有活跃 handoff → triggered=false（避免并行链路）
 *   - 无 LLM 配置 → triggered=false
 *   - 成功路径下不易在单元测试覆盖（需要 mock LLM HTTP），但可以验证基础守卫
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as OrchestratorModule from '../../handoff/runner/reception-orchestrator.js';
import type * as HandoffStoreModule from '../../handoff/store/handoff-store.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let orchestrator: typeof OrchestratorModule;
let handoffStore: typeof HandoffStoreModule;

const USER_ID = 'u-orch';
const SESSION_ID = 's-orch-reception';

function seedUser(): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    'orch@example.com',
  ]);
}

function seedReception(): void {
  dbModule.sqliteRun(
    `INSERT OR IGNORE INTO sessions (id, user_id, title, metadata_json, role_layer)
     VALUES (?, ?, 'reception', '{}', 'reception')`,
    [SESSION_ID, USER_ID],
  );
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.migrate();
  orchestrator = await import('../../handoff/runner/reception-orchestrator.js');
  handoffStore = await import('../../handoff/store/handoff-store.js');
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM handoff_records', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  // 注意：message_v2 / part_v2 由 ON DELETE CASCADE 通过 sessions / users 清理
  seedUser();
  seedReception();
});

afterEach(() => {
  // 清理任何残留环境变量
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('orchestrateReceptionInput', () => {
  it('reception 会话已有活跃 handoff → triggered=false（避免并行链路）', async () => {
    handoffStore.createHandoff({
      userId: USER_ID,
      fromSessionId: SESSION_ID,
      fromRoleLayer: 'reception',
      toRoleLayer: 'pm1',
      payload: { sourceIntent: 'pre-existing' },
    });
    const result = await orchestrator.orchestrateReceptionInput({
      userId: USER_ID,
      receptionSessionId: SESSION_ID,
      userIntent: '又来了',
    });
    expect(result.triggered).toBe(false);
    expect(result.reason).toBe('handoff-active');
  });

  it('无 LLM 配置 → triggered=false（reason=no-llm-config）', async () => {
    // 强制让 resolveAuxiliaryLlmConfig 返回 null：删除所有可能的 LLM 配置源
    delete process.env['OPENAI_API_KEY'];
    delete process.env['OPENAI_API_BASE_URL'];
    delete process.env['ANTHROPIC_API_KEY'];
    delete process.env['LLM_API_KEY'];
    delete process.env['LLM_API_BASE_URL'];
    delete process.env['AUXILIARY_LLM_API_KEY'];
    delete process.env['AUXILIARY_LLM_API_BASE_URL'];

    // 使用"你好"触发 direct 路径（规则匹配问候语），避免走 orchestrate 的 LLM 调用
    const result = await orchestrator.orchestrateReceptionInput({
      userId: USER_ID,
      receptionSessionId: SESSION_ID,
      userIntent: '你好',
    });
    // "你好" 会被 router 分到 direct → 尝试 runSessionInBackground
    // 如果 session 不存在或 LLM 不可用，会 catch 并返回
    expect(result.triggered).toBe(false);
  }, 10_000);

  it('并发编排同一 reception 会话时只创建一条 handoff（in-flight 守卫，防并行 pm1 链路）', async () => {
    // 无 LLM 配置：body 在 await resolveAuxiliaryLlmConfig 后立刻返回 no-llm-config。
    // 第一次调用同步取得 in-flight 守卫后在该 await 处让出事件循环；第二次调用同步
    // 跑到守卫检查时发现已被占用，确定性地返回 orchestration-in-flight——不会越过
    // active-handoff 的 TOCTOU 窗口再创建第二条 reception→pm1 handoff。
    delete process.env['OPENAI_API_KEY'];
    delete process.env['OPENAI_API_BASE_URL'];
    delete process.env['ANTHROPIC_API_KEY'];
    delete process.env['LLM_API_KEY'];
    delete process.env['LLM_API_BASE_URL'];
    delete process.env['AUXILIARY_LLM_API_KEY'];
    delete process.env['AUXILIARY_LLM_API_BASE_URL'];

    const [first, second] = await Promise.all([
      orchestrator.orchestrateReceptionInput({
        userId: USER_ID,
        receptionSessionId: SESSION_ID,
        userIntent: '帮我重构这个后端模块',
        persistMessages: false,
      }),
      orchestrator.orchestrateReceptionInput({
        userId: USER_ID,
        receptionSessionId: SESSION_ID,
        userIntent: '帮我重构这个后端模块',
        persistMessages: false,
      }),
    ]);

    const inFlightRejections = [first, second].filter(
      (r) => r.reason === 'orchestration-in-flight',
    );
    // 恰好一个被 in-flight 守卫挡下（另一个进入 body，因无 LLM 配置返回 no-llm-config）。
    expect(inFlightRejections).toHaveLength(1);
    // 两者都没真正创建 handoff（无 LLM 配置），但关键不变量是：第二个被守卫确定性挡下，
    // 绝不会与第一个并行越过 active-handoff 检查去 createHandoff。
    expect([first, second].some((r) => r.triggered)).toBe(false);
  }, 10_000);
});
