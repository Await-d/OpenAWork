/**
 * 上下文菜单在视口内的定位钳制。
 *
 * 各菜单都用 `position: fixed` + 光标坐标展开，靠近视口右下角时必须回拉，
 * 否则菜单会被裁掉一部分。菜单尺寸各不相同，因此由调用方传入预估尺寸。
 */

/** 菜单与视口边缘的最小间距。 */
export const CONTEXT_MENU_VIEWPORT_MARGIN = 8;

export interface ContextMenuEstimatedSize {
  /** 菜单宽度，用于右侧钳制。 */
  readonly width: number;
  /** 预估高度（按菜单项数量估算即可），用于底部钳制。 */
  readonly height: number;
}

export function resolveContextMenuPosition(
  x: number,
  y: number,
  size: ContextMenuEstimatedSize,
  margin: number = CONTEXT_MENU_VIEWPORT_MARGIN,
): { left: number; top: number } {
  if (typeof window === 'undefined') {
    return { left: x, top: y };
  }

  return {
    left: Math.max(margin, Math.min(x, window.innerWidth - size.width - margin)),
    top: Math.max(margin, Math.min(y, window.innerHeight - size.height - margin)),
  };
}
