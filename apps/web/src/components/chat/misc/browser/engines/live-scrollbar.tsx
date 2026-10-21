/**
 * 实时预览的自绘纵向滚动条。
 *
 * 实时画面是远端页面的位图，Chromium 自己的滚动条不会被画进 screencast，用户既看
 * 不见也无法拖动。这条滚动条按远端 `scrollMetrics` 的比例画出来，拖动 / 点击轨道 /
 * 键盘操作都换算成 `scrollTo` 指令，滚轮仍然走既有的 `input.wheel` 通道。
 *
 * 交互与原生滚动条对齐：按下 thumb 进入拖拽；点轨道跳一屏并把 thumb 跟到指针处；
 * 拖拽期间用本地估算值即时跟手，松手再向网关要一次权威指标（页面可能夹取超界值）。
 *
 * 滚动指标的状态刻意收在这个组件内部：`screencastFrame` 每帧都会带滚动偏移，若把
 * 它提升到 `CdpLiveEngine`，实时画面就会按帧重渲染整棵引擎（画布、状态条、控制台
 * 徽章全在内）。放在这里时每帧只重渲染这条两个 div 的滚动条。
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { useLiveScrollMetrics, type LiveScrollMetrics } from '../hooks/use-live-scroll-metrics.js';
import type { BrowserLiveSession } from '../hooks/use-browser-live-session.js';

/** thumb 的最小高度：内容很长时也要留出可点击区域。 */
const MIN_THUMB_HEIGHT = 26;
/** 键盘上下键的步长（CSS px）。 */
const KEYBOARD_STEP = 40;
/**
 * 拖拽时上行 `scrollTo` 的最小间隔（毫秒）。
 *
 * 指针事件可达 120Hz，逐条下发意味着网关每秒要做两百多次 CDP 求值（滚动 + 回读
 * 指标）；合并到 20Hz 既不会让 thumb 跟手变差（本地位置仍是逐事件更新），又能把
 * 控制通道留给真正的输入。
 */
const SCROLL_SEND_MIN_INTERVAL_MS = 50;

interface DragState {
  readonly pointerId: number;
  readonly startY: number;
  readonly startScroll: number;
  /** 可拖动距离 = track 高度 - thumb 高度。 */
  readonly span: number;
  readonly maxScroll: number;
}

interface ScrollbarTrackProps {
  readonly metrics: LiveScrollMetrics;
  /** 请求把主文档滚到指定位置（CSS px）。 */
  readonly onScrollTo: (scrollY: number) => void;
  /** 拖拽结束：向网关重取一次权威指标。 */
  readonly onScrubEnd: () => void;
  /** 引擎按画面可见区域算出的定位（相对实时画面容器）。 */
  readonly style?: CSSProperties;
}

export interface LiveScrollbarProps {
  readonly session: BrowserLiveSession;
  /** 面板不可见 / 未连接时关闭轮询；关闭后整条滚动条隐藏。 */
  readonly enabled: boolean;
  /** 页面身份（url + 刷新代号）：变化时清空旧指标并立即重取。 */
  readonly resetKey: string;
  /** 请求把主文档滚到指定位置（CSS px）。 */
  readonly onScrollTo: (scrollY: number) => void;
  /** 引擎按画面可见区域算出的定位（相对实时画面容器）。 */
  readonly style?: CSSProperties;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** jsdom / 老 WebView 不一定实现指针捕获：缺省时退化为普通冒泡事件。 */
function capturePointer(element: HTMLElement | null, pointerId: number): void {
  if (element !== null && typeof element.setPointerCapture === 'function') {
    element.setPointerCapture(pointerId);
  }
}

function releasePointer(element: HTMLElement | null, pointerId: number): void {
  if (element !== null && typeof element.releasePointerCapture === 'function') {
    element.releasePointerCapture(pointerId);
  }
}

/** 纯展示的滚动条轨道（单测直接渲染它，不依赖网关通道）。 */
export function ScrollbarTrack({ metrics, onScrollTo, onScrubEnd, style }: ScrollbarTrackProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [trackHeight, setTrackHeight] = useState(0);
  const [dragging, setDragging] = useState(false);
  /** 拖拽期间的本地位置：不等网关回包，thumb 才能跟手。 */
  const [dragScrollY, setDragScrollY] = useState<number | null>(null);

  useEffect(() => {
    const element = trackRef.current;
    if (element === null) return;
    const measure = (): void => setTrackHeight(element.getBoundingClientRect().height);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const visibleRatio =
    metrics.contentHeight > 0 ? Math.min(1, metrics.viewportHeight / metrics.contentHeight) : 1;
  const thumbHeight = Math.max(MIN_THUMB_HEIGHT, trackHeight * visibleRatio);
  const span = Math.max(0, trackHeight - thumbHeight);
  const scrollY = dragScrollY ?? metrics.scrollY;
  const thumbTop =
    metrics.maxScrollY > 0
      ? (clamp(scrollY, 0, metrics.maxScrollY) / metrics.maxScrollY) * span
      : 0;

  /** 拖拽上行节流：首条立即生效，窗口内的中间值只保留最后一个。 */
  const lastScrollSentAtRef = useRef(0);
  const pendingScrollRef = useRef<number | null>(null);
  const scrollSendTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushPendingScroll = useCallback((): void => {
    if (scrollSendTimerRef.current !== null) {
      clearTimeout(scrollSendTimerRef.current);
      scrollSendTimerRef.current = null;
    }
    const pending = pendingScrollRef.current;
    pendingScrollRef.current = null;
    if (pending === null) return;
    lastScrollSentAtRef.current = Date.now();
    onScrollTo(pending);
  }, [onScrollTo]);

  const emitScrollThrottled = useCallback(
    (value: number): void => {
      const now = Date.now();
      if (now - lastScrollSentAtRef.current >= SCROLL_SEND_MIN_INTERVAL_MS) {
        lastScrollSentAtRef.current = now;
        onScrollTo(value);
        return;
      }
      pendingScrollRef.current = value;
      if (scrollSendTimerRef.current !== null) return;
      scrollSendTimerRef.current = setTimeout(() => {
        scrollSendTimerRef.current = null;
        const pending = pendingScrollRef.current;
        pendingScrollRef.current = null;
        if (pending === null) return;
        lastScrollSentAtRef.current = Date.now();
        onScrollTo(pending);
      }, SCROLL_SEND_MIN_INTERVAL_MS);
    },
    [onScrollTo],
  );

  useEffect(
    () => () => {
      if (scrollSendTimerRef.current !== null) {
        clearTimeout(scrollSendTimerRef.current);
        scrollSendTimerRef.current = null;
      }
    },
    [],
  );

  const finishDrag = (pointerId: number): void => {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== pointerId) return;
    dragRef.current = null;
    releasePointer(trackRef.current, pointerId);
    setDragging(false);
    setDragScrollY(null);
    // 松手前的最后一个位置必须下发，否则远端会停在倒数第二个节流点。
    flushPendingScroll();
    onScrubEnd();
  };

  const handleTrackPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    // 落在 thumb 上由 thumb 自己处理（它先收到事件并阻止冒泡）。
    if (event.target !== event.currentTarget || span <= 0 || metrics.maxScrollY <= 0) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const nextTop = event.clientY - rect.top - thumbHeight / 2;
    const nextScroll = clamp((nextTop / span) * metrics.maxScrollY, 0, metrics.maxScrollY);
    dragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startScroll: nextScroll,
      span,
      maxScroll: metrics.maxScrollY,
    };
    capturePointer(trackRef.current, event.pointerId);
    setDragging(true);
    setDragScrollY(nextScroll);
    onScrollTo(nextScroll);
  };

  const handleThumbPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (span <= 0 || metrics.maxScrollY <= 0) return;
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startScroll: scrollY,
      span,
      maxScroll: metrics.maxScrollY,
    };
    capturePointer(trackRef.current, event.pointerId);
    setDragging(true);
    setDragScrollY(scrollY);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId || drag.span <= 0) return;
    event.preventDefault();
    const delta = event.clientY - drag.startY;
    const nextScroll = clamp(
      drag.startScroll + (delta / drag.span) * drag.maxScroll,
      0,
      drag.maxScroll,
    );
    setDragScrollY(nextScroll);
    emitScrollThrottled(nextScroll);
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>): void => {
    finishDrag(event.pointerId);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const pageStep = Math.max(KEYBOARD_STEP, Math.round(metrics.viewportHeight * 0.9));
    let next: number;
    switch (event.key) {
      case 'ArrowDown':
        next = scrollY + KEYBOARD_STEP;
        break;
      case 'ArrowUp':
        next = scrollY - KEYBOARD_STEP;
        break;
      case 'PageDown':
        next = scrollY + pageStep;
        break;
      case 'PageUp':
        next = scrollY - pageStep;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = metrics.maxScrollY;
        break;
      default:
        return;
    }
    event.preventDefault();
    onScrollTo(clamp(next, 0, metrics.maxScrollY));
  };

  return (
    <div
      ref={trackRef}
      role="scrollbar"
      aria-orientation="vertical"
      aria-label="页面滚动"
      aria-valuemin={0}
      aria-valuemax={Math.round(metrics.maxScrollY)}
      aria-valuenow={Math.round(scrollY)}
      tabIndex={0}
      className="cdp-live-scrollbar"
      data-dragging={dragging ? 'true' : 'false'}
      style={style}
      onPointerDown={handleTrackPointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onKeyDown={handleKeyDown}
      // 鼠标事件不能漏给实时画面：否则拖滚动条会同时在远端页面上划选 / 点击。
      onMouseDown={(event) => event.stopPropagation()}
      onMouseMove={(event) => event.stopPropagation()}
      onMouseUp={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
    >
      <div
        className="cdp-live-scrollbar__thumb"
        data-testid="cdp-live-scrollbar-thumb"
        data-dragging={dragging ? 'true' : 'false'}
        style={{ top: thumbTop, height: thumbHeight }}
        onPointerDown={handleThumbPointerDown}
      />
    </div>
  );
}

/** 接到实时通道上：拉取指标，页面可滚动时才渲染轨道。 */
export function LiveScrollbar({
  session,
  enabled,
  resetKey,
  onScrollTo,
  style,
}: LiveScrollbarProps) {
  const { metrics, requestMetrics } = useLiveScrollMetrics({ session, enabled, resetKey });

  if (metrics === null || metrics.maxScrollY <= 1) {
    return null;
  }

  return (
    <ScrollbarTrack
      metrics={metrics}
      onScrollTo={onScrollTo}
      onScrubEnd={requestMetrics}
      style={style}
    />
  );
}
