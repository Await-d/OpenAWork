import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIProvider, ProviderType } from '@openAwork/agent-core';

vi.mock('../session-workspace-metadata.js', () => ({
  TOOL_SURFACE_PROFILES: ['openawork', 'claude_code_default', 'claude_code_simple'],
}));

const normalizeProviderBaseUrl = (baseUrl: string): string => {
  const trimmed = baseUrl.trim();
  if (trimmed.length === 0) {
    return trimmed;
  }

  const withScheme = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;

  return withScheme.replace(/\/+$/, '');
};

const buildRequestOverrides = (
  providerOverrides?: Record<string, unknown>,
  modelOverrides?: Record<string, unknown>,
  modelId?: string,
) => {
  const omitBodyKeys = [
    ...((providerOverrides?.['omitBodyKeys'] as string[] | undefined) ?? []),
    ...((modelOverrides?.['omitBodyKeys'] as string[] | undefined) ?? []),
  ];

  if (modelId?.match(/^gpt-5([-.]|$)/i)) {
    omitBodyKeys.push('temperature');
  }

  return {
    ...(providerOverrides ?? {}),
    ...(modelOverrides ?? {}),
    omitBodyKeys: Array.from(new Set(omitBodyKeys)),
    headers: {
      ...((providerOverrides?.['headers'] as Record<string, string> | undefined) ?? {}),
      ...((modelOverrides?.['headers'] as Record<string, string> | undefined) ?? {}),
    },
    body: {
      ...((providerOverrides?.['body'] as Record<string, unknown> | undefined) ?? {}),
      ...((modelOverrides?.['body'] as Record<string, unknown> | undefined) ?? {}),
    },
  };
};

type MockBuiltinProviderType = Extract<ProviderType, 'anthropic' | 'openai' | 'gemini'>;

const buildBuiltinProvider = (type: MockBuiltinProviderType): AIProvider => {
  const now = new Date().toISOString();
  if (type === 'anthropic') {
    return {
      id: 'anthropic',
      type: 'anthropic',
      name: 'Anthropic',
      enabled: true,
      baseUrl: 'https://api.anthropic.com/v1',
      apiKeyEnv: 'ANTHROPIC_API_KEY',
      defaultModels: [
        { id: 'claude-3-7-sonnet-20250219', label: 'Claude 3.7 Sonnet', enabled: true },
      ],
      createdAt: now,
      updatedAt: now,
    };
  }

  if (type === 'gemini') {
    return {
      id: 'gemini',
      type: 'gemini',
      name: 'Google Gemini',
      enabled: true,
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      apiKeyEnv: 'GEMINI_API_KEY',
      defaultModels: [
        {
          id: 'gemini-2.5-pro',
          label: 'Gemini 2.5 Pro',
          enabled: true,
          supportsThinking: true,
        },
      ],
      createdAt: now,
      updatedAt: now,
    };
  }

  return {
    id: 'openai',
    type: 'openai',
    name: 'OpenAI',
    enabled: true,
    baseUrl: 'https://api.openai.com/v1',
    apiKeyEnv: 'OPENAI_API_KEY',
    defaultModels: [
      { id: 'gpt-5', label: 'GPT-5', enabled: true },
      { id: 'gpt-5-mini', label: 'GPT-5 Mini', enabled: true },
      { id: 'o3', label: 'o3', enabled: true, supportsThinking: true },
    ],
    createdAt: now,
    updatedAt: now,
  };
};

class MockProviderManagerImpl {
  private providers: Array<ReturnType<typeof buildBuiltinProvider>>;

  private active: {
    chat: { providerId: string; modelId: string };
    fast: { providerId: string; modelId: string };
  };

  public constructor(initialConfig?: {
    providers?: Array<ReturnType<typeof buildBuiltinProvider>>;
    active?: {
      chat: { providerId: string; modelId: string };
      fast: { providerId: string; modelId: string };
    };
  }) {
    this.providers = (initialConfig?.providers ?? [buildBuiltinProvider('openai')]).map(
      (provider) => ({
        ...provider,
        baseUrl: normalizeProviderBaseUrl(provider.baseUrl),
        defaultModels: provider.defaultModels.map((model) => ({ ...model })),
      }),
    );
    this.active = initialConfig?.active ?? this.pickFirstAvailableSelection();
    this.ensureActiveSelectionValid();
  }

  public syncBuiltinPresets(): Array<ReturnType<typeof buildBuiltinProvider>> {
    for (const type of ['openai', 'anthropic', 'gemini'] as const) {
      if (!this.providers.some((provider) => provider.type === type)) {
        this.providers.push(buildBuiltinProvider(type));
      }
    }

    this.ensureActiveSelectionValid();
    return this.listProviders();
  }

  public async syncFromModelsDev(): Promise<Array<ReturnType<typeof buildBuiltinProvider>>> {
    return this.syncBuiltinPresets();
  }

  public getConfig(): {
    providers: Array<ReturnType<typeof buildBuiltinProvider>>;
    active: {
      chat: { providerId: string; modelId: string };
      fast: { providerId: string; modelId: string };
    };
  } {
    return {
      providers: this.listProviders(),
      active: {
        chat: { ...this.active.chat },
        fast: { ...this.active.fast },
      },
    };
  }

  public getChatProviderConfig(): {
    provider: ReturnType<typeof buildBuiltinProvider>;
    model: { id: string; label: string; enabled: boolean };
  } {
    const provider = this.providers.find((item) => item.id === this.active.chat.providerId);
    if (!provider) {
      throw new Error('Provider not found');
    }

    const model = provider.defaultModels.find((item) => item.id === this.active.chat.modelId);
    if (!model) {
      throw new Error('Model not found');
    }

    return {
      provider: { ...provider, defaultModels: provider.defaultModels.map((item) => ({ ...item })) },
      model: { ...model },
    };
  }

  private listProviders(): Array<ReturnType<typeof buildBuiltinProvider>> {
    return this.providers.map((provider) => ({
      ...provider,
      defaultModels: provider.defaultModels.map((model) => ({ ...model })),
    }));
  }

  private pickFirstAvailableSelection(): {
    chat: { providerId: string; modelId: string };
    fast: { providerId: string; modelId: string };
  } {
    const firstProvider = this.providers.find(
      (provider) => provider.enabled && provider.defaultModels[0],
    );
    const modelId = firstProvider?.defaultModels[0]?.id ?? '';

    return {
      chat: { providerId: firstProvider?.id ?? '', modelId },
      fast: { providerId: firstProvider?.id ?? '', modelId },
    };
  }

  private ensureActiveSelectionValid(): void {
    const provider = this.providers.find(
      (item) => item.id === this.active.chat.providerId && item.enabled,
    );
    const model = provider?.defaultModels.find(
      (item) => item.id === this.active.chat.modelId && item.enabled,
    );
    if (provider && model) {
      return;
    }

    this.active = this.pickFirstAvailableSelection();
  }
}

vi.mock('@openAwork/agent-core', () => ({
  ProviderManagerImpl: MockProviderManagerImpl,
  buildRequestOverrides,
  getBuiltinProviderPreset: (type: MockBuiltinProviderType) => buildBuiltinProvider(type),
  getAllBuiltinPresets: () => [
    buildBuiltinProvider('openai'),
    buildBuiltinProvider('anthropic'),
    buildBuiltinProvider('gemini'),
  ],
  getModelsDevDataSync: () => null,
  normalizeProviderBaseUrl,
}));

const providerConfigModule = await import('../provider-config.js');
const modelRouterModule = await import('../model-router.js');

const getBuiltinProviderPreset = (type: MockBuiltinProviderType) => buildBuiltinProvider(type);
const {
  filterEnabledProviderConfig,
  getActiveChatProviderConfig,
  getProviderConfigForSelection,
  materializeProviderConfig,
  providerSettingsBodySchema,
  providerSettingsQuerySchema,
} = providerConfigModule;
const { resolveModelRoute, resolveModelRouteFromProvider, validateModelRequest } =
  modelRouterModule;

describe('providerSettingsBodySchema', () => {
  it('accepts builtin providers without explicit timestamps', () => {
    const provider = getBuiltinProviderPreset('openai');
    const result = providerSettingsBodySchema.safeParse({
      providers: [
        {
          ...provider,
          createdAt: undefined,
          updatedAt: undefined,
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it('accepts default thinking settings alongside provider configuration', () => {
    const provider = getBuiltinProviderPreset('openai');
    const result = providerSettingsBodySchema.safeParse({
      providers: [provider],
      defaultThinking: {
        chat: { enabled: true, effort: 'high' },
        fast: { enabled: false, effort: 'medium' },
      },
    });

    expect(result.success).toBe(true);
  });

  it('accepts zero token metadata for image-style models', () => {
    const provider = getBuiltinProviderPreset('openai');
    const result = providerSettingsBodySchema.safeParse({
      providers: [
        {
          ...provider,
          defaultModels: provider.defaultModels.map((model, index) =>
            index === 0
              ? {
                  ...model,
                  contextWindow: 0,
                  maxOutputTokens: 0,
                }
              : model,
          ),
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.data?.providers[0]?.defaultModels[0]?.contextWindow).toBe(0);
    expect(result.data?.providers[0]?.defaultModels[0]?.maxOutputTokens).toBe(0);
  });

  it('rejects invalid provider types', () => {
    const provider = getBuiltinProviderPreset('openai');
    const result = providerSettingsBodySchema.safeParse({
      providers: [{ ...provider, type: 'unknown-provider' }],
    });

    expect(result.success).toBe(false);
  });

  it('rejects custom providers without a baseUrl', () => {
    const result = providerSettingsBodySchema.safeParse({
      providers: [
        {
          id: 'custom-empty-base',
          type: 'custom',
          name: 'Custom Empty Base',
          enabled: true,
          baseUrl: '',
          defaultModels: [{ id: 'gpt-4o', label: 'GPT-4o', enabled: true }],
        },
      ],
    });

    expect(result.success).toBe(false);
  });
});

describe('providerSettingsQuerySchema', () => {
  it('parses enabledOnly=true into a boolean flag', () => {
    const result = providerSettingsQuerySchema.safeParse({ enabledOnly: 'true' });

    expect(result.success).toBe(true);
    expect(result.data?.enabledOnly).toBe(true);
  });

  it('parses omitted enabledOnly as false', () => {
    const result = providerSettingsQuerySchema.safeParse({});

    expect(result.success).toBe(true);
    expect(result.data?.enabledOnly).toBe(false);
  });
});

describe('materializeProviderConfig', () => {
  it('returns builtin presets and a valid active selection when storage is empty', async () => {
    const result = await materializeProviderConfig(null, null);

    expect(result.providers.length).toBeGreaterThan(0);
    expect(result.activeSelection.chat.providerId).toBeTruthy();
    expect(result.activeSelection.chat.modelId).toBeTruthy();
  });

  it('normalizes custom base URLs and preserves custom providers', async () => {
    const result = await materializeProviderConfig(
      [
        {
          id: 'custom-team-endpoint',
          type: 'custom',
          name: 'Team Proxy',
          enabled: true,
          baseUrl: 'proxy.internal.example/v1/',
          defaultModels: [{ id: 'gpt-4o', label: 'GPT-4o', enabled: true }],
        },
      ],
      {
        chat: { providerId: 'custom-team-endpoint', modelId: 'gpt-4o' },
        fast: { providerId: 'custom-team-endpoint', modelId: 'gpt-4o' },
      },
    );

    const customProvider = result.providers.find(
      (provider) => provider.id === 'custom-team-endpoint',
    );
    expect(customProvider?.baseUrl).toBe('https://proxy.internal.example/v1');
    expect(result.activeSelection.chat.providerId).toBe('custom-team-endpoint');
  });

  it('heals invalid active selections back to an available provider/model', async () => {
    const openAiProvider = getBuiltinProviderPreset('openai');
    const result = await materializeProviderConfig([openAiProvider], {
      chat: { providerId: 'missing-provider', modelId: 'missing-model' },
      fast: { providerId: 'missing-provider', modelId: 'missing-model' },
    });

    expect(result.activeSelection.chat.providerId).toBe('openai');
    expect(result.activeSelection.chat.modelId).toBe(openAiProvider.defaultModels[0]?.id);
  });

  it('keeps valid stored providers when one legacy entry is malformed', async () => {
    const result = await materializeProviderConfig(
      [
        getBuiltinProviderPreset('openai'),
        {
          id: '',
          type: 'openai',
          name: 'Broken Legacy Entry',
          enabled: true,
          baseUrl: 'https://broken.example.com/v1',
          defaultModels: [],
        },
      ],
      null,
    );

    expect(result.providers.some((provider) => provider.id === 'openai')).toBe(true);
  });

  it('preserves zero token metadata for image-style models during materialization', async () => {
    const provider = getBuiltinProviderPreset('openai');
    const result = await materializeProviderConfig(
      [
        {
          ...provider,
          defaultModels: provider.defaultModels.map((model, index) =>
            index === 0
              ? {
                  ...model,
                  contextWindow: 0,
                  maxOutputTokens: 0,
                }
              : model,
          ),
        },
      ],
      null,
    );

    const openAiProvider = result.providers.find((item) => item.id === provider.id);
    expect(openAiProvider?.defaultModels[0]?.contextWindow).toBe(0);
    expect(openAiProvider?.defaultModels[0]?.maxOutputTokens).toBe(0);
  });
});

describe('filterEnabledProviderConfig', () => {
  it('keeps only enabled providers and enabled models', () => {
    const openAiProvider = getBuiltinProviderPreset('openai');
    const anthropicProvider = getBuiltinProviderPreset('anthropic');
    const filtered = filterEnabledProviderConfig({
      providers: [
        {
          ...openAiProvider,
          defaultModels: openAiProvider.defaultModels.map((model, index) => ({
            ...model,
            enabled: index === 0,
          })),
        },
        {
          ...anthropicProvider,
          defaultModels: anthropicProvider.defaultModels.map((model) => ({
            ...model,
            enabled: false,
          })),
        },
      ],
      activeSelection: {
        chat: { providerId: 'openai', modelId: openAiProvider.defaultModels[0]?.id ?? 'gpt-5' },
        fast: { providerId: 'openai', modelId: openAiProvider.defaultModels[0]?.id ?? 'gpt-5' },
      },
    });

    expect(filtered.providers).toHaveLength(1);
    expect(filtered.providers[0]?.id).toBe('openai');
    expect(filtered.providers[0]?.defaultModels).toHaveLength(1);
    expect(filtered.providers[0]?.defaultModels[0]?.enabled).toBe(true);
    expect(filtered.activeSelection.chat.providerId).toBe('openai');
  });
});

describe('getActiveChatProviderConfig', () => {
  it('returns the configured active provider and model', async () => {
    const openAiProvider = getBuiltinProviderPreset('openai');
    const result = await getActiveChatProviderConfig([openAiProvider], {
      chat: { providerId: 'openai', modelId: openAiProvider.defaultModels[1]?.id ?? 'gpt-5-mini' },
      fast: { providerId: 'openai', modelId: openAiProvider.defaultModels[0]?.id ?? 'gpt-5' },
    });

    expect(result?.provider.id).toBe('openai');
    expect(result?.modelId).toBe(openAiProvider.defaultModels[1]?.id ?? 'gpt-5-mini');
  });
});

describe('getProviderConfigForSelection', () => {
  it('prefers an explicit provider/model selection over the stored active selection', async () => {
    const openAiProvider = getBuiltinProviderPreset('openai');
    const anthropicProvider = getBuiltinProviderPreset('anthropic');

    const result = await getProviderConfigForSelection(
      [openAiProvider, anthropicProvider],
      {
        chat: { providerId: 'anthropic', modelId: anthropicProvider.defaultModels[0]?.id ?? '' },
        fast: { providerId: 'anthropic', modelId: anthropicProvider.defaultModels[0]?.id ?? '' },
      },
      {
        providerId: 'openai',
        modelId: openAiProvider.defaultModels[0]?.id ?? 'gpt-5',
      },
    );

    expect(result?.provider.id).toBe('openai');
    expect(result?.modelId).toBe(openAiProvider.defaultModels[0]?.id ?? 'gpt-5');
  });
});

describe('resolveModelRoute', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it('maps the default sentinel to AI_DEFAULT_MODEL', () => {
    vi.stubEnv('AI_DEFAULT_MODEL', 'moonshot-v1-32k');
    const route = resolveModelRoute({ model: 'default', maxTokens: 2048, temperature: 1 });

    expect(route.model).toBe('moonshot-v1-32k');
  });

  it('treats omitted model the same as the default sentinel', () => {
    vi.stubEnv('AI_DEFAULT_MODEL', 'moonshot-v1-32k');
    const parsed = validateModelRequest({ maxTokens: 2048, temperature: 1 });
    const route = resolveModelRoute(parsed);

    expect(parsed.model).toBe('default');
    expect(route.model).toBe('moonshot-v1-32k');
  });

  it('accepts dynamic model ids returned by provider settings', () => {
    const parsed = validateModelRequest({ model: 'gpt-5', maxTokens: 2048, temperature: 1 });

    expect(parsed.model).toBe('gpt-5');
    expect(resolveModelRoute(parsed).model).toBe('gpt-5');
  });

  it('hydrates builtin provider metadata for fallback reasoning models', () => {
    const route = resolveModelRoute({ model: 'o3', maxTokens: 2048, temperature: 1 });

    expect(route.providerType).toBe('openai');
    expect(route.upstreamProtocol).toBe('responses');
    expect(route.supportsThinking).toBe(true);
    expect(route.apiBaseUrl).toBe('https://api.openai.com/v1');
  });

  it('uses builtin provider baseUrl and thinking metadata for non-openai fallback models', () => {
    const route = resolveModelRoute({ model: 'gemini-2.5-pro', maxTokens: 2048, temperature: 1 });

    expect(route.providerType).toBe('gemini');
    expect(route.upstreamProtocol).toBe('chat_completions');
    expect(route.supportsThinking).toBe(true);
    expect(route.apiBaseUrl).toBe('https://generativelanguage.googleapis.com/v1beta');
  });
});

describe('resolveModelRouteFromProvider', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses a stored provider baseUrl and apiKey when present', () => {
    const provider = {
      ...getBuiltinProviderPreset('openai'),
      baseUrl: 'https://gateway.internal/v1/',
      apiKey: 'sk-custom',
    };

    const route = resolveModelRouteFromProvider(provider, 'gpt-4o', {
      maxTokens: 2048,
      temperature: 1,
    });

    expect(route.apiBaseUrl).toBe('https://gateway.internal/v1');
    expect(route.apiKey).toBe('sk-custom');
    expect(route.model).toBe('gpt-4o');
  });

  it('uses chat_completions protocol for OpenAI providers with non-official base URLs (proxies)', () => {
    const provider = {
      ...getBuiltinProviderPreset('openai'),
      baseUrl: 'https://my-proxy.example.com/v1',
      apiKey: 'sk-proxy',
    };

    const route = resolveModelRouteFromProvider(provider, 'gpt-4o', {
      maxTokens: 2048,
      temperature: 1,
    });

    expect(route.apiBaseUrl).toBe('https://my-proxy.example.com/v1');
    expect(route.upstreamProtocol).toBe('chat_completions');
  });

  it('uses responses protocol for OpenAI providers with the official api.openai.com base URL', () => {
    const provider = {
      ...getBuiltinProviderPreset('openai'),
    };

    const route = resolveModelRouteFromProvider(provider, 'gpt-4o', {
      maxTokens: 2048,
      temperature: 1,
    });

    expect(route.apiBaseUrl).toBe('https://api.openai.com/v1');
    expect(route.upstreamProtocol).toBe('responses');
  });

  it('falls back to provider apiKeyEnv when apiKey is absent', () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-from-env');
    const provider = {
      ...getBuiltinProviderPreset('openai'),
      apiKey: undefined,
      apiKeyEnv: 'OPENAI_API_KEY',
    };

    const route = resolveModelRouteFromProvider(provider, 'gpt-4o', {
      maxTokens: 2048,
      temperature: 1,
    });

    expect(route.apiKey).toBe('sk-from-env');
  });

  it('does not use env fallback for overridden custom endpoints', () => {
    vi.stubEnv('AI_API_KEY', 'sk-global-fallback');
    vi.stubEnv('OPENAI_API_KEY', 'sk-provider-env');
    const provider = {
      ...getBuiltinProviderPreset('openai'),
      apiKey: undefined,
      baseUrl: 'https://gateway.internal/v1',
    };

    const route = resolveModelRouteFromProvider(provider, 'gpt-4o', {
      maxTokens: 2048,
      temperature: 1,
    });

    expect(route.apiKey).toBe('');
  });

  it('routes openai providers with alias model ids to responses protocol', () => {
    const provider = {
      ...getBuiltinProviderPreset('openai'),
      defaultModels: [
        {
          id: 'team-model-alias',
          label: 'Team Alias',
          enabled: true,
          contextWindow: 128_000,
        },
      ],
    };

    const route = resolveModelRouteFromProvider(provider, 'team-model-alias', {
      maxTokens: 2048,
      temperature: 1,
    });

    expect(route.upstreamProtocol).toBe('responses');
    expect(route.contextWindow).toBe(128_000);
  });

  it('exposes provider thinking metadata for upstream request mapping', () => {
    const provider = {
      ...getBuiltinProviderPreset('openai'),
      defaultModels: [{ id: 'o3', label: 'o3', enabled: true, supportsThinking: true }],
    };

    const route = resolveModelRouteFromProvider(provider, 'o3', {
      maxTokens: 2048,
      temperature: 1,
    });

    expect(route.providerType).toBe('openai');
    expect(route.supportsThinking).toBe(true);
  });
});
