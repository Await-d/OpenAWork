/**
 * 可拖拽分隔条
 *
 * 用于三栏布局中栏与栏之间的可拖拽调整宽度。
 * - 鼠标按下拖拽实时调整宽度
 * - 双击恢复默认宽度
 * - 支持触摸拖拽
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';

const DIVIDER_STYLE: CSSProperties = {
  position: 'relative',
  flexShrink: 0,
  width: 10,
  cursor: 'col-resize',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 5,
  transition: 'background 120ms ease',
};

const DIVIDER_LINE_STYLE: CSSProperties = {
  width: 1,
  height: '100%',
  background: 'color-mix(in srgb, var(--border-default) 50%, transparent)',
  transition: 'background 120ms ease, width 120ms ease',
};

const DIVIDER_LINE_HOVER_STYLE: CSSProperties = {
  ...DIVIDER_LINE_STYLE,
  width: 3,
  background: 'var(--accent)',
};

export interface ResizableDividerProps {
  /** 当前左侧栏宽度（px） */
  width: number;
  /** 最小宽度（px） */
  minWidth: number;
  /** 最大宽度（px） */
  maxWidth: number;
  /** 默认宽度（双击恢复） */
  defaultWidth: number;
  /** 宽度变化回调 */
  onResize: (width: number) => void;
  /** 双击收起/展开回调 */
  onToggleCollapse?: () => void;
}

export function ResizableDivider({
  width,
  minWidth,
  maxWidth,
  defaultWidth,
  onResize,
  onToggleCollapse,
}: ResizableDividerProps) {
  const [dragging, setDragging] = useState(false);
  const [hovered, setHovered] = useState(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(width);

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setDragging(true);
      startXRef.current = e.clientX;
      startWidthRef.current = width;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [width],
  );

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragging) return;
      e.preventDefault();
      const delta = e.clientX - startXRef.current;
      const next = Math.max(minWidth, Math.min(maxWidth, startWidthRef.current + delta));
      onResize(next);
    },
    [dragging, maxWidth, minWidth, onResize],
  );

  const handlePointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragging) return;
      setDragging(false);
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // pointer capture 可能已经释放
      }
    },
    [dragging],
  );

  const handleDoubleClick = useCallback(() => {
    if (onToggleCollapse) {
      onToggleCollapse();
    } else {
      onResize(defaultWidth);
    }
  }, [defaultWidth, onResize, onToggleCollapse]);

  // 拖拽时禁用文本选择
  useEffect(() => {
    if (!dragging) return undefined;
    const prevUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = 'none';
    return () => {
      document.body.style.userSelect = prevUserSelect;
    };
  }, [dragging]);

  const showHover = hovered || dragging;

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="拖拽调整侧边栏宽度，双击收起/展开"
      tabIndex={0}
      style={{
        ...DIVIDER_STYLE,
        background: showHover ? 'color-mix(in srgb, var(--accent) 8%, transparent)' : 'transparent',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onDoubleClick={handleDoubleClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          onResize(Math.max(minWidth, width - 16));
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          onResize(Math.min(maxWidth, width + 16));
        } else if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleDoubleClick();
        }
      }}
    >
      <div style={showHover ? DIVIDER_LINE_HOVER_STYLE : DIVIDER_LINE_STYLE} />
    </div>
  );
}
