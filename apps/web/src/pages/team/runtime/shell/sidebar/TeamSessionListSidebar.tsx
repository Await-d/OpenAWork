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
import type {
  AgentTeamsSidebarTeam,
  AgentTeamsWorkspaceGroup,
} from '../../data/team-runtime-types.js';
import type { TeamSessionCreationDraft } from '../../data/team-session-creation.types.js';
import { NewTeamSessionModal } from '../modals/NewTeamSessionModal.js';
import { SessionCard } from './SessionCard.js';

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

const CONTAINER_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  background: 'color-mix(in srgb, var(--surface) 88%, var(--bg))',
  overflow: 'hidden',
};

const HEADER_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 6,
  padding: '8px 10px 8px 14px',
  borderBottom: '1px solid color-mix(in srgb, var(--border) 50%, transparent)',
};

const SCROLL_STYLE: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflow: 'auto',
  padding: '8px 0',
};

const GROUP_LABEL_STYLE: CSSProperties = {
  display: 'block',
  padding: '6px 14px 4px',
  fontSize: 10,
  fontWeight: 700,
  color: 'var(--text-3)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
};

const TIME_BUCKET_LABEL_STYLE: CSSProperties = {
  display: 'block',
  padding: '6px 14px 2px',
  fontSize: 10,
  fontWeight: 600,
  color: 'var(--text-3)',
  letterSpacing: '0.04em',
  opacity: 0.85,
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
  color: 'var(--text)',
  cursor: 'pointer',
  borderRadius: 10,
  transition: 'all 120ms ease',
  position: 'relative',
  outline: 'none',
};

const ITEM_ACTIVE_STYLE: CSSProperties = {
  ...ITEM_STYLE,
  background: 'color-mix(in srgb, var(--accent) 10%, var(--surface))',
  borderColor: 'color-mix(in srgb, var(--accent) 40%, transparent)',
  boxShadow: '0 1px 3px color-mix(in srgb, var(--accent) 20%, transparent)',
  color: 'var(--text)',
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
  background: 'color-mix(in srgb, var(--text-3) 14%, transparent)',
  color: 'var(--text-2)',
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
  border: '1px solid color-mix(in srgb, var(--border) 50%, transparent)',
  background: 'transparent',
  color: 'var(--text-2)',
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
  color: 'var(--text-3)',
  cursor: 'pointer',
  flexShrink: 0,
  transition: 'background 120ms ease, color 120ms ease',
};

function dotColor(status: AgentTeamsSidebarTeam['status']): string {
  switch (status) {
    case 'running':
      return 'var(--success, var(--success, var(--success, #3dd49a)))';
    case 'paused':
      return 'var(--warning, var(--warning, #f0b429))';
    case 'completed':
      return 'var(--text-3)';
    case 'failed':
      return 'var(--danger, #d4574e)';
    default:
      return 'color-mix(in srgb, var(--border) 80%, transparent)';
  }
}

function statusLabel(status: AgentTeamsSidebarTeam['status']): string {
  switch (status) {
    case 'running':
      return '运行中';
    case 'paused':
      return '已暂停';
    case 'completed':
      return '已完成';
    case 'failed':
      return '失败';
    default:
      return '未知状态';
  }
}

const SEARCH_INPUT_STYLE: CSSProperties = {
  width: '100%',
  padding: '6px 10px',
  borderRadius: 8,
  border: '1px solid color-mix(in srgb, var(--border) 60%, transparent)',
  background: 'color-mix(in srgb, var(--bg) 60%, var(--surface))',
  color: 'var(--text)',
  fontSize: 12,
  outline: 'none',
};

const CREATE_BTN_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 5,
  padding: '6px 12px',
  borderRadius: 8,
  border: '1px solid color-mix(in srgb, var(--accent) 40%, transparent)',
  background: 'color-mix(in srgb, var(--accent) 14%, var(--surface))',
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
  border: '1px solid color-mix(in srgb, var(--border) 60%, transparent)',
  background: 'var(--surface)',
  boxShadow: '0 8px 24px oklch(0 0 0 / 0.3)',
};

const CONTEXT_MENU_ITEM_STYLE: CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '7px 12px',
  border: 'none',
  background: 'transparent',
  textAlign: 'left',
  fontSize: 12,
  color: 'var(--text)',
  cursor: 'pointer',
};

const CONTEXT_MENU_SEPARATOR_STYLE: CSSProperties = {
  height: 1,
  margin: '4px 8px',
  background: 'color-mix(in srgb, var(--border) 50%, transparent)',
};

const CONFIRM_OVERLAY_STYLE: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 9995,
  display: 'grid',
  placeItems: 'center',
  background: 'oklch(0 0 0 / 0.5)',
  backdropFilter: 'blur(2px)',
};

const CONFIRM_DIALOG_STYLE: CSSProperties = {
  position: 'relative',
  width: 320,
  padding: 20,
  borderRadius: 14,
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  boxShadow: '0 16px 48px oklch(0 0 0 / 0.35)',
  display: 'grid',
  gap: 14,
};

interface ContextMenuState {
  sessionId: string;
  sessionTitle: string;
  x: number;
  y: number;
}

const WORKSPACE_SELECT_STYLE: CSSProperties = {
  width: '100%',
  padding: '7px 10px',
  borderRadius: 8,
  border: '1px solid color-mix(in srgb, var(--border) 60%, transparent)',
  background: 'color-mix(in srgb, var(--bg) 60%, var(--surface))',
  color: 'var(--text)',
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
  workspaceLabel?: string;
  teamWorkspaceId?: string;
  onSubmitDraft?: (draft: TeamSessionCreationDraft) => void | Promise<void>;
  onDeleteSession?: (sessionId: string) => void;
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
    'linear-gradient(90deg, color-mix(in srgb, var(--border) 30%, transparent) 0%, color-mix(in srgb, var(--border) 60%, transparent) 50%, color-mix(in srgb, var(--border) 30%, transparent) 100%)',
  backgroundSize: '200% 100%',
  animation: 'team-v2-shimmer 1.4s ease-in-out infinite',
};

export function TeamSessionListSidebar({
  collapsed,
  onToggleCollapsed,
  workspaceGroups,
  selectedTeamId,
  onSelectTeam,
  workspaceLabel,
  teamWorkspaceId,
  onSubmitDraft,
  onDeleteSession,
  selectedWorkspacePath,
  onWorkspaceChange,
  loading = false,
  chromeless = false,
  controlledSearchQuery,
  showNewSessionModal: controlledShowModal,
  onCloseNewSessionModal,
}: TeamSessionListSidebarProps) {
  const [internalShowModal, setInternalShowModal] = useState(false);
  const showNewSessionModal = chromeless ? !!controlledShowModal : internalShowModal;
  const setShowNewSessionModal = (value: boolean) => {
    if (chromeless) {
      if (!value) onCloseNewSessionModal?.();
    } else {
      setInternalShowModal(value);
    }
  };
  const [internalSearchQuery, setInternalSearchQuery] = useState('');
  const searchQuery = chromeless ? (controlledSearchQuery ?? '') : internalSearchQuery;
  const setSearchQuery = chromeless ? () => {} : setInternalSearchQuery;
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; title: string } | null>(null);
  const [hoveredSessionId, setHoveredSessionId] = useState<string | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  const handleContextMenu = useCallback(
    (event: React.MouseEvent, session: AgentTeamsSidebarTeam) => {
      event.preventDefault();
      setContextMenu({
        sessionId: session.id,
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
    if (!contextMenu) return;
    setDeleteConfirm({ id: contextMenu.sessionId, title: contextMenu.sessionTitle });
    closeContextMenu();
  }, [contextMenu, closeContextMenu]);

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
    return workspaceGroups
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
  }, [workspaceGroups, searchQuery]);

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
          {workspaceGroups.flatMap((group) =>
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
                      : '1px solid color-mix(in srgb, var(--border) 50%, transparent)',
                    background: active
                      ? 'color-mix(in srgb, var(--accent) 14%, var(--surface))'
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
      {!chromeless && <header style={HEADER_STYLE}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1 }}>
          <strong
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: 'var(--text)',
              whiteSpace: 'nowrap',
            }}
          >
            会话
          </strong>
          {(() => {
            const total = workspaceGroups.reduce((acc, g) => acc + g.sessions.length, 0);
            const running = workspaceGroups.reduce(
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
                  background: 'color-mix(in srgb, var(--text-3) 14%, transparent)',
                  fontSize: 10,
                  fontWeight: 700,
                  color: 'var(--text-2)',
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
                      background: 'var(--success, var(--success, var(--success, #3dd49a)))',
                      boxShadow:
                        '0 0 0 2px color-mix(in srgb, var(--success, var(--success, var(--success, #3dd49a))) 30%, transparent)',
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
                if (!teamWorkspaceId) {
                  console.warn('[TeamSessionListSidebar] 请先选择工作空间');
                  return;
                }
                setShowNewSessionModal(true);
              }}
              className="team-cta-accent"
              style={CREATE_BTN_STYLE}
              aria-label="新建会话"
              title={teamWorkspaceId ? '新建会话' : '请先选择工作空间'}
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
      </header>}

      {/* 多 workspace 切换器（仅在 workspaceGroups > 1 时出现）；
          单 workspace 时不再显示 workspaceLabel 静态框，避免与顶部 page-header 重复 */}
      {!chromeless && workspaceGroups.length > 1 && onWorkspaceChange ? (
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
            {workspaceGroups.map((group) => (
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
                color: 'var(--text-3)',
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
              style={{ ...SEARCH_INPUT_STYLE, paddingLeft: 30, paddingRight: searchQuery ? 28 : 10 }}
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
                  color: 'var(--text-3)',
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
              padding: '40px 20px',
              gap: 12,
              color: 'var(--text-3)',
              textAlign: 'center',
            }}
          >
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 12,
                display: 'grid',
                placeItems: 'center',
                background: 'color-mix(in srgb, var(--accent) 8%, var(--surface))',
                fontSize: 24,
              }}
            >
              {searchQuery.trim() ? '🔍' : '💬'}
            </div>
            <div style={{ display: 'grid', gap: 4 }}>
              <span style={{ fontSize: 13, color: 'var(--text-2)', fontWeight: 600 }}>
                {searchQuery.trim() ? '没有匹配的会话' : '还没有会话'}
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.5 }}>
                {searchQuery.trim()
                  ? '试试其他关键词'
                  : onSubmitDraft
                    ? '点击右上角「+ 新建」开始'
                    : '在中间区域输入需求即可创建'}
              </span>
            </div>
          </div>
        ) : null}
        {filteredGroups.map((group) => {
          const showWorkspaceLabel = filteredGroups.length > 1;
          // 仅当存在多个时间桶有内容时才显示「今天 / 昨天 / 更早」分隔标签
          const nonEmptyBuckets = TIME_BUCKET_ORDER.filter(
            (b) => (group.buckets.get(b) ?? []).length > 0,
          );
          const showBucketLabels = nonEmptyBuckets.length > 1;
          return (
            <div key={group.workspacePath ?? group.workspaceLabel} style={{ marginBottom: 6 }}>
              {showWorkspaceLabel ? (
                <span style={GROUP_LABEL_STYLE}>{group.workspaceLabel}</span>
              ) : null}
              {TIME_BUCKET_ORDER.map((bucket) => {
                const sessions = group.buckets.get(bucket) ?? [];
                if (sessions.length === 0) return null;
                return (
                  <Fragment key={`${group.workspacePath ?? group.workspaceLabel}-${bucket}`}>
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
              onKeyDown={(event) => handleMenuKeyDown(event, 5)}
              style={{ ...CONTEXT_MENU_STYLE, left: contextMenu.x, top: contextMenu.y }}
            >
              <button
                type="button"
                role="menuitem"
                ref={(el) => {
                  menuItemRefs.current[0] = el;
                }}
                className="team-menu-item"
                style={CONTEXT_MENU_ITEM_STYLE}
                onClick={() => {
                  console.log('[TeamSessionListSidebar] rename:', contextMenu.sessionId);
                  closeContextMenu();
                }}
              >
                重命名
              </button>
              <button
                type="button"
                role="menuitem"
                ref={(el) => {
                  menuItemRefs.current[1] = el;
                }}
                className="team-menu-item"
                style={CONTEXT_MENU_ITEM_STYLE}
                onClick={() => {
                  console.log('[TeamSessionListSidebar] pin:', contextMenu.sessionId);
                  closeContextMenu();
                }}
              >
                📌 置顶
              </button>
              <button
                type="button"
                role="menuitem"
                ref={(el) => {
                  menuItemRefs.current[2] = el;
                }}
                className="team-menu-item"
                style={CONTEXT_MENU_ITEM_STYLE}
                onClick={() => {
                  if (typeof navigator !== 'undefined' && navigator.clipboard) {
                    navigator.clipboard.writeText(contextMenu.sessionId).catch((err) => {
                      console.warn('[TeamSessionListSidebar] clipboard failed:', err);
                    });
                  }
                  closeContextMenu();
                }}
              >
                📋 复制 ID
              </button>
              <button
                type="button"
                role="menuitem"
                ref={(el) => {
                  menuItemRefs.current[3] = el;
                }}
                className="team-menu-item"
                style={CONTEXT_MENU_ITEM_STYLE}
                onClick={() => {
                  console.log('[TeamSessionListSidebar] pause:', contextMenu.sessionId);
                  closeContextMenu();
                }}
              >
                ⏸ 暂停任务
              </button>
              <div style={CONTEXT_MENU_SEPARATOR_STYLE} />
              <button
                type="button"
                role="menuitem"
                ref={(el) => {
                  menuItemRefs.current[4] = el;
                }}
                className="team-menu-item"
                data-tone="danger"
                style={{ ...CONTEXT_MENU_ITEM_STYLE, color: 'var(--danger, #d4574e)' }}
                onClick={handleDeleteClick}
              >
                🔴 删除会话
              </button>
            </div>,
            document.body,
          )
        : null}

      {deleteConfirm ? (
        <div style={CONFIRM_OVERLAY_STYLE}>
          <div role="alertdialog" aria-label="确认删除会话" style={CONFIRM_DIALOG_STYLE}>
            <strong style={{ fontSize: 14, color: 'var(--text)' }}>删除会话</strong>
            <span style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.6 }}>
              确定要删除「{deleteConfirm.title}」吗？删除后不可恢复。
            </span>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setDeleteConfirm(null)}
                style={{
                  padding: '6px 14px',
                  borderRadius: 8,
                  border: '1px solid color-mix(in srgb, var(--border) 60%, transparent)',
                  background: 'var(--surface)',
                  color: 'var(--text-2)',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleDeleteConfirm}
                style={{
                  padding: '6px 14px',
                  borderRadius: 8,
                  border: 'none',
                  background: 'var(--danger, #d4574e)',
                  color: 'var(--fg-on-accent, #ffffff)',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showNewSessionModal && teamWorkspaceId && onSubmitDraft ? (
        <NewTeamSessionModal
          onClose={() => setShowNewSessionModal(false)}
          onSubmitDraft={onSubmitDraft}
          workspaceLabel={workspaceLabel ?? '默认工作区'}
          teamWorkspaceId={teamWorkspaceId}
        />
      ) : null}
    </aside>
  );
}
