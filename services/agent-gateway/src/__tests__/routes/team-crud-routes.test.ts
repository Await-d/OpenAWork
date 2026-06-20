import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as AuthModule from '../../infra/auth.js';
import type * as DbModule from '../../infra/db.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';
import type * as TeamCrudModule from '../../routes/team-crud.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let authPlugin: typeof AuthModule.default;
let dbModule: typeof DbModule;
let requestWorkflowPlugin: typeof RequestWorkflowModule.default;
let teamCrudRoutes: typeof TeamCrudModule.teamCrudRoutes;

const USER_ID = 'u-team-crud-route';
const OTHER_USER_ID = 'u-team-crud-route-other';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(requestWorkflowPlugin);
  await app.register(authPlugin);
  await app.register(teamCrudRoutes);
  await app.ready();
  return app;
}

function bearer(app: FastifyInstance, userId = USER_ID): string {
  const token = app.jwt.sign({ sub: userId, email: `${userId}@example.com` });
  return `Bearer ${token}`;
}

function seedUser(id: string): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    id,
    `${id}@example.com`,
  ]);
}

function seedTeamMember(memberId: string, userId: string, email: string): void {
  dbModule.sqliteRun(
    `INSERT INTO team_members (id, user_id, name, email, role, avatar_url, status)
     VALUES (?, ?, '成员', ?, 'member', NULL, 'idle')`,
    [memberId, userId, email],
  );
}

function seedSession(sessionId: string, userId: string): void {
  dbModule.sqliteRun(
    `INSERT INTO sessions (id, user_id, title, metadata_json, state_status)
     VALUES (?, ?, 'demo', '{}', 'idle')`,
    [sessionId, userId],
  );
}

function seedTask(taskId: string, userId: string): void {
  dbModule.sqliteRun(
    `INSERT INTO team_tasks (id, user_id, title, assignee_id, status, priority, result)
     VALUES (?, ?, '任务', NULL, 'pending', 'medium', NULL)`,
    [taskId, userId],
  );
}

function seedTeamMessage(
  messageId: string,
  userId: string,
  input: {
    content?: string;
    recipientMemberId?: string | null;
    replyToMessageId?: string | null;
    sessionId?: string | null;
    senderId?: string | null;
    type?: string;
  } = {},
): void {
  dbModule.sqliteRun(
    `INSERT INTO team_messages
	      (id, user_id, session_id, sender_id, recipient_member_id, reply_to_message_id, content, type)
	     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      messageId,
      userId,
      input.sessionId ?? null,
      input.senderId ?? null,
      input.recipientMemberId ?? null,
      input.replyToMessageId ?? null,
      input.content ?? '团队消息',
      input.type ?? 'update',
    ],
  );
}

function seedSessionShare(
  shareId: string,
  userId: string,
  sessionId: string,
  memberId: string,
): void {
  dbModule.sqliteRun(
    `INSERT INTO session_shares (id, user_id, session_id, member_id, permission, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'view', datetime('now'), datetime('now'))`,
    [shareId, userId, sessionId, memberId],
  );
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  authPlugin = (await import('../../infra/auth.js')).default;
  requestWorkflowPlugin = (await import('../../runtime/request-workflow.js')).default;
  teamCrudRoutes = (await import('../../routes/team-crud.js')).teamCrudRoutes;
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM team_audit_logs', []);
  dbModule.sqliteRun('DELETE FROM session_shares', []);
  dbModule.sqliteRun('DELETE FROM team_messages', []);
  dbModule.sqliteRun('DELETE FROM team_tasks', []);
  dbModule.sqliteRun('DELETE FROM team_members', []);
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  seedUser(USER_ID);
  seedUser(OTHER_USER_ID);
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('team crud routes', () => {
  it('POST /team/members 对重复邮箱返回结构化 409', async () => {
    seedTeamMember('member-1', USER_ID, 'member@example.com');
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/team/members',
        headers: {
          authorization: bearer(app),
          'content-type': 'application/json',
        },
        payload: {
          name: '成员 2',
          email: 'member@example.com',
          role: 'member',
        },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        code: 'team_member_already_exists',
        error: '该邮箱对应的团队成员已存在。',
      });
    } finally {
      await app.close();
    }
  });

  it('PATCH /team/tasks/:id 对其他用户任务返回结构化 404', async () => {
    seedTask('task-other', OTHER_USER_ID);
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'PATCH',
        url: '/team/tasks/task-other',
        headers: {
          authorization: bearer(app),
          'content-type': 'application/json',
        },
        payload: {
          status: 'done',
        },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({
        code: 'team_task_not_found',
        error: '目标团队任务不存在。',
      });
    } finally {
      await app.close();
    }
  });

  it('POST /team/session-shares 在会话不存在时返回结构化 404', async () => {
    seedTeamMember('member-1', USER_ID, 'member@example.com');
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/team/session-shares',
        headers: {
          authorization: bearer(app),
          'content-type': 'application/json',
        },
        payload: {
          sessionId: 'missing-session',
          memberId: 'member-1',
          permission: 'view',
        },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({
        code: 'team_session_not_found',
        error: '目标会话不存在。',
      });
    } finally {
      await app.close();
    }
  });

  it('POST /team/messages 会落库并在 GET /team/messages 中返回定向跟进字段', async () => {
    seedSession('session-1', USER_ID);
    seedTeamMember('member-sender', USER_ID, 'sender@example.com');
    seedTeamMember('member-recipient', USER_ID, 'recipient@example.com');
    seedTeamMessage('msg-parent', USER_ID, {
      sessionId: 'session-1',
      senderId: 'member-sender',
      content: '同步设计稿调整',
      type: 'update',
    });

    const app = await buildApp();
    try {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/team/messages',
        headers: {
          authorization: bearer(app),
          'content-type': 'application/json',
        },
        payload: {
          sessionId: 'session-1',
          senderId: 'member-sender',
          recipientMemberId: 'member-recipient',
          replyToMessageId: 'msg-parent',
          content: '接口联调已完成',
          type: 'result',
        },
      });

      expect(createResponse.statusCode).toBe(201);
      const createdMessage = createResponse.json() as {
        id: string;
        memberId: string;
        recipientMemberId: string | null;
        replyToMessageId: string | null;
        sessionId: string | null;
        type: string;
      };
      expect(createdMessage).toMatchObject({
        memberId: 'member-sender',
        recipientMemberId: 'member-recipient',
        replyToMessageId: 'msg-parent',
        sessionId: 'session-1',
        type: 'result',
      });

      const storedRow = dbModule.sqliteGet<{
        recipient_member_id: string | null;
        reply_to_message_id: string | null;
        session_id: string | null;
        sender_id: string | null;
        type: string;
      }>(
        `SELECT session_id, sender_id, recipient_member_id, reply_to_message_id, type
	           FROM team_messages
	          WHERE id = ?`,
        [createdMessage.id],
      );
      expect(storedRow).toMatchObject({
        session_id: 'session-1',
        sender_id: 'member-sender',
        recipient_member_id: 'member-recipient',
        reply_to_message_id: 'msg-parent',
        type: 'result',
      });

      const listResponse = await app.inject({
        method: 'GET',
        url: '/team/messages',
        headers: {
          authorization: bearer(app),
        },
      });

      expect(listResponse.statusCode).toBe(200);
      expect(listResponse.json()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: createdMessage.id,
            memberId: 'member-sender',
            recipientMemberId: 'member-recipient',
            replyToMessageId: 'msg-parent',
            sessionId: 'session-1',
            content: '接口联调已完成',
            type: 'result',
          }),
        ]),
      );
    } finally {
      await app.close();
    }
  });

  it('POST /team/messages 对非法 recipientMemberId 返回结构化 404', async () => {
    seedTeamMember('member-sender', USER_ID, 'sender@example.com');
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/team/messages',
        headers: {
          authorization: bearer(app),
          'content-type': 'application/json',
        },
        payload: {
          senderId: 'member-sender',
          recipientMemberId: 'missing-member',
          content: '结果已确认',
          type: 'result',
        },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({
        code: 'team_member_not_found',
        error: '目标团队成员不存在。',
      });
    } finally {
      await app.close();
    }
  });

  it('POST /team/messages 对非法 replyToMessageId 返回结构化 404', async () => {
    seedTeamMember('member-sender', USER_ID, 'sender@example.com');
    seedTeamMember('member-recipient', USER_ID, 'recipient@example.com');
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/team/messages',
        headers: {
          authorization: bearer(app),
          'content-type': 'application/json',
        },
        payload: {
          senderId: 'member-sender',
          recipientMemberId: 'member-recipient',
          replyToMessageId: 'missing-message',
          content: '结果已确认',
          type: 'result',
        },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({
        code: 'team_message_not_found',
        error: '目标团队消息不存在。',
      });
    } finally {
      await app.close();
    }
  });

  it('GET /team/messages 只返回最近 100 条消息，并保持时间正序', async () => {
    for (let i = 0; i < 105; i += 1) {
      seedTeamMessage(`msg-${String(i).padStart(3, '0')}`, USER_ID, {
        content: `message-${i}`,
        type: 'update',
      });
    }

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/team/messages',
        headers: {
          authorization: bearer(app),
        },
      });

      expect(response.statusCode).toBe(200);
      const messages = response.json() as Array<{ content: string; id: string }>;
      expect(messages).toHaveLength(100);
      expect(messages[0]).toMatchObject({
        id: 'msg-005',
        content: 'message-5',
      });
      expect(messages.at(-1)).toMatchObject({
        id: 'msg-104',
        content: 'message-104',
      });
    } finally {
      await app.close();
    }
  });

  it('POST /team/session-shares 对重复共享返回结构化 409', async () => {
    seedTeamMember('member-1', USER_ID, 'member@example.com');
    seedSession('session-1', USER_ID);
    seedSessionShare('share-1', USER_ID, 'session-1', 'member-1');
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/team/session-shares',
        headers: {
          authorization: bearer(app),
          'content-type': 'application/json',
        },
        payload: {
          sessionId: 'session-1',
          memberId: 'member-1',
          permission: 'view',
        },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        code: 'team_session_share_already_exists',
        error: '该会话共享记录已存在。',
      });
    } finally {
      await app.close();
    }
  });

  it('PATCH /team/session-shares/:id 对不存在共享返回结构化 404', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'PATCH',
        url: '/team/session-shares/share-missing',
        headers: {
          authorization: bearer(app),
          'content-type': 'application/json',
        },
        payload: {
          permission: 'operate',
        },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({
        code: 'team_session_share_not_found',
        error: '目标会话共享记录不存在。',
      });
    } finally {
      await app.close();
    }
  });

  it('session share 的创建 / 更新 / 删除都会写入带 sessionId 的审计日志', async () => {
    seedTeamMember('member-1', USER_ID, 'member@example.com');
    seedSession('session-1', USER_ID);
    const app = await buildApp();
    try {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/team/session-shares',
        headers: {
          authorization: bearer(app),
          'content-type': 'application/json',
        },
        payload: {
          sessionId: 'session-1',
          memberId: 'member-1',
          permission: 'view',
        },
      });
      expect(createResponse.statusCode).toBe(201);
      const createdShare = createResponse.json() as { id: string };

      const createdAudit = dbModule.sqliteGet<{
        action: string;
        entity_type: string;
        session_id: string | null;
      }>(
        `SELECT action, entity_type, session_id
           FROM team_audit_logs
          ORDER BY id DESC
          LIMIT 1`,
      );
      expect(createdAudit).toMatchObject({
        action: 'share_created',
        entity_type: 'session_share',
        session_id: 'session-1',
      });

      const updateResponse = await app.inject({
        method: 'PATCH',
        url: `/team/session-shares/${createdShare.id}`,
        headers: {
          authorization: bearer(app),
          'content-type': 'application/json',
        },
        payload: {
          permission: 'operate',
        },
      });
      expect(updateResponse.statusCode).toBe(200);

      const updatedAudit = dbModule.sqliteGet<{
        action: string;
        entity_type: string;
        session_id: string | null;
      }>(
        `SELECT action, entity_type, session_id
           FROM team_audit_logs
          ORDER BY id DESC
          LIMIT 1`,
      );
      expect(updatedAudit).toMatchObject({
        action: 'share_permission_updated',
        entity_type: 'session_share',
        session_id: 'session-1',
      });

      const deleteResponse = await app.inject({
        method: 'DELETE',
        url: `/team/session-shares/${createdShare.id}`,
        headers: {
          authorization: bearer(app),
        },
      });
      expect(deleteResponse.statusCode).toBe(204);

      const deletedAudit = dbModule.sqliteGet<{
        action: string;
        entity_type: string;
        session_id: string | null;
      }>(
        `SELECT action, entity_type, session_id
           FROM team_audit_logs
          ORDER BY id DESC
          LIMIT 1`,
      );
      expect(deletedAudit).toMatchObject({
        action: 'share_deleted',
        entity_type: 'session_share',
        session_id: 'session-1',
      });
    } finally {
      await app.close();
    }
  });
});
