import { describe, expect, it, vi } from 'vitest';
import type { Dispatch, SetStateAction } from 'react';
import type {
  ChatMessage,
  ChatMessagePart,
} from '../../../../components/conversation-runtime/messages/support.js';
import { buildStreamAssistantTrace } from './build-stream-assistant-trace.js';
import { commitStreamingRound } from './commit-streaming-round.js';

describe('commitStreamingRound', () => {
  it('多个非连续 reasoning parts 时按实际分片对齐结束标记和时长', () => {
    const parts: ChatMessagePart[] = [
      { id: 'm1:reasoning:0', type: 'reasoning', text: '先检查', startedAt: 100, endedAt: 400 },
      { id: 'm1:text', type: 'text', text: '中间结果' },
      { id: 'm1:reasoning:1', type: 'reasoning', text: '再确认', startedAt: 300, endedAt: 400 },
    ];
    const blocks = [
      { key: 'item:r1:output:-1:summary:-1', text: '先检查再确认', startedAt: 100, endedAt: 400 },
    ];
    const messages: ChatMessage[] = [];
    const setMessages: Dispatch<SetStateAction<ChatMessage[]>> = (update) => {
      messages.push(...(typeof update === 'function' ? update([]) : update));
    };

    commitStreamingRound({
      accumulated: '中间结果',
      accumulatedSegments: parts,
      accumulatedThinking: '先检查再确认',
      accumulatedThinkingBlocks: blocks,
      buildTraceMessage: (messageId, textContent) =>
        buildStreamAssistantTrace({
          accumulatedThinkingBlocks: blocks,
          messageId,
          resolveAssistantCapabilityKind: () => 'tool',
          textContent,
          toolCalls: new Map(),
        }),
      currentAssistantStreamMessageIdRef: { current: 'm1' },
      currentRoundStartedAt: 50,
      firstTokenLatencyAttached: false,
      firstTokenObservedAt: null,
      liveToolCalls: new Map(),
      requestStartedAt: 50,
      setMessages,
      setStreamBuffer: vi.fn(),
      setStreamThinkingBlocks: vi.fn(),
      setStreamThinkingBuffer: vi.fn(),
      setStreamingSegments: vi.fn(),
      streamRevealNextAllowedAtRef: { current: 0 },
      streamRevealTargetCodePointsRef: { current: [] },
      streamRevealTargetRef: { current: '' },
      streamRevealVisibleCodePointCountRef: { current: 0 },
      streamRevealVisibleRef: { current: '' },
      timestamp: 450,
    });

    expect(messages[0]?.parts).toEqual(parts);
    expect(messages[0]?.reasoningBlocksEndedFlags).toEqual([true, true]);
    expect(messages[0]?.reasoningBlocksDurationsMs).toEqual([300, 100]);
  });

  it('无内容时返回 null', () => {
    const result = commitStreamingRound({
      accumulated: '',
      accumulatedSegments: [],
      accumulatedThinking: '',
      accumulatedThinkingBlocks: [],
      buildTraceMessage: vi.fn(),
      currentAssistantStreamMessageIdRef: { current: 'm1' },
      currentRoundStartedAt: 1,
      firstTokenLatencyAttached: false,
      firstTokenObservedAt: null,
      liveToolCalls: new Map(),
      requestStartedAt: 1,
      setMessages: vi.fn(),
      setStreamBuffer: vi.fn(),
      setStreamThinkingBlocks: vi.fn(),
      setStreamThinkingBuffer: vi.fn(),
      setStreamingSegments: vi.fn(),
      streamRevealNextAllowedAtRef: { current: 0 },
      streamRevealTargetCodePointsRef: { current: [] },
      streamRevealTargetRef: { current: '' },
      streamRevealVisibleCodePointCountRef: { current: 0 },
      streamRevealVisibleRef: { current: '' },
      timestamp: 2,
    });

    expect(result).toBeNull();
  });

  it('有内容时会返回重置后的累积状态', () => {
    const result = commitStreamingRound({
      accumulated: 'hello',
      accumulatedSegments: [],
      accumulatedThinking: '',
      accumulatedThinkingBlocks: [],
      buildTraceMessage: vi.fn(() => ({
        content: 'hello',
        parts: [{ id: 'p1', type: 'text' as const, text: 'hello' }],
      })),
      currentAssistantStreamMessageIdRef: { current: 'm1' },
      currentRoundStartedAt: 1,
      firstTokenLatencyAttached: false,
      firstTokenObservedAt: 3,
      liveToolCalls: new Map(),
      requestStartedAt: 1,
      setMessages: vi.fn((updater) => updater([])),
      setStreamBuffer: vi.fn(),
      setStreamThinkingBlocks: vi.fn(),
      setStreamThinkingBuffer: vi.fn(),
      setStreamingSegments: vi.fn(),
      streamRevealNextAllowedAtRef: { current: 0 },
      streamRevealTargetCodePointsRef: { current: [] },
      streamRevealTargetRef: { current: '' },
      streamRevealVisibleCodePointCountRef: { current: 0 },
      streamRevealVisibleRef: { current: '' },
      timestamp: 5,
    });

    expect(result).toEqual({
      accumulated: '',
      accumulatedSegments: [],
      accumulatedThinking: '',
      accumulatedThinkingBlocks: [],
      currentRoundStartedAt: 5,
      firstTokenLatencyAttached: true,
    });
  });
});
