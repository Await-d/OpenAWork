import { useCallback } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router';
import { railItems, railLabelCn, railIcon } from './RailIcon.js';
import { preloadRouteModuleByPath } from '../../routes/preloadable-route-modules.js';
import { useUIStateStore } from '../../stores/uiState.js';

interface NavRailProps {
  clearAuth: () => void;
}

export default function NavRail({ clearAuth }: NavRailProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const lastChatPath = useUIStateStore((state) => state.lastChatPath);
  const preloadRoute = useCallback((path: string) => {
    void preloadRouteModuleByPath(path);
  }, []);

  return (
    <nav
      className="layout-nav-rail"
      style={{
        width: 'var(--rail-width, 48px)',
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        padding: '6px 0',
        height: '100%',
        borderRight: '1px solid var(--border-subtle)',
        transition: 'width 200ms ease',
        overflow: 'hidden',
        background: 'var(--nav-rail-bg)',
      }}
    >
      <div
        style={{
          display: 'flex',
          flex: 1,
          flexDirection: 'column',
          gap: 2,
          paddingTop: 4,
          paddingLeft: 6,
          paddingRight: 6,
          overflowY: 'auto',
          scrollbarWidth: 'none' as const,
        }}
      >
        {railItems.map(({ to, label }) => {
          const resolvedTo = label === 'Chat' ? (lastChatPath ?? to) : to;
          const isChatActive = label === 'Chat' && location.pathname.startsWith('/chat');
          const isChannelsActive =
            label === 'Channels' &&
            (location.pathname === '/channels' ||
              location.pathname.startsWith('/settings/channels'));
          const isTemplatesActive =
            label === 'Templates' && location.pathname.startsWith('/templates');
          const isTeamActive = label === 'Team' && location.pathname.startsWith('/team');

          return (
            <NavLink
              key={label}
              to={resolvedTo}
              onPointerEnter={() => preloadRoute(resolvedTo)}
              onFocus={() => preloadRoute(resolvedTo)}
              onPointerDown={() => preloadRoute(resolvedTo)}
              title={railLabelCn[label] ?? label}
              className={({ isActive }) =>
                isChatActive || isChannelsActive || isTemplatesActive || isTeamActive || isActive
                  ? 'nav-rail-link-active'
                  : 'nav-rail-btn'
              }
              style={({ isActive }) => {
                const isActiveState =
                  isChatActive || isChannelsActive || isTemplatesActive || isTeamActive || isActive;
                return {
                  display: 'flex',
                  width: '100%',
                  minHeight: 36,
                  alignItems: 'center',
                  gap: 8,
                  padding: '0 8px',
                  borderRadius: 8,
                  textDecoration: 'none',
                  background: isActiveState ? 'var(--accent-muted)' : 'transparent',
                  color: isActiveState ? 'var(--accent)' : 'var(--text-3)',
                  boxShadow: isActiveState ? 'inset 2px 0 0 var(--accent)' : 'none',
                  transition: 'background 150ms ease, color 150ms ease',
                  overflow: 'hidden',
                };
              }}
            >
              <span
                style={{
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 20,
                }}
              >
                {railIcon(label)}
              </span>
              <span
                className="nav-rail-label"
                style={{
                  fontSize: 11,
                  fontWeight: 500,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {railLabelCn[label] ?? label}
              </span>
            </NavLink>
          );
        })}
      </div>
      <NavLink
        to="/settings"
        onPointerEnter={() => preloadRoute('/settings')}
        onFocus={() => preloadRoute('/settings')}
        onPointerDown={() => preloadRoute('/settings')}
        title={railLabelCn['Settings'] ?? '设置'}
        className={({ isActive }) =>
          isActive && !location.pathname.startsWith('/settings/channels')
            ? 'nav-rail-link-active'
            : 'nav-rail-btn'
        }
        style={({ isActive }) => ({
          display: 'flex',
          width: '100%',
          minHeight: 36,
          alignItems: 'center',
          gap: 8,
          padding: '0 8px',
          borderRadius: 8,
          textDecoration: 'none',
          background:
            isActive && !location.pathname.startsWith('/settings/channels')
              ? 'var(--accent-muted)'
              : 'transparent',
          color:
            isActive && !location.pathname.startsWith('/settings/channels')
              ? 'var(--accent)'
              : 'var(--text-3)',
          boxShadow:
            isActive && !location.pathname.startsWith('/settings/channels')
              ? 'inset 2px 0 0 var(--accent)'
              : 'none',
          transition: 'background 150ms ease, color 150ms ease',
          overflow: 'hidden',
          paddingLeft: 14,
        })}
      >
        <span
          style={{
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 20,
          }}
        >
          {railIcon('Settings')}
        </span>
        <span
          className="nav-rail-label"
          style={{
            fontSize: 11,
            fontWeight: 500,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
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
          display: 'flex',
          minHeight: 36,
          width: '100%',
          alignItems: 'center',
          gap: 8,
          padding: '0 14px',
          borderRadius: 8,
          color: 'var(--text-3)',
          overflow: 'hidden',
        }}
      >
        <span
          style={{
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 20,
          }}
        >
          <svg
            aria-hidden="true"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
        </span>
        <span
          className="nav-rail-label"
          style={{
            fontSize: 11,
            fontWeight: 500,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          退出
        </span>
      </button>
    </nav>
  );
}
