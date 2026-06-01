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
    `INSERT INTO notifications (id, user_id, session_id, event_type, title, body, status, created_at)
     VALUES (?, ?, ?, 'question_asked', '等待回答', 'body', 'unread', datetime('now'))`,
    [id, USER_ID, SESSION_ID],
  );
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
