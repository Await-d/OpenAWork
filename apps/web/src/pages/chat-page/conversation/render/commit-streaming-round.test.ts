import { describe, expect, it, vi } from 'vitest';
import { commitStreamingRound } from './commit-streaming-round.js';

describe('commitStreamingRound', () => {
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
