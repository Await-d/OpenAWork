import { describe, expect, it, vi } from 'vitest';
import type { Dispatch, SetStateAction } from 'react';
import type {
  ChatMessage,
  ChatMessagePart,
} from '../../../../components/conversation-runtime/messages/support.js';
import { finalizeStreamMessage } from './finalize-stream-message.js';

describe('finalizeStreamMessage', () => {
  it('多个 reasoning parts 时不会让单个逻辑 block 的状态数组错位', () => {
    const parts: ChatMessagePart[] = [
      { id: 'm1:reasoning:0', type: 'reasoning', text: '先检查', startedAt: 100, endedAt: 400 },
      { id: 'm1:text', type: 'text', text: '中间结果' },
      { id: 'm1:reasoning:1', type: 'reasoning', text: '再确认', startedAt: 300, endedAt: 400 },
    ];
    const messages: ChatMessage[] = [];
    const setMessages: Dispatch<SetStateAction<ChatMessage[]>> = (update) => {
      messages.push(...(typeof update === 'function' ? update([]) : update));
    };

    finalizeStreamMessage({
      accumulatedSegments: parts,
      accumulatedThinking: '先检查再确认',
      buildTraceMessage: () => ({
        content: '中间结果',
        parts: [{ id: 'legacy', type: 'text', text: '中间结果' }],
        reasoningBlocksEndedFlags: [true],
        reasoningBlocksDurationsMs: [300],
      }),
      contentText: '中间结果',
      createdAt: 450,
      currentRoundStartedAt: 50,
      firstTokenLatencyAttached: false,
      firstTokenObservedAt: null,
      messageId: 'm1',
      requestStartedAt: 50,
      setMessages,
      status: 'completed',
      toolCallIds: new Set(),
    });

    expect(messages[0]?.parts).toEqual(parts);
    expect(messages[0]?.reasoningBlocksEndedFlags).toEqual([true, true]);
    expect(messages[0]?.reasoningBlocksDurationsMs).toEqual([300, 100]);
  });

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
