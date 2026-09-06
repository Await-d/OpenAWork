import { describe, expect, it } from 'vitest';
import { providerSettingsBodySchema } from '../../provider/provider-config.js';

describe('provider settings model compaction ratios', () => {
  it('保留 models.dev 同步的模型元数据与多模态能力', () => {
    const parsed = providerSettingsBodySchema.parse({
      providers: [
        {
          id: 'zhipu',
          type: 'zhipu',
          name: '智谱 GLM',
          enabled: true,
          baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
          defaultModels: [
            {
              id: 'glm-5.3-flash',
              label: 'GLM-5.3-Flash',
              enabled: true,
              description: 'Native multimodal GLM model',
              family: 'glm',
              releaseDate: '2026-08-26',
              lastUpdated: '2026-08-26',
              openWeights: false,
              knowledgeCutoff: '2026-01',
              supportsAttachments: true,
              supportsVideoInput: true,
              supportsStructuredOutput: true,
              supportsTemperature: true,
              supportsInterleavedReasoning: true,
              reasoningContentField: 'reasoning_content',
              inputModalities: ['text', 'image', 'video', 'pdf'],
              outputModalities: ['text'],
              reasoningOptions: [{ type: 'effort', values: ['low', 'high', 'max'] }],
              experimental: { modes: { fast: { enabled: true } } },
              modelsDevOptions: { region: 'cn' },
            },
          ],
        },
      ],
    });

    expect(parsed.providers[0]?.defaultModels[0]).toMatchObject({
      description: 'Native multimodal GLM model',
      family: 'glm',
      supportsAttachments: true,
      supportsVideoInput: true,
      supportsStructuredOutput: true,
      knowledgeCutoff: '2026-01',
      supportsInterleavedReasoning: true,
      reasoningContentField: 'reasoning_content',
      inputModalities: ['text', 'image', 'video', 'pdf'],
      reasoningOptions: [{ type: 'effort', values: ['low', 'high', 'max'] }],
      experimental: { modes: { fast: { enabled: true } } },
      modelsDevOptions: { region: 'cn' },
    });
  });

  it('保留模型上下文压缩阈值与目标比例', () => {
    const parsed = providerSettingsBodySchema.parse({
      providers: [
        {
          id: 'relay',
          type: 'custom',
          name: 'Relay',
          enabled: true,
          baseUrl: 'https://relay.example/v1',
          defaultModels: [
            {
              id: 'model-a',
              label: 'Model A',
              enabled: true,
              contextWindow: 128_000,
              autoCompactThresholdRatio: 0.8,
              autoCompactTargetRatio: 0.5,
            },
          ],
        },
      ],
    });

    expect(parsed.providers[0]?.defaultModels[0]).toMatchObject({
      contextWindow: 128_000,
      autoCompactThresholdRatio: 0.8,
      autoCompactTargetRatio: 0.5,
    });
  });

  it('拒绝不在 0 到 1 之间的比例', () => {
    expect(() =>
      providerSettingsBodySchema.parse({
        providers: [
          {
            id: 'relay',
            type: 'custom',
            name: 'Relay',
            enabled: true,
            baseUrl: 'https://relay.example/v1',
            defaultModels: [
              {
                id: 'model-a',
                label: 'Model A',
                enabled: true,
                autoCompactThresholdRatio: 1,
              },
            ],
          },
        ],
      }),
    ).toThrow();
  });

  it('拒绝非有限或超出上限的缓存 token 单价', () => {
    const provider = {
      id: 'relay',
      type: 'custom',
      name: 'Relay',
      enabled: true,
      baseUrl: 'https://relay.example/v1',
      defaultModels: [{ id: 'model-a', label: 'Model A', enabled: true }],
    };

    expect(() =>
      providerSettingsBodySchema.parse({
        providers: [
          {
            ...provider,
            defaultModels: [
              { ...provider.defaultModels[0], cacheReadPricePerMillion: Number.POSITIVE_INFINITY },
            ],
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      providerSettingsBodySchema.parse({
        providers: [
          {
            ...provider,
            defaultModels: [{ ...provider.defaultModels[0], cacheWritePricePerMillion: 1_000_001 }],
          },
        ],
      }),
    ).toThrow();
  });
});
