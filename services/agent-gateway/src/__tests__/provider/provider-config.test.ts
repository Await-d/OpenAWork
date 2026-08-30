import { describe, expect, it } from 'vitest';
import { providerSettingsBodySchema } from '../../provider/provider-config.js';

describe('provider settings model compaction ratios', () => {
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
