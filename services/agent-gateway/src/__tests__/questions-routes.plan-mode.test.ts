import Fastify, { type FastifyRequest } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sqliteAllMock: vi.fn(),
  sqliteGetMock: vi.fn(),
  sqliteRunMock: vi.fn(),
  publishSessionRunEventMock: vi.fn(),
  resumeAnsweredQuestionRequestMock: vi.fn(),
}));

vi.mock('../auth.js', () => ({
  requireAuth: (_request: unknown, _reply: unknown, done: () => void) => done(),
}));

vi.mock('../db.js', () => ({
  WORKSPACE_ACCESS_RESTRICTED: false,
  WORKSPACE_ROOT: '/home/await/project/OpenAWork',
  WORKSPACE_ROOTS: ['/home/await/project/OpenAWork'],
  sqliteAll: mocks.sqliteAllMock,
  sqliteGet: mocks.sqliteGetMock,
  sqliteRun: mocks.sqliteRunMock,
}));

vi.mock('../session-run-events.js', () => ({
  publishSessionRunEvent: mocks.publishSessionRunEventMock,
}));

vi.mock('../routes/stream-runtime.js', () => ({
  resumeAnsweredQuestionRequest: mocks.resumeAnsweredQuestionRequestMock,
}));

describe('questions routes plan mode integration', () => {
  let app: Awaited<ReturnType<typeof Fastify>>;

  beforeEach(async () => {
    mocks.sqliteAllMock.mockReset();
    mocks.sqliteGetMock.mockReset();
    mocks.sqliteRunMock.mockReset();
    mocks.publishSessionRunEventMock.mockReset();
    mocks.resumeAnsweredQuestionRequestMock.mockReset();
    mocks.resumeAnsweredQuestionRequestMock.mockResolvedValue(undefined);

    const { questionsRoutes } = await import('../routes/questions.js');
    const requestWorkflowPlugin = (await import('../request-workflow.js')).default;

    app = Fastify();
    app.decorateRequest('user', null);
    app.addHook('onRequest', async (request: FastifyRequest) => {
      (request as typeof request & { user: { sub: string } }).user = { sub: 'user-a' };
    });
    await app.register(requestWorkflowPlugin);
    await app.register(questionsRoutes);
  });

  afterEach(async () => {
    await app?.close();
  });

  it('clears planMode and resumes the session when ExitPlanMode is approved', async () => {
    mocks.sqliteGetMock.mockImplementation((query: string) => {
      if (query.includes('SELECT id, user_id FROM sessions WHERE id = ? AND user_id = ? LIMIT 1')) {
        return { id: 'session-a', user_id: 'user-a' };
      }
      if (query.includes('FROM question_requests')) {
        return {
          id: 'req-plan',
          session_id: 'session-a',
          user_id: 'user-a',
          tool_name: 'ExitPlanMode',
          title: 'Exit plan mode',
          questions_json: JSON.stringify([
            {
              question: 'Do you approve this plan?',
              header: 'Plan approval',
              multiple: false,
              options: [
                { label: 'Start implementation', description: 'Approve' },
                { label: 'Continue planning', description: 'Keep planning' },
              ],
            },
          ]),
          answer_json: null,
          request_payload_json: JSON.stringify({
            clientRequestId: 'client-1',
            nextRound: 3,
            toolCallId: 'tool-1',
            rawInput: { plan: '1. do things' },
            requestData: { message: 'continue' },
          }),
          status: 'pending',
          created_at: '2026-04-01T00:00:00.000Z',
        };
      }
      if (query.includes('SELECT metadata_json FROM sessions WHERE id = ? LIMIT 1')) {
        return {
          metadata_json: JSON.stringify({ planMode: true, toolSurfaceProfile: 'openawork' }),
        };
      }
      return undefined;
    });

    const response = await app.inject({
      method: 'POST',
      url: '/sessions/session-a/questions/reply',
      payload: {
        requestId: 'req-plan',
        status: 'answered',
        answers: [['Start implementation']],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.sqliteRunMock).toHaveBeenCalledWith(
      "UPDATE sessions SET metadata_json = ?, updated_at = datetime('now') WHERE id = ?",
      [JSON.stringify({ planMode: false, toolSurfaceProfile: 'openawork' }), 'session-a'],
    );
    await vi.waitFor(() => {
      expect(mocks.resumeAnsweredQuestionRequestMock).toHaveBeenCalledWith({
        payload: {
          clientRequestId: 'client-1',
          nextRound: 3,
          toolCallId: 'tool-1',
          rawInput: { plan: '1. do things' },
          requestData: { message: 'continue' },
          toolName: 'ExitPlanMode',
        },
        answerOutput: 'Do you approve this plan?="Start implementation"',
        sessionId: 'session-a',
        userId: 'user-a',
      });
    });
  });

  it('keeps planMode enabled when the user chooses to continue planning', async () => {
    mocks.sqliteGetMock.mockImplementation((query: string) => {
      if (query.includes('SELECT id, user_id FROM sessions WHERE id = ? AND user_id = ? LIMIT 1')) {
        return { id: 'session-a', user_id: 'user-a' };
      }
      if (query.includes('FROM question_requests')) {
        return {
          id: 'req-plan',
          session_id: 'session-a',
          user_id: 'user-a',
          tool_name: 'ExitPlanMode',
          title: 'Exit plan mode',
          questions_json: JSON.stringify([
            {
              question: 'Do you approve this plan?',
              header: 'Plan approval',
              multiple: false,
              options: [
                { label: 'Start implementation', description: 'Approve' },
                { label: 'Continue planning', description: 'Keep planning' },
              ],
            },
          ]),
          answer_json: null,
          request_payload_json: JSON.stringify({
            clientRequestId: 'client-2',
            nextRound: 4,
            toolCallId: 'tool-2',
            rawInput: {},
            requestData: { message: 'continue' },
          }),
          status: 'pending',
          created_at: '2026-04-01T00:00:00.000Z',
        };
      }
      if (query.includes('SELECT metadata_json FROM sessions WHERE id = ? LIMIT 1')) {
        return { metadata_json: JSON.stringify({ planMode: true }) };
      }
      return undefined;
    });

    const response = await app.inject({
      method: 'POST',
      url: '/sessions/session-a/questions/reply',
      payload: {
        requestId: 'req-plan',
        status: 'answered',
        answers: [['Continue planning']],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.sqliteRunMock).toHaveBeenCalledWith(
      "UPDATE sessions SET metadata_json = ?, updated_at = datetime('now') WHERE id = ?",
      [JSON.stringify({ planMode: true }), 'session-a'],
    );
  });

  it('preserves agentId when resuming an answered question request', async () => {
    mocks.sqliteGetMock.mockImplementation((query: string) => {
      if (query.includes('SELECT id, user_id FROM sessions WHERE id = ? AND user_id = ? LIMIT 1')) {
        return { id: 'session-a', user_id: 'user-a' };
      }
      if (query.includes('FROM question_requests')) {
        return {
          id: 'req-agent',
          session_id: 'session-a',
          user_id: 'user-a',
          tool_name: 'question',
          title: 'Need input',
          questions_json: JSON.stringify([
            {
              question: '请选择目录',
              header: '目录',
              multiple: false,
              options: [{ label: 'workspace', description: '查看工作目录' }],
            },
          ]),
          answer_json: null,
          request_payload_json: JSON.stringify({
            clientRequestId: 'client-agent',
            nextRound: 2,
            toolCallId: 'tool-agent',
            rawInput: { questions: 1 },
            requestData: {
              agentId: 'sisyphus-junior',
              clientRequestId: 'client-agent',
              message: '请先问我一个问题再继续',
            },
          }),
          status: 'pending',
          created_at: '2026-04-02T00:00:00.000Z',
        };
      }

      return undefined;
    });

    const response = await app.inject({
      method: 'POST',
      url: '/sessions/session-a/questions/reply',
      payload: {
        requestId: 'req-agent',
        status: 'answered',
        answers: [['workspace']],
      },
    });

    expect(response.statusCode).toBe(200);
    await vi.waitFor(() => {
      expect(mocks.resumeAnsweredQuestionRequestMock).toHaveBeenCalledWith({
        payload: {
          clientRequestId: 'client-agent',
          nextRound: 2,
          toolCallId: 'tool-agent',
          rawInput: { questions: 1 },
          requestData: {
            agentId: 'sisyphus-junior',
            clientRequestId: 'client-agent',
            message: '请先问我一个问题再继续',
          },
          toolName: 'question',
        },
        answerOutput: '请选择目录="workspace"',
        sessionId: 'session-a',
        userId: 'user-a',
      });
    });
  });
});
