import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as AuthModule from '../../infra/auth.js';
import type * as ChannelsRouterModule from '../../channels/router.js';
import type * as DbModule from '../../infra/db.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';
import type { ChannelInstance } from '../../channels/types.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';
process.env['AI_API_BASE_URL'] = '';
process.env['AI_API_KEY'] = '';
process.env['AI_DEFAULT_MODEL'] = '';

const USER_ID = 'u-channel-inbound';
const TELEGRAM_CHANNEL_ID = 'channel-inbound-telegram';
const WHATSAPP_CHANNEL_ID = 'channel-inbound-whatsapp';

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

function makeChannel(input: {
  id: string;
  type: ChannelInstance['type'];
  config: Record<string, string>;
}): ChannelInstance {
  return {
    id: input.id,
    type: input.type,
    name: input.id,
    enabled: true,
    config: input.config,
    features: { autoReply: true, streamingReply: false, autoStart: false },
    ownerUserId: USER_ID,
    createdAt: 1_788_000_000_000,
    updatedAt: 1_788_000_000_000,
  };
}

function seedChannels(): void {
  const channels: ChannelInstance[] = [
    makeChannel({
      id: TELEGRAM_CHANNEL_ID,
      type: 'telegram',
      config: { token: 'redacted', inboundSecret: 'relay-secret' },
    }),
    makeChannel({
      id: WHATSAPP_CHANNEL_ID,
      type: 'whatsapp',
      config: {
        phoneNumberId: 'phone-number-id',
        accessToken: 'redacted',
        verifyToken: 'verify-secret',
      },
    }),
  ];
  dbModule.sqliteRun(
    `INSERT INTO user_settings (user_id, key, value)
     VALUES (?, 'channels', ?)`,
    [USER_ID, JSON.stringify(channels)],
  );
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
  dbModule.sqliteRun('DELETE FROM user_settings', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  seedUser();
  seedChannels();
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('channel inbound route', () => {
  it('拒绝缺少共享密钥的入站消息', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: `/channels/${TELEGRAM_CHANNEL_ID}/inbound`,
        payload: {
          chatId: 'chat-1',
          content: 'hello',
          messageId: 'msg-1',
        },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ error: 'Invalid channel inbound secret' });
    } finally {
      await app.close();
    }
  });

  it('使用共享密钥接收入站消息并复用注册 parser', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: `/channels/${TELEGRAM_CHANNEL_ID}/inbound`,
        headers: { 'x-openawork-channel-secret': 'relay-secret' },
        payload: {
          chatId: 'chat-1',
          content: 'hello from relay',
          messageId: 'msg-1',
        },
      });

      expect(response.statusCode).toBe(202);
      expect(response.json()).toEqual({ accepted: true });
    } finally {
      await app.close();
    }
  });

  it('支持 WhatsApp / Meta webhook challenge 校验', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url:
          `/channels/${WHATSAPP_CHANNEL_ID}/inbound` +
          '?hub.mode=subscribe&hub.verify_token=verify-secret&hub.challenge=challenge-ok',
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).toBe('challenge-ok');
    } finally {
      await app.close();
    }
  });
});
