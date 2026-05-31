import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import {
  SESSIONS_LIST_PANE_WIDTH_BOUNDS,
  clampSessionsListPaneWidth,
} from '../../../stores/ui/uiState.js';

const HANDLE_BASE_STYLE: CSSProperties = {
  position: 'absolute',
  top: 0,
  right: -3,
  width: 6,
  height: '100%',
  cursor: 'col-resize',
  zIndex: 2,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'transparent',
};

const HANDLE_INDICATOR_STYLE: CSSProperties = {
  width: 2,
  height: 32,
  borderRadius: 1,
  background: 'var(--border-emphasis)',
  opacity: 0,
  transition: 'opacity 120ms ease',
};

interface SessionsListResizeHandleProps {
  width: number;
  onWidthChange: (width: number) => void;
  onWidthCommit: (width: number) => void;
}

/**
 * Drag handle on the right edge of the sessions list pane. Updates width
 * locally during the drag (smooth) and only persists to the store on
 * `onWidthCommit` so we avoid storage thrash on every pixel.
 *
 * Keyboard support: when focused, ←/→ nudges by 16px, Shift+arrow by 64px,
 * Home/End jump to bounds, Enter resets to default.
 */
export function SessionsListResizeHandle({
  width,
  onWidthChange,
  onWidthCommit,
}: SessionsListResizeHandleProps) {
  const [active, setActive] = useState(false);
  const dragStateRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragStateRef.current = { startX: event.clientX, startWidth: width };
      setActive(true);
    },
    [width],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragStateRef.current;
      if (!drag) return;
      const next = clampSessionsListPaneWidth(drag.startWidth + (event.clientX - drag.startX));
      onWidthChange(next);
    },
    [onWidthChange],
  );

  const stopDrag = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragStateRef.current;
      if (!drag) {
        setActive(false);
        return;
      }
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        /* noop */
      }
      dragStateRef.current = null;
      setActive(false);
      onWidthCommit(clampSessionsListPaneWidth(drag.startWidth + (event.clientX - drag.startX)));
    },
    [onWidthCommit],
  );

  const onDoubleClick = useCallback(() => {
    onWidthCommit(SESSIONS_LIST_PANE_WIDTH_BOUNDS.default);
    onWidthChange(SESSIONS_LIST_PANE_WIDTH_BOUNDS.default);
  }, [onWidthChange, onWidthCommit]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const step = event.shiftKey ? 64 : 16;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        const next = clampSessionsListPaneWidth(width - step);
        onWidthChange(next);
        onWidthCommit(next);
        return;
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        const next = clampSessionsListPaneWidth(width + step);
        onWidthChange(next);
        onWidthCommit(next);
        return;
      }
      if (event.key === 'Home') {
        event.preventDefault();
        onWidthChange(SESSIONS_LIST_PANE_WIDTH_BOUNDS.min);
        onWidthCommit(SESSIONS_LIST_PANE_WIDTH_BOUNDS.min);
        return;
      }
      if (event.key === 'End') {
        event.preventDefault();
        onWidthChange(SESSIONS_LIST_PANE_WIDTH_BOUNDS.max);
        onWidthCommit(SESSIONS_LIST_PANE_WIDTH_BOUNDS.max);
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        onWidthChange(SESSIONS_LIST_PANE_WIDTH_BOUNDS.default);
        onWidthCommit(SESSIONS_LIST_PANE_WIDTH_BOUNDS.default);
      }
    },
    [onWidthChange, onWidthCommit, width],
  );

  // While the user is dragging, keep the document cursor as col-resize so it
  // doesn't flicker if the pointer briefly leaves the handle hit area.
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

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="调整会话列表宽度"
      aria-valuemin={SESSIONS_LIST_PANE_WIDTH_BOUNDS.min}
      aria-valuemax={SESSIONS_LIST_PANE_WIDTH_BOUNDS.max}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stopDrag}
      onPointerCancel={stopDrag}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
      onMouseEnter={(e) => {
        const indicator = e.currentTarget.firstElementChild as HTMLElement | null;
        if (indicator) indicator.style.opacity = '1';
      }}
      onMouseLeave={(e) => {
        if (active) return;
        const indicator = e.currentTarget.firstElementChild as HTMLElement | null;
        if (indicator) indicator.style.opacity = '0';
      }}
      onFocus={(e) => {
        const indicator = e.currentTarget.firstElementChild as HTMLElement | null;
        if (indicator) indicator.style.opacity = '1';
      }}
      onBlur={(e) => {
        if (active) return;
        const indicator = e.currentTarget.firstElementChild as HTMLElement | null;
        if (indicator) indicator.style.opacity = '0';
      }}
      style={HANDLE_BASE_STYLE}
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
