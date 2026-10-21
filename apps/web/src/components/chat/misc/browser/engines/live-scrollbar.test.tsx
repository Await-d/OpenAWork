// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserLiveEnvelope } from '@openAwork/shared';
import { LiveScrollbar, ScrollbarTrack } from './live-scrollbar.js';
import type { BrowserLiveSession } from '../hooks/use-browser-live-session.js';

const METRICS = {
  scrollY: 0,
  maxScrollY: 300,
  viewportHeight: 100,
  contentHeight: 400,
};

/** jsdom 不做布局：把轨道固定成 300px 高，thumb 比例才有确定值。 */
function stubTrackRect(height: number, width = 10): void {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: width,
    bottom: height,
    width,
    height,
    toJSON: () => ({}),
  } as DOMRect);
}

interface SessionHarness {
  session: BrowserLiveSession;
  emit: (envelope: BrowserLiveEnvelope) => void;
}

function createSessionHarness(): SessionHarness {
  const listeners = new Set<(envelope: BrowserLiveEnvelope) => void>();
  return {
    emit: (envelope) => {
      for (const listener of [...listeners]) listener(envelope);
    },
    session: {
      availability: null,
      phase: 'connected',
      lastError: null,
      unavailableHint: null,
      send: () => undefined,
      screenshot: () => Promise.resolve(null),
      close: () => undefined,
      recheckAvailability: () => undefined,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('ScrollbarTrack', () => {
  it('thumb 高度按视口 / 内容比例计算', () => {
    stubTrackRect(300);
    render(<ScrollbarTrack metrics={METRICS} onScrollTo={vi.fn()} onScrubEnd={vi.fn()} />);

    const thumb = screen.getByTestId('cdp-live-scrollbar-thumb');
    expect(thumb.style.height).toBe('75px');
    expect(thumb.style.top).toBe('0px');
  });

  it('拖动 thumb 按比例换算 scrollTo，松手请求权威指标', () => {
    stubTrackRect(300);
    const onScrollTo = vi.fn();
    const onScrubEnd = vi.fn();
    render(<ScrollbarTrack metrics={METRICS} onScrollTo={onScrollTo} onScrubEnd={onScrubEnd} />);

    const track = screen.getByRole('scrollbar');
    const thumb = screen.getByTestId('cdp-live-scrollbar-thumb');

    fireEvent.pointerDown(thumb, { pointerId: 1, clientY: 100 });
    // 可拖动距离 = 300 - 75 = 225；下移 112.5 正好对应一半 → 滚动一半。
    fireEvent.pointerMove(track, { pointerId: 1, clientY: 212.5 });

    expect(onScrollTo).toHaveBeenLastCalledWith(150);

    fireEvent.pointerUp(track, { pointerId: 1 });
    expect(onScrubEnd).toHaveBeenCalledTimes(1);
  });

  it('拖拽上行按 50ms 合并，松手前补发最后位置', () => {
    vi.useFakeTimers();
    stubTrackRect(300);
    const onScrollTo = vi.fn();
    const onScrubEnd = vi.fn();
    render(<ScrollbarTrack metrics={METRICS} onScrollTo={onScrollTo} onScrubEnd={onScrubEnd} />);

    const track = screen.getByRole('scrollbar');
    const thumb = screen.getByTestId('cdp-live-scrollbar-thumb');

    fireEvent.pointerDown(thumb, { pointerId: 1, clientY: 0 });
    // 首条立即下发；窗口内的第二条只记账。
    fireEvent.pointerMove(track, { pointerId: 1, clientY: 22.5 });
    fireEvent.pointerMove(track, { pointerId: 1, clientY: 45 });
    expect(onScrollTo).toHaveBeenCalledTimes(1);
    expect(onScrollTo).toHaveBeenLastCalledWith(30);

    // 松手必须把最后位置补出去，否则远端停在倒数第二个节流点。
    fireEvent.pointerUp(track, { pointerId: 1 });
    expect(onScrollTo).toHaveBeenLastCalledWith(60);
    expect(onScrubEnd).toHaveBeenCalledTimes(1);
  });

  it('点击轨道按指针位置跳转', () => {
    stubTrackRect(300);
    const onScrollTo = vi.fn();
    render(<ScrollbarTrack metrics={METRICS} onScrollTo={onScrollTo} onScrubEnd={vi.fn()} />);

    fireEvent.pointerDown(screen.getByRole('scrollbar'), { pointerId: 1, clientY: 225 });

    expect(onScrollTo).toHaveBeenLastCalledWith(250);
  });

  it('键盘方向键 / End 可操作', () => {
    stubTrackRect(300);
    const onScrollTo = vi.fn();
    render(<ScrollbarTrack metrics={METRICS} onScrollTo={onScrollTo} onScrubEnd={vi.fn()} />);

    const track = screen.getByRole('scrollbar');
    fireEvent.keyDown(track, { key: 'ArrowDown' });
    expect(onScrollTo).toHaveBeenLastCalledWith(40);

    fireEvent.keyDown(track, { key: 'End' });
    expect(onScrollTo).toHaveBeenLastCalledWith(300);
  });

  it('拖动时鼠标事件不冒泡给实时画面（否则会顺带在远端页面划选）', () => {
    stubTrackRect(300);
    const onSurfaceMouseDown = vi.fn();
    render(
      <div onMouseDown={onSurfaceMouseDown}>
        <ScrollbarTrack metrics={METRICS} onScrollTo={vi.fn()} onScrubEnd={vi.fn()} />
      </div>,
    );

    fireEvent.mouseDown(screen.getByTestId('cdp-live-scrollbar-thumb'));

    expect(onSurfaceMouseDown).not.toHaveBeenCalled();
  });
});

describe('LiveScrollbar（接入实时通道）', () => {
  it('收到可滚动指标后出现，页面不可滚动时不渲染', () => {
    const harness = createSessionHarness();
    const view = render(
      <LiveScrollbar session={harness.session} enabled resetKey="tab:a" onScrollTo={vi.fn()} />,
    );

    expect(screen.queryByRole('scrollbar')).toBeNull();

    act(() => {
      harness.emit({
        ch: 'scroll',
        seq: 1,
        ts: 0,
        payload: { scrollY: 0, maxScrollY: 0, viewportHeight: 300, contentHeight: 300 },
      });
    });
    expect(screen.queryByRole('scrollbar')).toBeNull();

    act(() => {
      harness.emit({
        ch: 'scroll',
        seq: 2,
        ts: 0,
        payload: { scrollY: 0, maxScrollY: 600, viewportHeight: 300, contentHeight: 900 },
      });
    });
    expect(screen.getByRole('scrollbar')).not.toBeNull();

    view.unmount();
  });
});
