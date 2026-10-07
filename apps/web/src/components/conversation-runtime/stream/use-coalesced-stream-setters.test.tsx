// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useCoalescedStreamSetters } from './use-coalesced-stream-setters.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** 手动控制的 rAF 队列：帧回调只在 runFrame 时执行。 */
function stubFrameQueue() {
  const queue: FrameRequestCallback[] = [];
  const cancel = vi.fn();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    queue.push(callback);
    return queue.length;
  });
  vi.stubGlobal('cancelAnimationFrame', cancel);
  return {
    queue,
    cancel,
    runFrame() {
      for (const callback of queue.splice(0, queue.length)) {
        callback(0);
      }
    },
  };
}

function createSetters() {
  return {
    setStreamBuffer: vi.fn(),
    setStreamThinkingBuffer: vi.fn(),
    setStreamThinkingBlocks: vi.fn(),
    setStreamingSegments: vi.fn(),
  };
}

describe('useCoalescedStreamSetters', () => {
  it('同一帧内的多次写入只提交一次，且提交最后值', () => {
    const frame = stubFrameQueue();
    const setters = createSetters();
    const { result } = renderHook(() => useCoalescedStreamSetters(setters));

    act(() => {
      result.current.setStreamBuffer('a');
      result.current.setStreamBuffer('ab');
      result.current.setStreamThinkingBuffer('思考片段');
      result.current.setStreamingSegments([{ id: 's1', type: 'text', text: 'ab' }]);
    });

    expect(setters.setStreamBuffer).not.toHaveBeenCalled();
    expect(setters.setStreamingSegments).not.toHaveBeenCalled();
    expect(frame.queue).toHaveLength(1);

    act(() => {
      frame.runFrame();
    });

    expect(setters.setStreamBuffer).toHaveBeenCalledTimes(1);
    expect(setters.setStreamBuffer).toHaveBeenCalledWith('ab');
    expect(setters.setStreamThinkingBuffer).toHaveBeenCalledTimes(1);
    expect(setters.setStreamThinkingBuffer).toHaveBeenCalledWith('思考片段');
    expect(setters.setStreamingSegments).toHaveBeenCalledTimes(1);

    // 下一帧的写入重新调度。
    act(() => {
      result.current.setStreamBuffer('abc');
    });
    expect(frame.queue).toHaveLength(1);
    act(() => {
      frame.runFrame();
    });
    expect(setters.setStreamBuffer).toHaveBeenCalledTimes(2);
    expect(setters.setStreamBuffer).toHaveBeenLastCalledWith('abc');
  });

  it('updater 函数按上次已提交值解析', () => {
    const frame = stubFrameQueue();
    const setters = createSetters();
    const { result } = renderHook(() => useCoalescedStreamSetters(setters));

    act(() => {
      result.current.setStreamBuffer('x');
    });
    act(() => {
      frame.runFrame();
    });

    act(() => {
      result.current.setStreamBuffer((previous) => `${previous}y`);
    });
    act(() => {
      frame.runFrame();
    });

    expect(setters.setStreamBuffer).toHaveBeenLastCalledWith('xy');
  });

  it('卸载时取消未触发的帧回调，不再提交', () => {
    const frame = stubFrameQueue();
    const setters = createSetters();
    const { result, unmount } = renderHook(() => useCoalescedStreamSetters(setters));

    act(() => {
      result.current.setStreamBuffer('a');
    });
    unmount();

    expect(frame.cancel).toHaveBeenCalledTimes(1);

    act(() => {
      frame.runFrame();
    });
    expect(setters.setStreamBuffer).not.toHaveBeenCalled();
  });
});
