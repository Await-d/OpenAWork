import { useCallback } from 'react';
import { NavLink } from 'react-router';
import type { TeamWorkspaceGroup } from '../../hooks/workspace/useTeamSidebarSessions.js';
import { preloadRouteModuleByPath } from '../../routes/preloadable-route-modules.js';
import { railIcon, railLabelCn, type RailItem } from './nav/RailIcon.js';
import {
  iconButtonStyle,
  labelStyle,
  rowStyle,
  runningDotStyle,
  sectionHeaderStyle,
  sessionRowStyle,
  truncateStyle,
} from './AppSidebar.styles.js';

export function NavItemLink({
  collapsed,
  forceActive,
  item,
  target,
}: {
  collapsed: boolean;
  forceActive?: boolean;
  item: RailItem;
  target?: string;
}) {
  const to = target ?? item.to;
  const preload = useCallback(() => {
    void preloadRouteModuleByPath(to);
  }, [to]);

  return (
    <NavLink
      to={to}
      title={railLabelCn[item.label] ?? item.label}
      onFocus={preload}
      onPointerEnter={preload}
      className={({ isActive }) =>
        forceActive || isActive ? 'nav-rail-btn nav-rail-link-active' : 'nav-rail-btn'
      }
      style={({ isActive }) => rowStyle(forceActive || isActive, collapsed)}
    >
      <span className="nav-rail-icon">{railIcon(item.label)}</span>
      {!collapsed && <span style={labelStyle}>{railLabelCn[item.label] ?? item.label}</span>}
    </NavLink>
  );
}

export function TeamGroupList({
  activeTeamSessionId,
  collapsed,
  groups,
  onNewSession,
  onSelectSession,
}: {
  activeTeamSessionId: string | null;
  collapsed: boolean;
  groups: TeamWorkspaceGroup[];
  onNewSession: (workspaceId: string) => void;
  onSelectSession: (workspaceId: string, sessionId: string) => void;
}) {
  if (collapsed) {
    return null;
  }

  return (
    <div style={{ display: 'grid', gap: 4 }}>
      {groups.map((group) => (
        <section key={group.id} style={{ display: 'grid', gap: 2 }}>
          <div style={sectionHeaderStyle}>
            <span style={truncateStyle}>{group.label}</span>
            {group.id !== '__unbound__' && (
              <button type="button" onClick={() => onNewSession(group.id)} style={iconButtonStyle}>
                +
              </button>
            )}
          </div>
          {group.sessions.map((session) => (
            <button
              key={session.id}
              type="button"
              onClick={() => {
                if (session.teamWorkspaceId) {
                  onSelectSession(session.teamWorkspaceId, session.id);
                }
              }}
              style={sessionRowStyle(activeTeamSessionId === session.id)}
            >
              <span style={truncateStyle}>{session.title}</span>
              {session.stateStatus === 'running' && <span style={runningDotStyle} />}
            </button>
          ))}
        </section>
      ))}
    </div>
  );
}
