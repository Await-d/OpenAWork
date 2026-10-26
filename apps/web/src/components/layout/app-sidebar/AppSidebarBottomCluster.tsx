import type { Dispatch, RefObject, SetStateAction } from 'react';
import { createPortal } from 'react-dom';
import { NavLink } from 'react-router';

import { BOTTOM_NAV_ITEMS, railIcon } from '../nav/RailIcon.js';
import type { NavItem } from '../nav/RailIcon.js';
import { navItemStyle } from './app-sidebar-hooks.js';

type AppSidebarBottomClusterProps = {
  readonly expanded: boolean;
  readonly showMoreMenu: boolean;
  readonly setShowMoreMenu: Dispatch<SetStateAction<boolean>>;
  readonly moreBtnRef: RefObject<HTMLButtonElement | null>;
  readonly moreMenuRef: RefObject<HTMLDivElement | null>;
  readonly moreMenuPos: { bottom: number; left: number } | null;
  readonly theme: 'dark' | 'light';
  readonly onToggleTheme?: () => void;
  readonly onLogout?: () => void;
  readonly preloadRoute: (path: string) => void;
};

/**
 * 侧栏底部区块：「更多」按钮与它的弹出菜单（通知 / 主题 / 设置 / 退出）。
 *
 * 弹出层的定位与关闭由父组件持有（`moreMenuPos` / `setShowMoreMenu`），
 * 因为侧栏折叠、外部点击与 Esc 监听都发生在父组件里。
 */
export function AppSidebarBottomCluster({
  expanded,
  showMoreMenu,
  setShowMoreMenu,
  moreBtnRef,
  moreMenuRef,
  moreMenuPos,
  theme,
  onToggleTheme,
  onLogout,
  preloadRoute,
}: AppSidebarBottomClusterProps) {
  return (
    <>
      {/* ═══ 底部区块 ═══ */}
      <div className="nav-rail-divider" aria-hidden="true" />
      <div
        style={{
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
          padding: '2px 6px 6px',
        }}
      >
        <button
          ref={moreBtnRef}
          type="button"
          title="更多选项"
          aria-label="更多选项"
          aria-pressed={showMoreMenu}
          onClick={() => setShowMoreMenu((v) => !v)}
          className="nav-rail-btn"
          style={{
            ...navItemStyle,
            border: 'none',
            cursor: 'pointer',
            justifyContent: expanded ? 'flex-start' : 'center',
            padding: expanded ? '0 12px' : '0',
            color: showMoreMenu ? 'var(--accent)' : 'var(--fg-muted)',
            background: showMoreMenu
              ? 'color-mix(in oklch, var(--accent) 12%, transparent)'
              : 'transparent',
          }}
        >
          <span className="nav-rail-icon">
            <svg
              aria-hidden="true"
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="5" r="1" fill="currentColor" />
              <circle cx="12" cy="12" r="1" fill="currentColor" />
              <circle cx="12" cy="19" r="1" fill="currentColor" />
            </svg>
          </span>
          {expanded && (
            <span
              style={{
                fontSize: 12,
                fontWeight: 500,
                whiteSpace: 'nowrap',
              }}
            >
              更多
            </span>
          )}
        </button>

        {/* ── 弹出菜单 ── */}
        {showMoreMenu &&
          moreMenuPos &&
          createPortal(
            <div
              ref={moreMenuRef}
              style={{
                position: 'fixed',
                bottom: moreMenuPos.bottom,
                left: moreMenuPos.left,
                transform: 'translateX(-50%)',
                zIndex: 9999,
                minWidth: 180,
                background: 'var(--bg-raised, var(--bg-base))',
                border: '1px solid var(--border-default)',
                borderRadius: 10,
                boxShadow: '0 8px 30px rgba(0,0,0,0.25)',
                padding: '4px',
                display: 'flex',
                flexDirection: 'column',
                gap: 1,
              }}
            >
              {/* 通知 */}
              <NavLink
                to="/settings/notification"
                onClick={() => setShowMoreMenu(false)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--fg-default)',
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: 'pointer',
                  textAlign: 'left',
                  textDecoration: 'none',
                  boxSizing: 'border-box',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--bg-overlay)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                <span
                  style={{
                    display: 'flex',
                    width: 18,
                    height: 18,
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                  </svg>
                </span>
                <span>通知</span>
              </NavLink>

              {/* 主题切换 */}
              {onToggleTheme && (
                <button
                  type="button"
                  onClick={() => {
                    onToggleTheme();
                    setShowMoreMenu(false);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 8,
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--fg-default)',
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: 'pointer',
                    textAlign: 'left',
                    boxSizing: 'border-box',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--bg-overlay)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                  }}
                >
                  <span
                    style={{
                      display: 'flex',
                      width: 18,
                      height: 18,
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    {theme === 'dark' ? (
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.75"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <circle cx="12" cy="12" r="4" />
                        <line x1="12" y1="2" x2="12" y2="4" />
                        <line x1="12" y1="20" x2="12" y2="22" />
                        <line x1="4.93" y1="4.93" x2="6.34" y2="6.34" />
                        <line x1="17.66" y1="17.66" x2="19.07" y2="19.07" />
                        <line x1="2" y1="12" x2="4" y2="12" />
                        <line x1="20" y1="12" x2="22" y2="12" />
                        <line x1="4.93" y1="19.07" x2="6.34" y2="17.66" />
                        <line x1="17.66" y1="6.34" x2="19.07" y2="4.93" />
                      </svg>
                    ) : (
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.75"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                      </svg>
                    )}
                  </span>
                  <span>{theme === 'dark' ? '切换日间模式' : '切换夜间模式'}</span>
                </button>
              )}

              {/* 设置 */}
              {BOTTOM_NAV_ITEMS.map((item: NavItem) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={() => setShowMoreMenu(false)}
                  onPointerEnter={() => preloadRoute(item.to)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 8,
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--fg-default)',
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: 'pointer',
                    textAlign: 'left',
                    textDecoration: 'none',
                    boxSizing: 'border-box',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--bg-overlay)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                  }}
                >
                  <span
                    style={{
                      display: 'flex',
                      width: 18,
                      height: 18,
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    {railIcon(item.iconKey)}
                  </span>
                  <span>{item.label}</span>
                </NavLink>
              ))}

              {/* 分割线 */}
              {onLogout && (
                <div style={{ height: 1, background: 'var(--border-subtle)', margin: '2px 8px' }} />
              )}

              {/* 退出 */}
              {onLogout && (
                <button
                  type="button"
                  onClick={() => {
                    setShowMoreMenu(false);
                    onLogout();
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 8,
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--danger, #ef4444)',
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: 'pointer',
                    textAlign: 'left',
                    boxSizing: 'border-box',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--bg-overlay)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                  }}
                >
                  <span
                    style={{
                      display: 'flex',
                      width: 18,
                      height: 18,
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.75"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                      <polyline points="16 17 21 12 16 7" />
                      <line x1="21" y1="12" x2="9" y2="12" />
                    </svg>
                  </span>
                  <span>退出登录</span>
                </button>
              )}
            </div>,
            document.body,
          )}
      </div>
    </>
  );
}
