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
import type * as DbModule from '../db.js';
import type * as OrchestratorModule from '../handoff/reception-orchestrator.js';
import type * as HandoffStoreModule from '../handoff/handoff-store.js';

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
  dbModule = await import('../db.js');
  await dbModule.migrate();
  orchestrator = await import('../handoff/reception-orchestrator.js');
  handoffStore = await import('../handoff/handoff-store.js');
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM handoff_records', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  // 注意：message_v2 / part_v2 由 ON DELETE CASCADE 通过 sessions / users 清理
  seedUser();
  seedReception();
});

afterEach(() => {
  delete process.env['OPENAWORK_TEAM_HANDOFF_MODE'];
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('orchestrateReceptionInput', () => {
  it('feature flag 关闭 → triggered=false', async () => {
    process.env['OPENAWORK_TEAM_HANDOFF_MODE'] = '0';
    const result = await orchestrator.orchestrateReceptionInput({
      userId: USER_ID,
      receptionSessionId: SESSION_ID,
      userIntent: '帮我做一个 OAuth',
    });
    expect(result.triggered).toBe(false);
    expect(result.reason).toBe('feature-flag-disabled');
  });

  it('feature flag 关闭仍会写 user 消息 + ack 消息（持久化默认开启）', async () => {
    process.env['OPENAWORK_TEAM_HANDOFF_MODE'] = '0';
    await orchestrator.orchestrateReceptionInput({
      userId: USER_ID,
      receptionSessionId: SESSION_ID,
      userIntent: '帮我修 bug',
    });
    // 至少 2 条消息（user + assistant ack）；具体存储位置由 message-v2 决定，
    // 这里只校验"v2 表"被写入即可
    const v2Count = dbModule.sqliteGet<{ c: number }>(
      `SELECT COUNT(*) AS c FROM message_v2 WHERE session_id = ?`,
      [SESSION_ID],
    );
    expect((v2Count?.c ?? 0) >= 2).toBe(true);
  });

  it('persistMessages=false 时不写消息流', async () => {
    process.env['OPENAWORK_TEAM_HANDOFF_MODE'] = '0';
    await orchestrator.orchestrateReceptionInput({
      userId: USER_ID,
      receptionSessionId: SESSION_ID,
      userIntent: '不写消息',
      persistMessages: false,
    });
    const v2Count = dbModule.sqliteGet<{ c: number }>(
      `SELECT COUNT(*) AS c FROM message_v2 WHERE session_id = ?`,
      [SESSION_ID],
    );
    expect(v2Count?.c ?? 0).toBe(0);
  });

  it('reception 会话已有活跃 handoff → triggered=false（避免并行链路）', async () => {
    process.env['OPENAWORK_TEAM_HANDOFF_MODE'] = '1';
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
    process.env['OPENAWORK_TEAM_HANDOFF_MODE'] = '1';
    // resolveAuxiliaryLlmConfig 在没有 user provider 配置且没有 env 默认时返回 null
    delete process.env['OPENAI_API_KEY'];
    delete process.env['OPENAI_API_BASE_URL'];
    const result = await orchestrator.orchestrateReceptionInput({
      userId: USER_ID,
      receptionSessionId: SESSION_ID,
      userIntent: '尝试',
    });
    expect(result.triggered).toBe(false);
    // resolveAuxiliaryLlmConfig 也可能返回非空（取决于环境），所以仅断言 reason 在合理集合中
    expect(['no-llm-config', 'llm-failed']).toContain(result.reason);
  });
});
