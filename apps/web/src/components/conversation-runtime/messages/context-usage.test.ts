import { describe, expect, it } from 'vitest';
import { buildChatContextUsageSnapshot, resolveEffectiveContextWindow } from './context-usage.js';

describe('resolveEffectiveContextWindow', () => {
  it('挡位低于模型上限时使用挡位值', () => {
    expect(resolveEffectiveContextWindow(1_000_000, 400_000)).toBe(400_000);
  });

  it('仅配置挡位时仍能提供有效窗口', () => {
    expect(resolveEffectiveContextWindow(undefined, 272_000)).toBe(272_000);
  });

  it('没有正数窗口时返回 undefined', () => {
    expect(resolveEffectiveContextWindow(0, Number.NaN)).toBeUndefined();
  });
});

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

  it('后端 usage 小于当前消息估算时不让仪表回退', () => {
    expect(
      buildChatContextUsageSnapshot({
        contextWindow: 100_000,
        historicalTokens: 48_000,
        reportedTotalTokens: 35_000,
      }),
    ).toEqual({
      estimated: true,
      maxTokens: 100_000,
      usedTokens: 48_000,
    });
  });
});
