import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as AuthModule from '../../infra/auth.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';
import type * as SessionsRoutesModule from '../../routes/sessions.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';
process.env['AI_API_BASE_URL'] = '';
process.env['AI_API_KEY'] = '';
process.env['AI_DEFAULT_MODEL'] = '';

let dbModule: typeof DbModule;
let authPlugin: typeof AuthModule.default;
let requestWorkflowPlugin: typeof RequestWorkflowModule.default;
let sessionsRoutes: typeof SessionsRoutesModule.sessionsRoutes;

const OWNER_ID = 'u-shared-owner';
const VIEWER_ID = 'u-shared-viewer';
const MEMBER_ID = 'tm-shared-viewer';
const SESSION_ID = 'sess-shared-1';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(requestWorkflowPlugin);
  await app.register(authPlugin);
  await app.register(sessionsRoutes);
  await app.ready();
  return app;
}

function bearer(app: FastifyInstance, userId = VIEWER_ID): string {
  const token = app.jwt.sign({ sub: userId, email: `${userId}@example.com` });
  return `Bearer ${token}`;
}

function seedUser(id: string): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    id,
    `${id}@example.com`,
  ]);
}

function seedSharedSession(permission: 'view' | 'comment' | 'operate' = 'operate'): void {
  dbModule.sqliteRun(
    `INSERT OR IGNORE INTO sessions (id, user_id, title, messages_json, metadata_json, state_status)
     VALUES (?, ?, 'shared title', '[]', '{}', 'running')`,
    [SESSION_ID, OWNER_ID],
  );
  dbModule.sqliteRun(
    `INSERT OR IGNORE INTO team_members
      (id, user_id, name, email, role, avatar_url, status)
     VALUES (?, ?, 'viewer', ?, 'member', NULL, 'idle')`,
    [MEMBER_ID, OWNER_ID, `${VIEWER_ID}@example.com`],
  );
  dbModule.sqliteRun(
    `INSERT OR IGNORE INTO session_shares
      (id, user_id, session_id, member_id, permission)
     VALUES ('share-1', ?, ?, ?, ?)`,
    [OWNER_ID, SESSION_ID, MEMBER_ID, permission],
  );
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.migrate();
  const auth = await import('../../infra/auth.js');
  authPlugin = auth.default;
  const requestWorkflow = await import('../../runtime/request-workflow.js');
  requestWorkflowPlugin = requestWorkflow.default;
  const sessions = await import('../../routes/sessions.js');
  sessionsRoutes = sessions.sessionsRoutes;
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM permission_decision_logs', []);
  dbModule.sqliteRun('DELETE FROM shared_session_comments', []);
  dbModule.sqliteRun('DELETE FROM permission_requests', []);
  dbModule.sqliteRun('DELETE FROM question_requests', []);
  dbModule.sqliteRun('DELETE FROM session_shares', []);
  dbModule.sqliteRun('DELETE FROM team_members', []);
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  seedUser(OWNER_ID);
  seedUser(VIEWER_ID);
  seedSharedSession('operate');
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('shared session action routes', () => {
  it('共享权限请求不存在时返回中文 404', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/sessions/shared-with-me/${SESSION_ID}/permissions/reply`,
        headers: { authorization: bearer(app) },
        payload: { requestId: 'perm-missing', decision: 'reject' },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({
        error: '目标权限请求不存在。',
      });
    } finally {
      await app.close();
    }
  });

  it('创建共享评论后返回 comment 与 detail 预览', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/sessions/shared-with-me/${SESSION_ID}/comments`,
        headers: { authorization: bearer(app) },
        payload: { content: 'hello shared comment' },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({
        comment: {
          sessionId: SESSION_ID,
          content: 'hello shared comment',
        },
        detail: {
          share: {
            sessionId: SESSION_ID,
            permission: 'operate',
          },
          comments: [
            expect.objectContaining({
              sessionId: SESSION_ID,
              content: 'hello shared comment',
            }),
          ],
        },
      });
    } finally {
      await app.close();
    }
  });

  it('处理共享权限请求后返回去掉 pending 的 detail 预览', async () => {
    dbModule.sqliteRun(
      `INSERT INTO permission_requests
        (id, session_id, tool_name, scope, reason, risk_level, preview_action, request_payload_json, expires_at, always_json, status)
       VALUES ('perm-1', ?, 'bash', 'bash ls *', 'need inspect', 'medium', 'ls -la', NULL, NULL, NULL, 'pending')`,
      [SESSION_ID],
    );

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/sessions/shared-with-me/${SESSION_ID}/permissions/reply`,
        headers: { authorization: bearer(app) },
        payload: { requestId: 'perm-1', decision: 'reject' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        ok: true,
        detail: {
          share: {
            sessionId: SESSION_ID,
          },
          pendingPermissions: [],
        },
      });
    } finally {
      await app.close();
    }
  });

  it('处理共享问题后返回去掉 pending 的 detail 预览', async () => {
    dbModule.sqliteRun(
      `INSERT INTO question_requests
        (id, session_id, user_id, tool_name, title, questions_json, answer_json, request_payload_json, expires_at, status)
       VALUES ('question-1', ?, ?, 'AskFollowUpQuestion', 'need answer', '[]', NULL, NULL, NULL, 'pending')`,
      [SESSION_ID, OWNER_ID],
    );

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/sessions/shared-with-me/${SESSION_ID}/questions/reply`,
        headers: { authorization: bearer(app) },
        payload: { requestId: 'question-1', status: 'dismissed', answers: [] },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        ok: true,
        detail: {
          share: {
            sessionId: SESSION_ID,
          },
          pendingQuestions: [],
        },
      });
    } finally {
      await app.close();
    }
  });

  it('GET /sessions/shared-with-me/:sessionId 跳过 questions_json 损坏的单条提问而不是整列 500', async () => {
    // One corrupt pending-question row must not make the whole shared-session
    // detail unreadable (§0.89-§0.92 class): the list skips the bad row.
    dbModule.sqliteRun(
      `INSERT INTO question_requests
        (id, session_id, user_id, tool_name, title, questions_json, answer_json, request_payload_json, expires_at, status)
       VALUES ('question-good', ?, ?, 'AskFollowUpQuestion', '好问题', '[]', NULL, NULL, NULL, 'pending')`,
      [SESSION_ID, OWNER_ID],
    );
    dbModule.sqliteRun(
      `INSERT INTO question_requests
        (id, session_id, user_id, tool_name, title, questions_json, answer_json, request_payload_json, expires_at, status)
       VALUES ('question-broken', ?, ?, 'AskFollowUpQuestion', '坏问题', '{broken-json', NULL, NULL, NULL, 'pending')`,
      [SESSION_ID, OWNER_ID],
    );

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: `/sessions/shared-with-me/${SESSION_ID}`,
        headers: { authorization: bearer(app) },
      });

      expect(res.statusCode).toBe(200);
      const pendingQuestions = res.json().pendingQuestions as Array<{ requestId: string }>;
      const ids = pendingQuestions.map((q) => q.requestId);
      expect(ids).toContain('question-good');
      expect(ids).not.toContain('question-broken');
    } finally {
      await app.close();
    }
  });

  it('跳过不存在的共享提问请求时按幂等成功返回 detail 预览', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/sessions/shared-with-me/${SESSION_ID}/questions/reply`,
        headers: { authorization: bearer(app) },
        payload: { requestId: 'question-missing', status: 'dismissed', answers: [] },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        ok: true,
        idempotent: true,
        detail: {
          share: {
            sessionId: SESSION_ID,
          },
          pendingQuestions: [],
        },
      });
    } finally {
      await app.close();
    }
  });

  it('回答不存在的共享提问请求时仍返回中文 404', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/sessions/shared-with-me/${SESSION_ID}/questions/reply`,
        headers: { authorization: bearer(app) },
        payload: { requestId: 'question-missing', status: 'answered', answers: [['ok']] },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({
        error: '目标提问请求不存在。',
      });
    } finally {
      await app.close();
    }
  });
});
