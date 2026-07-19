/**
 * SidebarRailV2 — 左侧固定 Rail (64px)。
 *
 * S2 方案：项目头像 + 功能导航 + 底部图标。
 *
 * 结构：
 *   顶部: 项目头像列表 [OA][MA][+]  ← 点击切换工作区
 *   分隔线
 *   中部: [💬Chat] [👥Team] [📅定时] [🔧技能] [🤖智能体]
 *   底部: [🔔通知] [⚙️设置] [❓帮助]
 *
 * Rail 始终可见，不可折叠。
 * Panel 折叠时 hover 项目头像触发 SidebarPeek 浮层。
 */

import { useCallback, type CSSProperties } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router';
import { useUIStateStore } from '../../../stores/ui/uiState.js';
import NotificationCenter from '../notification/NotificationCenter.js';
import { railIcon, TOP_NAV_ITEMS, BOTTOM_NAV_ITEMS } from '../nav/RailIcon.js';
import type { NavItem } from '../nav/RailIcon.js';
import { preloadRouteModuleByPath } from '../../../routes/preloadable-route-modules.js';

export interface SidebarRailV2Props {
  readonly accessToken: string | null;
  readonly gatewayUrl: string;
  readonly theme?: 'dark' | 'light';
  readonly onToggleTheme?: () => void;
  readonly onLogout?: () => void;
  readonly pendingPermissionIndicator?: boolean;
  /** hover 项目头像时触发 peek（Panel 折叠态） */
  readonly onProjectHover?: (workspacePath: string | null) => void;
  /** 点击项目头像时切换工作区 */
  readonly onSelectWorkspace?: (workspacePath: string) => void;
  /** 打开工作区选择器 */
  readonly onOpenWorkspacePicker?: () => void;
}

const RAIL_STYLE: CSSProperties = {
  width: 64,
  flexShrink: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  height: '100%',
  overflow: 'hidden',
  background: 'var(--bg-surface)',
};

const AVATAR_SECTION_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 8,
  padding: '12px 0 8px',
  flexShrink: 0,
};

const AVATAR_STYLE: CSSProperties = {
  width: 36,
  height: 36,
  padding: 0,
  borderRadius: 8,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: 'inherit',
  fontSize: 11,
  fontWeight: 800,
  cursor: 'pointer',
  border: '2px solid transparent',
  flexShrink: 0,
  transition: 'border-color 150ms ease, box-shadow 150ms ease',
};

const ADD_BUTTON_STYLE: CSSProperties = {
  width: 36,
  height: 28,
  borderRadius: 8,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  border: '1px dashed var(--border-default)',
  background: 'transparent',
  color: 'var(--fg-muted)',
  flexShrink: 0,
};

const DIVIDER_STYLE: CSSProperties = {
  width: 32,
  height: 1,
  background: 'var(--border-subtle)',
  border: 'none',
  margin: '4px 0',
  flexShrink: 0,
};

const NAV_SECTION_STYLE: CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 4,
  padding: '8px 0',
  overflow: 'hidden',
  minWidth: 0,
};

const NAV_ICON_BUTTON_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 36,
  height: 36,
  borderRadius: 8,
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  flexShrink: 0,
  textDecoration: 'none',
  transition: 'background 100ms ease, color 100ms ease',
};

const BOTTOM_SECTION_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 4,
  padding: '4px 0 12px',
  flexShrink: 0,
};

function pathToInitials(path: string): string {
  const normalized = path.replace(/\/+$/, '').replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  const name = parts.at(-1) ?? normalized;
  if (name.length <= 2) return name.toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function ModeIconButton({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      style={{
        ...NAV_ICON_BUTTON_STYLE,
        color: active ? 'var(--accent)' : 'var(--fg-muted)',
        background: active ? 'var(--accent-subtle)' : 'transparent',
      }}
      onMouseEnter={(e) => {
        if (!active) {
          e.currentTarget.style.background = 'var(--border-subtle)';
          e.currentTarget.style.color = 'var(--fg-default)';
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          e.currentTarget.style.background = 'transparent';
          e.currentTarget.style.color = 'var(--fg-muted)';
        }
      }}
    >
      {children}
    </button>
  );
}

export function SidebarRailV2({
  accessToken,
  gatewayUrl,
  theme = 'dark',
  onToggleTheme,
  onLogout,
  pendingPermissionIndicator = false,
  onProjectHover,
  onSelectWorkspace,
  onOpenWorkspacePicker,
}: SidebarRailV2Props) {
  const navigate = useNavigate();
  const location = useLocation();

  const savedWorkspacePaths = useUIStateStore((s) => s.savedWorkspacePaths);
  const selectedWorkspacePath = useUIStateStore((s) => s.selectedWorkspacePath);
  const setSelectedWorkspacePath = useUIStateStore((s) => s.setSelectedWorkspacePath);
  const setFileTreeRootPath = useUIStateStore((s) => s.setFileTreeRootPath);
  const triggerResetToWelcome = useUIStateStore((s) => s.triggerResetToWelcome);

  const isTeamRoute = location.pathname.startsWith('/team');
  const isChatRoute = location.pathname.startsWith('/chat');

  const preloadRoute = useCallback((path: string) => {
    void preloadRouteModuleByPath(path);
  }, []);

  const handleSelectProject = useCallback(
    (path: string) => {
      setSelectedWorkspacePath(path);
      setFileTreeRootPath(path);
      onSelectWorkspace?.(path);
    },
    [onSelectWorkspace, setFileTreeRootPath, setSelectedWorkspacePath],
  );

  const handleNavigateChat = useCallback(() => {
    preloadRoute('/chat');
    if (isChatRoute) {
      triggerResetToWelcome('chat');
      return;
    }
    void navigate('/chat');
  }, [isChatRoute, navigate, preloadRoute]);

  const handleNavigateTeam = useCallback(() => {
    preloadRoute('/team');
    if (isTeamRoute) {
      triggerResetToWelcome('team');
      return;
    }
    void navigate('/team');
  }, [isTeamRoute, navigate, preloadRoute]);

  return (
    <div className="sidebar-rail-v2" style={RAIL_STYLE}>
      {/* 项目头像区 */}
      <div style={AVATAR_SECTION_STYLE}>
        {savedWorkspacePaths.slice(0, 5).map((path) => {
          const isActive = selectedWorkspacePath === path;
          return (
            <button
              type="button"
              key={path}
              className="sidebar-rail-v2__project-button"
              title={path}
              aria-label={`切换工作区 ${pathToInitials(path)} ${path}`}
              aria-pressed={isActive}
              onClick={() => handleSelectProject(path)}
              onMouseEnter={() => onProjectHover?.(path)}
              onMouseLeave={() => onProjectHover?.(null)}
              onFocus={() => onProjectHover?.(path)}
              onBlur={() => onProjectHover?.(null)}
              style={{
                ...AVATAR_STYLE,
                background: isActive
                  ? 'color-mix(in oklch, var(--accent) 15%, var(--bg-elevated))'
                  : 'var(--bg-elevated)',
                color: isActive ? 'var(--accent)' : 'var(--fg-muted)',
                borderColor: isActive ? 'var(--accent)' : 'transparent',
                boxShadow: isActive ? '0 0 12px -2px var(--accent)' : 'none',
              }}
            >
              {pathToInitials(path)}
            </button>
          );
        })}

        <button
          type="button"
          title="添加工作区"
          aria-label="添加工作区"
          onClick={() => onOpenWorkspacePicker?.()}
          style={ADD_BUTTON_STYLE}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = 'var(--accent-border)';
            e.currentTarget.style.color = 'var(--accent)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = 'var(--border-default)';
            e.currentTarget.style.color = 'var(--fg-muted)';
          }}
        >
          <svg
            aria-hidden="true"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>

      <hr style={DIVIDER_STYLE} />

      {/* Chat / Team 模式切换 */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 4,
          flexShrink: 0,
        }}
      >
        <ModeIconButton active={isChatRoute} label="对话" onClick={handleNavigateChat}>
          <svg
            aria-hidden="true"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 15a4 4 0 0 1-4 4H7l-4 4V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
          </svg>
        </ModeIconButton>
        <ModeIconButton active={isTeamRoute} label="团队" onClick={handleNavigateTeam}>
          <svg
            aria-hidden="true"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
        </ModeIconButton>
      </div>

      <hr style={DIVIDER_STYLE} />

      {/* 功能导航 */}
      <div style={NAV_SECTION_STYLE}>
        {TOP_NAV_ITEMS.map((item: NavItem) => {
          const isActive = location.pathname.startsWith(item.to);
          return (
            <NavLink
              key={item.to}
              to={item.to}
              onPointerEnter={() => preloadRoute(item.to)}
              onFocus={() => preloadRoute(item.to)}
              onPointerDown={() => preloadRoute(item.to)}
              title={item.label}
              className={isActive ? 'nav-rail-btn nav-rail-link-active' : 'nav-rail-btn'}
              style={{
                ...NAV_ICON_BUTTON_STYLE,
                color: isActive ? 'var(--accent)' : 'var(--fg-muted)',
              }}
            >
              <span className="nav-rail-icon">{railIcon(item.iconKey)}</span>
            </NavLink>
          );
        })}
      </div>

      {/* 底部图标 */}
      <div style={BOTTOM_SECTION_STYLE}>
        {accessToken && (
          <NotificationCenter
            accessToken={accessToken}
            gatewayUrl={gatewayUrl}
            pendingPermissionIndicator={pendingPermissionIndicator}
            labelStyleOverride={{ display: 'none', opacity: 0 }}
            expanded={false}
          />
        )}

        {onToggleTheme && (
          <button
            type="button"
            title={theme === 'dark' ? '切换到日间模式' : '切换到夜间模式'}
            aria-label={theme === 'dark' ? '切换到日间模式' : '切换到夜间模式'}
            onClick={onToggleTheme}
            className="nav-rail-btn"
            style={{ ...NAV_ICON_BUTTON_STYLE, color: 'var(--fg-muted)' }}
          >
            <span className="nav-rail-icon">
              {theme === 'dark' ? (
                <svg
                  aria-hidden="true"
                  width="17"
                  height="17"
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
                  aria-hidden="true"
                  width="17"
                  height="17"
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
          </button>
        )}

        {BOTTOM_NAV_ITEMS.map((item: NavItem) => (
          <NavLink
            key={item.to}
            to={item.to}
            onPointerEnter={() => preloadRoute(item.to)}
            onFocus={() => preloadRoute(item.to)}
            onPointerDown={() => preloadRoute(item.to)}
            title={item.label}
            className={({ isActive }) =>
              isActive ? 'nav-rail-btn nav-rail-link-active' : 'nav-rail-btn'
            }
            style={({ isActive }) => ({
              ...NAV_ICON_BUTTON_STYLE,
              color: isActive ? 'var(--accent)' : 'var(--fg-muted)',
            })}
          >
            <span className="nav-rail-icon">{railIcon(item.iconKey)}</span>
          </NavLink>
        ))}

        {onLogout && (
          <button
            type="button"
            title="退出登录"
            aria-label="退出登录"
            className="nav-rail-logout"
            onClick={onLogout}
            style={{ ...NAV_ICON_BUTTON_STYLE, color: 'var(--fg-muted)' }}
          >
            <span className="nav-rail-icon">
              <svg
                aria-hidden="true"
                width="17"
                height="17"
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
          </button>
        )}
      </div>
    </div>
  );
}
