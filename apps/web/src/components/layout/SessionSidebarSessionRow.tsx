import React, { useMemo } from 'react';
import type { Session } from '../../hooks/useSessions.js';
import {
  extractSessionIcon,
  getSessionModeLabels,
  hasParentSession,
} from '../../utils/session-metadata.js';
import type { WorkspaceSessionTreeNode } from '../../utils/session-grouping.js';

const sessionActionButtonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 22,
  height: 22,
  borderRadius: 5,
  background: 'transparent',
  border: 'none',
  color: 'var(--text-3)',
  cursor: 'pointer',
  padding: 0,
  flexShrink: 0,
};

function isNestedInteractiveTarget(target: EventTarget | null): target is Element {
  return target instanceof Element && target.closest('button, input, textarea, select, a') !== null;
}

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <li
        data-session-id={session.id}
        data-session-state={session.state_status ?? 'idle'}
        className={`session-item${isActive ? ' active' : ''}`}
        onClick={(event) => {
          if (isNestedInteractiveTarget(event.target)) {
            return;
          }

          openChatSession(session.id);
        }}
        onKeyDown={(event) => {
          if (isNestedInteractiveTarget(event.target)) {
            return;
          }

          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openChatSession(session.id);
          }
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          onOpenContextMenu(session.id, event.clientX, event.clientY);
        }}
        onMouseEnter={(event) => {
          preloadChatRoute(session.id);
          onPointerPositionChange({
            x: event.clientX,
            y: event.clientY,
          });
          onHoveredSessionChange(session.id);
        }}
        onMouseMove={(event) => {
          onPointerPositionChange({
            x: event.clientX,
            y: event.clientY,
          });
        }}
        onMouseLeave={() => {
          onPointerPositionChange(null);
          onHoveredSessionChange(null);
        }}
        onFocusCapture={() => {
          preloadChatRoute(session.id);
          onHoveredSessionChange(session.id);
        }}
        onBlurCapture={(event) => {
          const nextTarget = event.relatedTarget;
          if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
            onHoveredSessionChange(null);
          }
        }}
        style={{
          listStyle: 'none',
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: 6,
          width: '100%',
          borderRadius: 6,
          padding: '4px 6px',
          paddingLeft: `${6 + depth * 12}px`,
          background: isActive ? 'var(--accent-muted)' : 'transparent',
        }}
      >
        {depth > 0 && (
          <span
            aria-hidden="true"
            style={{
              width: 12,
              flexShrink: 0,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-3)',
              fontSize: 10,
              fontWeight: 700,
            }}
          >
            ↳
          </span>
        )}
        <span
          style={{
            position: 'relative',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 20,
            height: 20,
            marginTop: 2,
            borderRadius: 5,
            background: isActive
              ? 'color-mix(in oklch, var(--accent) 15%, transparent)'
              : 'transparent',
            color: isActive
              ? 'var(--accent)'
              : isPinned(session.id)
                ? 'var(--accent)'
                : 'var(--text-3)',
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
                background: '#22c55e',
                boxShadow: '0 0 5px #22c55e',
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
                background: 'var(--warning, #f59e0b)',
              }}
            />
          )}
        </span>
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
          }}
        >
          {isRenaming ? (
            <input
              className="session-rename-input"
              ref={(element) => element?.focus()}
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === 'Enter') void commitRename(session.id);
                if (event.key === 'Escape') void commitRename(session.id);
              }}
              onBlur={() => void commitRename(session.id)}
              style={{
                flex: 1,
                minWidth: 0,
                background: 'var(--bg-2)',
                border: '1px solid var(--accent)',
                borderRadius: 6,
                padding: '3px 6px',
                color: 'var(--text)',
                fontSize: 12,
              }}
            />
          ) : (
            <button
              type="button"
              onPointerEnter={() => preloadChatRoute(session.id)}
              onFocus={() => preloadChatRoute(session.id)}
              onClick={() => openChatSession(session.id)}
              title={session.title ?? '未命名'}
              style={{
                display: 'flex',
                alignItems: 'center',
                textAlign: 'left',
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                padding: '1px 0',
                minWidth: 0,
              }}
            >
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontSize: 12,
                  fontWeight: isActive ? 600 : 400,
                  color: isActive ? 'var(--text)' : 'var(--text-2)',
                  lineHeight: '1.35',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {session.title ?? '未命名'}
              </span>
            </button>
          )}
          <div
            style={{
              position: 'relative',
              height: 16,
            }}
          >
            <span
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                opacity: !isRenaming && !isHovered ? 1 : 0,
                transition: 'opacity 120ms ease-out',
                pointerEvents: 'none',
                willChange: 'opacity',
              }}
            >
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  display: 'inline-flex',
                  alignItems: 'center',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  lineHeight: '16px',
                  fontSize: 10,
                }}
              >
                {showChildBadge && (
                  <>
                    <span style={{ color: 'var(--accent)', fontWeight: 600 }}>子会话</span>
                    {modeLabels.length > 0 && (
                      <span style={{ color: 'var(--text-3)', margin: '0 3px' }}>·</span>
                    )}
                  </>
                )}
                {modeLabels.map((label, i) => (
                  <React.Fragment key={label}>
                    {i > 0 && <span style={{ color: 'var(--text-3)', margin: '0 3px' }}>·</span>}
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
              <span
                style={{
                  fontSize: 10,
                  color: 'var(--text-3)',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                  lineHeight: '16px',
                }}
              >
                {new Date(session.updated_at).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                })}
              </span>
            </span>
            <div
              className="session-actions"
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 4,
                alignItems: 'center',
                opacity: isHovered && !isRenaming ? 1 : 0,
                transition: 'opacity 120ms ease-out',
                pointerEvents: isHovered && !isRenaming ? 'auto' : 'none',
                willChange: 'opacity',
              }}
            >
              <button
                type="button"
                onClick={() => startRename(session)}
                tabIndex={isHovered && !isRenaming ? 0 : -1}
                title="重命名"
                style={sessionActionButtonStyle}
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
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => void quickExportSession(session.id)}
                tabIndex={isHovered && !isRenaming ? 0 : -1}
                title="导出"
                style={sessionActionButtonStyle}
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
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => void quickDeleteSession(session.id)}
                disabled={deleting}
                tabIndex={isHovered && !isRenaming ? 0 : -1}
                title={deleting ? '删除中…' : '删除'}
                style={{
                  ...sessionActionButtonStyle,
                  color: 'var(--danger)',
                  opacity: deleting ? 0.45 : sessionActionButtonStyle.opacity,
                  cursor: deleting ? 'wait' : sessionActionButtonStyle.cursor,
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
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  <path d="M10 11v6" />
                  <path d="M14 11v6" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </li>
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
