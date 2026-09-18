/**
 * FusionSidebar — 融合布局专用侧边栏。
 *
 * S2 方案：Rail(64px 固定) + Panel(244px 可折叠) 物理分离。
 * 只在 fusion 模式下使用，不影响 classic 模式的 AppSidebar。
 *
 * Rail: 项目头像 + Chat/Team + 功能导航 + 底部图标
 * Panel: 项目名 + 搜索 + 会话列表 + 新建按钮
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router';
import { createWorkspaceClient } from '@openAwork/web-client';
import { InlineEditor } from '@openAwork/shared-ui';
import {
  SIDEBAR_PANEL_WIDTH_BOUNDS,
  clampSidebarPanelWidth,
  useUIStateStore,
} from '../../../stores/ui/uiState.js';
import { useSessions } from '../../../hooks/workspace/useSessions.js';
import { useTeamSidebarSessions } from '../../../hooks/workspace/useTeamSidebarSessions.js';
import SessionContextMenu from '../sidebar/SessionContextMenu.js';
import TeamSessionContextMenu from '../sidebar/TeamSessionContextMenu.js';
import TeamWorkspaceContextMenu from '../sidebar/TeamWorkspaceContextMenu.js';
import {
  filterSessionTreeGroupsByMatcher,
  getWorkspaceGroupKey,
} from '../../../utils/session/session-grouping.js';
import { preloadRouteModuleByPath } from '../../../routes/preloadable-route-modules.js';
import { getPathBasename } from '../../../utils/workspace-path.js';
import { readWorkspaceAlias, writeWorkspaceAlias } from '../../../utils/workspace-alias.js';
import { buildTeamSessionRoute } from '../../../utils/session/team-session-route.js';
import WorkspacePickerModal from '../../common/modal/WorkspacePickerModal.js';
import { buildWorkspacePickerDataSource } from '../../common/modal/workspace-picker-data-source.js';
import { SidebarRailV2 } from './SidebarRailV2.js';
import { FusionSidebarPeek } from './FusionSidebarPeek.js';
import { ResizeHandle } from '../shared/resize-handle.js';
import { FusionSidebarChatGroupSection } from './FusionSidebarChatGroupSection.js';
import type { FusionChatSessionRowHandlers } from './FusionSidebarChatGroupSection.js';
import { FusionSidebarListState, FusionSidebarSkeleton } from './FusionSidebarListStates.js';
import { FusionSidebarTeamGroupSection } from './FusionSidebarTeamGroupSection.js';
import { useScrollActiveSessionIntoView } from '../sidebar/use-scroll-active-session.js';
import { useSessionContentSearch } from '../sidebar/use-session-content-search.js';
import { buildFusionChatGroups } from './fusion-sidebar-session-groups.js';
import { useSidebarTeamActions } from '../sidebar/use-sidebar-team-actions.js';
import '../sidebar/sidebar-interactions.css';

export interface FusionSidebarProps {
  readonly accessToken: string | null;
  readonly gatewayUrl: string;
  readonly theme?: 'dark' | 'light';
  readonly onToggleTheme?: () => void;
  readonly onLogout?: () => void;
  readonly pendingPermissionIndicator?: boolean;
}

/** Rail 固定宽度（Peek 定位与手柄偏移都依赖它） */
const RAIL_WIDTH = 64;
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
  padding: '5px 22px 5px 8px',
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
  fontSize: 12,
  fontWeight: 700,
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
  const sidebarPanelWidth = useUIStateStore((s) => s.sidebarPanelWidth);
  const setSidebarPanelWidth = useUIStateStore((s) => s.setSidebarPanelWidth);
  // 拖拽中的宽度只存在本地 state：拖拽实时生效，松手才写回 store 持久化。
  const [resizingPanelWidth, setResizingPanelWidth] = useState<number | null>(null);
  const panelWidth = resizingPanelWidth ?? sidebarPanelWidth;
  const isResizingPanel = resizingPanelWidth !== null;
  const peekCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panelContainerRef = useRef<HTMLDivElement>(null);
  const sessionListRef = useRef<HTMLDivElement>(null);

  // 工作区显示别名：localStorage 持久化，key = 'ws-alias:' + path
  // （读写实现与标题栏共用 utils/workspace-alias，写入时会广播变更）
  const [workspaceAlias, setWorkspaceAlias] = useState<string>(() =>
    readWorkspaceAlias(selectedWorkspacePath),
  );

  // 当 selectedWorkspacePath 变化时，从 localStorage 重新读取别名
  useEffect(() => {
    setWorkspaceAlias(readWorkspaceAlias(selectedWorkspacePath));
  }, [selectedWorkspacePath]);

  const handleWorkspaceAliasChange = useCallback(
    (newAlias: string): void => {
      if (!selectedWorkspacePath) return;
      setWorkspaceAlias(newAlias);
      writeWorkspaceAlias(selectedWorkspacePath, newAlias);
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
    sessionTreeGroups,
    sessionCountByWorkspace,
    isLoadingSessions,
    sessionsError,
    fetchSessions,
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
    refresh: refreshTeamSessions,
  } = useTeamSidebarSessions();

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

  const currentSessionId = location.pathname.split('/chat/')[1]?.split('/')[0] ?? null;
  const isTeamRoute = location.pathname.startsWith('/team');
  const storedActiveTeamSessionId = useUIStateStore((s) => s.activeTeamSessionId);
  const activeTeamSessionId = isTeamRoute ? storedActiveTeamSessionId : null;
  const activeSessionId = currentSessionId ?? activeTeamSessionId;
  useScrollActiveSessionIntoView(sessionListRef, activeSessionId);
  const expanded = leftSidebarOpen && !compactViewport;
  const isSearchingSessions = sessionSearch.trim().length > 0;
  const contentSearch = useSessionContentSearch(isTeamRoute ? '' : sessionSearch);
  const contentMatchedSessionIds = contentSearch.matchedSessionIds;
  // 搜索态：标题命中 ∪ 消息内容命中；非搜索态直接使用全量会话树。
  const searchedSessionTreeGroups = useMemo(() => {
    if (!isSearchingSessions) {
      return sessionTreeGroups;
    }

    const normalizedQuery = sessionSearch.trim().toLowerCase();
    return filterSessionTreeGroupsByMatcher(
      sessionTreeGroups,
      (session) =>
        (session.title ?? session.id).toLowerCase().includes(normalizedQuery) ||
        contentMatchedSessionIds.has(session.id),
    ).filter((group) => group.sessions.length > 0);
  }, [contentMatchedSessionIds, isSearchingSessions, sessionSearch, sessionTreeGroups]);
  const chatGroups = useMemo(
    () =>
      buildFusionChatGroups({
        groupedSessions,
        groupedSessionTrees: searchedSessionTreeGroups,
        sessionCountByWorkspace,
        isSearching: isSearchingSessions,
        isPinned,
      }),
    [
      groupedSessions,
      isPinned,
      isSearchingSessions,
      searchedSessionTreeGroups,
      sessionCountByWorkspace,
    ],
  );
  const chatSessionNodes = useMemo(() => chatGroups.flatMap((group) => group.roots), [chatGroups]);
  const peekSessionNodes = useMemo(() => {
    const peekGroupKey = getWorkspaceGroupKey(peekWorkspacePath);
    const treeGroup = searchedSessionTreeGroups.find(
      (group) => getWorkspaceGroupKey(group.workspacePath) === peekGroupKey,
    );
    return treeGroup?.roots ?? chatSessionNodes;
  }, [chatSessionNodes, searchedSessionTreeGroups, peekWorkspacePath]);

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

  const handleNewTeamSession = useCallback(
    (workspaceId: string) => {
      preloadRoute('/team');
      triggerTeamNewSession(workspaceId);
      void navigate(`/team/${workspaceId}`);
    },
    [navigate, preloadRoute, triggerTeamNewSession],
  );

  const handleTeamSelectSession = useCallback(
    (workspaceId: string, sessionId: string) => {
      preloadRoute('/team');
      triggerTeamSelectSession(workspaceId, sessionId);
      void navigate(buildTeamSessionRoute(workspaceId, sessionId));
    },
    [navigate, preloadRoute, triggerTeamSelectSession],
  );

  const handlePointerPositionChange = useCallback(
    (_position: { x: number; y: number } | null) => undefined,
    [],
  );

  const handlePanelWidthChange = useCallback((width: number) => {
    setResizingPanelWidth(width);
  }, []);

  const handlePanelWidthCommit = useCallback(
    (width: number) => {
      setResizingPanelWidth(null);
      setSidebarPanelWidth(width);
    },
    [setSidebarPanelWidth],
  );

  // 会话列表键盘导航：↑ / ↓ 在会话行之间移动焦点，Enter 由行自身处理打开。
  const handleSessionListKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
      return;
    }

    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement && activeElement.closest('input, textarea')) {
      return;
    }

    const rows = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[data-session-id]'));
    if (rows.length === 0) {
      return;
    }

    const currentIndex = rows.findIndex(
      (row) => row === activeElement || row.contains(activeElement),
    );
    const nextIndex =
      event.key === 'ArrowDown'
        ? currentIndex < 0
          ? 0
          : Math.min(currentIndex + 1, rows.length - 1)
        : currentIndex < 0
          ? rows.length - 1
          : Math.max(currentIndex - 1, 0);
    const nextRow = rows[nextIndex];
    if (!nextRow) {
      return;
    }

    event.preventDefault();
    nextRow.focus();
  }, []);

  const chatRowHandlers = useMemo<FusionChatSessionRowHandlers>(
    () => ({
      activeSessionId: currentSessionId,
      commitRename,
      contentMatchedSessionIds,
      hoveredSessionId,
      isDeletingSession,
      isPinned,
      onHoveredSessionChange: setHoveredSessionId,
      onOpenContextMenu: handleSessionContextMenu,
      onPointerPositionChange: handlePointerPositionChange,
      openChatSession,
      preloadChatRoute,
      quickDeleteSession,
      quickExportSession,
      renameValue,
      renamingSessionId,
      searchQuery: isSearchingSessions ? sessionSearch : '',
      setRenameValue,
      startRename,
    }),
    [
      commitRename,
      contentMatchedSessionIds,
      currentSessionId,
      handlePointerPositionChange,
      handleSessionContextMenu,
      hoveredSessionId,
      isDeletingSession,
      isPinned,
      isSearchingSessions,
      openChatSession,
      preloadChatRoute,
      quickDeleteSession,
      quickExportSession,
      renameValue,
      renamingSessionId,
      sessionSearch,
      setHoveredSessionId,
      setRenameValue,
      startRename,
    ],
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
                className="sidebar-icon-button"
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
                  className="sidebar-icon-button"
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
                className="sidebar-icon-button"
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
                  className="sidebar-icon-button"
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
        <div style={{ padding: '6px 8px', flexShrink: 0, position: 'relative' }}>
          <input
            type="text"
            placeholder={isTeamRoute ? '搜索工作空间…' : '搜索会话…'}
            value={isTeamRoute ? teamSearch : sessionSearch}
            onChange={(e) =>
              isTeamRoute ? setTeamSearch(e.target.value) : setSessionSearch(e.target.value)
            }
            style={SEARCH_STYLE}
          />
          {(isTeamRoute ? teamSearch : sessionSearch).length > 0 ? (
            <button
              type="button"
              className="sidebar-search-clear"
              aria-label="清除搜索"
              title="清除搜索"
              onClick={() => (isTeamRoute ? setTeamSearch('') : setSessionSearch(''))}
            >
              <svg
                aria-hidden="true"
                width="12"
                height="12"
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
          ) : null}
        </div>

        <div
          ref={sessionListRef}
          onKeyDown={handleSessionListKeyDown}
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
              {teamError ? (
                <FusionSidebarListState
                  title={teamError}
                  hint="网络恢复后可以重试"
                  actionLabel="重试"
                  onAction={refreshTeamSessions}
                />
              ) : null}
              {teamLoading && !teamError && teamWorkspaceGroups.length === 0 ? (
                <FusionSidebarSkeleton />
              ) : null}
              {!teamLoading && !teamError && teamWorkspaceGroups.length === 0 ? (
                <FusionSidebarListState
                  title="暂无团队工作空间"
                  hint="新建工作空间后即可开始协作"
                />
              ) : null}
              {!teamLoading &&
              !teamError &&
              teamWorkspaceGroups.length > 0 &&
              filteredTeamGroups.length === 0 ? (
                <FusionSidebarListState title="无匹配结果" hint="换个关键词试试" />
              ) : null}
              {filteredTeamGroups.map((wg) => (
                <FusionSidebarTeamGroupSection
                  key={wg.id}
                  group={wg}
                  activeTeamSessionId={activeTeamSessionId}
                  preloadRoute={preloadRoute}
                  navigate={navigate}
                  onSelectSession={handleTeamSelectSession}
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
              {sessionsError ? (
                <FusionSidebarListState
                  title={sessionsError}
                  hint="网络恢复后可以重试"
                  actionLabel="重试"
                  onAction={() => void fetchSessions()}
                />
              ) : null}
              {isLoadingSessions && !sessionsError && chatGroups.length === 0 ? (
                <FusionSidebarSkeleton />
              ) : null}
              {!isLoadingSessions && !sessionsError && chatGroups.length === 0 ? (
                isSearchingSessions ? (
                  <FusionSidebarListState title="无匹配会话" hint="换个关键词试试" />
                ) : (
                  <FusionSidebarListState
                    title="暂无会话"
                    hint="新建一个会话开始工作"
                    actionLabel="立即新建"
                    onAction={handleNewTask}
                  />
                )
              ) : null}
              <FusionSidebarChatGroupSection
                groups={chatGroups}
                collapsedGroups={collapsedGroups}
                isSearching={isSearchingSessions}
                toggleGroupCollapsed={toggleGroupCollapsed}
                onCreateSession={(workspacePath) => void newSession(workspacePath)}
                rowHandlers={chatRowHandlers}
              />
            </>
          )}
        </div>
      </div>

      {/* 新建会话 / 新建工作空间 */}
      <button
        type="button"
        className="sidebar-primary-action"
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
          width={panelWidth}
          workspacePath={peekWorkspacePath}
        />
      ) : null}

      {/* Panel */}
      {!compactViewport ? (
        <>
          <div
            ref={panelContainerRef}
            data-fusion-sidebar-panel="true"
            style={{
              ...PANEL_STYLE,
              width: expanded ? panelWidth : 0,
              // 拖拽期间禁用宽度过渡，保证跟手
              transition: isResizingPanel ? 'none' : PANEL_STYLE.transition,
            }}
            aria-hidden={expanded ? undefined : true}
          >
            {panelContent}
          </div>
          {expanded ? (
            <div
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: RAIL_WIDTH + panelWidth,
                width: 0,
                zIndex: 5,
              }}
            >
              <ResizeHandle
                width={panelWidth}
                bounds={SIDEBAR_PANEL_WIDTH_BOUNDS}
                clamp={clampSidebarPanelWidth}
                ariaLabel="调整会话侧栏宽度"
                onWidthChange={handlePanelWidthChange}
                onWidthCommit={handlePanelWidthCommit}
              />
            </div>
          ) : null}
        </>
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
            onClose={closeTeamSessionMenu}
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
            onClose={closeTeamWorkspaceMenu}
            onRename={() => handleTeamWorkspaceRename(teamWorkspaceContextMenu.workspace)}
            onCopyId={() => handleTeamWorkspaceCopyId(teamWorkspaceContextMenu.workspace.id)}
            onDelete={() => void handleTeamWorkspaceDelete(teamWorkspaceContextMenu.workspace.id)}
          />,
          document.body,
        )}
    </div>
  );
}
