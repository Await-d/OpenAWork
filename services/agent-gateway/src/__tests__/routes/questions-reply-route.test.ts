import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Hoisted mocks ────────────────────────────────────────────────────
//
// The questions reply handler must update the persisted session state
// status SYNCHRONOUSLY before returning the HTTP response, otherwise the
// frontend's immediate `getRecovery` call hits a race window where the
// runtime reconciler sees `state_status='paused'` plus no pending
// interaction and forcibly resets the session to `idle`. That reset
// prevents the SSE attach loop from kicking in even when the resume is
// already on its way, leaving the chat UI stuck after the user submits
// an AskUserQuestion answer.
//
// These mocks let us assert the call ordering between
// `setPersistedSessionStateStatus` and `resumeAnsweredQuestionRequest`
// without spinning up the full sqlite + stream-runtime stack.

const mocks = vi.hoisted(() => ({
  sqliteAll: vi.fn(() => [] as unknown[]),
  sqliteGet: vi.fn(),
  sqliteRun: vi.fn(),
  publishSessionRunEvent: vi.fn(),
  setPersistedSessionStateStatus: vi.fn(),
  resumeAnsweredQuestionRequest: vi.fn(async () => undefined),
  parseSessionMetadataJson: vi.fn(() => ({})),
  shouldExitPlanModeFromAnswers: vi.fn(() => false),
}));

vi.mock('../../infra/db.js', () => ({
  sqliteAll: mocks.sqliteAll,
  sqliteGet: mocks.sqliteGet,
  sqliteRun: mocks.sqliteRun,
}));

vi.mock('../../session/session-run-events.js', () => ({
  publishSessionRunEvent: mocks.publishSessionRunEvent,
}));

vi.mock('../../session/session-question-events.js', () => ({
  createQuestionRepliedEvent: vi.fn((input: Record<string, unknown>) => ({
    type: 'question_replied',
    ...input,
  })),
}));

vi.mock('../../session/session-workspace-metadata.js', () => ({
  parseSessionMetadataJson: mocks.parseSessionMetadataJson,
}));

vi.mock('../../tools/plan-mode-tools.js', () => ({
  shouldExitPlanModeFromAnswers: mocks.shouldExitPlanModeFromAnswers,
}));

vi.mock('../../routes/stream.js', () => ({
  setPersistedSessionStateStatus: mocks.setPersistedSessionStateStatus,
}));

vi.mock('../../routes/stream-runtime.js', () => ({
  resumeAnsweredQuestionRequest: mocks.resumeAnsweredQuestionRequest,
}));

vi.mock('../../infra/auth.js', () => ({
  requireAuth: async (request: { user?: unknown }) => {
    request.user = { sub: 'test-user', email: 'test@openAwork.local' };
  },
}));

vi.mock('../../runtime/request-workflow.js', () => ({
  startRequestWorkflow: () => ({
    step: { succeed: vi.fn(), fail: vi.fn() },
    child: () => ({ succeed: vi.fn(), fail: vi.fn() }),
  }),
}));

import { questionsRoutes } from '../../routes/questions.js';

const SESSION_ID = 'session-abc';
const USER_ID = 'test-user';
const REQUEST_ID = 'question-req-1';

const ANSWERED_PAYLOAD_JSON = JSON.stringify({
  clientRequestId: 'client-req-1',
  nextRound: 2,
  toolCallId: 'tool-call-1',
  rawInput: {
    questions: [{ header: 'h', question: 'q', options: [{ label: 'a', description: 'a' }] }],
  },
  requestData: {
    clientRequestId: 'client-req-1',
    message: '请问哪个目录',
    model: 'gpt-4o',
  },
});

const QUESTIONS_JSON = JSON.stringify([
  { header: 'h', question: 'q', options: [{ label: 'a', description: 'a' }] },
]);

function buildPendingQuestionRow(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: REQUEST_ID,
    session_id: SESSION_ID,
    user_id: USER_ID,
    tool_name: 'question',
    title: 'Question',
    questions_json: QUESTIONS_JSON,
    answer_json: null,
    request_payload_json: ANSWERED_PAYLOAD_JSON,
    expires_at: null,
    status: 'pending',
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

async function createApp() {
  const app = Fastify();
  await app.register(questionsRoutes);
  return app;
}

describe('questions reply route', () => {
  beforeEach(() => {
    mocks.sqliteAll.mockReset().mockReturnValue([]);
    mocks.sqliteGet.mockReset();
    mocks.sqliteRun.mockReset();
    mocks.publishSessionRunEvent.mockReset();
    mocks.setPersistedSessionStateStatus.mockReset();
    mocks.resumeAnsweredQuestionRequest.mockReset().mockResolvedValue(undefined);
  });

  it('synchronously sets state_status="running" before firing the resume when answered with payload', async () => {
    // Session ownership lookup, then question request lookup.
    mocks.sqliteGet
      .mockReturnValueOnce({ id: SESSION_ID, user_id: USER_ID })
      .mockReturnValueOnce(buildPendingQuestionRow());

    const callOrder: string[] = [];
    mocks.setPersistedSessionStateStatus.mockImplementation(() => {
      callOrder.push('setPersistedSessionStateStatus');
    });
    mocks.resumeAnsweredQuestionRequest.mockImplementation(async () => {
      callOrder.push('resumeAnsweredQuestionRequest');
    });

    const app = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: `/sessions/${SESSION_ID}/questions/reply`,
      payload: { requestId: REQUEST_ID, status: 'answered', answers: [['a']] },
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.setPersistedSessionStateStatus).toHaveBeenCalledWith({
      sessionId: SESSION_ID,
      status: 'running',
      userId: USER_ID,
    });
    expect(mocks.resumeAnsweredQuestionRequest).toHaveBeenCalledTimes(1);
    expect(callOrder[0]).toBe('setPersistedSessionStateStatus');
    expect(callOrder).toContain('resumeAnsweredQuestionRequest');
    expect(callOrder.indexOf('setPersistedSessionStateStatus')).toBeLessThan(
      callOrder.indexOf('resumeAnsweredQuestionRequest'),
    );

    await app.close();
  });

  it('sets state_status="idle" when the reply is dismissed', async () => {
    mocks.sqliteGet
      .mockReturnValueOnce({ id: SESSION_ID, user_id: USER_ID })
      .mockReturnValueOnce(buildPendingQuestionRow());

    const app = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: `/sessions/${SESSION_ID}/questions/reply`,
      payload: { requestId: REQUEST_ID, status: 'dismissed' },
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.setPersistedSessionStateStatus).toHaveBeenCalledWith({
      sessionId: SESSION_ID,
      status: 'idle',
      userId: USER_ID,
    });
    expect(mocks.resumeAnsweredQuestionRequest).not.toHaveBeenCalled();

    await app.close();
  });

  it('sets state_status="idle" when answered without a resume payload', async () => {
    mocks.sqliteGet
      .mockReturnValueOnce({ id: SESSION_ID, user_id: USER_ID })
      .mockReturnValueOnce(buildPendingQuestionRow({ request_payload_json: null }));

    const app = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: `/sessions/${SESSION_ID}/questions/reply`,
      payload: { requestId: REQUEST_ID, status: 'answered', answers: [['a']] },
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.setPersistedSessionStateStatus).toHaveBeenCalledWith({
      sessionId: SESSION_ID,
      status: 'idle',
      userId: USER_ID,
    });
    expect(mocks.resumeAnsweredQuestionRequest).not.toHaveBeenCalled();

    await app.close();
  });

  it('treats an already resolved question request as an idempotent success', async () => {
    mocks.sqliteGet
      .mockReturnValueOnce({ id: SESSION_ID, user_id: USER_ID })
      .mockReturnValueOnce(buildPendingQuestionRow({ status: 'answered' }));

    const app = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: `/sessions/${SESSION_ID}/questions/reply`,
      payload: { requestId: REQUEST_ID, status: 'answered', answers: [['a']] },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true, alreadyResolved: true });
    expect(mocks.publishSessionRunEvent).toHaveBeenCalledWith(
      SESSION_ID,
      expect.objectContaining({
        requestId: REQUEST_ID,
        status: 'answered',
        type: 'question_replied',
      }),
    );
    expect(mocks.setPersistedSessionStateStatus).not.toHaveBeenCalled();
    expect(mocks.resumeAnsweredQuestionRequest).not.toHaveBeenCalled();

    await app.close();
  });

  it('treats dismissing a missing question request as an idempotent success', async () => {
    mocks.sqliteGet
      .mockReturnValueOnce({ id: SESSION_ID, user_id: USER_ID })
      .mockReturnValueOnce(undefined);

    const app = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: `/sessions/${SESSION_ID}/questions/reply`,
      payload: { requestId: REQUEST_ID, status: 'dismissed' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true, idempotent: true });
    expect(mocks.publishSessionRunEvent).toHaveBeenCalledWith(
      SESSION_ID,
      expect.objectContaining({
        requestId: REQUEST_ID,
        status: 'dismissed',
        type: 'question_replied',
      }),
    );
    expect(mocks.setPersistedSessionStateStatus).not.toHaveBeenCalled();
    expect(mocks.resumeAnsweredQuestionRequest).not.toHaveBeenCalled();

    await app.close();
  });
});
