/**
 * FusionSidebarChatGroupSection — 融合侧栏 Chat 会话分组列表。
 *
 * 由 FusionSidebar 主文件拆出：渲染工作区分组标题（可折叠、含计数与
 * 新建会话入口）以及组内会话行；置顶分区使用图钉图标且不提供新建入口。
 */

import { SessionSidebarSessionRow } from '../sidebar/SessionSidebarSessionRow.js';
import type { Session } from '../../../hooks/workspace/useSessions.js';
import { countRunningSessions, type FusionChatGroupRow } from './fusion-sidebar-session-groups.js';

/** 会话行共享回调：由主组件一次性构造，避免逐行透传。 */
export interface FusionChatSessionRowHandlers {
  activeSessionId: string | null;
  commitRename: (sessionId: string) => Promise<void>;
  /** 命中消息内容的会话 ID：用于在行内标记「内容命中」 */
  contentMatchedSessionIds: ReadonlySet<string>;
  hoveredSessionId: string | null;
  isDeletingSession: (sessionId: string) => boolean;
  isPinned: (sessionId: string) => boolean;
  onHoveredSessionChange: (sessionId: string | null) => void;
  onOpenContextMenu: (sessionId: string, x: number, y: number) => void;
  onPointerPositionChange: (position: { x: number; y: number } | null) => void;
  openChatSession: (sessionId: string) => void;
  preloadChatRoute: (sessionId: string) => void;
  quickDeleteSession: (sessionId: string) => Promise<boolean>;
  quickExportSession: (sessionId: string) => Promise<void>;
  renameValue: string;
  renamingSessionId: string | null;
  /** 当前搜索词：非空时标题以高亮文本渲染 */
  searchQuery: string;
  setRenameValue: (value: string) => void;
  startRename: (session: Session) => void;
}

export interface FusionSidebarChatGroupSectionProps {
  groups: readonly FusionChatGroupRow[];
  collapsedGroups: ReadonlySet<string>;
  isSearching: boolean;
  toggleGroupCollapsed: (groupKey: string) => void;
  onCreateSession: (workspacePath: string | null) => void;
  rowHandlers: FusionChatSessionRowHandlers;
}

export function FusionSidebarChatGroupSection({
  groups,
  collapsedGroups,
  isSearching,
  toggleGroupCollapsed,
  onCreateSession,
  rowHandlers,
}: FusionSidebarChatGroupSectionProps) {
  return (
    <>
      {groups.map((group) => {
        const groupKey = group.key;
        const isCollapsed = collapsedGroups.has(groupKey);
        const groupBodyId = `fusion-session-group-${encodeURIComponent(groupKey)}`;
        const runningCount = countRunningSessions(group.roots);

        return (
          <div
            key={groupKey}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 0,
              marginBottom: 2,
            }}
          >
            {/* 分组标题 */}
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <button
                type="button"
                className="sidebar-group-toggle"
                aria-expanded={!isCollapsed}
                aria-controls={groupBodyId}
                onClick={() => toggleGroupCollapsed(groupKey)}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 6px 6px 8px',
                  fontSize: 11,
                  fontWeight: 700,
                  color: 'var(--fg-default)',
                  borderRadius: 6,
                  textAlign: 'left',
                  minWidth: 0,
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
                    transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)',
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
                  {group.isPinnedGroup ? (
                    <>
                      <line x1="12" y1="17" x2="12" y2="22" />
                      <path d="M5 17H19V15L17 9V4H18V2H6V4H7V9L5 15V17Z" />
                    </>
                  ) : (
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  )}
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
                  {group.workspaceLabel}
                </span>
                {runningCount > 0 ? (
                  <span
                    style={{
                      alignItems: 'center',
                      color: 'var(--accent)',
                      display: 'inline-flex',
                      flexShrink: 0,
                      fontSize: 10,
                      gap: 3,
                    }}
                    title={`${runningCount} 个会话运行中`}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        background: 'var(--accent)',
                        borderRadius: '50%',
                        height: 5,
                        width: 5,
                      }}
                    />
                    {runningCount}
                  </span>
                ) : null}
                <span
                  style={{
                    fontSize: 10,
                    color: 'var(--fg-muted)',
                    flexShrink: 0,
                  }}
                  title={isSearching ? `匹配 ${group.sessionCount} 个会话` : undefined}
                >
                  {group.sessionCount}
                </span>
              </button>
              {!group.isPinnedGroup && (
                <button
                  type="button"
                  title={`在 ${group.workspaceLabel} 中新建会话`}
                  aria-label={`在 ${group.workspaceLabel} 中新建会话`}
                  onClick={() => onCreateSession(group.workspacePath)}
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
            {/* 分组下的会话列表：缩进 + 引导线，与组标题形成层级 */}
            <div
              id={groupBodyId}
              style={{
                display: isCollapsed ? 'none' : 'flex',
                marginLeft: 16,
                marginTop: 2,
                paddingLeft: 4,
                paddingTop: 2,
                paddingBottom: 2,
                borderLeft: '1px solid var(--border-subtle)',
                flexDirection: 'column',
                gap: 1,
              }}
            >
              {group.roots.map((node) => (
                <SessionSidebarSessionRow
                  key={node.session.id}
                  activeSessionId={rowHandlers.activeSessionId ?? undefined}
                  commitRename={rowHandlers.commitRename}
                  contentMatched={rowHandlers.contentMatchedSessionIds.has(node.session.id)}
                  hoveredSessionId={rowHandlers.hoveredSessionId}
                  isDeletingSession={rowHandlers.isDeletingSession}
                  isPinned={rowHandlers.isPinned}
                  node={node}
                  onHoveredSessionChange={rowHandlers.onHoveredSessionChange}
                  onOpenContextMenu={rowHandlers.onOpenContextMenu}
                  onPointerPositionChange={rowHandlers.onPointerPositionChange}
                  openChatSession={rowHandlers.openChatSession}
                  preloadChatRoute={rowHandlers.preloadChatRoute}
                  quickDeleteSession={rowHandlers.quickDeleteSession}
                  quickExportSession={rowHandlers.quickExportSession}
                  renameValue={rowHandlers.renameValue}
                  renamingSessionId={rowHandlers.renamingSessionId}
                  searchQuery={rowHandlers.searchQuery}
                  setRenameValue={rowHandlers.setRenameValue}
                  startRename={rowHandlers.startRename}
                />
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}
