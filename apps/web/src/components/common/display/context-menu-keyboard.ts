/**
 * 键盘呼出上下文菜单（Windows 菜单键 / Shift+F10）的公共判定与定位。
 *
 * 鼠标右键自带 `clientX/clientY`，键盘路径没有坐标，必须从「当前焦点或选区」
 * 反推锚点——否则菜单只能固定挂在屏幕某个角落。把判定与定位抽成纯函数，
 * 好让各个内容面复用同一套行为并能单独测。
 */

export interface ContextMenuKeyEventLike {
  key: string;
  shiftKey: boolean;
}

/**
 * 是否为「呼出上下文菜单」的键盘操作。
 *
 * - Windows 菜单键：Chromium 上报 `key === 'ContextMenu'`，个别旧环境上报 `'Apps'`。
 * - 通用等价键：`Shift+F10`（Windows / Linux 惯例；macOS 外接键盘同样可用）。
 */
export function isContextMenuKey(event: ContextMenuKeyEventLike): boolean {
  if (event.key === 'ContextMenu' || event.key === 'Apps') {
    return true;
  }
  return event.shiftKey && event.key === 'F10';
}

/**
 * 由锚定矩形推导菜单左上角坐标：贴在矩形**左下角**，与原生菜单从光标下沿展开一致。
 *
 * 坐标必须与 `clientX/clientY` 同一参照系（视口），因为 `ContextMenu` 用的是
 * `position: fixed`；`getBoundingClientRect()` 正好满足。
 */
export function contextMenuAnchorFromRect(rect: Pick<DOMRect, 'left' | 'top' | 'height'>): {
  x: number;
  y: number;
} {
  return { x: Math.round(rect.left), y: Math.round(rect.top + rect.height) };
}
