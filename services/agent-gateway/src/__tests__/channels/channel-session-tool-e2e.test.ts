import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthModule from '../../infra/auth.js';
import type * as ChannelsRouterModule from '../../channels/router.js';
import type * as DbModule from '../../infra/db.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';
import type * as StreamRuntimeModule from '../../routes/stream-runtime.js';
import { channelManager } from '../../channels/manager.js';
import type { ChannelInstance } from '../../channels/types.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';
process.env['AI_API_BASE_URL'] = '';
process.env['AI_API_KEY'] = '';
process.env['AI_DEFAULT_MODEL'] = '';

const USER_ID = 'u-channel-session-tools';
const TELEGRAM_CHANNEL_ID = 'channel-tool-telegram';

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

let authPlugin: typeof AuthModule.default;
let channelRoutes: typeof ChannelsRouterModule.channelRoutes;
let dbModule: typeof DbModule;
let requestWorkflowPlugin: typeof RequestWorkflowModule.default;

vi.mock('../../routes/stream-runtime.js', async (importOriginal) => {
  const actual = await importOriginal<typeof StreamRuntimeModule>();
  return {
    ...actual,
    runSessionInBackground: vi.fn(),
  };
});

function makeChannel(overrides?: Partial<ChannelInstance>): ChannelInstance {
  const baseConfig = { token: 'redacted', inboundSecret: 'relay-secret' };
  const baseChannel: ChannelInstance = {
    id: TELEGRAM_CHANNEL_ID,
    type: 'telegram',
    name: 'Telegram Tool Channel',
    enabled: true,
    config: baseConfig,
    features: { autoReply: true, streamingReply: false, autoStart: false },
    ownerUserId: USER_ID,
    createdAt: 1_788_000_000_000,
    updatedAt: 1_788_000_000_000,
  };
  const nextChannel: ChannelInstance = { ...baseChannel, ...(overrides ?? {}) };
  nextChannel.config = {
    ...baseConfig,
    ...(overrides?.config ?? {}),
  };
  return nextChannel;
}

function seedUser(): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    `${USER_ID}@example.com`,
  ]);
}

function seedChannel(): void {
  dbModule.sqliteRun(
    `INSERT INTO user_settings (user_id, key, value)
     VALUES (?, 'channels', ?)`,
    [USER_ID, JSON.stringify([makeChannel()])],
  );
}

function overwriteChannel(channel: ChannelInstance): void {
  dbModule.sqliteRun(`UPDATE user_settings SET value = ? WHERE user_id = ? AND key = 'channels'`, [
    JSON.stringify([channel]),
    USER_ID,
  ]);
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(requestWorkflowPlugin);
  await app.register(authPlugin);
  await app.register(channelRoutes);
  await app.ready();
  return app;
}

function bearer(app: FastifyInstance): string {
  return `Bearer ${app.jwt.sign({ sub: USER_ID, email: `${USER_ID}@example.com` })}`;
}

function createDeferred<T>(): Deferred<T> {
  let resolveValue: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolveValue = resolve;
  });
  return { promise, resolve: resolveValue };
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
  dbModule.sqliteRun('DELETE FROM user_settings', []);
  dbModule.sqliteRun('DELETE FROM part_v2', []);
  dbModule.sqliteRun('DELETE FROM message_v2', []);
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  seedUser();
  seedChannel();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  await channelManager.stopAll();
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('channel session tool e2e', () => {
  it('Given an inbound channel session When the agent uses PluginReplyMessage Then it replies through the active service with the platform reference', async () => {
    const fetchMock = vi.fn((url: string, _init?: RequestInit) => {
      if (url.includes('/getUpdates')) {
        return Promise.resolve(new Response(JSON.stringify({ ok: true, result: [] })));
      }
      if (url.includes('/sendMessage')) {
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true, result: { message_id: 77 } })),
        );
      }
      return Promise.resolve(new Response(JSON.stringify({ ok: true })));
    });
    vi.stubGlobal('fetch', fetchMock);
    const { createDefaultSandbox } = await import('../../tools/tool-sandbox.js');
    const streamRuntime = await import('../../routes/stream-runtime.js');
    vi.mocked(streamRuntime.runSessionInBackground).mockImplementation(
      async ({ sessionId, userId }) => {
        const result = await createDefaultSandbox().execute(
          {
            toolCallId: 'call-channel-e2e-reply',
            toolName: 'PluginReplyMessage',
            rawInput: { message_id: 'message-42', content: '收到，正在处理' },
          },
          new AbortController().signal,
          sessionId,
          {
            clientRequestId: 'req-channel-e2e-reply',
            nextRound: 1,
            requestData: { clientRequestId: 'req-channel-e2e-reply' },
          },
        );
        expect(userId).toBe(USER_ID);
        expect(result.isError).toBe(false);
        return { statusCode: 200, stopReason: 'end_turn' };
      },
    );
    const app = await buildApp();
    try {
      const startResponse = await app.inject({
        method: 'POST',
        url: `/channels/${TELEGRAM_CHANNEL_ID}/start`,
        headers: { authorization: bearer(app) },
      });
      expect(startResponse.statusCode).toBe(200);

      const response = await app.inject({
        method: 'POST',
        url: `/channels/${TELEGRAM_CHANNEL_ID}/inbound`,
        headers: { 'x-openawork-channel-secret': 'relay-secret' },
        payload: {
          chatId: 'chat-1',
          senderId: 'sender-1',
          senderName: 'Sender',
          content: '请回复我',
          messageId: 'message-42',
        },
      });

      expect(response.statusCode).toBe(202);
      await vi.waitFor(() => {
        expect(streamRuntime.runSessionInBackground).toHaveBeenCalledOnce();
        expect(fetchMock).toHaveBeenCalledWith(
          'https://api.telegram.org/botredacted/sendMessage',
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({
              chat_id: 'chat-1',
              text: '收到，正在处理',
              reply_to_message_id: 'message-42',
            }),
          }),
        );
      });
    } finally {
      await app.close();
    }
  });

  it('Given configured member ACL When the sender is not listed Then channel tools are disabled for that session', async () => {
    overwriteChannel(
      makeChannel({
        config: {
          memberAclJson: JSON.stringify([
            {
              platformUserId: 'sender-allowed',
              toolAllowlist: ['PluginReplyMessage'],
            },
          ]),
        },
      }),
    );

    const fetchMock = vi.fn((url: string, _init?: RequestInit) => {
      if (url.includes('/getUpdates') || url.includes('/sendMessage')) {
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true, result: { message_id: 77 } })),
        );
      }
      return Promise.resolve(new Response(JSON.stringify({ ok: true })));
    });
    vi.stubGlobal('fetch', fetchMock);
    const { createDefaultSandbox } = await import('../../tools/tool-sandbox.js');
    const streamRuntime = await import('../../routes/stream-runtime.js');
    vi.mocked(streamRuntime.runSessionInBackground).mockImplementation(async ({ sessionId }) => {
      const result = await createDefaultSandbox().execute(
        {
          toolCallId: 'call-channel-e2e-member-acl',
          toolName: 'PluginReplyMessage',
          rawInput: { message_id: 'message-42', content: '不应该发出' },
        },
        new AbortController().signal,
        sessionId,
        {
          clientRequestId: 'req-channel-e2e-member-acl',
          nextRound: 1,
          requestData: { clientRequestId: 'req-channel-e2e-member-acl' },
        },
      );
      expect(result.isError).toBe(true);
      expect(String(result.output)).toContain('not enabled for this session');
      return { statusCode: 200, stopReason: 'end_turn' };
    });

    const app = await buildApp();
    try {
      const startResponse = await app.inject({
        method: 'POST',
        url: `/channels/${TELEGRAM_CHANNEL_ID}/start`,
        headers: { authorization: bearer(app) },
      });
      expect(startResponse.statusCode).toBe(200);

      const response = await app.inject({
        method: 'POST',
        url: `/channels/${TELEGRAM_CHANNEL_ID}/inbound`,
        headers: { 'x-openawork-channel-secret': 'relay-secret' },
        payload: {
          chatId: 'chat-1',
          senderId: 'sender-blocked',
          senderName: 'Blocked Sender',
          content: '试图调用回复工具',
          messageId: 'message-42',
        },
      });

      expect(response.statusCode).toBe(202);
      await vi.waitFor(() => {
        expect(streamRuntime.runSessionInBackground).toHaveBeenCalledOnce();
      });
    } finally {
      await app.close();
    }
  });

  it('Given the latest channel reply When the next run reports a semantic error Then it sends the failure notice instead of repeating that reply', async () => {
    const fetchMock = vi.fn((url: string, _init?: RequestInit) => {
      if (url.includes('/getUpdates')) {
        return Promise.resolve(new Response(JSON.stringify({ ok: true, result: [] })));
      }
      if (url.includes('/sendMessage')) {
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true, result: { message_id: 77 } })),
        );
      }
      return Promise.resolve(new Response(JSON.stringify({ ok: true })));
    });
    vi.stubGlobal('fetch', fetchMock);
    const streamRuntime = await import('../../routes/stream-runtime.js');
    const messageAdapter = await import('../../message/message-v2-adapter.js');
    vi.mocked(streamRuntime.runSessionInBackground).mockImplementation(
      async ({ requestData, sessionId, userId }) => {
        if (requestData['message'] === '上一条请求') {
          messageAdapter.appendSessionMessageV2({
            sessionId,
            userId,
            role: 'assistant',
            content: [{ type: 'text', text: '最新一条回复' }],
            clientRequestId:
              typeof requestData['clientRequestId'] === 'string'
                ? requestData['clientRequestId']
                : undefined,
          });
          return { statusCode: 200, stopReason: 'end_turn' };
        }

        return {
          statusCode: 200,
          stopReason: 'error',
          errorSummary: '模拟网络通讯失败',
        };
      },
    );
    const app = await buildApp();
    try {
      const startResponse = await app.inject({
        method: 'POST',
        url: `/channels/${TELEGRAM_CHANNEL_ID}/start`,
        headers: { authorization: bearer(app) },
      });
      expect(startResponse.statusCode).toBe(200);

      const firstResponse = await app.inject({
        method: 'POST',
        url: `/channels/${TELEGRAM_CHANNEL_ID}/inbound`,
        headers: { 'x-openawork-channel-secret': 'relay-secret' },
        payload: {
          chatId: 'chat-1',
          senderId: 'sender-1',
          senderName: 'Sender',
          content: '上一条请求',
          messageId: 'message-1',
        },
      });
      expect(firstResponse.statusCode).toBe(202);
      await vi.waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          'https://api.telegram.org/botredacted/sendMessage',
          expect.objectContaining({
            body: JSON.stringify({
              chat_id: 'chat-1',
              text: '最新一条回复',
            }),
          }),
        );
      });

      const failedResponse = await app.inject({
        method: 'POST',
        url: `/channels/${TELEGRAM_CHANNEL_ID}/inbound`,
        headers: { 'x-openawork-channel-secret': 'relay-secret' },
        payload: {
          chatId: 'chat-1',
          senderId: 'sender-1',
          senderName: 'Sender',
          content: '当前请求',
          messageId: 'message-2',
        },
      });
      expect(failedResponse.statusCode).toBe(202);
      await vi.waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          'https://api.telegram.org/botredacted/sendMessage',
          expect.objectContaining({
            body: expect.stringContaining('模拟网络通讯失败'),
          }),
        );
      });

      const sentBodies = fetchMock.mock.calls
        .filter(([url]) => url === 'https://api.telegram.org/botredacted/sendMessage')
        .map(([, init]) => init?.body);
      expect(sentBodies).toHaveLength(2);
      expect(sentBodies.at(-1)).toEqual(expect.stringContaining('模拟网络通讯失败'));
      expect(sentBodies.at(-1)).not.toEqual(expect.stringContaining('最新一条回复'));
    } finally {
      await app.close();
    }
  });

  it('Given two inbound messages for the same channel chat When auto-reply runs Then it reuses one session and preserves multi-turn history', async () => {
    const fetchMock = vi.fn((url: string, _init?: RequestInit) => {
      if (url.includes('/getUpdates')) {
        return Promise.resolve(new Response(JSON.stringify({ ok: true, result: [] })));
      }
      if (url.includes('/sendMessage')) {
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true, result: { message_id: 77 } })),
        );
      }
      return Promise.resolve(new Response(JSON.stringify({ ok: true })));
    });
    vi.stubGlobal('fetch', fetchMock);
    const streamRuntime = await import('../../routes/stream-runtime.js');
    const messageAdapter = await import('../../message/message-v2-adapter.js');
    const sessionIds: string[] = [];
    const firstRun = createDeferred<void>();
    vi.mocked(streamRuntime.runSessionInBackground).mockImplementation(
      async ({ requestData, sessionId, userId }) => {
        const message = typeof requestData['message'] === 'string' ? requestData['message'] : '';
        sessionIds.push(sessionId);
        messageAdapter.appendSessionMessageV2({
          sessionId,
          userId,
          role: 'user',
          content: [{ type: 'text', text: message }],
          clientRequestId:
            typeof requestData['clientRequestId'] === 'string'
              ? requestData['clientRequestId']
              : undefined,
        });
        if (message === '第一条') {
          await firstRun.promise;
        }
        messageAdapter.appendSessionMessageV2({
          sessionId,
          userId,
          role: 'assistant',
          content: [{ type: 'text', text: `reply:${message}` }],
          clientRequestId:
            typeof requestData['clientRequestId'] === 'string'
              ? requestData['clientRequestId']
              : undefined,
        });
        return { statusCode: 200, stopReason: 'end_turn' };
      },
    );
    const app = await buildApp();
    try {
      const startResponse = await app.inject({
        method: 'POST',
        url: `/channels/${TELEGRAM_CHANNEL_ID}/start`,
        headers: { authorization: bearer(app) },
      });
      expect(startResponse.statusCode).toBe(200);

      const firstRequest = app.inject({
        method: 'POST',
        url: `/channels/${TELEGRAM_CHANNEL_ID}/inbound`,
        headers: { 'x-openawork-channel-secret': 'relay-secret' },
        payload: {
          chatId: 'chat-1',
          senderId: 'sender-1',
          senderName: 'Sender',
          content: '第一条',
          messageId: 'message-1',
        },
      });

      const firstResponse = await firstRequest;
      expect(firstResponse.statusCode).toBe(202);
      await vi.waitFor(() => {
        expect(streamRuntime.runSessionInBackground).toHaveBeenCalledTimes(1);
      });

      const secondRequest = app.inject({
        method: 'POST',
        url: `/channels/${TELEGRAM_CHANNEL_ID}/inbound`,
        headers: { 'x-openawork-channel-secret': 'relay-secret' },
        payload: {
          chatId: 'chat-1',
          senderId: 'sender-1',
          senderName: 'Sender',
          content: '第二条',
          messageId: 'message-2',
        },
      });

      const secondResponse = await secondRequest;
      expect(secondResponse.statusCode).toBe(202);
      expect(streamRuntime.runSessionInBackground).toHaveBeenCalledTimes(1);

      firstRun.resolve(undefined);
      await vi.waitFor(() => {
        expect(streamRuntime.runSessionInBackground).toHaveBeenCalledTimes(2);
      });

      expect(new Set(sessionIds).size).toBe(1);
      const sessionId = sessionIds[0];
      expect(sessionId).toBeDefined();
      const messages = messageAdapter.listSessionMessagesV2({
        sessionId: sessionId ?? '',
        userId: USER_ID,
      });
      expect(messages.map((message) => message.role)).toEqual([
        'user',
        'assistant',
        'user',
        'assistant',
      ]);
      expect(messages.map((message) => message.content[0])).toEqual([
        { type: 'text', text: '第一条' },
        { type: 'text', text: 'reply:第一条' },
        { type: 'text', text: '第二条' },
        { type: 'text', text: 'reply:第二条' },
      ]);
    } finally {
      await app.close();
    }
  });
});
