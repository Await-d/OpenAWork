import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../provider/models-dev.js', () => ({
  get: vi.fn(async () => ({
    openai: {
      id: 'openai',
      name: 'OpenAI',
      models: {
        'gpt-4.1': {
          id: 'gpt-4.1',
          name: 'GPT-4.1',
          cost: { input: 2, output: 8 },
          limit: { context: 1_047_576, output: 32_768 },
          tool_call: true,
          reasoning: false,
          modalities: { input: ['text', 'image'], output: ['text'] },
        },
        'gpt-5': {
          id: 'gpt-5',
          name: 'GPT-5',
          cost: { input: 1.25, output: 10 },
          limit: { context: 400_000, output: 128_000 },
          tool_call: true,
          reasoning: true,
          modalities: { input: ['text', 'image'], output: ['text'] },
        },
        'gpt-5.1-nano': {
          id: 'gpt-5.1-nano',
          name: 'GPT-5.1 Nano',
          cost: { input: 0.05, output: 0.2 },
          limit: { context: 128_000, output: 16_384 },
          tool_call: true,
          reasoning: false,
          modalities: { input: ['text'], output: ['text'] },
        },
      },
    },
  })),
  getSync: vi.fn(() => null),
}));

const { ProviderManagerImpl } = await import('../provider/manager.js');

describe('ProviderManagerImpl.syncFromModelsDev', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('merges additional live catalog models into builtin providers', async () => {
    const manager = new ProviderManagerImpl();

    const providers = await manager.syncFromModelsDev();
    const openAi = providers.find((provider) => provider.id === 'openai');

    expect(openAi).toBeDefined();
    expect(openAi?.defaultModels.some((model) => model.id === 'gpt-5')).toBe(true);
    expect(openAi?.defaultModels.find((model) => model.id === 'gpt-5')).toMatchObject({
      label: 'GPT-5',
      contextWindow: 400_000,
      maxOutputTokens: 128_000,
      supportsTools: true,
      supportsThinking: true,
      supportsVision: true,
      inputPricePerMillion: 1.25,
      outputPricePerMillion: 10,
    });
  });

  it('filters invalid live aliases such as gpt-5.1-nano from openai models', async () => {
    const manager = new ProviderManagerImpl();

    const providers = await manager.syncFromModelsDev();
    const openAi = providers.find((provider) => provider.id === 'openai');

    expect(openAi?.defaultModels.some((model) => model.id === 'gpt-5.1-nano')).toBe(false);
  });

  it('drops previously persisted invalid openai aliases during sync and repairs active selection', async () => {
    const manager = new ProviderManagerImpl({
      providers: [
        {
          ...new ProviderManagerImpl()
            .listProviders()
            .find((provider) => provider.id === 'openai')!,
          defaultModels: [
            { id: 'gpt-4.1', label: 'GPT-4.1', enabled: true },
            { id: 'gpt-5.1-nano', label: 'GPT-5.1 Nano', enabled: true },
          ],
        },
      ],
      active: {
        chat: { providerId: 'openai', modelId: 'gpt-5.1-nano' },
        fast: { providerId: 'openai', modelId: 'gpt-5.1-nano' },
      },
    });

    const providers = await manager.syncFromModelsDev();
    const openAi = providers.find((provider) => provider.id === 'openai');

    expect(openAi?.defaultModels.some((model) => model.id === 'gpt-5.1-nano')).toBe(false);
    expect(manager.getConfig().active.chat.modelId).not.toBe('gpt-5.1-nano');
  });
});
