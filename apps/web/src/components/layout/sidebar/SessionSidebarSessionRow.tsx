import { useMemo } from 'react';
import type { Session } from '../../../hooks/workspace/useSessions.js';
import {
  extractDialogueMode,
  extractSessionIcon,
} from '../../../utils/session/session-metadata.js';
import type { WorkspaceSessionTreeNode } from '../../../utils/session/session-grouping.js';
import {
  formatSessionTime,
  formatSessionTimeTitle,
} from '../../../utils/session/format-session-time.js';
import { useUIStateStore } from '../../../stores/ui/uiState.js';
import { InlineEditor } from '@openAwork/shared-ui';
import { highlightMatch } from './highlight-match.js';
import {
  BaseSessionRow,
  RenameIcon,
  ExportIcon,
  DeleteIcon,
  type BaseSessionRowAction,
} from './BaseSessionRow.js';

/** 子代理折叠箭头的占位尺寸：无子代理的行渲染等宽占位符，保证同级图标与标题左对齐。 */
const SUBAGENT_TOGGLE_SIZE = 16;

export interface SessionSidebarSessionRowProps {
  activeSessionId?: string;
  commitRename: (sessionId: string) => Promise<void>;
  /** 该会话命中消息内容搜索：在 meta 行标记「内容命中」 */
  contentMatched?: boolean;
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
  /** 当前搜索词：非空时标题渲染为高亮文本（此时不挂载可编辑标题） */
  searchQuery?: string;
  setRenameValue: (value: string) => void;
  startRename: (session: Session) => void;
}

export function SessionSidebarSessionRow({
  activeSessionId,
  commitRename,
  contentMatched = false,
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
  searchQuery = '',
  setRenameValue,
  startRename,
}: SessionSidebarSessionRowProps) {
  const session = node.session;
  const isActive = session.id === activeSessionId;
  const isHovered = hoveredSessionId === session.id;
  const isRenaming = renamingSessionId === session.id;
  const deleting = isDeletingSession(session.id);
  const isSubagentsCollapsed = useUIStateStore((s) =>
    s.collapsedSubagentParentIds.includes(session.id),
  );
  const toggleSubagentCollapsed = useUIStateStore((s) => s.toggleSubagentCollapsed);
  const hasSubagents = node.children.length > 0;
  // 搜索时树已被裁剪为「命中节点 + 祖先链」，此时强制展开，避免命中结果被折叠隐藏
  const subagentsExpanded =
    hasSubagents && (searchQuery.trim().length > 0 || !isSubagentsCollapsed);
  const subagentsBodyId = `session-subagents-${encodeURIComponent(session.id)}`;
  const subagentToggleLabel = subagentsExpanded
    ? `折叠 ${node.children.length} 个子代理`
    : `展开 ${node.children.length} 个子代理`;
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

  // 会话列表行不展示对话模式 / 模型名 / 审批档位 / 子会话标记，仅在内容搜索命中时提示
  const metaNode = contentMatched ? (
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
      <span style={{ color: 'var(--aux)', fontWeight: 600 }}>内容命中</span>
    </span>
  ) : null;

  const leadingSlot = hasSubagents ? (
    <button
      type="button"
      className="session-subagent-toggle"
      aria-expanded={subagentsExpanded}
      aria-controls={subagentsBodyId}
      aria-label={subagentToggleLabel}
      title={subagentToggleLabel}
      onClick={(event) => {
        event.stopPropagation();
        toggleSubagentCollapsed(session.id);
      }}
      style={{
        width: SUBAGENT_TOGGLE_SIZE,
        height: SUBAGENT_TOGGLE_SIZE,
        borderRadius: 4,
        border: 'none',
        background: 'transparent',
        color: 'var(--fg-muted)',
        cursor: 'pointer',
        padding: 0,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
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
          transform: subagentsExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
          transition: 'transform 150ms ease',
        }}
      >
        <polyline points="9 18 15 12 9 6" />
      </svg>
    </button>
  ) : (
    <span
      aria-hidden="true"
      style={{ width: SUBAGENT_TOGGLE_SIZE, height: SUBAGENT_TOGGLE_SIZE, flexShrink: 0 }}
    />
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      <BaseSessionRow
        sessionId={session.id}
        title={session.title ?? '未命名'}
        density="compact"
        timeLabel={formatSessionTime(session.updated_at)}
        timeTitle={formatSessionTimeTitle(session.updated_at)}
        active={isActive}
        hovered={isHovered}
        icon={iconNode}
        leadingSlot={leadingSlot}
        meta={metaNode}
        actions={actions}
        hideMetaOnHover={true}
        onSelect={openChatSession}
        onContextMenu={(event, id) => {
          onOpenContextMenu(id, event.clientX, event.clientY);
        }}
        onLongPress={(position) => {
          onOpenContextMenu(session.id, position.x, position.y);
        }}
        onHoverChange={onHoveredSessionChange}
        onPreload={preloadChatRoute}
        onPointerPositionChange={onPointerPositionChange}
        dataState={session.state_status ?? 'idle'}
        renaming={isRenaming}
        renameValue={renameValue}
        onRenameChange={setRenameValue}
        onRenameCommit={(id) => void commitRename(id)}
        titleSlot={
          !isRenaming ? (
            searchQuery ? (
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontSize: 12,
                  lineHeight: '1.25',
                  fontWeight: isActive ? 600 : 400,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  color: isActive ? 'var(--fg-strong)' : 'var(--fg-default)',
                }}
              >
                {highlightMatch(session.title ?? '未命名', searchQuery)}
              </span>
            ) : (
              <InlineEditor
                value={session.title ?? '未命名'}
                label="会话标题"
                onSave={async (newTitle) => {
                  setRenameValue(newTitle);
                  await commitRename(session.id);
                }}
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontSize: 12,
                  lineHeight: '1.25',
                  fontWeight: isActive ? 600 : 400,
                }}
                buttonStyle={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  color: isActive ? 'var(--fg-strong)' : 'var(--fg-default)',
                }}
              />
            )
          ) : undefined
        }
      />
      {hasSubagents && (
        <div
          id={subagentsBodyId}
          style={{
            marginLeft: `${10 + depth * 8}px`,
            // 与父行 / 相邻子行之间留出空隙，让树形层级更清晰
            marginTop: 3,
            paddingLeft: 6,
            paddingTop: 2,
            paddingBottom: 2,
            borderLeft: '1px solid var(--border-subtle)',
            display: subagentsExpanded ? 'flex' : 'none',
            flexDirection: 'column',
            gap: 2,
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
