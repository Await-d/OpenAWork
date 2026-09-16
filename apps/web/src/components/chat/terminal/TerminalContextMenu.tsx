/**
 * 终端右键菜单（自绘浮层，无第三方依赖）。
 *
 * 为什么要自己写：浏览器原生右键菜单在终端里体验很差（没有复制/粘贴/搜索
 * 这类终端语义），而 xterm 不提供菜单能力。
 *
 * 可访问性与可用性约束：
 *  - `role="menu"` + `role="menuitem"` / `menuitemcheckbox`；
 *  - ↑/↓ 在可用项之间循环（跳过 disabled），Enter/Space 触发，Esc 关闭；
 *  - 点击菜单外部、滚动、缩放窗口都会关闭（浮层是 fixed 定位，不跟滚）；
 *  - 坐标做视口内夹取，375px 宽下也不会溢出屏幕右侧。
 *
 * 用 portal 挂到 `document.body`：宿主链上存在 `contain: content`（fusion 布局的
 * 内容容器），CSS containment 会把 `position: fixed` 的包含块从视口改成该祖先，
 * 于是菜单会按祖先偏移出现在鼠标右侧（实测 1280px 下右移 353px），而 JS 的
 * `window.innerWidth` 夹取仍按视口计算 → 菜单溢出屏幕右侧。挂到 body 后
 * fixed 重新相对视口，位置与夹取同时成立。
 */

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckIcon } from './TerminalIcons.js';

export interface TerminalContextMenuItem {
  id: string;
  label: string;
  hint?: string;
  disabled?: boolean;
  /** 原生 title 提示；disabled 项用它解释为什么不可用。 */
  title?: string;
  /** 存在时按 `menuitemcheckbox` 渲染（如「选中即复制」开关）。 */
  checked?: boolean;
  /** 与前一项之间加分隔线。 */
  separatorBefore?: boolean;
  icon?: React.ReactNode;
  onSelect: () => void;
}

export interface TerminalContextMenuProps {
  x: number;
  y: number;
  items: TerminalContextMenuItem[];
  onClose: () => void;
}

const VIEWPORT_MARGIN = 8;

/**
 * 打开后的「滚动关闭」静默窗口。
 *
 * 为什么需要：xterm 的 `rightClickHandler` 会把 helper textarea 移到鼠标位置
 * 并 focus，浏览器随之对终端的可滚动容器触发一次 `scroll`。如果立刻响应
 * `scroll` 关闭，菜单会在弹出后 ~5ms 被自己关掉 —— 实测右键菜单完全无法
 * 停留，用户看到的只是闪一下。窗口内的 scroll 视为打开噪声；真正的用户
 * 滚动（滚轮 / 触控板 / 滚动条）都在其后发生，仍会关闭菜单。
 */
const SCROLL_DISMISS_GRACE_MS = 200;

function firstEnabledId(items: readonly TerminalContextMenuItem[]): string | null {
  return items.find((item) => !item.disabled)?.id ?? null;
}

export function TerminalContextMenu({ x, y, items, onClose }: TerminalContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();
  const [activeId, setActiveId] = useState<string | null>(() => firstEnabledId(items));
  const [position, setPosition] = useState({ left: x, top: y });
  // 挂载时刻只取一次：effect 会随父级重渲染重跑，若每次重算会不断续期静默窗口。
  const [openedAt] = useState(() => performance.now());

  useLayoutEffect(() => {
    const element = menuRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const maxLeft = Math.max(VIEWPORT_MARGIN, window.innerWidth - rect.width - VIEWPORT_MARGIN);
    const maxTop = Math.max(VIEWPORT_MARGIN, window.innerHeight - rect.height - VIEWPORT_MARGIN);
    setPosition({
      left: Math.min(Math.max(x, VIEWPORT_MARGIN), maxLeft),
      top: Math.min(Math.max(y, VIEWPORT_MARGIN), maxTop),
    });
  }, [x, y]);

  useEffect(() => {
    menuRef.current?.focus();
  }, []);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const handleDismiss = () => onClose();
    const handleScroll = () => {
      if (performance.now() - openedAt < SCROLL_DISMISS_GRACE_MS) return;
      onClose();
    };

    window.addEventListener('mousedown', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('resize', handleDismiss);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('resize', handleDismiss);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [onClose]);

  const moveActive = (delta: number) => {
    const enabled = items.filter((item) => !item.disabled);
    if (enabled.length === 0) return;
    const currentIndex = enabled.findIndex((item) => item.id === activeId);
    const nextIndex =
      currentIndex === -1 ? 0 : (currentIndex + delta + enabled.length) % enabled.length;
    setActiveId(enabled[nextIndex]?.id ?? null);
  };

  const activate = (item: TerminalContextMenuItem) => {
    if (item.disabled) return;
    item.onSelect();
    onClose();
  };

  return createPortal(
    <div
      ref={menuRef}
      id={menuId}
      role="menu"
      aria-label="终端操作"
      aria-activedescendant={activeId ? `${menuId}-${activeId}` : undefined}
      tabIndex={-1}
      data-testid="terminal-context-menu"
      className="terminal-context-menu"
      style={{ left: position.left, top: position.top }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          moveActive(1);
          return;
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          moveActive(-1);
          return;
        }
        if (event.key === 'Enter' || event.key === ' ') {
          const item = items.find((candidate) => candidate.id === activeId);
          if (item) {
            event.preventDefault();
            activate(item);
          }
        }
      }}
    >
      {items.map((item) => (
        <div key={item.id}>
          {item.separatorBefore ? (
            <div className="terminal-context-menu__separator" role="separator" />
          ) : null}
          <button
            type="button"
            id={`${menuId}-${item.id}`}
            role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
            aria-checked={item.checked}
            aria-disabled={item.disabled}
            disabled={item.disabled}
            title={item.title}
            data-active={item.id === activeId}
            data-testid={`terminal-context-menu-${item.id}`}
            className="terminal-context-menu__item"
            onMouseEnter={() => setActiveId(item.id)}
            onClick={() => activate(item)}
          >
            <span className="terminal-context-menu__icon">
              {item.checked ? <CheckIcon size={12} /> : (item.icon ?? null)}
            </span>
            <span className="terminal-context-menu__label">{item.label}</span>
            {item.hint ? <span className="terminal-context-menu__hint">{item.hint}</span> : null}
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}
