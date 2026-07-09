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

function makeChannel(): ChannelInstance {
  return {
    id: TELEGRAM_CHANNEL_ID,
    type: 'telegram',
    name: 'Telegram Tool Channel',
    enabled: true,
    config: { token: 'redacted', inboundSecret: 'relay-secret' },
    features: { autoReply: true, streamingReply: false, autoStart: false },
    ownerUserId: USER_ID,
    createdAt: 1_788_000_000_000,
    updatedAt: 1_788_000_000_000,
  };
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
});
