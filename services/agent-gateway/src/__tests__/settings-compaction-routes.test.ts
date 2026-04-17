import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sqliteGetMock, sqliteRunMock } = vi.hoisted(() => ({
  sqliteGetMock: vi.fn(),
  sqliteRunMock: vi.fn(),
}));

vi.mock('../auth.js', () => ({
  requireAuth: async (request: { user?: { sub: string } }) => {
    request.user = { sub: 'user-a' };
  },
}));

vi.mock('../request-workflow.js', () => ({
  startRequestWorkflow: () => ({
    step: { succeed: () => undefined, fail: () => undefined },
    child: () => ({ succeed: () => undefined, fail: () => undefined }),
  }),
}));

vi.mock('../db.js', () => ({
  WORKSPACE_ACCESS_RESTRICTED: false,
  WORKSPACE_ROOT: '/workspace',
  WORKSPACE_ROOTS: ['/workspace'],
  sqliteAll: vi.fn(),
  sqliteGet: sqliteGetMock,
  sqliteRun: sqliteRunMock,
}));

vi.mock('../provider-config.js', () => ({
  filterEnabledProviderConfig: vi.fn(({ providers, activeSelection }) => ({
    providers,
    activeSelection,
  })),
  materializeProviderConfig: vi.fn(async () => ({
    providers: [],
    activeSelection: {
      chat: { providerId: 'openai', modelId: 'gpt-5' },
      fast: { providerId: 'openai', modelId: 'gpt-5-mini' },
      compaction: { providerId: 'openai', modelId: 'gpt-5-mini' },
    },
  })),
  parseStoredDefaultThinking: vi.fn(() => null),
  providerSettingsBodySchema: { safeParse: () => ({ success: true, data: {} }) },
  providerSettingsQuerySchema: {
    safeParse: () => ({ success: true, data: { enabledOnly: false } }),
  },
}));

import { settingsRoutes } from '../routes/settings.js';

describe('settings compaction routes', () => {
  beforeEach(() => {
    sqliteGetMock.mockReset();
    sqliteRunMock.mockReset();
  });

  it('returns safe default compaction settings when no row exists', async () => {
    sqliteGetMock.mockReturnValue(undefined);

    const app = Fastify();
    await app.register(settingsRoutes);
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/settings/compaction' });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      auto: true,
      prune: true,
      recentMessagesKept: 6,
    });

    await app.close();
  });

  it('persists compaction settings updates', async () => {
    const app = Fastify();
    await app.register(settingsRoutes);
    await app.ready();

    const response = await app.inject({
      method: 'PUT',
      url: '/settings/compaction',
      payload: {
        auto: false,
        prune: false,
        reserved: 12000,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      auto: false,
      prune: false,
      reserved: 12000,
      recentMessagesKept: 6,
    });
    expect(sqliteRunMock).toHaveBeenCalledTimes(1);
    const [, params] = sqliteRunMock.mock.calls[0] ?? [];
    expect(params?.[0]).toBe('user-a');
    expect(params?.[1]).toBe('compaction_policy_v1');
    expect(JSON.parse(String(params?.[2]))).toEqual({
      auto: false,
      prune: false,
      reserved: 12000,
      recentMessagesKept: 6,
    });

    await app.close();
  });

  it('accepts compaction in active-selection updates', async () => {
    const app = Fastify();
    await app.register(settingsRoutes);
    await app.ready();

    const response = await app.inject({
      method: 'PUT',
      url: '/settings/active-selection',
      payload: {
        chat: { providerId: 'openai', modelId: 'gpt-5' },
        fast: { providerId: 'openai', modelId: 'gpt-5-mini' },
        compaction: { providerId: 'openai', modelId: 'gpt-5-mini' },
      },
    });

    expect(response.statusCode).toBe(200);
    const [, params] = sqliteRunMock.mock.calls[0] ?? [];
    expect(JSON.parse(String(params?.[1]))).toMatchObject({
      compaction: { providerId: 'openai', modelId: 'gpt-5-mini' },
    });

    await app.close();
  });
});
