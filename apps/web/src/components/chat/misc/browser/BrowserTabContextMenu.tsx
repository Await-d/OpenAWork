/**
 * BrowserTabContextMenu — 内置浏览器标签栏的右键菜单。
 *
 * 结构说明：
 * - 通过 portal 挂到 `document.body`：tab bar 容器带 `overflow-x: auto`，
 *   内联绝对定位的菜单会被它裁掉。
 * - 布局样式内联（与 `browser-chrome` 一致），hover / focus-visible / disabled
 *   等动态反馈集中在 `BrowserTabContextMenu.css`。
 */

import {
  useCallback,
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { resolveContextMenuPosition } from '../../../common/display/context-menu-position.js';
import './BrowserTabContextMenu.css';

const MENU_WIDTH = 176;
const MENU_ITEM_HEIGHT = 28;
const MENU_CHROME_HEIGHT = 16;
const MENU_ITEM_SELECTOR = '[role="menuitem"]:not(:disabled)';

const ReloadIcon = () => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M21 12a9 9 0 1 1-3-6.7" />
    <polyline points="21 3 21 9 15 9" />
  </svg>
);

const CopyLinkIcon = () => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.5 1.5" />
    <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.5-1.5" />
  </svg>
);

const CloseIcon = () => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <line x1="6" y1="6" x2="18" y2="18" />
    <line x1="18" y1="6" x2="6" y2="18" />
  </svg>
);

const CloseOthersIcon = () => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="3" y="3" width="12" height="12" rx="2" />
    <path d="M9 21h10a2 2 0 0 0 2-2V9" />
  </svg>
);

const CloseRightIcon = () => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <line x1="4" y1="4" x2="4" y2="20" />
    <path d="M9 6l5 6-5 6" />
    <line x1="18" y1="6" x2="18" y2="18" />
  </svg>
);

export interface BrowserTabContextMenuProps {
  /**
   * 右键命中的标签是否为当前激活标签。
   * 只有激活标签渲染 iframe，因此「重新加载」只在激活标签上提供。
   */
  readonly active: boolean;
  /** 命中标签的下标与总数，用于「关闭其他 / 关闭右侧」的可用性。 */
  readonly index: number;
  readonly tabCount: number;
  readonly x: number;
  readonly y: number;
  readonly onClose: () => void;
  readonly onCloseOtherTabs: () => void;
  readonly onCloseTab: () => void;
  readonly onCloseTabsToRight: () => void;
  readonly onCopyUrl: () => void;
  readonly onReload: () => void;
}

function MenuItem({
  label,
  icon,
  onClick,
  disabled,
}: {
  readonly label: string;
  readonly icon: ReactNode;
  readonly onClick: () => void;
  readonly disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className="browser-tab-menu__item"
      // 保持菜单外的输入焦点不丢（右键菜单的通用做法）。
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: '100%',
        minHeight: 26,
        padding: '5px 10px',
        border: '1px solid transparent',
        borderRadius: 5,
        background: 'transparent',
        color: 'inherit',
        fontSize: 12,
        fontWeight: 500,
        textAlign: 'left',
      }}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 14,
          height: 14,
          flexShrink: 0,
        }}
      >
        {icon}
      </span>
      {label}
    </button>
  );
}

export function BrowserTabContextMenu({
  active,
  index,
  tabCount,
  x,
  y,
  onClose,
  onCloseOtherTabs,
  onCloseTab,
  onCloseTabsToRight,
  onCopyUrl,
  onReload,
}: BrowserTabContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const itemCount = active ? 5 : 4;
  const position = resolveContextMenuPosition(x, y, {
    width: MENU_WIDTH,
    height: itemCount * MENU_ITEM_HEIGHT + MENU_CHROME_HEIGHT,
  });

  // 点击/右键菜单外的任意位置关闭。
  // 关键：右键 (mousedown button=2) 时关闭当前菜单但**不**阻止事件传播，
  // 这样下层标签的 contextmenu handler 仍能触发，立刻打开新菜单。
  useEffect(() => {
    const handleMouseDown = (event: MouseEvent) => {
      if (menuRef.current && menuRef.current.contains(event.target as Node)) {
        return;
      }
      onClose();
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleMouseDown, true);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown, true);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  const focusItemAt = useCallback((targetIndex: number) => {
    const items = menuRef.current?.querySelectorAll<HTMLButtonElement>(MENU_ITEM_SELECTOR);
    if (!items || items.length === 0) {
      return;
    }

    items[(targetIndex + items.length) % items.length]?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    focusItemAt(0);
  }, [focusItemAt]);

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Tab') {
        onClose();
        return;
      }

      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
        return;
      }

      event.preventDefault();
      const items = Array.from(
        menuRef.current?.querySelectorAll<HTMLButtonElement>(MENU_ITEM_SELECTOR) ?? [],
      );
      const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
      focusItemAt(event.key === 'ArrowDown' ? currentIndex + 1 : currentIndex - 1);
    },
    [focusItemAt, onClose],
  );

  const runAction = useCallback(
    (action: () => void) => {
      action();
      onClose();
    },
    [onClose],
  );

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label="浏览器标签操作菜单"
      className="browser-tab-menu"
      onKeyDown={handleKeyDown}
      style={{
        position: 'fixed',
        zIndex: 9999,
        left: position.left,
        top: position.top,
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        minWidth: MENU_WIDTH,
        padding: 4,
        border: '1px solid var(--border-default)',
        borderRadius: 8,
        background: 'var(--bg-overlay)',
        boxShadow: 'var(--shadow-lg)',
        color: 'var(--fg-default)',
      }}
    >
      {active ? (
        <>
          <MenuItem label="重新加载" icon={<ReloadIcon />} onClick={() => runAction(onReload)} />
          <hr className="browser-tab-menu__separator" />
        </>
      ) : null}

      <MenuItem label="复制链接" icon={<CopyLinkIcon />} onClick={() => runAction(onCopyUrl)} />
      <hr className="browser-tab-menu__separator" />

      <MenuItem label="关闭标签" icon={<CloseIcon />} onClick={() => runAction(onCloseTab)} />
      <MenuItem
        label="关闭其他标签"
        icon={<CloseOthersIcon />}
        disabled={tabCount <= 1}
        onClick={() => runAction(onCloseOtherTabs)}
      />
      <MenuItem
        label="关闭右侧标签"
        icon={<CloseRightIcon />}
        disabled={index >= tabCount - 1}
        onClick={() => runAction(onCloseTabsToRight)}
      />
    </div>,
    document.body,
  );
}
