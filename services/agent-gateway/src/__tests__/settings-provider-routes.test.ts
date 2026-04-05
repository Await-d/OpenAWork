import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sqliteAllMock, sqliteGetMock, sqliteRunMock } = vi.hoisted(() => ({
  sqliteAllMock: vi.fn(),
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
  sqliteAll: sqliteAllMock,
  sqliteGet: sqliteGetMock,
  sqliteRun: sqliteRunMock,
}));

vi.mock('@openAwork/agent-core', () => ({
  ProviderManagerImpl: class MockProviderManagerImpl {
    private readonly providers: Array<Record<string, unknown>>;

    private readonly active: {
      chat: { providerId: string; modelId: string };
      fast: { providerId: string; modelId: string };
    };

    public constructor(initialConfig?: {
      providers?: Array<Record<string, unknown>>;
      active?: {
        chat: { providerId: string; modelId: string };
        fast: { providerId: string; modelId: string };
      };
    }) {
      this.providers = (initialConfig?.providers ?? []).map((provider) => ({
        ...provider,
        defaultModels: Array.isArray(provider['defaultModels'])
          ? (provider['defaultModels'] as Array<Record<string, unknown>>).map((model) => ({
              ...model,
            }))
          : [],
      }));
      this.active = initialConfig?.active ?? {
        chat: { providerId: 'openai', modelId: 'chatgpt-image-latest' },
        fast: { providerId: 'openai', modelId: 'chatgpt-image-latest' },
      };
    }

    public async syncFromModelsDev(): Promise<Array<Record<string, unknown>>> {
      return this.providers;
    }

    public getConfig(): {
      providers: Array<Record<string, unknown>>;
      active: {
        chat: { providerId: string; modelId: string };
        fast: { providerId: string; modelId: string };
      };
    } {
      return {
        providers: this.providers.map((provider) => ({
          ...provider,
          defaultModels: Array.isArray(provider['defaultModels'])
            ? (provider['defaultModels'] as Array<Record<string, unknown>>).map((model) => ({
                ...model,
              }))
            : [],
        })),
        active: {
          chat: { ...this.active.chat },
          fast: { ...this.active.fast },
        },
      };
    }
  },
}));

import { settingsRoutes } from '../routes/settings.js';

describe('settings provider routes', () => {
  beforeEach(() => {
    sqliteAllMock.mockReset();
    sqliteGetMock.mockReset();
    sqliteRunMock.mockReset();
    sqliteGetMock.mockReturnValue(undefined);
  });

  it('accepts zero token metadata and persists them for image-style models', async () => {
    const app = Fastify();
    await app.register(settingsRoutes);
    await app.ready();

    const response = await app.inject({
      method: 'PUT',
      url: '/settings/providers',
      payload: {
        providers: [
          {
            id: 'openai',
            type: 'openai',
            name: 'OpenAI',
            enabled: true,
            baseUrl: 'https://api.openai.com/v1',
            apiKeyEnv: 'OPENAI_API_KEY',
            defaultModels: [
              {
                id: 'chatgpt-image-latest',
                label: 'chatgpt-image-latest',
                enabled: true,
                contextWindow: 0,
                maxOutputTokens: 0,
                supportsTools: false,
                supportsVision: true,
              },
            ],
          },
        ],
        activeSelection: {
          chat: { providerId: 'openai', modelId: 'chatgpt-image-latest' },
          fast: { providerId: 'openai', modelId: 'chatgpt-image-latest' },
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(sqliteRunMock.mock.calls.length).toBeGreaterThanOrEqual(3);

    const persistedProviders = JSON.parse(
      (sqliteRunMock.mock.calls[0] ?? [])[1]?.[1] as string,
    ) as {
      defaultModels: Array<Record<string, unknown>>;
    }[];
    expect(persistedProviders[0]?.defaultModels[0]?.['contextWindow']).toBe(0);
    expect(persistedProviders[0]?.defaultModels[0]?.['maxOutputTokens']).toBe(0);

    const payload = JSON.parse(response.body) as {
      providers: Array<{ defaultModels: Array<Record<string, unknown>> }>;
    };
    expect(payload.providers[0]?.defaultModels[0]?.['contextWindow']).toBe(0);
    expect(payload.providers[0]?.defaultModels[0]?.['maxOutputTokens']).toBe(0);

    await app.close();
  });

  it('returns the default upstream retry settings when nothing is stored', async () => {
    const app = Fastify();
    await app.register(settingsRoutes);
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/settings/upstream-retry',
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ maxRetries: 3 });

    await app.close();
  });

  it('persists upstream retry settings with the dedicated user_settings key', async () => {
    const app = Fastify();
    await app.register(settingsRoutes);
    await app.ready();

    const response = await app.inject({
      method: 'PUT',
      url: '/settings/upstream-retry',
      payload: { maxRetries: 1 },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ maxRetries: 1 });
    expect(sqliteRunMock).toHaveBeenCalledWith(expect.stringContaining('user_settings'), [
      'user-a',
      'upstream_retry_policy_v1',
      JSON.stringify({ maxRetries: 1 }),
    ]);

    await app.close();
  });
});
