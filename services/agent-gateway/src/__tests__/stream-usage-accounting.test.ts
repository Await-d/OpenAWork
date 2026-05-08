import { describe, expect, it } from 'vitest';
import { isContextNearOverflow } from '../session-message-store.js';
import { buildStreamUsageChunk } from '../routes/stream-usage-event.js';

describe('stream usage accounting', () => {
  it('includes detailed provider usage fields in realtime usage chunks', () => {
    expect(
      buildStreamUsageChunk({
        eventSequence: { value: 0 },
        round: 1,
        runId: 'run-1',
        usage: {
          inputTokens: 100,
          outputTokens: 20,
          totalTokens: 130,
          reasoningTokens: 5,
          cacheReadTokens: 5,
        },
      }),
    ).toMatchObject({
      type: 'usage',
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 130,
      reasoningTokens: 5,
      cacheReadTokens: 5,
      round: 1,
    });
  });

  it('counts cache read/write tokens toward context near-overflow checks', () => {
    expect(
      isContextNearOverflow({ inputTokens: 60, cacheReadTokens: 30, cacheWriteTokens: 5 }, 100, 10),
    ).toBe(true);
    expect(isContextNearOverflow({ inputTokens: 60 }, 100, 10)).toBe(false);
  });
});
