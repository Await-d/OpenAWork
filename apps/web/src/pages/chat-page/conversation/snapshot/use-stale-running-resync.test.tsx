// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { RenderHookResult } from '@testing-library/react';

import {
  useStaleRunningResync,
  type StaleRunningResync,
  type UseStaleRunningResyncOptions,
} from './use-stale-running-resync.js';

afterEach(() => {
  cleanup();
});

function renderStaleHook(initialProps: UseStaleRunningResyncOptions): {
  hook: RenderHookResult<StaleRunningResync, UseStaleRunningResyncOptions>;
  rerenderWith: (next: Partial<UseStaleRunningResyncOptions>) => void;
} {
  const view = renderHook<StaleRunningResync, UseStaleRunningResyncOptions>(
    (props) => useStaleRunningResync(props),
    { initialProps },
  );

  return {
    hook: view,
    rerenderWith: (next) => {
      view.rerender({ ...initialProps, ...next });
    },
  };
}

describe('useStaleRunningResync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('running 且持续无活跃流超过阈值后才标记 stale', () => {
    const { hook } = renderStaleHook({
      hasActiveStream: false,
      isPageActive: true,
      onResync: vi.fn(),
      sessionId: 's1',
      status: 'running',
    });

    expect(hook.result.current.stale).toBe(false);

    act(() => {
      vi.advanceTimersByTime(59_000);
    });
    expect(hook.result.current.stale).toBe(false);

    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(hook.result.current.stale).toBe(true);
  });

  it('出现活跃流后不标记 stale，并复位已开始的计时', () => {
    const { hook, rerenderWith } = renderStaleHook({
      hasActiveStream: false,
      isPageActive: true,
      onResync: vi.fn(),
      sessionId: 's1',
      status: 'running',
    });

    act(() => {
      vi.advanceTimersByTime(59_000);
    });
    rerenderWith({ hasActiveStream: true });

    act(() => {
      vi.advanceTimersByTime(120_000);
    });
    expect(hook.result.current.stale).toBe(false);
  });

  it('paused 是等待用户交互的正常态，不参与判定', () => {
    const { hook } = renderStaleHook({
      hasActiveStream: false,
      isPageActive: true,
      onResync: vi.fn(),
      sessionId: 's1',
      status: 'paused',
    });

    act(() => {
      vi.advanceTimersByTime(180_000);
    });
    expect(hook.result.current.stale).toBe(false);
  });

  it('页面切后台时不累计计时', () => {
    const { hook, rerenderWith } = renderStaleHook({
      hasActiveStream: false,
      isPageActive: true,
      onResync: vi.fn(),
      sessionId: 's1',
      status: 'running',
    });

    rerenderWith({ isPageActive: false });
    act(() => {
      vi.advanceTimersByTime(180_000);
    });
    expect(hook.result.current.stale).toBe(false);

    // 回到前台重新起算，不会因为后台累计而立即 stale。
    rerenderWith({ isPageActive: true });
    act(() => {
      vi.advanceTimersByTime(59_000);
    });
    expect(hook.result.current.stale).toBe(false);
  });

  it('resync 调用 onResync 并复位 stale 与计时', async () => {
    const onResync = vi.fn(async () => undefined);
    const { hook } = renderStaleHook({
      hasActiveStream: false,
      isPageActive: true,
      onResync,
      sessionId: 's1',
      status: 'running',
    });

    act(() => {
      vi.advanceTimersByTime(61_000);
    });
    expect(hook.result.current.stale).toBe(true);

    await act(async () => {
      hook.result.current.resync();
    });
    expect(onResync).toHaveBeenCalledTimes(1);
    expect(hook.result.current.stale).toBe(false);

    // 重新计时：按钮不会秒级重现。
    act(() => {
      vi.advanceTimersByTime(59_000);
    });
    expect(hook.result.current.stale).toBe(false);
  });

  it('会话切换时复位 stale', () => {
    const { hook, rerenderWith } = renderStaleHook({
      hasActiveStream: false,
      isPageActive: true,
      onResync: vi.fn(),
      sessionId: 's1',
      status: 'running',
    });

    act(() => {
      vi.advanceTimersByTime(61_000);
    });
    expect(hook.result.current.stale).toBe(true);

    rerenderWith({ sessionId: 's2' });
    expect(hook.result.current.stale).toBe(false);
  });
});
