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
  sqliteAll: vi.fn(),
  sqliteGet: sqliteGetMock,
  sqliteRun: sqliteRunMock,
}));

vi.mock('../provider-config.js', () => ({
  filterEnabledProviderConfig: vi.fn(),
  materializeProviderConfig: vi.fn(async () => ({ providers: [], activeSelection: null })),
  parseStoredDefaultThinking: vi.fn(() => null),
  providerSettingsBodySchema: { safeParse: () => ({ success: true, data: {} }) },
  providerSettingsQuerySchema: {
    safeParse: () => ({ success: true, data: { enabledOnly: false } }),
  },
}));

import { settingsRoutes } from '../routes/settings.js';

describe('settings companion routes', () => {
  beforeEach(() => {
    sqliteGetMock.mockReset();
    sqliteRunMock.mockReset();
  });

  it('returns safe default companion settings when no row exists', async () => {
    sqliteGetMock.mockReturnValue(undefined);

    const app = Fastify();
    await app.register(settingsRoutes);
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/settings/companion' });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      feature: { enabled: true, mode: 'beta' },
      preferences: {
        enabled: true,
        muted: false,
        reducedMotion: false,
        verbosity: 'normal',
        injectionMode: 'mention_only',
        themeVariant: 'default',
        voiceOutputEnabled: false,
        voiceOutputMode: 'buddy_only',
        voiceRate: 1.02,
        voiceVariant: 'system',
      },
      profile: null,
    });

    await app.close();
  });

  it('merges and persists companion settings updates', async () => {
    sqliteGetMock.mockReturnValue({
      key: 'companion_preferences_v1',
      value: JSON.stringify({
        preferences: {
          enabled: true,
          muted: false,
          reducedMotion: false,
          verbosity: 'normal',
          injectionMode: 'mention_only',
          themeVariant: 'default',
          voiceOutputEnabled: false,
          voiceOutputMode: 'buddy_only',
          voiceRate: 1.02,
          voiceVariant: 'system',
        },
        profile: null,
        updatedAt: '2026-04-01T00:00:00.000Z',
      }),
    });

    const app = Fastify();
    await app.register(settingsRoutes);
    await app.ready();

    const response = await app.inject({
      method: 'PUT',
      url: '/settings/companion',
      payload: {
        preferences: {
          voiceOutputEnabled: true,
          muted: true,
          verbosity: 'minimal',
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(sqliteRunMock).toHaveBeenCalledTimes(1);
    const [, params] = sqliteRunMock.mock.calls[0] ?? [];
    expect(params?.[0]).toBe('user-a');
    expect(JSON.parse(params?.[1] as string)).toMatchObject({
      preferences: expect.objectContaining({
        voiceOutputEnabled: true,
        muted: true,
        verbosity: 'minimal',
      }),
      profile: null,
    });

    expect(JSON.parse(response.body)).toMatchObject({
      feature: { enabled: true, mode: 'beta' },
      preferences: expect.objectContaining({
        voiceOutputEnabled: true,
        muted: true,
        verbosity: 'minimal',
      }),
      profile: null,
    });

    await app.close();
  });

  it('projects the feature gate from stored companion preferences', async () => {
    sqliteGetMock.mockReturnValue({
      key: 'companion_preferences_v1',
      value: JSON.stringify({
        preferences: {
          enabled: false,
          muted: false,
          reducedMotion: false,
          verbosity: 'normal',
          injectionMode: 'mention_only',
          themeVariant: 'default',
          voiceOutputEnabled: true,
          voiceOutputMode: 'buddy_only',
          voiceRate: 1.02,
          voiceVariant: 'system',
        },
        profile: null,
      }),
    });

    const app = Fastify();
    await app.register(settingsRoutes);
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/settings/companion' });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      feature: { enabled: false, mode: 'off' },
      preferences: expect.objectContaining({ enabled: false, voiceOutputEnabled: true }),
    });

    await app.close();
  });
});
