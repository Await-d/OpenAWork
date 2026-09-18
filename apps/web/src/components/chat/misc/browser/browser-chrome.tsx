/**
 * 内置浏览器的 chrome 组件：标签栏、导航图标按钮、书签下拉。
 *
 * 从 `BuiltInBrowser.tsx` 抽出，均为纯展示组件，状态由宿主持有。
 */

import { useEffect, useRef, type ReactNode } from 'react';
import { TAB_LIMIT, deriveTabTitle, type Bookmark, type BrowserTab } from './browser-storage.js';

// ---------------------------------------------------------------------------
// Tab Bar
// ---------------------------------------------------------------------------

export function BrowserTabBar(props: {
  tabs: BrowserTab[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onAddTab: () => void;
  canAddTab: boolean;
  /** 标签右键：由宿主决定菜单内容与落点（坐标来自鼠标事件）。 */
  onTabContextMenu?: (tabId: string, x: number, y: number) => void;
}) {
  const { tabs, activeTabId, onSelectTab, onCloseTab, onAddTab, canAddTab, onTabContextMenu } =
    props;
  return (
    <div
      data-testid="browser-tab-bar"
      style={{
        display: 'flex',
        alignItems: 'stretch',
        gap: 2,
        padding: '4px 6px 0',
        borderBottom: '1px solid var(--border-subtle)',
        background: 'var(--bg-base)',
        flexShrink: 0,
        overflowX: 'auto',
        scrollbarWidth: 'thin',
      }}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelectTab(tab.id)}
            onAuxClick={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                onCloseTab(tab.id);
              }
            }}
            onContextMenu={(e) => {
              if (!onTabContextMenu) return;
              e.preventDefault();
              onTabContextMenu(tab.id, e.clientX, e.clientY);
            }}
            title={tab.url}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              minWidth: 0,
              maxWidth: 180,
              padding: '0 4px 0 9px',
              height: 24,
              borderRadius: '6px 6px 0 0',
              border: '1px solid var(--border-subtle)',
              borderBottom: isActive ? 'none' : '1px solid var(--border-subtle)',
              marginBottom: -1,
              background: isActive ? 'var(--bg-overlay)' : 'transparent',
              color: isActive ? 'var(--fg-strong)' : 'var(--fg-muted)',
              fontSize: 10.5,
              fontWeight: isActive ? 600 : 500,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              userSelect: 'none',
              flexShrink: 0,
            }}
          >
            {tab.faviconUrl ? (
              <img
                src={tab.faviconUrl}
                alt=""
                width={14}
                height={14}
                style={{
                  flexShrink: 0,
                  borderRadius: 2,
                  objectFit: 'contain',
                }}
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = 'none';
                }}
              />
            ) : null}
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                minWidth: 0,
                maxWidth: 140,
              }}
            >
              {tab.title || deriveTabTitle(tab.url)}
            </span>
            <button
              type="button"
              aria-label="关闭标签"
              onClick={(e) => {
                e.stopPropagation();
                onCloseTab(tab.id);
              }}
              className="ui-hover-icon-pop"
              style={{
                width: 16,
                height: 16,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: 'none',
                borderRadius: 4,
                background: 'transparent',
                color: 'var(--fg-muted)',
                fontSize: 11,
                lineHeight: 1,
                cursor: 'pointer',
                opacity: 0.7,
                flexShrink: 0,
              }}
            >
              ✕
            </button>
          </div>
        );
      })}
      <button
        type="button"
        onClick={onAddTab}
        title={canAddTab ? '新建标签页' : `已达上限 (${TAB_LIMIT})`}
        disabled={!canAddTab}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 24,
          height: 24,
          borderRadius: 4,
          border: 'none',
          background: 'transparent',
          color: 'var(--fg-muted)',
          fontSize: 13,
          lineHeight: 1,
          cursor: canAddTab ? 'pointer' : 'not-allowed',
          opacity: canAddTab ? 1 : 0.4,
          marginBottom: -1,
          flexShrink: 0,
        }}
      >
        +
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 通用 nav 按钮
// ---------------------------------------------------------------------------

export function NavButton(props: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  icon: ReactNode;
}) {
  const { title, onClick, disabled, icon } = props;
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      style={{
        width: 26,
        height: 26,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: '1px solid var(--border-subtle)',
        borderRadius: 6,
        background: 'transparent',
        color: disabled ? 'var(--text-4)' : 'var(--fg-default)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        flexShrink: 0,
        fontSize: 0,
      }}
      className="ui-hover-icon-pop"
    >
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {icon}
      </svg>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Bookmarks Dropdown
// ---------------------------------------------------------------------------

export function BrowserBookmarksDropdown(props: {
  bookmarks: Bookmark[];
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onSelect: (url: string) => void;
  onRemove: (id: string) => void;
}) {
  const { bookmarks, open, onToggle, onClose, onSelect, onRemove } = props;
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (wrapRef.current && wrapRef.current.contains(target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('mousedown', onPointer, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('mousedown', onPointer, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open, onClose]);

  return (
    <div ref={wrapRef} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        type="button"
        title="书签"
        onClick={onToggle}
        aria-expanded={open}
        style={{
          width: 26,
          height: 26,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: open ? '1px solid var(--accent)' : '1px solid var(--border-subtle)',
          borderRadius: 6,
          background: open ? 'color-mix(in oklch, var(--accent) 12%, transparent)' : 'transparent',
          color: open ? 'var(--accent)' : 'var(--fg-default)',
          cursor: 'pointer',
          fontSize: 0,
        }}
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="14" y2="18" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            right: 0,
            zIndex: 30,
            minWidth: 280,
            maxWidth: 360,
            maxHeight: 320,
            overflowY: 'auto',
            padding: '4px 0',
            border: '1px solid var(--border-default)',
            borderRadius: 8,
            background: 'var(--bg-overlay)',
            boxShadow: 'var(--shadow-lg)',
          }}
        >
          {bookmarks.length === 0 ? (
            <div
              style={{
                padding: '14px 16px',
                color: 'var(--fg-muted)',
                fontSize: 11,
                textAlign: 'center',
              }}
            >
              暂无书签 · 点击地址栏星形图标收藏
            </div>
          ) : (
            bookmarks
              .slice()
              .sort((a, b) => b.createdAt - a.createdAt)
              .map((bm) => (
                <div
                  key={bm.id}
                  role="menuitem"
                  onClick={() => onSelect(bm.url)}
                  className="ui-hover-icon-pop"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 10px',
                    cursor: 'pointer',
                    minWidth: 0,
                  }}
                >
                  {bm.faviconUrl ? (
                    <img
                      src={bm.faviconUrl}
                      alt=""
                      width={14}
                      height={14}
                      style={{ flexShrink: 0, borderRadius: 2 }}
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  ) : (
                    <span style={{ width: 14, flexShrink: 0 }} />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: 'var(--fg-strong)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {bm.title}
                    </div>
                    <div
                      style={{
                        fontSize: 9.5,
                        color: 'var(--fg-muted)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontFamily: 'var(--font-mono, monospace)',
                      }}
                    >
                      {bm.url}
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label="删除书签"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemove(bm.id);
                    }}
                    style={{
                      width: 18,
                      height: 18,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      border: 'none',
                      borderRadius: 4,
                      background: 'transparent',
                      color: 'var(--fg-muted)',
                      fontSize: 11,
                      lineHeight: 1,
                      cursor: 'pointer',
                      opacity: 0.7,
                      flexShrink: 0,
                    }}
                    className="ui-hover-icon-pop"
                    data-tone="danger"
                  >
                    ✕
                  </button>
                </div>
              ))
          )}
        </div>
      )}
    </div>
  );
}
