// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStreamFrameController } from '../../../../components/conversation-runtime/stream/stream-frame-controller.js';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useChatStreaming } from './use-chat-streaming.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useChatStreaming', () => {
  it.each(['reset', 'unmount'] as const)('%s 释放请求帧和揭示帧且迟到帧不再发布', (action) => {
    const frames = new Map<number, FrameRequestCallback>();
    let next = 0;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.set(++next, callback);
      return next;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      frames.delete(id);
    });
    const { result, unmount } = renderHook(() => useChatStreaming());
    const handleRef = result.current.streamFrameHandleRef;
    const publish = vi.fn();
    const drain = vi.fn();
    const controller = createStreamFrameController({
      sessionId: 'session',
      handleRef,
      isActive: () => true,
      drain,
      syncSnapshot: vi.fn(),
      publishThinking: publish,
      publishSegments: publish,
    });
    controller.scheduleThinkingFlush();
    controller.scheduleSegmentsFlush();
    result.current.scheduleStreamReveal({ prefersReducedMotion: false });
    const lateFrames = [...frames.values()];
    const revealRef = result.current.pendingStreamRevealFrameRef;
    expect(frames.size).toBe(3);
    if (action === 'unmount') unmount();
    else
      act(() => {
        result.current.resetStreamState();
      });
    expect(handleRef.current).toBeNull();
    expect(revealRef.current).toBeNull();
    expect(frames.size).toBe(0);
    for (const callback of lateFrames.slice(0, 2)) callback(0);
    expect(publish).not.toHaveBeenCalled();
    expect(drain).not.toHaveBeenCalled();
  });

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
    expect(result.current.activeStreamRoundStartedAt).toBeNull();
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
      result.current.setActiveStreamRoundStartedAt(234);
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
    expect(result.current.activeStreamRoundStartedAt).toBeNull();
    expect(result.current.activeStreamFirstTokenLatencyMs).toBeNull();
    expect(result.current.streamError).toBeNull();
  });
});
