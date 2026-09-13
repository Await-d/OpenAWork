import type { CSSProperties } from 'react';
import type { Session } from '../../../hooks/workspace/useSessions.js';
import type { WorkspaceSessionTreeNode } from '../../../utils/session/session-grouping.js';
import { getPathBasename } from '../../../utils/workspace-path.js';

export interface FusionSidebarPeekProps {
  readonly activeSessionId: string | null;
  readonly nodes: readonly WorkspaceSessionTreeNode<Session>[];
  readonly onCreateSession: () => void;
  readonly onMouseEnter: () => void;
  readonly onMouseLeave: () => void;
  readonly onSelectSession: (sessionId: string) => void;
  readonly workspacePath: string | null;
  /** 预览宽度（与展开态的会话侧栏一致） */
  readonly width?: number;
}

const DEFAULT_PEEK_WIDTH = 244;

/** 折叠态预览最多展示的会话条数，其余以「还有 N 条」提示。 */
const MAX_VISIBLE_SESSIONS = 8;

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

const COUNT_STYLE: CSSProperties = {
  color: 'var(--fg-subtle)',
  flexShrink: 0,
  fontSize: 10,
  fontVariantNumeric: 'tabular-nums',
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

const MORE_STYLE: CSSProperties = {
  color: 'var(--fg-subtle)',
  fontSize: 10,
  padding: '6px var(--spacing-2)',
  textAlign: 'center',
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

interface FlattenedPeekNode {
  node: WorkspaceSessionTreeNode<Session>;
  depth: number;
}

function flattenNodes(
  nodes: readonly WorkspaceSessionTreeNode<Session>[],
  depth = 0,
): readonly FlattenedPeekNode[] {
  return nodes.flatMap((node) => [{ node, depth }, ...flattenNodes(node.children, depth + 1)]);
}

function resolveStatusColor(stateStatus: string | undefined): string {
  if (stateStatus === 'running') {
    return 'var(--accent)';
  }
  if (stateStatus === 'paused') {
    return 'var(--warning)';
  }
  return 'var(--border-default)';
}

export function FusionSidebarPeek({
  activeSessionId,
  nodes,
  onCreateSession,
  onMouseEnter,
  onMouseLeave,
  onSelectSession,
  workspacePath,
  width = DEFAULT_PEEK_WIDTH,
}: FusionSidebarPeekProps) {
  const flattenedNodes = flattenNodes(nodes);
  const visibleNodes = flattenedNodes.slice(0, MAX_VISIBLE_SESSIONS);
  const remainingCount = flattenedNodes.length - visibleNodes.length;

  return (
    <aside
      aria-label="工作区会话预览"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{ ...PEEK_STYLE, width }}
    >
      <div style={HEADER_STYLE}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
          <span style={TITLE_STYLE}>{basename(workspacePath)}</span>
          <span style={SUBTITLE_STYLE}>{workspacePath ?? '未选择工作区'}</span>
        </div>
        <span style={COUNT_STYLE}>{flattenedNodes.length} 条</span>
      </div>

      <div style={LIST_STYLE}>
        {visibleNodes.length > 0 ? (
          visibleNodes.map(({ node, depth }) => {
            const active = activeSessionId === node.session.id;
            const statusColor = resolveStatusColor(node.session.state_status);

            return (
              <button
                key={node.session.id}
                type="button"
                onClick={() => onSelectSession(node.session.id)}
                style={{
                  ...ITEM_STYLE,
                  background: active ? 'var(--accent-subtle)' : 'var(--bg-overlay)',
                  border: active
                    ? '1px solid var(--border-default)'
                    : '1px solid var(--border-subtle)',
                  boxShadow: active ? 'var(--shadow-md)' : 'none',
                  color: active ? 'var(--fg-strong)' : 'var(--fg-muted)',
                  fontWeight: active ? 600 : 500,
                  paddingLeft: 8 + depth * 10,
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    background: statusColor,
                    borderRadius: '50%',
                    flexShrink: 0,
                    height: 6,
                    width: 6,
                  }}
                />
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
                  <span aria-label="运行中" style={{ color: 'var(--accent)', flexShrink: 0 }}>
                    运行中
                  </span>
                ) : null}
              </button>
            );
          })
        ) : (
          <p style={{ color: 'var(--fg-muted)', fontSize: 12, margin: 0, padding: '20px 8px' }}>
            暂无会话
          </p>
        )}
        {remainingCount > 0 ? <div style={MORE_STYLE}>还有 {remainingCount} 条会话</div> : null}
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
