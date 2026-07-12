import { useCallback, useEffect, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router';
import { createHealthClient } from '@openAwork/web-client';
import { BrandLogo } from '@openAwork/shared-ui';
import { railGroups, railLabelCn, railIcon, type RailItem } from './RailIcon.js';
import { preloadRouteModuleByPath } from '../../../routes/preloadable-route-modules.js';
import { useUIStateStore } from '../../../stores/ui/uiState.js';
import { useDisplayPreferencesStore } from '../../../stores/settings/display-preferences.js';
import NotificationCenter from '../notification/NotificationCenter.js';

interface NavRailProps {
  clearAuth: () => void;
  accessToken: string | null;
  gatewayUrl: string;
  theme?: 'dark' | 'light';
  onToggleTheme?: () => void;
  /** Whether the current route is a `/chat/...` page (used to show the expand-sidebar button). */
  isChatRoute?: boolean;
  /** Whether the SessionSidebar is open. Only relevant when isChatRoute is true. */
  leftSidebarOpen?: boolean;
  onExpandSidebar?: () => void;
  /**
   * Whether to show a small pulsing dot on the notification icon when there
   * is a pending permission but no unread notifications.
   */
  pendingPermissionIndicator?: boolean;
}

const WIDE_VIEWPORT_QUERY = '(min-width: 1920px)';

/** Width of the nav rail in expanded (icon + label) state. */
const EXPANDED_RAIL_WIDTH = 200;
/** Width of the nav rail in collapsed (icon-only) state. */
const COLLAPSED_RAIL_WIDTH = 56;

const ITEM_MIN_HEIGHT = 34;
const ITEM_BORDER_RADIUS = 9;

function useWideViewport(): boolean {
  const [isWide, setIsWide] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return window.matchMedia(WIDE_VIEWPORT_QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const media = window.matchMedia(WIDE_VIEWPORT_QUERY);
    const update = () => setIsWide(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return isWide;
}

type GatewayStatus = 'online' | 'offline' | 'warning';

/**
 * Lightweight gateway health probe so the brand can show a live status dot.
 * Polls every 30s with a 4s timeout; failures fall back to "offline" without
 * spamming the console.
 */
function useGatewayStatus(gatewayUrl: string): GatewayStatus {
  const [status, setStatus] = useState<GatewayStatus>('online');

  useEffect(() => {
    if (!gatewayUrl) {
      setStatus('offline');
      return;
    }
    let cancelled = false;
    let intervalId: number | null = null;
    const client = createHealthClient(gatewayUrl);

    const probe = async () => {
      try {
        const healthy = await client.check({ timeoutMs: 4000 });
        if (cancelled) return;
        setStatus(healthy ? 'online' : 'offline');
      } catch {
        if (cancelled) return;
        setStatus('offline');
      }
    };

    void probe();
    intervalId = window.setInterval(() => void probe(), 30_000);

    return () => {
      cancelled = true;
      if (intervalId !== null) window.clearInterval(intervalId);
    };
  }, [gatewayUrl]);

  return status;
}

const railItemBaseStyle: React.CSSProperties = {
  position: 'relative',
  display: 'flex',
  width: '100%',
  minHeight: ITEM_MIN_HEIGHT,
  alignItems: 'center',
  gap: 10,
  padding: '0 10px',
  borderRadius: ITEM_BORDER_RADIUS,
  textDecoration: 'none',
  background: 'transparent',
  color: 'var(--fg-muted)',
  fontWeight: 500,
  overflow: 'visible',
};

function NavRailItem({
  item,
  expanded,
  labelStyle,
  preloadRoute,
  resolvedToOverride,
  forceActive,
}: {
  item: RailItem;
  expanded: boolean;
  labelStyle: React.CSSProperties;
  preloadRoute: (path: string) => void;
  resolvedToOverride?: string;
  forceActive?: boolean;
}) {
  const target = resolvedToOverride ?? item.to;
  return (
    <NavLink
      to={target}
      onPointerEnter={() => preloadRoute(target)}
      onFocus={() => preloadRoute(target)}
      onPointerDown={() => preloadRoute(target)}
      title={railLabelCn[item.label] ?? item.label}
      className={({ isActive }) =>
        forceActive || isActive ? 'nav-rail-btn nav-rail-link-active' : 'nav-rail-btn'
      }
      style={({ isActive }) => {
        const active = forceActive || isActive;
        return {
          ...railItemBaseStyle,
          color: active ? 'var(--accent)' : 'var(--fg-muted)',
          fontWeight: active ? 600 : 500,
          justifyContent: expanded ? 'flex-start' : 'center',
          padding: expanded ? '0 12px' : '0',
        };
      }}
    >
      <span className="nav-rail-icon">{railIcon(item.label)}</span>
      <span
        className="nav-rail-label"
        style={{
          ...labelStyle,
          fontSize: 12,
          fontWeight: 500,
          letterSpacing: '-0.005em',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {railLabelCn[item.label] ?? item.label}
      </span>
    </NavLink>
  );
}

export default function NavRail({
  clearAuth,
  accessToken,
  gatewayUrl,
  theme,
  onToggleTheme,
  isChatRoute = false,
  leftSidebarOpen = false,
  onExpandSidebar,
  pendingPermissionIndicator = false,
}: NavRailProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const lastChatPath = useUIStateStore((state) => state.lastChatPath);
  const navRailExpandedPref = useUIStateStore((state) => state.navRailExpanded);
  const toggleNavRailExpanded = useUIStateStore((state) => state.toggleNavRailExpanded);
  const preloadRoute = useCallback((path: string) => {
    void preloadRouteModuleByPath(path);
  }, []);

  const wideViewport = useWideViewport();
  const expanded = navRailExpandedPref ?? wideViewport;
  const gatewayStatus = useGatewayStatus(gatewayUrl);
  const showGatewayStatusIndicator = useDisplayPreferencesStore(
    (s) => s.showGatewayStatusIndicator,
  );

  const showExpandSidebarButton = isChatRoute && !leftSidebarOpen && !!onExpandSidebar;
  const railWidth = expanded ? EXPANDED_RAIL_WIDTH : COLLAPSED_RAIL_WIDTH;

  const labelStyle: React.CSSProperties = expanded
    ? { display: 'block', opacity: 1 }
    : { display: 'none', opacity: 0 };

  const railLabelStyle: React.CSSProperties = {
    ...labelStyle,
    fontSize: 12,
    fontWeight: 500,
    letterSpacing: '-0.005em',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  };

  const handleToggleRail = () => toggleNavRailExpanded(wideViewport);

  const gatewayStatusLabel: Record<GatewayStatus, string> = {
    online: '已连接',
    offline: '未连接',
    warning: '连接异常',
  };

  return (
    <nav
      className="layout-nav-rail"
      data-rail-expanded={expanded ? 'true' : 'false'}
      style={{
        width: railWidth,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        padding: '8px 0 6px',
        height: '100%',
        transition: 'width 240ms cubic-bezier(0.4, 0, 0.2, 1)',
        overflow: 'visible',
      }}
    >
      {/* Brand + collapse/expand-sidebar buttons */}
      <div
        style={{
          display: 'flex',
          flexDirection: expanded ? 'row' : 'column',
          alignItems: 'center',
          gap: expanded ? 8 : 4,
          padding: expanded ? '2px 10px 8px' : '2px 6px 8px',
          minHeight: 32,
        }}
      >
        <span
          className="layout-nav-rail-brand"
          aria-label="OpenAWork"
          title={`OpenAWork · ${gatewayStatusLabel[gatewayStatus]}`}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flex: expanded ? 1 : undefined,
            minWidth: 0,
            color: 'var(--fg-strong)',
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: '-0.02em',
          }}
        >
          <span className="layout-nav-rail-brand-logo" style={{ width: 22, height: 22 }}>
            <BrandLogo size={22} />
          </span>
          <span
            className="nav-rail-label"
            style={{
              ...labelStyle,
              display: expanded ? 'flex' : 'none',
              alignItems: 'center',
              gap: 6,
              flex: 1,
              minWidth: 0,
              fontSize: 12.5,
              fontWeight: 700,
            }}
          >
            <span
              style={{
                background:
                  'linear-gradient(90deg, var(--fg-strong), color-mix(in oklch, var(--fg-strong) 60%, var(--accent) 40%))',
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              OpenAWork
            </span>
            {showGatewayStatusIndicator && (
              <span
                className="nav-rail-status-dot"
                data-status={gatewayStatus}
                aria-label={gatewayStatusLabel[gatewayStatus]}
              />
            )}
          </span>
        </span>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            flexShrink: 0,
          }}
        >
          {showExpandSidebarButton && (
            <button
              type="button"
              title="展开会话面板"
              aria-label="展开会话面板"
              onClick={onExpandSidebar}
              className="icon-btn"
              style={{
                display: 'flex',
                width: 24,
                height: 24,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 6,
                border: 'none',
                background: 'transparent',
                color: 'var(--fg-muted)',
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              <svg
                aria-hidden="true"
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          )}
          <button
            type="button"
            title={expanded ? '折叠侧边栏' : '展开侧边栏'}
            aria-label={expanded ? '折叠侧边栏' : '展开侧边栏'}
            aria-pressed={expanded}
            onClick={handleToggleRail}
            className="icon-btn"
            style={{
              display: 'flex',
              width: 24,
              height: 24,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 6,
              border: 'none',
              background: 'transparent',
              color: 'var(--fg-muted)',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            <svg
              aria-hidden="true"
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {expanded ? (
                <>
                  <polyline points="11 17 6 12 11 7" />
                  <polyline points="18 17 13 12 18 7" />
                </>
              ) : (
                <>
                  <polyline points="13 17 18 12 13 7" />
                  <polyline points="6 17 11 12 6 7" />
                </>
              )}
            </svg>
          </button>
        </div>
      </div>

      <div
        className="nav-rail-scroll"
        style={{
          display: 'flex',
          flex: 1,
          flexDirection: 'column',
          paddingLeft: 6,
          paddingRight: 6,
          overflowY: 'auto',
          overflowX: 'hidden',
        }}
      >
        {railGroups.map((group, groupIndex) => (
          <div
            key={group.id}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 1,
            }}
          >
            {expanded ? (
              <div className="nav-rail-group-title">{group.title}</div>
            ) : groupIndex > 0 ? (
              <div className="nav-rail-group-spacer" aria-hidden="true" />
            ) : (
              <div style={{ height: 2 }} aria-hidden="true" />
            )}
            {group.items.map((item) => {
              const resolvedTo = item.label === 'Chat' ? (lastChatPath ?? item.to) : item.to;
              // For routes with sub-paths we want to keep the parent active
              // even when the user is on a child path.
              const isChatActive = item.label === 'Chat' && location.pathname.startsWith('/chat');
              const isTemplatesActive =
                item.label === 'Templates' && location.pathname.startsWith('/templates');
              const isTeamActive = item.label === 'Team' && location.pathname.startsWith('/team');
              const forceActive = isChatActive || isTemplatesActive || isTeamActive;

              return (
                <NavRailItem
                  key={item.label}
                  item={item}
                  expanded={expanded}
                  labelStyle={labelStyle}
                  preloadRoute={preloadRoute}
                  resolvedToOverride={resolvedTo}
                  forceActive={forceActive}
                />
              );
            })}
          </div>
        ))}
      </div>

      <div className="nav-rail-divider" aria-hidden="true" />

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
          padding: '2px 6px 0',
        }}
      >
        {accessToken && (
          <NotificationCenter
            accessToken={accessToken}
            gatewayUrl={gatewayUrl}
            pendingPermissionIndicator={pendingPermissionIndicator}
            labelStyleOverride={labelStyle}
            expanded={expanded}
          />
        )}

        {onToggleTheme && (
          <button
            type="button"
            title={theme === 'dark' ? '切换到日间模式' : '切换到夜间模式'}
            onClick={onToggleTheme}
            className="nav-rail-btn"
            style={{
              ...railItemBaseStyle,
              border: 'none',
              cursor: 'pointer',
              justifyContent: expanded ? 'flex-start' : 'center',
              padding: expanded ? '0 12px' : '0',
            }}
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
            <span className="nav-rail-label" style={railLabelStyle}>
              {theme === 'dark' ? '日间' : '夜间'}
            </span>
          </button>
        )}

        <NavLink
          to="/about"
          onPointerEnter={() => preloadRoute('/about')}
          onFocus={() => preloadRoute('/about')}
          onPointerDown={() => preloadRoute('/about')}
          title={railLabelCn['About'] ?? '关于'}
          className={({ isActive }) =>
            isActive ? 'nav-rail-btn nav-rail-link-active' : 'nav-rail-btn'
          }
          style={({ isActive }) => ({
            ...railItemBaseStyle,
            color: isActive ? 'var(--accent)' : 'var(--fg-muted)',
            fontWeight: isActive ? 600 : 500,
            justifyContent: expanded ? 'flex-start' : 'center',
            padding: expanded ? '0 12px' : '0',
          })}
        >
          <span className="nav-rail-icon">{railIcon('About')}</span>
          <span className="nav-rail-label" style={railLabelStyle}>
            关于
          </span>
        </NavLink>

        <NavLink
          to="/settings"
          onPointerEnter={() => preloadRoute('/settings')}
          onFocus={() => preloadRoute('/settings')}
          onPointerDown={() => preloadRoute('/settings')}
          title={railLabelCn['Settings'] ?? '设置'}
          className={({ isActive }) =>
            isActive ? 'nav-rail-btn nav-rail-link-active' : 'nav-rail-btn'
          }
          style={({ isActive }) => ({
            ...railItemBaseStyle,
            color: isActive ? 'var(--accent)' : 'var(--fg-muted)',
            fontWeight: isActive ? 600 : 500,
            justifyContent: expanded ? 'flex-start' : 'center',
            padding: expanded ? '0 12px' : '0',
          })}
        >
          <span className="nav-rail-icon">{railIcon('Settings')}</span>
          <span className="nav-rail-label" style={railLabelStyle}>
            设置
          </span>
        </NavLink>

        <button
          type="button"
          title="退出登录"
          className="nav-rail-logout"
          onClick={() => {
            clearAuth();
            void navigate('/');
          }}
          style={{
            ...railItemBaseStyle,
            border: 'none',
            cursor: 'pointer',
            justifyContent: expanded ? 'flex-start' : 'center',
            padding: expanded ? '0 12px' : '0',
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
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </span>
          <span className="nav-rail-label" style={railLabelStyle}>
            退出
          </span>
        </button>
      </div>
    </nav>
  );
}
