import { describe, expect, it } from 'vitest';
import { buildChatContextUsageSnapshot } from './context-usage.js';

describe('buildChatContextUsageSnapshot', () => {
  it('returns null when the active model has no context window', () => {
    expect(
      buildChatContextUsageSnapshot({
        historicalTokens: 12_000,
        streamingTotalTokens: 18_000,
      }),
    ).toBeNull();
  });

  it('uses historical tokens when no streaming total is available', () => {
    expect(
      buildChatContextUsageSnapshot({
        contextWindow: 200_000,
        historicalTokens: 48_000,
      }),
    ).toEqual({
      estimated: true,
      maxTokens: 200_000,
      usedTokens: 48_000,
    });
  });

  it('prefers the larger streaming total when a response is still growing', () => {
    expect(
      buildChatContextUsageSnapshot({
        contextWindow: 200_000,
        historicalTokens: 48_000,
        streamingTotalTokens: 63_000,
      }),
    ).toEqual({
      estimated: true,
      maxTokens: 200_000,
      usedTokens: 63_000,
    });
  });

  it('prefers precise backend usage when the gateway reports a real total', () => {
    expect(
      buildChatContextUsageSnapshot({
        contextWindow: 200_000,
        historicalTokens: 48_000,
        reportedTotalTokens: 71_000,
        streamingTotalTokens: 63_000,
      }),
    ).toEqual({
      estimated: false,
      maxTokens: 200_000,
      usedTokens: 71_000,
    });
  });

  it('falls back to estimated usage when the backend reports zero but history is non-zero', () => {
    expect(
      buildChatContextUsageSnapshot({
        contextWindow: 200_000,
        historicalTokens: 48_000,
        reportedTotalTokens: 0,
        streamingTotalTokens: 63_000,
      }),
    ).toEqual({
      estimated: true,
      maxTokens: 200_000,
      usedTokens: 63_000,
    });
  });
});
