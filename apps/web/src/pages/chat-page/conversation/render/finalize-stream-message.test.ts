import { describe, expect, it, vi } from 'vitest';
import { finalizeStreamMessage } from './finalize-stream-message.js';

describe('finalizeStreamMessage', () => {
  it('会提交 assistant 消息并挂载首 token 延迟', () => {
    const setMessages = vi.fn((updater) => updater([]));
    const result = finalizeStreamMessage({
      accumulatedSegments: [],
      accumulatedThinking: 'thinking',
      buildTraceMessage: vi.fn(() => ({
        content: 'hello',
        parts: [{ id: 'p1', type: 'text' as const, text: 'hello' }],
      })),
      contentText: 'hello',
      createdAt: 10,
      currentRoundStartedAt: 1,
      firstTokenLatencyAttached: false,
      firstTokenObservedAt: 5,
      messageId: 'm1',
      requestStartedAt: 1,
      setMessages,
      status: 'completed',
      toolCallIds: new Set(['t1']),
    });

    expect(setMessages).toHaveBeenCalled();
    expect(result.firstTokenLatencyAttached).toBe(true);
  });
});
