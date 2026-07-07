/**
 * TitlebarToolsMenu — 顶部工具菜单（⚙ 弹出式）。
 *
 * 替代原 TitlebarTabStrip 中的 LayoutModeSwitch（融合/经典）常驻按钮，
 * 将布局模式切换 + 主题切换 + 设置入口收拢到一个弹出菜单中，
 * 为会话标签腾出更多横向空间。
 *
 * 触发方式：点击 ⚙ 图标按钮 → 弹出下拉菜单。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useNavigate } from 'react-router';
import { useUIStateStore } from '../../stores/ui/uiState.js';

export interface TitlebarToolsMenuProps {
  /** 当前主题（'dark' | 'light'），用于显示切换标签 */
  readonly theme?: 'dark' | 'light';
  /** 主题切换回调 */
  readonly onToggleTheme?: () => void;
}

const TRIGGER_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 28,
  height: 28,
  borderRadius: 6,
  border: 'none',
  background: 'transparent',
  color: 'var(--fg-muted)',
  cursor: 'pointer',
  flexShrink: 0,
  transition: 'background 120ms ease, color 120ms ease',
};

const QUICK_SWITCH_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: 26,
  padding: '0 9px',
  borderRadius: 6,
  border: '1px solid var(--accent-border)',
  background: 'var(--accent-subtle)',
  color: 'var(--accent)',
  cursor: 'pointer',
  flexShrink: 0,
  fontSize: 11,
  fontWeight: 700,
  lineHeight: 1,
  transition: 'background 120ms ease, border-color 120ms ease, color 120ms ease',
};

const MENU_STYLE: CSSProperties = {
  position: 'absolute',
  top: 32,
  right: 0,
  minWidth: 180,
  padding: '4px',
  borderRadius: 8,
  border: '1px solid var(--border-default)',
  background: 'var(--bg-surface)',
  boxShadow: 'var(--shadow-md)',
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  zIndex: 100,
};

const SECTION_LABEL_STYLE: CSSProperties = {
  padding: '6px 10px 3px',
  fontSize: 10,
  fontWeight: 800,
  color: 'var(--fg-subtle)',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
};

const ITEM_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 10px',
  borderRadius: 6,
  border: 'none',
  background: 'transparent',
  color: 'var(--fg-default)',
  fontSize: 12,
  fontWeight: 500,
  cursor: 'pointer',
  textAlign: 'left',
  width: '100%',
  transition: 'background 100ms ease',
};

const ITEM_ACTIVE_STYLE: CSSProperties = {
  color: 'var(--accent)',
  fontWeight: 700,
};

const SEPARATOR_STYLE: CSSProperties = {
  height: 1,
  margin: '4px 6px',
  background: 'var(--border-subtle)',
  border: 'none',
};

function GearIcon() {
  return (
    <svg
      aria-hidden="true"
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

export function TitlebarToolsMenu({ theme, onToggleTheme }: TitlebarToolsMenuProps) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const layoutMode = useUIStateStore((state) => state.workbenchLayoutMode);
  const setLayoutMode = useUIStateStore((state) => state.setWorkbenchLayoutMode);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  const handleToggle = useCallback(() => {
    setOpen((prev) => !prev);
  }, []);

  const handleSetMode = useCallback(
    (mode: 'classic' | 'fusion') => {
      setLayoutMode(mode);
      setOpen(false);
    },
    [setLayoutMode],
  );

  const handleToggleTheme = useCallback(() => {
    onToggleTheme?.();
    setOpen(false);
  }, [onToggleTheme]);

  const handleOpenSettings = useCallback(() => {
    void navigate('/settings');
    setOpen(false);
  }, [navigate]);

  const nextLayoutMode = layoutMode === 'fusion' ? 'classic' : 'fusion';
  const quickSwitchLabel = layoutMode === 'fusion' ? '经典' : '融合';
  const quickSwitchTitle = layoutMode === 'fusion' ? '切换到旧版经典布局' : '切换到新版融合布局';

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        flexShrink: 0,
      }}
    >
      <button
        type="button"
        title={quickSwitchTitle}
        aria-label={quickSwitchTitle}
        onClick={() => handleSetMode(nextLayoutMode)}
        style={QUICK_SWITCH_STYLE}
        onMouseEnter={(e) => {
          e.currentTarget.style.background =
            'color-mix(in oklch, var(--accent) 14%, var(--bg-overlay))';
          e.currentTarget.style.borderColor = 'var(--accent)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'var(--accent-subtle)';
          e.currentTarget.style.borderColor = 'var(--accent-border)';
        }}
        onFocus={(e) => {
          e.currentTarget.style.outline = '2px solid var(--accent)';
          e.currentTarget.style.outlineOffset = '2px';
          e.currentTarget.style.boxShadow = '0 0 0 4px var(--accent-subtle)';
        }}
        onBlur={(e) => {
          e.currentTarget.style.outline = '';
          e.currentTarget.style.outlineOffset = '';
          e.currentTarget.style.boxShadow = '';
        }}
      >
        {quickSwitchLabel}
      </button>
      <button
        type="button"
        title="工具菜单"
        aria-label="工具菜单"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={handleToggle}
        style={{
          ...TRIGGER_STYLE,
          background: open ? 'var(--accent-subtle)' : 'transparent',
          color: open ? 'var(--accent)' : 'var(--fg-muted)',
        }}
        onMouseEnter={(e) => {
          if (!open) {
            e.currentTarget.style.background =
              'color-mix(in oklch, var(--fg-default) 6%, var(--bg-overlay))';
            e.currentTarget.style.color = 'var(--fg-default)';
          }
        }}
        onMouseLeave={(e) => {
          if (!open) {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = 'var(--fg-muted)';
          }
        }}
      >
        <GearIcon />
      </button>

      {open && (
        <div role="menu" aria-label="工具菜单" style={MENU_STYLE}>
          {/* 布局模式 */}
          <div style={SECTION_LABEL_STYLE}>布局模式</div>
          <button
            type="button"
            role="menuitemradio"
            aria-checked={layoutMode === 'fusion'}
            onClick={() => handleSetMode('fusion')}
            style={{
              ...ITEM_STYLE,
              ...(layoutMode === 'fusion' ? ITEM_ACTIVE_STYLE : {}),
            }}
            onMouseEnter={(e) => {
              if (layoutMode !== 'fusion') {
                e.currentTarget.style.background = 'var(--border-subtle)';
              }
            }}
            onMouseLeave={(e) => {
              if (layoutMode !== 'fusion') {
                e.currentTarget.style.background = 'transparent';
              }
            }}
          >
            <span style={{ flex: 1 }}>融合</span>
            {layoutMode === 'fusion' && <CheckIcon />}
          </button>
          <button
            type="button"
            role="menuitemradio"
            aria-checked={layoutMode === 'classic'}
            onClick={() => handleSetMode('classic')}
            style={{
              ...ITEM_STYLE,
              ...(layoutMode === 'classic' ? ITEM_ACTIVE_STYLE : {}),
            }}
            onMouseEnter={(e) => {
              if (layoutMode !== 'classic') {
                e.currentTarget.style.background = 'var(--border-subtle)';
              }
            }}
            onMouseLeave={(e) => {
              if (layoutMode !== 'classic') {
                e.currentTarget.style.background = 'transparent';
              }
            }}
          >
            <span style={{ flex: 1 }}>经典</span>
            {layoutMode === 'classic' && <CheckIcon />}
          </button>

          <hr style={SEPARATOR_STYLE} />

          {/* 主题 */}
          {onToggleTheme && (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={handleToggleTheme}
                style={ITEM_STYLE}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--border-subtle)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                <svg
                  aria-hidden="true"
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ flexShrink: 0 }}
                >
                  {theme === 'dark' ? (
                    <>
                      <circle cx="12" cy="12" r="4" />
                      <line x1="12" y1="2" x2="12" y2="4" />
                      <line x1="12" y1="20" x2="12" y2="22" />
                      <line x1="4.93" y1="4.93" x2="6.34" y2="6.34" />
                      <line x1="17.66" y1="17.66" x2="19.07" y2="19.07" />
                      <line x1="2" y1="12" x2="4" y2="12" />
                      <line x1="20" y1="12" x2="22" y2="12" />
                      <line x1="4.93" y1="19.07" x2="6.34" y2="17.66" />
                      <line x1="17.66" y1="6.34" x2="19.07" y2="4.93" />
                    </>
                  ) : (
                    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                  )}
                </svg>
                <span style={{ flex: 1 }}>{theme === 'dark' ? '日间模式' : '夜间模式'}</span>
              </button>
              <hr style={SEPARATOR_STYLE} />
            </>
          )}

          {/* 设置 */}
          <button
            type="button"
            role="menuitem"
            onClick={handleOpenSettings}
            style={ITEM_STYLE}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--border-subtle)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            <svg
              aria-hidden="true"
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ flexShrink: 0 }}
            >
              <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            <span style={{ flex: 1 }}>设置</span>
          </button>
        </div>
      )}
    </div>
  );
}
