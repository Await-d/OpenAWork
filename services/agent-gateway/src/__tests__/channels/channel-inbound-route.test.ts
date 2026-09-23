import { createPrivateKey, sign } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthModule from '../../infra/auth.js';
import type * as ChannelInboundRouteModule from '../../channels/channel-inbound-route.js';
import type * as ChannelsRouterModule from '../../channels/router.js';
import type * as DbModule from '../../infra/db.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';
import { channelManager } from '../../channels/manager.js';
import type {
  ChannelImageAttachment,
  ChannelInstance,
  ChannelMessage,
} from '../../channels/types.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';
process.env['AI_API_BASE_URL'] = '';
process.env['AI_API_KEY'] = '';
process.env['AI_DEFAULT_MODEL'] = '';

const USER_ID = 'u-channel-inbound';
const TELEGRAM_CHANNEL_ID = 'channel-inbound-telegram';
const WHATSAPP_CHANNEL_ID = 'channel-inbound-whatsapp';
const DINGTALK_CHANNEL_ID = 'channel-inbound-dingtalk';
const QQ_CHANNEL_ID = 'channel-inbound-qq';

let authPlugin: typeof AuthModule.default;
let channelRoutes: typeof ChannelsRouterModule.channelRoutes;
let registerChannelInboundRoutes: typeof ChannelInboundRouteModule.registerChannelInboundRoutes;
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
    makeChannel({
      id: DINGTALK_CHANNEL_ID,
      type: 'dingtalk',
      config: {
        webhookUrl: 'https://dingtalk-webhook.example/send',
        inboundSecret: 'dingtalk-inbound-secret',
      },
    }),
    makeChannel({
      id: QQ_CHANNEL_ID,
      type: 'qq',
      config: {
        appId: 'qq-app-id',
        clientSecret: 'qq-client-secret',
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
  const inboundRoute = await import('../../channels/channel-inbound-route.js');
  registerChannelInboundRoutes = inboundRoute.registerChannelInboundRoutes;
});

beforeEach(() => {
  vi.unstubAllGlobals();
  dbModule.sqliteRun('DELETE FROM user_settings', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  seedUser();
  seedChannels();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await channelManager.stopAll();
});

afterAll(async () => {
  await dbModule.closeDb();
});

function bearer(app: FastifyInstance): string {
  return `Bearer ${app.jwt.sign({ sub: USER_ID, email: `${USER_ID}@example.com` })}`;
}

function signQQCallback(body: string, timestamp: string): string {
  const seed = Buffer.alloc(32);
  const secret = Buffer.from('qq-client-secret');
  for (let offset = 0; offset < seed.length; offset += secret.length) {
    secret.copy(seed, offset, 0, Math.min(secret.length, seed.length - offset));
  }
  const privateKey = createPrivateKey({
    key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]),
    format: 'der',
    type: 'pkcs8',
  });
  return sign(null, Buffer.from(`${timestamp}${body}`), privateKey).toString('hex');
}

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

  it('支持 QQ 官方 webhook 地址验证 op=13', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: `/channels/${QQ_CHANNEL_ID}/inbound`,
        headers: { 'x-bot-appid': 'qq-app-id' },
        payload: {
          op: 13,
          d: {
            plain_token: 'plain-token-1',
            event_ts: '1788000000',
          },
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ plain_token: 'plain-token-1' });
      expect(response.json().signature).toMatch(/^[a-f0-9]{128}$/);
    } finally {
      await app.close();
    }
  });

  it('支持 QQ 官方 webhook 签名事件并返回 HTTP Callback ACK', async () => {
    const app = await buildApp();
    try {
      const body = JSON.stringify({
        op: 0,
        t: 'GROUP_AT_MESSAGE_CREATE',
        d: {
          id: 'qq-msg-1',
          group_openid: 'group-open-id',
          content: '<@123> /help',
          timestamp: '2026-07-08T12:00:00.000Z',
          author: { member_openid: 'member-open-id', username: 'QQ User' },
        },
      });
      const timestamp = '1788000000';
      const response = await app.inject({
        method: 'POST',
        url: `/channels/${QQ_CHANNEL_ID}/inbound`,
        headers: {
          'content-type': 'application/json',
          'x-bot-appid': 'qq-app-id',
          'x-signature-timestamp': timestamp,
          'x-signature-ed25519': signQQCallback(body, timestamp),
        },
        payload: body,
      });

      expect(response.statusCode).toBe(202);
      expect(response.json()).toEqual({ op: 12 });

      const diagnosticsResponse = await app.inject({
        method: 'GET',
        url: `/channels/${QQ_CHANNEL_ID}/diagnostics`,
        headers: { authorization: bearer(app) },
      });
      expect(diagnosticsResponse.statusCode).toBe(200);
      expect(diagnosticsResponse.json()).toMatchObject({
        diagnostics: {
          status: 'stopped',
          running: false,
          lastInboundAccepted: true,
          lastInboundType: 'GROUP_AT_MESSAGE_CREATE',
          lastMessageChatId: 'group:group-open-id',
        },
      });
    } finally {
      await app.close();
    }
  });

  it('拒绝 QQ 官方 webhook 错误签名事件', async () => {
    const app = await buildApp();
    try {
      const body = JSON.stringify({
        op: 0,
        t: 'GROUP_AT_MESSAGE_CREATE',
        d: {
          id: 'qq-msg-1',
          group_openid: 'group-open-id',
          content: '<@123> hello',
          author: { member_openid: 'member-open-id', username: 'QQ User' },
        },
      });
      const response = await app.inject({
        method: 'POST',
        url: `/channels/${QQ_CHANNEL_ID}/inbound`,
        headers: {
          'content-type': 'application/json',
          'x-bot-appid': 'qq-app-id',
          'x-signature-timestamp': '1788000000',
          'x-signature-ed25519': '00'.repeat(64),
        },
        payload: body,
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ error: 'Invalid QQ webhook signature' });
    } finally {
      await app.close();
    }
  });

  it('已启动通道收到入站消息后进入自动回复管线并回发渠道', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(new Response(JSON.stringify({ errcode: 0, errmsg: 'ok' }))),
    );
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildApp();
    try {
      const startResponse = await app.inject({
        method: 'POST',
        url: `/channels/${DINGTALK_CHANNEL_ID}/start`,
        headers: { authorization: bearer(app) },
      });
      expect(startResponse.statusCode).toBe(200);

      const response = await app.inject({
        method: 'POST',
        url: `/channels/${DINGTALK_CHANNEL_ID}/inbound`,
        headers: { 'x-openawork-channel-secret': 'dingtalk-inbound-secret' },
        payload: {
          chatId: 'ding-chat-1',
          senderId: 'ding-user-1',
          senderName: 'Ding User',
          content: '/help',
          messageId: 'ding-msg-1',
        },
      });

      expect(response.statusCode).toBe(202);
      expect(response.json()).toEqual({ accepted: true });
      await vi.waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          'https://dingtalk-webhook.example/send',
          expect.objectContaining({
            method: 'POST',
            body: expect.stringContaining('**快捷指令**'),
          }),
        );
      });
    } finally {
      await app.close();
    }
  });
});

type InboundRouteDeps = Parameters<
  typeof ChannelInboundRouteModule.registerChannelInboundRoutes
>[1];
type InboundEnrichHook = NonNullable<InboundRouteDeps['enrichInboundMessage']>;

const ENRICH_TIMESTAMP = 1_788_000_000_000;
const ENRICH_INBOUND_SECRET = 'relay-secret';

function makeEnrichPayload(input: {
  readonly chatId: string;
  readonly content: string;
  readonly messageId: string;
}): Record<string, unknown> {
  return {
    chatId: input.chatId,
    content: input.content,
    messageId: input.messageId,
    senderId: 'enrich-user-1',
    timestamp: ENRICH_TIMESTAMP,
  };
}

/** 用生产 parser 计算期望值，断言 enrich 的输入就是 parser 输出。 */
function expectParsedInboundMessage(raw: unknown, channel: ChannelInstance): ChannelMessage {
  const parsed = channelManager.parseMessage('telegram', raw, { channel });
  expect(parsed).not.toBeNull();
  if (!parsed) {
    throw new Error('telegram inbound parser returned null');
  }
  return parsed;
}

interface InboundRouteHarness {
  readonly app: FastifyInstance;
  readonly channel: ChannelInstance;
  readonly notifiedMessages: ChannelMessage[];
}

/**
 * 只注册入站通用路由，并显式注入 deps（parser 仍复用生产注册表），
 * 便于观察 enrich → notify 的消息流向。
 */
async function buildInboundRouteApp(options?: {
  readonly enrichInboundMessage?: InboundEnrichHook;
}): Promise<InboundRouteHarness> {
  const channel = makeChannel({
    id: TELEGRAM_CHANNEL_ID,
    type: 'telegram',
    config: { token: 'redacted', inboundSecret: ENRICH_INBOUND_SECRET },
  });
  const notifiedMessages: ChannelMessage[] = [];
  const app = Fastify();
  await registerChannelInboundRoutes(app, {
    resolveChannel: (channelId) => (channelId === channel.id ? channel : null),
    parseMessage: (type, raw, resolvedChannel) =>
      channelManager.parseMessage(type, raw, { channel: resolvedChannel }),
    notifyChannel: (event) => {
      if (event.type === 'message') {
        notifiedMessages.push(event.message);
      }
    },
    enrichInboundMessage: options?.enrichInboundMessage,
  });
  await app.ready();
  return { app, channel, notifiedMessages };
}

function postEnrichInbound(app: FastifyInstance, payload: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: `/channels/${TELEGRAM_CHANNEL_ID}/inbound`,
    headers: { 'x-openawork-channel-secret': ENRICH_INBOUND_SECRET },
    payload,
  });
}

describe('channel inbound route enrich hook', () => {
  it('enrich 成功时 notify 收到带 images 的补全消息', async () => {
    const images: ChannelImageAttachment[] = [
      { base64: 'aW1hZ2UtYnl0ZXM=', mediaType: 'image/jpeg', fileName: 'photo.jpg' },
    ];
    const enrichInputs: Array<{ channel: ChannelInstance; message: ChannelMessage }> = [];
    const harness = await buildInboundRouteApp({
      enrichInboundMessage: async (input) => {
        enrichInputs.push(input);
        return { ...input.message, images };
      },
    });

    try {
      const payload = makeEnrichPayload({
        chatId: 'chat-enrich-1',
        content: '请看图',
        messageId: 'msg-enrich-1',
      });
      const parsedMessage = expectParsedInboundMessage(payload, harness.channel);
      const response = await postEnrichInbound(harness.app, payload);

      expect(response.statusCode).toBe(202);
      expect(response.json()).toEqual({ accepted: true });
      expect(harness.notifiedMessages).toHaveLength(1);
      expect(harness.notifiedMessages[0]).toEqual({ ...parsedMessage, images });
      expect(enrichInputs).toHaveLength(1);
      expect(enrichInputs[0]?.message).toEqual(parsedMessage);
      expect(enrichInputs[0]?.channel).toBe(harness.channel);
    } finally {
      await harness.app.close();
    }
  });

  it('enrich 抛错时 notify 仍收到原始消息且响应 202', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const harness = await buildInboundRouteApp({
      enrichInboundMessage: async () => {
        throw new Error('media download failed');
      },
    });

    try {
      const payload = makeEnrichPayload({
        chatId: 'chat-enrich-2',
        content: '图片下载会失败',
        messageId: 'msg-enrich-2',
      });
      const parsedMessage = expectParsedInboundMessage(payload, harness.channel);
      const response = await postEnrichInbound(harness.app, payload);

      expect(response.statusCode).toBe(202);
      expect(response.json()).toEqual({ accepted: true });
      expect(harness.notifiedMessages).toHaveLength(1);
      expect(harness.notifiedMessages[0]).toEqual(parsedMessage);
      expect(harness.notifiedMessages[0]?.images).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith('[channels] inbound media enrich failed', {
        channelId: TELEGRAM_CHANNEL_ID,
        error: 'media download failed',
      });
    } finally {
      warnSpy.mockRestore();
      await harness.app.close();
    }
  });

  it('未提供 enrich 时行为与现状一致', async () => {
    const harness = await buildInboundRouteApp();

    try {
      const payload = makeEnrichPayload({
        chatId: 'chat-enrich-3',
        content: '无 enrich 钩子',
        messageId: 'msg-enrich-3',
      });
      const parsedMessage = expectParsedInboundMessage(payload, harness.channel);
      const response = await postEnrichInbound(harness.app, payload);

      expect(response.statusCode).toBe(202);
      expect(response.json()).toEqual({ accepted: true });
      expect(harness.notifiedMessages).toEqual([parsedMessage]);
    } finally {
      await harness.app.close();
    }
  });

  it('enrich 收到 parser 输出与解析出的渠道实例，返回原消息时原样投递', async () => {
    const enrichInputs: Array<{ channel: ChannelInstance; message: ChannelMessage }> = [];
    const harness = await buildInboundRouteApp({
      enrichInboundMessage: async (input) => {
        enrichInputs.push(input);
        return input.message;
      },
    });

    try {
      const payload = makeEnrichPayload({
        chatId: 'chat-enrich-4',
        content: '无媒体',
        messageId: 'msg-enrich-4',
      });
      const parsedMessage = expectParsedInboundMessage(payload, harness.channel);
      const response = await postEnrichInbound(harness.app, payload);

      expect(response.statusCode).toBe(202);
      expect(enrichInputs).toHaveLength(1);
      expect(enrichInputs[0]?.channel).toBe(harness.channel);
      expect(enrichInputs[0]?.message).toEqual(parsedMessage);
      expect(harness.notifiedMessages).toHaveLength(1);
      expect(harness.notifiedMessages[0]).toBe(enrichInputs[0]?.message);
    } finally {
      await harness.app.close();
    }
  });
});
