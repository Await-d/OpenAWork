/**
 * FusionSidebar — 融合布局专用侧边栏。
 *
 * S2 方案：Rail(64px 固定) + Panel(244px 可折叠) 物理分离。
 * 只在 fusion 模式下使用，不影响 classic 模式的 AppSidebar。
 *
 * Rail: 项目头像 + Chat/Team + 功能导航 + 底部图标
 * Panel: 项目名 + 搜索 + 会话列表 + 新建按钮
 */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router';
import { createWorkspaceClient, createTeamClient } from '@openAwork/web-client';
import { InlineEditor } from '@openAwork/shared-ui';
import { useUIStateStore } from '../../../stores/ui/uiState.js';
import { useSessions } from '../../../hooks/workspace/useSessions.js';
import { useTeamSidebarSessions } from '../../../hooks/workspace/useTeamSidebarSessions.js';
import type { TeamWorkspaceGroup } from '../../../hooks/workspace/useTeamSidebarSessions.js';
import { SessionSidebarSessionRow } from '../sidebar/SessionSidebarSessionRow.js';
import { BaseSessionRow } from '../sidebar/BaseSessionRow.js';
import SessionContextMenu from '../sidebar/SessionContextMenu.js';
import TeamSessionContextMenu from '../sidebar/TeamSessionContextMenu.js';
import TeamWorkspaceContextMenu from '../sidebar/TeamWorkspaceContextMenu.js';
import { getWorkspaceGroupKey } from '../../../utils/session/session-grouping.js';
import { requestSessionListRefresh } from '../../../utils/session/session-list-events.js';
import { useAuthStore } from '../../../stores/auth/auth.js';
import { preloadRouteModuleByPath } from '../../../routes/preloadable-route-modules.js';
import { getPathBasename } from '../../../utils/workspace-path.js';
import WorkspacePickerModal from '../../common/modal/WorkspacePickerModal.js';
import { buildWorkspacePickerDataSource } from '../../common/modal/workspace-picker-data-source.js';
import { SidebarRailV2 } from './SidebarRailV2.js';
import { FusionSidebarPeek } from './FusionSidebarPeek.js';

export interface FusionSidebarProps {
  readonly accessToken: string | null;
  readonly gatewayUrl: string;
  readonly theme?: 'dark' | 'light';
  readonly onToggleTheme?: () => void;
  readonly onLogout?: () => void;
  readonly pendingPermissionIndicator?: boolean;
}

const SIDEBAR_WIDTH = 244;
const PEEK_CLOSE_DELAY_MS = 300;

const CONTAINER_STYLE: CSSProperties = {
  display: 'flex',
  height: '100%',
  overflow: 'hidden',
  position: 'relative',
  flexShrink: 0,
  borderRight: '1px solid var(--border-subtle)',
};

const PANEL_STYLE: CSSProperties = {
  width: SIDEBAR_WIDTH,
  flexShrink: 0,
  overflow: 'hidden',
  transition: 'width 240ms cubic-bezier(0.4, 0, 0.2, 1)',
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--bg-surface)',
};

const PANEL_HEADER_STYLE: CSSProperties = {
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  padding: '8px 12px',
  borderBottom: '1px solid var(--border-subtle)',
  minHeight: 44,
};

const PANEL_TITLE_STYLE: CSSProperties = {
  fontSize: 13,
  fontWeight: 800,
  color: 'var(--fg-strong)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const PANEL_SUBTITLE_STYLE: CSSProperties = {
  fontSize: 10,
  color: 'var(--fg-subtle)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const SEARCH_STYLE: CSSProperties = {
  width: '100%',
  background: 'var(--bg-overlay)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 6,
  padding: '5px 8px',
  fontSize: 11,
  color: 'var(--fg-strong)',
  outline: 'none',
  boxSizing: 'border-box',
};

const NEW_SESSION_BTN_STYLE: CSSProperties = {
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  padding: '8px 12px',
  background: 'var(--accent-subtle)',
  color: 'var(--accent)',
  fontSize: 12,
  fontWeight: 700,
  cursor: 'pointer',
  border: 'none',
  borderTop: '1px solid var(--border-subtle)',
};

const MOBILE_TRIGGER_STYLE: CSSProperties = {
  position: 'fixed',
  top: 'calc(var(--spacing-4) + var(--spacing-5) + var(--spacing-2))',
  left: 'var(--spacing-2)',
  width: 38,
  height: 38,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 10,
  border: '1px solid var(--border-default)',
  background: 'color-mix(in srgb, var(--bg-surface) 94%, transparent)',
  color: 'var(--fg-default)',
  boxShadow: 'var(--shadow-md)',
  backdropFilter: 'blur(16px)',
  cursor: 'pointer',
  zIndex: 30,
};

const MOBILE_BACKDROP_STYLE: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'color-mix(in srgb, var(--bg-base) 38%, transparent)',
  backdropFilter: 'blur(4px)',
  zIndex: 40,
};

const MOBILE_DRAWER_STYLE: CSSProperties = {
  position: 'absolute',
  top: 'calc(var(--spacing-4) + var(--spacing-5) + var(--spacing-2))',
  left: 'var(--spacing-2)',
  bottom: 'var(--spacing-2)',
  width: 'min(86vw, 320px)',
  maxWidth: 'calc(100vw - (var(--spacing-2) * 2))',
  display: 'flex',
  flexDirection: 'column',
  borderRadius: 'var(--radius-lg)',
  border: '1px solid var(--border-default)',
  background: 'var(--bg-surface)',
  boxShadow: 'var(--shadow-lg)',
  overflow: 'hidden',
};

const MOBILE_CLOSE_LAYER_STYLE: CSSProperties = {
  position: 'absolute',
  inset: 0,
  border: 'none',
  background: 'transparent',
  cursor: 'default',
};

function basename(path: string | null): string {
  return getPathBasename(path, 'OpenAWork');
}

function isCompactFusionSidebarViewport(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }

  return window.matchMedia('(max-width: 640px)').matches;
}

function TeamWorkspaceGroupItem({
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
}: {
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
}) {
  const [collapsed, setCollapsed] = useState(false);

  const formatRelativeTime = (dateStr: string): string => {
    const now = Date.now();
    const then = new Date(dateStr).getTime();
    if (Number.isNaN(then)) return '';
    const diffMin = Math.floor((now - then) / 60000);
    if (diffMin < 1) return '刚刚';
    if (diffMin < 60) return `${diffMin}分钟前`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour}小时前`;
    return `${Math.floor(diffHour / 24)}天前`;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, marginBottom: 2 }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
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
            border: 'none',
            background: 'color-mix(in srgb, var(--fg-muted) 4%, transparent)',
            cursor: 'pointer',
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
            style={{
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

      {!collapsed && (
        <div
          style={{
            marginLeft: 16,
            borderLeft: '1px solid var(--border-subtle)',
            paddingLeft: 4,
            display: 'flex',
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
                timeLabel={formatRelativeTime(ts.updatedAt)}
                timeTitle={ts.updatedAt}
                active={isActive}
                density="compact"
                onSelect={() => {
                  preloadRoute('/team');
                  if (ts.teamWorkspaceId) {
                    onSelectSession(ts.teamWorkspaceId, ts.id);
                    void navigate(`/team/${ts.teamWorkspaceId}`);
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
      )}
    </div>
  );
}

export function FusionSidebar({
  accessToken,
  gatewayUrl,
  theme = 'dark',
  onToggleTheme,
  onLogout,
  pendingPermissionIndicator = false,
}: FusionSidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();

  const leftSidebarOpen = useUIStateStore((state) => state.leftSidebarOpen);
  const setLeftSidebarOpen = useUIStateStore((state) => state.setLeftSidebarOpen);
  const navigateToHome = useUIStateStore((state) => state.navigateToHome);
  const selectedWorkspacePath = useUIStateStore((s) => s.selectedWorkspacePath);
  const addSavedWorkspacePath = useUIStateStore((s) => s.addSavedWorkspacePath);
  const setSelectedWorkspacePath = useUIStateStore((s) => s.setSelectedWorkspacePath);
  const setFileTreeRootPath = useUIStateStore((s) => s.setFileTreeRootPath);
  const fileTreeRootPath = useUIStateStore((s) => s.fileTreeRootPath);
  const triggerTeamSelectSession = useUIStateStore((s) => s.triggerTeamSelectSession);
  const triggerTeamNewWorkspace = useUIStateStore((s) => s.triggerTeamNewWorkspace);
  const triggerTeamNewSession = useUIStateStore((s) => s.triggerTeamNewSession);
  const togglePinSession = useUIStateStore((s) => s.togglePinSession);
  const isPinned = useUIStateStore((s) => s.isPinned);

  const [showWorkspacePicker, setShowWorkspacePicker] = useState(false);
  const [teamSearch, setTeamSearch] = useState('');
  const [peekWorkspacePath, setPeekWorkspacePath] = useState<string | null>(null);
  const [compactViewport, setCompactViewport] = useState(isCompactFusionSidebarViewport);
  const peekCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panelContainerRef = useRef<HTMLDivElement>(null);

  // 工作区显示别名：localStorage 持久化，key = 'ws-alias:' + path
  const [workspaceAlias, setWorkspaceAlias] = useState<string>(() => {
    if (!selectedWorkspacePath) return '';
    try {
      return localStorage.getItem(`ws-alias:${selectedWorkspacePath}`) ?? '';
    } catch {
      return '';
    }
  });

  // 当 selectedWorkspacePath 变化时，从 localStorage 重新读取别名
  useEffect(() => {
    if (!selectedWorkspacePath) {
      setWorkspaceAlias('');
      return;
    }
    try {
      setWorkspaceAlias(localStorage.getItem(`ws-alias:${selectedWorkspacePath}`) ?? '');
    } catch {
      setWorkspaceAlias('');
    }
  }, [selectedWorkspacePath]);

  const handleWorkspaceAliasChange = useCallback(
    (newAlias: string): void => {
      if (!selectedWorkspacePath) return;
      setWorkspaceAlias(newAlias);
      try {
        if (newAlias) {
          localStorage.setItem(`ws-alias:${selectedWorkspacePath}`, newAlias);
        } else {
          localStorage.removeItem(`ws-alias:${selectedWorkspacePath}`);
        }
      } catch {
        // localStorage 不可用时静默失败
      }
    },
    [selectedWorkspacePath],
  );

  const workspaceDisplayName = workspaceAlias || basename(selectedWorkspacePath);

  const workspacePickerDataSource = useState(() =>
    buildWorkspacePickerDataSource({
      client: createWorkspaceClient(gatewayUrl),
      token: accessToken,
    }),
  )[0];

  const handleSelectWorkspace = useCallback(
    async (path: string) => {
      addSavedWorkspacePath(path);
      setSelectedWorkspacePath(path);
      setFileTreeRootPath(path);
      setShowWorkspacePicker(false);
      // 切换工作区时桌面端保持 Panel 展开，让用户看到新工作区的会话列表；
      // 移动端才收起，避免遮挡内容区。
      if (compactViewport) {
        setLeftSidebarOpen(false);
      }
    },
    [
      addSavedWorkspacePath,
      compactViewport,
      setFileTreeRootPath,
      setLeftSidebarOpen,
      setSelectedWorkspacePath,
    ],
  );

  const preloadRoute = useCallback((path: string) => {
    void preloadRouteModuleByPath(path);
  }, []);

  const {
    sessions,
    groupedSessions,
    groupedSessionTrees,
    sessionCountByWorkspace,
    collapsedGroups,
    toggleGroupCollapsed,
    renamingSessionId,
    renameValue,
    setRenameValue,
    hoveredSessionId,
    setHoveredSessionId,
    isDeletingSession,
    sessionSearch,
    setSessionSearch,
    newSession,
    startRename,
    commitRename,
    quickDeleteSession,
    quickExportSession,
    exportSessionAsMarkdown,
    exportSessionAsJson,
  } = useSessions();

  const {
    workspaceGroups: teamWorkspaceGroups,
    loading: teamLoading,
    error: teamError,
  } = useTeamSidebarSessions();

  const currentSessionId = location.pathname.split('/chat/')[1]?.split('/')[0] ?? null;
  const isTeamRoute = location.pathname.startsWith('/team');
  const storedActiveTeamSessionId = useUIStateStore((s) => s.activeTeamSessionId);
  const activeTeamSessionId = isTeamRoute ? storedActiveTeamSessionId : null;
  const expanded = leftSidebarOpen && !compactViewport;
  const chatSessionNodes = useMemo(
    () =>
      groupedSessions.flatMap((group) => {
        const groupKey = getWorkspaceGroupKey(group.workspacePath);
        const treeGroup = groupedSessionTrees.find(
          (tg) => getWorkspaceGroupKey(tg.workspacePath) === groupKey,
        );
        return treeGroup?.roots ?? [];
      }),
    [groupedSessionTrees, groupedSessions],
  );
  const peekSessionNodes = useMemo(() => {
    const peekGroupKey = getWorkspaceGroupKey(peekWorkspacePath);
    const treeGroup = groupedSessionTrees.find(
      (group) => getWorkspaceGroupKey(group.workspacePath) === peekGroupKey,
    );
    return treeGroup?.roots ?? chatSessionNodes;
  }, [chatSessionNodes, groupedSessionTrees, peekWorkspacePath]);

  const filteredTeamGroups = useMemo(() => {
    if (!teamSearch.trim()) return teamWorkspaceGroups;
    const lower = teamSearch.toLowerCase();
    return teamWorkspaceGroups
      .map((wg) => ({
        ...wg,
        sessions: wg.sessions.filter((s) => s.title.toLowerCase().includes(lower)),
      }))
      .filter((wg) => wg.label.toLowerCase().includes(lower) || wg.sessions.length > 0);
  }, [teamSearch, teamWorkspaceGroups]);

  const preloadChatRoute = useCallback((sessionIdToPreload: string) => {
    void preloadRouteModuleByPath(`/chat/${sessionIdToPreload}`);
  }, []);

  const openChatSession = useCallback(
    (sessionIdToOpen: string) => {
      preloadChatRoute(sessionIdToOpen);
      void navigate(`/chat/${sessionIdToOpen}`);
    },
    [navigate, preloadChatRoute],
  );

  const handleNewTask = useCallback(() => {
    navigateToHome();
    preloadRoute('/chat');
    void navigate('/chat');
  }, [navigate, navigateToHome, preloadRoute]);

  const handleNewTeamWorkspace = useCallback(() => {
    preloadRoute('/team');
    triggerTeamNewWorkspace();
    void navigate('/team?action=newWorkspace');
  }, [navigate, preloadRoute, triggerTeamNewWorkspace]);
  const clearPeekCloseTimer = useCallback(() => {
    if (peekCloseTimerRef.current) {
      clearTimeout(peekCloseTimerRef.current);
      peekCloseTimerRef.current = null;
    }
  }, []);
  const openProjectPeek = useCallback(
    (path: string) => {
      if (expanded || compactViewport) {
        return;
      }

      clearPeekCloseTimer();
      setPeekWorkspacePath(path);
    },
    [clearPeekCloseTimer, compactViewport, expanded],
  );
  const scheduleCloseProjectPeek = useCallback(() => {
    clearPeekCloseTimer();
    peekCloseTimerRef.current = setTimeout(() => {
      setPeekWorkspacePath(null);
      peekCloseTimerRef.current = null;
    }, PEEK_CLOSE_DELAY_MS);
  }, [clearPeekCloseTimer]);
  const handlePeekSelectSession = useCallback(
    (sessionId: string) => {
      setPeekWorkspacePath(null);
      openChatSession(sessionId);
    },
    [openChatSession],
  );
  // ─── Chat 会话右键菜单状态 ───
  const [chatContextMenu, setChatContextMenu] = useState<{
    sessionId: string;
    x: number;
    y: number;
  } | null>(null);

  const handleSessionContextMenu = useCallback((sessionId: string, x: number, y: number) => {
    setChatContextMenu({ sessionId, x, y });
  }, []);

  // ─── 团队会话右键菜单状态 ───
  const [teamContextMenu, setTeamContextMenu] = useState<{
    session: {
      id: string;
      title: string;
      stateStatus: string;
      teamWorkspaceId: string | null;
    };
    x: number;
    y: number;
  } | null>(null);

  // ─── 团队会话重命名状态 ───
  const [teamRenamingSessionId, setTeamRenamingSessionId] = useState<string | null>(null);
  const [teamRenameValue, setTeamRenameValue] = useState('');
  const [teamDeletingSessionId, setTeamDeletingSessionId] = useState<string | null>(null);

  const teamAccessToken = useAuthStore((s) => s.accessToken);
  const teamGatewayUrl = useAuthStore((s) => s.gatewayUrl);

  const handleTeamSessionContextMenu = useCallback(
    (
      session: {
        id: string;
        title: string;
        stateStatus: string;
        teamWorkspaceId: string | null;
      },
      x: number,
      y: number,
    ) => {
      setTeamContextMenu({ session, x, y });
    },
    [],
  );

  const handleTeamRename = useCallback((session: { id: string; title: string }) => {
    setTeamRenamingSessionId(session.id);
    setTeamRenameValue(session.title);
  }, []);

  const handleTeamRenameCommit = useCallback(
    async (sessionId: string) => {
      if (!teamAccessToken || !teamGatewayUrl) {
        setTeamRenamingSessionId(null);
        return;
      }
      const trimmed = teamRenameValue.trim();
      if (!trimmed) {
        setTeamRenamingSessionId(null);
        return;
      }
      try {
        await createTeamClient(teamGatewayUrl).updateSessionState(teamAccessToken, sessionId, {
          title: trimmed,
        });
        requestSessionListRefresh();
      } catch (err) {
        console.error('[TeamSession] 重命名失败:', err);
      }
      setTeamRenamingSessionId(null);
    },
    [teamAccessToken, teamGatewayUrl, teamRenameValue],
  );

  const handleTeamTogglePause = useCallback(
    async (sessionId: string, stateStatus: string) => {
      if (!teamAccessToken || !teamGatewayUrl) return;
      const nextState = stateStatus === 'running' ? 'paused' : 'running';
      try {
        await createTeamClient(teamGatewayUrl).updateSessionState(teamAccessToken, sessionId, {
          stateStatus: nextState,
        });
        requestSessionListRefresh();
      } catch (err) {
        console.error('[TeamSession] 切换暂停/恢复失败:', err);
      }
    },
    [teamAccessToken, teamGatewayUrl],
  );

  const handleTeamCopyId = useCallback((sessionId: string) => {
    void navigator.clipboard?.writeText(sessionId);
  }, []);

  const handleTeamDelete = useCallback(
    async (sessionId: string) => {
      if (!teamAccessToken || !teamGatewayUrl) return;
      if (teamDeletingSessionId === sessionId) return;
      setTeamDeletingSessionId(sessionId);
      try {
        await createTeamClient(teamGatewayUrl).deleteSession(teamAccessToken, sessionId);
        requestSessionListRefresh();
      } catch (err) {
        console.error('[TeamSession] 删除失败:', err);
      }
      setTeamDeletingSessionId(null);
    },
    [teamAccessToken, teamDeletingSessionId, teamGatewayUrl],
  );

  const handleNewTeamSession = useCallback(
    (workspaceId: string) => {
      preloadRoute('/team');
      triggerTeamNewSession(workspaceId);
      void navigate(`/team/${workspaceId}`);
    },
    [navigate, preloadRoute, triggerTeamNewSession],
  );

  // ─── 团队工作区右键菜单状态 ───
  const [teamWorkspaceContextMenu, setTeamWorkspaceContextMenu] = useState<{
    workspace: { id: string; name: string };
    x: number;
    y: number;
  } | null>(null);

  // ─── 团队工作区重命名状态 ───
  const [teamWorkspaceRenamingId, setTeamWorkspaceRenamingId] = useState<string | null>(null);
  const [teamWorkspaceRenameValue, setTeamWorkspaceRenameValue] = useState('');
  const [teamWorkspaceDeletingId, setTeamWorkspaceDeletingId] = useState<string | null>(null);

  const handleTeamWorkspaceContextMenu = useCallback(
    (workspace: { id: string; name: string }, x: number, y: number) => {
      setTeamWorkspaceContextMenu({ workspace, x, y });
    },
    [],
  );

  const handleTeamWorkspaceRename = useCallback((workspace: { id: string; name: string }) => {
    setTeamWorkspaceRenamingId(workspace.id);
    setTeamWorkspaceRenameValue(workspace.name);
  }, []);

  const handleTeamWorkspaceRenameCommit = useCallback(
    async (workspaceId: string) => {
      if (!teamAccessToken || !teamGatewayUrl) {
        setTeamWorkspaceRenamingId(null);
        return;
      }
      const trimmed = teamWorkspaceRenameValue.trim();
      if (!trimmed) {
        setTeamWorkspaceRenamingId(null);
        return;
      }
      try {
        await createTeamClient(teamGatewayUrl).updateWorkspace(teamAccessToken, workspaceId, {
          name: trimmed,
        });
        requestSessionListRefresh();
      } catch (err) {
        console.error('[TeamWorkspace] 重命名失败:', err);
      }
      setTeamWorkspaceRenamingId(null);
    },
    [teamAccessToken, teamGatewayUrl, teamWorkspaceRenameValue],
  );

  const handleTeamWorkspaceCopyId = useCallback((workspaceId: string) => {
    void navigator.clipboard?.writeText(workspaceId);
  }, []);

  const handleTeamWorkspaceDelete = useCallback(
    async (workspaceId: string) => {
      if (!teamAccessToken || !teamGatewayUrl) return;
      if (teamWorkspaceDeletingId === workspaceId) return;
      setTeamWorkspaceDeletingId(workspaceId);
      try {
        await createTeamClient(teamGatewayUrl).deleteWorkspace(teamAccessToken, workspaceId);
        requestSessionListRefresh();
      } catch (err) {
        console.error('[TeamWorkspace] 删除失败:', err);
      }
      setTeamWorkspaceDeletingId(null);
    },
    [teamAccessToken, teamGatewayUrl, teamWorkspaceDeletingId],
  );

  const handlePointerPositionChange = useCallback(
    (_position: { x: number; y: number } | null) => undefined,
    [],
  );

  useEffect(() => clearPeekCloseTimer, [clearPeekCloseTimer]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const viewportQuery = window.matchMedia('(max-width: 640px)');
    const updateCompactViewport = () => setCompactViewport(viewportQuery.matches);

    updateCompactViewport();
    viewportQuery.addEventListener('change', updateCompactViewport);

    return () => {
      viewportQuery.removeEventListener('change', updateCompactViewport);
    };
  }, []);

  useEffect(() => {
    if (compactViewport) {
      setPeekWorkspacePath(null);
    }
  }, [compactViewport]);

  // Panel 收起(expanded: true → false)时，如果焦点还留在 Panel 内部
  // (例如刚点击的会话行)，需要主动挪走。Panel 收起后会被打上
  // aria-hidden="true"，若焦点元素仍是其后代，浏览器会报
  // "Blocked aria-hidden on an element because its descendant retained
  // focus" 并强制把焦点丢到 document.body，打断键盘用户后续的 Tab 导航。
  useEffect(() => {
    if (expanded || compactViewport) {
      return;
    }
    const activeElement = document.activeElement;
    if (
      activeElement instanceof HTMLElement &&
      panelContainerRef.current?.contains(activeElement)
    ) {
      activeElement.blur();
    }
  }, [expanded, compactViewport]);

  // 仅在移动端/紧凑视口下收起 Panel（桌面端点击 section 标题或工作区头像时面板应保持展开）
  const closeCompactSidebar = useCallback(() => {
    if (compactViewport) {
      setLeftSidebarOpen(false);
    }
  }, [compactViewport, setLeftSidebarOpen]);

  const mobileDrawerOpen = compactViewport && leftSidebarOpen;
  const panelContent = (
    <>
      {/* 项目名 + 路径 + 菜单 / 团队专属 Header */}
      <div style={PANEL_HEADER_STYLE}>
        {isTeamRoute ? (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, gap: 1 }}>
              <span style={PANEL_TITLE_STYLE}>团队工作空间</span>
              <span style={PANEL_SUBTITLE_STYLE}>
                {teamLoading ? '加载中…' : `${teamWorkspaceGroups.length} 个工作空间`}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
              <button
                type="button"
                title="新建工作空间"
                aria-label="新建工作空间"
                onClick={handleNewTeamWorkspace}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 26,
                  height: 26,
                  borderRadius: 6,
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--fg-muted)',
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                <svg
                  aria-hidden="true"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
              {!compactViewport && (
                <button
                  type="button"
                  title="收起面板"
                  aria-label="收起面板"
                  onClick={() => setLeftSidebarOpen(false)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 26,
                    height: 26,
                    borderRadius: 6,
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--fg-muted)',
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                >
                  <svg
                    aria-hidden="true"
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, gap: 1 }}>
              <InlineEditor
                value={workspaceDisplayName}
                label="项目名称"
                emptyFallback={basename(selectedWorkspacePath)}
                onSave={handleWorkspaceAliasChange}
                style={{ ...PANEL_TITLE_STYLE, width: '100%' }}
                buttonStyle={{ ...PANEL_TITLE_STYLE, padding: '1px 2px' }}
                inputStyle={{ fontSize: 13, fontWeight: 800 }}
              />
              <span style={PANEL_SUBTITLE_STYLE}>{selectedWorkspacePath ?? '未选择工作区'}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
              <button
                type="button"
                title="更多"
                aria-label="更多"
                onClick={() => setShowWorkspacePicker(true)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 26,
                  height: 26,
                  borderRadius: 6,
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--fg-muted)',
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                <svg
                  aria-hidden="true"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                >
                  <circle cx="12" cy="5" r="1" />
                  <circle cx="12" cy="12" r="1" />
                  <circle cx="12" cy="19" r="1" />
                </svg>
              </button>
              {!compactViewport && (
                <button
                  type="button"
                  title="收起面板"
                  aria-label="收起面板"
                  onClick={() => setLeftSidebarOpen(false)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 26,
                    height: 26,
                    borderRadius: 6,
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--fg-muted)',
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                >
                  <svg
                    aria-hidden="true"
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {/* 搜索 + 会话列表 */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{ padding: '6px 8px', flexShrink: 0 }}>
          <input
            type="text"
            placeholder={isTeamRoute ? '搜索工作空间…' : '搜索会话…'}
            value={isTeamRoute ? teamSearch : sessionSearch}
            onChange={(e) =>
              isTeamRoute ? setTeamSearch(e.target.value) : setSessionSearch(e.target.value)
            }
            style={SEARCH_STYLE}
          />
        </div>

        <div
          style={{
            flexGrow: 1,
            flexShrink: 1,
            flexBasis: '0%',
            minHeight: 0,
            overflowY: 'auto',
            overflowX: 'hidden',
            padding: '4px 6px',
            display: 'flex',
            flexDirection: 'column',
            gap: 0,
          }}
        >
          {/* Team 路由：只显示团队会话 */}
          {isTeamRoute ? (
            <>
              {teamError && (
                <div style={{ padding: '6px 10px', fontSize: 11, color: 'var(--fg-muted)' }}>
                  {teamError}
                </div>
              )}
              {!teamLoading && !teamError && teamWorkspaceGroups.length === 0 && (
                <div
                  style={{
                    padding: '16px 10px',
                    textAlign: 'center',
                    fontSize: 11,
                    lineHeight: 1.5,
                    color: 'var(--fg-muted)',
                  }}
                >
                  暂无团队工作空间
                </div>
              )}
              {!teamLoading &&
                !teamError &&
                teamWorkspaceGroups.length > 0 &&
                filteredTeamGroups.length === 0 && (
                  <div
                    style={{
                      padding: '16px 10px',
                      textAlign: 'center',
                      fontSize: 11,
                      lineHeight: 1.5,
                      color: 'var(--fg-muted)',
                    }}
                  >
                    无匹配结果
                  </div>
                )}
              {filteredTeamGroups.map((wg) => (
                <TeamWorkspaceGroupItem
                  key={wg.id}
                  group={wg}
                  activeTeamSessionId={activeTeamSessionId}
                  preloadRoute={preloadRoute}
                  navigate={navigate}
                  onSelectSession={(wsId, sessionId) => {
                    preloadRoute('/team');
                    triggerTeamSelectSession(wsId, sessionId);
                    void navigate(`/team/${wsId}`);
                  }}
                  onSessionContextMenu={handleTeamSessionContextMenu}
                  renamingSessionId={teamRenamingSessionId}
                  renameValue={teamRenameValue}
                  onRenameChange={setTeamRenameValue}
                  onRenameCommit={(id) => void handleTeamRenameCommit(id)}
                  onStartRename={handleTeamRename}
                  onWorkspaceContextMenu={handleTeamWorkspaceContextMenu}
                  workspaceRenamingId={teamWorkspaceRenamingId}
                  workspaceRenameValue={teamWorkspaceRenameValue}
                  onWorkspaceRenameChange={setTeamWorkspaceRenameValue}
                  onWorkspaceRenameCommit={(id) => void handleTeamWorkspaceRenameCommit(id)}
                  onNewSession={handleNewTeamSession}
                  onTogglePause={handleTeamTogglePause}
                  onDelete={handleTeamDelete}
                />
              ))}
            </>
          ) : (
            <>
              {/* Chat 路由：按工作区分组显示 Chat 会话 */}
              {groupedSessions.length === 0 && (
                <p
                  style={{
                    padding: '24px 8px',
                    textAlign: 'center',
                    fontSize: 12,
                    color: 'var(--fg-muted)',
                  }}
                >
                  暂无工作区
                </p>
              )}
              {groupedSessions.map((group) => {
                const groupKey = getWorkspaceGroupKey(group.workspacePath);
                const isCollapsed = collapsedGroups.has(groupKey);
                const actualSessionCount =
                  sessionCountByWorkspace.get(getWorkspaceGroupKey(group.workspacePath)) ?? 0;
                const treeGroup = groupedSessionTrees.find(
                  (tg) => getWorkspaceGroupKey(tg.workspacePath) === groupKey,
                );
                const roots = treeGroup?.roots ?? [];
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
                    {/* 工作区标题 */}
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                      <button
                        type="button"
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
                          background: 'color-mix(in srgb, var(--fg-muted) 4%, transparent)',
                          border: 'none',
                          borderRadius: 6,
                          cursor: 'pointer',
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
                          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
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
                        <span
                          style={{
                            fontSize: 10,
                            color: 'var(--fg-muted)',
                            flexShrink: 0,
                          }}
                        >
                          {actualSessionCount}
                        </span>
                      </button>
                      {group.workspacePath && (
                        <button
                          type="button"
                          title={`在 ${group.workspaceLabel} 中新建会话`}
                          aria-label={`在 ${group.workspaceLabel} 中新建会话`}
                          onClick={() => void newSession(group.workspacePath)}
                          style={{
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
                    {/* 工作区下的会话列表 */}
                    {!isCollapsed &&
                      roots.map((node) => (
                        <SessionSidebarSessionRow
                          key={node.session.id}
                          activeSessionId={currentSessionId ?? undefined}
                          commitRename={commitRename}
                          hoveredSessionId={hoveredSessionId}
                          isDeletingSession={isDeletingSession}
                          isPinned={isPinned}
                          node={node}
                          onHoveredSessionChange={setHoveredSessionId}
                          onOpenContextMenu={handleSessionContextMenu}
                          onPointerPositionChange={handlePointerPositionChange}
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
                );
              })}
            </>
          )}
        </div>
      </div>

      {/* 新建会话 / 新建工作空间 */}
      <button
        type="button"
        onClick={isTeamRoute ? handleNewTeamWorkspace : handleNewTask}
        style={NEW_SESSION_BTN_STYLE}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        {isTeamRoute ? '新建工作空间' : '新建会话'}
      </button>
    </>
  );

  return (
    <div
      className="fusion-sidebar"
      data-compact-viewport={compactViewport ? 'true' : 'false'}
      style={{
        ...CONTAINER_STYLE,
        ...(compactViewport ? { width: 0 } : {}),
      }}
    >
      {!compactViewport ? (
        <SidebarRailV2
          accessToken={accessToken}
          gatewayUrl={gatewayUrl}
          theme={theme}
          onToggleTheme={onToggleTheme}
          onLogout={onLogout}
          pendingPermissionIndicator={pendingPermissionIndicator}
        />
      ) : !mobileDrawerOpen ? (
        <button
          type="button"
          aria-label="展开会话侧栏"
          title="展开会话侧栏"
          onClick={() => setLeftSidebarOpen(true)}
          style={MOBILE_TRIGGER_STYLE}
        >
          <svg
            aria-hidden="true"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 6h16" />
            <path d="M4 12h16" />
            <path d="M4 18h16" />
          </svg>
        </button>
      ) : null}

      {!compactViewport && !expanded && peekWorkspacePath ? (
        <FusionSidebarPeek
          activeSessionId={currentSessionId}
          nodes={peekSessionNodes}
          onCreateSession={handleNewTask}
          onMouseEnter={clearPeekCloseTimer}
          onMouseLeave={scheduleCloseProjectPeek}
          onSelectSession={handlePeekSelectSession}
          workspacePath={peekWorkspacePath}
        />
      ) : null}

      {/* Panel */}
      {!compactViewport ? (
        <div
          ref={panelContainerRef}
          data-fusion-sidebar-panel="true"
          style={{
            ...PANEL_STYLE,
            width: expanded ? SIDEBAR_WIDTH : 0,
          }}
          aria-hidden={expanded ? undefined : true}
        >
          {panelContent}
        </div>
      ) : mobileDrawerOpen ? (
        <div role="dialog" aria-modal="true" aria-label="会话侧栏" style={MOBILE_BACKDROP_STYLE}>
          <button
            type="button"
            aria-label="关闭会话侧栏"
            style={MOBILE_CLOSE_LAYER_STYLE}
            onClick={closeCompactSidebar}
          />
          <aside style={MOBILE_DRAWER_STYLE}>{panelContent}</aside>
        </div>
      ) : null}

      {createPortal(
        <WorkspacePickerModal
          isOpen={showWorkspacePicker}
          onClose={() => setShowWorkspacePicker(false)}
          onSelect={handleSelectWorkspace}
          fetchRootPath={workspacePickerDataSource.fetchRootPath}
          fetchWorkspaceRoots={workspacePickerDataSource.fetchWorkspaceRoots}
          fetchTree={workspacePickerDataSource.fetchTree}
          createDirectory={workspacePickerDataSource.createDirectory}
          validatePath={workspacePickerDataSource.validatePath}
          initialPath={fileTreeRootPath ?? selectedWorkspacePath ?? undefined}
        />,
        document.body,
      )}

      {/* Chat 会话右键菜单 Portal */}
      {chatContextMenu &&
        createPortal(
          (() => {
            const ctxSession = sessions.find((s) => s.id === chatContextMenu.sessionId);
            return (
              <SessionContextMenu
                sessionId={chatContextMenu.sessionId}
                sessionTitle={ctxSession?.title ?? null}
                x={chatContextMenu.x}
                y={chatContextMenu.y}
                isPinned={isPinned(chatContextMenu.sessionId)}
                hasMessages
                onClose={() => setChatContextMenu(null)}
                onRename={() => {
                  if (ctxSession) startRename(ctxSession);
                  setChatContextMenu(null);
                }}
                onExportMarkdown={() => exportSessionAsMarkdown(chatContextMenu.sessionId)}
                onExportJson={() => exportSessionAsJson(chatContextMenu.sessionId)}
                onClearMessages={() => setChatContextMenu(null)}
                onPin={() => togglePinSession(chatContextMenu.sessionId)}
                onDelete={() => {
                  void quickDeleteSession(chatContextMenu.sessionId);
                  setChatContextMenu(null);
                }}
              />
            );
          })(),
          document.body,
        )}

      {/* 团队会话右键菜单 Portal */}
      {teamContextMenu &&
        createPortal(
          <TeamSessionContextMenu
            sessionId={teamContextMenu.session.id}
            sessionTitle={teamContextMenu.session.title}
            x={teamContextMenu.x}
            y={teamContextMenu.y}
            stateStatus={teamContextMenu.session.stateStatus}
            isRenaming={teamRenamingSessionId === teamContextMenu.session.id}
            isDeleting={teamDeletingSessionId === teamContextMenu.session.id}
            onClose={() => setTeamContextMenu(null)}
            onRename={() => handleTeamRename(teamContextMenu.session)}
            onTogglePause={() =>
              void handleTeamTogglePause(
                teamContextMenu.session.id,
                teamContextMenu.session.stateStatus,
              )
            }
            onCopyId={() => handleTeamCopyId(teamContextMenu.session.id)}
            onDelete={() => void handleTeamDelete(teamContextMenu.session.id)}
          />,
          document.body,
        )}

      {/* 团队工作区右键菜单 Portal */}
      {teamWorkspaceContextMenu &&
        createPortal(
          <TeamWorkspaceContextMenu
            workspaceId={teamWorkspaceContextMenu.workspace.id}
            workspaceName={teamWorkspaceContextMenu.workspace.name}
            x={teamWorkspaceContextMenu.x}
            y={teamWorkspaceContextMenu.y}
            isRenaming={teamWorkspaceRenamingId === teamWorkspaceContextMenu.workspace.id}
            isDeleting={teamWorkspaceDeletingId === teamWorkspaceContextMenu.workspace.id}
            isUnbound={teamWorkspaceContextMenu.workspace.id === '__unbound__'}
            onClose={() => setTeamWorkspaceContextMenu(null)}
            onRename={() => handleTeamWorkspaceRename(teamWorkspaceContextMenu.workspace)}
            onCopyId={() => handleTeamWorkspaceCopyId(teamWorkspaceContextMenu.workspace.id)}
            onDelete={() => void handleTeamWorkspaceDelete(teamWorkspaceContextMenu.workspace.id)}
          />,
          document.body,
        )}
    </div>
  );
}
