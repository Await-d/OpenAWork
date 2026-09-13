/**
 * TitlebarTabContextMenu — 顶部会话标签的右键快捷菜单。
 *
 * 提供标签级快捷操作（关闭 / 关闭其他 / 关闭全部）与会话级快捷操作
 * （置顶、复制会话 ID、删除会话）。
 *
 * 通过 portal 挂到 `document.body`：标签列表容器带 `overflow-x: auto`，
 * 内联绝对定位的菜单会被裁剪。
 */

import { useCallback, useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import './TitlebarTabContextMenu.css';

const MENU_MARGIN = 8;
const MENU_MIN_WIDTH = 200;
const ESTIMATED_MENU_HEIGHT = 272;
const MENU_ITEM_SELECTOR = '[role="menuitem"]:not(:disabled)';

const PinIcon = () => (
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
    <line x1="12" y1="17" x2="12" y2="22" />
    <path d="M5 17H19V15L17 9V4H18V2H6V4H7V9L5 15V17Z" />
  </svg>
);

const CopyIcon = () => (
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
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
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

const CloseAllIcon = () => (
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
    <path d="M4 4h16v16H4z" />
    <line x1="9" y1="9" x2="15" y2="15" />
    <line x1="15" y1="9" x2="9" y2="15" />
  </svg>
);

const TrashIcon = () => (
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
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
  </svg>
);

export interface TitlebarTabContextMenuProps {
  readonly x: number;
  readonly y: number;
  /** 标签标题，用于菜单头部提示当前操作的标签。 */
  readonly tabTitle: string;
  /** 当前标签总数，用于判断「关闭其他 / 关闭全部」是否可用。 */
  readonly tabCount: number;
  /** 是否为已绑定会话的标签（草稿标签不支持置顶 / 复制 ID / 删除会话）。 */
  readonly isSessionTab: boolean;
  readonly isPinned: boolean;
  /** 会话是否正在删除中。 */
  readonly deleting: boolean;
  readonly onClose: () => void;
  readonly onCloseTab: () => void;
  readonly onCloseOtherTabs: () => void;
  readonly onCloseAllTabs: () => void;
  readonly onTogglePin: () => void;
  readonly onCopySessionId: () => void;
  readonly onDeleteSession: () => void;
}

function resolveMenuPosition(x: number, y: number): { left: number; top: number } {
  if (typeof window === 'undefined') {
    return { left: x, top: y };
  }

  return {
    left: Math.max(MENU_MARGIN, Math.min(x, window.innerWidth - MENU_MIN_WIDTH - MENU_MARGIN)),
    top: Math.max(MENU_MARGIN, Math.min(y, window.innerHeight - ESTIMATED_MENU_HEIGHT)),
  };
}

export function TitlebarTabContextMenu({
  x,
  y,
  tabTitle,
  tabCount,
  isSessionTab,
  isPinned,
  deleting,
  onClose,
  onCloseTab,
  onCloseOtherTabs,
  onCloseAllTabs,
  onTogglePin,
  onCopySessionId,
  onDeleteSession,
}: TitlebarTabContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  // 位置直接由坐标派生：同一实例被复用到另一个标签时（右键切换标签）也要跟着移动。
  const position = resolveMenuPosition(x, y);
  const trimmedTitle = tabTitle.trim();

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

  const focusItemAt = useCallback((index: number) => {
    const items = menuRef.current?.querySelectorAll<HTMLButtonElement>(MENU_ITEM_SELECTOR);
    if (!items || items.length === 0) {
      return;
    }

    items[(index + items.length) % items.length]?.focus({ preventScroll: true });
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
      aria-label="标签操作菜单"
      className="titlebar-tab-menu"
      style={{ left: position.left, top: position.top }}
      onKeyDown={handleKeyDown}
    >
      {trimmedTitle.length > 0 ? (
        <div className="titlebar-tab-menu__title" title={tabTitle}>
          {trimmedTitle}
        </div>
      ) : null}

      {isSessionTab ? (
        <>
          <button
            type="button"
            role="menuitem"
            className="titlebar-tab-menu__item"
            onClick={() => runAction(onTogglePin)}
          >
            <span className="titlebar-tab-menu__icon">
              <PinIcon />
            </span>
            <span className="titlebar-tab-menu__label">{isPinned ? '取消置顶' : '置顶会话'}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="titlebar-tab-menu__item"
            onClick={() => runAction(onCopySessionId)}
          >
            <span className="titlebar-tab-menu__icon">
              <CopyIcon />
            </span>
            <span className="titlebar-tab-menu__label">复制会话 ID</span>
          </button>
          <hr className="titlebar-tab-menu__separator" />
        </>
      ) : null}

      <button
        type="button"
        role="menuitem"
        className="titlebar-tab-menu__item"
        onClick={() => runAction(onCloseTab)}
      >
        <span className="titlebar-tab-menu__icon">
          <CloseIcon />
        </span>
        <span className="titlebar-tab-menu__label">关闭标签</span>
      </button>
      <button
        type="button"
        role="menuitem"
        className="titlebar-tab-menu__item"
        disabled={tabCount <= 1}
        onClick={() => runAction(onCloseOtherTabs)}
      >
        <span className="titlebar-tab-menu__icon">
          <CloseOthersIcon />
        </span>
        <span className="titlebar-tab-menu__label">关闭其他标签</span>
      </button>
      <button
        type="button"
        role="menuitem"
        className="titlebar-tab-menu__item"
        onClick={() => runAction(onCloseAllTabs)}
      >
        <span className="titlebar-tab-menu__icon">
          <CloseAllIcon />
        </span>
        <span className="titlebar-tab-menu__label">关闭全部标签</span>
      </button>

      {isSessionTab ? (
        <>
          <hr className="titlebar-tab-menu__separator" />
          <button
            type="button"
            role="menuitem"
            className="titlebar-tab-menu__item"
            data-tone="danger"
            disabled={deleting}
            onClick={() => runAction(onDeleteSession)}
          >
            <span className="titlebar-tab-menu__icon">
              <TrashIcon />
            </span>
            <span className="titlebar-tab-menu__label">{deleting ? '删除中…' : '删除会话'}</span>
          </button>
        </>
      ) : null}
    </div>,
    document.body,
  );
}
