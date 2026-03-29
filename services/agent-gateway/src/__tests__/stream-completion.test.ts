import { describe, expect, it } from 'vitest';
import { resolveEofRoundDecision, resolveEofStopReason } from '../routes/stream-completion.js';

describe('resolveEofStopReason', () => {
  it('infers tool_use when tool calls were accumulated but no finish_reason arrived', () => {
    expect(
      resolveEofStopReason({ sawFinishReason: false, stopReason: 'end_turn', toolCallCount: 1 }),
    ).toEqual({ stopReason: 'tool_use', truncated: false });
  });

  it('marks plain-text EOF without finish_reason as truncated', () => {
    expect(
      resolveEofStopReason({ sawFinishReason: false, stopReason: 'end_turn', toolCallCount: 0 }),
    ).toEqual({ stopReason: 'end_turn', truncated: true });
  });

  it('preserves explicit finish reasons', () => {
    expect(
      resolveEofStopReason({ sawFinishReason: true, stopReason: 'tool_use', toolCallCount: 1 }),
    ).toEqual({ stopReason: 'tool_use', truncated: false });
  });

  it('keeps tool loops running on EOF when tool_use and tool calls are already known', () => {
    expect(
      resolveEofRoundDecision({ sawFinishReason: true, stopReason: 'tool_use', toolCallCount: 1 }),
    ).toEqual({
      stopReason: 'tool_use',
      truncated: false,
      shouldContinue: true,
      shouldStop: false,
    });
  });

  it('continues tool loops when EOF lacks done markers but tool calls were accumulated', () => {
    expect(
      resolveEofRoundDecision({ sawFinishReason: false, stopReason: 'end_turn', toolCallCount: 1 }),
    ).toEqual({
      stopReason: 'tool_use',
      truncated: false,
      shouldContinue: true,
      shouldStop: false,
    });
  });
});
