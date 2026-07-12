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
import { useUIStateStore } from '../../stores/ui/uiState.js';
import { useSessions } from '../../hooks/workspace/useSessions.js';
import { useTeamSidebarSessions } from '../../hooks/workspace/useTeamSidebarSessions.js';
import type { TeamWorkspaceGroup } from '../../hooks/workspace/useTeamSidebarSessions.js';
import { SessionSidebarSessionRow } from '../layout/sidebar/SessionSidebarSessionRow.js';
import { BaseSessionRow } from '../layout/sidebar/BaseSessionRow.js';
import { WorkspaceGitBadge } from '../layout/sidebar/SidebarHelpers.js';
import TeamSessionContextMenu from '../layout/sidebar/TeamSessionContextMenu.js';
import TeamWorkspaceContextMenu from '../layout/sidebar/TeamWorkspaceContextMenu.js';
import ChatWorkspaceContextMenu from '../layout/sidebar/ChatWorkspaceContextMenu.js';
import { getWorkspaceGroupKey } from '../../utils/session/session-grouping.js';
import { requestSessionListRefresh } from '../../utils/session/session-list-events.js';
import { useAuthStore } from '../../stores/auth/auth.js';
import { preloadRouteModuleByPath } from '../../routes/preloadable-route-modules.js';
import WorkspacePickerModal from '../common/modal/WorkspacePickerModal.js';
import { buildWorkspacePickerDataSource } from '../common/modal/workspace-picker-data-source.js';
import { SidebarRailV2 } from '../layout/SidebarRailV2.js';
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

function basename(path: string | null): string {
  if (!path) return 'OpenAWork';
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
  const parts = normalized.split('/').filter(Boolean);
  return parts.at(-1) ?? 'OpenAWork';
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
  onNewSession,
  onSelectSession,
  onSessionContextMenu,
  renamingSessionId,
  renameValue,
  onRenameChange,
  onRenameCommit,
  onWorkspaceContextMenu,
  workspaceRenamingId,
  workspaceRenameValue,
  onWorkspaceRenameChange,
  onWorkspaceRenameCommit,
}: {
  group: TeamWorkspaceGroup;
  activeTeamSessionId: string | null;
  preloadRoute: (path: string) => void;
  navigate: (path: string) => void | Promise<void>;
  onNewSession: (workspaceId: string) => void;
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
  onWorkspaceContextMenu: (workspace: { id: string; name: string }, x: number, y: number) => void;
  workspaceRenamingId: string | null;
  workspaceRenameValue: string;
  onWorkspaceRenameChange: (value: string) => void;
  onWorkspaceRenameCommit: (workspaceId: string) => void;
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
            gap: 6,
            minWidth: 0,
            padding: '5px 4px 4px 8px',
            borderRadius: 6,
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            color: 'var(--fg-default)',
            textAlign: 'left',
          }}
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
              transform: collapsed ? 'rotate(0deg)' : 'rotate(90deg)',
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
                renaming={renamingSessionId === ts.id}
                renameValue={renameValue}
                onRenameChange={onRenameChange}
                onRenameCommit={onRenameCommit}
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
  const savedWorkspacePaths = useUIStateStore((s) => s.savedWorkspacePaths);
  const selectedWorkspacePath = useUIStateStore((s) => s.selectedWorkspacePath);
  const addSavedWorkspacePath = useUIStateStore((s) => s.addSavedWorkspacePath);
  const setSelectedWorkspacePath = useUIStateStore((s) => s.setSelectedWorkspacePath);
  const setFileTreeRootPath = useUIStateStore((s) => s.setFileTreeRootPath);
  const fileTreeRootPath = useUIStateStore((s) => s.fileTreeRootPath);
  const triggerTeamNewSession = useUIStateStore((s) => s.triggerTeamNewSession);
  const triggerTeamSelectSession = useUIStateStore((s) => s.triggerTeamSelectSession);
  const triggerResetToWelcome = useUIStateStore((s) => s.triggerResetToWelcome);

  const [showWorkspacePicker, setShowWorkspacePicker] = useState(false);
  const [peekWorkspacePath, setPeekWorkspacePath] = useState<string | null>(null);
  const [compactViewport, setCompactViewport] = useState(isCompactFusionSidebarViewport);
  const peekCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    },
    [addSavedWorkspacePath, setFileTreeRootPath, setSelectedWorkspacePath],
  );

  const preloadRoute = useCallback((path: string) => {
    void preloadRouteModuleByPath(path);
  }, []);

  const {
    sessions,
    groupedSessions,
    groupedSessionTrees,
    sessionCountByWorkspace,
    renamingSessionId,
    renameValue,
    setRenameValue,
    hoveredSessionId,
    setHoveredSessionId,
    isDeletingSession,
    collapsedGroups,
    toggleGroupCollapsed,
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
    sessions: teamSessions,
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
      groupedSessions
        .filter(
          (group) =>
            selectedWorkspacePath === null ||
            getWorkspaceGroupKey(group.workspacePath) ===
              getWorkspaceGroupKey(selectedWorkspacePath),
        )
        .flatMap((group) => {
          const groupKey = getWorkspaceGroupKey(group.workspacePath);
          const treeGroup = groupedSessionTrees.find(
            (tg) => getWorkspaceGroupKey(tg.workspacePath) === groupKey,
          );
          return treeGroup?.roots ?? [];
        }),
    [groupedSessionTrees, groupedSessions, selectedWorkspacePath],
  );
  const peekSessionNodes = useMemo(() => {
    const peekGroupKey = getWorkspaceGroupKey(peekWorkspacePath);
    const treeGroup = groupedSessionTrees.find(
      (group) => getWorkspaceGroupKey(group.workspacePath) === peekGroupKey,
    );
    return treeGroup?.roots ?? chatSessionNodes;
  }, [chatSessionNodes, groupedSessionTrees, peekWorkspacePath]);

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
    void navigate('/team?action=newWorkspace');
  }, [navigate, preloadRoute]);
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
      setLeftSidebarOpen(true);
      setPeekWorkspacePath(null);
      openChatSession(sessionId);
    },
    [openChatSession, setLeftSidebarOpen],
  );
  const handleSessionContextMenu = useCallback(
    (_sessionId: string, _x: number, _y: number) => undefined,
    [],
  );

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

  return (
    <div
      className="fusion-sidebar"
      data-compact-viewport={compactViewport ? 'true' : 'false'}
      style={CONTAINER_STYLE}
    >
      <SidebarRailV2
        accessToken={accessToken}
        gatewayUrl={gatewayUrl}
        theme={theme}
        onToggleTheme={onToggleTheme}
        onLogout={onLogout}
        pendingPermissionIndicator={pendingPermissionIndicator}
        onOpenWorkspacePicker={() => setShowWorkspacePicker(true)}
        onProjectHover={(path) => {
          if (path) {
            openProjectPeek(path);
          } else {
            scheduleCloseProjectPeek();
          }
        }}
        onSelectWorkspace={(path) => {
          void handleSelectWorkspace(path);
        }}
      />

      {!expanded && peekWorkspacePath ? (
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
      <div
        style={{
          ...PANEL_STYLE,
          width: expanded ? SIDEBAR_WIDTH : 0,
        }}
        aria-hidden={!expanded}
      >
        {/* 项目名 + 路径 + 菜单 */}
        <div style={PANEL_HEADER_STYLE}>
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, gap: 1 }}>
            <span style={PANEL_TITLE_STYLE}>{basename(selectedWorkspacePath)}</span>
            <span style={PANEL_SUBTITLE_STYLE}>{selectedWorkspacePath ?? '未选择工作区'}</span>
          </div>
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
              placeholder="搜索会话…"
              value={sessionSearch}
              onChange={(e) => setSessionSearch(e.target.value)}
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
            {/* S2 扁平会话列表：不按工作区分组，直接列出所有会话 */}
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
            {chatSessionNodes.map((node) => (
              <SessionSidebarSessionRow
                key={node.session.id}
                activeSessionId={currentSessionId ?? undefined}
                commitRename={commitRename}
                hoveredSessionId={hoveredSessionId}
                isDeletingSession={isDeletingSession}
                isPinned={() => false}
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

            {/* 团队会话 */}
            <div
              style={{
                flexGrow: 1,
                flexShrink: 1,
                flexBasis: '0%',
                minHeight: 0,
                display: 'flex',
                flexDirection: 'column',
                marginTop: 6,
                paddingTop: 6,
                borderTop: '1px solid var(--border-subtle)',
              }}
            >
              <div
                onClick={() => {
                  if (!location.pathname.startsWith('/team')) {
                    void navigate('/team');
                  }
                  triggerResetToWelcome('team');
                }}
                title="点击回到团队欢迎页面"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 8px',
                  fontSize: 11,
                  fontWeight: 700,
                  color: 'var(--fg-muted)',
                  cursor: 'pointer',
                }}
              >
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
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
                <span>团队工作空间</span>
                <span style={{ fontSize: 10 }}>{teamLoading ? '…' : teamSessions.length}</span>
                <button
                  type="button"
                  onClick={handleNewTeamWorkspace}
                  title="新建团队工作区"
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
                    marginLeft: 'auto',
                    marginRight: 2,
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
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                    <line x1="12" y1="11" x2="12" y2="17" />
                    <line x1="9" y1="14" x2="15" y2="14" />
                  </svg>
                </button>
              </div>
              {/* 团队会话滚动区域 */}
              <div
                style={{
                  flex: 1,
                  minHeight: 0,
                  overflowY: 'auto',
                  overflowX: 'hidden',
                }}
              >
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
                {teamWorkspaceGroups.map((wg) => (
                  <TeamWorkspaceGroupItem
                    key={wg.id}
                    group={wg}
                    activeTeamSessionId={activeTeamSessionId}
                    preloadRoute={preloadRoute}
                    navigate={navigate}
                    onNewSession={(wsId) => {
                      preloadRoute('/team');
                      triggerTeamNewSession(wsId);
                      void navigate(`/team/${wsId}`);
                    }}
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
                    onWorkspaceContextMenu={handleTeamWorkspaceContextMenu}
                    workspaceRenamingId={teamWorkspaceRenamingId}
                    workspaceRenameValue={teamWorkspaceRenameValue}
                    onWorkspaceRenameChange={setTeamWorkspaceRenameValue}
                    onWorkspaceRenameCommit={(id) => void handleTeamWorkspaceRenameCommit(id)}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* 新建会话 */}
        <button type="button" onClick={handleNewTask} style={NEW_SESSION_BTN_STYLE}>
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
          新建会话
        </button>
      </div>

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
