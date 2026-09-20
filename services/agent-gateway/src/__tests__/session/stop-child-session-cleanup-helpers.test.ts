import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as PermissionsRoutesModule from '../../routes/permissions.js';
import type * as QuestionsRoutesModule from '../../routes/questions.js';
import type * as TaskParentAutoResumeModule from '../../task/task-parent-auto-resume.js';

const mocks = vi.hoisted(() => ({
  publishSessionRunEvent: vi.fn(),
  resumeAnsweredQuestionRequest: vi.fn(async () => undefined),
  resumeApprovedPermissionRequest: vi.fn(async () => undefined),
  resumeRejectedPermissionRequest: vi.fn(async () => undefined),
  runSessionInBackground: vi.fn(async () => ({ statusCode: 200 })),
  setPersistedSessionStateStatus: vi.fn(),
}));

vi.mock('../../session/session-run-events.js', () => ({
  publishSessionRunEvent: mocks.publishSessionRunEvent,
}));

vi.mock('../../routes/stream-runtime.js', () => ({
  resumeAnsweredQuestionRequest: mocks.resumeAnsweredQuestionRequest,
  resumeApprovedPermissionRequest: mocks.resumeApprovedPermissionRequest,
  resumeRejectedPermissionRequest: mocks.resumeRejectedPermissionRequest,
  runSessionInBackground: mocks.runSessionInBackground,
}));

vi.mock('../../routes/stream.js', () => ({
  setPersistedSessionStateStatus: mocks.setPersistedSessionStateStatus,
  streamRequestSchema: {
    parse: (value: unknown) => value,
  },
}));

process.env['DATABASE_URL'] = ':memory:';
process.env['JWT_SECRET'] = 'stop-child-session-helpers-test-secret-1234567890';

let dbModule: typeof DbModule;
let permissionsModule: typeof PermissionsRoutesModule;
let questionsModule: typeof QuestionsRoutesModule;
let autoResume: typeof TaskParentAutoResumeModule;

const USER_ID = 'u-stop-child-helpers';
const OTHER_USER_ID = 'u-stop-child-helpers-other';
const SESSION_ID = 'sess-stop-child-helpers';

function seedUser(id: string): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    id,
    `${id}@example.com`,
  ]);
}

function seedSession(sessionId: string, userId: string, stateStatus = 'paused'): void {
  dbModule.sqliteRun(
    `INSERT INTO sessions (id, user_id, title, metadata_json, state_status)
     VALUES (?, ?, 'stop child session', '{}', ?)`,
    [sessionId, userId, stateStatus],
  );
}

function seedPermissionRequest(input: {
  requestId: string;
  status: 'pending' | 'deciding' | 'rejected';
  clientRequestId?: string;
}): void {
  dbModule.sqliteRun(
    `INSERT INTO permission_requests
      (id, session_id, tool_name, scope, reason, risk_level, preview_action, request_payload_json, expires_at, always_json, status, decision)
     VALUES (?, ?, 'bash', 'ls -la', 'inspect workspace', 'medium', 'ls -la', ?, NULL, NULL, ?, ?)`,
    [
      input.requestId,
      SESSION_ID,
      JSON.stringify({ clientRequestId: input.clientRequestId ?? `client-${input.requestId}` }),
      input.status,
      input.status === 'rejected' ? 'reject' : null,
    ],
  );
}

function seedQuestionRequest(input: {
  requestId: string;
  status: 'pending' | 'deciding' | 'dismissed';
  clientRequestId?: string;
  userId?: string;
}): void {
  dbModule.sqliteRun(
    `INSERT INTO question_requests
      (id, session_id, user_id, tool_name, title, questions_json, answer_json, request_payload_json, expires_at, status)
     VALUES (?, ?, ?, 'AskUserQuestion', '请选择目录', '[]', NULL, ?, NULL, ?)`,
    [
      input.requestId,
      SESSION_ID,
      input.userId ?? USER_ID,
      JSON.stringify({ clientRequestId: input.clientRequestId ?? `client-${input.requestId}` }),
      input.status,
    ],
  );
}

function readPermissionStatus(requestId: string): { status: string; decision: string | null } {
  const row = dbModule.sqliteGet<{ status: string; decision: string | null }>(
    'SELECT status, decision FROM permission_requests WHERE id = ?',
    [requestId],
  );
  if (!row) {
    throw new Error(`permission request ${requestId} missing`);
  }
  return row;
}

function readQuestionStatus(requestId: string): { status: string } {
  const row = dbModule.sqliteGet<{ status: string }>(
    'SELECT status FROM question_requests WHERE id = ?',
    [requestId],
  );
  if (!row) {
    throw new Error(`question request ${requestId} missing`);
  }
  return row;
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  permissionsModule = await import('../../routes/permissions.js');
  questionsModule = await import('../../routes/questions.js');
  autoResume = await import('../../task/task-parent-auto-resume.js');
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM permission_requests', []);
  dbModule.sqliteRun('DELETE FROM question_requests', []);
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  seedUser(USER_ID);
  seedUser(OTHER_USER_ID);
  seedSession(SESSION_ID, USER_ID);
  mocks.publishSessionRunEvent.mockReset();
  mocks.runSessionInBackground.mockReset();
  mocks.runSessionInBackground.mockResolvedValue({ statusCode: 200 });
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('cancelPendingPermissionRequestsForSession', () => {
  it('Given pending 与 deciding 混合 When 按会话取消 Then 全部 rejected 且逐条发布 permission_replied', () => {
    seedPermissionRequest({ requestId: 'perm-pending', status: 'pending' });
    seedPermissionRequest({
      requestId: 'perm-deciding',
      status: 'deciding',
      clientRequestId: 'client-deciding',
    });
    seedPermissionRequest({ requestId: 'perm-done', status: 'rejected' });

    const transitioned = permissionsModule.cancelPendingPermissionRequestsForSession({
      sessionId: SESSION_ID,
      userId: USER_ID,
    });

    expect(transitioned).toBe(2);
    expect(readPermissionStatus('perm-pending')).toEqual({
      status: 'rejected',
      decision: 'reject',
    });
    expect(readPermissionStatus('perm-deciding')).toEqual({
      status: 'rejected',
      decision: 'reject',
    });
    expect(readPermissionStatus('perm-done')).toEqual({
      status: 'rejected',
      decision: 'reject',
    });
    expect(mocks.publishSessionRunEvent).toHaveBeenCalledTimes(2);
    expect(mocks.publishSessionRunEvent).toHaveBeenCalledWith(
      SESSION_ID,
      expect.objectContaining({
        type: 'permission_replied',
        requestId: 'perm-deciding',
        decision: 'reject',
      }),
      { clientRequestId: 'client-deciding' },
    );
  });

  it('Given 已全部终态 When 再次取消 Then 返回 0 且不重复发布事件（守卫幂等）', () => {
    seedPermissionRequest({ requestId: 'perm-once', status: 'pending' });

    expect(
      permissionsModule.cancelPendingPermissionRequestsForSession({
        sessionId: SESSION_ID,
        userId: USER_ID,
      }),
    ).toBe(1);
    mocks.publishSessionRunEvent.mockReset();

    expect(
      permissionsModule.cancelPendingPermissionRequestsForSession({
        sessionId: SESSION_ID,
        userId: USER_ID,
      }),
    ).toBe(0);
    expect(mocks.publishSessionRunEvent).not.toHaveBeenCalled();
    expect(readPermissionStatus('perm-once').status).toBe('rejected');
  });

  it('Given 非会话所有者 When 取消 Then 返回 0 且不影响行状态', () => {
    seedPermissionRequest({ requestId: 'perm-owned', status: 'pending' });

    const transitioned = permissionsModule.cancelPendingPermissionRequestsForSession({
      sessionId: SESSION_ID,
      userId: OTHER_USER_ID,
    });

    expect(transitioned).toBe(0);
    expect(readPermissionStatus('perm-owned').status).toBe('pending');
    expect(mocks.publishSessionRunEvent).not.toHaveBeenCalled();
  });
});

describe('cancelPendingQuestionRequestsForSession', () => {
  it('Given pending 与 deciding 混合 When 按会话取消 Then 全部 dismissed 且逐条发布 question_replied', () => {
    seedQuestionRequest({ requestId: 'q-pending', status: 'pending' });
    seedQuestionRequest({
      requestId: 'q-deciding',
      status: 'deciding',
      clientRequestId: 'client-q-deciding',
    });

    const transitioned = questionsModule.cancelPendingQuestionRequestsForSession({
      sessionId: SESSION_ID,
      userId: USER_ID,
    });

    expect(transitioned).toBe(2);
    expect(readQuestionStatus('q-pending').status).toBe('dismissed');
    expect(readQuestionStatus('q-deciding').status).toBe('dismissed');
    expect(mocks.publishSessionRunEvent).toHaveBeenCalledTimes(2);
    expect(mocks.publishSessionRunEvent).toHaveBeenCalledWith(
      SESSION_ID,
      expect.objectContaining({
        type: 'question_replied',
        requestId: 'q-deciding',
        status: 'dismissed',
      }),
      { clientRequestId: 'client-q-deciding' },
    );
  });

  it('Given 已全部终态 When 再次取消 Then 返回 0 且不重复发布事件（守卫幂等）', () => {
    seedQuestionRequest({ requestId: 'q-once', status: 'pending' });

    expect(
      questionsModule.cancelPendingQuestionRequestsForSession({
        sessionId: SESSION_ID,
        userId: USER_ID,
      }),
    ).toBe(1);
    mocks.publishSessionRunEvent.mockReset();

    expect(
      questionsModule.cancelPendingQuestionRequestsForSession({
        sessionId: SESSION_ID,
        userId: USER_ID,
      }),
    ).toBe(0);
    expect(mocks.publishSessionRunEvent).not.toHaveBeenCalled();
  });

  it('Given 行属于其它用户 When 按会话取消 Then 返回 0 且保持 pending', () => {
    seedQuestionRequest({ requestId: 'q-foreign', status: 'pending', userId: OTHER_USER_ID });

    const transitioned = questionsModule.cancelPendingQuestionRequestsForSession({
      sessionId: SESSION_ID,
      userId: USER_ID,
    });

    expect(transitioned).toBe(0);
    expect(readQuestionStatus('q-foreign').status).toBe('pending');
  });
});

describe('clearPendingTaskParentAutoResumeForTask', () => {
  function scheduleItem(input: {
    childSessionId: string;
    parentSessionId: string;
    taskId: string;
    taskTitle: string;
  }): void {
    autoResume.scheduleTaskParentAutoResume({
      assignedAgent: 'explore',
      childSessionId: input.childSessionId,
      parentSessionId: input.parentSessionId,
      requestData: { clientRequestId: 'parent-round-1', message: '父回合' },
      status: 'done',
      taskId: input.taskId,
      taskTitle: input.taskTitle,
      userId: USER_ID,
    });
  }

  it('Given 同会话两个待回流子代理 When 只摘除一个 Then 另一个仍按计划回流', async () => {
    const parentSessionId = 'sess-auto-resume-keep';
    const keepTitle = '保留的子代理任务';
    const dropTitle = '被摘除的子代理任务';
    seedSession(parentSessionId, USER_ID, 'idle');
    vi.useFakeTimers();
    scheduleItem({
      childSessionId: 'child-keep',
      parentSessionId,
      taskId: 'task-keep',
      taskTitle: keepTitle,
    });
    scheduleItem({
      childSessionId: 'child-drop',
      parentSessionId,
      taskId: 'task-drop',
      taskTitle: dropTitle,
    });

    autoResume.clearPendingTaskParentAutoResumeForTask({
      parentSessionId,
      userId: USER_ID,
      taskId: 'task-drop',
    });
    await vi.advanceTimersByTimeAsync(1000);

    expect(mocks.runSessionInBackground).toHaveBeenCalledTimes(1);
    const firstCall = mocks.runSessionInBackground.mock.calls[0] as unknown as
      [{ requestData: Record<string, unknown> }] | undefined;
    const message = String(firstCall?.[0]?.requestData['message'] ?? '');
    expect(message).toContain(keepTitle);
    expect(message).not.toContain(dropTitle);
    autoResume.clearPendingTaskParentAutoResumesForSession({
      sessionId: parentSessionId,
      userId: USER_ID,
    });
  });

  it('Given 会话仅剩一个待回流条目 When 摘除该任务 Then 清理定时器且不再回流', async () => {
    const parentSessionId = 'sess-auto-resume-last';
    seedSession(parentSessionId, USER_ID, 'idle');
    vi.useFakeTimers();
    scheduleItem({
      childSessionId: 'child-last',
      parentSessionId,
      taskId: 'task-last',
      taskTitle: '唯一的子代理任务',
    });

    autoResume.clearPendingTaskParentAutoResumeForTask({
      parentSessionId,
      userId: USER_ID,
      taskId: 'task-last',
    });
    await vi.advanceTimersByTimeAsync(2000);

    expect(mocks.runSessionInBackground).not.toHaveBeenCalled();
  });

  it('Given 无待回流条目 When 摘除 Then 空操作且不抛错', () => {
    expect(() =>
      autoResume.clearPendingTaskParentAutoResumeForTask({
        parentSessionId: 'sess-auto-resume-empty',
        userId: USER_ID,
        taskId: 'task-missing',
      }),
    ).not.toThrow();
  });
});
