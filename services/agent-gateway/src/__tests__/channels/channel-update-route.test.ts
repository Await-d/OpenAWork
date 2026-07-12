import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthModule from '../../infra/auth.js';
import type * as ChannelsRouterModule from '../../channels/router.js';
import type * as DbModule from '../../infra/db.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';
import { channelManager } from '../../channels/manager.js';
import type { ChannelInstance } from '../../channels/types.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';
process.env['AI_API_BASE_URL'] = '';
process.env['AI_API_KEY'] = '';
process.env['AI_DEFAULT_MODEL'] = '';

const USER_ID = 'u-channel-update';
const CHANNEL_ID = 'channel-update-telegram';

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

function buildStoredChannel(): ChannelInstance {
  return {
    id: CHANNEL_ID,
    type: 'telegram',
    name: 'Telegram Route',
    enabled: true,
    config: { token: 'seed-token' },
    features: { autoReply: true, streamingReply: false, autoStart: false },
    ownerUserId: USER_ID,
    createdAt: 1_788_000_000_000,
    updatedAt: 1_788_000_000_000,
  };
}

function seedChannels(): void {
  dbModule.sqliteRun(
    `INSERT INTO user_settings (user_id, key, value)
     VALUES (?, 'channels', ?)`,
    [USER_ID, JSON.stringify([buildStoredChannel()])],
  );
}

function buildUpdatePayload(autoStart: boolean) {
  return {
    type: 'telegram' as const,
    name: 'Telegram Route Updated',
    enabled: true,
    config: { token: 'updated-token' },
    features: {
      autoReply: true,
      streamingReply: false,
      autoStart,
    },
  };
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
  dbModule.sqliteRun('DELETE FROM user_settings', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  seedUser();
  seedChannels();
});

afterEach(async () => {
  await channelManager.stopAll();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('channel update route', () => {
  it('非运行中的 autoStart 通道保存后会立即拉起', async () => {
    const app = await buildApp();
    const getStatusSpy = vi.spyOn(channelManager, 'getStatus').mockReturnValue('stopped');
    const startSpy = vi.spyOn(channelManager, 'startPlugin').mockResolvedValue(undefined);
    const stopSpy = vi.spyOn(channelManager, 'stopPlugin').mockResolvedValue(undefined);
    const restartSpy = vi.spyOn(channelManager, 'restartPlugin').mockResolvedValue(undefined);

    try {
      const response = await app.inject({
        method: 'PUT',
        url: `/channels/${CHANNEL_ID}`,
        headers: { authorization: bearer(app) },
        payload: buildUpdatePayload(true),
      });

      expect(response.statusCode).toBe(200);
      expect(getStatusSpy).toHaveBeenCalledWith(CHANNEL_ID);
      expect(startSpy).toHaveBeenCalledTimes(1);
      expect(stopSpy).not.toHaveBeenCalled();
      expect(restartSpy).not.toHaveBeenCalled();
      expect(startSpy.mock.calls[0]?.[0]).toMatchObject({
        id: CHANNEL_ID,
        enabled: true,
        features: { autoStart: true },
      });
    } finally {
      await app.close();
    }
  });

  it('非运行中的非 autoStart 通道保存后会清掉挂起运行态', async () => {
    const app = await buildApp();
    vi.spyOn(channelManager, 'getStatus').mockReturnValue('error');
    const startSpy = vi.spyOn(channelManager, 'startPlugin').mockResolvedValue(undefined);
    const stopSpy = vi.spyOn(channelManager, 'stopPlugin').mockResolvedValue(undefined);
    const restartSpy = vi.spyOn(channelManager, 'restartPlugin').mockResolvedValue(undefined);

    try {
      const response = await app.inject({
        method: 'PUT',
        url: `/channels/${CHANNEL_ID}`,
        headers: { authorization: bearer(app) },
        payload: buildUpdatePayload(false),
      });

      expect(response.statusCode).toBe(200);
      expect(startSpy).not.toHaveBeenCalled();
      expect(stopSpy).toHaveBeenCalledTimes(1);
      expect(stopSpy).toHaveBeenCalledWith(CHANNEL_ID);
      expect(restartSpy).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
