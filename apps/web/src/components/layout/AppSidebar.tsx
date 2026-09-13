import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { NavLink, useLocation } from 'react-router';
import { createWorkspaceClient } from '@openAwork/web-client';
import {
  navItemStyle,
  useAppSidebarNavigation,
  useGatewayStatus,
  useWideViewport,
} from './app-sidebar/app-sidebar-hooks.js';
import type { GatewayStatus } from './app-sidebar/app-sidebar-hooks.js';
import { AppSidebarTeamMenus } from './app-sidebar/AppSidebarTeamMenus.js';
import { useChatWorkspaceActions } from './app-sidebar/use-chat-workspace-actions.js';
import { BrandLogo } from '@openAwork/shared-ui';
import { TOP_NAV_ITEMS, BOTTOM_NAV_ITEMS, railIcon } from './nav/RailIcon.js';
import type { NavItem } from './nav/RailIcon.js';
import { useUIStateStore } from '../../stores/ui/uiState.js';
import { useDisplayPreferencesStore } from '../../stores/settings/display-preferences.js';
import { useSessions } from '../../hooks/workspace/useSessions.js';
import { useTeamSidebarSessions } from '../../hooks/workspace/useTeamSidebarSessions.js';
import NotificationCenter from './notification/NotificationCenter.js';
import { SessionSidebarSessionRow } from './sidebar/SessionSidebarSessionRow.js';
import { useSidebarTeamActions } from './sidebar/use-sidebar-team-actions.js';
import { AppSidebarTeamGroupSection } from './app-sidebar/AppSidebarTeamGroupSection.js';
import { WorkspaceGitBadge } from './sidebar/SidebarHelpers.js';
import SessionContextMenu from './sidebar/SessionContextMenu.js';
import TeamSessionContextMenu from './sidebar/TeamSessionContextMenu.js';
import TeamWorkspaceContextMenu from './sidebar/TeamWorkspaceContextMenu.js';
import ChatWorkspaceContextMenu from './sidebar/ChatWorkspaceContextMenu.js';
import { getWorkspaceGroupKey } from '../../utils/session/session-grouping.js';
import WorkspacePickerModal from '../common/modal/WorkspacePickerModal.js';
import { buildWorkspacePickerDataSource } from '../common/modal/workspace-picker-data-source.js';
import { buildTeamSessionRoute } from '../../utils/session/team-session-route.js';

const SIDEBAR_WIDTH = 260;
const COLLAPSED_WIDTH = 56;

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
  const {
    navigate,
    preloadRoute,
    preloadChatRoute,
    openChatSession,
    handleNewTask,
    handleNewTeamWorkspace,
  } = useAppSidebarNavigation();
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
  const togglePinSession = useUIStateStore((state) => state.togglePinSession);
  const isPinned = useUIStateStore((state) => state.isPinned);
  const collapsedSessionGroups = useUIStateStore((s) => s.collapsedSessionGroups);
  const toggleSessionGroupCollapsed = useUIStateStore((s) => s.toggleSessionGroupCollapsed);
  const chatSectionCollapsed = collapsedSessionGroups.includes('section:chat');
  const teamSectionCollapsed = collapsedSessionGroups.includes('section:team');

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

  // ─── 底部更多菜单状态 ───
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);
  const moreBtnRef = useRef<HTMLButtonElement | null>(null);
  const [moreMenuPos, setMoreMenuPos] = useState<{ bottom: number; left: number } | null>(null);

  useEffect(() => {
    if (!showMoreMenu) {
      setMoreMenuPos(null);
      return;
    }
    const btn = moreBtnRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const MENU_WIDTH = 180;
    const MARGIN = 8;
    // 水平居中于按钮，但不超出视口
    let left = rect.left + rect.width / 2;
    if (left - MENU_WIDTH / 2 < MARGIN) {
      left = MARGIN + MENU_WIDTH / 2;
    } else if (left + MENU_WIDTH / 2 > window.innerWidth - MARGIN) {
      left = window.innerWidth - MARGIN - MENU_WIDTH / 2;
    }
    setMoreMenuPos({
      bottom: window.innerHeight - rect.top + 4,
      left,
    });
    const handleResize = () => {
      const r = btn.getBoundingClientRect();
      let l = r.left + r.width / 2;
      if (l - MENU_WIDTH / 2 < MARGIN) {
        l = MARGIN + MENU_WIDTH / 2;
      } else if (l + MENU_WIDTH / 2 > window.innerWidth - MARGIN) {
        l = window.innerWidth - MARGIN - MENU_WIDTH / 2;
      }
      setMoreMenuPos({
        bottom: window.innerHeight - r.top + 4,
        left: l,
      });
    };
    window.addEventListener('resize', handleResize);
    window.addEventListener('scroll', handleResize, true);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('scroll', handleResize, true);
    };
  }, [showMoreMenu]);

  useEffect(() => {
    if (!showMoreMenu) return;
    const handlePointerDown = (e: MouseEvent) => {
      const menu = moreMenuRef.current;
      const btn = moreBtnRef.current;
      if (
        menu &&
        e.target instanceof Node &&
        !menu.contains(e.target) &&
        btn &&
        !btn.contains(e.target)
      ) {
        setShowMoreMenu(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowMoreMenu(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showMoreMenu]);

  const [contextMenu, setContextMenu] = useState<{
    sessionId: string;
    x: number;
    y: number;
  } | null>(null);

  const {
    sessionMenu: teamContextMenu,
    workspaceMenu: teamWorkspaceContextMenu,
    renamingSessionId: teamRenamingSessionId,
    renameValue: teamRenameValue,
    setRenameValue: setTeamRenameValue,
    deletingSessionId: teamDeletingSessionId,
    workspaceRenamingId: teamWorkspaceRenamingId,
    workspaceRenameValue: teamWorkspaceRenameValue,
    setWorkspaceRenameValue: setTeamWorkspaceRenameValue,
    workspaceDeletingId: teamWorkspaceDeletingId,
    openSessionMenu: handleTeamSessionContextMenu,
    closeSessionMenu: closeTeamSessionMenu,
    startSessionRename: handleTeamRename,
    commitSessionRename: handleTeamRenameCommit,
    toggleSessionPause: handleTeamTogglePause,
    copySessionId: handleTeamCopyId,
    deleteSession: handleTeamDelete,
    openWorkspaceMenu: handleTeamWorkspaceContextMenu,
    closeWorkspaceMenu: closeTeamWorkspaceMenu,
    startWorkspaceRename: handleTeamWorkspaceRename,
    commitWorkspaceRename: handleTeamWorkspaceRenameCommit,
    copyWorkspaceId: handleTeamWorkspaceCopyId,
    deleteWorkspace: handleTeamWorkspaceDelete,
  } = useSidebarTeamActions();

  const {
    chatWorkspaceContextMenu,
    openChatWorkspaceMenu: handleChatWorkspaceContextMenu,
    closeChatWorkspaceMenu: closeChatWorkspaceMenu,
    activateChatWorkspace: handleChatWorkspaceActivate,
    copyChatWorkspacePath: handleChatWorkspaceCopyPath,
    removeChatWorkspace: handleChatWorkspaceRemove,
  } = useChatWorkspaceActions();

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

            {/* 对话工作空间标题行：点击折叠/展开会话列表 */}
            <div
              role="button"
              tabIndex={0}
              aria-expanded={!chatSectionCollapsed}
              onClick={() => toggleSessionGroupCollapsed('section:chat')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  toggleSessionGroupCollapsed('section:chat');
                }
              }}
              title={chatSectionCollapsed ? '展开会话列表' : '折叠会话列表'}
              className="sidebar-group-toggle"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 8px 4px 8px',
                fontSize: 11,
                fontWeight: 700,
                color: 'var(--fg-default)',
                flexShrink: 0,
                cursor: 'pointer',
                borderRadius: 6,
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
                  transform: chatSectionCollapsed ? 'rotate(0deg)' : 'rotate(90deg)',
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
              <span>对话工作空间</span>
              <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>
                {groupedSessions.length}
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void newSession();
                }}
                title="新建会话"
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
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowWorkspacePicker(true);
                }}
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
                display: chatSectionCollapsed ? 'none' : 'flex',
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
                const groupBodyId = `app-session-group-${encodeURIComponent(groupKey)}`;
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
                        className="sidebar-group-toggle"
                        aria-expanded={!isCollapsed}
                        aria-controls={groupBodyId}
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

                    <div
                      id={groupBodyId}
                      style={{
                        display: isCollapsed ? 'none' : 'flex',
                        marginLeft: 16,
                        marginTop: 2,
                        borderLeft: '1px solid var(--border-subtle)',
                        paddingLeft: 4,
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
                  </div>
                );
              })}
            </div>

            {/* ─── 团队会话列表（按工作空间分组） ─── */}
            <div
              style={{
                // 折叠后不再参与空间分配，把剩余空间让给对话列表
                flexGrow: teamSectionCollapsed ? 0 : 1,
                flexShrink: 1,
                flexBasis: teamSectionCollapsed ? 'auto' : '0%',
                minHeight: 0,
                display: 'flex',
                flexDirection: 'column',
                marginTop: 6,
                paddingTop: 6,
                borderTop: '1px solid var(--border-subtle)',
              }}
            >
              {/* 团队工作空间标题行：点击折叠/展开团队会话列表 */}
              <div
                role="button"
                tabIndex={0}
                aria-expanded={!teamSectionCollapsed}
                onClick={() => toggleSessionGroupCollapsed('section:team')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleSessionGroupCollapsed('section:team');
                  }
                }}
                title={teamSectionCollapsed ? '展开团队会话列表' : '折叠团队会话列表'}
                className="sidebar-group-toggle"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 8px 4px 8px',
                  fontSize: 11,
                  fontWeight: 700,
                  color: 'var(--fg-default)',
                  cursor: 'pointer',
                  borderRadius: 6,
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
                    transform: teamSectionCollapsed ? 'rotate(0deg)' : 'rotate(90deg)',
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
                  display: teamSectionCollapsed ? 'none' : undefined,
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
                  <AppSidebarTeamGroupSection
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
                      void navigate(buildTeamSessionRoute(wsId, sessionId));
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
        <button
          ref={moreBtnRef}
          type="button"
          title="更多选项"
          aria-label="更多选项"
          aria-pressed={showMoreMenu}
          onClick={() => setShowMoreMenu((v) => !v)}
          className="nav-rail-btn"
          style={{
            ...navItemStyle,
            border: 'none',
            cursor: 'pointer',
            justifyContent: expanded ? 'flex-start' : 'center',
            padding: expanded ? '0 12px' : '0',
            color: showMoreMenu ? 'var(--accent)' : 'var(--fg-muted)',
            background: showMoreMenu
              ? 'color-mix(in oklch, var(--accent) 12%, transparent)'
              : 'transparent',
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
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="5" r="1" fill="currentColor" />
              <circle cx="12" cy="12" r="1" fill="currentColor" />
              <circle cx="12" cy="19" r="1" fill="currentColor" />
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
              更多
            </span>
          )}
        </button>

        {/* ── 弹出菜单 ── */}
        {showMoreMenu &&
          moreMenuPos &&
          createPortal(
            <div
              ref={moreMenuRef}
              style={{
                position: 'fixed',
                bottom: moreMenuPos.bottom,
                left: moreMenuPos.left,
                transform: 'translateX(-50%)',
                zIndex: 9999,
                minWidth: 180,
                background: 'var(--bg-raised, var(--bg-base))',
                border: '1px solid var(--border-default)',
                borderRadius: 10,
                boxShadow: '0 8px 30px rgba(0,0,0,0.25)',
                padding: '4px',
                display: 'flex',
                flexDirection: 'column',
                gap: 1,
              }}
            >
              {/* 通知 */}
              <NavLink
                to="/settings/notification"
                onClick={() => setShowMoreMenu(false)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--fg-default)',
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: 'pointer',
                  textAlign: 'left',
                  textDecoration: 'none',
                  boxSizing: 'border-box',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--bg-overlay)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                <span
                  style={{
                    display: 'flex',
                    width: 18,
                    height: 18,
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                  </svg>
                </span>
                <span>通知</span>
              </NavLink>

              {/* 主题切换 */}
              {onToggleTheme && (
                <button
                  type="button"
                  onClick={() => {
                    onToggleTheme();
                    setShowMoreMenu(false);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 8,
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--fg-default)',
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: 'pointer',
                    textAlign: 'left',
                    boxSizing: 'border-box',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--bg-overlay)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                  }}
                >
                  <span
                    style={{
                      display: 'flex',
                      width: 18,
                      height: 18,
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    {theme === 'dark' ? (
                      <svg
                        width="16"
                        height="16"
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
                        width="16"
                        height="16"
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
                  <span>{theme === 'dark' ? '切换日间模式' : '切换夜间模式'}</span>
                </button>
              )}

              {/* 设置 */}
              {BOTTOM_NAV_ITEMS.map((item: NavItem) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={() => setShowMoreMenu(false)}
                  onPointerEnter={() => preloadRoute(item.to)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 8,
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--fg-default)',
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: 'pointer',
                    textAlign: 'left',
                    textDecoration: 'none',
                    boxSizing: 'border-box',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--bg-overlay)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                  }}
                >
                  <span
                    style={{
                      display: 'flex',
                      width: 18,
                      height: 18,
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    {railIcon(item.iconKey)}
                  </span>
                  <span>{item.label}</span>
                </NavLink>
              ))}

              {/* 分割线 */}
              {onLogout && (
                <div style={{ height: 1, background: 'var(--border-subtle)', margin: '2px 8px' }} />
              )}

              {/* 退出 */}
              {onLogout && (
                <button
                  type="button"
                  onClick={() => {
                    setShowMoreMenu(false);
                    onLogout();
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 8,
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--danger, #ef4444)',
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: 'pointer',
                    textAlign: 'left',
                    boxSizing: 'border-box',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--bg-overlay)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                  }}
                >
                  <span
                    style={{
                      display: 'flex',
                      width: 18,
                      height: 18,
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <svg
                      width="16"
                      height="16"
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
                  <span>退出登录</span>
                </button>
              )}
            </div>,
            document.body,
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

      {/* 团队会话 / 团队工作区右键菜单 Portal */}
      <AppSidebarTeamMenus
        sessionMenu={teamContextMenu}
        workspaceMenu={teamWorkspaceContextMenu}
        renamingSessionId={teamRenamingSessionId}
        deletingSessionId={teamDeletingSessionId}
        workspaceRenamingId={teamWorkspaceRenamingId}
        workspaceDeletingId={teamWorkspaceDeletingId}
        onCloseSessionMenu={closeTeamSessionMenu}
        onRenameSession={handleTeamRename}
        onToggleSessionPause={(sessionId, stateStatus) =>
          void handleTeamTogglePause(sessionId, stateStatus)
        }
        onCopySessionId={handleTeamCopyId}
        onDeleteSession={(sessionId) => void handleTeamDelete(sessionId)}
        onCloseWorkspaceMenu={closeTeamWorkspaceMenu}
        onRenameWorkspace={handleTeamWorkspaceRename}
        onCopyWorkspaceId={handleTeamWorkspaceCopyId}
        onDeleteWorkspace={(workspaceId) => void handleTeamWorkspaceDelete(workspaceId)}
      />

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
            onClose={closeChatWorkspaceMenu}
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
