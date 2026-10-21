// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useStreamReveal, type StreamRevealSetters } from './use-stream-reveal.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** 手动控制的 rAF 队列：回调只在 `runFrame(ts)` 时按给定时间戳执行。 */
function stubFrameQueue() {
  let queue: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    queue.push(callback);
    return queue.length;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  return {
    get pending() {
      return queue.length;
    },
    runFrame(ts: number) {
      const pending = queue;
      queue = [];
      for (const callback of pending) {
        callback(ts);
      }
    },
  };
}

function createSetters(): StreamRevealSetters {
  return {
    setStreamBuffer: vi.fn(),
    setStreamThinkingBuffer: vi.fn(),
    setStreamThinkingBlocks: vi.fn(),
    setStreamingSegments: vi.fn(),
    setRecoveredStreamSnapshot: vi.fn(),
    setStreaming: vi.fn(),
    setStoppingStream: vi.fn(),
    setActiveStreamStartedAt: vi.fn(),
    setActiveStreamFirstTokenLatencyMs: vi.fn(),
  };
}

/** 把目标文本与"已可见"位置直接种进 hook 的 refs（绕过 delta 事件）。 */
function seedReveal(
  hook: { current: ReturnType<typeof useStreamReveal> },
  target: string,
  visibleChars: number,
): void {
  const codePoints = Array.from(target);
  hook.current.streamRevealTargetRef.current = target;
  hook.current.streamRevealTargetCodePointsRef.current = codePoints;
  hook.current.streamRevealVisibleRef.current = codePoints.slice(0, visibleChars).join('');
  hook.current.streamRevealVisibleCodePointCountRef.current = visibleChars;
}

describe('useStreamReveal · 长文本提交降频', () => {
  it('短文本逐帧提交', () => {
    const frame = stubFrameQueue();
    const setters = createSetters();
    const { result } = renderHook(() => useStreamReveal(false, setters));

    seedReveal(result, 'a'.repeat(100), 0);
    act(() => {
      result.current.scheduleStreamReveal();
    });

    act(() => {
      frame.runFrame(1_000);
    });
    expect(setters.setStreamBuffer).toHaveBeenCalledTimes(1);

    act(() => {
      frame.runFrame(1_016);
    });
    expect(setters.setStreamBuffer).toHaveBeenCalledTimes(2);
  });

  it('长文本按 24ms 窗口提交，但推进不落后', () => {
    const frame = stubFrameQueue();
    const setters = createSetters();
    const { result } = renderHook(() => useStreamReveal(false, setters));

    // 可见位置已过 6k 阈值，后续提交进入 24ms 降频档。
    seedReveal(result, 'b'.repeat(20_000), 6_999);
    act(() => {
      result.current.scheduleStreamReveal();
    });

    act(() => {
      frame.runFrame(1_000);
    });
    expect(setters.setStreamBuffer).toHaveBeenCalledTimes(1);
    const afterFirstFrame = result.current.streamRevealVisibleRef.current.length;
    expect(afterFirstFrame).toBeGreaterThan(6_999);

    // 10ms 后只推进、不提交。
    act(() => {
      frame.runFrame(1_010);
    });
    expect(setters.setStreamBuffer).toHaveBeenCalledTimes(1);
    expect(result.current.streamRevealVisibleRef.current.length).toBeGreaterThan(afterFirstFrame);

    // 超过窗口后恢复提交，且提交的是累计到当前的全部可见文本。
    act(() => {
      frame.runFrame(1_030);
    });
    expect(setters.setStreamBuffer).toHaveBeenCalledTimes(2);
    expect(setters.setStreamBuffer).toHaveBeenLastCalledWith(
      result.current.streamRevealVisibleRef.current,
    );
  });

  it('到达目标时即使未满提交窗口也强制提交最后一段', () => {
    const frame = stubFrameQueue();
    const setters = createSetters();
    const { result } = renderHook(() => useStreamReveal(false, setters));

    const target = 'c'.repeat(7_000);
    seedReveal(result, target, 6_900);
    act(() => {
      result.current.scheduleStreamReveal();
    });
    act(() => {
      frame.runFrame(1_000);
    });
    expect(setters.setStreamBuffer).toHaveBeenCalledTimes(1);

    // 模拟中间若干帧的推进：可见位置来到目标前 2 个字符。下一帧时间戳已越过
    // reveal 的节奏闸（12ms），但仍在 24ms 的**提交**窗口内——只能靠「到达目标」
    // 强制提交。
    result.current.streamRevealVisibleRef.current = target.slice(0, target.length - 2);
    result.current.streamRevealVisibleCodePointCountRef.current = target.length - 2;

    act(() => {
      frame.runFrame(1_020);
    });

    expect(setters.setStreamBuffer).toHaveBeenCalledTimes(2);
    expect(setters.setStreamBuffer).toHaveBeenLastCalledWith(target);
    expect(result.current.streamRevealVisibleCodePointCountRef.current).toBe(target.length);
  });

  it('reset 后降频基线归零', () => {
    const frame = stubFrameQueue();
    const setters = createSetters();
    const { result } = renderHook(() => useStreamReveal(false, setters));

    seedReveal(result, 'd'.repeat(20_000), 6_999);
    act(() => {
      result.current.scheduleStreamReveal();
    });
    act(() => {
      frame.runFrame(5_000);
    });
    expect(setters.setStreamBuffer).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.resetStreamState();
    });
    const callsAfterReset = vi.mocked(setters.setStreamBuffer).mock.calls.length;

    seedReveal(result, 'e'.repeat(20_000), 6_999);
    act(() => {
      result.current.scheduleStreamReveal();
    });
    // 基线归零后，第一帧（即便时间戳只比上次大 1ms）也能立即提交。
    act(() => {
      frame.runFrame(5_001);
    });
    expect(vi.mocked(setters.setStreamBuffer).mock.calls.length).toBe(callsAfterReset + 1);
  });
});
