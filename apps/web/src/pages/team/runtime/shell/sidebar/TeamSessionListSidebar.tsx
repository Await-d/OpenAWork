/**
 * 260516-team-page-v2 · 左侧会话列表
 *
 * V2 专用紧凑会话栏（与旧 `TeamSessionSidebar` 解耦，避免引入大量旧依赖）。
 *
 * 功能：
 *   - 按 workspaceGroups 分组渲染团队会话（运行中 / 历史归档）
 *   - 当前选中态高亮
 *   - 状态点 + 标题 + 副标题
 *   - 折叠态：仅显示状态点小列（columnar）
 *   - 折叠按钮在右上角
 *   - 新建会话按钮 + NewTeamSessionModal
 *   - 搜索框实时过滤会话
 *   - 右键菜单（重命名 / 删除）+ 删除确认对话框
 *
 * 与旧 `SessionSidebar` 不同点：
 *   - 不依赖 `team-runtime-reference-data` 的 Provider（直接接受 props）
 *   - 不渲染整段头部、说明文字等大块内容
 *   - 更紧凑（200~240px），收起后仅 52px
 */

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { createPortal } from 'react-dom';
import { toast } from '../../../../../components/common/feedback/ToastNotification.js';
import { copyTextToClipboard } from '../../../../../components/layout/file-tree/file-tree-actions.js';
import type {
  AgentTeamsSidebarTeam,
  AgentTeamsWorkspaceGroup,
} from '../../data/team-runtime-types.js';
import type { TeamSessionCreationDraft } from '../../data/team-session-creation.types.js';
import { NewTeamSessionModal } from '../modals/NewTeamSessionModal.js';
import {
  buildDeleteSessionImpactTree,
  DeleteSessionImpactDialog,
  type DeleteSessionConfirmTarget,
} from './DeleteSessionImpactDialog.js';
import { SessionCard } from './SessionCard.js';
import { TeamRunStatePill } from '../../shared/TeamRunStatePill.js';
import { useTeamSessionListRuntimeState } from './use-team-session-list-runtime-state.js';

type TimeBucket = '今天' | '昨天' | '更早';
function getTimeGroup(timestamp: string | undefined): TimeBucket {
  if (!timestamp) return '更早';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '更早';
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterday = today - 86400000;
  const t = date.getTime();
  if (t >= today) return '今天';
  if (t >= yesterday) return '昨天';
  return '更早';
}

function compareByUpdatedAtDesc(a: { updatedAt?: string }, b: { updatedAt?: string }): number {
  const at = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
  const bt = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
  return bt - at;
}

function ignoreSearchQueryUpdate(): void {
  return undefined;
}

const CONTAINER_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minHeight: 0,
  background: 'color-mix(in srgb, var(--bg-overlay) 88%, var(--bg-base))',
  overflow: 'hidden',
};

const HEADER_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 6,
  padding: '8px 10px 8px 14px',
  borderBottom: '1px solid color-mix(in srgb, var(--border-default) 50%, transparent)',
};

const SCROLL_STYLE: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  overflowX: 'hidden',
  padding: '8px 0',
};

const GROUP_HEADER_BTN_STYLE: CSSProperties = {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  minWidth: 0,
  padding: '5px 4px 4px 8px',
  borderRadius: 6,
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  color: 'var(--fg-default)',
  textAlign: 'left',
};

const GROUP_ADD_BTN_STYLE: CSSProperties = {
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 20,
  height: 20,
  borderRadius: 5,
  background: 'transparent',
  border: 'none',
  color: 'var(--fg-muted)',
  cursor: 'pointer',
  padding: 0,
  marginRight: 4,
};

const GROUP_CHILDREN_STYLE: CSSProperties = {
  marginLeft: 16,
  borderLeft: '1px solid var(--border-subtle)',
  paddingLeft: 4,
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
};

const TIME_BUCKET_LABEL_STYLE: CSSProperties = {
  display: 'block',
  padding: '8px 14px 4px',
  fontSize: 10,
  fontWeight: 600,
  color: 'var(--fg-muted)',
  letterSpacing: '0.06em',
  opacity: 0.75,
};

const TIME_BUCKET_ORDER: TimeBucket[] = ['今天', '昨天', '更早'];

const ITEM_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 10,
  padding: '10px 12px',
  margin: '0 6px 4px',
  border: '1px solid transparent',
  background: 'transparent',
  width: 'auto',
  textAlign: 'left' as const,
  fontSize: 12,
  color: 'var(--fg-strong)',
  cursor: 'pointer',
  borderRadius: 10,
  transition: 'all 120ms ease',
  position: 'relative',
  outline: 'none',
};

const ITEM_ACTIVE_STYLE: CSSProperties = {
  ...ITEM_STYLE,
  background: 'color-mix(in srgb, var(--accent) 10%, var(--bg-overlay))',
  borderColor: 'color-mix(in srgb, var(--accent) 40%, transparent)',
  boxShadow: '0 1px 3px color-mix(in srgb, var(--accent) 20%, transparent)',
  color: 'var(--fg-strong)',
};

const STATUS_DOT_BASE: CSSProperties = {
  flexShrink: 0,
  width: 10,
  height: 10,
  borderRadius: 999,
  marginTop: 4,
  position: 'relative',
};

const META_BADGE_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 3,
  padding: '0 6px',
  minHeight: 16,
  borderRadius: 999,
  background: 'color-mix(in srgb, var(--fg-muted) 14%, transparent)',
  color: 'var(--fg-default)',
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '0.02em',
  flexShrink: 0,
};

const COLLAPSE_BTN_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 24,
  height: 24,
  borderRadius: 6,
  border: '1px solid color-mix(in srgb, var(--border-default) 50%, transparent)',
  background: 'transparent',
  color: 'var(--fg-default)',
  fontSize: 12,
  cursor: 'pointer',
};

const QUICK_BTN_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 22,
  height: 22,
  borderRadius: 4,
  border: 'none',
  background: 'transparent',
  color: 'var(--fg-muted)',
  cursor: 'pointer',
  flexShrink: 0,
  transition: 'background 120ms ease, color 120ms ease',
};

function dotColor(status: AgentTeamsSidebarTeam['status']): string {
  switch (status) {
    case 'idle':
      return 'var(--fg-subtle)';
    case 'running':
      return 'var(--success)';
    case 'paused':
      return 'var(--warning)';
    case 'completed':
      return 'var(--fg-muted)';
    case 'failed':
      return 'var(--danger)';
    default:
      return 'color-mix(in srgb, var(--border-default) 80%, transparent)';
  }
}

const SEARCH_INPUT_STYLE: CSSProperties = {
  width: '100%',
  padding: '7px 10px',
  borderRadius: 8,
  border: '1px solid color-mix(in srgb, var(--border-subtle) 50%, transparent)',
  background: 'color-mix(in srgb, var(--bg-base) 55%, var(--bg-overlay))',
  color: 'var(--fg-strong)',
  fontSize: 12,
  outline: 'none',
  transition: 'border-color 150ms ease, box-shadow 150ms ease',
};

const CREATE_BTN_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 5,
  padding: '6px 12px',
  borderRadius: 8,
  border: '1px solid color-mix(in srgb, var(--accent) 40%, transparent)',
  background: 'color-mix(in srgb, var(--accent) 14%, var(--bg-overlay))',
  color: 'var(--accent)',
  fontSize: 11,
  fontWeight: 700,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  letterSpacing: '0.02em',
};

const CONTEXT_MENU_STYLE: CSSProperties = {
  position: 'fixed',
  zIndex: 9990,
  minWidth: 140,
  padding: '4px 0',
  borderRadius: 10,
  border: '1px solid color-mix(in srgb, var(--border-default) 60%, transparent)',
  background: 'var(--bg-overlay)',
  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.3)',
};

const CONTEXT_MENU_ITEM_STYLE: CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '7px 12px',
  border: 'none',
  background: 'transparent',
  textAlign: 'left',
  fontSize: 12,
  color: 'var(--fg-strong)',
  cursor: 'pointer',
};

const CONTEXT_MENU_SEPARATOR_STYLE: CSSProperties = {
  height: 1,
  margin: '4px 8px',
  background: 'color-mix(in srgb, var(--border-default) 50%, transparent)',
};

interface ContextMenuState {
  sessionId: string;
  sessionIsShared: boolean;
  sessionStatus: AgentTeamsSidebarTeam['status'];
  sessionTitle: string;
  x: number;
  y: number;
}

const WORKSPACE_SELECT_STYLE: CSSProperties = {
  width: '100%',
  padding: '7px 10px',
  borderRadius: 8,
  border: '1px solid color-mix(in srgb, var(--border-default) 60%, transparent)',
  background: 'color-mix(in srgb, var(--bg-base) 60%, var(--bg-overlay))',
  color: 'var(--fg-strong)',
  fontSize: 12,
  outline: 'none',
  cursor: 'pointer',
  appearance: 'none' as const,
  backgroundImage:
    'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2712%27 height=%2712%27 viewBox=%270 0 12 12%27%3E%3Cpath d=%27M3 5l3 3 3-3%27 fill=%27none%27 stroke=%27%23888%27 stroke-width=%271.5%27/%3E%3C/svg%3E")',
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 10px center',
  paddingRight: 28,
};

export interface TeamSessionListSidebarProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  workspaceGroups: AgentTeamsWorkspaceGroup[];
  selectedTeamId: string;
  onSelectTeam: (teamId: string) => void;
  canManageSessionEntries?: boolean;
  workspaceLabel?: string;
  teamWorkspaceId?: string;
  defaultMemberSlots?: TeamSessionCreationDraft['memberSlots'];
  onSubmitDraft?: (draft: TeamSessionCreationDraft) => boolean | void | Promise<boolean | void>;
  onDeleteSession?: (sessionId: string) => void;
  onRenameSession?: (sessionId: string, title: string) => Promise<boolean> | boolean;
  onToggleSessionState?: (
    sessionId: string,
    currentStatus: AgentTeamsSidebarTeam['status'],
  ) => Promise<boolean> | boolean;
  selectedWorkspacePath?: string | null;
  onWorkspaceChange?: (workspacePath: string | null) => void;
  loading?: boolean;
  /**
   * 当 chromeless=true 时，组件只渲染会话列表本体，不再渲染顶部 header
   * （标题/新建/折叠）、workspace 切换器、搜索输入框。父组件需要自己渲染
   * 这些「外壳」并通过 controlledSearchQuery 传入搜索关键词。
   *
   * 用于 TeamSidebarWithFileTree 与 chat 端 SessionSidebar 视觉对齐。
   */
  chromeless?: boolean;
  /** 受控搜索关键词（仅在 chromeless=true 时生效） */
  controlledSearchQuery?: string;
  /** 受控 NewTeamSessionModal 显示状态（仅在 chromeless=true 时生效） */
  showNewSessionModal?: boolean;
  /** 关闭 NewTeamSessionModal 的回调（仅在 chromeless=true 时生效） */
  onCloseNewSessionModal?: () => void;
  /** 预选模板 id（仅在受控弹窗显示时生效） */
  initialTemplateId?: string | null;
  /** 新会话初始工作目录（review / 创建时透传到 metadata.workingDirectory） */
  initialWorkingDirectory?: string | null;
  /** 顶层受控打开新会话弹窗（可附带模板预选）。用于工作区分组头「+」按钮。 */
  onOpenNewSessionModal?: (templateId?: string | null, workingDirectory?: string | null) => void;
}

const SKELETON_ITEM_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '10px 14px',
  borderLeft: '3px solid transparent',
};

const SKELETON_BAR_STYLE: CSSProperties = {
  borderRadius: 4,
  background:
    'linear-gradient(90deg, color-mix(in srgb, var(--border-default) 30%, transparent) 0%, color-mix(in srgb, var(--border-default) 60%, transparent) 50%, color-mix(in srgb, var(--border-default) 30%, transparent) 100%)',
  backgroundSize: '200% 100%',
  animation: 'team-v2-shimmer 1.4s ease-in-out infinite',
};

export function TeamSessionListSidebar({
  collapsed,
  onToggleCollapsed,
  workspaceGroups,
  selectedTeamId,
  onSelectTeam,
  canManageSessionEntries = true,
  workspaceLabel,
  teamWorkspaceId,
  defaultMemberSlots,
  onSubmitDraft,
  onDeleteSession,
  onRenameSession,
  onToggleSessionState,
  selectedWorkspacePath,
  onWorkspaceChange,
  loading = false,
  chromeless = false,
  controlledSearchQuery,
  showNewSessionModal: controlledShowModal,
  onCloseNewSessionModal,
  initialTemplateId,
  initialWorkingDirectory,
  onOpenNewSessionModal,
}: TeamSessionListSidebarProps) {
  const [internalShowModal, setInternalShowModal] = useState(false);
  const showNewSessionModal = controlledShowModal ?? internalShowModal;
  const setShowNewSessionModal = (value: boolean) => {
    if (controlledShowModal !== undefined) {
      if (!value) {
        onCloseNewSessionModal?.();
      }
      return;
    }
    setInternalShowModal(value);
  };
  const canOpenNewSessionModal = Boolean(canManageSessionEntries && teamWorkspaceId);
  const [internalSearchQuery, setInternalSearchQuery] = useState('');
  const searchQuery = chromeless ? (controlledSearchQuery ?? '') : internalSearchQuery;
  const setSearchQuery = chromeless ? ignoreSearchQueryUpdate : setInternalSearchQuery;
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteSessionConfirmTarget | null>(null);
  const [hoveredSessionId, setHoveredSessionId] = useState<string | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const { effectiveWorkspaceGroups } = useTeamSessionListRuntimeState(workspaceGroups);
  const allSessions = useMemo(
    () => effectiveWorkspaceGroups.flatMap((group) => group.sessions),
    [effectiveWorkspaceGroups],
  );
  const deleteImpact = useMemo(
    () => (deleteConfirm ? buildDeleteSessionImpactTree(deleteConfirm, allSessions) : null),
    [allSessions, deleteConfirm],
  );
  const contextMenuSession = useMemo(
    () =>
      contextMenu ? allSessions.find((session) => session.id === contextMenu.sessionId) ?? null : null,
    [allSessions, contextMenu],
  );

  const toggleGroupCollapsed = useCallback((groupKey: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) {
        next.delete(groupKey);
      } else {
        next.add(groupKey);
      }
      return next;
    });
  }, []);

  const getGroupKey = useCallback(
    (group: { workspacePath: string | null; workspaceLabel: string }) =>
      group.workspacePath ?? group.workspaceLabel,
    [],
  );

  const handleContextMenu = useCallback(
    (event: React.MouseEvent, session: AgentTeamsSidebarTeam) => {
      event.preventDefault();
      setContextMenu({
        sessionId: session.id,
        sessionIsShared: session.isSharedSession === true,
        sessionStatus: session.status,
        sessionTitle: session.title,
        x: event.clientX,
        y: event.clientY,
      });
    },
    [],
  );

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = (event: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(event.target as Node)) {
        closeContextMenu();
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeContextMenu();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [contextMenu, closeContextMenu]);

  const handleDeleteClick = useCallback(() => {
    if (!contextMenu || !canManageSessionEntries) return;
    setDeleteConfirm({ id: contextMenu.sessionId, title: contextMenu.sessionTitle });
    closeContextMenu();
  }, [canManageSessionEntries, contextMenu, closeContextMenu]);

  const handleRenameClick = useCallback(async () => {
    if (!contextMenu || !onRenameSession || !canManageSessionEntries) {
      closeContextMenu();
      return;
    }
    const nextTitle = window.prompt(
      `重命名「${contextMenu.sessionTitle}」为：`,
      contextMenu.sessionTitle,
    );
    if (nextTitle == null) {
      closeContextMenu();
      return;
    }
    const trimmed = nextTitle.trim();
    closeContextMenu();
    if (!trimmed || trimmed === contextMenu.sessionTitle) {
      return;
    }
    await onRenameSession(contextMenu.sessionId, trimmed);
  }, [canManageSessionEntries, closeContextMenu, contextMenu, onRenameSession]);

  const handleToggleSessionStateClick = useCallback(async () => {
    const liveSessionStatus = contextMenuSession?.status;
    if (
      !contextMenu ||
      !onToggleSessionState ||
      !canManageSessionEntries ||
      (liveSessionStatus !== 'running' && liveSessionStatus !== 'paused')
    ) {
      closeContextMenu();
      return;
    }
    closeContextMenu();
    await onToggleSessionState(contextMenu.sessionId, liveSessionStatus);
  }, [
    canManageSessionEntries,
    closeContextMenu,
    contextMenu,
    contextMenuSession?.status,
    onToggleSessionState,
  ]);

  const menuActions = useMemo(() => {
    if (!contextMenu) {
      return [];
    }

    const actions: Array<{
      key: string;
      label: string;
      onClick: () => void | Promise<void>;
      tone?: 'danger';
    }> = [];

    if (canManageSessionEntries && onRenameSession && !contextMenu.sessionIsShared) {
      actions.push({
        key: 'rename',
        label: '重命名',
        onClick: handleRenameClick,
      });
    }

    actions.push({
      key: 'copy-id',
      label: '📋 复制 ID',
      onClick: () => {
        void copyTextToClipboard(contextMenu.sessionId)
          .then(() => {
            toast('已复制会话 ID', 'success');
          })
          .catch((err: unknown) => {
            toast(err instanceof Error ? err.message : '复制失败', 'error');
          });
        closeContextMenu();
      },
    });

    if (
      canManageSessionEntries &&
      onToggleSessionState &&
      !contextMenu.sessionIsShared &&
      (contextMenuSession?.status === 'running' || contextMenuSession?.status === 'paused')
    ) {
      actions.push({
        key: 'toggle-state',
        label: contextMenuSession.status === 'running' ? '⏸ 暂停会话' : '▶ 恢复会话',
        onClick: handleToggleSessionStateClick,
      });
    }

    if (canManageSessionEntries && !contextMenu.sessionIsShared) {
      actions.push({
        key: 'delete',
        label: '🔴 删除会话',
        onClick: handleDeleteClick,
        tone: 'danger',
      });
    }

    return actions;
  }, [
    closeContextMenu,
    contextMenu,
    handleDeleteClick,
    handleRenameClick,
    handleToggleSessionStateClick,
    canManageSessionEntries,
    contextMenuSession,
    onRenameSession,
    onToggleSessionState,
  ]);

  const menuItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [focusedMenuIndex, setFocusedMenuIndex] = useState(0);

  useEffect(() => {
    if (!contextMenu) {
      setFocusedMenuIndex(0);
      return;
    }
    const first = menuItemRefs.current[0];
    if (first) {
      first.focus();
      setFocusedMenuIndex(0);
    }
  }, [contextMenu]);

  const handleMenuKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>, itemCount: number) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        const next = (focusedMenuIndex + 1) % itemCount;
        menuItemRefs.current[next]?.focus();
        setFocusedMenuIndex(next);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        const prev = (focusedMenuIndex - 1 + itemCount) % itemCount;
        menuItemRefs.current[prev]?.focus();
        setFocusedMenuIndex(prev);
      } else if (event.key === 'Home') {
        event.preventDefault();
        menuItemRefs.current[0]?.focus();
        setFocusedMenuIndex(0);
      } else if (event.key === 'End') {
        event.preventDefault();
        const last = itemCount - 1;
        menuItemRefs.current[last]?.focus();
        setFocusedMenuIndex(last);
      }
    },
    [focusedMenuIndex],
  );

  const handleDeleteConfirm = useCallback(() => {
    if (!deleteConfirm) return;
    if (onDeleteSession) {
      onDeleteSession(deleteConfirm.id);
    } else {
      console.warn(
        '[TeamSessionListSidebar] onDeleteSession not provided, session:',
        deleteConfirm.id,
      );
    }
    setDeleteConfirm(null);
  }, [deleteConfirm, onDeleteSession]);

  const filteredGroups = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return effectiveWorkspaceGroups
      .map((group) => {
        const sessions = query
          ? group.sessions.filter(
              (session) =>
                session.title.toLowerCase().includes(query) ||
                session.subtitle.toLowerCase().includes(query),
            )
          : group.sessions;
        const sorted = [...sessions].sort(compareByUpdatedAtDesc);
        const buckets = new Map<TimeBucket, AgentTeamsSidebarTeam[]>();
        for (const bucket of TIME_BUCKET_ORDER) buckets.set(bucket, []);
        for (const session of sorted) {
          const bucket = getTimeGroup(session.updatedAt);
          buckets.get(bucket)?.push(session);
        }
        return { ...group, sessions: sorted, buckets };
      })
      .filter((group) => group.sessions.length > 0);
  }, [effectiveWorkspaceGroups, searchQuery]);

  if (collapsed) {
    return (
      <aside
        aria-label="会话列表（已折叠）"
        style={{
          ...CONTAINER_STYLE,
          width: '100%',
          alignItems: 'center',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            paddingTop: 8,
            paddingBottom: 4,
            width: '100%',
          }}
        >
          <button
            type="button"
            onClick={onToggleCollapsed}
            style={COLLAPSE_BTN_STYLE}
            aria-label="展开会话列表"
            title="展开会话列表"
          >
            ▶
          </button>
        </div>
        <div
          style={{
            ...SCROLL_STYLE,
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 6,
          }}
        >
          {effectiveWorkspaceGroups.flatMap((group) =>
            group.sessions.map((session) => {
              const active = session.id === selectedTeamId;
              return (
                <button
                  key={session.id}
                  type="button"
                  onClick={() => onSelectTeam(session.id)}
                  title={session.title}
                  aria-label={session.title}
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 999,
                    border: active
                      ? '2px solid color-mix(in srgb, var(--accent) 60%, transparent)'
                      : '1px solid color-mix(in srgb, var(--border-default) 50%, transparent)',
                    background: active
                      ? 'color-mix(in srgb, var(--accent) 14%, var(--bg-overlay))'
                      : 'transparent',
                    cursor: 'pointer',
                    display: 'grid',
                    placeItems: 'center',
                  }}
                >
                  <span
                    style={{
                      ...STATUS_DOT_BASE,
                      width: 10,
                      height: 10,
                      background: dotColor(session.status),
                    }}
                  />
                </button>
              );
            }),
          )}
        </div>
      </aside>
    );
  }

  return (
    <aside
      aria-label="会话列表"
      style={{
        ...CONTAINER_STYLE,
        width: '100%',
      }}
    >
      {/* 仅本组件使用的 keyframes（team-v2-status-spin / team-v2-status-pulse /
          team-v2-status-pulse-fade）已统一迁移至 `styles/team-runtime.css`，
          通过 `TeamPageV2.tsx` 的全局 import 加载，避免与其他全局 keyframe 同名冲突。 */}
      {!chromeless && (
        <header style={HEADER_STYLE}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1 }}>
            <strong
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: 'var(--fg-strong)',
                whiteSpace: 'nowrap',
              }}
            >
              会话
            </strong>
            <TeamRunStatePill compact />
            {(() => {
              const total = effectiveWorkspaceGroups.reduce((acc, g) => acc + g.sessions.length, 0);
              const running = effectiveWorkspaceGroups.reduce(
                (acc, g) => acc + g.sessions.filter((s) => s.status === 'running').length,
                0,
              );
              if (total === 0) return null;
              return (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '1px 7px',
                    borderRadius: 999,
                    background: 'color-mix(in srgb, var(--fg-muted) 14%, transparent)',
                    fontSize: 10,
                    fontWeight: 700,
                    color: 'var(--fg-default)',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                  title={`共 ${total} 个会话，${running} 个运行中`}
                >
                  {running > 0 ? (
                    <span
                      aria-hidden="true"
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        background: 'var(--success)',
                        boxShadow: '0 0 0 2px color-mix(in srgb, var(--success) 30%, transparent)',
                      }}
                    />
                  ) : null}
                  {running > 0 ? `${running}/${total}` : total}
                </span>
              );
            })()}
          </div>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
            {onSubmitDraft ? (
              <button
                type="button"
                onClick={() => {
                  if (!canOpenNewSessionModal) {
                    return;
                  }
                  setShowNewSessionModal(true);
                }}
                className="team-cta-accent"
                style={CREATE_BTN_STYLE}
                aria-label="新建会话"
                title={
                  !canManageSessionEntries
                    ? '当前工作区不可写'
                    : teamWorkspaceId
                      ? '新建会话'
                      : '请先选择工作空间'
                }
                disabled={!canOpenNewSessionModal}
              >
                <svg
                  aria-hidden="true"
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                新建
              </button>
            ) : null}
            <button
              type="button"
              onClick={onToggleCollapsed}
              style={COLLAPSE_BTN_STYLE}
              aria-label="折叠会话列表"
              title="折叠"
            >
              ◀
            </button>
          </div>
        </header>
      )}

      {/* 多 workspace 切换器（仅在 workspaceGroups > 1 时出现）；
          单 workspace 时不再显示 workspaceLabel 静态框，避免与顶部 page-header 重复 */}
      {!chromeless && effectiveWorkspaceGroups.length > 1 && onWorkspaceChange ? (
        <div style={{ padding: '8px 10px 0' }}>
          <select
            value={selectedWorkspacePath ?? '__all__'}
            onChange={(event) => {
              const val = event.target.value;
              onWorkspaceChange(val === '__all__' ? null : val);
            }}
            style={WORKSPACE_SELECT_STYLE}
            aria-label="切换工作空间"
          >
            <option value="__all__">全部工作空间</option>
            {effectiveWorkspaceGroups.map((group) => (
              <option
                key={group.workspacePath ?? group.workspaceLabel}
                value={group.workspacePath ?? group.workspaceLabel}
              >
                {group.workspaceLabel}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {!chromeless && (
        <div style={{ padding: '8px 10px 0' }}>
          <div style={{ position: 'relative' }}>
            <svg
              aria-hidden="true"
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{
                position: 'absolute',
                left: 10,
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--fg-muted)',
                pointerEvents: 'none',
              }}
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="搜索会话..."
              style={{
                ...SEARCH_INPUT_STYLE,
                paddingLeft: 30,
                paddingRight: searchQuery ? 28 : 10,
              }}
              aria-label="搜索会话"
            />
            {searchQuery ? (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="清除搜索"
                title="清除"
                className="team-icon-ghost"
                style={{
                  position: 'absolute',
                  right: 6,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  width: 20,
                  height: 20,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--fg-muted)',
                  cursor: 'pointer',
                  borderRadius: 4,
                }}
              >
                <svg
                  aria-hidden="true"
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            ) : null}
          </div>
        </div>
      )}

      <div style={SCROLL_STYLE}>
        {loading && filteredGroups.length === 0 ? (
          <div aria-label="加载会话列表" aria-busy="true" style={{ display: 'grid', gap: 4 }}>
            {Array.from({ length: 5 }).map((_, idx) => (
              <div key={idx} style={SKELETON_ITEM_STYLE}>
                <span style={{ ...SKELETON_BAR_STYLE, width: 8, height: 8, borderRadius: 999 }} />
                <span style={{ flex: 1, display: 'grid', gap: 6 }}>
                  <span
                    style={{
                      ...SKELETON_BAR_STYLE,
                      height: 10,
                      width: `${60 + ((idx * 13) % 30)}%`,
                    }}
                  />
                  <span
                    style={{ ...SKELETON_BAR_STYLE, height: 8, width: `${40 + ((idx * 7) % 25)}%` }}
                  />
                </span>
              </div>
            ))}
          </div>
        ) : null}
        {!loading && filteredGroups.length === 0 ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '44px 24px',
              gap: 14,
              color: 'var(--fg-muted)',
              textAlign: 'center',
            }}
          >
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: 14,
                display: 'grid',
                placeItems: 'center',
                background: searchQuery.trim()
                  ? 'color-mix(in srgb, var(--aux) 10%, transparent)'
                  : 'color-mix(in srgb, var(--accent) 8%, var(--bg-overlay))',
                boxShadow:
                  'inset 0 0 0 1px color-mix(in srgb, var(--border-subtle) 40%, transparent)',
                fontSize: 22,
              }}
            >
              {searchQuery.trim() ? (
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ opacity: 0.6 }}
                >
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              ) : (
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ opacity: 0.45 }}
                >
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              )}
            </div>
            <div style={{ display: 'grid', gap: 5 }}>
              <span
                style={{
                  fontSize: 13,
                  color: 'var(--fg-default)',
                  fontWeight: 600,
                  letterSpacing: '-0.01em',
                }}
              >
                {searchQuery.trim() ? '没有匹配的会话' : '还没有会话'}
              </span>
              <span
                style={{
                  fontSize: 11.5,
                  color: 'var(--fg-muted)',
                  lineHeight: 1.6,
                  maxWidth: 200,
                }}
              >
                {searchQuery.trim()
                  ? '试试其他关键词或清空搜索条件'
                  : onSubmitDraft
                    ? '点击上方「+ 新建」按钮开始第一个团队任务'
                    : '在右侧区域输入需求即可自动创建会话'}
              </span>
            </div>
          </div>
        ) : null}
        {filteredGroups.map((group) => {
          const groupKey = getGroupKey(group);
          const isCollapsed = collapsedGroups.has(groupKey);
          // 始终显示工作区分组头（与 chat 端 SessionSidebar 对齐，方便快速折叠不同工作区的会话）
          const showWorkspaceLabel = true;
          // 仅当存在多个时间桶有内容时才显示「今天 / 昨天 / 更早」分隔标签
          const nonEmptyBuckets = TIME_BUCKET_ORDER.filter(
            (b) => (group.buckets.get(b) ?? []).length > 0,
          );
          const showBucketLabels = nonEmptyBuckets.length > 1;
          return (
            <div key={groupKey} style={{ marginBottom: 6 }}>
              {showWorkspaceLabel ? (
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <button
                    type="button"
                    onClick={() => toggleGroupCollapsed(groupKey)}
                    style={GROUP_HEADER_BTN_STYLE}
                    aria-label={
                      isCollapsed ? `展开 ${group.workspaceLabel}` : `折叠 ${group.workspaceLabel}`
                    }
                    aria-expanded={!isCollapsed}
                  >
                    <svg
                      width="9"
                      height="9"
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
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                      style={{ flexShrink: 0 }}
                    >
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                    </svg>
                    <span
                      style={{
                        flex: 1,
                        minWidth: 0,
                        fontSize: 11,
                        fontWeight: 700,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {group.workspaceLabel}
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
                  {group.workspacePath && canManageSessionEntries
                    ? (() => {
                        const handleNewSession = onOpenNewSessionModal
                          ? () => onOpenNewSessionModal(null, group.workspacePath)
                          : () => {
                              if (teamWorkspaceId) {
                                setShowNewSessionModal(true);
                              }
                            };
                        return (
                          <button
                            type="button"
                            onClick={handleNewSession}
                            title={`在 ${group.workspaceLabel} 中新建会话`}
                            style={GROUP_ADD_BTN_STYLE}
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
                        );
                      })()
                    : null}
                </div>
              ) : null}
              {!isCollapsed && (
                <div style={showWorkspaceLabel ? GROUP_CHILDREN_STYLE : undefined}>
                  {TIME_BUCKET_ORDER.map((bucket) => {
                    const sessions = group.buckets.get(bucket) ?? [];
                    if (sessions.length === 0) return null;
                    return (
                      <Fragment key={`${groupKey}-${bucket}`}>
                        {showBucketLabels ? (
                          <span style={TIME_BUCKET_LABEL_STYLE}>{bucket}</span>
                        ) : null}
                        {sessions.map((session) => (
                          <SessionCard
                            key={session.id}
                            session={session}
                            active={session.id === selectedTeamId}
                            hovered={hoveredSessionId === session.id}
                            onSelect={onSelectTeam}
                            onContextMenu={handleContextMenu}
                            onHoverChange={setHoveredSessionId}
                            onDelete={
                              onDeleteSession
                                ? (id, title) => setDeleteConfirm({ id, title })
                                : undefined
                            }
                          />
                        ))}
                      </Fragment>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {contextMenu
        ? createPortal(
            <div
              ref={contextMenuRef}
              role="menu"
              aria-label="会话操作菜单"
              tabIndex={-1}
              onKeyDown={(event) => handleMenuKeyDown(event, menuActions.length)}
              style={{ ...CONTEXT_MENU_STYLE, left: contextMenu.x, top: contextMenu.y }}
            >
              {menuActions.map((action, index) => (
                <Fragment key={action.key}>
                  {action.tone === 'danger' ? <div style={CONTEXT_MENU_SEPARATOR_STYLE} /> : null}
                  <button
                    type="button"
                    role="menuitem"
                    ref={(el) => {
                      menuItemRefs.current[index] = el;
                    }}
                    className="team-menu-item"
                    data-tone={action.tone}
                    style={
                      action.tone === 'danger'
                        ? { ...CONTEXT_MENU_ITEM_STYLE, color: 'var(--danger)' }
                        : CONTEXT_MENU_ITEM_STYLE
                    }
                    onClick={() => {
                      void action.onClick();
                    }}
                    disabled={action.key !== 'copy-id' && !canManageSessionEntries}
                  >
                    {action.label}
                  </button>
                </Fragment>
              ))}
            </div>,
            document.body,
          )
        : null}

      {deleteImpact
        ? createPortal(
            <DeleteSessionImpactDialog
              impact={deleteImpact}
              onCancel={() => setDeleteConfirm(null)}
              onConfirm={handleDeleteConfirm}
            />,
            document.body,
          )
        : null}

      {showNewSessionModal && teamWorkspaceId && onSubmitDraft ? (
        <NewTeamSessionModal
          onClose={() => setShowNewSessionModal(false)}
          onSubmitDraft={onSubmitDraft}
          workspaceLabel={workspaceLabel ?? '默认工作区'}
          teamWorkspaceId={teamWorkspaceId}
          defaultMemberSlots={defaultMemberSlots}
          initialTemplateId={initialTemplateId}
          initialWorkingDirectory={initialWorkingDirectory}
        />
      ) : null}
    </aside>
  );
}
