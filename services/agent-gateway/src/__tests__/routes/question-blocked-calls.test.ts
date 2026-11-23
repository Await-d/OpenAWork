import Fastify from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as RuntimeModule from '../../routes/stream-runtime.js';
import type { ApprovedPermissionResumePayload } from '../../routes/stream.js';
import type * as AuthModule from '../../infra/auth.js';
import type * as WorkflowModule from '../../runtime/request-workflow.js';
import type * as QuestionsModule from '../../routes/questions.js';
import type * as SharedRoutesModule from '../../routes/session-shared-read-routes.js';
import type * as PermissionLadderModule from '../../tools/sandbox/permission-ladder.js';

const mocks = vi.hoisted(() => ({
  resumeAnsweredQuestionRequest: vi.fn<typeof RuntimeModule.resumeAnsweredQuestionRequest>(),
}));

vi.mock('../../routes/stream-runtime.js', async (importOriginal) => ({
  ...(await importOriginal<typeof RuntimeModule>()),
  resumeAnsweredQuestionRequest: mocks.resumeAnsweredQuestionRequest,
}));

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let db: typeof DbModule;
let recordBlockedCalls: typeof PermissionLadderModule.recordBlockedToolCallsForPendingRequest;
let authPlugin: typeof AuthModule.default;
let workflowPlugin: typeof WorkflowModule.default;
let questionsRoutes: typeof QuestionsModule.questionsRoutes;
let sharedRoutes: typeof SharedRoutesModule.registerSessionSharedReadRoutes;

const OWNER = 'blocked-question-owner';
const VIEWER = 'blocked-question-viewer';
const SESSION = 'blocked-question-session';
const REQUEST = 'blocked-question-request';
const calls = [
  { toolCallId: 'blocked-first', toolName: 'bash', rawInput: { command: 'pwd' } },
  { toolCallId: 'blocked-second', toolName: 'read', rawInput: { path: 'README.md' } },
];

function payload(): ApprovedPermissionResumePayload {
  return {
    clientRequestId: 'blocked-question-turn',
    nextRound: 2,
    toolCallId: 'question-anchor',
    toolName: 'question',
    rawInput: { questions: [{ question: '继续？', options: [{ label: '是' }] }] },
    requestData: {
      clientRequestId: 'blocked-question-turn',
      message: '确认后继续',
      webSearchEnabled: false,
    },
  };
}

function insertQuestion(requestPayload: unknown, status = 'pending'): void {
  db.sqliteRun(
    `INSERT INTO question_requests
       (id, session_id, user_id, tool_name, title, questions_json, request_payload_json, status)
     VALUES (?, ?, ?, 'question', '继续', ?, ?, ?)`,
    [
      REQUEST,
      SESSION,
      OWNER,
      JSON.stringify(payload().rawInput['questions']),
      JSON.stringify(requestPayload),
      status,
    ],
  );
}

beforeAll(async () => {
  db = await import('../../infra/db.js');
  await db.migrate();
  ({ recordBlockedToolCallsForPendingRequest: recordBlockedCalls } =
    await import('../../tools/sandbox/permission-ladder.js'));
  ({ default: authPlugin } = await import('../../infra/auth.js'));
  ({ default: workflowPlugin } = await import('../../runtime/request-workflow.js'));
  ({ questionsRoutes } = await import('../../routes/questions.js'));
  ({ registerSessionSharedReadRoutes: sharedRoutes } =
    await import('../../routes/session-shared-read-routes.js'));
});

beforeEach(() => {
  mocks.resumeAnsweredQuestionRequest.mockReset().mockResolvedValue(undefined);
  db.sqliteRun('DELETE FROM question_requests', []);
  db.sqliteRun('DELETE FROM permission_requests', []);
  db.sqliteRun('DELETE FROM session_shares', []);
  db.sqliteRun('DELETE FROM team_members', []);
  db.sqliteRun('DELETE FROM sessions', []);
  db.sqliteRun('DELETE FROM users', []);
  for (const id of [OWNER, VIEWER]) {
    db.sqliteRun("INSERT INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
      id,
      `${id}@example.com`,
    ]);
  }
  db.sqliteRun(
    `INSERT INTO sessions (id, user_id, title, messages_json, metadata_json, state_status)
     VALUES (?, ?, 'blocked question', '[]', '{}', 'paused')`,
    [SESSION, OWNER],
  );
});

afterAll(async () => {
  await db.closeDb();
});

describe('问题恢复的阻塞工具载荷', () => {
  it('写回问题请求时保留问题锚点并按首次出现顺序合并去重', () => {
    insertQuestion({ ...payload(), blockedToolCalls: [calls[0]] });
    recordBlockedCalls(REQUEST, [calls[0]!, calls[1]!]);
    recordBlockedCalls(REQUEST, [calls[1]!]);

    const row = db.sqliteGet<{ request_payload_json: string }>(
      'SELECT request_payload_json FROM question_requests WHERE id = ?',
      [REQUEST],
    );
    expect(JSON.parse(row!.request_payload_json)).toEqual({
      ...payload(),
      blockedToolCalls: calls,
    });
  });

  it('已回答的问题不再写入阻塞调用', () => {
    insertQuestion(payload(), 'answered');
    recordBlockedCalls(REQUEST, calls);
    const row = db.sqliteGet<{ request_payload_json: string }>(
      'SELECT request_payload_json FROM question_requests WHERE id = ?',
      [REQUEST],
    );
    expect(JSON.parse(row!.request_payload_json)).toEqual(payload());
  });

  it('权限请求仍镜像首个阻塞调用到旧锚点', () => {
    db.sqliteRun(
      `INSERT INTO permission_requests
         (id, session_id, tool_name, scope, reason, risk_level, status, request_payload_json)
       VALUES (?, ?, 'bash', '*', '确认', 'medium', 'pending', ?)`,
      [REQUEST, SESSION, JSON.stringify(payload())],
    );
    recordBlockedCalls(REQUEST, calls);
    const row = db.sqliteGet<{ request_payload_json: string }>(
      'SELECT request_payload_json FROM permission_requests WHERE id = ?',
      [REQUEST],
    );
    expect(JSON.parse(row!.request_payload_json)).toEqual({
      ...payload(),
      ...calls[0],
      blockedToolCalls: calls,
    });
  });

  it.each([false, true])('回答路由 shared=%s 透传合法阻塞调用并过滤损坏条目', async (shared) => {
    insertQuestion({
      ...payload(),
      blockedToolCalls: [
        calls[0],
        null,
        { toolCallId: '', toolName: 'bash', rawInput: {} },
        { toolCallId: 'no-name', rawInput: {} },
        { toolCallId: 'bad-input', toolName: 'bash', rawInput: 'pwd' },
        calls[1],
      ],
    });
    if (shared) {
      db.sqliteRun(
        `INSERT INTO team_members (id, user_id, name, email, role, status)
         VALUES ('blocked-viewer-member', ?, 'viewer', ?, 'member', 'idle')`,
        [OWNER, `${VIEWER}@example.com`],
      );
      db.sqliteRun(
        `INSERT INTO session_shares (id, user_id, session_id, member_id, permission)
         VALUES ('blocked-share', ?, ?, 'blocked-viewer-member', 'operate')`,
        [OWNER, SESSION],
      );
    }
    const app = Fastify();
    try {
      await app.register(workflowPlugin);
      await app.register(authPlugin);
      await app.register(shared ? sharedRoutes : questionsRoutes);
      const userId = shared ? VIEWER : OWNER;
      const token = app.jwt.sign({ sub: userId, email: `${userId}@example.com` });
      const response = await app.inject({
        method: 'POST',
        url: shared
          ? `/sessions/shared-with-me/${SESSION}/questions/reply`
          : `/sessions/${SESSION}/questions/reply`,
        headers: { authorization: `Bearer ${token}` },
        payload: { requestId: REQUEST, status: 'answered', answers: [['是']] },
      });
      expect(response.statusCode, response.body).toBe(200);
      expect(mocks.resumeAnsweredQuestionRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: SESSION,
          userId: OWNER,
          payload: expect.objectContaining({
            toolCallId: payload().toolCallId,
            rawInput: payload().rawInput,
            blockedToolCalls: calls,
          }),
        }),
      );
    } finally {
      await app.close();
    }
  });
});
