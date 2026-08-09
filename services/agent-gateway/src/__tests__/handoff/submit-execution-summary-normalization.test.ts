import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as BuiltinModule from '../../handoff/capability/builtin-instructions.js';
import type * as DbModule from '../../infra/db.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let builtin: typeof BuiltinModule;
let dbModule: typeof DbModule;

const USER_ID = 'u-submit-execution-summary';
const PM2_SESSION_ID = 's-submit-execution-summary-pm2';
const EXECUTOR_SESSION_ID = 's-submit-execution-summary-executor';

function seedBase(): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    'submit-execution-summary@example.com',
  ]);
  dbModule.sqliteRun(
    `INSERT OR IGNORE INTO sessions (id, user_id, title, metadata_json, role_layer)
     VALUES (?, ?, 'pm2', '{}', 'pm2')`,
    [PM2_SESSION_ID, USER_ID],
  );
  dbModule.sqliteRun(
    `INSERT OR IGNORE INTO sessions (id, user_id, title, metadata_json, role_layer)
     VALUES (?, ?, 'executor', '{}', 'executor')`,
    [EXECUTOR_SESSION_ID, USER_ID],
  );
}

function seedRunningExecutorHandoff(handoffId: string): void {
  dbModule.sqliteRun(
    `INSERT INTO handoff_records
       (id, user_id, from_session_id, from_role_layer, to_role_layer, to_session_id,
        payload_json, result_json, state, failure_reason, retry_count, paused,
        idempotency_key, created_at, updated_at)
      VALUES (?, ?, ?, 'pm2', 'executor', ?, ?, NULL, 'running', NULL, 0, 0, NULL, datetime('now'), datetime('now'))`,
    [
      handoffId,
      USER_ID,
      PM2_SESSION_ID,
      EXECUTOR_SESSION_ID,
      JSON.stringify({
        goal: '实现登录流程',
        taskMarkers: { taskId: 'T-EXECUTION-1' },
      }),
    ],
  );
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.migrate();
  builtin = await import('../../handoff/capability/builtin-instructions.js');
  await import('../../handoff/capability/builtin-instructions-impl.js');
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM artifacts', []);
  dbModule.sqliteRun('DELETE FROM handoff_records', []);
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  seedBase();
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('submit_execution_result summary normalization', () => {
  it('Given 只有简要完成总结 When submit_execution_result Then 自动补齐可供校验层检查的结果', async () => {
    seedRunningExecutorHandoff('h-execution-summary-completed');

    const result = await builtin.invokeInstruction({
      ctx: { callerLayer: 'executor', sessionId: EXECUTOR_SESSION_ID, userId: USER_ID },
      instructionName: 'submit_execution_result',
      rawArgs: {
        summary: '已完成登录流程实现，并通过基本检查。',
      },
    });

    expect(result.ok).toBe(true);
    const row = dbModule.sqliteGet<{ result_json: string }>(
      `SELECT result_json FROM handoff_records WHERE id = ? LIMIT 1`,
      ['h-execution-summary-completed'],
    );
    expect(row).not.toBeNull();
    const parsed = JSON.parse(row?.result_json ?? '{}') as {
      protocol?: unknown;
      taskId?: unknown;
      status?: unknown;
      summary?: unknown;
      checklist?: Array<{ id?: unknown; status?: unknown; evidence?: unknown }>;
    };
    expect(parsed['protocol']).toBe('submit_execution_result');
    expect(parsed['taskId']).toBe('T-EXECUTION-1');
    expect(parsed['status']).toBe('completed');
    expect(parsed['summary']).toBe('已完成登录流程实现，并通过基本检查。');
    expect(parsed.checklist?.[0]).toEqual({
      id: 'T-EXECUTION-1',
      status: 'pass',
      evidence: '已完成登录流程实现，并通过基本检查。',
    });
  });
});
