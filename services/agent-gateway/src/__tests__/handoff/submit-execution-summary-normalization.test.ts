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
  it.each([
    ['真实成功终态', 'exited', 0, 'handoff:h-evidence', true],
    ['后台仍运行', 'running', null, 'handoff:h-evidence', false],
    ['执行失败', 'exited', 1, 'handoff:h-evidence', false],
    ['旧任务凭证', 'exited', 0, 'handoff:other', false],
  ])('服务端复核%s，不信任模型verified', async (_name, status, exitCode, requestId, expected) => {
    seedRunningExecutorHandoff('h-evidence');
    dbModule.sqliteRun(
      `INSERT INTO session_terminals (terminal_id, session_id, user_id, client_request_id, tool_name, kind, command, cwd, status, exit_code, started_at_ms, ended_at_ms, last_activity_ms) VALUES (?, ?, ?, ?, 'bash', 'foreground', ?, '/workspace', ?, ?, ?, ?, ?)`,
      [
        'term-check',
        EXECUTOR_SESSION_ID,
        USER_ID,
        requestId,
        'bun test src/login.test.ts',
        status,
        exitCode,
        Date.now() - 100,
        Date.now(),
        Date.now(),
      ],
    );
    const result = await builtin.invokeInstruction({
      ctx: {
        callerLayer: 'executor',
        sessionId: EXECUTOR_SESSION_ID,
        userId: USER_ID,
        handoffId: 'h-evidence',
        clientRequestId: 'handoff:h-evidence',
      },
      instructionName: 'submit_execution_result',
      rawArgs: {
        summary: '完成登录',
        status: 'completed',
        checklist: [
          {
            id: 'login-test',
            status: 'pass',
            evidence: '登录测试已执行',
            verified: true,
            verificationRefs: [{ terminalId: 'term-check', command: 'bun test src/login.test.ts' }],
          },
        ],
      },
    });
    expect(result.ok).toBe(expected);
    const row = dbModule.sqliteGet<{ result_json: string }>(
      'SELECT result_json FROM handoff_records WHERE id = ?',
      ['h-evidence'],
    );
    expect(JSON.parse(row!.result_json).checklist[0].verified).toBe(expected);
  });

  it.each([
    ['docs', true],
    ['build', false],
  ])('文件读取凭证仅适用于实际派发的%s任务', async (kind, expected) => {
    seedRunningExecutorHandoff('h-doc');
    dbModule.sqliteRun('UPDATE handoff_records SET payload_json = ? WHERE id = ?', [
      JSON.stringify({ taskProfile: { kind }, taskMarkers: { taskId: 'T-EXECUTION-1' } }),
      'h-doc',
    ]);
    const { appendSessionMessageV2 } = await import('../../message/message-v2-adapter.js');
    appendSessionMessageV2({
      sessionId: EXECUTOR_SESSION_ID,
      userId: USER_ID,
      role: 'assistant',
      clientRequestId: 'handoff:h-doc',
      content: [
        {
          type: 'tool_call',
          toolCallId: 'read-doc',
          toolName: 'read',
          input: { path: 'docs/guide.md' },
        },
        {
          type: 'tool_result',
          toolCallId: 'read-doc',
          toolName: 'read',
          output: { path: 'docs/guide.md', content: '完整文档', truncated: false },
          isError: false,
        },
      ],
    });
    const result = await builtin.invokeInstruction({
      ctx: { callerLayer: 'executor', sessionId: EXECUTOR_SESSION_ID, userId: USER_ID },
      instructionName: 'submit_execution_result',
      rawArgs: {
        summary: '文档已完成',
        checklist: [
          {
            id: 'docs',
            status: 'pass',
            evidence: '已读取完整文档',
            verificationRefs: [{ toolCallId: 'read-doc', path: 'docs/guide.md' }],
          },
        ],
      },
    });
    expect(result.ok).toBe(expected);
  });

  it('逐项核验不将一次成功检查批量赋给未引用项', async () => {
    seedRunningExecutorHandoff('h-partial');
    dbModule.sqliteRun(
      `INSERT INTO session_terminals (terminal_id, session_id, user_id, client_request_id, tool_name, kind, command, cwd, status, exit_code, started_at_ms, ended_at_ms, last_activity_ms) VALUES ('partial-term', ?, ?, 'handoff:h-partial', 'run_bash_in_background', 'background', 'bun test', '/workspace', 'exited', 0, 1, 2, 2)`,
      [EXECUTOR_SESSION_ID, USER_ID],
    );
    await builtin.invokeInstruction({
      ctx: { callerLayer: 'executor', sessionId: EXECUTOR_SESSION_ID, userId: USER_ID },
      instructionName: 'submit_execution_result',
      rawArgs: {
        summary: '完成',
        checklist: [
          {
            id: 'AC1',
            status: 'pass',
            evidence: '测试',
            verificationRefs: [{ terminalId: 'partial-term', command: 'bun test' }],
          },
          { id: 'AC2', status: 'pass', evidence: '仅自报', verified: true },
        ],
      },
    });
    const row = dbModule.sqliteGet<{ result_json: string }>(
      'SELECT result_json FROM handoff_records WHERE id = ?',
      ['h-partial'],
    );
    expect(
      JSON.parse(row!.result_json).checklist.map((item: { verified: boolean }) => item.verified),
    ).toEqual([true, false]);
  });

  it('失败重试后旧轮次终端凭证不能复用', async () => {
    seedRunningExecutorHandoff('h-evidence');
    dbModule.sqliteRun('UPDATE handoff_records SET failed_retry_count = 1 WHERE id = ?', [
      'h-evidence',
    ]);
    dbModule.sqliteRun(
      `INSERT INTO session_terminals (terminal_id, session_id, user_id, client_request_id, tool_name, kind, command, cwd, status, exit_code, started_at_ms, ended_at_ms, last_activity_ms) VALUES ('old', ?, ?, 'handoff:h-evidence', 'bash', 'foreground', 'bun test', '/workspace', 'exited', 0, 1, 2, 2)`,
      [EXECUTOR_SESSION_ID, USER_ID],
    );
    const result = await builtin.invokeInstruction({
      ctx: { callerLayer: 'executor', sessionId: EXECUTOR_SESSION_ID, userId: USER_ID },
      instructionName: 'submit_execution_result',
      rawArgs: {
        summary: '完成',
        checklist: [
          {
            id: 'AC',
            status: 'pass',
            evidence: '通过',
            verificationRefs: [{ terminalId: 'old', command: 'bun test' }],
          },
        ],
      },
    });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('execution-evidence-required');
  });

  it('只有自报verified和不存在的终端仍未验证', async () => {
    seedRunningExecutorHandoff('h-forged');
    await builtin.invokeInstruction({
      ctx: { callerLayer: 'executor', sessionId: EXECUTOR_SESSION_ID, userId: USER_ID },
      instructionName: 'submit_execution_result',
      rawArgs: {
        summary: '完成',
        checklist: [
          {
            id: 'AC1',
            status: 'pass',
            evidence: '测试通过',
            verified: true,
            verificationRefs: [{ terminalId: 'fake', command: 'bun test' }],
          },
        ],
      },
    });
    const row = dbModule.sqliteGet<{ result_json: string }>(
      'SELECT result_json FROM handoff_records WHERE id = ?',
      ['h-forged'],
    );
    expect(JSON.parse(row!.result_json).checklist[0].verified).toBe(false);
  });

  it('Given 只有简要完成总结 When submit_execution_result Then 自动补齐可供校验层检查的结果', async () => {
    seedRunningExecutorHandoff('h-execution-summary-completed');

    const result = await builtin.invokeInstruction({
      ctx: { callerLayer: 'executor', sessionId: EXECUTOR_SESSION_ID, userId: USER_ID },
      instructionName: 'submit_execution_result',
      rawArgs: {
        summary: '已完成登录流程实现，并通过基本检查。',
      },
    });

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('execution-evidence-required');
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
      verified: false,
    });
  });
});
