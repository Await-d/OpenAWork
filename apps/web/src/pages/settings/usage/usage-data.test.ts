import { describe, expect, it } from 'vitest';
import { normalizeSettingsModelPrices } from './usage-data.js';

describe('normalizeSettingsModelPrices', () => {
  it('保留缓存读取与写入单价，供设置页识别多级上下文模型', () => {
    expect(
      normalizeSettingsModelPrices([
        {
          modelName: 'claude-3-5-sonnet-20241022',
          provider: 'Anthropic',
          providerId: 'anthropic',
          inputPer1m: 3,
          outputPer1m: 15,
          cacheReadPer1m: 0.3,
          cacheWritePer1m: 3.75,
          contextWindow: 200_000,
        },
      ]),
    ).toEqual([
      {
        id: 'claude-3-5-sonnet-20241022',
        displayName: 'claude-3-5-sonnet-20241022',
        provider: 'Anthropic',
        providerId: 'anthropic',
        inputPricePerMillion: 3,
        outputPricePerMillion: 15,
        cacheReadPricePerMillion: 0.3,
        cacheWritePricePerMillion: 3.75,
        contextWindow: 200_000,
      },
    ]);
  });

  it('兼容后端完整字段并忽略非法缓存单价', () => {
    expect(
      normalizeSettingsModelPrices([
        {
          id: 'custom-model',
          inputPricePerMillion: 1,
          outputPricePerMillion: 2,
          cacheReadPricePerMillion: 0.1,
          cacheWritePricePerMillion: Number.NaN,
        },
      ]),
    ).toEqual([
      {
        id: 'custom-model',
        displayName: 'custom-model',
        provider: 'Custom',
        inputPricePerMillion: 1,
        outputPricePerMillion: 2,
        cacheReadPricePerMillion: 0.1,
      },
    ]);
  });
});
