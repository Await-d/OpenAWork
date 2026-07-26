import { describe, expect, it } from 'vitest';
import { buildChatContextUsageSnapshot } from './context-usage.js';

describe('buildChatContextUsageSnapshot', () => {
  it('压缩完成后可强制使用有效历史估算，避免沿用压缩前 usage', () => {
    expect(
      buildChatContextUsageSnapshot({
        contextWindow: 100_000,
        historicalTokens: 2_400,
        reportedTotalTokens: 48_000,
        preferHistoricalEstimate: true,
      }),
    ).toEqual({
      estimated: true,
      maxTokens: 100_000,
      usedTokens: 2_400,
    });
  });

  it('没有压缩边界时仍优先展示后端 usage', () => {
    expect(
      buildChatContextUsageSnapshot({
        contextWindow: 100_000,
        historicalTokens: 2_400,
        reportedTotalTokens: 48_000,
      }),
    ).toEqual({
      estimated: false,
      maxTokens: 100_000,
      usedTokens: 48_000,
    });
  });
});
