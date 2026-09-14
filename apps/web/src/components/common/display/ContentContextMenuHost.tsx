import {
  useCallback,
  type CSSProperties,
  type MouseEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { contextMenuAnchorFromRect, isContextMenuKey } from './context-menu-keyboard.js';
import { readSelectionRectWithin, readSelectionTextWithin } from '../../../utils/dom/selection.js';

/** 一次菜单呼出请求：视口坐标 + 触发瞬间的选中文本。 */
export interface ContentContextMenuTrigger {
  /** 视口坐标，可直接交给 `ContextMenu` 的 x / y。 */
  x: number;
  y: number;
  /** 触发时落在宿主容器内的选中文本；空串表示没有选区。 */
  selection: string;
}

export interface ContentContextMenuHostProps {
  /** 右键或键盘呼出菜单时回调。 */
  onOpen: (trigger: ContentContextMenuTrigger) => void;
  children: ReactNode;
  /** 覆盖宿主容器的默认样式（默认是撑满父级的纵向 flex）。 */
  style?: CSSProperties;
  /** 调试 / 测试用标记，透传到宿主容器上。 */
  testId?: string;
}

const HOST_STYLE: CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
};

/**
 * 「内容面」的菜单呼出宿主：包住任意只读内容，把**两种**触发方式归一成同一个
 * `onOpen({ x, y, selection })` 回调，调用方只需接一次。
 *
 * - **鼠标右键**：直接用 `clientX/clientY`。
 * - **键盘**（Windows 菜单键 / Shift+F10）：没有坐标，退化为「容器内选区的包围盒，
 *   没有选区则容器本身」的左下角。用捕获阶段截住事件：既挡掉浏览器原生菜单，
 *   也抢在内容内部的键盘处理（例如 Monaco 的 keybinding）之前。
 *
 * 容器显式进入 tab 序列（`tabIndex=0`）：只读内容区本身不可聚焦，否则点击内容后
 * 焦点仍在别处，键盘事件根本到不了这里。
 *
 * 注：沙箱 iframe 内部的右键不会冒泡到这里（那是另一个 document），这类预览
 * （HTML / CSS / JS）保留浏览器原生菜单；同文档内的图片 / SVG 则会被接过来，
 * 用「图片另存为」换取路径与引用类动作。
 */
export function ContentContextMenuHost({
  onOpen,
  children,
  style,
  testId,
}: ContentContextMenuHostProps) {
  const handleContextMenu = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      onOpen({
        x: event.clientX,
        y: event.clientY,
        selection: readSelectionTextWithin(event.currentTarget),
      });
    },
    [onOpen],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (!isContextMenuKey(event)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const container = event.currentTarget;
      const rect = readSelectionRectWithin(container) ?? container.getBoundingClientRect();
      onOpen({
        ...contextMenuAnchorFromRect(rect),
        selection: readSelectionTextWithin(container),
      });
    },
    [onOpen],
  );

  return (
    <div
      {...(testId ? { 'data-testid': testId } : {})}
      tabIndex={0}
      style={style ? { ...HOST_STYLE, ...style } : HOST_STYLE}
      onContextMenu={handleContextMenu}
      onKeyDownCapture={handleKeyDown}
    >
      {children}
    </div>
  );
}
