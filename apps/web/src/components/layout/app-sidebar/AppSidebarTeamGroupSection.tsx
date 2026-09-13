/**
 * AppSidebarTeamGroupSection — 经典布局侧栏「团队工作空间」分组。
 *
 * 由 AppSidebar 主文件拆出：包含组标题（可折叠、右键菜单、重命名）、
 * 组内新建会话入口，以及团队会话行（含运行/暂停状态与长按菜单）。
 */

import { useState } from 'react';
import { BaseSessionRow } from '../sidebar/BaseSessionRow.js';
import { useUIStateStore } from '../../../stores/ui/uiState.js';
import type { TeamWorkspaceGroup } from '../../../hooks/workspace/useTeamSidebarSessions.js';
import {
  formatSessionTime,
  formatSessionTimeTitle,
} from '../../../utils/session/format-session-time.js';
import { buildTeamSessionRoute } from '../../../utils/session/team-session-route.js';
import '../sidebar/sidebar-interactions.css';

export interface AppSidebarTeamGroupSectionProps {
  group: TeamWorkspaceGroup;
  activeTeamSessionId: string | null;
  preloadRoute: (path: string) => void;
  navigate: (path: string) => void | Promise<void>;
  onNewSession: (workspaceId: string) => void;
  onSelectSession: (workspaceId: string, sessionId: string) => void;
  onSessionContextMenu: (
    session: {
      id: string;
      title: string;
      stateStatus: string;
      teamWorkspaceId: string | null;
    },
    x: number,
    y: number,
  ) => void;
  renamingSessionId: string | null;
  renameValue: string;
  onRenameChange: (value: string) => void;
  onRenameCommit: (sessionId: string) => void;
  onWorkspaceContextMenu: (workspace: { id: string; name: string }, x: number, y: number) => void;
  workspaceRenamingId: string | null;
  workspaceRenameValue: string;
  onWorkspaceRenameChange: (value: string) => void;
  onWorkspaceRenameCommit: (workspaceId: string) => void;
}

export function AppSidebarTeamGroupSection({
  group,
  activeTeamSessionId,
  preloadRoute,
  navigate,
  onNewSession,
  onSelectSession,
  onSessionContextMenu,
  renamingSessionId,
  renameValue,
  onRenameChange,
  onRenameCommit,
  onWorkspaceContextMenu,
  workspaceRenamingId,
  workspaceRenameValue,
  onWorkspaceRenameChange,
  onWorkspaceRenameCommit,
}: AppSidebarTeamGroupSectionProps) {
  const collapsedSessionGroups = useUIStateStore((s) => s.collapsedSessionGroups);
  const toggleSessionGroupCollapsed = useUIStateStore((s) => s.toggleSessionGroupCollapsed);
  const [hoveredSessionId, setHoveredSessionId] = useState<string | null>(null);

  // 未绑定工作区的分组不支持新建/重命名/删除
  const canNewSession = group.id !== '__unbound__';
  const isWorkspaceRenaming = workspaceRenamingId === group.id;
  const groupBodyId = `app-team-group-${group.id}`;
  // 折叠状态持久化（与对话工作区分组共用 store，`team:` 前缀避免 key 冲突）
  const collapsedGroupKey = `team:${group.id}`;
  const collapsed = collapsedSessionGroups.includes(collapsedGroupKey);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, marginBottom: 2 }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <button
          type="button"
          className="sidebar-group-toggle"
          aria-expanded={!collapsed}
          aria-controls={groupBodyId}
          onClick={() => toggleSessionGroupCollapsed(collapsedGroupKey)}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onWorkspaceContextMenu({ id: group.id, name: group.label }, e.clientX, e.clientY);
          }}
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            minWidth: 0,
            padding: '6px 6px 6px 8px',
            borderRadius: 6,
            color: 'var(--fg-default)',
            textAlign: 'left',
          }}
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            style={{
              flexShrink: 0,
              transform: collapsed ? 'rotate(0deg)' : 'rotate(90deg)',
              transition: 'transform 150ms ease',
            }}
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            style={{ flexShrink: 0, color: 'var(--accent)' }}
          >
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
          <span
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 12.5,
              fontWeight: 700,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              letterSpacing: '0.015em',
              color: 'var(--fg-strong)',
            }}
          >
            {isWorkspaceRenaming ? (
              <input
                className="session-rename-input"
                ref={(element) => element?.focus()}
                value={workspaceRenameValue}
                onChange={(event) => onWorkspaceRenameChange(event.target.value)}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === 'Enter' || event.key === 'Escape') {
                    onWorkspaceRenameCommit(group.id);
                  }
                }}
                onBlur={() => onWorkspaceRenameCommit(group.id)}
                onClick={(event) => event.stopPropagation()}
                style={{
                  width: '100%',
                  background: 'var(--bg-overlay)',
                  border: '1px solid var(--accent)',
                  borderRadius: 4,
                  padding: '1px 4px',
                  color: 'var(--fg-strong)',
                  fontSize: 11,
                  fontWeight: 700,
                }}
              />
            ) : (
              group.label
            )}
          </span>
          <span
            style={{
              fontSize: 10,
              color: 'var(--fg-muted)',
              flexShrink: 0,
              marginRight: 2,
            }}
          >
            {group.sessions.length}
          </span>
        </button>
        {canNewSession && (
          <button
            type="button"
            className="sidebar-icon-button"
            onClick={() => onNewSession(group.id)}
            title={`在 ${group.label} 中新建团队会话`}
            aria-label={`在 ${group.label} 中新建团队会话`}
            style={{
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 20,
              height: 20,
              borderRadius: 5,
              padding: 0,
              marginRight: 4,
            }}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        )}
      </div>

      <div
        id={groupBodyId}
        style={{
          display: collapsed ? 'none' : 'flex',
          marginLeft: 16,
          marginTop: 2,
          borderLeft: '1px solid var(--border-subtle)',
          paddingLeft: 4,
          paddingTop: 2,
          paddingBottom: 2,
          flexDirection: 'column',
          gap: 1,
        }}
      >
        {group.sessions.map((ts) => {
          const isActive = activeTeamSessionId === ts.id;
          const isRunning = ts.stateStatus === 'running';
          const isPaused = ts.stateStatus === 'paused';

          const statusColor = isRunning
            ? 'var(--accent)'
            : isPaused
              ? 'var(--warning)'
              : 'var(--border-default)';

          return (
            <BaseSessionRow
              key={ts.id}
              sessionId={ts.id}
              title={ts.title}
              timeLabel={formatSessionTime(ts.updatedAt)}
              timeTitle={formatSessionTimeTitle(ts.updatedAt)}
              active={isActive}
              hovered={hoveredSessionId === ts.id}
              density="compact"
              onSelect={() => {
                preloadRoute('/team');
                if (ts.teamWorkspaceId) {
                  onSelectSession(ts.teamWorkspaceId, ts.id);
                  void navigate(buildTeamSessionRoute(ts.teamWorkspaceId, ts.id));
                } else {
                  void navigate('/team');
                }
              }}
              onContextMenu={(_event, id) => {
                onSessionContextMenu(
                  {
                    id,
                    title: ts.title,
                    stateStatus: ts.stateStatus,
                    teamWorkspaceId: ts.teamWorkspaceId,
                  },
                  _event.clientX,
                  _event.clientY,
                );
              }}
              onLongPress={(position) => {
                onSessionContextMenu(
                  {
                    id: ts.id,
                    title: ts.title,
                    stateStatus: ts.stateStatus,
                    teamWorkspaceId: ts.teamWorkspaceId,
                  },
                  position.x,
                  position.y,
                );
              }}
              onHoverChange={setHoveredSessionId}
              onPreload={() => preloadRoute('/team')}
              renaming={renamingSessionId === ts.id}
              renameValue={renameValue}
              onRenameChange={onRenameChange}
              onRenameCommit={onRenameCommit}
              icon={
                <span
                  style={{
                    position: 'relative',
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 20,
                    height: 20,
                    borderRadius: 5,
                    background: isActive
                      ? 'color-mix(in oklch, var(--accent) 15%, transparent)'
                      : 'transparent',
                  }}
                >
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: '50%',
                      background: statusColor,
                      animation: isRunning
                        ? 'permissionPulse 1.5s ease-in-out infinite'
                        : undefined,
                    }}
                  />
                </span>
              }
              meta={
                <span
                  style={{
                    fontSize: 10,
                    color: 'var(--fg-muted)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  {isRunning && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                      <span
                        style={{
                          width: 5,
                          height: 5,
                          borderRadius: '50%',
                          background: 'var(--accent)',
                          animation: 'permissionPulse 1.5s ease-in-out infinite',
                        }}
                      />
                      <span style={{ color: 'var(--accent)', fontWeight: 600 }}>运行中</span>
                    </span>
                  )}
                  {isPaused && (
                    <span style={{ color: 'var(--warning)', fontWeight: 600 }}>已暂停</span>
                  )}
                  {!isRunning && !isPaused && <span style={{ opacity: 0.7 }}>空闲</span>}
                </span>
              }
            />
          );
        })}
      </div>
    </div>
  );
}
