/**
 * FusionSidebarTeamGroupSection — 融合侧栏「团队工作空间」分组。
 *
 * 由 FusionSidebar 主文件拆出：包含组标题（可折叠 / 右键菜单 / 重命名）、
 * 组内新建会话入口，以及团队会话行的渲染。
 */

import { BaseSessionRow } from '../sidebar/BaseSessionRow.js';
import { useUIStateStore } from '../../../stores/ui/uiState.js';
import type { TeamWorkspaceGroup } from '../../../hooks/workspace/useTeamSidebarSessions.js';
import {
  formatSessionTime,
  formatSessionTimeTitle,
} from '../../../utils/session/format-session-time.js';
import { buildTeamSessionRoute } from '../../../utils/session/team-session-route.js';

export interface FusionSidebarTeamGroupSectionProps {
  group: TeamWorkspaceGroup;
  activeTeamSessionId: string | null;
  preloadRoute: (path: string) => void;
  navigate: (path: string) => void | Promise<void>;
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
  onStartRename: (session: { id: string; title: string }) => void;
  onWorkspaceContextMenu: (workspace: { id: string; name: string }, x: number, y: number) => void;
  workspaceRenamingId: string | null;
  workspaceRenameValue: string;
  onWorkspaceRenameChange: (value: string) => void;
  onWorkspaceRenameCommit: (workspaceId: string) => void;
  onNewSession: (workspaceId: string) => void;
  onTogglePause: (sessionId: string, stateStatus: string) => void;
  onDelete: (sessionId: string) => void;
}

export function FusionSidebarTeamGroupSection({
  group,
  activeTeamSessionId,
  preloadRoute,
  navigate,
  onSelectSession,
  onSessionContextMenu,
  renamingSessionId,
  renameValue,
  onRenameChange,
  onRenameCommit,
  onStartRename,
  onWorkspaceContextMenu,
  workspaceRenamingId,
  workspaceRenameValue,
  onWorkspaceRenameChange,
  onWorkspaceRenameCommit,
  onNewSession,
  onTogglePause,
  onDelete,
}: FusionSidebarTeamGroupSectionProps) {
  const collapsedSessionGroups = useUIStateStore((s) => s.collapsedSessionGroups);
  const toggleSessionGroupCollapsed = useUIStateStore((s) => s.toggleSessionGroupCollapsed);
  const groupBodyId = `fusion-team-group-${group.id}`;
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
              fontSize: 13.5,
              fontWeight: 700,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              letterSpacing: '0.015em',
              color: 'var(--fg-strong)',
            }}
          >
            {workspaceRenamingId === group.id ? (
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
          <span style={{ fontSize: 10, color: 'var(--fg-muted)', flexShrink: 0, marginRight: 2 }}>
            {group.sessions.length}
          </span>
        </button>
        {group.id !== '__unbound__' && (
          <button
            type="button"
            title={`在 ${group.label} 中新建会话`}
            aria-label={`在 ${group.label} 中新建会话`}
            onClick={() => onNewSession(group.id)}
            className="sidebar-icon-button"
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
          const statusColor = isRunning ? 'var(--accent)' : 'var(--border-default)';
          const isRenaming = renamingSessionId === ts.id;

          return (
            <BaseSessionRow
              key={ts.id}
              sessionId={ts.id}
              title={ts.title}
              timeLabel={formatSessionTime(ts.updatedAt)}
              timeTitle={formatSessionTimeTitle(ts.updatedAt)}
              active={isActive}
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
              onPreload={() => preloadRoute('/team')}
              renaming={isRenaming}
              renameValue={renameValue}
              onRenameChange={onRenameChange}
              onRenameCommit={onRenameCommit}
              actions={[
                {
                  key: 'rename',
                  title: '重命名',
                  icon: (
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
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                    </svg>
                  ),
                  onClick: () => onStartRename({ id: ts.id, title: ts.title }),
                  disabled: isRenaming,
                },
                {
                  key: 'toggle-pause',
                  title: isRunning ? '暂停' : '恢复',
                  icon: isRunning ? (
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
                      <rect x="6" y="4" width="4" height="16" />
                      <rect x="14" y="4" width="4" height="16" />
                    </svg>
                  ) : (
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
                      <polygon points="5 3 19 12 5 21 5 3" />
                    </svg>
                  ),
                  onClick: () => onTogglePause(ts.id, ts.stateStatus),
                },
                {
                  key: 'delete',
                  title: '删除',
                  icon: (
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
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  ),
                  onClick: () => onDelete(ts.id),
                  danger: true,
                },
              ]}
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
                    style={{ width: 7, height: 7, borderRadius: '50%', background: statusColor }}
                  />
                </span>
              }
              meta={
                <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>
                  {isRunning ? '运行中' : '空闲'}
                </span>
              }
            />
          );
        })}
      </div>
    </div>
  );
}
