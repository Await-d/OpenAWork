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
      reasoningTokens: 5,
      cacheReadTokens: 5,
      round: 1,
    });
  });
});
