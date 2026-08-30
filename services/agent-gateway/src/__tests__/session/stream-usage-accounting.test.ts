import { describe, expect, it } from 'vitest';
import { isContextNearOverflow } from '../../session/session-message-store.js';
import { buildStreamUsageChunk } from '../../routes/stream-usage-event.js';

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

  it('将非有限 usage 字段归零后再发出实时事件', () => {
    expect(
      buildStreamUsageChunk({
        eventSequence: { value: 0 },
        round: 1,
        runId: 'run-invalid',
        usage: {
          inputTokens: Number.NaN,
          outputTokens: Number.POSITIVE_INFINITY,
          totalTokens: Number.MAX_SAFE_INTEGER,
          cacheReadTokens: -1,
        },
      }),
    ).toMatchObject({ inputTokens: 0, outputTokens: 0, totalTokens: 0, cacheReadTokens: 0 });
  });
});
