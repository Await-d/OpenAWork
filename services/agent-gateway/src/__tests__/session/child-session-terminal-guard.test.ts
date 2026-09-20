import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as ChildSessionTerminalGuardModule from '../../session/child-session-terminal-guard.js';
import type * as StreamRuntimeModule from '../../routes/stream-runtime.js';
import type * as ToolSandboxModule from '../../tools/tool-sandbox.js';

const mocks = vi.hoisted(() => ({
  createDefaultSandbox: vi.fn(() => {
    throw new Error('createDefaultSandbox 不应在已终止的子会话上被调用');
  }),
}));

vi.mock('../../tools/tool-sandbox.js', async () => {
  const actual = await vi.importActual<typeof ToolSandboxModule>('../../tools/tool-sandbox.js');
  return { ...actual, createDefaultSandbox: mocks.createDefaultSandbox };
});

process.env['DATABASE_URL'] = ':memory:';
process.env['JWT_SECRET'] = 'child-session-terminal-guard-test-secret-1234567890';

let dbModule: typeof DbModule;
let guardModule: typeof ChildSessionTerminalGuardModule;
let streamRuntime: typeof StreamRuntimeModule;

const USER_ID = 'u-terminal-guard';
const SESSION_ID = 'sess-terminal-guard';

function seedSession(input: { terminalReason?: string; stateStatus?: string }): void {
  const metadataJson = input.terminalReason
    ? JSON.stringify({ terminalReason: input.terminalReason })
    : '{}';
  dbModule.sqliteRun(
    `INSERT INTO sessions (id, user_id, title, metadata_json, state_status)
     VALUES (?, ?, 'terminal guard', ?, ?)`,
    [SESSION_ID, USER_ID, metadataJson, input.stateStatus ?? 'paused'],
  );
}

function readStateStatus(): string {
  const row = dbModule.sqliteGet<{ state_status: string }>(
    'SELECT state_status FROM sessions WHERE id = ? LIMIT 1',
    [SESSION_ID],
  );
  if (!row) {
    throw new Error('session missing');
  }
  return row.state_status;
}

const basePayload = {
  clientRequestId: 'client-guard',
  nextRound: 1,
  requestData: {},
  toolCallId: 'tool-call-1',
  toolName: 'bash',
  rawInput: {},
};

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  guardModule = await import('../../session/child-session-terminal-guard.js');
  streamRuntime = await import('../../routes/stream-runtime.js');
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    `${USER_ID}@example.com`,
  ]);
  mocks.createDefaultSandbox.mockClear();
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('isTerminatedChildSession', () => {
  it('Given 会话不存在 When 判定 Then false', () => {
    expect(guardModule.isTerminatedChildSession('missing-session')).toBe(false);
  });

  it('Given 无 terminalReason When 判定 Then false', () => {
    seedSession({});
    expect(guardModule.isTerminatedChildSession(SESSION_ID)).toBe(false);
  });

  it('Given terminalReason 为 cancelled / timeout When 判定 Then true', () => {
    seedSession({ terminalReason: 'cancelled' });
    expect(guardModule.isTerminatedChildSession(SESSION_ID)).toBe(true);

    dbModule.sqliteRun('DELETE FROM sessions', []);
    seedSession({ terminalReason: 'timeout' });
    expect(guardModule.isTerminatedChildSession(SESSION_ID)).toBe(true);
  });
});

describe('resume 守卫：已终止子会话不得被复活', () => {
  it('Given 已终止子会话 When 批准权限 Then 不执行工具且状态回落 idle', async () => {
    seedSession({ terminalReason: 'cancelled' });

    await streamRuntime.resumeApprovedPermissionRequest({
      payload: basePayload,
      sessionId: SESSION_ID,
      userId: USER_ID,
    });

    expect(mocks.createDefaultSandbox).not.toHaveBeenCalled();
    expect(readStateStatus()).toBe('idle');
  });

  it('Given 已终止子会话 When 拒绝权限 Then 不继续且状态回落 idle', async () => {
    seedSession({ terminalReason: 'cancelled' });

    await streamRuntime.resumeRejectedPermissionRequest({
      payload: basePayload,
      feedback: '不要执行',
      sessionId: SESSION_ID,
      userId: USER_ID,
    });

    expect(mocks.createDefaultSandbox).not.toHaveBeenCalled();
    expect(readStateStatus()).toBe('idle');
  });

  it('Given 已终止子会话 When 回答提问 Then 不恢复且状态回落 idle', async () => {
    seedSession({ terminalReason: 'timeout' });

    await streamRuntime.resumeAnsweredQuestionRequest({
      payload: basePayload,
      answerOutput: 'answer',
      sessionId: SESSION_ID,
      userId: USER_ID,
    });

    expect(mocks.createDefaultSandbox).not.toHaveBeenCalled();
    expect(readStateStatus()).toBe('idle');
  });
});
