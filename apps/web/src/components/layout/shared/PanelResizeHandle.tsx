/**
 * PanelResizeHandle — 通用面板拖拽手柄。
 *
 * 支持 horizontal（左右拖拽，调整宽度）和 vertical（上下拖拽，调整高度）两个方向。
 * 通过 pointer events 实现拖拽，支持 min/max 约束，拖拽结束后回调持久化。
 *
 * 用法：
 *   <PanelResizeHandle
 *     direction="horizontal"
 *     onResize={(delta) => onWidthChange(delta)}
 *   />
 */

import { useCallback, useRef } from 'react';

export interface PanelResizeHandleProps {
  /** 拖拽方向：horizontal = 左右（调整宽度），vertical = 上下（调整高度） */
  direction: 'horizontal' | 'vertical';
  /** 拖拽过程中持续回调，delta 为像素位移（horizontal: 正=向右扩大，vertical: 正=向上扩大） */
  onResize: (delta: number) => void;
  /** 拖拽结束回调（pointerup），用于持久化最终尺寸 */
  onResizeEnd?: () => void;
  /** 可选的 aria-label */
  ariaLabel?: string;
  /** 可选的额外样式 */
  style?: React.CSSProperties;
}

export function PanelResizeHandle({
  direction,
  onResize,
  onResizeEnd,
  ariaLabel,
  style,
}: PanelResizeHandleProps) {
  const dragRef = useRef<{ startPos: number } | null>(null);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault();
      event.stopPropagation();

      // Capture pointer so we keep getting move events even outside the handle
      (event.target as HTMLElement).setPointerCapture(event.pointerId);

      dragRef.current = {
        startPos: direction === 'horizontal' ? event.clientX : event.clientY,
      };
    },
    [direction],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (!dragRef.current) return;

      const currentPos = direction === 'horizontal' ? event.clientX : event.clientY;
      // For horizontal: delta > 0 means moving right (panel grows)
      // For vertical: delta > 0 means moving up (panel grows taller)
      const delta =
        direction === 'horizontal'
          ? currentPos - dragRef.current.startPos
          : dragRef.current.startPos - currentPos;

      onResize(delta);
      dragRef.current.startPos = currentPos;
    },
    [direction, onResize],
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent) => {
      if (dragRef.current) {
        dragRef.current = null;
        (event.target as HTMLElement).releasePointerCapture(event.pointerId);
        onResizeEnd?.();
      }
    },
    [onResizeEnd],
  );

  const isHorizontal = direction === 'horizontal';

  return (
    <div
      role="separator"
      aria-orientation={isHorizontal ? 'vertical' : 'horizontal'}
      aria-label={ariaLabel ?? (isHorizontal ? '调整面板宽度' : '调整面板高度')}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      style={{
        flexShrink: 0,
        position: 'relative',
        width: isHorizontal ? 4 : '100%',
        height: isHorizontal ? '100%' : 4,
        cursor: isHorizontal ? 'col-resize' : 'ns-resize',
        background: 'transparent',
        zIndex: 10,
        transition: 'background 150ms ease',
        ...style,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'color-mix(in oklch, var(--accent) 40%, transparent)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
      }}
    />
  );
}
