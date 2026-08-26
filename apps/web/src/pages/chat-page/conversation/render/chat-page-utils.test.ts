import { describe, expect, it } from 'vitest';
import { estimateModelUsageCost, resolveModelPriceEntry } from './chat-page-utils.js';

describe('estimateModelUsageCost', () => {
  it('按普通输入、输出和缓存读写单价估算聊天费用', () => {
    expect(
      estimateModelUsageCost({
        inputTokens: 1_000,
        outputTokens: 500,
        cacheReadTokens: 4_000,
        cacheWriteTokens: 2_000,
        price: {
          modelName: 'model',
          inputPer1m: 3,
          outputPer1m: 15,
          cacheReadPer1m: 0.3,
          cacheWritePer1m: 3.75,
        },
      }),
    ).toBeCloseTo(0.0192, 8);
  });

  it('缓存单价缺失时回退普通输入单价', () => {
    expect(
      estimateModelUsageCost({
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 2_000,
        price: { modelName: 'model', inputPer1m: 3, outputPer1m: 15 },
      }),
    ).toBeCloseTo(0.006, 8);
  });

  it('优先按 providerId 与 modelId 组合匹配重复模型名', () => {
    const matched = resolveModelPriceEntry(
      [
        { providerId: 'openai', modelName: 'shared-model', inputPer1m: 1, outputPer1m: 2 },
        { providerId: 'anthropic', modelName: 'shared-model', inputPer1m: 3, outputPer1m: 4 },
      ],
      ['anthropic/shared-model', 'shared-model'],
    );
    expect(matched?.providerId).toBe('anthropic');
  });

  it('异常 token 或价格不会产生负数、NaN 或 Infinity', () => {
    expect(
      estimateModelUsageCost({
        inputTokens: -1,
        outputTokens: Number.POSITIVE_INFINITY,
        cacheReadTokens: Number.NaN,
        cacheWriteTokens: 1_000_000_001,
        price: {
          modelName: 'model',
          inputPer1m: -3,
          outputPer1m: Number.NaN,
          cacheReadPer1m: Number.POSITIVE_INFINITY,
          cacheWritePer1m: 2,
        },
      }),
    ).toBe(0);
  });
});
