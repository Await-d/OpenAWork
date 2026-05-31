/**
 * Regression (§0.120, pending-questions list per-row tolerance):
 * GET /sessions/:id/questions/pending read all pending question_requests rows
 * and mapped each with an unguarded JSON.parse(questions_json). A single
 * corrupt row (crash mid-write, disk error, hand-edited DB) threw and 500'd the
 * WHOLE pending-question list for that session — blanking every pending
 * question, not just the bad one. The list now skips a corrupt row (per-row
 * tolerant map → null + filter), mirroring the sibling mapRecoveryQuestionRequestRow
 * (sessions.ts) / mapQuestionRequestRow (session-shared-read-routes.ts).
 */

import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sqliteAll: vi.fn(() => [] as unknown[]),
  sqliteGet: vi.fn(),
  sqliteRun: vi.fn(),
  publishSessionRunEvent: vi.fn(),
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
  parseSessionMetadataJson: vi.fn(() => ({})),
}));

vi.mock('../../tools/plan-mode-tools.js', () => ({
  shouldExitPlanModeFromAnswers: vi.fn(() => false),
}));

vi.mock('../../routes/stream.js', () => ({
  setPersistedSessionStateStatus: vi.fn(),
}));

vi.mock('../../routes/stream-runtime.js', () => ({
  resumeAnsweredQuestionRequest: vi.fn(async () => undefined),
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

const QUESTIONS_JSON = JSON.stringify([
  { header: 'h', question: 'q', options: [{ label: 'a', description: 'a' }] },
]);

function row(id: string, questionsJson: string) {
  return {
    id,
    session_id: SESSION_ID,
    user_id: USER_ID,
    tool_name: 'question',
    title: 'Question',
    questions_json: questionsJson,
    answer_json: null,
    request_payload_json: null,
    expires_at: null,
    status: 'pending',
    created_at: new Date().toISOString(),
  };
}

async function createApp() {
  const app = Fastify();
  await app.register(questionsRoutes);
  return app;
}

describe('GET /sessions/:id/questions/pending per-row resilience', () => {
  beforeEach(() => {
    mocks.sqliteAll.mockReset().mockReturnValue([]);
    mocks.sqliteGet.mockReset();
    mocks.sqliteRun.mockReset();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it('单行 questions_json 损坏时返回 200 且只列健康问题而非整列 500', async () => {
    // Ownership check passes; then the pending list query returns healthy + corrupt.
    mocks.sqliteGet.mockReturnValue({ id: SESSION_ID, user_id: USER_ID });
    mocks.sqliteAll.mockReturnValue([
      row('q-good', QUESTIONS_JSON),
      row('q-poison', '{not valid json'),
    ]);

    const app = await createApp();
    const response = await app.inject({
      method: 'GET',
      url: `/sessions/${SESSION_ID}/questions/pending`,
    });

    // Before the fix the corrupt row threw → 500.
    expect(response.statusCode).toBe(200);
    const body = response.json() as { requests: Array<{ requestId: string }> };
    const ids = body.requests.map((r) => r.requestId);
    expect(ids).toEqual(['q-good']);
    expect(console.warn).toHaveBeenCalled();
  });
});
