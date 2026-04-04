import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  storedContext: null as {
    child_session_id: string;
    parent_session_id: string;
    request_data_json: string;
    task_id: string;
    user_id: string;
  } | null,
}));

const mocks = vi.hoisted(() => ({
  getAnyInFlightStreamRequestForSessionMock: vi.fn(),
  runSessionInBackgroundMock: vi.fn(),
  sqliteGetMock: vi.fn(),
  sqliteRunMock: vi.fn(),
}));

vi.mock('../db.js', () => ({
  sqliteGet: mocks.sqliteGetMock,
  sqliteRun: mocks.sqliteRunMock,
}));

vi.mock('../routes/stream-cancellation.js', () => ({
  getAnyInFlightStreamRequestForSession: mocks.getAnyInFlightStreamRequestForSessionMock,
}));

vi.mock('../routes/stream-runtime.js', () => ({
  runSessionInBackground: mocks.runSessionInBackgroundMock,
}));

import {
  buildAutoResumeMessage,
  consumeTaskParentAutoResumeContext,
  clearPendingTaskParentAutoResumesForSession,
  scheduleTaskParentAutoResume,
  upsertTaskParentAutoResumeContext,
} from '../task-parent-auto-resume.js';

describe('task parent auto resume', () => {
  afterEach(() => {
    clearPendingTaskParentAutoResumesForSession({ sessionId: 'parent-1', userId: 'user-1' });
    vi.useRealTimers();
  });

  beforeEach(() => {
    state.storedContext = null;
    mocks.getAnyInFlightStreamRequestForSessionMock.mockReset();
    mocks.runSessionInBackgroundMock.mockReset();
    mocks.sqliteGetMock.mockReset();
    mocks.sqliteRunMock.mockReset();
    mocks.getAnyInFlightStreamRequestForSessionMock.mockReturnValue(undefined);
    mocks.sqliteRunMock.mockImplementation((query: string, params?: unknown[]) => {
      if (query.includes('INSERT INTO task_parent_auto_resume_contexts')) {
        state.storedContext = {
          child_session_id: String(params?.[0]),
          parent_session_id: String(params?.[1]),
          user_id: String(params?.[2]),
          task_id: String(params?.[3]),
          request_data_json: String(params?.[4]),
        };
        return;
      }

      if (
        query.includes('DELETE FROM task_parent_auto_resume_contexts') &&
        state.storedContext &&
        String(params?.[0]) === state.storedContext.child_session_id &&
        String(params?.[1]) === state.storedContext.user_id
      ) {
        state.storedContext = null;
      }
    });
    mocks.sqliteGetMock.mockImplementation((query: string, params?: unknown[]) => {
      if (
        query.includes('FROM task_parent_auto_resume_contexts') &&
        state.storedContext &&
        String(params?.[0]) === state.storedContext.child_session_id &&
        String(params?.[1]) === state.storedContext.parent_session_id &&
        String(params?.[2]) === state.storedContext.user_id
      ) {
        return state.storedContext;
      }

      return undefined;
    });
  });

  it('caps aggregated synthetic resume messages below the stream request limit', () => {
    const longResult = '子代理长结果。'.repeat(600);
    const items: Parameters<typeof buildAutoResumeMessage>[0] = Array.from(
      { length: 24 },
      (_, index) => ({
        assignedAgent: `agent-${index + 1}`,
        childSessionId: `child-${index + 1}`,
        parentSessionId: 'parent-1',
        requestData: {
          clientRequestId: `parent-req-${index + 1}`,
          message: '请继续父会话',
          model: 'gpt-4o',
        },
        result: longResult,
        status: 'done' as const,
        taskId: `task-${index + 1}`,
        taskTitle: `任务 ${index + 1}`,
        userId: 'user-1',
      }),
    );

    const message = buildAutoResumeMessage(items);

    expect(message.length).toBeLessThanOrEqual(30000);
    expect(message).toContain('以下是后台子代理已完成后自动回流到主对话的结果');
    expect(message).toContain('其余');
    expect(message).toContain('已省略，请按需进入对应子会话查看详情。');
  });

  it('round-trips requestData without dropping agentId or upstream retry settings', () => {
    upsertTaskParentAutoResumeContext({
      childSessionId: 'child-1',
      parentSessionId: 'parent-1',
      requestData: {
        agentId: 'sisyphus-junior',
        clientRequestId: 'req-1',
        message: '请继续主任务',
        upstreamRetryMaxRetries: 2,
      },
      taskId: 'task-1',
      userId: 'user-1',
    });

    const consumed = consumeTaskParentAutoResumeContext({
      childSessionId: 'child-1',
      parentSessionId: 'parent-1',
      userId: 'user-1',
    });

    expect(consumed).toEqual({
      requestData: {
        agentId: 'sisyphus-junior',
        clientRequestId: 'req-1',
        message: '请继续主任务',
        upstreamRetryMaxRetries: 2,
      },
      taskId: 'task-1',
    });
    expect(
      consumeTaskParentAutoResumeContext({
        childSessionId: 'child-1',
        parentSessionId: 'parent-1',
        userId: 'user-1',
      }),
    ).toBeNull();
  });

  it('preserves upstream retry settings when scheduling parent auto-resume', async () => {
    vi.useFakeTimers();
    mocks.runSessionInBackgroundMock.mockResolvedValue({ statusCode: 200 });

    scheduleTaskParentAutoResume({
      assignedAgent: 'explore',
      childSessionId: 'child-1',
      parentSessionId: 'parent-1',
      requestData: {
        clientRequestId: 'req-1',
        message: '请继续主任务',
        upstreamRetryMaxRetries: 2,
      },
      result: '子代理已经完成。',
      status: 'done',
      taskId: 'task-1',
      taskTitle: '任务 1',
      userId: 'user-1',
    });

    await vi.runAllTimersAsync();

    expect(mocks.runSessionInBackgroundMock).toHaveBeenCalledWith({
      requestData: expect.objectContaining({
        clientRequestId: expect.stringMatching(/^task-auto-resume:parent-1:/),
        message: expect.stringContaining('以下是后台子代理已完成后自动回流到主对话的结果'),
        upstreamRetryMaxRetries: 2,
      }),
      sessionId: 'parent-1',
      userId: 'user-1',
    });
  });
});
