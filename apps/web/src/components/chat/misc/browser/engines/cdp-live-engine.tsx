/**
 * `CdpLiveEngine` —— CDP 实时预览的 DOM 视图（绝不创建原生 webview）。
 *
 * 数据流：
 * 网关 screencast 帧（JPEG base64）→ `<img>`；`onLoad` 之后回 ack；
 * DOM 上的鼠标 / 滚轮 / 键盘事件 → 设备像素坐标 → `{ ch: 'input' }` 上行。
 *
 * 两个容易踩坏的点：
 * 1. **ack 是背压信用**：hub 任意时刻只有一帧在途，不 ack 就不会有下一帧。
 *    除了 `onLoad`，这里还挂了 500ms 兜底——隐藏 / 解码异常时 `onLoad` 可能不触发，
 *    少了兜底预览会直接冻结。
 * 2. **坐标必须用帧的 `deviceWidth` / `deviceHeight`**：
 *    `Emulation.setDeviceMetricsOverride` 不会改变 Playwright 自己的 viewport，
 *    帧 metadata 才是唯一可信的尺寸来源。
 * 3. **缩放只走 CSS `transform`**：不写设备指标、不写 pageScale；`toDevicePoint`
 *    按同一档位反算，缩放后点击 / hover 才不会偏。
 *
 * 颜色 / 间距 / 圆角一律走 E · Nebula token（`var(--…)`），禁止硬编码色值。
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import type {
  BrowserLiveDeviceMessage,
  BrowserLiveFramePayload,
  BrowserLiveInputMessage,
} from '@openAwork/shared';

import { resolveDevicePreset, type BrowserDevicePreset } from '../device-presets.js';
import { useCdpLivePick, type CdpLivePickFeedback } from '../hooks/use-cdp-live-pick.js';
import type { BrowserLivePhase, BrowserLiveSession } from '../hooks/use-browser-live-session.js';

/** 帧绘制兜底 ack 时限（毫秒）。 */
const FRAME_ACK_FALLBACK_MS = 500;

/** 设备尺寸 / UA 下发的防抖窗口：拖拽面板大小时不逐帧打 socket。 */
export const DEVICE_SYNC_DEBOUNCE_MS = 200;

/** 可导航的地址（about:blank 之类的占位页无需下发 navigate）。 */
const NAVIGABLE_URL_PATTERN = /^https?:\/\//i;

export interface LiveRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface FrameMetrics {
  deviceWidth: number;
  deviceHeight: number;
}

/** 退化盒子（0 / 缺失）下兜底绘制的最大边长（CSS 像素）。 */
export const FALLBACK_FRAME_MAX_SIZE = 2048;

/**
 * 把帧按 `deviceWidth` / `deviceHeight` 等比放进可用盒子：返回渲染尺寸，
 * 绝不拉伸（letterbox 交给外层居中）。
 *
 * 可用盒子退化（0 / NaN / 未测量）时**不返回 null**，而是按帧自身设备尺寸兜底
 * （最长边裁剪到 `FALLBACK_FRAME_MAX_SIZE`）：只要帧有效就必须有渲染尺寸——
 * 面板高度塌陷时宁可让外围 CSS 裁剪画面，也不能出现「帧在流、画面为空」。
 */
export function computeFrameLayout(
  available: { width: number; height: number } | null | undefined,
  frame: FrameMetrics,
): { width: number; height: number } | null {
  const deviceWidth = frame.deviceWidth;
  const deviceHeight = frame.deviceHeight;
  if (!(deviceWidth > 0) || !(deviceHeight > 0)) return null;

  const availableWidth = available?.width ?? 0;
  const availableHeight = available?.height ?? 0;
  const scale =
    availableWidth > 0 && availableHeight > 0
      ? Math.min(availableWidth / deviceWidth, availableHeight / deviceHeight)
      : Math.min(1, FALLBACK_FRAME_MAX_SIZE / Math.max(deviceWidth, deviceHeight));
  return {
    width: Math.max(1, Math.round(deviceWidth * scale)),
    height: Math.max(1, Math.round(deviceHeight * scale)),
  };
}

/** 画面在容器内的真实内容盒（小画面居中，四周是 letterbox 空白）。 */
export function computeContentBox(container: LiveRect, frame: FrameMetrics): LiveRect | null {
  const layout = computeFrameLayout(container, frame);
  if (!layout) return null;
  return {
    left: container.left + (container.width - layout.width) / 2,
    top: container.top + (container.height - layout.height) / 2,
    width: layout.width,
    height: layout.height,
  };
}

/**
 * 渲染 CSS 像素 → 设备像素。
 *
 * 缩放是围绕内容盒中心的 CSS `transform: scale()`，所以先把屏幕坐标按 zoom
 * 反算回未缩放的内容盒坐标，再做等比映射——少这一步，放大 / 缩小之后点击与
 * hover 都会落在错误的位置。
 *
 * 落在 letterbox 区域（画面之外）的点击返回 null，避免把空白处的坐标当成
 * 真实点击下发到远端。
 */
export function toDevicePoint(input: {
  container: LiveRect;
  frame: FrameMetrics;
  clientX: number;
  clientY: number;
  /** 纯前端缩放档位；缺省 1（100%）。 */
  zoom?: number;
}): { x: number; y: number } | null {
  const box = computeContentBox(input.container, input.frame);
  if (!box) return null;

  const zoom = input.zoom !== undefined && input.zoom > 0 ? input.zoom : 1;
  const centerX = box.left + box.width / 2;
  const centerY = box.top + box.height / 2;
  const localX = (input.clientX - centerX) / zoom + box.width / 2;
  const localY = (input.clientY - centerY) / zoom + box.height / 2;
  if (localX < 0 || localY < 0 || localX > box.width || localY > box.height) return null;

  const deviceWidth = Math.max(1, input.frame.deviceWidth);
  const deviceHeight = Math.max(1, input.frame.deviceHeight);
  return {
    x: Math.min(Math.max(Math.round((localX / box.width) * deviceWidth), 0), deviceWidth - 1),
    y: Math.min(Math.max(Math.round((localY / box.height) * deviceHeight), 0), deviceHeight - 1),
  };
}

/** 一次 `device` 上行要下发的目标（固定预设 / 自适应面板尺寸）。 */
export interface DeviceSyncTarget {
  width: number;
  height: number;
  deviceScaleFactor: number;
  mobile: boolean;
  /** 空串 = 清除 UA 覆写，恢复服务端默认。 */
  userAgent: string;
}

/**
 * 解析设备同步目标：固定预选用预设尺寸，自适应用当前面板测量值
 * （视口跟随面板，不需要单独发一条「清除」消息）。
 */
export function resolveDeviceSyncTarget(
  preset: BrowserDevicePreset | null,
  panelSize: { width: number; height: number } | null,
): DeviceSyncTarget | null {
  if (preset !== null && preset.width > 0 && preset.height > 0) {
    return {
      width: Math.round(preset.width),
      height: Math.round(preset.height),
      deviceScaleFactor: preset.deviceScaleFactor,
      mobile: preset.mobile,
      userAgent: preset.userAgent ?? '',
    };
  }

  if (!panelSize || !(panelSize.width >= 1) || !(panelSize.height >= 1)) return null;
  return {
    width: Math.round(panelSize.width),
    height: Math.round(panelSize.height),
    deviceScaleFactor: 1,
    mobile: false,
    userAgent: '',
  };
}

interface CdpLiveEngineProps {
  session: BrowserLiveSession;
  /** 当前 tab 的地址：首次进入与地址变更时把远端导航过去。 */
  url: string;
  /** 面板整体隐藏时保留挂载（与 iframe 分支一致），只是不显示。 */
  hidden: boolean;
  /** 元素拾取是否已武装（由工具栏驱动）。 */
  pickArmed: boolean;
  /** 拾取请求已发出：宿主解除武装。 */
  onPickConsumed: () => void;
  /** 拾取被 Esc 取消：宿主解除武装。 */
  onPickCancel: () => void;
  /**
   * 拾取意图：
   * - `composer`（缺省）：下发 `pick`，命中结果插进 composer；
   * - `styles`：下发 `node.styles`（回包带 `fullComputedStyles`，不写 composer），
   *   供元素检查器读取完整计算样式。
   */
  pickIntent?: 'composer' | 'styles';
  /** 拾取坐标上报：宿主记录坐标，供检查器的 `node.styles` 复用。 */
  onPickPoint?: (point: { x: number; y: number }) => void;
  /** 工具栏「刷新」信号：变化即向远端下发 reload（与 iframe 分支的刷新语义对齐）。 */
  refreshKey: number;
  /** 设备预设 id：固定尺寸下发预设视口，自适应下发面板测量值。 */
  devicePresetId: string;
  /** 纯前端缩放档位（1 = 100%）：只改 CSS transform 与坐标反算。 */
  zoom: number;
}

interface StatusChip {
  label: string;
  color: string;
  dot: string;
}

function describeStatusChip(phase: BrowserLivePhase): StatusChip {
  switch (phase) {
    case 'connected':
      return { label: '实时', color: 'var(--accent)', dot: 'var(--accent)' };
    case 'connecting':
      return { label: '连接中', color: 'var(--warning)', dot: 'var(--warning)' };
    case 'reconnecting':
      return { label: '重连中', color: 'var(--warning)', dot: 'var(--warning)' };
    case 'error':
      return { label: '已断开', color: 'var(--danger)', dot: 'var(--danger)' };
    default:
      return { label: '未启动', color: 'var(--fg-subtle)', dot: 'var(--fg-subtle)' };
  }
}

/** 阻断式状态文案：仅在画面无法给出有效内容时展示在中央。 */
function describeBlockingMessage(
  phase: BrowserLivePhase,
  lastError: string | null,
  hasFrame: boolean,
): { text: string; color: string } | null {
  if (phase === 'error') {
    return { text: lastError ?? '实时预览已断开', color: 'var(--danger)' };
  }
  if (hasFrame) return null;
  if (phase === 'reconnecting') {
    return { text: '连接已断开，正在重连…', color: 'var(--warning)' };
  }
  if (phase === 'connecting') {
    return { text: '正在连接实时预览…', color: 'var(--fg-muted)' };
  }
  if (phase === 'connected') {
    return { text: '等待实时画面…', color: 'var(--fg-muted)' };
  }
  return { text: '实时预览未启动', color: 'var(--fg-muted)' };
}

const STATUS_CHIP_STYLE: CSSProperties = {
  position: 'absolute',
  top: 8,
  right: 8,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  height: 18,
  padding: '0 8px',
  borderRadius: 'var(--radius-pill)',
  background: 'color-mix(in oklch, var(--bg-overlay) 88%, transparent)',
  border: '1px solid var(--border-default)',
  fontSize: 10,
  fontWeight: 600,
  pointerEvents: 'none',
};

const SIZE_CHIP_STYLE: CSSProperties = {
  position: 'absolute',
  bottom: 8,
  right: 8,
  padding: '2px 6px',
  borderRadius: 'var(--radius-xs)',
  background: 'color-mix(in oklch, var(--bg-overlay) 88%, transparent)',
  border: '1px solid var(--border-subtle)',
  color: 'var(--fg-subtle)',
  fontSize: 10,
  fontVariantNumeric: 'tabular-nums',
  pointerEvents: 'none',
};

const PICK_BANNER_STYLE: CSSProperties = {
  position: 'absolute',
  top: 8,
  left: '50%',
  transform: 'translateX(-50%)',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  height: 24,
  padding: '0 12px',
  borderRadius: 'var(--radius-pill)',
  background: 'color-mix(in oklch, var(--accent) 18%, var(--bg-overlay))',
  border: '1px solid var(--accent-border)',
  boxShadow: 'var(--shadow-md)',
  color: 'var(--accent)',
  fontSize: 11,
  fontWeight: 600,
  whiteSpace: 'nowrap',
  pointerEvents: 'none',
};

const PICK_BANNER_DOT_STYLE: CSSProperties = {
  width: 6,
  height: 6,
  borderRadius: 'var(--radius-pill)',
  background: 'var(--accent)',
  boxShadow: '0 0 8px var(--accent)',
  animation: 'pulse 1.6s ease-in-out infinite',
};

/** 拾取结果反馈：success / warning 两种语义色，非阻塞（不拦截指针）。 */
const PICK_TOAST_STYLE: CSSProperties = {
  position: 'absolute',
  bottom: 8,
  left: '50%',
  transform: 'translateX(-50%)',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  maxWidth: 'calc(100% - 32px)',
  padding: '8px 12px',
  borderRadius: 'var(--radius-md)',
  boxShadow: 'var(--shadow-md)',
  fontSize: 11,
  fontWeight: 600,
  pointerEvents: 'none',
};

/** 反馈里选择器的等宽展示：过长时省略，不撑破气泡。 */
const PICK_TOAST_SELECTOR_STYLE: CSSProperties = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  maxWidth: 220,
  fontFamily: 'var(--font-mono, monospace)',
  fontWeight: 500,
  opacity: 0.85,
};

interface PickToastChrome {
  background: string;
  border: string;
  color: string;
  icon: string;
  label: string;
}

function describePickToast(ambiguous: boolean): PickToastChrome {
  if (ambiguous) {
    return {
      background: 'var(--warning-muted)',
      border: '1px solid var(--warning-border)',
      color: 'var(--warning)',
      icon: 'M12 9v4 M12 17h.01 M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
      label: '选择器可能不唯一，已引用到输入框',
    };
  }
  return {
    background: 'var(--success-muted)',
    border: '1px solid var(--success-border)',
    color: 'var(--success)',
    icon: 'M20 6 9 17l-5-5',
    label: '已引用元素到输入框',
  };
}

/** 拾取完成提示：短时展示后由 hook 自动清空，不拦截指针。 */
function PickToast({ feedback }: { feedback: CdpLivePickFeedback }) {
  const chrome = describePickToast(feedback.ambiguous);
  return (
    <div
      data-toast=""
      role="status"
      style={{
        ...PICK_TOAST_STYLE,
        background: chrome.background,
        border: chrome.border,
        color: chrome.color,
      }}
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ flexShrink: 0 }}
      >
        <path d={chrome.icon} />
      </svg>
      <span>{chrome.label}</span>
      <code style={PICK_TOAST_SELECTOR_STYLE}>{feedback.selector}</code>
    </div>
  );
}

export function CdpLiveEngine({
  session,
  url,
  hidden,
  pickArmed,
  onPickConsumed,
  onPickCancel,
  pickIntent = 'composer',
  onPickPoint,
  refreshKey,
  devicePresetId,
  zoom,
}: CdpLiveEngineProps) {
  const { send, subscribe } = session;
  const surfaceRef = useRef<HTMLDivElement>(null);
  /** 当前展示中的帧：`onLoad` 到来时 ack 的就是它。 */
  const frameRef = useRef<BrowserLiveFramePayload | null>(null);
  const ackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ackedFrameRef = useRef<number | null>(null);
  const navigatedUrlRef = useRef<string | null>(null);
  const lastRefreshKeyRef = useRef(refreshKey);
  const deviceSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 最近一次下发的 UA 覆写：默认 UA 时为空串，避免重复清除。 */
  const sentUserAgentRef = useRef('');
  /** 当前连接段是否已请求过 screencast：重连后需要重新请求，但同一段内不重复刷。 */
  const screencastArmedRef = useRef(false);

  const [frame, setFrame] = useState<BrowserLiveFramePayload | null>(null);
  const [surfaceSize, setSurfaceSize] = useState<{ width: number; height: number } | null>(null);
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);

  const pick = useCdpLivePick({
    session,
    armed: pickArmed,
    action: pickIntent === 'styles' ? 'node.styles' : 'pick',
    // 取样式是检查器的读操作，不能把元素引用塞进 composer。
    insertIntoComposer: pickIntent !== 'styles',
    onPickSent: (point) => {
      onPickConsumed();
      onPickPoint?.(point);
    },
    onDisarm: onPickCancel,
  });

  /** 回 ack（背压信用）。同一帧只回一次。 */
  const ackFrame = useCallback(
    (frameSessionId: number): void => {
      if (ackedFrameRef.current === frameSessionId) return;
      ackedFrameRef.current = frameSessionId;
      if (ackTimerRef.current !== null) {
        clearTimeout(ackTimerRef.current);
        ackTimerRef.current = null;
      }
      send({ ch: 'ack', frameSessionId });
    },
    [send],
  );

  // screencast 只在通道 connected 后武装（本组件 effect 先于父 hook 建连，挂载期发必然被丢）；
  // 重连回到 connected 时重新请求——hub 只为新 controller 恢复产帧。
  useEffect(() => {
    if (session.phase !== 'connected') {
      screencastArmedRef.current = false;
      return;
    }
    if (screencastArmedRef.current) return;
    screencastArmedRef.current = true;
    send({ ch: 'control', action: 'screencast.start' });
  }, [session.phase, send]);

  // 卸载通知停止产帧（沿用原语义）；同时清理兜底 ack 定时器。
  useEffect(() => {
    return () => {
      send({ ch: 'control', action: 'screencast.stop' });
      if (ackTimerRef.current !== null) {
        clearTimeout(ackTimerRef.current);
        ackTimerRef.current = null;
      }
    };
  }, [send]);

  // 首次进入 / 地址变更：让远端跟随当前 tab 的 URL。
  useEffect(() => {
    if (navigatedUrlRef.current === url) return;
    navigatedUrlRef.current = url;
    if (!NAVIGABLE_URL_PATTERN.test(url)) return;
    send({ ch: 'control', action: 'navigate', url });
  }, [url, send]);

  // 工具栏刷新：iframe 分支靠 refreshKey 重挂载，实时分支要显式让远端 reload。
  useEffect(() => {
    if (lastRefreshKeyRef.current === refreshKey) return;
    lastRefreshKeyRef.current = refreshKey;
    send({ ch: 'control', action: 'reload' });
  }, [refreshKey, send]);

  // 收帧：先渲染，`onLoad` 后 ack；兜底定时器保证 onLoad 不触发时也能放行下一帧。
  useEffect(() => {
    return subscribe((envelope) => {
      if (envelope.ch !== 'frame') return;
      const payload = envelope.payload as BrowserLiveFramePayload;
      if (typeof payload?.data !== 'string' || payload.data.length === 0) return;
      if (!(payload.deviceWidth > 0) || !(payload.deviceHeight > 0)) return;

      frameRef.current = payload;
      setFrame(payload);

      if (ackTimerRef.current !== null) clearTimeout(ackTimerRef.current);
      ackTimerRef.current = setTimeout(() => {
        ackTimerRef.current = null;
        ackFrame(payload.frameSessionId);
      }, FRAME_ACK_FALLBACK_MS);
    });
  }, [subscribe, ackFrame]);

  // 测量可用盒子：ResizeObserver 优先，环境不支持时退回一次性测量。
  useEffect(() => {
    const element = surfaceRef.current;
    if (!element) return;

    const measure = (): void => {
      const rect = element.getBoundingClientRect();
      setSurfaceSize((prev) =>
        prev !== null &&
        Math.abs(prev.width - rect.width) < 0.5 &&
        Math.abs(prev.height - rect.height) < 0.5
          ? prev
          : { width: rect.width, height: rect.height },
      );
    };

    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // 设备同步：固定预设下发预设视口，自适应下发面板测量值（视口跟随面板）。
  // 防抖保证拖拽面板大小时不会逐帧打 socket；只在已连接时下发，重连成功后
  // 同样会重发一次，避免会话重建后视口悄悄退回默认尺寸。UA 只在变化时下发。
  useEffect(() => {
    if (session.phase !== 'connected') return;
    const target = resolveDeviceSyncTarget(resolveDevicePreset(devicePresetId), surfaceSize);
    if (!target) return;

    deviceSyncTimerRef.current = setTimeout(() => {
      deviceSyncTimerRef.current = null;
      const message: BrowserLiveDeviceMessage = {
        ch: 'device',
        width: target.width,
        height: target.height,
        deviceScaleFactor: target.deviceScaleFactor,
        mobile: target.mobile,
      };
      if (target.userAgent !== sentUserAgentRef.current) {
        message.userAgent = target.userAgent;
        sentUserAgentRef.current = target.userAgent;
      }
      send(message);
    }, DEVICE_SYNC_DEBOUNCE_MS);

    return () => {
      if (deviceSyncTimerRef.current !== null) {
        clearTimeout(deviceSyncTimerRef.current);
        deviceSyncTimerRef.current = null;
      }
    };
  }, [devicePresetId, surfaceSize, send, session.phase]);

  // 滚轮必须用非 passive 监听：React 根容器上的 wheel 监听是 passive 的，
  // 在回调里 preventDefault 不会生效，本地面板会跟着一起滚。
  useEffect(() => {
    const element = surfaceRef.current;
    if (!element) return;

    const onWheel = (event: WheelEvent): void => {
      const current = frameRef.current;
      if (!current) return;
      const point = toDevicePoint({
        container: element.getBoundingClientRect(),
        frame: current,
        clientX: event.clientX,
        clientY: event.clientY,
        zoom,
      });
      if (!point) return;
      event.preventDefault();
      send({
        ch: 'input',
        kind: 'wheel',
        x: point.x,
        y: point.y,
        deltaX: event.deltaX,
        deltaY: event.deltaY,
      });
    };

    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [send, zoom]);

  const pointFromEvent = (event: MouseEvent<HTMLDivElement>): { x: number; y: number } | null => {
    const current = frameRef.current;
    if (!current) return null;
    return toDevicePoint({
      container: event.currentTarget.getBoundingClientRect(),
      frame: current,
      clientX: event.clientX,
      clientY: event.clientY,
      zoom,
    });
  };

  const handleMouseDown = (event: MouseEvent<HTMLDivElement>): void => {
    surfaceRef.current?.focus({ preventScroll: true });
    const point = pointFromEvent(event);
    if (!point) return;
    if (pickArmed) {
      // 拾取模式下点击不透传给远端：否则选元素会顺带触发页面交互。
      event.preventDefault();
      return;
    }
    send({
      ch: 'input',
      kind: 'mouse',
      type: 'mousePressed',
      x: point.x,
      y: point.y,
      button: toMouseButton(event.button),
      clickCount: 1,
    });
  };

  const handleMouseUp = (event: MouseEvent<HTMLDivElement>): void => {
    const point = pointFromEvent(event);
    if (!point) return;
    if (pickArmed) {
      event.preventDefault();
      pick.handlePick(point.x, point.y);
      return;
    }
    send({
      ch: 'input',
      kind: 'mouse',
      type: 'mouseReleased',
      x: point.x,
      y: point.y,
      button: toMouseButton(event.button),
      clickCount: 1,
    });
  };

  const handleMouseMove = (event: MouseEvent<HTMLDivElement>): void => {
    const point = pointFromEvent(event);
    if (!point) return;
    send({ ch: 'input', kind: 'mouse', type: 'mouseMoved', x: point.x, y: point.y });
  };

  /** 键盘：可打印字符额外发 `char`（CDP 侧的文本输入靠它），避免重复注入。 */
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    event.preventDefault();
    // 拾取模式下键盘不注入远端；Esc 由 hook 在窗口捕获阶段处理并解除武装。
    if (pickArmed) return;
    const key = event.key;
    const modifiers = event.ctrlKey || event.metaKey || event.altKey;
    if (key.length === 1 && !modifiers) {
      send({ ch: 'input', kind: 'key', type: 'char', text: key });
    }
    send(buildKeyMessage('keyDown', event));
  };

  const handleKeyUp = (event: KeyboardEvent<HTMLDivElement>): void => {
    event.preventDefault();
    if (pickArmed) return;
    send(buildKeyMessage('keyUp', event));
  };

  const layout = useMemo(
    () => (frame !== null ? computeFrameLayout(surfaceSize, frame) : null),
    [frame, surfaceSize],
  );

  const chip = describeStatusChip(session.phase);
  const blocking = describeBlockingMessage(session.phase, session.lastError, frame !== null);

  return (
    <div
      ref={surfaceRef}
      tabIndex={0}
      aria-label="浏览器实时预览"
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{
        position: 'absolute',
        inset: 0,
        display: hidden ? 'none' : 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        background: 'var(--bg-base)',
        cursor: pickArmed ? 'crosshair' : 'default',
        outline: pickArmed || focused ? '2px solid var(--accent)' : 'none',
        outlineOffset: -2,
        boxShadow: pickArmed
          ? 'inset 0 0 0 4px var(--accent-subtle)'
          : hovered
            ? 'inset 0 0 0 1px color-mix(in oklch, var(--accent) 22%, transparent)'
            : 'none',
        transition: 'box-shadow 100ms cubic-bezier(0.4, 0, 0.2, 1)',
      }}
    >
      {frame !== null && layout !== null ? (
        <img
          src={`data:${frame.mimeType};base64,${frame.data}`}
          alt="实时预览画面"
          draggable={false}
          data-testid="cdp-live-frame"
          onLoad={() => {
            const current = frameRef.current;
            if (current) ackFrame(current.frameSessionId);
          }}
          onDragStart={(event) => event.preventDefault()}
          style={{
            width: layout.width,
            height: layout.height,
            display: 'block',
            userSelect: 'none',
            transform: zoom === 1 ? undefined : `scale(${zoom})`,
            transformOrigin: 'center',
          }}
        />
      ) : null}

      {blocking !== null && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            textAlign: 'center',
            color: blocking.color,
            fontSize: 12,
            pointerEvents: 'none',
          }}
        >
          {blocking.text}
        </div>
      )}

      <div style={STATUS_CHIP_STYLE}>
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: 'var(--radius-pill)',
            background: chip.dot,
            boxShadow:
              session.phase === 'connected' ? '0 0 6px var(--accent)' : 'none',
          }}
        />
        <span style={{ color: chip.color }}>{chip.label}</span>
      </div>

      {frame !== null && (
        <div style={SIZE_CHIP_STYLE}>
          {frame.deviceWidth}×{frame.deviceHeight}
        </div>
      )}

      {pickArmed && (
        <div style={PICK_BANNER_STYLE} role="status">
          <span style={PICK_BANNER_DOT_STYLE} />
          {pickIntent === 'styles'
            ? '拾取模式：点击元素读取完整样式，Esc 退出'
            : '拾取模式：点击页面元素，Esc 退出'}
        </div>
      )}

      {pick.feedback !== null && <PickToast feedback={pick.feedback} />}
    </div>
  );
}

/** React 的 button 编码 → 线路协议的 button。 */
function toMouseButton(button: number): 'left' | 'right' | 'middle' {
  if (button === 1) return 'middle';
  if (button === 2) return 'right';
  return 'left';
}

/** 组装键盘上行消息：只在有值时携带可选字段，避免下发无意义的 0。 */
function buildKeyMessage(
  type: 'keyDown' | 'keyUp' | 'char',
  event: KeyboardEvent<HTMLDivElement>,
): BrowserLiveInputMessage {
  const message: Extract<BrowserLiveInputMessage, { kind: 'key' }> = {
    ch: 'input',
    kind: 'key',
    type,
  };
  if (event.key.length > 0) message.key = event.key;
  if (event.code.length > 0) message.code = event.code;
  if (event.keyCode > 0) message.windowsVirtualKeyCode = event.keyCode;
  return message;
}
