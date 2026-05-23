// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useChatStreaming } from './use-chat-streaming.js';

afterEach(() => {
  cleanup();
});

describe('useChatStreaming', () => {
  it('初始化为空并可通过 resetStreamState 清空', () => {
    const { result } = renderHook(() => useChatStreaming());

    expect(result.current.streaming).toBe(false);
    expect(result.current.stoppingStream).toBe(false);
    expect(result.current.streamBuffer).toBe('');
    expect(result.current.streamThinkingBuffer).toBe('');
    expect(result.current.streamThinkingBlocks).toEqual([]);
    expect(result.current.streamingSegments).toEqual([]);
    expect(result.current.reportedStreamUsage).toBeNull();
    expect(result.current.recoveryActiveStream).toBeNull();
    expect(result.current.recoveredStreamSnapshot).toBeNull();
    expect(result.current.activeStreamStartedAt).toBeNull();
    expect(result.current.activeStreamFirstTokenLatencyMs).toBeNull();
    expect(result.current.streamError).toBeNull();

    act(() => {
      result.current.setStreaming(true);
      result.current.setStoppingStream(true);
      result.current.setStreamBuffer('hello');
      result.current.setStreamThinkingBuffer('think');
      result.current.setStreamThinkingBlocks([{ key: 'k', text: 't' } as never]);
      result.current.setStreamingSegments([{ id: 'p1', type: 'text', text: 'x' } as never]);
      result.current.setReportedStreamUsage({
        inputTokens: 1,
        outputTokens: 2,
        totalTokens: 3,
        round: 1,
      });
      result.current.setActiveStreamStartedAt(123);
      result.current.setActiveStreamFirstTokenLatencyMs(456);
      result.current.setStreamError('boom');
    });

    act(() => {
      result.current.resetStreamState();
    });

    expect(result.current.streaming).toBe(false);
    expect(result.current.stoppingStream).toBe(false);
    expect(result.current.streamBuffer).toBe('');
    expect(result.current.streamThinkingBuffer).toBe('');
    expect(result.current.streamThinkingBlocks).toEqual([]);
    expect(result.current.streamingSegments).toEqual([]);
    expect(result.current.reportedStreamUsage).toBeNull();
    expect(result.current.activeStreamStartedAt).toBeNull();
    expect(result.current.activeStreamFirstTokenLatencyMs).toBeNull();
    expect(result.current.streamError).toBeNull();
  });
});
