import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sqliteGetMock, sqliteRunMock } = vi.hoisted(() => ({
  sqliteGetMock: vi.fn(),
  sqliteRunMock: vi.fn(),
}));

vi.mock('../auth.js', () => ({
  requireAuth: async (request: { user?: { email: string; sub: string } }) => {
    request.user = { sub: 'user-a', email: 'user-a@openawork.local' };
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
      bindings: {},
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
      profile: expect.objectContaining({
        name: expect.any(String),
        species: expect.any(String),
        sprite: expect.objectContaining({ species: expect.any(String) }),
      }),
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
        bindings: {
          hephaestus: {
            behaviorTone: 'focused',
            displayName: 'Heph 小锤',
            injectionMode: 'always',
            species: 'robot',
            themeVariant: 'playful',
            verbosity: 'minimal',
            voiceOutputMode: 'important_only',
            voiceRate: 1.15,
            voiceVariant: 'bright',
          },
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
      url: '/settings/companion?agentId=hephaestus',
      payload: {
        bindings: {
          hephaestus: {
            behaviorTone: 'focused',
            displayName: 'Heph 小锤',
            injectionMode: 'always',
            species: 'robot',
            themeVariant: 'playful',
            verbosity: 'minimal',
            voiceOutputMode: 'important_only',
            voiceRate: 1.15,
            voiceVariant: 'bright',
          },
        },
        preferences: {
          voiceOutputEnabled: true,
          voiceOutputMode: 'buddy_only',
          voiceRate: 1.02,
          voiceVariant: 'system',
          muted: true,
          verbosity: 'minimal',
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(sqliteRunMock).toHaveBeenCalledTimes(1);
    const [, params] = sqliteRunMock.mock.calls[0] ?? [];
    expect(params?.[0]).toBe('user-a');
    expect(params?.[1]).toBe('companion_preferences_v1');
    expect(JSON.parse(params?.[2] as string)).toMatchObject({
      preferences: expect.objectContaining({
        voiceOutputEnabled: true,
        muted: true,
        verbosity: 'minimal',
      }),
      bindings: {
        hephaestus: {
          behaviorTone: 'focused',
          displayName: 'Heph 小锤',
          injectionMode: 'always',
          species: 'robot',
          themeVariant: 'playful',
          verbosity: 'minimal',
          voiceOutputMode: 'important_only',
          voiceRate: 1.15,
          voiceVariant: 'bright',
        },
      },
      profile: expect.objectContaining({
        name: 'Heph 小锤',
        species: '机械体',
      }),
    });

    expect(JSON.parse(response.body)).toMatchObject({
      bindings: {
        hephaestus: {
          behaviorTone: 'focused',
          displayName: 'Heph 小锤',
          injectionMode: 'always',
          species: 'robot',
          themeVariant: 'playful',
          verbosity: 'minimal',
          voiceOutputMode: 'important_only',
          voiceRate: 1.15,
          voiceVariant: 'bright',
        },
      },
      feature: { enabled: true, mode: 'beta' },
      preferences: expect.objectContaining({
        voiceOutputEnabled: true,
        voiceOutputMode: 'buddy_only',
        voiceRate: 1.02,
        voiceVariant: 'system',
        muted: true,
        verbosity: 'minimal',
      }),
      profile: expect.objectContaining({
        name: 'Heph 小锤',
        species: '机械体',
      }),
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
      bindings: {},
      feature: { enabled: false, mode: 'off' },
      preferences: expect.objectContaining({ enabled: false, voiceOutputEnabled: true }),
      profile: expect.objectContaining({ name: expect.any(String) }),
    });

    await app.close();
  });

  it('resolves the returned profile for the queried agent binding', async () => {
    sqliteGetMock.mockReturnValue({
      key: 'companion_preferences_v1',
      value: JSON.stringify({
        bindings: {
          hephaestus: {
            behaviorTone: 'focused',
            displayName: 'Heph 小锤',
            injectionMode: 'always',
            species: 'robot',
            themeVariant: 'playful',
            verbosity: 'minimal',
            voiceOutputMode: 'important_only',
            voiceRate: 1.15,
            voiceVariant: 'bright',
          },
        },
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
      }),
    });

    const app = Fastify();
    await app.register(settingsRoutes);
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/settings/companion?agentId=hephaestus',
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      bindings: {
        hephaestus: {
          behaviorTone: 'focused',
          displayName: 'Heph 小锤',
          injectionMode: 'always',
          species: 'robot',
          themeVariant: 'playful',
          verbosity: 'minimal',
          voiceOutputMode: 'important_only',
          voiceRate: 1.15,
          voiceVariant: 'bright',
        },
      },
      profile: {
        name: 'Heph 小锤',
        species: '机械体',
      },
    });

    await app.close();
  });
});
