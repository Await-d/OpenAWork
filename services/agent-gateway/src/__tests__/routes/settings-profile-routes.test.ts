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

  it('PUT /settings/providers/model-context 只更新指定模型并支持清除挡位', async () => {
    const app = await buildApp();
    try {
      const authorization = await bearer(app);
      dbModule.sqliteRun(
        `INSERT INTO user_settings (user_id, key, value) VALUES (?, 'providers', ?)`,
        [
          USER_ID,
          JSON.stringify([
            {
              id: 'provider-one',
              type: 'openai',
              name: 'Provider One',
              enabled: true,
              baseUrl: 'https://example.test/v1',
              defaultModels: [
                { id: 'model-one', label: 'Model One', enabled: true, contextWindow: 1_000_000 },
                { id: 'model-two', label: 'Model Two', enabled: true, contextWindow: 400_000 },
              ],
            },
          ]),
        ],
      );

      const updateResponse = await app.inject({
        method: 'PUT',
        url: '/settings/providers/model-context',
        headers: { authorization },
        payload: {
          providerId: 'provider-one',
          modelId: 'model-one',
          contextWindowOverride: 400_000,
        },
      });

      expect(updateResponse.statusCode).toBe(200);
      expect(updateResponse.json()).toEqual({
        ok: true,
        providerId: 'provider-one',
        modelId: 'model-one',
        contextWindowOverride: 400_000,
      });

      const stored = dbModule.sqliteGet<{ value: string }>(
        `SELECT value FROM user_settings WHERE user_id = ? AND key = 'providers'`,
        [USER_ID],
      );
      const providers = JSON.parse(stored?.value ?? '[]') as Array<{
        defaultModels: Array<Record<string, unknown>>;
      }>;
      expect(providers[0]?.defaultModels[0]?.contextWindowOverride).toBe(400_000);
      expect(providers[0]?.defaultModels[1]?.contextWindowOverride).toBeUndefined();

      const clearResponse = await app.inject({
        method: 'PUT',
        url: '/settings/providers/model-context',
        headers: { authorization },
        payload: {
          providerId: 'provider-one',
          modelId: 'model-one',
          contextWindowOverride: null,
        },
      });
      expect(clearResponse.statusCode).toBe(200);
      const cleared = dbModule.sqliteGet<{ value: string }>(
        `SELECT value FROM user_settings WHERE user_id = ? AND key = 'providers'`,
        [USER_ID],
      );
      const clearedProviders = JSON.parse(cleared?.value ?? '[]') as Array<{
        defaultModels: Array<Record<string, unknown>>;
      }>;
      expect(clearedProviders[0]?.defaultModels[0]?.contextWindowOverride).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('PUT /settings/providers/model-context 未认证或模型不存在时拒绝请求', async () => {
    const app = await buildApp();
    try {
      const unauthenticated = await app.inject({
        method: 'PUT',
        url: '/settings/providers/model-context',
        payload: {
          providerId: 'provider-one',
          modelId: 'model-one',
          contextWindowOverride: 400_000,
        },
      });
      expect(unauthenticated.statusCode).toBe(401);

      const authorization = await bearer(app);
      const missingModel = await app.inject({
        method: 'PUT',
        url: '/settings/providers/model-context',
        headers: { authorization },
        payload: {
          providerId: 'provider-one',
          modelId: 'missing-model',
          contextWindowOverride: 400_000,
        },
      });
      expect(missingModel.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('PUT /settings/providers/fast-mode 开启 OpenAI Fast 且保留其它 Provider 配置', async () => {
    const app = await buildApp();
    try {
      const authorization = await bearer(app);
      const providers = [
        {
          id: 'provider-openai',
          type: 'openai',
          name: 'OpenAI',
          enabled: true,
          openaiFastMode: false,
          defaultModels: [{ id: 'gpt-5', label: 'GPT-5', enabled: true }],
        },
        {
          id: 'provider-anthropic',
          type: 'anthropic',
          name: 'Anthropic',
          enabled: true,
          defaultModels: [{ id: 'claude', label: 'Claude', enabled: true }],
        },
      ];
      dbModule.sqliteRun(
        `INSERT INTO user_settings (user_id, key, value) VALUES (?, 'providers', ?)`,
        [USER_ID, JSON.stringify(providers)],
      );

      const response = await app.inject({
        method: 'PUT',
        url: '/settings/providers/fast-mode',
        headers: { authorization },
        payload: { providerId: 'provider-openai', enabled: true },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        ok: true,
        providerId: 'provider-openai',
        openaiFastMode: true,
      });

      const stored = dbModule.sqliteGet<{ value: string }>(
        `SELECT value FROM user_settings WHERE user_id = ? AND key = 'providers'`,
        [USER_ID],
      );
      expect(JSON.parse(stored?.value ?? '[]')).toEqual([
        { ...providers[0], openaiFastMode: true },
        providers[1],
      ]);
    } finally {
      await app.close();
    }
  });

  it('PUT /settings/providers/fast-mode 新用户无需先保存设置页也能开启 Fast', async () => {
    const app = await buildApp();
    try {
      const authorization = await bearer(app);

      const response = await app.inject({
        method: 'PUT',
        url: '/settings/providers/fast-mode',
        headers: { authorization },
        payload: { providerId: 'openai', enabled: true },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        ok: true,
        providerId: 'openai',
        openaiFastMode: true,
      });

      const stored = dbModule.sqliteGet<{ value: string }>(
        `SELECT value FROM user_settings WHERE user_id = ? AND key = 'providers'`,
        [USER_ID],
      );
      const openAiProvider = (
        JSON.parse(stored?.value ?? '[]') as Array<Record<string, unknown>>
      ).find((provider) => provider['id'] === 'openai');
      expect(openAiProvider?.['openaiFastMode']).toBe(true);
    } finally {
      await app.close();
    }
  });

  it('PUT /settings/providers/fast-mode 关闭时删除 Fast 字段并拒绝非 OpenAI 或不存在 Provider', async () => {
    const app = await buildApp();
    try {
      const authorization = await bearer(app);
      dbModule.sqliteRun(
        `INSERT INTO user_settings (user_id, key, value) VALUES (?, 'providers', ?)`,
        [
          USER_ID,
          JSON.stringify([
            { id: 'provider-openai', type: 'openai', openaiFastMode: true },
            { id: 'provider-anthropic', type: 'anthropic' },
          ]),
        ],
      );

      const disabled = await app.inject({
        method: 'PUT',
        url: '/settings/providers/fast-mode',
        headers: { authorization },
        payload: { providerId: 'provider-openai', enabled: false },
      });
      expect(disabled.statusCode).toBe(200);

      const stored = dbModule.sqliteGet<{ value: string }>(
        `SELECT value FROM user_settings WHERE user_id = ? AND key = 'providers'`,
        [USER_ID],
      );
      const savedProviders = JSON.parse(stored?.value ?? '[]') as Array<Record<string, unknown>>;
      expect(savedProviders[0]?.openaiFastMode).toBeUndefined();
      expect(savedProviders[1]).toEqual({ id: 'provider-anthropic', type: 'anthropic' });

      const nonOpenAi = await app.inject({
        method: 'PUT',
        url: '/settings/providers/fast-mode',
        headers: { authorization },
        payload: { providerId: 'provider-anthropic', enabled: true },
      });
      expect(nonOpenAi.statusCode).toBe(400);

      const missing = await app.inject({
        method: 'PUT',
        url: '/settings/providers/fast-mode',
        headers: { authorization },
        payload: { providerId: 'provider-missing', enabled: true },
      });
      expect(missing.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});
