import React, { useMemo } from 'react';
import type { Session } from '../../../hooks/workspace/useSessions.js';
import {
  extractDialogueMode,
  extractSessionIcon,
  getSessionModeLabels,
  hasParentSession,
} from '../../../utils/session/session-metadata.js';
import type { WorkspaceSessionTreeNode } from '../../../utils/session/session-grouping.js';
import {
  BaseSessionRow,
  RenameIcon,
  ExportIcon,
  DeleteIcon,
  type BaseSessionRowAction,
} from './BaseSessionRow.js';

export interface SessionSidebarSessionRowProps {
  activeSessionId?: string;
  commitRename: (sessionId: string) => Promise<void>;
  depth?: number;
  hoveredSessionId: string | null;
  isDeletingSession: (sessionId: string) => boolean;
  isPinned: (sessionId: string) => boolean;
  node: WorkspaceSessionTreeNode<Session>;
  onHoveredSessionChange: (sessionId: string | null) => void;
  onOpenContextMenu: (sessionId: string, x: number, y: number) => void;
  onPointerPositionChange: (position: { x: number; y: number } | null) => void;
  openChatSession: (sessionId: string) => void;
  preloadChatRoute: (sessionId: string) => void;
  quickDeleteSession: (sessionId: string) => Promise<boolean>;
  quickExportSession: (sessionId: string) => Promise<void>;
  renameValue: string;
  renamingSessionId: string | null;
  setRenameValue: (value: string) => void;
  startRename: (session: Session) => void;
}

export function SessionSidebarSessionRow({
  activeSessionId,
  commitRename,
  depth = 0,
  hoveredSessionId,
  isDeletingSession,
  isPinned,
  node,
  onHoveredSessionChange,
  onOpenContextMenu,
  onPointerPositionChange,
  openChatSession,
  preloadChatRoute,
  quickDeleteSession,
  quickExportSession,
  renameValue,
  renamingSessionId,
  setRenameValue,
  startRename,
}: SessionSidebarSessionRowProps) {
  const session = node.session;
  const isActive = session.id === activeSessionId;
  const isHovered = hoveredSessionId === session.id;
  const isRenaming = renamingSessionId === session.id;
  const showChildBadge = depth > 0 || hasParentSession(session.metadata_json);
  const deleting = isDeletingSession(session.id);
  const modeLabels = useMemo(
    () => getSessionModeLabels(session.metadata_json),
    [session.metadata_json],
  );
  const sessionIcon = useMemo(
    () => extractSessionIcon(session.metadata_json),
    [session.metadata_json],
  );
  const dialogueMode = useMemo(
    () => extractDialogueMode(session.metadata_json),
    [session.metadata_json],
  );

  const actions: BaseSessionRowAction[] = useMemo(
    () => [
      {
        key: 'rename',
        title: '重命名',
        icon: RenameIcon,
        onClick: () => startRename(session),
      },
      {
        key: 'export',
        title: '导出',
        icon: ExportIcon,
        onClick: () => void quickExportSession(session.id),
      },
      {
        key: 'delete',
        title: deleting ? '删除中…' : '删除',
        icon: DeleteIcon,
        onClick: () => void quickDeleteSession(session.id),
        disabled: deleting,
        danger: true,
      },
    ],
    [session, deleting, startRename, quickExportSession, quickDeleteSession],
  );

  const iconNode = (
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
        color: isActive
          ? 'var(--accent)'
          : isPinned(session.id)
            ? 'var(--accent)'
            : 'var(--fg-muted)',
        transition: 'background 120ms ease',
      }}
    >
      {isPinned(session.id) ? (
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
          <line x1="12" y1="17" x2="12" y2="22" />
          <path d="M5 17H19V15L17 9V4H18V2H6V4H7V9L5 15V17Z" />
        </svg>
      ) : sessionIcon ? (
        <span aria-hidden="true" style={{ fontSize: 14, lineHeight: 1 }}>
          {sessionIcon}
        </span>
      ) : dialogueMode === 'coding' ? (
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
          <polyline points="16 18 22 12 16 6" />
          <polyline points="8 6 2 12 8 18" />
        </svg>
      ) : dialogueMode === 'programmer' ? (
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
          <rect x="2" y="4" width="20" height="16" rx="2" />
          <path d="M8 9l-3 3 3 3" />
          <path d="M16 9l3 3-3 3" />
          <path d="M12 7l-2 10" />
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
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      )}
      {session.state_status === 'running' && (
        <span
          aria-label="运行中"
          style={{
            position: 'absolute',
            bottom: -1,
            right: -1,
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: 'var(--success)',
            boxShadow: '0 0 5px var(--success)',
            animation: 'pulse 1.5s ease-in-out infinite',
          }}
        />
      )}
      {session.state_status === 'paused' && (
        <span
          aria-label="已暂停"
          style={{
            position: 'absolute',
            bottom: -1,
            right: -1,
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: 'var(--warning)',
          }}
        />
      )}
    </span>
  );

  const metaNode = (
    <span
      style={{
        flex: 1,
        minWidth: 0,
        display: 'inline-flex',
        alignItems: 'center',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        lineHeight: '14px',
        fontSize: 10,
      }}
    >
      {showChildBadge && (
        <>
          <span style={{ color: 'var(--accent)', fontWeight: 600 }}>子会话</span>
          {modeLabels.length > 0 && (
            <span style={{ color: 'var(--fg-muted)', margin: '0 3px' }}>·</span>
          )}
        </>
      )}
      {modeLabels.map((label, i) => (
        <React.Fragment key={label}>
          {i > 0 && <span style={{ color: 'var(--fg-muted)', margin: '0 3px' }}>·</span>}
          <span
            style={{
              fontWeight: 600,
              flexShrink: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              color:
                label === '澄清(方案)'
                  ? 'rgb(245, 158, 11)'
                  : label === '编程'
                    ? 'rgb(167, 139, 250)'
                    : label === '程序员'
                      ? 'rgb(52, 211, 153)'
                      : label === 'YOLO'
                        ? 'var(--accent)'
                        : 'rgb(96, 165, 250)',
            }}
          >
            {label}
          </span>
        </React.Fragment>
      ))}
    </span>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      <BaseSessionRow
        sessionId={session.id}
        title={session.title ?? '未命名'}
        density="compact"
        timeLabel={new Date(session.updated_at).toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
        })}
        active={isActive}
        hovered={isHovered}
        icon={iconNode}
        meta={metaNode}
        actions={actions}
        hideMetaOnHover={true}
        onSelect={openChatSession}
        onContextMenu={(event, id) => {
          onOpenContextMenu(id, event.clientX, event.clientY);
        }}
        onHoverChange={onHoveredSessionChange}
        onPreload={preloadChatRoute}
        onPointerPositionChange={onPointerPositionChange}
        depth={depth}
        dataState={session.state_status ?? 'idle'}
        renaming={isRenaming}
        renameValue={renameValue}
        onRenameChange={setRenameValue}
        onRenameCommit={(id) => void commitRename(id)}
      />
      {node.children.length > 0 && (
        <div
          style={{
            marginLeft: `${18 + depth * 12}px`,
            paddingLeft: 8,
            borderLeft: '1px solid var(--border-subtle)',
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
          }}
        >
          {node.children.map((childNode) => (
            <SessionSidebarSessionRow
              key={childNode.session.id}
              activeSessionId={activeSessionId}
              commitRename={commitRename}
              depth={depth + 1}
              hoveredSessionId={hoveredSessionId}
              isDeletingSession={isDeletingSession}
              isPinned={isPinned}
              node={childNode}
              onHoveredSessionChange={onHoveredSessionChange}
              onOpenContextMenu={onOpenContextMenu}
              onPointerPositionChange={onPointerPositionChange}
              openChatSession={openChatSession}
              preloadChatRoute={preloadChatRoute}
              quickDeleteSession={quickDeleteSession}
              quickExportSession={quickExportSession}
              renameValue={renameValue}
              renamingSessionId={renamingSessionId}
              setRenameValue={setRenameValue}
              startRename={startRename}
            />
          ))}
        </div>
      )}
    </div>
  );
}
