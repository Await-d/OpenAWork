import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as HandoffStoreModule from '../../handoff/store/handoff-store.js';
import type * as ReviewAggregatorModule from '../../handoff/workflow/review-aggregator.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let reviewAggregator: typeof ReviewAggregatorModule;

const USER_ID = 'u-review-readiness';
const PM2_SESSION_ID = 's-review-readiness-pm2';

function seedUserAndSessions(): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    'readiness@example.com',
  ]);
  dbModule.sqliteRun(
    `INSERT OR IGNORE INTO sessions (id, user_id, title, metadata_json, role_layer)
     VALUES (?, ?, 'pm2', '{}', 'pm2')`,
    [PM2_SESSION_ID, USER_ID],
  );
}

/**
 * 直接插入一条 handoff 记录，可指定 state / failure_reason / result_json。
 * createHandoff 只产生 pending 记录，测试需要手动构造终态。
 */
function seedChildHandoff(input: {
  id: string;
  state: string;
  resultJson?: string | null;
  failureReason?: string | null;
  payload?: Record<string, unknown>;
}): void {
  dbModule.sqliteRun(
    `INSERT INTO handoff_records
       (id, user_id, from_session_id, from_role_layer, to_role_layer, to_session_id,
        payload_json, result_json, state, failure_reason, retry_count, paused,
        idempotency_key, created_at, updated_at)
     VALUES (?, ?, ?, 'pm2', 'executor', NULL, ?, ?, ?, ?, 0, 0, NULL, datetime('now'), datetime('now'))`,
    [
      input.id,
      USER_ID,
      PM2_SESSION_ID,
      JSON.stringify(input.payload ?? { goal: '测试任务', taskMarkers: { taskId: 'T001' } }),
      input.resultJson ?? null,
      input.state,
      input.failureReason ?? null,
    ],
  );
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.migrate();
  reviewAggregator = await import('../../handoff/workflow/review-aggregator.js');
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM artifacts', []);
  dbModule.sqliteRun('DELETE FROM handoff_records', []);
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  seedUserAndSessions();
});

afterAll(async () => {
  await dbModule.closeDb();
});

/**
 * 从 DB 读取一条 handoff 记录并构造 HandoffRecord 形状，
 * 以便直接传给 runReviewAggregation。
 */
function getHandoffAsRecord(id: string): HandoffStoreModule.HandoffRecord {
  const row = dbModule.sqliteGet<{
    id: string;
    user_id: string;
    from_session_id: string;
    from_role_layer: string;
    to_role_layer: string;
    to_session_id: string | null;
    payload_json: string;
    result_json: string | null;
    state: string;
    claim_token: string | null;
    claimed_at: string | null;
    started_at: string | null;
    completed_at: string | null;
    failure_reason: string | null;
    retry_count: number;
    idempotency_key: string | null;
    paused: number;
    paused_at: string | null;
    paused_by_user_id: string | null;
    pause_reason: string | null;
    created_at: string;
    updated_at: string;
  }>(`SELECT * FROM handoff_records WHERE id = ?`, [id]);
  if (!row) throw new Error(`handoff ${id} not found`);
  return {
    id: row.id,
    userId: row.user_id,
    fromSessionId: row.from_session_id,
    fromRoleLayer: row.from_role_layer as HandoffStoreModule.HandoffRoleLayer,
    toRoleLayer: row.to_role_layer as HandoffStoreModule.HandoffRoleLayer,
    toSessionId: row.to_session_id,
    payload: row.payload_json ? JSON.parse(row.payload_json) : null,
    resultJson: row.result_json ? JSON.parse(row.result_json) : null,
    state: row.state as HandoffStoreModule.HandoffState,
    claimToken: row.claim_token,
    claimedAt: row.claimed_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    failureReason: row.failure_reason,
    retryCount: row.retry_count,
    idempotencyKey: row.idempotency_key,
    paused: row.paused === 1,
    pausedAt: row.paused_at,
    pausedByUserId: row.paused_by_user_id,
    pauseReason: row.pause_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

describe('review readiness classification', () => {
  it('子任务 completed 但缺 result_json 时归类为执行协议失败', async () => {
    const childId = 'h-child-completed-no-result';
    seedChildHandoff({
      id: childId,
      state: 'completed',
      resultJson: null,
    });

    const report = await reviewAggregator.runReviewAggregation({
      userId: USER_ID,
      pm2HandoffId: 'pm2-handoff-demo',
      pm2SessionId: PM2_SESSION_ID,
      childHandoffs: [getHandoffAsRecord(childId)],
      specContent: '# 规格',
      constitutionBody: '# 宪法',
      callLlm: async () => 'PASS',
    });

    expect(report.overallVerdict).toBe('execution-protocol-failure');
    expect(report.qualityIssues.join('；')).toContain('缺少执行结果 artifact/summary');
    expect(report.specReviewPassed).toBe(true);
  });

  it('子任务 failed 时归类为实现型失败，而非执行协议失败', async () => {
    const childId = 'h-child-failed';
    seedChildHandoff({
      id: childId,
      state: 'failed',
      failureReason: '执行层 session 运行异常',
    });

    const report = await reviewAggregator.runReviewAggregation({
      userId: USER_ID,
      pm2HandoffId: 'pm2-handoff-failed',
      pm2SessionId: PM2_SESSION_ID,
      childHandoffs: [getHandoffAsRecord(childId)],
      specContent: '# 规格',
      constitutionBody: '# 宪法',
      callLlm: async () => 'PASS',
    });

    expect(report.overallVerdict).toBe('implementation-failure');
    expect(report.qualityIssues.join('；')).toContain('子任务执行失败');
    expect(report.qualityIssues.join('；')).toContain('执行层 session 运行异常');
    expect(report.qualityIssues.join('；')).not.toContain('缺少执行结果 artifact/summary');
    expect(report.specReviewPassed).toBe(true);
  });

  it('子任务 cancelled 时归类为实现型失败，而非执行协议失败', async () => {
    const childId = 'h-child-cancelled';
    seedChildHandoff({
      id: childId,
      state: 'cancelled',
    });

    const report = await reviewAggregator.runReviewAggregation({
      userId: USER_ID,
      pm2HandoffId: 'pm2-handoff-cancelled',
      pm2SessionId: PM2_SESSION_ID,
      childHandoffs: [getHandoffAsRecord(childId)],
      specContent: '# 规格',
      constitutionBody: '# 宪法',
      callLlm: async () => 'PASS',
    });

    expect(report.overallVerdict).toBe('implementation-failure');
    expect(report.qualityIssues.join('；')).toContain('子任务执行被取消');
    expect(report.qualityIssues.join('；')).not.toContain('缺少执行结果 artifact/summary');
  });

  it('混合场景：一个 failed + 一个 completed 缺 result → implementation-failure 优先', async () => {
    const failedChild = 'h-child-mixed-failed';
    const protocolChild = 'h-child-mixed-protocol';
    seedChildHandoff({
      id: failedChild,
      state: 'failed',
      failureReason: 'stream 被取消',
      payload: { goal: '任务A', taskMarkers: { taskId: 'T-A' } },
    });
    seedChildHandoff({
      id: protocolChild,
      state: 'completed',
      resultJson: null,
      payload: { goal: '任务B', taskMarkers: { taskId: 'T-B' } },
    });

    const report = await reviewAggregator.runReviewAggregation({
      userId: USER_ID,
      pm2HandoffId: 'pm2-handoff-mixed',
      pm2SessionId: PM2_SESSION_ID,
      childHandoffs: [getHandoffAsRecord(failedChild), getHandoffAsRecord(protocolChild)],
      specContent: '# 规格',
      constitutionBody: '# 宪法',
      callLlm: async () => 'PASS',
    });

    // 有 failed 子任务 → implementation-failure
    expect(report.overallVerdict).toBe('implementation-failure');
    // 两种 issue 都应该出现
    expect(report.qualityIssues.join('；')).toContain('子任务执行失败');
    expect(report.qualityIssues.join('；')).toContain('缺少执行结果 artifact/summary');
  });

  it('子任务 completed 且有 result_json 时正常进入双重 review', async () => {
    const childId = 'h-child-ok';
    seedChildHandoff({
      id: childId,
      state: 'completed',
      resultJson: JSON.stringify({
        role: 'executor',
        summary: '已实现 A 功能',
        artifactCount: 2,
      }),
    });

    const report = await reviewAggregator.runReviewAggregation({
      userId: USER_ID,
      pm2HandoffId: 'pm2-handoff-ok',
      pm2SessionId: PM2_SESSION_ID,
      childHandoffs: [getHandoffAsRecord(childId)],
      specContent: '# 规格',
      constitutionBody: '# 宪法',
      callLlm: async () => 'PASS',
    });

    expect(report.overallVerdict).toBe('pass');
    expect(report.specReviewPassed).toBe(true);
    expect(report.qualityReviewPassed).toBe(true);
  });

  it('联合检查时会同时注入任务概览与执行结果摘要', async () => {
    const childId = 'h-child-review-dossier';
    seedChildHandoff({
      id: childId,
      state: 'completed',
      payload: {
        goal: '[apps/web/src/orders.tsx] 实现订单表单并补齐校验',
        taskMarkers: { taskId: 'T-ORDER-1' },
      },
      resultJson: JSON.stringify({
        protocol: 'submit_execution_result',
        role: 'executor',
        status: 'completed',
        summary: '已实现订单表单提交与前端校验。',
        checklist: [{ id: 'AC-1', status: 'pass', evidence: '提交成功并展示结果' }],
      }),
    });

    const capturedPrompts: Array<{ system: string; user: string }> = [];
    const report = await reviewAggregator.runReviewAggregation({
      userId: USER_ID,
      pm2HandoffId: 'pm2-handoff-review-dossier',
      pm2SessionId: PM2_SESSION_ID,
      childHandoffs: [getHandoffAsRecord(childId)],
      specContent: '# 规格\n- AC-1: 提交订单成功',
      constitutionBody: '# 宪法\n- 禁止硬编码密钥',
      callLlm: async (system, user) => {
        capturedPrompts.push({ system, user });
        return 'PASS';
      },
    });

    expect(report.overallVerdict).toBe('pass');
    expect(capturedPrompts).toHaveLength(2);
    expect(capturedPrompts.every((entry) => entry.user.includes('<task-overview>'))).toBe(true);
    expect(capturedPrompts.every((entry) => entry.user.includes('taskId=T-ORDER-1'))).toBe(true);
    expect(
      capturedPrompts.every((entry) =>
        entry.user.includes('goal=[apps/web/src/orders.tsx] 实现订单表单并补齐校验'),
      ),
    ).toBe(true);
    expect(
      capturedPrompts.every((entry) => entry.user.includes('摘要：已实现订单表单提交与前端校验。')),
    ).toBe(true);
    expect(capturedPrompts.every((entry) => entry.user.includes('提交状态：completed'))).toBe(true);
  });

  it('校验层允许简短总结，但仍能识别总结中的明确问题', async () => {
    const childId = 'h-child-review-brief-failure';
    seedChildHandoff({
      id: childId,
      state: 'completed',
      payload: {
        goal: '实现订单提交',
        taskMarkers: { taskId: 'T-ORDER-2' },
      },
      resultJson: JSON.stringify({
        protocol: 'submit_execution_result',
        role: 'executor',
        status: 'completed',
        summary: '已完成订单提交实现。',
        checklist: [{ id: 'AC-2', status: 'pass', evidence: '提交成功' }],
      }),
    });

    const report = await reviewAggregator.runReviewAggregation({
      userId: USER_ID,
      pm2HandoffId: 'pm2-handoff-review-brief-failure',
      pm2SessionId: PM2_SESSION_ID,
      childHandoffs: [getHandoffAsRecord(childId)],
      specContent: '# 规格\n- AC-2: 订单提交成功',
      constitutionBody: '# 宪法',
      callLlm: async (system) =>
        system.includes('Spec Review') ? '检查发现问题：AC-2 未覆盖。' : '检查完成，未发现问题。',
    });

    expect(report.overallVerdict).toBe('planning-failure');
    expect(report.specReviewPassed).toBe(false);
    expect(report.specIssues).toContain('检查发现问题：AC-2 未覆盖。');
    expect(report.qualityReviewPassed).toBe(true);
  });
});
