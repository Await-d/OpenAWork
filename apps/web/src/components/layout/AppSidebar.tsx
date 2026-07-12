import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { NavLink, useLocation, useNavigate } from 'react-router';
import { createHealthClient, createWorkspaceClient, createTeamClient } from '@openAwork/web-client';
import { BrandLogo } from '@openAwork/shared-ui';
import { TOP_NAV_ITEMS, BOTTOM_NAV_ITEMS, railIcon } from './nav/RailIcon.js';
import type { NavItem } from './nav/RailIcon.js';
import { preloadRouteModuleByPath } from '../../routes/preloadable-route-modules.js';
import { useUIStateStore } from '../../stores/ui/uiState.js';
import { useDisplayPreferencesStore } from '../../stores/settings/display-preferences.js';
import { useAuthStore } from '../../stores/auth/auth.js';
import { useSessions } from '../../hooks/workspace/useSessions.js';
import { useTeamSidebarSessions } from '../../hooks/workspace/useTeamSidebarSessions.js';
import type { TeamWorkspaceGroup } from '../../hooks/workspace/useTeamSidebarSessions.js';
import NotificationCenter from './notification/NotificationCenter.js';
import { SessionSidebarSessionRow } from './sidebar/SessionSidebarSessionRow.js';
import { BaseSessionRow } from './sidebar/BaseSessionRow.js';
import { WorkspaceGitBadge } from './sidebar/SidebarHelpers.js';
import SessionContextMenu from './sidebar/SessionContextMenu.js';
import TeamSessionContextMenu from './sidebar/TeamSessionContextMenu.js';
import TeamWorkspaceContextMenu from './sidebar/TeamWorkspaceContextMenu.js';
import ChatWorkspaceContextMenu from './sidebar/ChatWorkspaceContextMenu.js';
import { getWorkspaceGroupKey } from '../../utils/session/session-grouping.js';
import { requestSessionListRefresh } from '../../utils/session/session-list-events.js';
import WorkspacePickerModal from '../common/modal/WorkspacePickerModal.js';
import { buildWorkspacePickerDataSource } from '../common/modal/workspace-picker-data-source.js';

const SIDEBAR_WIDTH = 260;
const COLLAPSED_WIDTH = 56;
const WIDE_VIEWPORT_QUERY = '(min-width: 1280px)';

function useWideViewport(): boolean {
  const [isWide, setIsWide] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
    return window.matchMedia(WIDE_VIEWPORT_QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(WIDE_VIEWPORT_QUERY);
    const update = () => setIsWide(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return isWide;
}

type GatewayStatus = 'online' | 'offline' | 'warning';

function useGatewayStatus(gatewayUrl: string): GatewayStatus {
  const [status, setStatus] = useState<GatewayStatus>('online');

  useEffect(() => {
    if (!gatewayUrl) {
      setStatus('offline');
      return;
    }
    let cancelled = false;
    let intervalId: number | null = null;
    const client = createHealthClient(gatewayUrl);

    const probe = async () => {
      try {
        const healthy = await client.check({ timeoutMs: 4000 });
        if (cancelled) return;
        setStatus(healthy ? 'online' : 'offline');
      } catch {
        if (cancelled) return;
        setStatus('offline');
      }
    };

    void probe();
    intervalId = window.setInterval(() => void probe(), 30_000);

    return () => {
      cancelled = true;
      if (intervalId !== null) window.clearInterval(intervalId);
    };
  }, [gatewayUrl]);

  return status;
}

const navItemStyle: React.CSSProperties = {
  position: 'relative',
  display: 'flex',
  width: '100%',
  minHeight: 34,
  alignItems: 'center',
  gap: 10,
  borderRadius: 9,
  textDecoration: 'none',
  background: 'transparent',
  color: 'var(--fg-muted)',
  fontWeight: 500,
  overflow: 'visible',
};

/** 团队工作空间分组项（可折叠） */
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
  const [hoveredSessionId, setHoveredSessionId] = useState<string | null>(null);

  // 相对时间格式化
  const formatRelativeTime = (dateStr: string): string => {
    const now = Date.now();
    const then = new Date(dateStr).getTime();
    if (Number.isNaN(then)) return '';
    const diffMs = now - then;
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return '刚刚';
    if (diffMin < 60) return `${diffMin}分钟前`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour}小时前`;
    const diffDay = Math.floor(diffHour / 24);
    if (diffDay < 30) return `${diffDay}天前`;
    const diffMonth = Math.floor(diffDay / 30);
    if (diffMonth < 12) return `${diffMonth}个月前`;
    return `${Math.floor(diffMonth / 12)}年前`;
  };
  // 未绑定工作区的分组不支持新建/重命名/删除
  const canNewSession = group.id !== '__unbound__';
  const isWorkspaceRenaming = workspaceRenamingId === group.id;

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
            {isWorkspaceRenaming ? (
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
        {canNewSession && (
          <button
            type="button"
            onClick={() => onNewSession(group.id)}
            title={`在 ${group.label} 中新建团队会话`}
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
            const isPaused = ts.stateStatus === 'paused';

            const statusColor = isRunning
              ? 'var(--accent)'
              : isPaused
                ? 'var(--warning)'
                : 'var(--border-default)';

            return (
              <BaseSessionRow
                key={ts.id}
                sessionId={ts.id}
                title={ts.title}
                timeLabel={formatRelativeTime(ts.updatedAt)}
                timeTitle={ts.updatedAt}
                active={isActive}
                hovered={hoveredSessionId === ts.id}
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
                onHoverChange={setHoveredSessionId}
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
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: '50%',
                        background: statusColor,
                        animation: isRunning
                          ? 'permissionPulse 1.5s ease-in-out infinite'
                          : undefined,
                      }}
                    />
                  </span>
                }
                meta={
                  <span
                    style={{
                      fontSize: 10,
                      color: 'var(--fg-muted)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    {isRunning && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                        <span
                          style={{
                            width: 5,
                            height: 5,
                            borderRadius: '50%',
                            background: 'var(--accent)',
                            animation: 'permissionPulse 1.5s ease-in-out infinite',
                          }}
                        />
                        <span style={{ color: 'var(--accent)', fontWeight: 600 }}>运行中</span>
                      </span>
                    )}
                    {isPaused && (
                      <span style={{ color: 'var(--warning)', fontWeight: 600 }}>已暂停</span>
                    )}
                    {!isRunning && !isPaused && <span style={{ opacity: 0.7 }}>空闲</span>}
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

export interface AppSidebarProps {
  accessToken: string | null;
  gatewayUrl: string;
  theme?: 'dark' | 'light';
  onToggleTheme?: () => void;
  onLogout?: () => void;
  pendingPermissionIndicator?: boolean;
}

export default function AppSidebar({
  accessToken,
  gatewayUrl,
  theme = 'dark',
  onToggleTheme,
  onLogout,
  pendingPermissionIndicator = false,
}: AppSidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const wideViewport = useWideViewport();
  const gatewayStatus = useGatewayStatus(gatewayUrl);
  const showGatewayStatusIndicator = useDisplayPreferencesStore(
    (s) => s.showGatewayStatusIndicator,
  );

  const navRailExpandedPref = useUIStateStore((state) => state.navRailExpanded);
  const toggleNavRailExpanded = useUIStateStore((state) => state.toggleNavRailExpanded);
  const leftSidebarOpen = useUIStateStore((state) => state.leftSidebarOpen);
  const setLeftSidebarOpen = useUIStateStore((state) => state.setLeftSidebarOpen);
  const navigateToHome = useUIStateStore((state) => state.navigateToHome);
  const togglePinSession = useUIStateStore((state) => state.togglePinSession);
  const isPinned = useUIStateStore((state) => state.isPinned);

  const expanded = (navRailExpandedPref ?? wideViewport) && leftSidebarOpen;
  const sidebarWidth = expanded ? SIDEBAR_WIDTH : COLLAPSED_WIDTH;

  // 对话工作区选择器
  const [showWorkspacePicker, setShowWorkspacePicker] = useState(false);
  const addSavedWorkspacePath = useUIStateStore((s) => s.addSavedWorkspacePath);
  const setSelectedWorkspacePath = useUIStateStore((s) => s.setSelectedWorkspacePath);
  const removeSavedWorkspacePath = useUIStateStore((s) => s.removeSavedWorkspacePath);
  const setFileTreeRootPath = useUIStateStore((s) => s.setFileTreeRootPath);
  const selectedWorkspacePath = useUIStateStore((s) => s.selectedWorkspacePath);
  const fileTreeRootPath = useUIStateStore((s) => s.fileTreeRootPath);
  const triggerResetToWelcome = useUIStateStore((s) => s.triggerResetToWelcome);
  const workspacePickerDataSource = useMemo(
    () =>
      buildWorkspacePickerDataSource({
        client: createWorkspaceClient(gatewayUrl),
        token: accessToken,
      }),
    [accessToken, gatewayUrl],
  );
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

  const handleToggleRail = () => {
    if (leftSidebarOpen) {
      setLeftSidebarOpen(false);
    } else {
      setLeftSidebarOpen(true);
      if (navRailExpandedPref === null && !wideViewport) {
        toggleNavRailExpanded(wideViewport);
      }
    }
  };

  const gatewayStatusLabel: Record<GatewayStatus, string> = {
    online: '已连接',
    offline: '未连接',
    warning: '连接异常',
  };

  // ─── 会话列表数据 ───
  const {
    sessions,
    groupedSessions,
    groupedSessionTrees,
    sessionCountByWorkspace,
    workspaceSessionIdsByGroupKey,
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

  // ─── 团队会话数据 ───
  const {
    sessions: teamSessions,
    workspaceGroups: teamWorkspaceGroups,
    loading: teamLoading,
    error: teamError,
  } = useTeamSidebarSessions();

  const currentSessionId = location.pathname.split('/chat/')[1]?.split('/')[0] ?? null;
  // 仅在当前路由处于 /team 下时才读取 activeTeamSessionId。
  // CachedRouteOutlet 会缓存 TeamPageV2 组件（不卸载），导致离开 team 页面后
  // store 中的 activeTeamSessionId 不会被 cleanup 清除。如果这里无条件使用，
  // 切到 chat 页面后 team 会话行仍然高亮。
  const isTeamRoute = location.pathname.startsWith('/team');
  const storedActiveTeamSessionId = useUIStateStore((s) => s.activeTeamSessionId);
  const activeTeamSessionId = isTeamRoute ? storedActiveTeamSessionId : null;
  const lastPointerPositionRef = useRef<{ x: number; y: number } | null>(null);

  const [contextMenu, setContextMenu] = useState<{
    sessionId: string;
    x: number;
    y: number;
  } | null>(null);

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

  // ─── 团队工作区右键菜单状态 ───
  const [teamWorkspaceContextMenu, setTeamWorkspaceContextMenu] = useState<{
    workspace: { id: string; name: string };
    x: number;
    y: number;
  } | null>(null);

  // ─── 对话工作区右键菜单状态 ───
  const [chatWorkspaceContextMenu, setChatWorkspaceContextMenu] = useState<{
    workspacePath: string;
    workspaceLabel: string;
    x: number;
    y: number;
  } | null>(null);

  // ─── 团队工作区重命名状态 ───
  const [teamWorkspaceRenamingId, setTeamWorkspaceRenamingId] = useState<string | null>(null);
  const [teamWorkspaceRenameValue, setTeamWorkspaceRenameValue] = useState('');
  const [teamWorkspaceDeletingId, setTeamWorkspaceDeletingId] = useState<string | null>(null);

  const teamAccessToken = useAuthStore((s) => s.accessToken);
  const teamGatewayUrl = useAuthStore((s) => s.gatewayUrl);

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

  // ─── 团队会话操作 ───
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

  // ─── 团队工作区操作 ───
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

  // ─── 对话工作区操作 ───
  const handleChatWorkspaceContextMenu = useCallback(
    (workspacePath: string, workspaceLabel: string, x: number, y: number) => {
      setChatWorkspaceContextMenu({ workspacePath, workspaceLabel, x, y });
    },
    [],
  );

  const handleChatWorkspaceActivate = useCallback(
    (workspacePath: string) => {
      setSelectedWorkspacePath(workspacePath);
      setFileTreeRootPath(workspacePath);
    },
    [setFileTreeRootPath, setSelectedWorkspacePath],
  );

  const handleChatWorkspaceCopyPath = useCallback((workspacePath: string) => {
    void navigator.clipboard?.writeText(workspacePath);
  }, []);

  const handleChatWorkspaceRemove = useCallback(
    (workspacePath: string) => {
      removeSavedWorkspacePath(workspacePath);
    },
    [removeSavedWorkspacePath],
  );

  const triggerTeamNewSession = useUIStateStore((s) => s.triggerTeamNewSession);
  const triggerTeamSelectSession = useUIStateStore((s) => s.triggerTeamSelectSession);

  // ─── 渲染 ───
  return (
    <nav
      className="layout-app-sidebar"
      data-sidebar-expanded={expanded ? 'true' : 'false'}
      style={{
        width: sidebarWidth,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
        transition: 'width 240ms cubic-bezier(0.4, 0, 0.2, 1)',
      }}
    >
      {/* ═══ 顶部区块 ═══ */}
      <div
        style={{
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          padding: '8px 6px 6px',
          gap: 2,
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        {/* Logo + 状态 + 折叠按钮 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: expanded ? '2px 6px 6px' : '2px 4px 6px',
            minHeight: 32,
          }}
        >
          <span
            aria-label="OpenAWork"
            title={`OpenAWork · ${gatewayStatusLabel[gatewayStatus]}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flex: expanded ? 1 : undefined,
              minWidth: 0,
              color: 'var(--fg-strong)',
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: '-0.02em',
            }}
          >
            <span style={{ width: 22, height: 22, flexShrink: 0 }}>
              <BrandLogo size={22} />
            </span>
            {expanded && (
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  flex: 1,
                  minWidth: 0,
                  fontSize: 12.5,
                  fontWeight: 700,
                }}
              >
                <span
                  style={{
                    background:
                      'linear-gradient(90deg, var(--fg-strong), color-mix(in oklch, var(--fg-strong) 60%, var(--accent) 40%))',
                    WebkitBackgroundClip: 'text',
                    backgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  OpenAWork
                </span>
                {showGatewayStatusIndicator && (
                  <span
                    className="nav-rail-status-dot"
                    data-status={gatewayStatus}
                    aria-label={gatewayStatusLabel[gatewayStatus]}
                  />
                )}
              </span>
            )}
          </span>

          <button
            type="button"
            title={expanded ? '折叠侧边栏' : '展开侧边栏'}
            aria-label={expanded ? '折叠侧边栏' : '展开侧边栏'}
            aria-pressed={expanded}
            onClick={handleToggleRail}
            className="icon-btn"
            style={{
              display: 'flex',
              width: 24,
              height: 24,
              alignItems: 'center',
              justifyContent: 'center',
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
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {expanded ? (
                <>
                  <polyline points="11 17 6 12 11 7" />
                  <polyline points="18 17 13 12 18 7" />
                </>
              ) : (
                <>
                  <polyline points="13 17 18 12 13 7" />
                  <polyline points="6 17 11 12 6 7" />
                </>
              )}
            </svg>
          </button>
        </div>

        {/* 顶部导航项 */}
        {TOP_NAV_ITEMS.map((item: NavItem) => {
          const isActive = location.pathname.startsWith(item.to);
          return (
            <NavLink
              key={item.to}
              to={item.to}
              onPointerEnter={() => preloadRoute(item.to)}
              onFocus={() => preloadRoute(item.to)}
              onPointerDown={() => preloadRoute(item.to)}
              title={item.label}
              className={isActive ? 'nav-rail-btn nav-rail-link-active' : 'nav-rail-btn'}
              style={{
                ...navItemStyle,
                color: isActive ? 'var(--accent)' : 'var(--fg-muted)',
                fontWeight: isActive ? 600 : 500,
                justifyContent: expanded ? 'flex-start' : 'center',
                padding: expanded ? '0 12px' : '0',
              }}
            >
              <span className="nav-rail-icon">{railIcon(item.iconKey)}</span>
              {expanded && (
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 500,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {item.label}
                </span>
              )}
            </NavLink>
          );
        })}
      </div>

      {/* ═══ 中间区块 ═══ */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {expanded ? (
          <>
            {/* 搜索框 */}
            <div style={{ padding: '0 8px 6px', flexShrink: 0 }}>
              <input
                type="text"
                placeholder="搜索会话…"
                value={sessionSearch}
                onChange={(e) => setSessionSearch(e.target.value)}
                style={{
                  width: '100%',
                  background: 'var(--bg-overlay)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 6,
                  padding: '5px 8px',
                  fontSize: 11,
                  color: 'var(--fg-strong)',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {/* 对话工作空间标题行 + 新建工作区按钮 */}
            <div
              onClick={() => {
                if (!location.pathname.startsWith('/chat')) {
                  void navigate('/chat');
                }
                triggerResetToWelcome('chat');
              }}
              title="点击回到对话欢迎页面"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 8px 4px 8px',
                fontSize: 11,
                fontWeight: 700,
                color: 'var(--fg-muted)',
                flexShrink: 0,
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
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
              <span>对话工作空间</span>
              <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>
                {groupedSessions.length}
              </span>
              <button
                type="button"
                onClick={() => setShowWorkspacePicker(true)}
                title="新建工作区"
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

            {/* 会话列表（对话工作区，含已绑定和未绑定） */}
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
                // 从 groupedSessionTrees 中查找对应的 roots（树形结构）
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
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                      <button
                        type="button"
                        onClick={() => toggleGroupCollapsed(groupKey)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleChatWorkspaceContextMenu(
                            group.workspacePath ?? '__unbound__',
                            group.workspaceLabel,
                            e.clientX,
                            e.clientY,
                          );
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
                        {group.workspacePath && (
                          <WorkspaceGitBadge
                            workspacePath={group.workspacePath}
                            gatewayUrl={gatewayUrl}
                            accessToken={accessToken ?? ''}
                          />
                        )}
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
                      <button
                        type="button"
                        onClick={() => void newSession(group.workspacePath)}
                        title={`在 ${group.workspaceLabel} 中新建会话`}
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
                    </div>

                    {!isCollapsed && (
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
                        {roots.map((node) => (
                          <SessionSidebarSessionRow
                            key={node.session.id}
                            activeSessionId={currentSessionId ?? undefined}
                            commitRename={commitRename}
                            hoveredSessionId={hoveredSessionId}
                            isDeletingSession={isDeletingSession}
                            isPinned={isPinned}
                            node={node}
                            onHoveredSessionChange={setHoveredSessionId}
                            onOpenContextMenu={(sessionIdToOpen, x, y) => {
                              setContextMenu({ sessionId: sessionIdToOpen, x, y });
                            }}
                            onPointerPositionChange={(position) => {
                              lastPointerPositionRef.current = position;
                            }}
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
                        {group.sessions.length === 0 && (
                          <div
                            style={{
                              padding: '8px 10px 8px 8px',
                              borderRadius: 6,
                              color: 'var(--fg-muted)',
                              fontSize: 11,
                              lineHeight: 1.5,
                            }}
                          >
                            {actualSessionCount === 0
                              ? '暂无会话，可在此工作区中新建一个会话。'
                              : '当前筛选条件下暂无匹配会话。'}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* ─── 团队会话列表（按工作空间分组） ─── */}
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
              {/* 团队工作空间标题行 + 新建工作区按钮（与对话区域一致） */}
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
                  padding: '4px 8px 4px 8px',
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
                <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>
                  {teamLoading ? '…' : teamSessions.length}
                </span>
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
                  <div
                    style={{
                      padding: '6px 10px',
                      fontSize: 11,
                      color: 'var(--fg-muted)',
                    }}
                  >
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

                {/* 按工作空间分组渲染 */}
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
          </>
        ) : (
          /* 折叠模式：仅显示 + 按钮 */
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              padding: '6px 0',
              gap: 2,
            }}
          >
            <button
              type="button"
              onClick={handleNewTask}
              title="新建任务"
              className="icon-btn"
              style={{
                display: 'flex',
                width: 34,
                height: 34,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 8,
                border: 'none',
                background: 'var(--accent)',
                color: 'var(--fg-on-accent)',
                cursor: 'pointer',
              }}
            >
              <svg
                aria-hidden="true"
                width="14"
                height="14"
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
            </button>
          </div>
        )}
      </div>

      {/* ═══ 底部区块 ═══ */}
      <div className="nav-rail-divider" aria-hidden="true" />
      <div
        style={{
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
          padding: '2px 6px 6px',
        }}
      >
        {accessToken && (
          <NotificationCenter
            accessToken={accessToken}
            gatewayUrl={gatewayUrl}
            pendingPermissionIndicator={pendingPermissionIndicator}
            labelStyleOverride={
              expanded ? { display: 'block', opacity: 1 } : { display: 'none', opacity: 0 }
            }
            expanded={expanded}
          />
        )}

        {onToggleTheme && (
          <button
            type="button"
            title={theme === 'dark' ? '切换到日间模式' : '切换到夜间模式'}
            onClick={onToggleTheme}
            className="nav-rail-btn"
            style={{
              ...navItemStyle,
              border: 'none',
              cursor: 'pointer',
              justifyContent: expanded ? 'flex-start' : 'center',
              padding: expanded ? '0 12px' : '0',
            }}
          >
            <span className="nav-rail-icon">
              {theme === 'dark' ? (
                <svg
                  aria-hidden="true"
                  width="17"
                  height="17"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="4" />
                  <line x1="12" y1="2" x2="12" y2="4" />
                  <line x1="12" y1="20" x2="12" y2="22" />
                  <line x1="4.93" y1="4.93" x2="6.34" y2="6.34" />
                  <line x1="17.66" y1="17.66" x2="19.07" y2="19.07" />
                  <line x1="2" y1="12" x2="4" y2="12" />
                  <line x1="20" y1="12" x2="22" y2="12" />
                  <line x1="4.93" y1="19.07" x2="6.34" y2="17.66" />
                  <line x1="17.66" y1="6.34" x2="19.07" y2="4.93" />
                </svg>
              ) : (
                <svg
                  aria-hidden="true"
                  width="17"
                  height="17"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
              )}
            </span>
            {expanded && (
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 500,
                  whiteSpace: 'nowrap',
                }}
              >
                {theme === 'dark' ? '日间' : '夜间'}
              </span>
            )}
          </button>
        )}

        {BOTTOM_NAV_ITEMS.map((item: NavItem) => (
          <NavLink
            key={item.to}
            to={item.to}
            onPointerEnter={() => preloadRoute(item.to)}
            onFocus={() => preloadRoute(item.to)}
            onPointerDown={() => preloadRoute(item.to)}
            title={item.label}
            className={({ isActive }) =>
              isActive ? 'nav-rail-btn nav-rail-link-active' : 'nav-rail-btn'
            }
            style={({ isActive }) => ({
              ...navItemStyle,
              color: isActive ? 'var(--accent)' : 'var(--fg-muted)',
              fontWeight: isActive ? 600 : 500,
              justifyContent: expanded ? 'flex-start' : 'center',
              padding: expanded ? '0 12px' : '0',
            })}
          >
            <span className="nav-rail-icon">{railIcon(item.iconKey)}</span>
            {expanded && (
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 500,
                  whiteSpace: 'nowrap',
                }}
              >
                {item.label}
              </span>
            )}
          </NavLink>
        ))}

        {onLogout && (
          <button
            type="button"
            title="退出登录"
            className="nav-rail-logout"
            onClick={onLogout}
            style={{
              ...navItemStyle,
              border: 'none',
              cursor: 'pointer',
              justifyContent: expanded ? 'flex-start' : 'center',
              padding: expanded ? '0 12px' : '0',
            }}
          >
            <span className="nav-rail-icon">
              <svg
                aria-hidden="true"
                width="17"
                height="17"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </span>
            {expanded && (
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 500,
                  whiteSpace: 'nowrap',
                }}
              >
                退出
              </span>
            )}
          </button>
        )}
      </div>

      {/* 右键菜单 Portal */}
      {contextMenu &&
        createPortal(
          (() => {
            const ctxSession = sessions.find((s) => s.id === contextMenu.sessionId);
            const pinned = ctxSession ? isPinned(ctxSession.id) : false;
            return (
              <SessionContextMenu
                sessionId={contextMenu.sessionId}
                sessionTitle={ctxSession?.title ?? null}
                x={contextMenu.x}
                y={contextMenu.y}
                isPinned={pinned}
                hasMessages
                onClose={() => setContextMenu(null)}
                onRename={() => {
                  if (ctxSession) startRename(ctxSession);
                }}
                onExportMarkdown={() => exportSessionAsMarkdown(contextMenu.sessionId)}
                onExportJson={() => exportSessionAsJson(contextMenu.sessionId)}
                onClearMessages={() => alert('清空功能开发中')}
                onPin={() => togglePinSession(contextMenu.sessionId)}
                onDelete={() => void quickDeleteSession(contextMenu.sessionId)}
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

      {/* 对话工作区右键菜单 Portal */}
      {chatWorkspaceContextMenu &&
        createPortal(
          <ChatWorkspaceContextMenu
            workspacePath={chatWorkspaceContextMenu.workspacePath}
            workspaceLabel={chatWorkspaceContextMenu.workspaceLabel}
            x={chatWorkspaceContextMenu.x}
            y={chatWorkspaceContextMenu.y}
            isUnbound={chatWorkspaceContextMenu.workspacePath === '__unbound__'}
            isActive={selectedWorkspacePath === chatWorkspaceContextMenu.workspacePath}
            onClose={() => setChatWorkspaceContextMenu(null)}
            onActivate={() => handleChatWorkspaceActivate(chatWorkspaceContextMenu.workspacePath)}
            onCopyPath={() => handleChatWorkspaceCopyPath(chatWorkspaceContextMenu.workspacePath)}
            onRemove={() => handleChatWorkspaceRemove(chatWorkspaceContextMenu.workspacePath)}
          />,
          document.body,
        )}

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
    </nav>
  );
}
