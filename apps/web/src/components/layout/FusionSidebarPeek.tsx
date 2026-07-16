import type { CSSProperties } from 'react';
import type { Session } from '../../hooks/workspace/useSessions.js';
import type { WorkspaceSessionTreeNode } from '../../utils/session/session-grouping.js';
import { getPathBasename } from '../../utils/workspace-path.js';

export interface FusionSidebarPeekProps {
  readonly activeSessionId: string | null;
  readonly nodes: readonly WorkspaceSessionTreeNode<Session>[];
  readonly onCreateSession: () => void;
  readonly onMouseEnter: () => void;
  readonly onMouseLeave: () => void;
  readonly onSelectSession: (sessionId: string) => void;
  readonly workspacePath: string | null;
}

const PEEK_STYLE: CSSProperties = {
  background: 'var(--bg-surface)',
  border: '1px solid var(--accent-border)',
  borderRadius: 'var(--radius-md)',
  boxShadow: 'var(--shadow-lg)',
  display: 'flex',
  flexDirection: 'column',
  left: 64,
  maxHeight: 'calc(100% - var(--spacing-4))',
  overflow: 'hidden',
  position: 'absolute',
  top: 'var(--spacing-2)',
  width: 244,
  zIndex: 40,
};

const HEADER_STYLE: CSSProperties = {
  alignItems: 'center',
  background: 'var(--accent-subtle)',
  borderBottom: '1px solid var(--border-subtle)',
  display: 'flex',
  gap: 'var(--spacing-2)',
  justifyContent: 'space-between',
  minHeight: 44,
  padding: '0 var(--spacing-3)',
};

const TITLE_STYLE: CSSProperties = {
  color: 'var(--accent)',
  fontSize: 12,
  fontWeight: 700,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const SUBTITLE_STYLE: CSSProperties = {
  color: 'var(--fg-subtle)',
  fontSize: 10,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const LIST_STYLE: CSSProperties = {
  display: 'flex',
  flex: 1,
  flexDirection: 'column',
  minHeight: 0,
  overflowY: 'auto',
  padding: 'var(--spacing-2)',
};

const ITEM_STYLE: CSSProperties = {
  alignItems: 'center',
  background: 'transparent',
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--fg-muted)',
  cursor: 'pointer',
  display: 'flex',
  fontSize: 11,
  gap: 'var(--spacing-2)',
  minHeight: 32,
  minWidth: 0,
  padding: '0 var(--spacing-2)',
  textAlign: 'left',
};

const FOOTER_BUTTON_STYLE: CSSProperties = {
  alignItems: 'center',
  background: 'var(--accent-subtle)',
  border: 'none',
  borderTop: '1px solid var(--border-subtle)',
  color: 'var(--accent)',
  cursor: 'pointer',
  display: 'flex',
  fontSize: 12,
  fontWeight: 700,
  gap: 'var(--spacing-2)',
  height: 36,
  justifyContent: 'center',
};

function basename(path: string | null): string {
  return getPathBasename(path, 'OpenAWork');
}

function flattenNodes(
  nodes: readonly WorkspaceSessionTreeNode<Session>[],
): readonly WorkspaceSessionTreeNode<Session>[] {
  return nodes.flatMap((node) => [node, ...flattenNodes(node.children)]);
}

export function FusionSidebarPeek({
  activeSessionId,
  nodes,
  onCreateSession,
  onMouseEnter,
  onMouseLeave,
  onSelectSession,
  workspacePath,
}: FusionSidebarPeekProps) {
  const visibleNodes = flattenNodes(nodes).slice(0, 8);

  return (
    <aside
      aria-label="工作区会话预览"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={PEEK_STYLE}
    >
      <div style={HEADER_STYLE}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
          <span style={TITLE_STYLE}>{basename(workspacePath)}</span>
          <span style={SUBTITLE_STYLE}>{workspacePath ?? '未选择工作区'}</span>
        </div>
        <span aria-hidden="true" style={{ color: 'var(--fg-subtle)', flexShrink: 0 }}>
          ⋯
        </span>
      </div>

      <div style={LIST_STYLE}>
        {visibleNodes.length > 0 ? (
          visibleNodes.map((node) => {
            const active = activeSessionId === node.session.id;
            return (
              <button
                key={node.session.id}
                type="button"
                onClick={() => onSelectSession(node.session.id)}
                style={{
                  ...ITEM_STYLE,
                  background: active ? 'var(--accent-subtle)' : 'transparent',
                  borderLeft: active ? '3px solid var(--accent)' : '3px solid transparent',
                  color: active ? 'var(--accent)' : 'var(--fg-muted)',
                  fontWeight: active ? 700 : 500,
                }}
              >
                <span aria-hidden="true" style={{ flexShrink: 0 }}>
                  ·
                </span>
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {node.session.title ?? '未命名会话'}
                </span>
                {node.session.state_status === 'running' ? (
                  <span
                    aria-label="运行中"
                    style={{
                      background: 'var(--accent)',
                      borderRadius: '50%',
                      flexShrink: 0,
                      height: 6,
                      width: 6,
                    }}
                  />
                ) : null}
              </button>
            );
          })
        ) : (
          <p style={{ color: 'var(--fg-muted)', fontSize: 12, margin: 0, padding: '20px 8px' }}>
            暂无会话
          </p>
        )}
      </div>

      <button type="button" onClick={onCreateSession} style={FOOTER_BUTTON_STYLE}>
        <svg
          aria-hidden="true"
          fill="none"
          height="14"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          viewBox="0 0 24 24"
          width="14"
        >
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        新建会话
      </button>
    </aside>
  );
}
