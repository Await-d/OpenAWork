import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ChannelInstance, MessagingChannelService } from '../channels/types.js';

const TEST_USER_ID = 'user-1';
const storedSettings = new Map<string, string>();

type StoredChannelInstance = ChannelInstance & {
  ownerUserId: string;
  subscriptions: Array<{ chatId: string; name: string; enabled: boolean }>;
  updatedAt: number;
};

const workflowLogger = {
  startChild: vi.fn(() => ({ status: 'pending' })),
  succeed: vi.fn(),
  fail: vi.fn(),
};

vi.mock('../auth.js', () => ({
  requireAuth: async (request: FastifyRequest) => {
    Object.assign(request, { user: { sub: TEST_USER_ID, email: 'user@example.com' } });
  },
  default: async () => undefined,
}));

vi.mock('../request-workflow.js', () => ({
  getRequestWorkflow: () => ({ workflowLogger, workflowContext: {}, workflowRequestStep: {} }),
  startRequestStep: () => ({ status: 'pending' }),
  startRequestWorkflow: (_request: FastifyRequest, root: string) => ({
    workflowLogger,
    workflowContext: {},
    workflowRequestStep: {},
    root,
    fail: vi.fn(),
    succeed: vi.fn(),
    step: { status: 'pending', name: root, fail: vi.fn(), succeed: vi.fn() },
    child: () => ({ status: 'pending', fail: vi.fn(), succeed: vi.fn() }),
  }),
}));

vi.mock('../db.js', () => ({
  WORKSPACE_ACCESS_MODE: 'restricted',
  WORKSPACE_ACCESS_RESTRICTED: true,
  WORKSPACE_BROWSER_ROOT: '/',
  WORKSPACE_ROOT: '/tmp/openawork-workspace-root',
  WORKSPACE_ROOTS: ['/tmp/openawork-workspace-root'],
  sqliteAll: <T>(
    query: string,
    params: Array<string | number | bigint | Uint8Array | null> = [],
  ) => {
    if (query.includes('FROM user_settings') && query.includes('key = ?')) {
      const key = String(params[0] ?? '');
      if (key === 'channels') {
        const rows: Array<{ user_id: string; value: string }> = [];
        for (const [entryKey, value] of storedSettings.entries()) {
          const [userId, settingKey] = entryKey.split(':');
          if (settingKey === 'channels' && userId) {
            rows.push({ user_id: userId, value });
          }
        }
        return rows as T[];
      }
    }

    return [] as T[];
  },
  sqliteGet: <T>(
    query: string,
    params: Array<string | number | bigint | Uint8Array | null> = [],
  ) => {
    if (query.includes('FROM user_settings')) {
      const userId = String(params[0] ?? '');
      const key = String(params[1] ?? 'channels');
      const value = storedSettings.get(`${userId}:${key}`);
      return value ? ({ value } as T) : undefined;
    }
    return undefined;
  },
  sqliteRun: (query: string, params: Array<string | number | bigint | Uint8Array | null> = []) => {
    if (query.includes('INSERT INTO user_settings')) {
      const userId = String(params[0] ?? '');
      const key = String(params[1] ?? 'channels');
      const value = String(params[2] ?? '');
      storedSettings.set(`${userId}:${key}`, value);
    }
  },
}));

function buildStoredChannel(overrides?: Partial<StoredChannelInstance>): StoredChannelInstance {
  return {
    id: 'slack-1',
    type: 'slack',
    name: 'Slack Bot',
    enabled: true,
    config: { botToken: 'xoxb-1', signingSecret: 'secret' },
    subscriptions: [],
    features: { autoReply: false, streamingReply: false, autoStart: false },
    permissions: {
      allowReadHome: false,
      readablePathPrefixes: [],
      allowWriteOutside: false,
      allowShell: false,
      allowSubAgents: false,
    },
    ownerUserId: TEST_USER_ID,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function persistChannels(channels: StoredChannelInstance[]): void {
  storedSettings.set(`${TEST_USER_ID}:channels`, JSON.stringify(channels));
}

describe('channel routes', () => {
  let app: FastifyInstance;
  let channelManager: {
    getService: (id: string) => MessagingChannelService | undefined;
    getStatus: (id: string) => string;
    restartPlugin: (instance: ChannelInstance, notify: (event: unknown) => void) => Promise<void>;
    startPlugin: (instance: ChannelInstance, notify: (event: unknown) => void) => Promise<void>;
    stopPlugin: (id: string) => Promise<void>;
  };

  beforeEach(async () => {
    storedSettings.clear();
    vi.clearAllMocks();
    vi.resetModules();

    const [{ default: Fastify }, { channelRoutes }, managerModule] = await Promise.all([
      import('fastify'),
      import('../channels/router.js'),
      import('../channels/manager.js'),
    ]);

    channelManager = managerModule.channelManager;
    app = Fastify();
    await app.register(channelRoutes);
    await app.ready();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  it('returns 400 for invalid send payloads', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/channels/slack-1/send',
      payload: { chatId: '', content: '' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('returns channel descriptors for the settings panel', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/channels/descriptors',
    });

    expect(response.statusCode).toBe(200);
    const payload = JSON.parse(response.body) as {
      descriptors: Array<{ type: string; displayName: string }>;
    };
    expect(payload.descriptors.some((descriptor) => descriptor.type === 'feishu')).toBe(true);
  });

  it('returns 404 when sending to a missing channel', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/channels/slack-1/send',
      payload: { chatId: 'C123', content: 'hello' },
    });

    expect(response.statusCode).toBe(404);
  });

  it('returns 409 when listing groups for a stopped channel', async () => {
    persistChannels([buildStoredChannel()]);
    vi.spyOn(channelManager, 'getService').mockReturnValue(undefined);
    vi.spyOn(channelManager, 'getStatus').mockReturnValue('stopped');

    const response = await app.inject({
      method: 'GET',
      url: '/channels/slack-1/groups',
    });

    expect(response.statusCode).toBe(409);
  });

  it('returns 404 when stopping a channel owned by another user', async () => {
    persistChannels([
      buildStoredChannel({
        id: 'slack-2',
        ownerUserId: 'another-user',
      }),
    ]);

    const response = await app.inject({
      method: 'POST',
      url: '/channels/slack-1/stop',
    });

    expect(response.statusCode).toBe(404);
  });

  it('returns group list when the channel service is running', async () => {
    persistChannels([buildStoredChannel()]);
    const service = {
      isRunning: () => true,
      listGroups: vi.fn(async () => [{ id: 'C123', name: '研发频道', memberCount: 8 }]),
    } as unknown as MessagingChannelService;
    vi.spyOn(channelManager, 'getService').mockReturnValue(service);
    vi.spyOn(channelManager, 'getStatus').mockReturnValue('running');

    const response = await app.inject({
      method: 'GET',
      url: '/channels/slack-1/groups',
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      groups: [{ id: 'C123', name: '研发频道', memberCount: 8 }],
    });
  });

  it('returns 409 when the channel is not running', async () => {
    persistChannels([buildStoredChannel()]);
    vi.spyOn(channelManager, 'getService').mockReturnValue(undefined);
    vi.spyOn(channelManager, 'getStatus').mockReturnValue('stopped');

    const response = await app.inject({
      method: 'POST',
      url: '/channels/slack-1/send',
      payload: { chatId: 'C123', content: 'hello' },
    });

    expect(response.statusCode).toBe(409);
  });

  it('returns 200 when the channel is owned and running', async () => {
    persistChannels([buildStoredChannel()]);
    const service = {
      isRunning: () => true,
      sendMessage: vi.fn(async () => ({ messageId: 'm-1' })),
    } as unknown as MessagingChannelService;
    vi.spyOn(channelManager, 'getService').mockReturnValue(service);
    vi.spyOn(channelManager, 'getStatus').mockReturnValue('running');

    const response = await app.inject({
      method: 'POST',
      url: '/channels/slack-1/send',
      payload: { chatId: 'C123', content: 'hello' },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ messageId: 'm-1' });
  });

  it('does not delete stored channel when stop fails during delete', async () => {
    persistChannels([buildStoredChannel()]);
    vi.spyOn(channelManager, 'stopPlugin').mockRejectedValue(new Error('stop failed'));

    const response = await app.inject({
      method: 'DELETE',
      url: '/channels/slack-1',
    });

    expect(response.statusCode).toBe(500);
    expect(storedSettings.get(`${TEST_USER_ID}:channels`)).toContain('slack-1');
  });

  it('keeps a newly created channel and returns error status when autostart fails', async () => {
    vi.spyOn(channelManager, 'startPlugin').mockRejectedValue(new Error('start failed'));

    const response = await app.inject({
      method: 'POST',
      url: '/channels',
      payload: {
        type: 'slack',
        name: 'Slack Bot',
        enabled: true,
        config: { botToken: 'xoxb-1', signingSecret: 'secret' },
        subscriptions: [],
        features: { autoReply: true, streamingReply: false, autoStart: true },
      },
    });

    expect(response.statusCode).toBe(201);
    const payload = JSON.parse(response.body) as {
      channel: ChannelInstance & { errorMessage?: string; status: string };
    };
    expect(payload.channel.status).toBe('error');
    expect(payload.channel.errorMessage).toBe('start failed');
    expect(storedSettings.get(`${TEST_USER_ID}:channels`)).toContain('Slack Bot');
  });

  it('restarts a running channel after updating its config', async () => {
    persistChannels([buildStoredChannel()]);
    vi.spyOn(channelManager, 'getStatus').mockReturnValue('running');
    const restartSpy = vi.spyOn(channelManager, 'restartPlugin').mockResolvedValue();

    const response = await app.inject({
      method: 'PUT',
      url: '/channels/slack-1',
      payload: {
        type: 'slack',
        name: 'Slack Bot Updated',
        enabled: true,
        config: { botToken: 'xoxb-2', signingSecret: 'secret-2' },
        subscriptions: [],
        features: { autoReply: true, streamingReply: false, autoStart: true },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(restartSpy).toHaveBeenCalledOnce();
  });

  it('preserves provider binding metadata on update when omitted from payload', async () => {
    persistChannels([
      buildStoredChannel({
        providerId: 'openai',
        model: 'gpt-4o',
        tools: { web_search: true },
        permissions: {
          allowReadHome: true,
          readablePathPrefixes: ['/workspace'],
          allowWriteOutside: false,
          allowShell: true,
          allowSubAgents: false,
        },
      }),
    ]);

    const response = await app.inject({
      method: 'PUT',
      url: '/channels/slack-1',
      payload: {
        type: 'slack',
        name: 'Slack Bot Updated',
        enabled: true,
        config: { botToken: 'xoxb-2', signingSecret: 'secret-2' },
        subscriptions: [{ chatId: 'C123', name: '研发频道', enabled: true }],
        features: { autoReply: true, streamingReply: false, autoStart: false },
      },
    });

    expect(response.statusCode).toBe(200);

    const payload = JSON.parse(response.body) as { channel: ChannelInstance };
    expect(payload.channel.providerId).toBe('openai');
    expect(payload.channel.model).toBe('gpt-4o');
    expect(payload.channel.tools).toEqual({ web_search: true });
    expect(payload.channel.permissions).toMatchObject({
      allowReadHome: true,
      readablePathPrefixes: ['/workspace'],
      allowShell: true,
    });
  });
});
