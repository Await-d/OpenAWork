import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as AuthModule from '../../infra/auth.js';
import type * as DbModule from '../../infra/db.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';
import type * as SettingsRoutesModule from '../../routes/settings.js';
import { hashPassword } from '../../infra/password-hash.js';
import { registerErrorHandler } from '../../infra/error-handler.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['JWT_SECRET'] = 'settings-profile-routes-test-secret-1234567890';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

const USER_ID = 'u-settings-profile-routes';
const USER_EMAIL = 'settings-profile@example.com';
const USER_PASSWORD = 'password-123';

let authPlugin: typeof AuthModule.default;
let dbModule: typeof DbModule;
let requestWorkflowPlugin: typeof RequestWorkflowModule.default;
let settingsRoutes: typeof SettingsRoutesModule.settingsRoutes;

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  registerErrorHandler(app);
  await app.register(requestWorkflowPlugin);
  await app.register(authPlugin);
  await app.register(settingsRoutes);
  await app.ready();
  return app;
}

async function bearer(app: FastifyInstance): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: {
      email: USER_EMAIL,
      password: USER_PASSWORD,
    },
  });

  expect(response.statusCode).toBe(200);
  const payload = response.json() as { accessToken: string };
  return `Bearer ${payload.accessToken}`;
}

function seedUser(id: string): void {
  dbModule.sqliteRun('INSERT OR REPLACE INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
    id,
    USER_EMAIL,
    hashPassword(USER_PASSWORD),
  ]);
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  authPlugin = (await import('../../infra/auth.js')).default;
  requestWorkflowPlugin = (await import('../../runtime/request-workflow.js')).default;
  settingsRoutes = (await import('../../routes/settings.js')).settingsRoutes;
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM user_settings', []);
  dbModule.sqliteRun('DELETE FROM refresh_tokens', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  seedUser(USER_ID);
});

afterEach(() => {
  dbModule.sqliteRun('DELETE FROM refresh_tokens', []);
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('settings profile routes', () => {
  it('PUT /settings/profile 保存昵称并由 GET 返回展示名', async () => {
    const app = await buildApp();
    try {
      const authorization = await bearer(app);

      const putResponse = await app.inject({
        method: 'PUT',
        url: '/settings/profile',
        headers: { authorization },
        payload: {
          nickname: '林雾',
        },
      });

      expect(putResponse.statusCode).toBe(200);
      expect(putResponse.json()).toMatchObject({
        email: USER_EMAIL,
        nickname: '林雾',
        displayName: '林雾',
      });

      const getResponse = await app.inject({
        method: 'GET',
        url: '/settings/profile',
        headers: { authorization },
      });

      expect(getResponse.statusCode).toBe(200);
      expect(getResponse.json()).toMatchObject({
        email: USER_EMAIL,
        nickname: '林雾',
        displayName: '林雾',
      });
    } finally {
      await app.close();
    }
  });

  it('PUT /settings/profile 传空字符串时会清空昵称并回退到邮箱展示', async () => {
    const app = await buildApp();
    try {
      const authorization = await bearer(app);

      await app.inject({
        method: 'PUT',
        url: '/settings/profile',
        headers: { authorization },
        payload: {
          nickname: '林雾',
        },
      });

      const clearResponse = await app.inject({
        method: 'PUT',
        url: '/settings/profile',
        headers: { authorization },
        payload: {
          nickname: '   ',
        },
      });

      expect(clearResponse.statusCode).toBe(200);
      expect(clearResponse.json()).toMatchObject({
        email: USER_EMAIL,
        nickname: null,
        displayName: USER_EMAIL,
      });
    } finally {
      await app.close();
    }
  });
});
