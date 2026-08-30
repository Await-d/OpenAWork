import { describe, expect, it } from 'vitest';
import { calculateTokenUsageCost } from './utils.js';

describe('calculateTokenUsageCost', () => {
  it('按普通输入、输出、缓存读取和缓存写入的各自单价计算费用', () => {
    const cost = calculateTokenUsageCost({
      inputTokens: 1_000,
      outputTokens: 500,
      cacheReadTokens: 4_000,
      cacheWriteTokens: 2_000,
      inputPricePerMillion: 3,
      outputPricePerMillion: 15,
      cacheReadPricePerMillion: 0.3,
      cacheWritePricePerMillion: 3.75,
    });

    expect(cost).toBeCloseTo(0.0192, 8);
  });

  it('缓存价格缺失时按普通输入单价估算，避免把缓存 token 视为免费', () => {
    const cost = calculateTokenUsageCost({
      inputTokens: 1_000,
      outputTokens: 0,
      cacheReadTokens: 9_000,
      cacheWriteTokens: 0,
      inputPricePerMillion: 2,
    });

    expect(cost).toBeCloseTo(0.02, 8);
  });

  it('拒绝非有限、非安全整数和溢出输入，避免产生非有限费用', () => {
    expect(
      calculateTokenUsageCost({
        inputTokens: Number.MAX_SAFE_INTEGER,
        outputTokens: 0,
        inputPricePerMillion: 1_000_001,
      }),
    ).toBe(0);
    expect(
      calculateTokenUsageCost({
        inputTokens: 1_000_000_000,
        outputTokens: 0,
        inputPricePerMillion: 1_000_000,
      }),
    ).toBe(1_000_000_000);
    expect(
      calculateTokenUsageCost({
        inputTokens: Number.NaN,
        outputTokens: Number.POSITIVE_INFINITY,
        inputPricePerMillion: 3,
      }),
    ).toBe(0);
  });

  it('缓存价格无效时回退普通输入单价，而不是免费计费', () => {
    expect(
      calculateTokenUsageCost({
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 2_000,
        inputPricePerMillion: 3,
        cacheReadPricePerMillion: Number.NaN,
      }),
    ).toBeCloseTo(0.006, 8);
  });
});
