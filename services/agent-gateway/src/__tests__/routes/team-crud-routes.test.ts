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
  dbModule.sqliteRun('DELETE FROM session_shares', []);
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
});
