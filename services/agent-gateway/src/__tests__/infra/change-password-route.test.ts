/**
 * `POST /auth/change-password` —— 浏览器（Docker 部署的网关自带前端）唯一可用的
 * 改密路径。桌面端的 `/auth/admin-set-password` 需要只有 Tauri 父进程持有的
 * `X-OpenAWork-Desktop-Auth` 令牌，在 Web 端恒 403，故自助改密只能走 JWT + 旧密码。
 *
 * 覆盖：未登录 401 / 旧密码错误 400 / 参数校验 400 / 成功改密后旧 refresh token
 * 失效且新密码立即可登录。
 */

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as AuthModule from '../../infra/auth.js';
import type * as DbModule from '../../infra/db.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';
import { hashPassword } from '../../infra/password-hash.js';

/** 独立 email，避免与其它测试文件种入的 admin 行撞唯一约束 / 限流 key。 */
const TEST_EMAIL = 'change-password-spec@openAwork.local';
const TEST_USER_ID = 'change-password-spec-user';
const ORIGINAL_PASSWORD = 'original-pass-1234';
const NEW_PASSWORD = 'brand-new-pass-5678';

let authPlugin: typeof AuthModule.default;
let dbModule: typeof DbModule;
let requestWorkflowPlugin: typeof RequestWorkflowModule.default;

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(requestWorkflowPlugin);
  await app.register(authPlugin);
  await app.ready();
  return app;
}

function seedUser(): void {
  dbModule.sqliteRun(
    `INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET email = excluded.email, password_hash = excluded.password_hash`,
    [TEST_USER_ID, TEST_EMAIL, hashPassword(ORIGINAL_PASSWORD)],
  );
  dbModule.sqliteRun('DELETE FROM refresh_tokens WHERE user_id = ?', [TEST_USER_ID]);
}

async function login(
  app: FastifyInstance,
  password: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const response = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: TEST_EMAIL, password },
  });
  expect(response.statusCode).toBe(200);
  return response.json() as { accessToken: string; refreshToken: string };
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  authPlugin = (await import('../../infra/auth.js')).default;
  requestWorkflowPlugin = (await import('../../runtime/request-workflow.js')).default;
});

afterAll(async () => {
  await dbModule.closeDb();
});

beforeEach(() => {
  seedUser();
});

describe('POST /auth/change-password', () => {
  it('未携带令牌时返回 401', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/change-password',
        payload: { currentPassword: ORIGINAL_PASSWORD, newPassword: NEW_PASSWORD },
      });
      expect(response.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('当前密码不正确时返回 400 且不修改密码', async () => {
    const app = await buildApp();
    try {
      const { accessToken } = await login(app, ORIGINAL_PASSWORD);
      const response = await app.inject({
        method: 'POST',
        url: '/auth/change-password',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { currentPassword: 'wrong-password-1', newPassword: NEW_PASSWORD },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: '当前密码不正确。' });
    } finally {
      await app.close();
    }
  });

  it('新密码过短时返回 400', async () => {
    const app = await buildApp();
    try {
      const { accessToken } = await login(app, ORIGINAL_PASSWORD);
      const response = await app.inject({
        method: 'POST',
        url: '/auth/change-password',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { currentPassword: ORIGINAL_PASSWORD, newPassword: 'short' },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: '请求参数无效。' });
    } finally {
      await app.close();
    }
  });

  it('改密成功：返回新令牌对，旧 refresh token 失效，新密码可登录', async () => {
    const app = await buildApp();
    try {
      const { accessToken, refreshToken } = await login(app, ORIGINAL_PASSWORD);

      const response = await app.inject({
        method: 'POST',
        url: '/auth/change-password',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { currentPassword: ORIGINAL_PASSWORD, newPassword: NEW_PASSWORD },
      });
      expect(response.statusCode).toBe(200);
      const tokens = response.json() as {
        accessToken?: string;
        refreshToken?: string;
        expiresIn?: string;
      };
      expect(tokens.accessToken).toEqual(expect.any(String));
      expect(tokens.refreshToken).toEqual(expect.any(String));
      expect(tokens.expiresIn).toBe('15m');

      // 改密作废了改密前的全部 refresh token（其它端必须重新登录）。
      const staleRefresh = await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        payload: { refreshToken },
      });
      expect(staleRefresh.statusCode).toBe(401);

      // 补发的 refresh token 可以正常换新令牌，改密者自己不被登出。
      const freshRefresh = await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        payload: { refreshToken: tokens.refreshToken },
      });
      expect(freshRefresh.statusCode).toBe(200);

      // 新密码可登录，旧密码不再有效。
      await login(app, NEW_PASSWORD);
      const withOldPassword = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: TEST_EMAIL, password: ORIGINAL_PASSWORD },
      });
      expect(withOldPassword.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });
});
