/**
 * 完成硬契约：submit_execution_result / 升级 submit_review / soft|hard 模式
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as Builtin from '../../handoff/capability/builtin-instructions.js';
import type * as ReviewAggregator from '../../handoff/workflow/review-aggregator.js';
import type * as Contract from '../../handoff/capability/completion-protocol-contract.js';
import type * as HandoffStore from '../../handoff/store/handoff-store.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let builtin: typeof Builtin;
let reviewAggregator: typeof ReviewAggregator;
let contract: typeof Contract;

const USER_ID = 'u-protocol';
const SESSION_ID = 's-protocol-exec';
const PM2_SESSION_ID = 's-protocol-pm2';

function seedBase(): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    'protocol@example.com',
  ]);
  dbModule.sqliteRun(
    `INSERT OR IGNORE INTO sessions (id, user_id, title, metadata_json, role_layer)
     VALUES (?, ?, 'exec', '{}', 'executor')`,
    [SESSION_ID, USER_ID],
  );
  dbModule.sqliteRun(
    `INSERT OR IGNORE INTO sessions (id, user_id, title, metadata_json, role_layer)
     VALUES (?, ?, 'pm2', '{}', 'pm2')`,
    [PM2_SESSION_ID, USER_ID],
  );
}

function seedRunningHandoff(input: {
  id: string;
  toSessionId: string;
  toRoleLayer: string;
  payload: Record<string, unknown>;
}): void {
  dbModule.sqliteRun(
    `INSERT INTO handoff_records
       (id, user_id, from_session_id, from_role_layer, to_role_layer, to_session_id,
        payload_json, result_json, state, failure_reason, retry_count, paused,
        idempotency_key, created_at, updated_at)
     VALUES (?, ?, ?, 'pm2', ?, ?, ?, NULL, 'running', NULL, 0, 0, NULL, datetime('now'), datetime('now'))`,
    [
      input.id,
      USER_ID,
      PM2_SESSION_ID,
      input.toRoleLayer,
      input.toSessionId,
      JSON.stringify(input.payload),
    ],
  );
}

function getHandoffAsRecord(id: string): HandoffStore.HandoffRecord {
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
  if (!row) throw new Error(`missing ${id}`);
  return {
    id: row.id,
    userId: row.user_id,
    fromSessionId: row.from_session_id,
    fromRoleLayer: row.from_role_layer as HandoffStore.HandoffRoleLayer,
    toRoleLayer: row.to_role_layer as HandoffStore.HandoffRoleLayer,
    toSessionId: row.to_session_id,
    payload: row.payload_json ? JSON.parse(row.payload_json) : null,
    resultJson: row.result_json ? JSON.parse(row.result_json) : null,
    state: row.state as HandoffStore.HandoffState,
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

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.migrate();
  builtin = await import('../../handoff/capability/builtin-instructions.js');
  await import('../../handoff/capability/builtin-instructions-impl.js');
  reviewAggregator = await import('../../handoff/workflow/review-aggregator.js');
  contract = await import('../../handoff/capability/completion-protocol-contract.js');
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM artifacts', []);
  dbModule.sqliteRun('DELETE FROM handoff_records', []);
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  seedBase();
  delete process.env['OPENAWORK_TEAM_REQUIRE_SUBMIT_PROTOCOL'];
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('submit protocol mode', () => {
  it('默认 soft', () => {
    expect(contract.resolveSubmitProtocolMode({})).toBe('soft');
  });

  it('hard 开关', () => {
    expect(
      contract.resolveSubmitProtocolMode({ OPENAWORK_TEAM_REQUIRE_SUBMIT_PROTOCOL: 'hard' }),
    ).toBe('hard');
  });
});

describe('submit_execution_result', () => {
  it('写入 protocol + checklist 到 result_json', async () => {
    seedRunningHandoff({
      id: 'h-exec-1',
      toSessionId: SESSION_ID,
      toRoleLayer: 'executor',
      payload: {
        goal: '实现登录',
        taskMarkers: { taskId: 'T001' },
        ownedPaths: ['src/auth'],
      },
    });

    const result = await builtin.invokeInstruction({
      ctx: { callerLayer: 'executor', sessionId: SESSION_ID, userId: USER_ID },
      instructionName: 'submit_execution_result',
      rawArgs: {
        taskId: 'T001',
        status: 'completed',
        changedFiles: ['src/auth/login.ts'],
        checklist: [{ id: 'AC-001', status: 'pass', evidence: 'login endpoint returns 200' }],
        summary: '已实现登录',
        verification: ['curl /api/login'],
      },
    });

    expect(result.ok).toBe(true);
    const row = dbModule.sqliteGet<{ result_json: string }>(
      `SELECT result_json FROM handoff_records WHERE id = ?`,
      ['h-exec-1'],
    );
    const parsed = JSON.parse(row?.result_json ?? '{}') as Record<string, unknown>;
    expect(parsed['protocol']).toBe('submit_execution_result');
    expect(parsed['taskId']).toBe('T001');
    expect(Array.isArray(parsed['checklist'])).toBe(true);
  });

  it('ownedPaths 越界时拒绝', async () => {
    seedRunningHandoff({
      id: 'h-exec-2',
      toSessionId: SESSION_ID,
      toRoleLayer: 'executor',
      payload: {
        goal: '实现登录',
        taskMarkers: { taskId: 'T001' },
        ownedPaths: ['src/auth'],
      },
    });

    const result = await builtin.invokeInstruction({
      ctx: { callerLayer: 'executor', sessionId: SESSION_ID, userId: USER_ID },
      instructionName: 'submit_execution_result',
      rawArgs: {
        taskId: 'T001',
        status: 'completed',
        changedFiles: ['src/billing/invoice.ts'],
        checklist: [{ id: 'AC-001', status: 'pass', evidence: 'x' }],
        summary: '越界修改',
      },
    });

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('owned-paths-violation');
  });
});

describe('review aggregation + structured checklist', () => {
  it('结构化 checklist fail 时直接 implementation-failure，不依赖 LLM', async () => {
    seedRunningHandoff({
      id: 'h-child-structured',
      toSessionId: SESSION_ID,
      toRoleLayer: 'executor',
      payload: { goal: '实现登录', taskMarkers: { taskId: 'T001' } },
    });
    dbModule.sqliteRun(
      `UPDATE handoff_records
          SET state = 'completed',
              result_json = ?
        WHERE id = ?`,
      [
        JSON.stringify({
          protocol: 'submit_execution_result',
          role: 'executor',
          taskId: 'T001',
          status: 'failed',
          checklist: [{ id: 'AC-002', status: 'fail', evidence: '缺密码强度' }],
          failedItems: ['AC-002'],
          summary: '部分完成',
        }),
        'h-child-structured',
      ],
    );

    let llmCalled = 0;
    const report = await reviewAggregator.runReviewAggregation({
      userId: USER_ID,
      pm2HandoffId: 'pm2-h',
      pm2SessionId: PM2_SESSION_ID,
      childHandoffs: [getHandoffAsRecord('h-child-structured')],
      specContent: '# 规格',
      constitutionBody: '# 宪法',
      callLlm: async () => {
        llmCalled += 1;
        return 'PASS';
      },
    });

    expect(report.overallVerdict).toBe('implementation-failure');
    expect(report.qualityIssues.join('；')).toContain('AC-002');
    expect(llmCalled).toBe(0);
  });

  it('hard 模式下缺 protocol 归为 execution-protocol-failure', async () => {
    process.env['OPENAWORK_TEAM_REQUIRE_SUBMIT_PROTOCOL'] = 'hard';
    seedRunningHandoff({
      id: 'h-child-legacy',
      toSessionId: SESSION_ID,
      toRoleLayer: 'executor',
      payload: { goal: '实现登录', taskMarkers: { taskId: 'T001' } },
    });
    dbModule.sqliteRun(
      `UPDATE handoff_records
          SET state = 'completed',
              result_json = ?
        WHERE id = ?`,
      [
        JSON.stringify({
          role: 'executor',
          summary: '旧路径摘要',
          protocol: 'stream',
        }),
        'h-child-legacy',
      ],
    );

    const report = await reviewAggregator.runReviewAggregation({
      userId: USER_ID,
      pm2HandoffId: 'pm2-h-hard',
      pm2SessionId: PM2_SESSION_ID,
      childHandoffs: [getHandoffAsRecord('h-child-legacy')],
      specContent: '# 规格',
      constitutionBody: '# 宪法',
      callLlm: async () => 'PASS',
    });

    expect(report.overallVerdict).toBe('execution-protocol-failure');
    expect(report.qualityIssues.join('；')).toContain('submit_execution_result');
  });
});

describe('toToolDefinition schema surface', () => {
  it('submit_execution_result / submit_review 对 LLM 暴露完整 properties', async () => {
    const exec = builtin.getInstruction('submit_execution_result', 'executor');
    const rev = builtin.getInstruction('submit_review', 'reviewer');
    expect(exec).toBeDefined();
    expect(rev).toBeDefined();
    const execDef = builtin.toToolDefinition(exec!);
    const revDef = builtin.toToolDefinition(rev!);
    expect(Object.keys(execDef.function.parameters.properties)).toEqual(
      expect.arrayContaining(['taskId', 'status', 'checklist', 'summary']),
    );
    expect(Object.keys(revDef.function.parameters.properties)).toEqual(
      expect.arrayContaining(['verdict', 'decision', 'items', 'title', 'content']),
    );
    // default 字段不应被标为 required
    expect(execDef.function.parameters.required).not.toContain('changedFiles');
    expect(execDef.function.parameters.required).not.toContain('verification');
  });
});
