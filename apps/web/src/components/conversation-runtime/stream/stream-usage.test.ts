import { describe, expect, it } from 'vitest';
import { mergeChatBackendUsageSnapshot, toChatBackendUsageSnapshot } from './stream-usage.js';

describe('stream usage snapshots', () => {
  it('preserves cache and reasoning details while merging same-round usage chunks', () => {
    const first = toChatBackendUsageSnapshot({
      type: 'usage',
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 130,
      reasoningTokens: 5,
      cacheReadTokens: 5,
      round: 1,
    });

    expect(
      mergeChatBackendUsageSnapshot(first, {
        type: 'usage',
        inputTokens: 100,
        outputTokens: 25,
        totalTokens: 135,
        round: 1,
      }),
    ).toEqual({
      inputTokens: 100,
      outputTokens: 25,
      totalTokens: 135,
      peakTotalTokens: 135,
      reasoningTokens: 5,
      cacheReadTokens: 5,
      round: 1,
    });
  });

  it('keeps current-round details separate from the visible context peak', () => {
    const firstRound = toChatBackendUsageSnapshot({
      type: 'usage',
      inputTokens: 60_000,
      outputTokens: 2_000,
      totalTokens: 62_000,
      cacheReadTokens: 40_000,
      round: 1,
    });

    expect(
      mergeChatBackendUsageSnapshot(firstRound, {
        type: 'usage',
        inputTokens: 39_000,
        outputTokens: 2_000,
        totalTokens: 41_000,
        round: 2,
      }),
    ).toEqual({
      inputTokens: 39_000,
      outputTokens: 2_000,
      totalTokens: 41_000,
      peakTotalTokens: 62_000,
      round: 2,
    });
  });
});
