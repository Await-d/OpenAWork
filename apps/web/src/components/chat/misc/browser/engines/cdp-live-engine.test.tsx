// @vitest-environment jsdom
/**
 * CDP 实时引擎的拾取行为覆盖。
 *
 * 钉住三件容易悄悄坏掉的事：拾取点击只发一条 `pick`（不夹带 `input`）、结果在
 * 宿主解除武装之后仍能到达输入框、Esc 取消拾取且不注入远端。
 */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserLiveEnvelope, BrowserLiveNodePayload } from '@openAwork/shared';

import { COMPOSER_INSERT_EVENT } from '../browser-clipboard.js';
import { DEFAULT_DEVICE_PRESET_ID, resolveDevicePreset } from '../device-presets.js';
import type { BrowserLivePhase, BrowserLiveSession } from '../hooks/use-browser-live-session.js';
import {
  CdpLiveEngine,
  computeFrameLayout,
  DEVICE_SYNC_DEBOUNCE_MS,
  FALLBACK_FRAME_MAX_SIZE,
  resolveDisplayScale,
  resolveScreencastRequest,
  SCREENCAST_FRAME_EDGE_LIMIT,
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
  qualityPresetId?: string;
  zoom?: number;
}

/** 帧尺寸 200×100 放进 100×100 的容器：点击像素中心应换算成设备坐标 (100, 50)。 */
function armSurface(harness: SessionHarness, overrides: EngineOverrides = {}) {
  const view = render(
    <CdpLiveEngine
      session={harness.session}
      url="about:blank"
      tabId="tab-1"
      hidden={false}
      pickArmed={overrides.pickArmed ?? true}
      onPickConsumed={overrides.onPickConsumed ?? (() => undefined)}
      onPickCancel={overrides.onPickCancel ?? (() => undefined)}
      refreshKey={0}
      devicePresetId={overrides.devicePresetId ?? DEFAULT_DEVICE_PRESET_ID}
      qualityPresetId={overrides.qualityPresetId ?? 'smooth'}
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
        tabId: 'tab-1',
        refreshKey: 0,
        devicePresetId: DEFAULT_DEVICE_PRESET_ID,
        qualityPresetId: 'smooth',
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
        tabId: 'tab-1',
        refreshKey: 0,
        devicePresetId: DEFAULT_DEVICE_PRESET_ID,
        qualityPresetId: 'smooth',
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
        tabId: 'tab-1',
        refreshKey: 0,
        devicePresetId: DEFAULT_DEVICE_PRESET_ID,
        qualityPresetId: 'smooth',
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
      tabId: 'tab-1',
      refreshKey: 0,
      devicePresetId: DEFAULT_DEVICE_PRESET_ID,
      qualityPresetId: 'balanced',
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

describe('CdpLiveEngine 指针输入', () => {
  /** 只取 `mouseMoved`：按下 / 抬起不走合并。 */
  function mouseMoves(harness: SessionHarness): Array<Record<string, unknown>> {
    return harness.sent.filter(
      (message) => message['ch'] === 'input' && message['type'] === 'mouseMoved',
    );
  }

  it('同一帧内多次移动只下发最后一次坐标（按帧合并）', async () => {
    const harness = createSessionHarness();
    const { surface } = armSurface(harness, { pickArmed: false });

    // 容器 100×100、帧 200×100：内容盒是居中的 100×50（y ∈ [25, 75]）。
    fireEvent.mouseMove(surface, { clientX: 10, clientY: 50 });
    fireEvent.mouseMove(surface, { clientX: 20, clientY: 60 });

    await waitFor(() => {
      expect(mouseMoves(harness)).toHaveLength(1);
    });
    expect(mouseMoves(harness)[0]).toEqual({
      ch: 'input',
      kind: 'mouse',
      type: 'mouseMoved',
      x: 40,
      y: 70,
    });
  });

  it('坐标没变则不再下行（重复 mouseMoved 是纯噪声）', async () => {
    const harness = createSessionHarness();
    const { surface } = armSurface(harness, { pickArmed: false });

    fireEvent.mouseMove(surface, { clientX: 20, clientY: 60 });
    await waitFor(() => {
      expect(mouseMoves(harness)).toHaveLength(1);
    });

    fireEvent.mouseMove(surface, { clientX: 20, clientY: 60 });
    await act(async () => {
      await Promise.resolve();
    });
    // 再等一帧：仍不应有第二条。
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(mouseMoves(harness)).toHaveLength(1);
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
      tabId: 'tab-1',
      refreshKey: 0,
      devicePresetId: DEFAULT_DEVICE_PRESET_ID,
      qualityPresetId: 'smooth',
      zoom: 1,
    };
  }

  /** 用同一 harness 的 session 派生新相位引用：组件以 props 感知相位变化。 */
  function withPhase(harness: SessionHarness, phase: BrowserLivePhase): BrowserLiveSession {
    return { ...harness.session, phase };
  }

  afterEach(() => {
    Reflect.deleteProperty(document, 'visibilityState');
  });

  it('idle → connected 之后才请求 screencast.start，且同一连接段只请求一次', () => {
    const harness = createSessionHarness();
    const props = phaseProps(harness);
    const view = render(<CdpLiveEngine {...props} session={withPhase(harness, 'idle')} />);

    view.rerender(<CdpLiveEngine {...props} session={withPhase(harness, 'connecting')} />);
    expect(countMessages(harness, 'control', 'screencast.start')).toHaveLength(0);

    view.rerender(<CdpLiveEngine {...props} session={withPhase(harness, 'connected')} />);
    expect(countMessages(harness, 'control', 'screencast.start')).toEqual([
      { ch: 'control', action: 'screencast.start', quality: 45 },
    ]);

    view.rerender(<CdpLiveEngine {...props} session={withPhase(harness, 'connected')} />);
    expect(countMessages(harness, 'control', 'screencast.start')).toHaveLength(1);
  });

  /**
   * 帧盒协商：面板只有 400×800 时，网关不该按默认 1024 边产帧——多出来的像素
   * 会全部变成编码 / 传输 / 解码成本，而画面最终也只是缩放到面板里显示。
   */
  it('起流时按面板显示尺寸协商帧盒（窄面板不再要 1024 边）', () => {
    const harness = createSessionHarness();
    const props = phaseProps(harness);
    const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = (): DOMRect =>
      ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 400,
        bottom: 800,
        width: 400,
        height: 800,
        toJSON: () => ({}),
      }) as DOMRect;

    try {
      const view = render(<CdpLiveEngine {...props} session={withPhase(harness, 'idle')} />);
      view.rerender(<CdpLiveEngine {...props} session={withPhase(harness, 'connected')} />);

      expect(countMessages(harness, 'control', 'screencast.start')).toEqual([
        { ch: 'control', action: 'screencast.start', maxWidth: 400, maxHeight: 800, quality: 45 },
      ]);
    } finally {
      Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    }
  });

  /** 能离线程解码时协商二进制帧：省掉 base64 的 33% 体积与前端逐字节搬运。 */
  it('支持离线程解码时协商二进制帧', () => {
    const harness = createSessionHarness();
    const props = phaseProps(harness);
    vi.stubGlobal('createImageBitmap', vi.fn());
    try {
      const view = render(<CdpLiveEngine {...props} session={withPhase(harness, 'idle')} />);
      view.rerender(<CdpLiveEngine {...props} session={withPhase(harness, 'connected')} />);

      expect(countMessages(harness, 'control', 'screencast.start')).toEqual([
        { ch: 'control', action: 'screencast.start', quality: 45, binary: true },
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  /**
   * 画质档位切换必须重新起流：`Page.startScreencast` 只在起流时定档。
   *
   * 像素倍数要收敛到显示器 DPR 以内——jsdom 的 DPR 是 1，所以「清晰」档（2 倍）在这
   * 里退化成 1:1：在 1x 屏上按 2 倍取像素只是让 Chromium 多光栅化一遍再缩回去显示，
   * 清晰度不涨，编码 / 传输 / 解码却全额变慢。
   */
  it('切换画质档位会重新起流，且像素倍数收敛到 DPR 以内', () => {
    const harness = createSessionHarness();
    const props = phaseProps(harness);
    const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = (): DOMRect =>
      ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 400,
        bottom: 800,
        width: 400,
        height: 800,
        toJSON: () => ({}),
      }) as DOMRect;

    try {
      // 先以 idle 渲染让测量 effect 落定 surfaceSize，再进入 connected 起流；
      // 直接以 connected 挂载会在尺寸尚未测量时先发一次无帧盒的 start。
      const view = render(<CdpLiveEngine {...props} session={withPhase(harness, 'idle')} />);
      view.rerender(<CdpLiveEngine {...props} session={withPhase(harness, 'connected')} />);
      expect(countMessages(harness, 'control', 'screencast.start')).toEqual([
        { ch: 'control', action: 'screencast.start', maxWidth: 400, maxHeight: 800, quality: 45 },
      ]);

      view.rerender(
        <CdpLiveEngine
          {...props}
          qualityPresetId="sharp"
          session={withPhase(harness, 'connected')}
        />,
      );

      // DPR = 1：sharp 的 2 倍被收敛到 1 倍，质量仍按档位上调。
      expect(countMessages(harness, 'control', 'screencast.start')).toEqual([
        { ch: 'control', action: 'screencast.start', maxWidth: 400, maxHeight: 800, quality: 45 },
        { ch: 'control', action: 'screencast.start', maxWidth: 400, maxHeight: 800, quality: 50 },
      ]);
    } finally {
      Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    }
  });

  it('无损档位请求 PNG 且不发送 JPEG quality', () => {
    const harness = createSessionHarness();
    const props = { ...phaseProps(harness), qualityPresetId: 'lossless' };
    const view = render(<CdpLiveEngine {...props} session={withPhase(harness, 'idle')} />);
    view.rerender(<CdpLiveEngine {...props} session={withPhase(harness, 'connected')} />);

    expect(countMessages(harness, 'control', 'screencast.start')).toEqual([
      { ch: 'control', action: 'screencast.start', format: 'png' },
    ]);
  });

  /**
   * 高 DPR 屏上档位倍数有效：2x 屏的 sharp 档才能真的要到 2 倍像素。
   */
  it('DPR 为 2 时 sharp 档按 2 倍协商帧盒', () => {
    const originalDpr = window.devicePixelRatio;
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 2 });
    const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = (): DOMRect =>
      ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 400,
        bottom: 800,
        width: 400,
        height: 800,
        toJSON: () => ({}),
      }) as DOMRect;

    try {
      const harness = createSessionHarness();
      const props = { ...phaseProps(harness), qualityPresetId: 'sharp' };
      const view = render(<CdpLiveEngine {...props} session={withPhase(harness, 'idle')} />);
      view.rerender(<CdpLiveEngine {...props} session={withPhase(harness, 'connected')} />);

      expect(countMessages(harness, 'control', 'screencast.start')).toEqual([
        { ch: 'control', action: 'screencast.start', maxWidth: 800, maxHeight: 1600, quality: 50 },
      ]);
    } finally {
      Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
      Object.defineProperty(window, 'devicePixelRatio', {
        configurable: true,
        value: originalDpr,
      });
    }
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

  it('面板不可见时停流，重新可见时重新请求 screencast.start', () => {
    const harness = createSessionHarness();
    const props = phaseProps(harness);
    const view = render(<CdpLiveEngine {...props} />);
    expect(countMessages(harness, 'control', 'screencast.start')).toHaveLength(1);

    view.rerender(<CdpLiveEngine {...props} hidden />);
    expect(countMessages(harness, 'control', 'screencast.stop')).toEqual([
      { ch: 'control', action: 'screencast.stop' },
    ]);

    // 持续不可见不重复下发（隐藏期间后台不再解码任何帧）。
    view.rerender(<CdpLiveEngine {...props} hidden />);
    expect(countMessages(harness, 'control', 'screencast.stop')).toHaveLength(1);

    view.rerender(<CdpLiveEngine {...props} hidden={false} />);
    expect(countMessages(harness, 'control', 'screencast.start')).toHaveLength(2);
  });

  /** 模拟浏览器标签页可见性切换（jsdom 默认 visible）。 */
  function applyVisibility(value: 'visible' | 'hidden'): void {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value });
    document.dispatchEvent(new Event('visibilitychange'));
  }

  it('整页不可见（标签页切走）时同样停流，恢复可见后重新起流', () => {
    const harness = createSessionHarness();
    const props = phaseProps(harness);
    render(<CdpLiveEngine {...props} />);
    expect(countMessages(harness, 'control', 'screencast.start')).toHaveLength(1);

    act(() => applyVisibility('hidden'));
    expect(countMessages(harness, 'control', 'screencast.stop')).toEqual([
      { ch: 'control', action: 'screencast.stop' },
    ]);

    act(() => applyVisibility('visible'));
    expect(countMessages(harness, 'control', 'screencast.start')).toHaveLength(2);
  });

  it('挂载时即不可见则完全不请求产帧，连接建立后同样不请求', () => {
    const harness = createSessionHarness();
    const props = phaseProps(harness);
    const view = render(
      <CdpLiveEngine {...props} session={withPhase(harness, 'connecting')} hidden />,
    );
    expect(countMessages(harness, 'control', 'screencast.start')).toHaveLength(0);

    view.rerender(<CdpLiveEngine {...props} session={withPhase(harness, 'connected')} hidden />);
    expect(countMessages(harness, 'control', 'screencast.start')).toHaveLength(0);
    expect(countMessages(harness, 'control', 'screencast.stop')).toHaveLength(0);
  });

  it('切到同 URL 的另一个标签时强制重载，让远端产出新帧', () => {
    const harness = createSessionHarness();
    const props = phaseProps(harness);
    const view = render(<CdpLiveEngine {...props} tabId="tab-1" url="http://localhost:5173/" />);
    expect(countMessages(harness, 'control', 'reload')).toHaveLength(0);

    // 两个标签 URL 相同：url effect 不会下发 navigate，必须显式 reload，
    // 否则清空后的画面要等页面下一次 damage 才会恢复。
    view.rerender(<CdpLiveEngine {...props} tabId="tab-2" url="http://localhost:5173/" />);

    expect(countMessages(harness, 'control', 'reload')).toHaveLength(1);
  });

  it('远端自身导航（nav 回报地址）不重复下发 navigate，避免整页重载', () => {
    const harness = createSessionHarness();
    const props = phaseProps(harness);
    const view = render(<CdpLiveEngine {...props} tabId="tab-1" url="http://localhost:5173/a" />);
    const before = countMessages(harness, 'control', 'navigate').length;

    // 远端点了内部链接：网关回报新地址，宿主随后把地址写回标签 → url prop 变化。
    act(() => {
      harness.emit({
        ch: 'nav',
        seq: 1,
        ts: 0,
        payload: { url: 'http://localhost:5173/b', title: 'B', timestamp: 0 },
      });
    });
    view.rerender(<CdpLiveEngine {...props} tabId="tab-1" url="http://localhost:5173/b" />);

    expect(countMessages(harness, 'control', 'navigate')).toHaveLength(before);
  });

  it('切到不同 URL 的标签只导航，不额外重载', () => {
    const harness = createSessionHarness();
    const props = phaseProps(harness);
    const view = render(<CdpLiveEngine {...props} tabId="tab-1" url="http://localhost:5173/a" />);
    const navigateBefore = countMessages(harness, 'control', 'navigate').length;

    view.rerender(<CdpLiveEngine {...props} tabId="tab-2" url="http://localhost:5173/b" />);

    expect(countMessages(harness, 'control', 'navigate')).toHaveLength(navigateBefore + 1);
    expect(countMessages(harness, 'control', 'reload')).toHaveLength(0);
  });

  it('navigate 每个 URL 只发一次，URL 变化后重新导航（占位页同样下发）', () => {
    const harness = createSessionHarness();
    const props = phaseProps(harness);
    const view = render(<CdpLiveEngine {...props} url="about:blank" />);
    expect(countMessages(harness, 'control', 'navigate')).toEqual([
      { ch: 'control', action: 'navigate', url: 'about:blank' },
    ]);

    view.rerender(<CdpLiveEngine {...props} url="https://example.test/a" />);
    view.rerender(<CdpLiveEngine {...props} url="https://example.test/a" />);
    expect(countMessages(harness, 'control', 'navigate')).toEqual([
      { ch: 'control', action: 'navigate', url: 'about:blank' },
      { ch: 'control', action: 'navigate', url: 'https://example.test/a' },
    ]);

    view.rerender(<CdpLiveEngine {...props} url="https://example.test/b" />);
    expect(countMessages(harness, 'control', 'navigate')).toEqual([
      { ch: 'control', action: 'navigate', url: 'about:blank' },
      { ch: 'control', action: 'navigate', url: 'https://example.test/a' },
      { ch: 'control', action: 'navigate', url: 'https://example.test/b' },
    ]);

    // 关掉最后一个标签 / 切到新建的空标签：地址回落到占位页。必须让远端真的切到
    // 空白文档，否则 Chromium 停在旧页面继续产旧帧——画面与地址栏错位。
    view.rerender(<CdpLiveEngine {...props} url="about:blank" />);
    expect(countMessages(harness, 'control', 'navigate')).toEqual([
      { ch: 'control', action: 'navigate', url: 'about:blank' },
      { ch: 'control', action: 'navigate', url: 'https://example.test/a' },
      { ch: 'control', action: 'navigate', url: 'https://example.test/b' },
      { ch: 'control', action: 'navigate', url: 'about:blank' },
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

describe('resolveDisplayScale 与 DPR 收敛', () => {
  it('档位倍数不超过显示器 DPR', () => {
    // 1x 屏：1.5 / 2 倍都退化成 1 倍——多光栅化一遍再缩回去显示，成本全额支付、清晰度不涨。
    expect(resolveDisplayScale(1.5, 1)).toBe(1);
    expect(resolveDisplayScale(2, 1)).toBe(1);
    // 2x 屏：1.5 倍有效，2 倍也刚好可用。
    expect(resolveDisplayScale(1.5, 2)).toBe(1.5);
    expect(resolveDisplayScale(2, 2)).toBe(2);
    // 3x 屏：档位倍数就是上限，不会被 DPR 反向放大。
    expect(resolveDisplayScale(2, 3)).toBe(2);
  });

  it('异常 DPR / 档位一律按 1 处理', () => {
    expect(resolveDisplayScale(1.5, 0)).toBe(1);
    expect(resolveDisplayScale(1.5, Number.NaN)).toBe(1);
    expect(resolveDisplayScale(0, 2)).toBe(1);
    // 非法档位（非有限值）按 1 处理，不会被 DPR 放大成更大盒子。
    expect(resolveDisplayScale(Number.POSITIVE_INFINITY, 2)).toBe(1);
  });

  it('帧盒按实得倍数换算并封顶', () => {
    expect(resolveScreencastRequest({ width: 400, height: 800 }, 1)).toEqual({
      maxWidth: 400,
      maxHeight: 800,
    });
    expect(resolveScreencastRequest({ width: 400, height: 800 }, 2)).toEqual({
      maxWidth: 800,
      maxHeight: 1600,
    });
    expect(resolveScreencastRequest({ width: 4000, height: 3000 }, 2)).toEqual({
      maxWidth: SCREENCAST_FRAME_EDGE_LIMIT,
      maxHeight: SCREENCAST_FRAME_EDGE_LIMIT,
    });
    // 尺寸未知时不带字段，交给服务端默认定档。
    expect(resolveScreencastRequest(null, 2)).toEqual({});
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
    expect(computeFrameLayout({ width: 520, height: 0 }, frame)).toEqual({
      width: 200,
      height: 100,
    });
    expect(computeFrameLayout({ width: 0, height: 320 }, frame)).toEqual({
      width: 200,
      height: 100,
    });
    expect(computeFrameLayout({ width: 0, height: 0 }, frame)).toEqual({ width: 200, height: 100 });
    expect(computeFrameLayout(null, frame)).toEqual({ width: 200, height: 100 });
    expect(computeFrameLayout(undefined, frame)).toEqual({ width: 200, height: 100 });
  });

  it('兜底尺寸把最长边裁剪到上限并保持比例', () => {
    expect(
      computeFrameLayout({ width: 0, height: 0 }, { deviceWidth: 4096, deviceHeight: 2048 }),
    ).toEqual({
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
        tabId="tab-1"
        hidden={false}
        pickArmed={false}
        onPickConsumed={() => undefined}
        onPickCancel={() => undefined}
        refreshKey={0}
        devicePresetId={DEFAULT_DEVICE_PRESET_ID}
        qualityPresetId="balanced"
        zoom={1}
      />,
    );

    act(() => harness.emit(FRAME_ENVELOPE));

    expect(screen.queryByTestId('cdp-live-frame')).not.toBeNull();
    const canvas = screen.getByTestId('cdp-live-frame');
    expect(canvas.style.width).toBe('200px');
    expect(canvas.style.height).toBe('100px');
  });
});

describe('CdpLiveEngine 键盘与输入法', () => {
  function keyboardProps(harness: SessionHarness) {
    return {
      session: harness.session,
      url: 'about:blank',
      hidden: false,
      pickArmed: false,
      onPickConsumed: () => undefined,
      onPickCancel: () => undefined,
      tabId: 'tab-1',
      refreshKey: 0,
      devicePresetId: DEFAULT_DEVICE_PRESET_ID,
      qualityPresetId: 'smooth',
      zoom: 1,
    };
  }

  /**
   * 中文输入法的核心回归：组合期间（拼音字母）不能注入按键，组合结束后整段提交。
   *
   * 旧实现把每个 keydown 直接转发成 `char`，拼音字母会被逐个打进页面，中文根本
   * 打不出来。
   */
  it('输入法组合结束后一次性提交整段文本，组合期间不注入按键', () => {
    const harness = createSessionHarness();
    render(<CdpLiveEngine {...keyboardProps(harness)} />);
    const ime = screen.getByLabelText('预览页输入');

    fireEvent.compositionStart(ime);
    fireEvent.input(ime, { target: { value: 'nihao' } });
    fireEvent.keyDown(ime, { key: 'n', code: 'KeyN', keyCode: 78 });

    expect(harness.sent.filter((message) => message['kind'] === 'key')).toHaveLength(0);
    expect(harness.sent.filter((message) => message['kind'] === 'text')).toHaveLength(0);

    fireEvent.input(ime, { target: { value: '你好' } });
    fireEvent.compositionEnd(ime, { data: '你好' });

    expect(harness.sent.filter((message) => message['kind'] === 'text')).toEqual([
      { ch: 'input', kind: 'text', text: '你好' },
    ]);
  });

  it('普通键仍然走 char + keyDown', () => {
    const harness = createSessionHarness();
    render(<CdpLiveEngine {...keyboardProps(harness)} />);
    const ime = screen.getByLabelText('预览页输入');

    fireEvent.keyDown(ime, { key: 'a', code: 'KeyA', keyCode: 65 });

    expect(harness.sent.filter((message) => message['kind'] === 'key')).toEqual([
      { ch: 'input', kind: 'key', type: 'char', text: 'a' },
      {
        ch: 'input',
        kind: 'key',
        type: 'keyDown',
        key: 'a',
        code: 'KeyA',
        windowsVirtualKeyCode: 65,
      },
    ]);
  });

  it('Ctrl+A / Ctrl+Z 走 Blink 编辑命令，Ctrl+V 留给本地粘贴事件', () => {
    const harness = createSessionHarness();
    render(<CdpLiveEngine {...keyboardProps(harness)} />);
    const ime = screen.getByLabelText('预览页输入');

    fireEvent.keyDown(ime, { key: 'a', code: 'KeyA', keyCode: 65, ctrlKey: true });
    expect(harness.sent.at(-1)).toEqual({
      ch: 'input',
      kind: 'key',
      type: 'keyDown',
      key: 'a',
      code: 'KeyA',
      windowsVirtualKeyCode: 65,
      modifiers: 2,
      commands: ['selectAll'],
    });

    fireEvent.keyDown(ime, { key: 'z', code: 'KeyZ', keyCode: 90, ctrlKey: true });
    expect(harness.sent.at(-1)).toEqual({
      ch: 'input',
      kind: 'key',
      type: 'keyDown',
      key: 'z',
      code: 'KeyZ',
      windowsVirtualKeyCode: 90,
      modifiers: 2,
      commands: ['undo'],
    });

    // 粘贴不能 preventDefault，也不能注入按键：要留给 textarea 的 paste 事件。
    const before = harness.sent.length;
    fireEvent.keyDown(ime, { key: 'v', code: 'KeyV', keyCode: 86, ctrlKey: true });
    expect(harness.sent).toHaveLength(before);
  });

  it('修饰键透传：Shift+Enter 不再退化成普通 Enter', () => {
    const harness = createSessionHarness();
    render(<CdpLiveEngine {...keyboardProps(harness)} />);
    const ime = screen.getByLabelText('预览页输入');

    fireEvent.keyDown(ime, { key: 'Enter', code: 'Enter', keyCode: 13, shiftKey: true });

    expect(harness.sent.filter((message) => message['kind'] === 'key').at(-1)).toEqual({
      ch: 'input',
      kind: 'key',
      type: 'keyDown',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
      modifiers: 8,
    });
  });

  it('F5 映射到预览刷新；Ctrl+W 等宿主组合放行且不注入', () => {
    const harness = createSessionHarness();
    render(<CdpLiveEngine {...keyboardProps(harness)} />);
    const ime = screen.getByLabelText('预览页输入');

    fireEvent.keyDown(ime, { key: 'F5', code: 'F5', keyCode: 116 });
    expect(harness.sent.at(-1)).toEqual({ ch: 'control', action: 'reload' });

    // Ctrl+W 属于宿主浏览器：不能 preventDefault，也不能注入远端。
    const before = harness.sent.length;
    fireEvent.keyDown(ime, { key: 'w', code: 'KeyW', keyCode: 87, ctrlKey: true });
    expect(harness.sent).toHaveLength(before);
  });

  it('Alt+← / Alt+→ 映射到预览历史', () => {
    const harness = createSessionHarness();
    render(<CdpLiveEngine {...keyboardProps(harness)} />);
    const ime = screen.getByLabelText('预览页输入');

    fireEvent.keyDown(ime, { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37, altKey: true });
    expect(harness.sent.at(-1)).toEqual({ ch: 'control', action: 'goBack' });

    fireEvent.keyDown(ime, { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, altKey: true });
    expect(harness.sent.at(-1)).toEqual({ ch: 'control', action: 'goForward' });
  });

  it('粘贴走本地剪贴板文本，复制向网关索取远端选区', () => {
    const harness = createSessionHarness();
    render(<CdpLiveEngine {...keyboardProps(harness)} />);
    const ime = screen.getByLabelText('预览页输入');

    const paste = new Event('paste', { bubbles: true });
    Object.defineProperty(paste, 'clipboardData', {
      value: { getData: () => 'pasted text' },
    });
    act(() => {
      ime.dispatchEvent(paste);
    });
    expect(harness.sent.at(-1)).toEqual({
      ch: 'input',
      kind: 'text',
      text: 'pasted text',
    });

    fireEvent.keyDown(ime, { key: 'c', code: 'KeyC', keyCode: 67, ctrlKey: true });
    expect(harness.sent.at(-1)).toEqual({ ch: 'control', action: 'copySelection' });
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
      tabId: 'tab-1',
      refreshKey: 0,
      devicePresetId,
      qualityPresetId: 'smooth',
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

  it('收到滚动指标后渲染自绘滚动条，键盘 End 下发 scrollTo', () => {
    const harness = createSessionHarness();
    armSurface(harness, { pickArmed: false });

    act(() => {
      harness.emit({
        ch: 'scroll',
        seq: 9,
        ts: 0,
        payload: { scrollY: 0, maxScrollY: 600, viewportHeight: 300, contentHeight: 900 },
      });
    });

    const scrollbar = screen.getByRole('scrollbar');
    expect(scrollbar.getAttribute('aria-valuemax')).toBe('600');

    fireEvent.keyDown(scrollbar, { key: 'End' });

    expect(countMessages(harness, 'control', 'scrollTo').at(-1)).toEqual({
      ch: 'control',
      action: 'scrollTo',
      y: 600,
    });
  });
});
