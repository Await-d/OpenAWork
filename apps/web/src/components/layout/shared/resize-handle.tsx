import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';

export interface ResizeHandleBounds {
  min: number;
  max: number;
  default: number;
}

export interface ResizeHandleProps {
  width: number;
  bounds: ResizeHandleBounds;
  clamp: (width: number) => number;
  ariaLabel: string;
  /** 拖拽过程中持续回调（不持久化，保证顺滑） */
  onWidthChange: (width: number) => void;
  /** 拖拽结束 / 键盘调整 / 复位时回调（用于持久化） */
  onWidthCommit: (width: number) => void;
  /**
   * 手柄相对容器边缘的定位：`outside` 会向容器外溢出 3px（更易抓取），
   * `inside` 完全落在容器内（用于 `overflow: hidden` 的容器）。
   */
  placement?: 'inside' | 'outside';
}

const HANDLE_HEIGHT = '100%';
const HANDLE_WIDTH = 8;

const HANDLE_INDICATOR_STYLE: CSSProperties = {
  width: 2,
  height: 32,
  borderRadius: 1,
  background: 'var(--border-emphasis)',
  opacity: 0,
  transition: 'opacity 120ms ease',
};

/**
 * 可复用的面板宽度拖拽手柄（垂直分隔条）。
 *
 * - 拖拽期间只回调 `onWidthChange`，松手才 `onWidthCommit`，避免持久化抖动；
 * - 键盘：←/→ 微调 16px（Shift 64px）、Home/End 到边界、Enter 复位默认值；
 * - 双击复位默认宽度；拖拽期间锁定页面光标与文本选择。
 */
export function ResizeHandle({
  width,
  bounds,
  clamp,
  ariaLabel,
  onWidthChange,
  onWidthCommit,
  placement = 'outside',
}: ResizeHandleProps) {
  const [active, setActive] = useState(false);
  const dragStateRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const handleStyle: CSSProperties = {
    position: 'absolute',
    top: 0,
    right: placement === 'inside' ? 0 : -3,
    width: HANDLE_WIDTH,
    height: HANDLE_HEIGHT,
    cursor: 'col-resize',
    zIndex: 2,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    touchAction: 'none',
  };

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragStateRef.current = { startX: event.clientX, startWidth: width };
      setActive(true);
    },
    [width],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragStateRef.current;
      if (!drag) return;
      onWidthChange(clamp(drag.startWidth + (event.clientX - drag.startX)));
    },
    [clamp, onWidthChange],
  );

  const stopDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragStateRef.current;
      if (!drag) {
        setActive(false);
        return;
      }
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // 指针捕获可能已被浏览器释放，忽略
      }
      dragStateRef.current = null;
      setActive(false);
      onWidthCommit(clamp(drag.startWidth + (event.clientX - drag.startX)));
    },
    [clamp, onWidthCommit],
  );

  const resetToDefault = useCallback(() => {
    onWidthChange(bounds.default);
    onWidthCommit(bounds.default);
  }, [bounds.default, onWidthChange, onWidthCommit]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const step = event.shiftKey ? 64 : 16;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        const delta = event.key === 'ArrowRight' ? step : -step;
        const next = clamp(width + delta);
        onWidthChange(next);
        onWidthCommit(next);
        return;
      }
      if (event.key === 'Home') {
        event.preventDefault();
        onWidthChange(bounds.min);
        onWidthCommit(bounds.min);
        return;
      }
      if (event.key === 'End') {
        event.preventDefault();
        onWidthChange(bounds.max);
        onWidthCommit(bounds.max);
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        resetToDefault();
      }
    },
    [bounds.max, bounds.min, clamp, onWidthChange, onWidthCommit, resetToDefault, width],
  );

  // 拖拽期间保持 col-resize 光标，避免指针短暂离开命中区时闪烁。
  useEffect(() => {
    if (!active) return;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [active]);

  const setIndicatorVisible = (element: EventTarget & HTMLDivElement, visible: boolean) => {
    const indicator = element.firstElementChild as HTMLElement | null;
    if (indicator) indicator.style.opacity = visible ? '1' : '0';
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      aria-valuemin={bounds.min}
      aria-valuemax={bounds.max}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stopDrag}
      onPointerCancel={stopDrag}
      onDoubleClick={resetToDefault}
      onKeyDown={onKeyDown}
      onMouseEnter={(e) => setIndicatorVisible(e.currentTarget, true)}
      onMouseLeave={(e) => {
        if (!active) setIndicatorVisible(e.currentTarget, false);
      }}
      onFocus={(e) => setIndicatorVisible(e.currentTarget, true)}
      onBlur={(e) => {
        if (!active) setIndicatorVisible(e.currentTarget, false);
      }}
      style={handleStyle}
    >
      <div
        style={{
          ...HANDLE_INDICATOR_STYLE,
          opacity: active ? 1 : undefined,
          background: active ? 'var(--accent)' : HANDLE_INDICATOR_STYLE.background,
        }}
      />
    </div>
  );
}
