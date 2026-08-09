import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as BuiltinModule from '../../handoff/capability/builtin-instructions.js';
import type * as DbModule from '../../infra/db.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let builtin: typeof BuiltinModule;
let dbModule: typeof DbModule;

const USER_ID = 'u-submit-review-summary';
const PM2_SESSION_ID = 's-submit-review-summary-pm2';
const REVIEWER_SESSION_ID = 's-submit-review-summary-reviewer';

function seedBase(): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    'submit-review-summary@example.com',
  ]);
  dbModule.sqliteRun(
    `INSERT OR IGNORE INTO sessions (id, user_id, title, metadata_json, role_layer)
     VALUES (?, ?, 'pm2', '{}', 'pm2')`,
    [PM2_SESSION_ID, USER_ID],
  );
  dbModule.sqliteRun(
    `INSERT OR IGNORE INTO sessions (id, user_id, title, metadata_json, role_layer)
     VALUES (?, ?, 'reviewer', '{}', 'reviewer')`,
    [REVIEWER_SESSION_ID, USER_ID],
  );
}

function seedRunningReviewerHandoff(handoffId: string): void {
  dbModule.sqliteRun(
    `INSERT INTO handoff_records
       (id, user_id, from_session_id, from_role_layer, to_role_layer, to_session_id,
        payload_json, result_json, state, failure_reason, retry_count, paused,
        idempotency_key, created_at, updated_at)
      VALUES (?, ?, ?, 'pm2', 'reviewer', ?, ?, NULL, 'running', NULL, 0, 0, NULL, datetime('now'), datetime('now'))`,
    [
      handoffId,
      USER_ID,
      PM2_SESSION_ID,
      REVIEWER_SESSION_ID,
      JSON.stringify({
        goal: '评审登录实现',
        taskMarkers: { taskId: 'T-REVIEW-1' },
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

describe('submit_review summary normalization', () => {
  it('Given 只有简要通过总结 When submit_review Then 自动补齐 pass verdict 与 items', async () => {
    seedRunningReviewerHandoff('h-review-summary-pass');

    const result = await builtin.invokeInstruction({
      ctx: { callerLayer: 'reviewer', sessionId: REVIEWER_SESSION_ID, userId: USER_ID },
      instructionName: 'submit_review',
      rawArgs: {
        taskId: 'T-REVIEW-1',
        overallReason: '整体通过，未发现问题，符合预期。',
      },
    });

    expect(result.ok).toBe(true);
    const row = dbModule.sqliteGet<{ result_json: string }>(
      `SELECT result_json FROM handoff_records WHERE id = ? LIMIT 1`,
      ['h-review-summary-pass'],
    );
    expect(row).not.toBeNull();
    const parsed = JSON.parse(row?.result_json ?? '{}') as {
      verdict?: unknown;
      items?: Array<{ status?: unknown }>;
      protocol?: unknown;
    };
    expect(parsed['protocol']).toBe('submit_review_report');
    expect(parsed['verdict']).toBe('pass');
    expect(parsed.items?.[0]?.status).toBe('pass');
  });

  it('Given 只有简要失败总结 When submit_review Then 自动补齐 fail verdict 与 items', async () => {
    seedRunningReviewerHandoff('h-review-summary-fail');

    const result = await builtin.invokeInstruction({
      ctx: { callerLayer: 'reviewer', sessionId: REVIEWER_SESSION_ID, userId: USER_ID },
      instructionName: 'submit_review',
      rawArgs: {
        taskId: 'T-REVIEW-1',
        content: '问题：AC-002 未覆盖，需要修改后再提交。',
      },
    });

    expect(result.ok).toBe(true);
    const row = dbModule.sqliteGet<{ result_json: string }>(
      `SELECT result_json FROM handoff_records WHERE id = ? LIMIT 1`,
      ['h-review-summary-fail'],
    );
    expect(row).not.toBeNull();
    const parsed = JSON.parse(row?.result_json ?? '{}') as {
      verdict?: unknown;
      items?: Array<{ status?: unknown }>;
      protocol?: unknown;
    };
    expect(parsed['protocol']).toBe('submit_review_report');
    expect(parsed['verdict']).toBe('fail');
    expect(parsed.items?.[0]?.status).toBe('fail');
  });
});
