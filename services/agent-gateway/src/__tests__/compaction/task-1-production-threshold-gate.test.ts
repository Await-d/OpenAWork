import { describe, expect, it } from 'vitest';
import type { StreamUsageSummary } from '../../routes/stream-usage.js';
import { resolveModelRoundOverflow } from '../../routes/stream-model-round.js';

function usage(inputTokens: number): StreamUsageSummary {
  return {
    inputTokens,
    outputTokens: 0,
    totalTokens: inputTokens,
  };
}

describe('生产 V2 overflow gate parity seam', () => {
  it('128K context 在 107,999 不触发、108,000 触发', () => {
    expect(
      resolveModelRoundOverflow({
        usage: usage(107_999),
        effectiveContextWindow: 128_000,
        modelMaxOutputTokens: 32_000,
        contextLimitError: null,
      }),
    ).toBe(false);

    expect(
      resolveModelRoundOverflow({
        usage: usage(108_000),
        effectiveContextWindow: 128_000,
        modelMaxOutputTokens: 32_000,
        contextLimitError: null,
      }),
    ).toBe(true);
  });

  it('旧 compactionReservedTokens 只保留兼容输入，不改变新阈值', () => {
    const withoutLegacySetting = resolveModelRoundOverflow({
      usage: usage(108_000),
      effectiveContextWindow: 128_000,
      modelMaxOutputTokens: 32_000,
      contextLimitError: null,
    });
    const withLegacySetting = resolveModelRoundOverflow({
      usage: usage(108_000),
      effectiveContextWindow: 128_000,
      modelMaxOutputTokens: 32_000,
      compactionReservedTokens: 50_000,
      contextLimitError: null,
    });

    expect(withoutLegacySetting).toBe(true);
    expect(withLegacySetting).toBe(withoutLegacySetting);
  });

  it('上游明确上下文超限时，即使 usage 较低也返回 overflow', () => {
    expect(
      resolveModelRoundOverflow({
        usage: usage(94_999),
        effectiveContextWindow: 128_000,
        modelMaxOutputTokens: 32_000,
        contextLimitError: {
          currentTokens: 128_001,
          maxTokens: 128_000,
          errorType: 'token_limit_exceeded',
        },
      }),
    ).toBe(true);
  });
});
