// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SCROLL_TOUCH_INTENT_THRESHOLD_PX } from './scroll-follow-state.js';
import { useScrollIntent } from './use-scroll-intent.js';

const activeRegions: HTMLElement[] = [];

class MockResizeObserver implements ResizeObserver {
  observe(): void {
    return undefined;
  }

  unobserve(): void {
    return undefined;
  }

  disconnect(): void {
    return undefined;
  }
}

function createScrollRegion(): HTMLDivElement {
  const region = document.createElement('div');
  // jsdom 默认 scrollHeight === clientHeight === 0，会被「不可滚动」守卫判为
  // 无位移空间而忽略 leave 意图；这里给出真实的可滚动几何。
  Object.defineProperty(region, 'clientHeight', { configurable: true, value: 400 });
  Object.defineProperty(region, 'scrollHeight', { configurable: true, value: 1000 });
  document.body.appendChild(region);
  activeRegions.push(region);
  return region;
}

function dispatchTouch(target: HTMLElement, type: 'touchstart' | 'touchmove', clientY: number) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'touches', { value: [{ clientY }] });
  target.dispatchEvent(event);
}

function wheelUp(target: HTMLElement): void {
  target.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -120 }));
}

beforeEach(() => {
  let frameId = 0;
  vi.stubGlobal('ResizeObserver', MockResizeObserver);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frameId += 1;
    callback(0);
    return frameId;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});

afterEach(() => {
  cleanup();
  for (const region of activeRegions) region.remove();
  activeRegions.length = 0;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useScrollIntent', () => {
  it('滚动区域内的 wheel 上滑触发 leave-latest', () => {
    const region = createScrollRegion();
    const onIntentApplied = vi.fn();
    const { result } = renderHook(() =>
      useScrollIntent({ scrollRegionRef: { current: region }, onIntentApplied }),
    );

    act(() => {
      wheelUp(region);
    });

    expect(onIntentApplied).toHaveBeenCalledTimes(1);
    expect(onIntentApplied).toHaveBeenCalledWith(true);
    expect(result.current.userInterruptedRef.current).toBe(true);
  });

  it('向下滚动（seek-latest）不改变跟随标志，也不暴露位置裁决', () => {
    const region = createScrollRegion();
    const onIntentApplied = vi.fn();
    const { result } = renderHook(() =>
      useScrollIntent({ scrollRegionRef: { current: region }, onIntentApplied }),
    );

    // 意图路径不读取位置：下滑（seek-latest）既不挂起也不恢复
    act(() => {
      region.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 120 }));
    });
    expect(onIntentApplied).not.toHaveBeenCalled();
    expect(result.current.userInterruptedRef.current).toBe(false);

    // leave 之后的 seek 也不会自行恢复——位置路径才是唯一裁决者
    act(() => {
      wheelUp(region);
    });
    expect(result.current.userInterruptedRef.current).toBe(true);
    act(() => {
      region.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 120 }));
    });
    expect(onIntentApplied).toHaveBeenCalledTimes(1);
    expect(result.current.userInterruptedRef.current).toBe(true);

    // atLatestRef 已随两态模型删除：意图层不再持有位置状态
    expect('atLatestRef' in result.current).toBe(false);
  });

  it('向下滚动（seek-latest）只触发 onSeekLatest 回调，不做位置裁决', () => {
    const region = createScrollRegion();
    const onIntentApplied = vi.fn();
    const onSeekLatest = vi.fn();
    const { result } = renderHook(() =>
      useScrollIntent({ scrollRegionRef: { current: region }, onIntentApplied, onSeekLatest }),
    );

    // 上滑（leave-latest）只走挂起路径，不触发 onSeekLatest
    act(() => {
      wheelUp(region);
    });
    expect(onSeekLatest).not.toHaveBeenCalled();
    expect(result.current.userInterruptedRef.current).toBe(true);

    // 下滑（seek-latest）触发 onSeekLatest，且不改动跟随标志——位置裁决在 manager
    act(() => {
      region.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 120 }));
    });
    expect(onSeekLatest).toHaveBeenCalledTimes(1);
    expect(onIntentApplied).toHaveBeenCalledTimes(1);
    expect(result.current.userInterruptedRef.current).toBe(true);
  });

  it('滚动区域外的 wheel 不触发意图', () => {
    const region = createScrollRegion();
    const onIntentApplied = vi.fn();
    const { result } = renderHook(() =>
      useScrollIntent({ scrollRegionRef: { current: region }, onIntentApplied }),
    );

    act(() => {
      wheelUp(document.body);
    });

    expect(onIntentApplied).not.toHaveBeenCalled();
    expect(result.current.userInterruptedRef.current).toBe(false);
  });

  it('touchmove 位移不足阈值时不触发意图，超过阈值才触发', () => {
    const region = createScrollRegion();
    const onIntentApplied = vi.fn();
    const { result } = renderHook(() =>
      useScrollIntent({ scrollRegionRef: { current: region }, onIntentApplied }),
    );
    const startY = 600;

    act(() => {
      dispatchTouch(region, 'touchstart', startY);
      dispatchTouch(region, 'touchmove', startY + SCROLL_TOUCH_INTENT_THRESHOLD_PX - 1);
    });
    expect(onIntentApplied).not.toHaveBeenCalled();
    expect(result.current.userInterruptedRef.current).toBe(false);

    act(() => {
      dispatchTouch(region, 'touchmove', startY + SCROLL_TOUCH_INTENT_THRESHOLD_PX);
    });
    expect(onIntentApplied).not.toHaveBeenCalled();
    expect(result.current.userInterruptedRef.current).toBe(false);

    act(() => {
      dispatchTouch(region, 'touchmove', startY + SCROLL_TOUCH_INTENT_THRESHOLD_PX + 1);
    });
    expect(onIntentApplied).toHaveBeenCalledTimes(1);
    expect(onIntentApplied).toHaveBeenCalledWith(true);
    expect(result.current.userInterruptedRef.current).toBe(true);
  });

  it('键盘 PageUp 在无元素聚焦时触发 leave-latest，在输入框聚焦时不触发', () => {
    const region = createScrollRegion();
    const onIntentApplied = vi.fn();
    const { result } = renderHook(() =>
      useScrollIntent({ scrollRegionRef: { current: region }, onIntentApplied }),
    );
    const composer = document.createElement('textarea');
    document.body.appendChild(composer);
    composer.focus();

    act(() => {
      composer.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'PageUp' }));
    });
    expect(onIntentApplied).not.toHaveBeenCalled();
    expect(result.current.userInterruptedRef.current).toBe(false);

    composer.blur();
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'PageUp' }));
    });
    expect(onIntentApplied).toHaveBeenCalledTimes(1);
    expect(onIntentApplied).toHaveBeenCalledWith(true);
    expect(result.current.userInterruptedRef.current).toBe(true);

    composer.remove();
  });

  it('markUserReturned 清除中断并在原本未中断时保持静默', () => {
    const region = createScrollRegion();
    const onIntentApplied = vi.fn();
    const { result } = renderHook(() =>
      useScrollIntent({ scrollRegionRef: { current: region }, onIntentApplied }),
    );

    act(() => {
      result.current.markUserReturned();
    });
    expect(onIntentApplied).not.toHaveBeenCalled();
    expect(result.current.userInterruptedRef.current).toBe(false);

    act(() => {
      wheelUp(region);
    });
    expect(onIntentApplied).toHaveBeenCalledTimes(1);
    expect(result.current.userInterruptedRef.current).toBe(true);

    act(() => {
      result.current.markUserReturned();
    });
    expect(onIntentApplied).toHaveBeenCalledTimes(2);
    expect(onIntentApplied).toHaveBeenLastCalledWith(false);
    expect(result.current.userInterruptedRef.current).toBe(false);
  });

  it('卸载后监听器被移除', () => {
    const region = createScrollRegion();
    const onIntentApplied = vi.fn();
    const view = renderHook(() =>
      useScrollIntent({ scrollRegionRef: { current: region }, onIntentApplied }),
    );

    act(() => {
      wheelUp(region);
    });
    expect(onIntentApplied).toHaveBeenCalledTimes(1);

    view.unmount();
    onIntentApplied.mockClear();

    act(() => {
      wheelUp(region);
      document.body.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'PageUp' }));
      dispatchTouch(region, 'touchstart', 600);
      dispatchTouch(region, 'touchmove', 700);
    });

    expect(onIntentApplied).not.toHaveBeenCalled();
  });

  it('enabled=false 时不挂监听', () => {
    const region = createScrollRegion();
    const onIntentApplied = vi.fn();
    const { result } = renderHook(() =>
      useScrollIntent({
        scrollRegionRef: { current: region },
        enabled: false,
        onIntentApplied,
      }),
    );

    act(() => {
      wheelUp(region);
      document.body.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'PageUp' }));
      dispatchTouch(region, 'touchstart', 600);
      dispatchTouch(region, 'touchmove', 700);
    });

    expect(onIntentApplied).not.toHaveBeenCalled();
    expect(result.current.userInterruptedRef.current).toBe(false);
  });
});
