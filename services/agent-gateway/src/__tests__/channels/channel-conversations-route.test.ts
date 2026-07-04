import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as AuthModule from '../../infra/auth.js';
import type * as ChannelsRouterModule from '../../channels/router.js';
import type * as DbModule from '../../infra/db.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';
import type { ChannelInstance } from '../../channels/types.js';
import { appendSessionMessageV2 } from '../../message/message-v2-adapter.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';
process.env['AI_API_BASE_URL'] = '';
process.env['AI_API_KEY'] = '';
process.env['AI_DEFAULT_MODEL'] = '';

const USER_ID = 'u-channel-history';
const OTHER_USER_ID = 'u-channel-history-other';
const CHANNEL_ID = 'channel-history-1';
const OTHER_CHANNEL_ID = 'channel-history-2';

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

function bearer(app: FastifyInstance, userId = USER_ID): string {
  return `Bearer ${app.jwt.sign({ sub: userId, email: `${userId}@example.com` })}`;
}

function seedUser(id: string): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    id,
    `${id}@example.com`,
  ]);
}

function makeChannel(id: string): ChannelInstance {
  return {
    id,
    type: 'telegram',
    name: id === CHANNEL_ID ? 'Telegram 工程群' : 'Telegram 其他群',
    enabled: true,
    config: { token: 'redacted' },
    features: { autoReply: true, streamingReply: true, autoStart: false },
    subscriptions: [{ chatId: 'chat-1', name: '工程群', enabled: true }],
    ownerUserId: USER_ID,
    createdAt: 1_788_000_000_000,
    updatedAt: 1_788_000_000_000,
  };
}

function seedChannels(): void {
  dbModule.sqliteRun(
    `INSERT INTO user_settings (user_id, key, value)
     VALUES (?, 'channels', ?)`,
    [USER_ID, JSON.stringify([makeChannel(CHANNEL_ID), makeChannel(OTHER_CHANNEL_ID)])],
  );
}

function seedSession(input: {
  id: string;
  userId: string;
  channelId: string;
  chatId: string;
  updatedAt: string;
}): void {
  dbModule.sqliteRun(
    `INSERT INTO sessions
      (id, user_id, title, messages_json, state_status, metadata_json, created_at, updated_at)
     VALUES (?, ?, ?, '[]', 'idle', ?, ?, ?)`,
    [
      input.id,
      input.userId,
      `channel:${input.channelId}:chat:${input.chatId}`,
      JSON.stringify({
        source: 'channel',
        channel: { id: input.channelId, type: 'telegram', name: 'Telegram 工程群' },
      }),
      input.updatedAt,
      input.updatedAt,
    ],
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
  dbModule.sqliteRun('DELETE FROM message_v2', []);
  dbModule.sqliteRun('DELETE FROM session_messages', []);
  dbModule.sqliteRun('DELETE FROM session_entry', []);
  dbModule.sqliteRun('DELETE FROM user_settings', []);
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  seedUser(USER_ID);
  seedUser(OTHER_USER_ID);
  seedChannels();
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('channel conversations route', () => {
  it('只返回当前用户当前渠道产生的会话摘要', async () => {
    const app = await buildApp();
    try {
      seedSession({
        id: 'session-channel-1',
        userId: USER_ID,
        channelId: CHANNEL_ID,
        chatId: 'chat-1',
        updatedAt: '2026-07-04 10:01:00',
      });
      seedSession({
        id: 'session-other-channel',
        userId: USER_ID,
        channelId: OTHER_CHANNEL_ID,
        chatId: 'chat-2',
        updatedAt: '2026-07-04 10:02:00',
      });
      seedSession({
        id: 'session-other-user',
        userId: OTHER_USER_ID,
        channelId: CHANNEL_ID,
        chatId: 'chat-1',
        updatedAt: '2026-07-04 10:03:00',
      });
      appendSessionMessageV2({
        sessionId: 'session-channel-1',
        userId: USER_ID,
        role: 'user',
        content: [{ type: 'text', text: '请同步今天的渠道任务' }],
      });
      appendSessionMessageV2({
        sessionId: 'session-channel-1',
        userId: USER_ID,
        role: 'assistant',
        content: [{ type: 'text', text: '已整理最近的渠道对话。' }],
      });

      const response = await app.inject({
        method: 'GET',
        url: `/channels/${CHANNEL_ID}/conversations?limit=10`,
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        conversations: [
          {
            id: 'session-channel-1',
            chatId: 'chat-1',
            chatName: '工程群',
            title: `channel:${CHANNEL_ID}:chat:chat-1`,
            stateStatus: 'idle',
            messageCount: 2,
            lastMessagePreview: '已整理最近的渠道对话。',
            createdAt: '2026-07-04 10:01:00',
            updatedAt: expect.any(String),
          },
        ],
      });
    } finally {
      await app.close();
    }
  });

  it('不能读取其他用户的渠道历史', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: `/channels/${CHANNEL_ID}/conversations`,
        headers: { authorization: bearer(app, OTHER_USER_ID) },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ error: 'Channel not found' });
    } finally {
      await app.close();
    }
  });
});
