// @vitest-environment jsdom
/**
 * CDP 实时引擎的拾取行为覆盖。
 *
 * 钉住三件容易悄悄坏掉的事：拾取点击只发一条 `pick`（不夹带 `input`）、结果在
 * 宿主解除武装之后仍能到达输入框、Esc 取消拾取且不注入远端。
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserLiveEnvelope, BrowserLiveNodePayload } from '@openAwork/shared';

import { COMPOSER_INSERT_EVENT } from '../browser-clipboard.js';
import { DEFAULT_DEVICE_PRESET_ID, resolveDevicePreset } from '../device-presets.js';
import type {
  BrowserLivePhase,
  BrowserLiveSession,
} from '../hooks/use-browser-live-session.js';
import {
  CdpLiveEngine,
  computeFrameLayout,
  DEVICE_SYNC_DEBOUNCE_MS,
  FALLBACK_FRAME_MAX_SIZE,
  toDevicePoint,
} from './cdp-live-engine.js';

afterEach(() => {
  cleanup();
});

interface SessionHarness {
  session: BrowserLiveSession;
  sent: Array<Record<string, unknown>>;
  emit: (envelope: BrowserLiveEnvelope) => void;
}

function createSessionHarness(): SessionHarness {
  const sent: Array<Record<string, unknown>> = [];
  const listeners = new Set<(envelope: BrowserLiveEnvelope) => void>();

  return {
    sent,
    emit: (envelope) => {
      for (const listener of [...listeners]) listener(envelope);
    },
    session: {
      availability: null,
      phase: 'connected',
      lastError: null,
      unavailableHint: null,
      send: (message) => {
        sent.push(message as unknown as Record<string, unknown>);
      },
      screenshot: () => Promise.resolve(null),
      close: () => undefined,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
  };
}

const FRAME_ENVELOPE: BrowserLiveEnvelope = {
  ch: 'frame',
  seq: 1,
  ts: 0,
  payload: {
    mimeType: 'image/jpeg',
    data: 'ZmFrZQ==',
    deviceWidth: 200,
    deviceHeight: 100,
    offsetTop: 0,
    pageScaleFactor: 1,
    scrollOffsetX: 0,
    scrollOffsetY: 0,
    frameSessionId: 11,
  },
};

function nodeEnvelope(payload: Partial<BrowserLiveNodePayload> = {}): BrowserLiveEnvelope {
  return {
    ch: 'node',
    seq: 2,
    ts: 0,
    payload: {
      selector: '#submit-btn',
      nodeName: 'BUTTON',
      attributes: { 'data-testid': 'submit' },
      text: '提交',
      computedStyles: { display: 'inline-flex' },
      selectorStrategy: 'id',
      selectorUnique: true,
      ...payload,
    },
  };
}

/** 内容盒之外的点击会被吞掉，测试里必须给出非零的容器尺寸。 */
function stubRect(element: Element, width: number, height: number): void {
  element.getBoundingClientRect = (): DOMRect =>
    ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: width,
      bottom: height,
      width,
      height,
      toJSON: () => ({}),
    }) as DOMRect;
}

interface EngineOverrides {
  pickArmed?: boolean;
  onPickConsumed?: () => void;
  onPickCancel?: () => void;
  devicePresetId?: string;
  zoom?: number;
}

/** 帧尺寸 200×100 放进 100×100 的容器：点击像素中心应换算成设备坐标 (100, 50)。 */
function armSurface(harness: SessionHarness, overrides: EngineOverrides = {}) {
  const view = render(
    <CdpLiveEngine
      session={harness.session}
      url="about:blank"
      hidden={false}
      pickArmed={overrides.pickArmed ?? true}
      onPickConsumed={overrides.onPickConsumed ?? (() => undefined)}
      onPickCancel={overrides.onPickCancel ?? (() => undefined)}
      refreshKey={0}
      devicePresetId={overrides.devicePresetId ?? DEFAULT_DEVICE_PRESET_ID}
      zoom={overrides.zoom ?? 1}
    />,
  );

  act(() => harness.emit(FRAME_ENVELOPE));
  const surface = screen.getByLabelText('浏览器实时预览');
  stubRect(surface, 100, 100);
  return { view, surface };
}

function countMessages(
  harness: SessionHarness,
  channel: string,
  action?: string,
): Array<Record<string, unknown>> {
  return harness.sent.filter(
    (message) =>
      message['ch'] === channel && (action === undefined || message['action'] === action),
  );
}

describe('CdpLiveEngine 元素拾取', () => {
  it('拾取模式下点击只发一条 pick（设备坐标），不再注入鼠标输入', () => {
    const harness = createSessionHarness();
    const onPickConsumed = vi.fn();
    const { surface } = armSurface(harness, { onPickConsumed });

    fireEvent.mouseDown(surface, { clientX: 50, clientY: 50 });
    fireEvent.mouseUp(surface, { clientX: 50, clientY: 50 });

    // 容器 100×100，帧 200×100：像素中心 → 设备坐标 (100, 50)。
    expect(countMessages(harness, 'control', 'pick')).toEqual([
      { ch: 'control', action: 'pick', x: 100, y: 50 },
    ]);
    expect(countMessages(harness, 'input')).toHaveLength(0);
    expect(onPickConsumed).toHaveBeenCalledTimes(1);
  });

  it('宿主解除武装之后，node 结果仍插入输入框并给出成功反馈', () => {
    const harness = createSessionHarness();
    const onPickConsumed = vi.fn();
    const onPickCancel = vi.fn();
    const inserted: string[] = [];
    const listener = (event: Event): void => {
      inserted.push((event as CustomEvent<{ text: string }>).detail.text);
    };
    window.addEventListener(COMPOSER_INSERT_EVENT, listener);

    try {
      const baseProps = {
        session: harness.session,
        url: 'about:blank',
        hidden: false,
        onPickConsumed,
        onPickCancel,
        refreshKey: 0,
        devicePresetId: DEFAULT_DEVICE_PRESET_ID,
        zoom: 1,
      };
      const view = render(<CdpLiveEngine {...baseProps} pickArmed />);

      act(() => harness.emit(FRAME_ENVELOPE));
      const surface = screen.getByLabelText('浏览器实时预览');
      stubRect(surface, 100, 100);
      fireEvent.mouseUp(surface, { clientX: 50, clientY: 50 });

      // 真实宿主在请求发出后立刻解除武装；结果此时才开始回程。
      view.rerender(<CdpLiveEngine {...baseProps} pickArmed={false} />);

      act(() => harness.emit(nodeEnvelope()));

      expect(inserted).toHaveLength(1);
      expect(inserted[0]).toContain('#submit-btn');
      expect(inserted[0]).toContain('- 选择器来源：`id`');

      const toast = screen.getByRole('status');
      expect(toast.textContent).toContain('已引用元素到输入框');
      expect(toast.textContent).toContain('#submit-btn');
    } finally {
      window.removeEventListener(COMPOSER_INSERT_EVENT, listener);
    }
  });

  it('selectorUnique === false 时反馈降级为不确定性提示', () => {
    const harness = createSessionHarness();
    const inserted: string[] = [];
    const listener = (event: Event): void => {
      inserted.push((event as CustomEvent<{ text: string }>).detail.text);
    };
    window.addEventListener(COMPOSER_INSERT_EVENT, listener);

    try {
      const baseProps = {
        session: harness.session,
        url: 'about:blank',
        hidden: false,
        onPickConsumed: () => undefined,
        onPickCancel: () => undefined,
        refreshKey: 0,
        devicePresetId: DEFAULT_DEVICE_PRESET_ID,
        zoom: 1,
      };
      const view = render(<CdpLiveEngine {...baseProps} pickArmed />);

      act(() => harness.emit(FRAME_ENVELOPE));
      const surface = screen.getByLabelText('浏览器实时预览');
      stubRect(surface, 100, 100);
      fireEvent.mouseUp(surface, { clientX: 50, clientY: 50 });

      view.rerender(<CdpLiveEngine {...baseProps} pickArmed={false} />);

      act(() => harness.emit(nodeEnvelope({ selector: 'button.btn', selectorUnique: false })));

      expect(inserted[0]).toContain('不唯一');
      const toast = screen.getByRole('status');
      expect(toast.textContent).toContain('可能不唯一');
      expect(toast.textContent).toContain('button.btn');
    } finally {
      window.removeEventListener(COMPOSER_INSERT_EVENT, listener);
    }
  });

  it('styles 意图下拾取下发 node.styles、上报坐标且不写输入框', () => {
    const harness = createSessionHarness();
    const onPickConsumed = vi.fn();
    const onPickPoint = vi.fn();
    const inserted: string[] = [];
    const listener = (event: Event): void => {
      inserted.push((event as CustomEvent<{ text: string }>).detail.text);
    };
    window.addEventListener(COMPOSER_INSERT_EVENT, listener);

    try {
      const baseProps = {
        session: harness.session,
        url: 'about:blank',
        hidden: false,
        onPickConsumed,
        onPickCancel: () => undefined,
        pickIntent: 'styles' as const,
        onPickPoint,
        refreshKey: 0,
        devicePresetId: DEFAULT_DEVICE_PRESET_ID,
        zoom: 1,
      };
      const view = render(<CdpLiveEngine {...baseProps} pickArmed />);

      expect(screen.getByRole('status').textContent).toContain('读取完整样式');

      act(() => harness.emit(FRAME_ENVELOPE));
      const surface = screen.getByLabelText('浏览器实时预览');
      stubRect(surface, 100, 100);
      fireEvent.mouseUp(surface, { clientX: 50, clientY: 50 });

      expect(countMessages(harness, 'control', 'node.styles')).toEqual([
        { ch: 'control', action: 'node.styles', x: 100, y: 50 },
      ]);
      expect(countMessages(harness, 'control', 'pick')).toHaveLength(0);
      expect(countMessages(harness, 'input')).toHaveLength(0);
      expect(onPickPoint).toHaveBeenCalledWith({ x: 100, y: 50 });
      expect(onPickConsumed).toHaveBeenCalledTimes(1);

      // 结果回包带 fullComputedStyles：检查器自取（经 session 订阅），composer 不受影响。
      view.rerender(<CdpLiveEngine {...baseProps} pickArmed={false} />);
      act(() => harness.emit(nodeEnvelope()));
      expect(inserted).toHaveLength(0);
    } finally {
      window.removeEventListener(COMPOSER_INSERT_EVENT, listener);
    }
  });

  it('Esc 取消拾取且不注入按键，重新武装后依然有效', () => {
    const harness = createSessionHarness();
    const onPickCancel = vi.fn();
    const baseProps = {
      session: harness.session,
      url: 'about:blank',
      hidden: false,
      onPickConsumed: vi.fn(),
      onPickCancel,
      refreshKey: 0,
      devicePresetId: DEFAULT_DEVICE_PRESET_ID,
      zoom: 1,
    };
    const view = render(<CdpLiveEngine {...baseProps} pickArmed />);

    const surface = screen.getByLabelText('浏览器实时预览');
    fireEvent.keyDown(surface, { key: 'a' });

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
    });

    expect(onPickCancel).toHaveBeenCalledTimes(1);
    expect(countMessages(harness, 'input')).toHaveLength(0);

    view.rerender(<CdpLiveEngine {...baseProps} pickArmed={false} />);
    view.rerender(<CdpLiveEngine {...baseProps} pickArmed />);

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
    });

    expect(onPickCancel).toHaveBeenCalledTimes(2);
  });
});

describe('CdpLiveEngine 会话相位', () => {
  function phaseProps(harness: SessionHarness) {
    return {
      session: harness.session,
      url: 'https://example.test/start',
      hidden: false,
      pickArmed: false,
      onPickConsumed: () => undefined,
      onPickCancel: () => undefined,
      refreshKey: 0,
      devicePresetId: DEFAULT_DEVICE_PRESET_ID,
      zoom: 1,
    };
  }

  /** 用同一 harness 的 session 派生新相位引用：组件以 props 感知相位变化。 */
  function withPhase(harness: SessionHarness, phase: BrowserLivePhase): BrowserLiveSession {
    return { ...harness.session, phase };
  }

  it('idle → connected 之后才请求 screencast.start，且同一连接段只请求一次', () => {
    const harness = createSessionHarness();
    const props = phaseProps(harness);
    const view = render(<CdpLiveEngine {...props} session={withPhase(harness, 'idle')} />);

    view.rerender(<CdpLiveEngine {...props} session={withPhase(harness, 'connecting')} />);
    expect(countMessages(harness, 'control', 'screencast.start')).toHaveLength(0);

    view.rerender(<CdpLiveEngine {...props} session={withPhase(harness, 'connected')} />);
    expect(countMessages(harness, 'control', 'screencast.start')).toEqual([
      { ch: 'control', action: 'screencast.start' },
    ]);

    view.rerender(<CdpLiveEngine {...props} session={withPhase(harness, 'connected')} />);
    expect(countMessages(harness, 'control', 'screencast.start')).toHaveLength(1);
  });

  it('重连（connected → reconnecting → connected）后重新请求 screencast.start', () => {
    const harness = createSessionHarness();
    const props = phaseProps(harness);
    const view = render(<CdpLiveEngine {...props} session={withPhase(harness, 'connected')} />);
    expect(countMessages(harness, 'control', 'screencast.start')).toHaveLength(1);

    view.rerender(<CdpLiveEngine {...props} session={withPhase(harness, 'reconnecting')} />);
    view.rerender(<CdpLiveEngine {...props} session={withPhase(harness, 'connected')} />);

    expect(countMessages(harness, 'control', 'screencast.start')).toHaveLength(2);
  });

  it('卸载时下发 screencast.stop', () => {
    const harness = createSessionHarness();
    const view = render(<CdpLiveEngine {...phaseProps(harness)} />);

    view.unmount();

    expect(countMessages(harness, 'control', 'screencast.stop')).toEqual([
      { ch: 'control', action: 'screencast.stop' },
    ]);
  });

  it('navigate 每个 URL 只发一次，URL 变化后重新导航，非 http(s) 不下发', () => {
    const harness = createSessionHarness();
    const props = phaseProps(harness);
    const view = render(<CdpLiveEngine {...props} url="about:blank" />);
    expect(countMessages(harness, 'control', 'navigate')).toHaveLength(0);

    view.rerender(<CdpLiveEngine {...props} url="https://example.test/a" />);
    view.rerender(<CdpLiveEngine {...props} url="https://example.test/a" />);
    expect(countMessages(harness, 'control', 'navigate')).toEqual([
      { ch: 'control', action: 'navigate', url: 'https://example.test/a' },
    ]);

    view.rerender(<CdpLiveEngine {...props} url="https://example.test/b" />);
    expect(countMessages(harness, 'control', 'navigate')).toEqual([
      { ch: 'control', action: 'navigate', url: 'https://example.test/a' },
      { ch: 'control', action: 'navigate', url: 'https://example.test/b' },
    ]);
  });
});

/** jsdom 没有 ResizeObserver：装一个可手动触发的替身。 */
function installResizeObserverStub(): { trigger: () => void } {
  const callbacks: ResizeObserverCallback[] = [];
  class TestResizeObserver {
    constructor(callback: ResizeObserverCallback) {
      callbacks.push(callback);
    }
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
  vi.stubGlobal('ResizeObserver', TestResizeObserver);
  return {
    trigger: () => {
      for (const callback of callbacks) callback([], {} as ResizeObserver);
    },
  };
}

describe('CdpLiveEngine 缩放坐标', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('toDevicePoint 在非 1 缩放档位下按 zoom 反算设备坐标', () => {
    const container = { left: 0, top: 0, width: 100, height: 100 };
    const frame = { deviceWidth: 200, deviceHeight: 100 };

    expect(toDevicePoint({ container, frame, clientX: 25, clientY: 50, zoom: 1 })).toEqual({
      x: 50,
      y: 50,
    });
    // 放大 200%：同一个物理点击对应的设备坐标翻倍偏移（25 → 75）。
    expect(toDevicePoint({ container, frame, clientX: 25, clientY: 50, zoom: 2 })).toEqual({
      x: 75,
      y: 50,
    });
    // 缩小 50%：画面只占 50×25，画面之外的点击（letterbox）必须被吞掉。
    expect(toDevicePoint({ container, frame, clientX: 50, clientY: 50, zoom: 0.5 })).toEqual({
      x: 100,
      y: 50,
    });
    expect(toDevicePoint({ container, frame, clientX: 30, clientY: 30, zoom: 0.5 })).toBeNull();
  });

  it('缩放 200% 时拾取点击按 zoom 反算，且画面套用 CSS scale', () => {
    const resizeObserver = installResizeObserverStub();
    const harness = createSessionHarness();
    const { surface } = armSurface(harness, { pickArmed: true, zoom: 2 });

    // jsdom 里 mount 时量到的是 0×0，触发一次测量才会真正渲染画面。
    act(() => {
      resizeObserver.trigger();
    });

    fireEvent.mouseDown(surface, { clientX: 25, clientY: 50 });
    fireEvent.mouseUp(surface, { clientX: 25, clientY: 50 });

    expect(countMessages(harness, 'control', 'pick')).toEqual([
      { ch: 'control', action: 'pick', x: 75, y: 50 },
    ]);
    expect(screen.getByTestId('cdp-live-frame').style.transform).toBe('scale(2)');
  });
});

describe('computeFrameLayout 退化盒子兜底', () => {
  const frame = { deviceWidth: 200, deviceHeight: 100 };

  it('正常盒子按等比缩放放进可用空间', () => {
    expect(computeFrameLayout({ width: 100, height: 100 }, frame)).toEqual({
      width: 100,
      height: 50,
    });
    expect(computeFrameLayout({ width: 400, height: 400 }, frame)).toEqual({
      width: 400,
      height: 200,
    });
  });

  it('0 高 / 0 宽 / 未测量时回退到帧自身设备尺寸，而不是返回 null', () => {
    expect(computeFrameLayout({ width: 520, height: 0 }, frame)).toEqual({ width: 200, height: 100 });
    expect(computeFrameLayout({ width: 0, height: 320 }, frame)).toEqual({ width: 200, height: 100 });
    expect(computeFrameLayout({ width: 0, height: 0 }, frame)).toEqual({ width: 200, height: 100 });
    expect(computeFrameLayout(null, frame)).toEqual({ width: 200, height: 100 });
    expect(computeFrameLayout(undefined, frame)).toEqual({ width: 200, height: 100 });
  });

  it('兜底尺寸把最长边裁剪到上限并保持比例', () => {
    expect(computeFrameLayout({ width: 0, height: 0 }, { deviceWidth: 4096, deviceHeight: 2048 })).toEqual({
      width: FALLBACK_FRAME_MAX_SIZE,
      height: FALLBACK_FRAME_MAX_SIZE / 2,
    });
  });

  it('不变式：设备尺寸有效 ⇒ 任意（含退化）盒子都得到非 null 布局', () => {
    const boxes: ReadonlyArray<{ width: number; height: number } | null | undefined> = [
      null,
      undefined,
      { width: 0, height: 0 },
      { width: 0, height: 320 },
      { width: 520, height: 0 },
      { width: Number.NaN, height: 320 },
      { width: 520, height: Number.NaN },
    ];
    for (const box of boxes) {
      expect(computeFrameLayout(box, { deviceWidth: 1, deviceHeight: 1 })).not.toBeNull();
    }
    expect(
      computeFrameLayout({ width: 0, height: 0 }, { deviceWidth: 0, deviceHeight: 0 }),
    ).toBeNull();
    expect(
      computeFrameLayout({ width: 0, height: 0 }, { deviceWidth: -10, deviceHeight: 100 }),
    ).toBeNull();
  });
});

describe('CdpLiveEngine 退化容器', () => {
  it('容器量到 0 高时仍渲染画面（jsdom 天然返回 0 rect，正是面板塌陷路径）', () => {
    const harness = createSessionHarness();
    render(
      <CdpLiveEngine
        session={harness.session}
        url="about:blank"
        hidden={false}
        pickArmed={false}
        onPickConsumed={() => undefined}
        onPickCancel={() => undefined}
        refreshKey={0}
        devicePresetId={DEFAULT_DEVICE_PRESET_ID}
        zoom={1}
      />,
    );

    act(() => harness.emit(FRAME_ENVELOPE));

    expect(screen.queryByTestId('cdp-live-frame')).not.toBeNull();
    const img = screen.getByTestId('cdp-live-frame');
    expect(img.style.width).toBe('200px');
    expect(img.style.height).toBe('100px');
  });
});

describe('CdpLiveEngine 设备同步', () => {
  function deviceProps(harness: SessionHarness, devicePresetId: string) {
    return {
      session: harness.session,
      url: 'about:blank',
      hidden: false,
      pickArmed: false,
      onPickConsumed: () => undefined,
      onPickCancel: () => undefined,
      refreshKey: 0,
      devicePresetId,
      zoom: 1,
    };
  }

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('固定预设下发预设视口与移动端 UA', () => {
    vi.useFakeTimers();
    const harness = createSessionHarness();

    render(<CdpLiveEngine {...deviceProps(harness, 'phone-375')} />);
    expect(countMessages(harness, 'device')).toHaveLength(0);

    act(() => {
      vi.advanceTimersByTime(DEVICE_SYNC_DEBOUNCE_MS);
    });

    const preset = resolveDevicePreset('phone-375');
    expect(preset?.userAgent).toMatch(/iPhone/);
    expect(countMessages(harness, 'device')).toEqual([
      {
        ch: 'device',
        width: 375,
        height: 812,
        deviceScaleFactor: 2,
        mobile: true,
        userAgent: preset?.userAgent,
      },
    ]);
  });

  it('自适应跟随面板尺寸，切回自适应时用空 UA 清除覆写', () => {
    vi.useFakeTimers();
    const resizeObserver = installResizeObserverStub();
    const harness = createSessionHarness();

    const view = render(<CdpLiveEngine {...deviceProps(harness, 'phone-375')} />);
    act(() => {
      vi.advanceTimersByTime(DEVICE_SYNC_DEBOUNCE_MS);
    });

    const surface = screen.getByLabelText('浏览器实时预览');
    stubRect(surface, 420, 360);
    act(() => {
      resizeObserver.trigger();
    });
    act(() => {
      vi.advanceTimersByTime(DEVICE_SYNC_DEBOUNCE_MS);
    });
    // 固定预设不关心面板尺寸：重发出去的目标依旧是 375×812。
    const fixedMessages = countMessages(harness, 'device');
    expect(fixedMessages.length).toBeGreaterThanOrEqual(1);
    for (const message of fixedMessages) {
      expect(message).toMatchObject({ width: 375, height: 812, mobile: true });
    }

    view.rerender(<CdpLiveEngine {...deviceProps(harness, DEFAULT_DEVICE_PRESET_ID)} />);
    act(() => {
      vi.advanceTimersByTime(DEVICE_SYNC_DEBOUNCE_MS);
    });

    const messages = countMessages(harness, 'device');
    expect(messages[messages.length - 1]).toEqual({
      ch: 'device',
      width: 420,
      height: 360,
      deviceScaleFactor: 1,
      mobile: false,
      userAgent: '',
    });
  });

  it('连续 resize 防抖成一条最终尺寸', () => {
    vi.useFakeTimers();
    const resizeObserver = installResizeObserverStub();
    const harness = createSessionHarness();

    render(<CdpLiveEngine {...deviceProps(harness, DEFAULT_DEVICE_PRESET_ID)} />);
    const surface = screen.getByLabelText('浏览器实时预览');

    stubRect(surface, 400, 300);
    act(() => {
      resizeObserver.trigger();
    });
    act(() => {
      vi.advanceTimersByTime(DEVICE_SYNC_DEBOUNCE_MS / 2);
    });

    stubRect(surface, 500, 400);
    act(() => {
      resizeObserver.trigger();
    });
    act(() => {
      vi.advanceTimersByTime(DEVICE_SYNC_DEBOUNCE_MS);
    });

    expect(countMessages(harness, 'device')).toEqual([
      { ch: 'device', width: 500, height: 400, deviceScaleFactor: 1, mobile: false },
    ]);
  });
});
