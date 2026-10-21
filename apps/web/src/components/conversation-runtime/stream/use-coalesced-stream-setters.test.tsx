// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ChatMessagePart } from '../messages/support.js';
import type { StreamingThinkingBlock } from './streaming-thinking.js';
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

/** 真实 React state 版的被测宿主：用于统计「合帧到底省下多少次渲染」。 */
function useRealStateHarness() {
  const [buffer, setBuffer] = useState('');
  const [thinkingBuffer, setThinkingBuffer] = useState('');
  const [thinkingBlocks, setThinkingBlocks] = useState<StreamingThinkingBlock[]>([]);
  const [segments, setSegments] = useState<ChatMessagePart[]>([]);
  const setters = useCoalescedStreamSetters({
    setStreamBuffer: setBuffer,
    setStreamThinkingBuffer: setThinkingBuffer,
    setStreamThinkingBlocks: setThinkingBlocks,
    setStreamingSegments: setSegments,
  });
  return { buffer, setters };
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

  it('真实 state 下，同一帧内的多次写入只触发一次重渲染', async () => {
    const frame = stubFrameQueue();
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useRealStateHarness();
    });
    const baseline = renders;

    act(() => {
      for (let index = 0; index < 20; index += 1) {
        result.current.setters.setStreamBuffer(`增量-${index}`);
      }
    });
    // 帧回调未执行前不得触发渲染（否则合帧没有意义）。
    expect(renders).toBe(baseline);

    await act(async () => {
      frame.runFrame();
    });

    expect(result.current.buffer).toBe('增量-19');
    // transition 可能带来一次额外的低优先级渲染，但绝不该是 20 次。
    expect(renders - baseline).toBeLessThanOrEqual(2);
  });
});
