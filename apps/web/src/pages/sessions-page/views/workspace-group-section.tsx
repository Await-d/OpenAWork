import { memo, useCallback, type CSSProperties, type KeyboardEvent } from 'react';
import { SessionCard, SESSION_CARD_ACTION_BUTTON_STYLE } from './session-card.js';
import type { SessionRow } from '../state/session-page-types.js';

const SECTION_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

const HEADER_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  position: 'sticky',
  top: 0,
  zIndex: 1,
  padding: '8px 4px 6px',
  margin: '0 -4px',
  background:
    'linear-gradient(to bottom, var(--bg-base) 70%, color-mix(in oklab, var(--bg-base), transparent 8%) 100%)',
  backdropFilter: 'saturate(140%)',
  borderBottom: '1px solid transparent',
};

const HEADER_BUTTON_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flex: 1,
  minWidth: 0,
  padding: 0,
  border: 'none',
  background: 'transparent',
  textAlign: 'left',
  cursor: 'pointer',
  color: 'inherit',
};

const NEW_BUTTON_STYLE: CSSProperties = {
  ...SESSION_CARD_ACTION_BUTTON_STYLE,
  flexShrink: 0,
  padding: '3px 9px',
};

const CHEVRON_STYLE: CSSProperties = {
  width: 12,
  height: 12,
  flexShrink: 0,
  color: 'var(--fg-muted)',
  transition: 'transform 140ms ease',
};

const SESSION_LIST_STYLE: CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
};

const EMPTY_GROUP_STYLE: CSSProperties = {
  padding: '8px 10px',
  borderRadius: 6,
  color: 'var(--fg-muted)',
  fontSize: 11,
  lineHeight: 1.5,
};

interface WorkspaceGroupSectionProps {
  groupKey: string;
  workspaceLabel: string;
  workspacePath: string | null;
  sessions: SessionRow[];
  actualSessionCount: number;
  collapsed: boolean;
  /**
   * When `false`, hide the per-group "新建" button. Useful for scopes (e.g.
   * team sessions) where workspace-targeted creation lives elsewhere.
   * Defaults to `true` to preserve the original behavior.
   */
  showCreateButton?: boolean;
  selectedId: string | null;
  hoveredId: string | null;
  renamingId: string | null;
  renameValue: string;
  deletingSessionIds: Set<string>;
  onToggleCollapsed: (groupKey: string) => void;
  onCreateInWorkspace: (workspacePath: string | null) => void;
  onRequestContextMenu: (
    args: {
      groupKey: string;
      workspaceLabel: string;
      workspacePath: string | null;
      sessionCount: number;
      x: number;
      y: number;
    },
  ) => void;
  onSessionHoverEnter: (sessionId: string, position?: { x: number; y: number }) => void;
  onSessionHoverMove: (sessionId: string, position: { x: number; y: number }) => void;
  onSessionHoverLeave: (sessionId: string) => void;
  onSessionSelect: (sessionId: string) => void;
  onSessionRenameChange: (value: string) => void;
  onSessionRenameCommit: (sessionId: string) => void;
  onSessionRenameCancel: () => void;
  onSessionStartRename: (session: SessionRow) => void;
  onSessionExport: (session: SessionRow) => void;
  onSessionDelete: (sessionId: string) => void;
}

export const WorkspaceGroupSection = memo(function WorkspaceGroupSection({
  groupKey,
  workspaceLabel,
  workspacePath,
  sessions,
  actualSessionCount,
  collapsed,
  showCreateButton = true,
  selectedId,
  hoveredId,
  renamingId,
  renameValue,
  deletingSessionIds,
  onToggleCollapsed,
  onCreateInWorkspace,
  onRequestContextMenu,
  onSessionHoverEnter,
  onSessionHoverMove,
  onSessionHoverLeave,
  onSessionSelect,
  onSessionRenameChange,
  onSessionRenameCommit,
  onSessionRenameCancel,
  onSessionStartRename,
  onSessionExport,
  onSessionDelete,
}: WorkspaceGroupSectionProps) {
  const headerLabelId = `sessions-group-${groupKey}-label`;
  const listId = `sessions-group-${groupKey}-list`;

  const toggleCollapsed = useCallback(() => {
    onToggleCollapsed(groupKey);
  }, [groupKey, onToggleCollapsed]);

  const onHeaderKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === 'ArrowRight' && collapsed) {
        event.preventDefault();
        onToggleCollapsed(groupKey);
        return;
      }
      if (event.key === 'ArrowLeft' && !collapsed) {
        event.preventDefault();
        onToggleCollapsed(groupKey);
      }
    },
    [collapsed, groupKey, onToggleCollapsed],
  );

  const onContextMenu: React.MouseEventHandler<HTMLButtonElement> = (event) => {
    if (!workspacePath && actualSessionCount === 0) {
      return;
    }
    event.preventDefault();
    onRequestContextMenu({
      groupKey,
      workspaceLabel,
      workspacePath,
      sessionCount: actualSessionCount,
      x: event.clientX,
      y: event.clientY,
    });
  };

  return (
    <section style={SECTION_STYLE} aria-labelledby={headerLabelId} data-workspace-group={groupKey}>
      <header style={HEADER_STYLE}>
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-controls={listId}
          onClick={toggleCollapsed}
          onContextMenu={onContextMenu}
          onKeyDown={onHeaderKeyDown}
          title={
            workspacePath || actualSessionCount > 0
              ? `右键管理工作区 ${workspaceLabel}`
              : undefined
          }
          style={HEADER_BUTTON_STYLE}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            style={{
              ...CHEVRON_STYLE,
              transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
            }}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
          <span
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 1,
              minWidth: 0,
              flex: 1,
            }}
          >
            <span
              id={headerLabelId}
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: 'var(--fg-default)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {workspaceLabel}
            </span>
            <span
              style={{
                fontSize: 11,
                color: 'var(--fg-muted)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={workspacePath ?? '未绑定工作区'}
            >
              {workspacePath ?? '未绑定工作区'}
            </span>
          </span>
          <span
            aria-label={`包含 ${actualSessionCount} 个会话`}
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--fg-muted)',
              padding: '1px 7px',
              borderRadius: 99,
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-overlay)',
              flexShrink: 0,
            }}
          >
            {actualSessionCount}
          </span>
        </button>
        {showCreateButton && workspacePath && (
          <button
            type="button"
            onClick={() => onCreateInWorkspace(workspacePath)}
            title={`在 ${workspaceLabel} 中新建会话`}
            className="omo-group-new-btn"
            style={NEW_BUTTON_STYLE}
          >
            + 新建
          </button>
        )}
      </header>
      {!collapsed && (
        <ul id={listId} style={SESSION_LIST_STYLE}>
          {sessions.map((s) => (
            <SessionCard
              key={s.id}
              s={s}
              isSelected={selectedId === s.id}
              isHovered={hoveredId === s.id}
              isDeleting={deletingSessionIds.has(s.id)}
              isRenaming={renamingId === s.id}
              renameValue={renameValue}
              smallBtn={SESSION_CARD_ACTION_BUTTON_STYLE}
              onHoverEnter={onSessionHoverEnter}
              onHoverMove={onSessionHoverMove}
              onHoverLeave={onSessionHoverLeave}
              onSelect={onSessionSelect}
              onRenameChange={onSessionRenameChange}
              onRenameCommit={onSessionRenameCommit}
              onRenameCancel={onSessionRenameCancel}
              onStartRename={onSessionStartRename}
              onExport={onSessionExport}
              onDelete={onSessionDelete}
            />
          ))}
          {sessions.length === 0 && (
            <li style={EMPTY_GROUP_STYLE}>
              {actualSessionCount === 0
                ? '暂无会话,可在此工作区中新建一个会话。'
                : '当前筛选条件下暂无匹配会话。'}
            </li>
          )}
        </ul>
      )}
    </section>
  );
});
