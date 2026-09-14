import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ModelsDevModule from './models-dev.js';

const getModelsDevData = vi.fn();

vi.mock('./models-dev.js', async (importOriginal) => {
  const original = await importOriginal<typeof ModelsDevModule>();
  return {
    ...original,
    get: getModelsDevData,
    getSync: () => null,
  };
});

describe('ProviderManagerImpl models.dev 同步', () => {
  beforeEach(() => {
    getModelsDevData.mockReset();
  });

  it('通过 models.dev provider 标识解析内置别名并同步完整能力', async () => {
    getModelsDevData.mockResolvedValue({
      zhipuai: {
        id: 'zhipuai',
        name: 'Zhipu AI',
        models: {
          'glm-5.3-flash': {
            id: 'glm-5.3-flash',
            name: 'GLM-5.3-Flash',
            description: 'Native multimodal GLM model',
            family: 'glm',
            attachment: true,
            knowledge: '2026-01',
            reasoning: true,
            reasoning_options: [{ type: 'effort', values: ['low', 'high', 'max'] }],
            tool_call: true,
            interleaved: { field: 'reasoning_content' },
            structured_output: true,
            temperature: true,
            release_date: '2026-08-26',
            last_updated: '2026-08-26',
            modalities: {
              input: ['text', 'image', 'video', 'pdf'],
              output: ['text'],
            },
            open_weights: false,
            experimental: { modes: { fast: { enabled: true } } },
            options: { region: 'cn' },
            limit: { context: 1_000_000, output: 131_072 },
            cost: { input: 0.075, output: 0.25, cache_read: 0.015, cache_write: 0 },
          },
        },
      },
    });

    const { ProviderManagerImpl } = await import('./manager.js');
    const manager = new ProviderManagerImpl();

    await manager.syncFromModelsDev();

    const zhipu = manager.listProviders().find((provider) => provider.type === 'zhipu');
    const model = zhipu?.defaultModels.find((item) => item.id === 'glm-5.3-flash');
    expect(model).toMatchObject({
      label: 'GLM-5.3-Flash',
      description: 'Native multimodal GLM model',
      family: 'glm',
      contextWindow: 1_000_000,
      maxOutputTokens: 131_072,
      supportsAttachments: true,
      supportsTools: true,
      supportsVision: true,
      supportsVideoInput: true,
      supportsThinking: true,
      supportsStructuredOutput: true,
      supportsTemperature: true,
      supportsInterleavedReasoning: true,
      reasoningContentField: 'reasoning_content',
      releaseDate: '2026-08-26',
      lastUpdated: '2026-08-26',
      openWeights: false,
      knowledgeCutoff: '2026-01',
      experimental: { modes: { fast: { enabled: true } } },
      modelsDevOptions: { region: 'cn' },
      inputModalities: ['text', 'image', 'video', 'pdf'],
      outputModalities: ['text'],
      reasoningOptions: [{ type: 'effort', values: ['low', 'high', 'max'] }],
      inputPricePerMillion: 0.075,
      outputPricePerMillion: 0.25,
      cacheReadPricePerMillion: 0.015,
      cacheWritePricePerMillion: 0,
    });
  });

  it.each([
    ['gemini', 'google'],
    ['qwen', 'alibaba-cn'],
    ['moonshot', 'moonshotai-cn'],
    ['mimo', 'xiaomi'],
    ['doubao', 'volcengine'],
  ])('将内置 %s 映射到 models.dev 的 %s', async (type, modelsDevId) => {
    const modelId = `synced-${type}`;
    getModelsDevData.mockResolvedValue({
      [modelsDevId]: {
        id: modelsDevId,
        name: modelsDevId,
        models: {
          [modelId]: { id: modelId, name: modelId },
        },
      },
    });

    const { ProviderManagerImpl } = await import('./manager.js');
    const manager = new ProviderManagerImpl();

    await manager.syncFromModelsDev();

    const provider = manager.listProviders().find((item) => item.type === type);
    expect(provider?.defaultModels.some((item) => item.id === modelId)).toBe(true);
  });

  it('按 models.dev 输出模态回填生图能力，不误标纯文本模型', async () => {
    getModelsDevData.mockResolvedValue({
      openai: {
        id: 'openai',
        name: 'OpenAI',
        models: {
          'image-only-test': {
            id: 'image-only-test',
            name: 'Image Only',
            modalities: { input: ['text'], output: ['image'] },
          },
          'text-only-test': {
            id: 'text-only-test',
            name: 'Text Only',
            modalities: { input: ['text'], output: ['text'] },
          },
        },
      },
    });

    const { ProviderManagerImpl } = await import('./manager.js');
    const manager = new ProviderManagerImpl();

    await manager.syncFromModelsDev();

    const openai = manager.listProviders().find((provider) => provider.type === 'openai');
    const imageModel = openai?.defaultModels.find((item) => item.id === 'image-only-test');
    const textModel = openai?.defaultModels.find((item) => item.id === 'text-only-test');

    expect(imageModel?.supportsImageGeneration).toBe(true);
    expect(textModel?.supportsImageGeneration).toBe(false);
  });

  it('models.dev 未声明输出模态时不覆盖内置生图标记', async () => {
    getModelsDevData.mockResolvedValue({
      openai: {
        id: 'openai',
        name: 'OpenAI',
        models: {
          'gpt-image-2': { id: 'gpt-image-2', name: 'GPT Image 2' },
        },
      },
    });

    const { ProviderManagerImpl } = await import('./manager.js');
    const manager = new ProviderManagerImpl();

    await manager.syncFromModelsDev();

    const openai = manager.listProviders().find((provider) => provider.type === 'openai');
    const imageModel = openai?.defaultModels.find((item) => item.id === 'gpt-image-2');

    expect(imageModel?.supportsImageGeneration).toBe(true);
  });
});
