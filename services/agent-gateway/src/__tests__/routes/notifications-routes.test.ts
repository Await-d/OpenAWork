/**
 * Regression: POST /notifications/:notificationId/read must match even when the
 * notification id is a long composite string.
 *
 * Notification ids are server-generated as
 * `notification:<sessionId>:<eventType>:<scope>:<seq>` and routinely exceed 100
 * characters. find-my-way (Fastify's router) caps a single path parameter at
 * 100 chars by default (`maxParamLength`), so without raising that cap the route
 * silently fails to match and Fastify returns its default "Not Found" — the
 * mark-as-read call 404s even though the handler/SQL would have happily no-op'd.
 *
 * We bootstrap the app with the SAME `routerOptions.maxParamLength` the
 * production gateway uses (see services/agent-gateway/src/index.ts) so this test
 * fails if that override is ever removed.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as AuthModule from '../../infra/auth.js';
import type * as DbModule from '../../infra/db.js';
import { registerErrorHandler } from '../../infra/error-handler.js';
import { GATEWAY_MAX_PARAM_LENGTH } from '../../infra/router-options.js';
import type * as NotificationsRoutesModule from '../../routes/notifications.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['JWT_SECRET'] = 'notifications-routes-test-secret-1234567890';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let authPlugin: typeof AuthModule.default;
let dbModule: typeof DbModule;
let notificationsRoutes: typeof NotificationsRoutesModule.notificationsRoutes;
let requestWorkflowPlugin: typeof RequestWorkflowModule.default;

const USER_ID = 'u-notifications-routes';
const SESSION_ID = 'sess-notifications-routes';

// 105 chars — mirrors a real question_asked notification id and exceeds the
// default find-my-way maxParamLength of 100.
const LONG_NOTIFICATION_ID =
  'notification:4703df2e-bb86-4931-b9a9-5b1232f444d3:question_asked:a8f51a48-f528-4ee1-83b9-5432419b68c4:101';

async function buildApp(): Promise<FastifyInstance> {
  // Uses the same router config the production gateway applies (index.ts), so
  // this test fails if GATEWAY_MAX_PARAM_LENGTH is lowered back under the id length.
  const app = Fastify({ routerOptions: { maxParamLength: GATEWAY_MAX_PARAM_LENGTH } });
  registerErrorHandler(app);
  await app.register(requestWorkflowPlugin);
  await app.register(authPlugin);
  await app.register(notificationsRoutes);
  await app.ready();
  return app;
}

function bearer(app: FastifyInstance): string {
  return `Bearer ${app.jwt.sign({ sub: USER_ID, email: 'notifications@example.com' })}`;
}

function seedUser(id: string): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    id,
    `${id}@example.com`,
  ]);
}

function seedSession(sessionId: string): void {
  dbModule.sqliteRun(
    `INSERT OR IGNORE INTO sessions (id, user_id, title, metadata_json, state_status)
     VALUES (?, ?, 'notification session', '{}', 'idle')`,
    [sessionId, USER_ID],
  );
}

function seedNotification(id: string): void {
  dbModule.sqliteRun(
    `INSERT INTO notifications (id, user_id, session_id, event_type, kind, title, body, status, created_at)
     VALUES (?, ?, ?, 'question_asked', 'actionable', '等待回答', 'body', 'unread', datetime('now'))`,
    [id, USER_ID, SESSION_ID],
  );
}

function seedInformational(id: string): void {
  dbModule.sqliteRun(
    `INSERT INTO notifications (id, user_id, session_id, event_type, kind, title, body, status, created_at)
     VALUES (?, ?, ?, 'task_update', 'informational', '任务已完成', 'body', 'unread', datetime('now'))`,
    [id, USER_ID, SESSION_ID],
  );
}

function statusOf(id: string): string | undefined {
  return dbModule.sqliteGet<{ status: string }>(
    'SELECT status FROM notifications WHERE id = ? AND user_id = ? LIMIT 1',
    [id, USER_ID],
  )?.status;
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  authPlugin = (await import('../../infra/auth.js')).default;
  requestWorkflowPlugin = (await import('../../runtime/request-workflow.js')).default;
  notificationsRoutes = (await import('../../routes/notifications.js')).notificationsRoutes;
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM notifications', []);
  seedUser(USER_ID);
  seedSession(SESSION_ID);
});

describe('POST /notifications/:notificationId/read', () => {
  it('matches and marks read for a long composite notification id', async () => {
    const app = await buildApp();
    try {
      seedNotification(LONG_NOTIFICATION_ID);
      expect(LONG_NOTIFICATION_ID.length).toBeGreaterThan(100);

      const response = await app.inject({
        method: 'POST',
        // Raw, unencoded id — exactly what the web client sends.
        url: `/notifications/${LONG_NOTIFICATION_ID}/read`,
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(204);

      const row = dbModule.sqliteGet<{ status: string }>(
        'SELECT status FROM notifications WHERE id = ? AND user_id = ? LIMIT 1',
        [LONG_NOTIFICATION_ID, USER_ID],
      );
      expect(row?.status).toBe('read');
    } finally {
      await app.close();
    }
  });

  it('returns 204 even when the id does not exist (idempotent no-op)', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: `/notifications/${LONG_NOTIFICATION_ID}/read`,
        headers: { authorization: bearer(app) },
      });
      expect(response.statusCode).toBe(204);
    } finally {
      await app.close();
    }
  });
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('GET /notifications', () => {
  it('view=pending 只返回 actionable 待办，结果播报走 browserBroadcasts', async () => {
    const app = await buildApp();
    try {
      seedNotification('q-1');
      seedInformational('t-1');

      const response = await app.inject({
        method: 'GET',
        url: '/notifications?view=pending',
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as {
        browserBroadcasts: Array<{ id: string; kind: string }>;
        notifications: Array<{ id: string; kind: string }>;
        pendingActionableCount: number;
      };
      // rows 与 pendingActionableCount 口径一致：结果播报不占铃铛位置。
      expect(body.notifications.map((item) => item.id)).toEqual(['q-1']);
      expect(body.pendingActionableCount).toBe(1);
      expect(body.browserBroadcasts.map((item) => item.id)).toEqual(['t-1']);
    } finally {
      await app.close();
    }
  });

  it('view=all 同时返回待办与结果播报，且不再附带 browserBroadcasts', async () => {
    const app = await buildApp();
    try {
      seedNotification('q-1');
      seedInformational('t-1');

      const response = await app.inject({
        method: 'GET',
        url: '/notifications?view=all',
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as {
        browserBroadcasts: Array<{ id: string }>;
        notifications: Array<{ id: string }>;
      };
      expect(body.notifications.map((item) => item.id).sort()).toEqual(['q-1', 't-1']);
      expect(body.browserBroadcasts).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('view=archived 只回溯已归档条目', async () => {
    const app = await buildApp();
    try {
      seedNotification('q-2');
      seedNotification('q-3');
      dbModule.sqliteRun(
        `UPDATE notifications SET status = 'archived', archived_at = datetime('now') WHERE id = 'q-3'`,
        [],
      );

      const response = await app.inject({
        method: 'GET',
        url: '/notifications?view=archived',
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { notifications: Array<{ id: string }> };
      expect(body.notifications.map((item) => item.id)).toEqual(['q-3']);
    } finally {
      await app.close();
    }
  });

  it('拒绝未知 view 取值', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/notifications?view=bogus',
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
});

describe('POST /notifications/:notificationId/archive', () => {
  it('归档后从待处理视图消失、并进入归档视图', async () => {
    const app = await buildApp();
    try {
      seedNotification(LONG_NOTIFICATION_ID);

      const archived = await app.inject({
        method: 'POST',
        url: `/notifications/${LONG_NOTIFICATION_ID}/archive`,
        headers: { authorization: bearer(app) },
      });
      expect(archived.statusCode).toBe(204);
      expect(statusOf(LONG_NOTIFICATION_ID)).toBe('archived');

      const pending = await app.inject({
        method: 'GET',
        url: '/notifications?view=pending',
        headers: { authorization: bearer(app) },
      });
      const pendingBody = pending.json() as {
        notifications: Array<{ id: string }>;
        pendingActionableCount: number;
      };
      expect(pendingBody.notifications).toHaveLength(0);
      expect(pendingBody.pendingActionableCount).toBe(0);
    } finally {
      await app.close();
    }
  });

  it('id 不存在时也是 204（幂等）', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: `/notifications/${LONG_NOTIFICATION_ID}/archive`,
        headers: { authorization: bearer(app) },
      });
      expect(response.statusCode).toBe(204);
    } finally {
      await app.close();
    }
  });

  it('不能归档其它用户的通知', async () => {
    const app = await buildApp();
    try {
      dbModule.sqliteRun(
        "INSERT OR IGNORE INTO users (id, email, password_hash) VALUES ('u-2', 'u2@example.com', 'x')",
        [],
      );
      dbModule.sqliteRun(
        `INSERT INTO notifications (id, user_id, session_id, event_type, kind, title, body, status, created_at)
         VALUES ('foreign-1', 'u-2', ?, 'question_asked', 'actionable', 't', 'b', 'unread', datetime('now'))`,
        [SESSION_ID],
      );

      const response = await app.inject({
        method: 'POST',
        url: '/notifications/foreign-1/archive',
        headers: { authorization: bearer(app) },
      });
      expect(response.statusCode).toBe(204);
      expect(statusOf('foreign-1')).toBeUndefined();
    } finally {
      await app.close();
    }
  });
});

describe('POST /notifications/archive', () => {
  it('按 sessionId 批量归档', async () => {
    const app = await buildApp();
    try {
      seedNotification('s-1');
      seedInformational('s-2');

      const response = await app.inject({
        method: 'POST',
        url: '/notifications/archive',
        headers: { authorization: bearer(app), 'content-type': 'application/json' },
        payload: { sessionId: SESSION_ID },
      });

      expect(response.statusCode).toBe(204);
      expect(statusOf('s-1')).toBe('archived');
      expect(statusOf('s-2')).toBe('archived');
    } finally {
      await app.close();
    }
  });

  it('空 body 表示归档当前用户全部通知', async () => {
    const app = await buildApp();
    try {
      seedNotification('a-1');

      const response = await app.inject({
        method: 'POST',
        url: '/notifications/archive',
        headers: { authorization: bearer(app), 'content-type': 'application/json' },
        payload: {},
      });

      expect(response.statusCode).toBe(204);
      expect(statusOf('a-1')).toBe('archived');
    } finally {
      await app.close();
    }
  });

  it('拒绝空 sessionId 字符串', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/notifications/archive',
        headers: { authorization: bearer(app), 'content-type': 'application/json' },
        payload: { sessionId: '' },
      });

      expect(response.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
});
