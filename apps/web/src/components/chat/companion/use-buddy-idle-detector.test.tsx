// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBuddyIdleDetector } from './use-buddy-idle-detector.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-04T08:00:00.000Z'));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useBuddyIdleDetector · 用户空闲检测', () => {
  it('Given 用户没有操作 When 时间推进 Then 返回空闲秒数', () => {
    const { result } = renderHook(() => useBuddyIdleDetector({ input: '' }));

    act(() => {
      vi.advanceTimersByTime(65_000);
    });

    expect(result.current).toBe(65);
  });

  it('Given 已经空闲 When 用户触发键盘事件 Then 空闲秒数归零后重新累计', () => {
    const { result } = renderHook(() => useBuddyIdleDetector({ input: '' }));

    act(() => {
      vi.advanceTimersByTime(42_000);
    });
    expect(result.current).toBe(42);

    act(() => {
      globalThis.window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    });
    expect(result.current).toBe(0);

    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(result.current).toBe(5);
  });

  it('Given 输入内容变化 When 重新渲染 Then 视为用户活动', () => {
    const { result, rerender } = renderHook((input: string) => useBuddyIdleDetector({ input }), {
      initialProps: '',
    });

    act(() => {
      vi.advanceTimersByTime(12_000);
    });
    expect(result.current).toBe(12);

    rerender('继续说明需求');

    expect(result.current).toBe(0);
  });
});
