import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthModule from '../../infra/auth.js';
import type * as ChannelsRouterModule from '../../channels/router.js';
import type * as DbModule from '../../infra/db.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

const USER_ID = 'u-weixin-login';

let authPlugin: typeof AuthModule.default;
let channelRoutes: typeof ChannelsRouterModule.channelRoutes;
let dbModule: typeof DbModule;
let requestWorkflowPlugin: typeof RequestWorkflowModule.default;

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(requestWorkflowPlugin);
  await app.register(authPlugin);
  await app.register(channelRoutes);
  await app.ready();
  return app;
}

function seedUser(): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    `${USER_ID}@example.com`,
  ]);
}

function bearer(app: FastifyInstance): string {
  return `Bearer ${app.jwt.sign({ sub: USER_ID, email: `${USER_ID}@example.com` })}`;
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.migrate();
  const auth = await import('../../infra/auth.js');
  authPlugin = auth.default;
  const requestWorkflow = await import('../../runtime/request-workflow.js');
  requestWorkflowPlugin = requestWorkflow.default;
  const channelsRouter = await import('../../channels/router.js');
  channelRoutes = channelsRouter.channelRoutes;
});

beforeEach(() => {
  vi.unstubAllGlobals();
  dbModule.sqliteRun('DELETE FROM users', []);
  seedUser();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('Weixin login routes', () => {
  it('拒绝未认证的二维码登录启动请求', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/channels/weixin/login/start',
        payload: { baseUrl: 'https://weixin.example' },
      });

      expect(response.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('启动并等待微信公众平台 QR 登录，返回 token/accountId 凭证', async () => {
    const fetchMock = vi.fn((url: string, _init?: RequestInit) => {
      if (url.includes('/get_bot_qrcode')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              qrcode: 'qr-ticket-1',
              qrcode_img_content: 'data:image/png;base64,QR',
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        );
      }
      if (url.includes('/get_qrcode_status')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              status: 'confirmed',
              bot_token: 'bot-token-1',
              ilink_bot_id: 'account-1',
              baseurl: 'https://weixin.example',
              ilink_user_id: 'wx-user-1',
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        );
      }
      return Promise.reject(new Error(`unexpected url: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildApp();
    try {
      const startResponse = await app.inject({
        method: 'POST',
        url: '/channels/weixin/login/start',
        headers: { authorization: bearer(app) },
        payload: {
          accountId: 'account-1',
          baseUrl: 'https://weixin.example',
          routeTag: 'route-a',
          force: true,
        },
      });
      expect(startResponse.statusCode).toBe(200);
      expect(startResponse.json()).toMatchObject({
        sessionKey: 'account-1',
        qrCodeUrl: 'data:image/png;base64,QR',
      });

      const waitResponse = await app.inject({
        method: 'POST',
        url: '/channels/weixin/login/wait',
        headers: { authorization: bearer(app) },
        payload: {
          sessionKey: 'account-1',
          baseUrl: 'https://weixin.example',
          routeTag: 'route-a',
          timeoutMs: 1_000,
        },
      });

      expect(waitResponse.statusCode).toBe(200);
      expect(waitResponse.json()).toMatchObject({
        connected: true,
        token: 'bot-token-1',
        accountId: 'account-1',
        baseUrl: 'https://weixin.example',
        userId: 'wx-user-1',
      });
      expect(fetchMock.mock.calls[0]?.[0]).toBe(
        'https://weixin.example/ilink/bot/get_bot_qrcode?bot_type=3',
      );
      expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ SKRouteTag: 'route-a' });
      expect(fetchMock.mock.calls[1]?.[0]).toBe(
        'https://weixin.example/ilink/bot/get_qrcode_status?qrcode=qr-ticket-1',
      );
    } finally {
      await app.close();
    }
  });
});
