/**
 * 260516-team-page-v2 · TeamPage V2 入口（使用项目标准容器约定）
 *
 * 容器约定：
 *   - 顶层 `.page-root`（项目约定的 CSS 类）：`flex: 1; min-height: 0; height: 100%; display: flex; flex-direction: column; overflow: hidden;`
 *   - 内部布局：grid 横向三栏（左会话栏 / 中对话区 / 右面板），上方加 `.page-header` 页头
 *
 * 整体布局（桌面端）：
 *
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │ .page-header（44px）：团队 · 工作区 / 当前会话 · 状态栏 · 暂停    │
 *   ├────────┬───────────────────────────────────────────────────────┤
 *   │        │                                                       │
 *   │ 左侧    │  ConversationArea / 主 tab 内容                        │
 *   │ 会话栏  │   - 主 tab 栏（5 主分类 + 3D 入口）                    │
 *   │ 240    │   - 子 tab segmented                                   │
 *   │ 可折叠  │   - 中央内容区（设置等原右侧面板内容已并入子 tab）     │
 *   │        │                                                       │
 *   │        ├───────────────────────────────────────────────────────┤
 *   │        │ MessageInput（粘底）                                   │
 *   └────────┴───────────────────────────────────────────────────────┘
 *
 * 三态：
 *   - idle：无活跃 handoff，对话区显示引导文案
 *   - running：默认布局
 *   - paused：状态栏标记 + 浮动恢复条（不再用单独大横幅）
 *
 * 响应式：
 *   - mobile <768：左侧会话栏抽屉化、3D 隐藏、右侧面板默认折叠
 *   - tablet 768-1023：左侧会话栏 200px，右侧覆盖式
 *   - desktop ≥1024：完整三栏
 *
 * `/team` 主入口现已直接收敛到 TeamPageV2。
 */

import {
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type MouseEvent,
} from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router';
// 团队页专属样式（team-v2-* / 局部 keyframes）— 入口处一次性挂载
import '../runtime/styles/team-runtime.css';
import {
  TeamRuntimeReferenceDataProvider,
  useResolvedTeamRuntimeReferenceData,
} from '../runtime/data/team-runtime-reference-data.js';
import { useTeamWorkspaceState } from '../hooks/use-team-workspace-state.js';
import { useTeamWorkspaceSnapshotState } from '../hooks/use-team-workspace-snapshot-state.js';
import { ConversationArea } from '../runtime/shell/controls/ConversationArea.js';
import { TeamConversationView } from '../conversation/TeamConversationView.js';
import { useMultiSessionAttach } from '../../../stores/team/use-multi-session-attach.js';
import { TeamStatusBar } from '../runtime/shell/header/TeamStatusBar.js';
import {
  PauseConfirmDialog,
  ResumeStaleDialog,
} from '../runtime/shell/controls/PauseResumeControls.js';
import { LayerConversationDrawer } from '../runtime/shell/session-view/LayerConversationDrawer.js';
import { useTeamSessionListRuntimeState } from '../runtime/shell/sidebar/use-team-session-list-runtime-state.js';
import { NewTeamWorkspaceModal } from '../runtime/shell/modals/NewTeamWorkspaceModal.js';
import { ConfirmDeleteWorkspaceModal } from '../runtime/shell/modals/ConfirmDeleteWorkspaceModal.js';
import { NewTeamSessionModal } from '../runtime/shell/modals/NewTeamSessionModal.js';
import { renderMiddleTabContent, type MiddleTabKey } from '../runtime/tabs/MiddleTabRouter.js';
import {
  extractTeamRuntimeHandoffContextFromEvent,
  type TeamRuntimeHandoffContextInput,
} from '../runtime/tabs/team-runtime-navigation.js';
import {
  LEAF_TO_PRIMARY,
  MIDDLE_TAB_KEYS,
  getDefaultLeafFor,
  type PrimaryTabKey,
} from '../runtime/tabs/team-page-v2-tabs.js';
import { TeamTabBar } from '../runtime/shell/header/TeamTabBar.js';
import { useBreakpoint, useTeamPageMode } from '../runtime/hooks/use-team-page-state.js';
import { useAuthStore } from '../../../stores/auth/auth.js';
import { useUIStateStore } from '../../../stores/ui/uiState.js';
import {
  connectTeamEvents,
  disconnectTeamEvents,
  getTeamNotificationEventKey,
  useHandoffStore,
  useLayerStore,
  useTeamNotificationStore,
  useClarificationStore,
} from '../../../stores/team/team-events.js';
import type { HandoffEvent } from '../../../stores/team/team-events.js';
import { ClassicTeamLayerTodoSidePanel } from './workbench/ClassicTeamLayerTodoSidePanel.js';
import { ClassicTeamConversationOpsChrome } from '../conversation/ops/ClassicTeamConversationOpsChrome.js';
import { ClassicTeamConversationInlineCards } from '../conversation/ops/ClassicTeamConversationInlineCards.js';
import { OfficeThreeCanvas } from '../runtime/tabs/office/OfficeThreeCanvas.js';
import { useOfficeSceneState } from '../runtime/tabs/office/OfficeScene.js';
import type { TeamSessionCreationDraft } from '../runtime/data/team-session-creation.types.js';
import {
  createTeamClient,
  createTeamHandoffsClient,
  type TeamWorkspaceSummary,
} from '@openAwork/web-client';
import {
  countRuntimeTreeHandoffs,
  resolveEffectiveTeamPageMode,
} from './team-page-v2-runtime-controls.js';
import {
  collectSessionScope,
  countUnreadNotificationEventsInScope,
  isHandoffInSessionScope,
} from '../runtime/data/team-runtime-session-scope.js';
import { useFileEditor } from '../../../hooks/editor/useFileEditor.js';
import { WorkspaceEditorOverlay } from '../../../components/file-editor/WorkspaceEditorOverlay.js';
import type { EditorPaneTab } from '../../../components/file-editor/EditorBrowserWorkspace.js';
import { toast } from '../../../components/common/feedback/ToastNotification.js';
import { usePageActivation } from '../../../components/common/routing/CachedRouteOutlet.js';
import { requestSessionListRefresh } from '../../../utils/session/session-list-events.js';
import { isPathWithinRoot } from '../../../utils/workspace-path.js';
import {
  IdleHint,
  TeamFocusHandoffBanner,
  TeamPageSuperbarLeading,
  TeamPageSuperbarSummary,
  TeamSharedConversationPanel,
} from './team-page-v2-panels.js';
import { ErrorDiagnosticsPanel } from '../runtime/shell/controls/ErrorDiagnosticsPanel.js';
import {
  SmartSuggestionBubble,
  type SuggestionContext,
} from '../runtime/shell/controls/SmartInputGuide.js';
import {
  buildRuntimeResumeResumingNotice,
  buildRuntimeResumeSubmittedNotice,
  type RuntimeResumeNotice,
} from './team-page-v2-runtime-resume-notice.js';
import { resolveMatchedSharedSessionDetail } from '../runtime/data/team-runtime-shared-context.js';
import { TeamPageV2RuntimeNotices } from './TeamPageV2RuntimeNotices.js';
import { TeamFusionSuperbarSummary } from './TeamFusionSuperbarSummary.js';
import {
  buildTeamSessionRoute,
  resolveTeamSessionFromRoute,
} from '../../../utils/session/team-session-route.js';

// ───── 尺寸常量 ─────

const SIDEBAR_WIDTH = 240;
const SIDEBAR_TABLET_WIDTH = 200;
const SIDEBAR_COLLAPSED_WIDTH = 52;
const SIDEBAR_MIN_WIDTH = 180;
const SIDEBAR_MAX_WIDTH = 420;

/**
 * 主 tab 重构（260517）：
 *
 * 原本 23 个 tab 平铺在一行，认知负担过高。现在改为两层：
 *   - 主 tab（5 个）：概览 / 对话 / 任务 / 度量 / 治理
 *   - 子 tab（segmented）：仅显示当前主 tab 下的视图
 *   - 3D 办公：独立按钮，从 tab 栏抽出，按下切到沉浸视图
 *
 * 实现策略：MiddleTabKey 不动，子 tab 的 key 仍然是叶子 key，
 * 这样 MiddleTabRouter / localStorage / 现有 conversation 特例
 * 都不需要改，零风险。
 *
 * 数据 / 样式：见 team/runtime/team-page-v2-tabs.ts。
 */

// ───── 样式 ─────

const SUPERBAR_STATUS_TRIGGER_STYLE: CSSProperties = {
  display: 'flex',
  minWidth: 0,
  flex: 1,
  cursor: 'pointer',
  overflow: 'hidden',
  padding: '2px 4px',
  borderRadius: 8,
};

const OFFICE_EXPAND_BUTTON_STYLE: CSSProperties = {
  alignSelf: 'flex-start',
  margin: '8px 12px 0',
  padding: '4px 10px',
  borderRadius: 6,
  border: '1px solid color-mix(in srgb, var(--border-default) 60%, transparent)',
  color: 'var(--fg-default)',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
  flexShrink: 0,
};

const MAIN_GRID_BASE_STYLE: CSSProperties = {
  flex: 1,
  minHeight: 0,
  minWidth: 0,
  display: 'grid',
  overflow: 'hidden',
  transition: 'grid-template-columns 200ms ease',
};

const LEFT_AREA_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  minHeight: 0,
  overflow: 'hidden',
  isolation: 'isolate',
};

const DEFAULT_BROWSER_PREVIEW_URL = 'http://localhost:3000';

function normalizeBrowserPreviewUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^[a-z0-9-]+\.[a-z]{2,}/i.test(trimmed)) return `https://${trimmed}`;
  if (/^(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?(?:\/.*)?$/i.test(trimmed)) {
    return `http://${trimmed}`;
  }
  return trimmed;
}

// ───── 入口组件 ─────

export default function TeamPageV2() {
  const { teamWorkspaceId } = useParams<{ teamWorkspaceId?: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const workspaceState = useTeamWorkspaceState(teamWorkspaceId);
  const resolvedTeamWorkspaceId = teamWorkspaceId ?? workspaceState.workspaces[0]?.id ?? null;
  const activeWorkspaceName = workspaceState.activeWorkspace?.name.trim();
  const teamWorkspaceDisplayName =
    activeWorkspaceName && activeWorkspaceName.length > 0
      ? activeWorkspaceName
      : (resolvedTeamWorkspaceId ?? '默认工作区');

  // 不自动重定向 /team → /team/:workspaceId。
  // /team 路由保持不变，显示欢迎页面；resolvedTeamWorkspaceId 仍从工作区列表派生用于数据加载。
  // 只有用户从侧边栏点击具体工作区的会话时，才导航到 /team/:workspaceId。
  const workspaceSnapshotState = useTeamWorkspaceSnapshotState(
    resolvedTeamWorkspaceId ?? undefined,
  );
  const [selectedTeamId, setSelectedTeamId] = useState('');
  const [selectedAgentId, setSelectedAgentId] = useState('');
  /**
   * 标识用户是否主动从左栏 / TeamPageV2 自己的菜单选过具体 team session。
   * - false：自动填充的 selectedTeamId 视为「未选」，纠偏 effect 可覆盖
   * - true：用户明确选了某个 team session，纠偏 effect 不干预
   *
   * 注意：对话区渲染不再依赖此 ref——对话区始终跟随 selectedTeamId。
   */
  const userSelectedTeamRef = useRef(false);
  /**
   * 跨工作区切换会话时，先记住用户想选的会话 ID。
   * 新工作区数据加载完成后（workspaceGroups 包含该会话），
   * 由恢复 effect 自动 setSelectedTeamId。
   */
  const pendingSelectedTeamIdRef = useRef<string | null>(null);
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [showNewWorkspaceModal, setShowNewWorkspaceModal] = useState(false);
  const [showNewSessionModal, setShowNewSessionModal] = useState(false);
  const [initialTemplateId, setInitialTemplateId] = useState<string | null>(null);
  const [initialWorkingDirectory, setInitialWorkingDirectory] = useState<string | null>(null);
  const [deleteWorkspaceTarget, setDeleteWorkspaceTarget] = useState<TeamWorkspaceSummary | null>(
    null,
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('teamV2.leftSidebar.collapsed') === '1';
  });
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    if (typeof window === 'undefined') return SIDEBAR_WIDTH;
    const saved = window.localStorage.getItem('teamV2.leftSidebar.width');
    if (saved) {
      const parsed = parseInt(saved, 10);
      if (!Number.isNaN(parsed) && parsed >= SIDEBAR_MIN_WIDTH && parsed <= SIDEBAR_MAX_WIDTH) {
        return parsed;
      }
    }
    return SIDEBAR_WIDTH;
  });
  const [focusMode, setFocusMode] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [selectedWorkspacePath, setSelectedWorkspacePath] = useState<string | null>(null);
  const [showOfficeFullscreen, setShowOfficeFullscreen] = useState(false);
  const [focusedHandoffId, setFocusedHandoffId] = useState<string | null>(null);
  const [middleTab, setMiddleTab] = useState<MiddleTabKey>(() => {
    if (typeof window === 'undefined') return 'dashboard';
    const saved = window.localStorage.getItem('teamV2.middleTab');
    if (saved && MIDDLE_TAB_KEYS.has(saved as MiddleTabKey)) {
      return saved as MiddleTabKey;
    }
    return 'dashboard';
  });
  /**
   * 是否启用 team 端 composer 输入（L1.3 inbound 反向通道）。
   *
   * 后端 L1.3 改造 1（session_inbound_messages 表 + POST /team/sessions/:id/inbound-messages
   * 端点）已落地，默认开启。如需回到只读模式（如调试或后端兼容），
   * 设置 `localStorage['teamV2.inboundComposer.enabled']='0'` 强制关闭。
   *
   * 当 substate='clarifying' 时，提交走 'clarification_answer'；其他情况走 'user_input'。
   * reception session 的 user_input 会触发服务端 B1 自动编排（reception → pm1）。
   */
  const [inboundComposerEnabled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    const stored = window.localStorage.getItem('teamV2.inboundComposer.enabled');
    if (stored === null) return true;
    return stored === '1';
  });
  const { accessToken, gatewayUrl } = useAuthStore();
  useMultiSessionAttach({
    token: accessToken,
    gatewayUrl,
    enabled: Boolean(accessToken),
  });
  const canCreateWorkspace = Boolean(accessToken);
  const mode = useTeamPageMode();
  const breakpoint = useBreakpoint();
  const handoffs = useHandoffStore((s) => s.handoffs);
  const layerNodesMap = useLayerStore((s) => s.nodes);
  const notificationEvents = useTeamNotificationStore((s) => s.events);
  const readEventKeys = useTeamNotificationStore((s) => s.readEventKeys);
  const globalUnreadCount = useTeamNotificationStore((s) => s.unreadCount);
  const clarificationPending = useClarificationStore((s) => s.pendingCount);
  const clarificationItems = useClarificationStore((s) => s.items);
  const officeSceneState = useOfficeSceneState();
  const teamClient = useMemo(() => createTeamClient(gatewayUrl), [gatewayUrl]);
  const [pauseResumeBusy, setPauseResumeBusy] = useState(false);
  const [runtimeControlError, setRuntimeControlError] = useState<string | null>(null);
  const [runtimeResumeNotice, setRuntimeResumeNotice] = useState<RuntimeResumeNotice | null>(null);
  const [showPauseConfirm, setShowPauseConfirm] = useState(false);
  const [showResumeStale, setShowResumeStale] = useState(false);

  const data = useResolvedTeamRuntimeReferenceData({
    activeWorkspace: workspaceState.activeWorkspace,
    collaborationEnabled: Boolean(resolvedTeamWorkspaceId),
    teamWorkspaceId: resolvedTeamWorkspaceId,
    activeWorkspaceSnapshot: workspaceSnapshotState.snapshot,
    selectedTeamId,
    workspaceSnapshotError: workspaceSnapshotState.error,
    workspaceSnapshotLoading: workspaceSnapshotState.loading,
    workspaceError: workspaceState.error,
    workspaceLoading: workspaceState.loading,
    workspaces: workspaceState.workspaces,
    onWorkspacesChanged: workspaceState.refresh,
  });

  // `/team` 仍保留欢迎页；`/team/:workspaceId` 则恢复 URL 指定的会话，
  // 旧链接没有 sessionId 时回退到当前工作区默认根会话。
  // 跨工作区切换会话后，等新工作区数据加载完成（workspaceGroups 包含
  // pending 会话）时恢复选中。避免在新数据加载前用旧 sessionId 加载内容。
  useEffect(() => {
    const pendingId = pendingSelectedTeamIdRef.current;
    if (!pendingId || !data.workspaceGroups.length) {
      return;
    }
    const found = data.workspaceGroups.some((group) =>
      group.sessions.some((s) => s.id === pendingId),
    );
    if (found) {
      pendingSelectedTeamIdRef.current = null;
      setSelectedTeamId(pendingId);
      data.selectTeam(pendingId);
    }
  }, [data.workspaceGroups]);

  useEffect(() => {
    if (!teamWorkspaceId || selectedTeamId || !data.workspaceGroups.length) {
      return;
    }
    const requestedSessionId = searchParams.get('sessionId');
    const routeSessionId = resolveTeamSessionFromRoute({
      defaultSessionId: data.defaultSelectedTeamId,
      groups: data.workspaceGroups,
      requestedSessionId,
    });
    if (!routeSessionId) {
      return;
    }
    userSelectedTeamRef.current = true;
    setSelectedTeamId(routeSessionId);
    data.selectTeam(routeSessionId);
    if (requestedSessionId !== routeSessionId) {
      const nextSearchParams = new URLSearchParams(searchParams);
      nextSearchParams.set('sessionId', routeSessionId);
      setSearchParams(nextSearchParams, { replace: true });
    }
  }, [
    data.defaultSelectedTeamId,
    data.selectTeam,
    data.workspaceGroups,
    searchParams,
    selectedTeamId,
    setSearchParams,
    teamWorkspaceId,
  ]);

  useEffect(() => {
    if (!selectedAgentId && data.defaultSelectedAgentId) {
      setSelectedAgentId(data.defaultSelectedAgentId);
    }
  }, [data.defaultSelectedAgentId, selectedAgentId]);

  useEffect(() => {
    if (
      selectedAgentId &&
      data.roleChips.length > 0 &&
      !data.roleChips.some((chip) => chip.id === selectedAgentId)
    ) {
      setSelectedAgentId(data.defaultSelectedAgentId);
    }
  }, [data.defaultSelectedAgentId, data.roleChips, selectedAgentId]);

  const { effectiveWorkspaceGroups } = useTeamSessionListRuntimeState(data.workspaceGroups);

  // 派生当前选中的会话（用于 tab 中的展示）
  const selectedTeam = useMemo(() => {
    if (!selectedTeamId) return null;
    for (const group of effectiveWorkspaceGroups) {
      const found = group.sessions.find((s) => s.id === selectedTeamId);
      if (found) return found;
    }
    return null;
  }, [effectiveWorkspaceGroups, selectedTeamId]);

  // 文件树的 workspacePath：优先取选中会话的 workingDirectory（仅当它
  // 属于当前工作区的 defaultWorkingRoot 子路径时），否则回退到 defaultWorkingRoot。
  // 不能跨工作区——后端会校验路径必须在 workspaceRoot 范围内。
  const workspaceRoot = workspaceState.activeWorkspace?.defaultWorkingRoot ?? null;
  const fileTreeWorkspacePath = useMemo(() => {
    if (workspaceRoot && selectedTeam?.workingDirectory) {
      if (isPathWithinRoot(selectedTeam.workingDirectory, workspaceRoot)) {
        return selectedTeam.workingDirectory;
      }
    }
    return workspaceRoot;
  }, [selectedTeam?.workingDirectory, workspaceRoot]);

  useEffect(() => {
    if (selectedTeam || !selectedTeamId) {
      return;
    }

    // 用户刚主动选中了一个会话（如新建会话后自动选中），但该会话可能
    // 还没出现在 workspaceGroups 中（snapshot 异步刷新尚未完成）。
    // 此时不应纠偏——保持用户选中的会话，等 snapshot 刷新后自然出现。
    if (userSelectedTeamRef.current) {
      return;
    }

    setFocusedHandoffId(null);

    // 不自动选中 defaultSelectedTeamId——让用户从侧边栏主动选择。
    // 仅在没有可用会话时清除选中态。
    if (!data.defaultSelectedTeamId) {
      setSelectedTeamId('');
      data.setSelectedSharedSessionId(null);
    }
  }, [
    data.defaultSelectedTeamId,
    data.selectTeam,
    data.setSelectedSharedSessionId,
    selectedTeam,
    selectedTeamId,
  ]);
  useEffect(() => {
    if (!selectedTeamId || !selectedTeam) {
      return;
    }
    data.selectTeam(selectedTeamId);
  }, [data.selectTeam, selectedTeam, selectedTeamId]);

  // 同步 selectedTeamId 到全局 store，供 AppSidebar 高亮当前团队会话。
  // 使用 usePageActivation 检测页面是否处于缓存状态（CachedRouteOutlet 不卸载组件），
  // 当离开 team 页面（页面非激活）时也清除 activeTeamSessionId，避免跨会话选中残留。
  const pageActive = usePageActivation();
  const setActiveTeamSessionId = useUIStateStore((s) => s.setActiveTeamSessionId);
  useEffect(() => {
    if (!pageActive) {
      setActiveTeamSessionId(null);
      return;
    }
    setActiveTeamSessionId(selectedTeamId || null);
    return () => {
      setActiveTeamSessionId(null);
    };
  }, [selectedTeamId, setActiveTeamSessionId, pageActive]);
  const isSelectedSharedSession = useMemo(
    () => selectedTeam?.isSharedSession === true,
    [selectedTeam],
  );
  const selectedSharedSession = useMemo(
    () =>
      isSelectedSharedSession
        ? resolveMatchedSharedSessionDetail({
            selectedTeamId,
            activeSharedSession: data.activeSharedSession,
            selectedSharedSession: data.selectedSharedSession,
          })
        : null,
    [data.activeSharedSession, data.selectedSharedSession, isSelectedSharedSession, selectedTeamId],
  );
  const selectedRuntimeSessionScope = useMemo(() => {
    if (!selectedTeamId || isSelectedSharedSession) {
      return null;
    }
    const sessions = workspaceSnapshotState.snapshot?.sessions ?? [];
    return collectSessionScope(selectedTeamId, sessions);
  }, [isSelectedSharedSession, selectedTeamId, workspaceSnapshotState.snapshot?.sessions]);
  const scopedUnreadCount = useMemo(() => {
    if (isSelectedSharedSession) {
      return (
        (selectedSharedSession?.pendingPermissions.length ?? 0) +
        (selectedSharedSession?.pendingQuestions.length ?? 0)
      );
    }
    return countUnreadNotificationEventsInScope(
      notificationEvents,
      readEventKeys,
      selectedRuntimeSessionScope,
      getTeamNotificationEventKey,
      globalUnreadCount,
    );
  }, [
    globalUnreadCount,
    isSelectedSharedSession,
    notificationEvents,
    readEventKeys,
    selectedRuntimeSessionScope,
    selectedSharedSession,
  ]);
  const scopedHandoffs = useMemo(
    () =>
      selectedRuntimeSessionScope
        ? Array.from(handoffs.values()).filter((handoff) =>
            isHandoffInSessionScope(handoff, selectedRuntimeSessionScope),
          )
        : [],
    [handoffs, selectedRuntimeSessionScope],
  );
  const { activeCount: activeHandoffCount, staleCount: staleHandoffCount } = useMemo(
    () => countRuntimeTreeHandoffs(scopedHandoffs),
    [scopedHandoffs],
  );
  const hasPausedHandoffInScope = useMemo(
    () => scopedHandoffs.some((handoff) => handoff.paused === true),
    [scopedHandoffs],
  );
  const isSelectedTeamPaused = selectedTeam?.status === 'paused' || hasPausedHandoffInScope;
  const effectiveMode = resolveEffectiveTeamPageMode(mode, isSelectedTeamPaused);
  const canManageSelectedRuntimeTree =
    data.canManageRuntime &&
    Boolean(accessToken && selectedTeamId && !isSelectedSharedSession) &&
    selectedTeam?.status !== 'completed' &&
    selectedTeam?.status !== 'failed';

  // 连接 team-events WS
  useEffect(() => {
    if (!accessToken || !gatewayUrl) return undefined;
    connectTeamEvents(gatewayUrl, accessToken);
    return () => {
      disconnectTeamEvents();
    };
  }, [accessToken, gatewayUrl]);

  const isMobile = breakpoint === 'mobile';
  const isTablet = breakpoint === 'tablet';

  // 移动端：默认折叠左侧会话栏 + 隐藏 3D
  const effectiveSidebarCollapsed = isMobile ? true : sidebarCollapsed;
  // 专注模式：收起左侧栏，全宽展示中间区
  const effectiveFocusMode = focusMode && !isMobile;
  const showOffice = !isMobile;

  const handleToggleSidebar = () => {
    if (isMobile) {
      setMobileSidebarOpen((previous) => !previous);
      return;
    }
    setSidebarCollapsed((prev) => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('teamV2.leftSidebar.collapsed', next ? '1' : '0');
      }
      return next;
    });
  };

  const handleSidebarResize = useCallback((width: number) => {
    setSidebarWidth(width);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('teamV2.leftSidebar.width', String(width));
    }
  }, []);

  const handleToggleFocusMode = useCallback(() => {
    setFocusMode((prev) => !prev);
  }, []);

  const handleSidebarDividerToggle = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('teamV2.leftSidebar.collapsed', next ? '1' : '0');
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (!isMobile && mobileSidebarOpen) {
      setMobileSidebarOpen(false);
    }
  }, [isMobile, mobileSidebarOpen]);

  useEffect(() => {
    if (!mobileSidebarOpen || typeof document === 'undefined') {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileSidebarOpen]);

  const selectTeamInternal = useCallback(
    (teamId: string, options?: { preserveFocus?: boolean }) => {
      userSelectedTeamRef.current = true;
      if (!options?.preserveFocus) {
        setFocusedHandoffId(null);
      }
      // 点击会话 → 切回对话视图：关掉占据内容区的文件编辑器浮层，
      // 让选中的会话对话流重新可见（与「点文件 = 预览」互为切换）。
      setEditorOverlayOpen(false);
      setMiddleTab('conversation');
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('teamV2.middleTab', 'conversation');
      }
      if (isMobile) {
        setMobileSidebarOpen(false);
      }

      // 侧边栏现在显示所有工作区的会话。如果选中的会话属于其他工作区，
      // 自动切换 URL 到那个工作区，让 activeWorkspace / snapshot / 文件树
      // 全部跟随切换。跨工作区切换时先清空 selectedTeamId，避免新工作区
      // 数据加载完成前用旧工作区的 sessionId 去加载对话内容。
      const sessionGroup = data.workspaceGroups.find((group) =>
        group.sessions.some((s) => s.id === teamId),
      );
      let isCrossWorkspaceNavigation = false;
      if (sessionGroup?.workspacePath) {
        const sessionPath = sessionGroup.workspacePath;
        const targetWorkspace = workspaceState.workspaces.find(
          (ws) =>
            ws.defaultWorkingRoot != null && isPathWithinRoot(sessionPath, ws.defaultWorkingRoot),
        );
        if (targetWorkspace && targetWorkspace.id !== resolvedTeamWorkspaceId) {
          navigate(buildTeamSessionRoute(targetWorkspace.id, teamId));
          isCrossWorkspaceNavigation = true;
          // 先记住用户想选的会话，等新工作区数据加载后再恢复
          pendingSelectedTeamIdRef.current = teamId;
          userSelectedTeamRef.current = true;
          setSelectedTeamId('');
        }
      }

      if (!isCrossWorkspaceNavigation) {
        setSelectedTeamId(teamId);
        data.selectTeam(teamId);
        if (resolvedTeamWorkspaceId) {
          const nextSearchParams = new URLSearchParams(searchParams);
          nextSearchParams.set('sessionId', teamId);
          setSearchParams(nextSearchParams, { replace: true });
        }
      }
    },
    [
      data,
      isMobile,
      navigate,
      resolvedTeamWorkspaceId,
      searchParams,
      setSearchParams,
      workspaceState.workspaces,
    ],
  );

  const handleSelectTeam = useCallback(
    (teamId: string) => {
      selectTeamInternal(teamId);
    },
    [selectTeamInternal],
  );

  const handleSelectAgent = useCallback((agentId: string) => {
    setSelectedAgentId(agentId);
  }, []);

  const handleSubmitMessage = useCallback(
    async (text: string) => {
      await data.sendMessage({ content: text, type: 'update' });
    },
    [data.sendMessage],
  );

  const { refresh: refreshWorkspaces } = workspaceState;
  const { refresh: refreshWorkspaceSnapshot } = workspaceSnapshotState;

  const handleRetryConnection = useCallback(() => {
    refreshWorkspaces();
    refreshWorkspaceSnapshot();
  }, [refreshWorkspaceSnapshot, refreshWorkspaces]);

  const handlePauseAll = useCallback(() => {
    if (!canManageSelectedRuntimeTree || isSelectedTeamPaused || pauseResumeBusy) {
      return;
    }
    setShowPauseConfirm(true);
  }, [canManageSelectedRuntimeTree, isSelectedTeamPaused, pauseResumeBusy]);

  const handleConfirmPauseAll = useCallback(async () => {
    setShowPauseConfirm(false);
    if (
      !accessToken ||
      !teamClient ||
      !selectedTeamId ||
      isSelectedSharedSession ||
      pauseResumeBusy
    ) {
      return;
    }
    setPauseResumeBusy(true);
    setRuntimeControlError(null);
    setRuntimeResumeNotice(null);
    try {
      await teamClient.pauseAllRuntimeSessions(accessToken, selectedTeamId, {
        reason: 'team-page-v2-pause-all',
      });
      refreshWorkspaceSnapshot();
    } catch (error) {
      setRuntimeControlError(error instanceof Error ? error.message : '暂停运行树失败');
    } finally {
      setPauseResumeBusy(false);
    }
  }, [
    accessToken,
    isSelectedSharedSession,
    pauseResumeBusy,
    refreshWorkspaceSnapshot,
    selectedTeamId,
    teamClient,
  ]);

  const handleResumeAll = useCallback(async () => {
    setShowResumeStale(false);
    if (
      !accessToken ||
      !teamClient ||
      !selectedTeamId ||
      isSelectedSharedSession ||
      !isSelectedTeamPaused ||
      pauseResumeBusy
    ) {
      return;
    }
    setPauseResumeBusy(true);
    setRuntimeControlError(null);
    setRuntimeResumeNotice(buildRuntimeResumeResumingNotice());
    try {
      const result = await teamClient.resumeAllRuntimeSessions(accessToken, selectedTeamId);
      setRuntimeResumeNotice(buildRuntimeResumeSubmittedNotice(result));
      refreshWorkspaceSnapshot();
    } catch (error) {
      setRuntimeResumeNotice(null);
      setRuntimeControlError(error instanceof Error ? error.message : '恢复运行树失败');
    } finally {
      setPauseResumeBusy(false);
    }
  }, [
    accessToken,
    isSelectedSharedSession,
    isSelectedTeamPaused,
    pauseResumeBusy,
    refreshWorkspaceSnapshot,
    selectedTeamId,
    teamClient,
  ]);

  const handleRequestResumeAll = useCallback(() => {
    if (staleHandoffCount > 0) {
      setShowResumeStale(true);
      return;
    }
    void handleResumeAll();
  }, [handleResumeAll, staleHandoffCount]);

  const handleSelectLayerSession = useCallback(() => {
    // classic 弃用底部「层级对话」抽屉
    if (useUIStateStore.getState().workbenchLayoutMode === 'classic') return;
    setDrawerVisible(true);
  }, []);

  const handleStatusBarClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLElement && event.target.closest('button')) {
      return;
    }
    // classic 工作台弃用底部「层级对话」抽屉，状态栏点击不再打开
    if (useUIStateStore.getState().workbenchLayoutMode === 'classic') return;
    setDrawerVisible(true);
  }, []);

  const handleSubmitDraft = useCallback(
    async (draft: TeamSessionCreationDraft) => {
      // 把 4 步向导产出的完整 draft（title / source / defaultProvider /
      // optionalAgentIds / requiredRoleBindings）整体下发给后端 /sessions
      // 路径，由 createSession 内部映射到 CreateTeamSessionInput。
      // 之前只传 teamWorkspaceId 会导致 source / defaultProvider / optional
      // agents 全部丢失（参见 docs/team-architecture-deferred-decisions.md）。
      const createdSessionId = await data.createSession(draft);
      if (!createdSessionId) {
        return false;
      }
      setShowNewSessionModal(false);
      setInitialTemplateId(null);
      setInitialWorkingDirectory(null);
      // 刷新 workspace snapshot，确保新会话立刻出现在 workspaceGroups 中。
      // 否则 effectiveSessions（优先取 snapshot）还不包含新会话时，纠偏 effect
      // 会把 selectedTeamId 切回 defaultSelectedTeamId，导致选中态丢失。
      refreshWorkspaceSnapshot();
      // 自动选中新创建的会话，让用户立刻看到新会话的对话视图
      selectTeamInternal(createdSessionId);
      return true;
    },
    [data, refreshWorkspaceSnapshot, selectTeamInternal],
  );

  const handleOpenNewSessionModal = useCallback(
    (templateId?: string | null, workingDirectory?: string | null) => {
      if (!resolvedTeamWorkspaceId) {
        toast('请先选择工作空间后再创建会话。', 'warning');
        return;
      }
      setInitialTemplateId(templateId ?? null);
      setInitialWorkingDirectory(workingDirectory ?? null);
      setShowNewSessionModal(true);
    },
    [resolvedTeamWorkspaceId],
  );

  // Store 信号 triggerTeamNewSession → 打开新建团队会话弹窗
  // Store 信号 triggerTeamSelectSession → 选中指定团队会话
  // URL 参数 ?action=newWorkspace → 打开新建团队工作区弹窗
  const teamNewSessionSignal = useUIStateStore((s) => s.teamNewSessionSignal);
  const consumeTeamNewSessionSignal = useUIStateStore((s) => s.consumeTeamNewSessionSignal);
  const teamNewWorkspaceSignal = useUIStateStore((s) => s.teamNewWorkspaceSignal);
  const consumeTeamNewWorkspaceSignal = useUIStateStore((s) => s.consumeTeamNewWorkspaceSignal);
  const teamSelectSessionSignal = useUIStateStore((s) => s.teamSelectSessionSignal);
  const consumeTeamSelectSessionSignal = useUIStateStore((s) => s.consumeTeamSelectSessionSignal);
  const resetToWelcomeSignal = useUIStateStore((s) => s.resetToWelcomeSignal);
  const consumeResetToWelcomeSignal = useUIStateStore((s) => s.consumeResetToWelcomeSignal);

  // 点击导航栏 Team 图标时（已在 /team 路由），清除会话选中回到欢迎页面。
  useEffect(() => {
    if (!resetToWelcomeSignal || resetToWelcomeSignal.route !== 'team') return;
    setSelectedTeamId('');
    setEditorOverlayOpen(false);
    consumeResetToWelcomeSignal();
    navigate('/team', { replace: true });
  }, [resetToWelcomeSignal, consumeResetToWelcomeSignal, navigate]);

  useEffect(() => {
    if (!teamNewSessionSignal) {
      return;
    }
    if (teamNewSessionSignal.teamWorkspaceId !== resolvedTeamWorkspaceId) {
      return;
    }
    setShowNewSessionModal(true);
    consumeTeamNewSessionSignal();
  }, [teamNewSessionSignal, resolvedTeamWorkspaceId, consumeTeamNewSessionSignal]);

  useEffect(() => {
    if (!teamNewWorkspaceSignal) {
      return;
    }
    setShowNewWorkspaceModal(true);
    consumeTeamNewWorkspaceSignal();
  }, [teamNewWorkspaceSignal, consumeTeamNewWorkspaceSignal]);

  useEffect(() => {
    if (!teamSelectSessionSignal) {
      return;
    }
    const { teamWorkspaceId, sessionId } = teamSelectSessionSignal;
    if (teamWorkspaceId !== resolvedTeamWorkspaceId) {
      return;
    }
    // 等待 workspaceGroups 加载完成后再选中
    const found = data.workspaceGroups.some((group) =>
      group.sessions.some((session) => session.id === sessionId),
    );
    if (!found) {
      return;
    }
    userSelectedTeamRef.current = true;
    setSelectedTeamId(sessionId);
    data.selectTeam(sessionId);
    consumeTeamSelectSessionSignal();
  }, [teamSelectSessionSignal, resolvedTeamWorkspaceId, data, consumeTeamSelectSessionSignal]);

  const clearNewWorkspaceAction = useCallback(() => {
    if (searchParams.get('action')?.trim() !== 'newWorkspace') {
      return;
    }
    const nextSearchParams = new URLSearchParams(searchParams);
    nextSearchParams.delete('action');
    setSearchParams(nextSearchParams, { replace: true });
  }, [searchParams, setSearchParams]);

  const hasPendingNewWorkspaceAction = searchParams.get('action')?.trim() === 'newWorkspace';

  useEffect(() => {
    if (!teamNewWorkspaceSignal && !hasPendingNewWorkspaceAction) {
      return;
    }
    setShowNewWorkspaceModal(true);
    if (teamNewWorkspaceSignal) {
      consumeTeamNewWorkspaceSignal();
    }
    if (hasPendingNewWorkspaceAction) {
      clearNewWorkspaceAction();
    }
  }, [
    teamNewWorkspaceSignal,
    hasPendingNewWorkspaceAction,
    consumeTeamNewWorkspaceSignal,
    clearNewWorkspaceAction,
  ]);

  const handleDeleteSession = useCallback(
    (sessionId: string) => {
      void data.deleteSession(sessionId).then((ok) => {
        if (ok) {
          // 通知侧边栏会话列表刷新——团队会话删除可能级联删除子会话，
          // useSessions 的本地状态需要从服务器同步。
          requestSessionListRefresh();
        }
      });
    },
    [data],
  );

  const handleWorkspaceChange = useCallback((workspacePath: string | null) => {
    setSelectedWorkspacePath(workspacePath);
  }, []);

  const handleMiddleTabChange = useCallback((next: MiddleTabKey) => {
    setMiddleTab(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('teamV2.middleTab', next);
    }
  }, []);

  const handleOpenHandoffContext = useCallback(
    ({ handoffId, preferredTab, sessionId }: TeamRuntimeHandoffContextInput) => {
      setFocusedHandoffId(handoffId ?? null);
      if (
        sessionId &&
        data.workspaceGroups.some((group) =>
          group.sessions.some((session) => session.id === sessionId),
        )
      ) {
        selectTeamInternal(sessionId, { preserveFocus: true });
      }
      handleMiddleTabChange(preferredTab);
    },
    [data.workspaceGroups, handleMiddleTabChange, selectTeamInternal],
  );

  const handleOpenBlockingTarget = useCallback(
    (event: HandoffEvent) => {
      handleOpenHandoffContext(extractTeamRuntimeHandoffContextFromEvent(event));
    },
    [handleOpenHandoffContext],
  );

  /**
   * 当前激活的主 tab：从叶子 key 反向查表得到。
   * 'office' 不属于任何主 tab（沉浸视图），此时 activePrimary 为 null，
   * UI 上让主 tab 栏全部置非激活态即可。
   */
  const activePrimary = useMemo<PrimaryTabKey | null>(
    () => LEAF_TO_PRIMARY.get(middleTab) ?? null,
    [middleTab],
  );

  const handlePrimaryTabChange = useCallback(
    (next: PrimaryTabKey) => {
      // 切主 tab 时：若当前 leaf 已属于该主 tab，则保留 leaf；否则回落到该主 tab 的默认子 tab。
      if (LEAF_TO_PRIMARY.get(middleTab) === next) return;
      handleMiddleTabChange(getDefaultLeafFor(next));
    },
    [handleMiddleTabChange, middleTab],
  );

  const handoffsClient = useMemo(
    () => (gatewayUrl ? createTeamHandoffsClient(gatewayUrl) : null),
    [gatewayUrl],
  );

  const handleCancelHandoff = useCallback(
    (handoffId: string) => {
      if (!handoffsClient || !accessToken) return;
      void handoffsClient
        .cancelHandoff(accessToken, handoffId)
        .then((result) => {
          if (!result.ok) {
            const message =
              result.errorMessage ?? (result.state ? `当前状态：${result.state}` : '未知错误');
            console.error('[TeamPageV2] cancel handoff failed:', handoffId, message);
            toast(`取消任务失败：${message}`, 'error');
            return;
          }
          toast('已取消运行中任务', 'success');
          refreshWorkspaceSnapshot();
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : '未知错误';
          console.error('[TeamPageV2] cancel handoff request failed:', handoffId, message);
          toast(`取消任务失败：${message}`, 'error');
        });
    },
    [handoffsClient, accessToken, refreshWorkspaceSnapshot],
  );

  const handleOpenFullscreen = useCallback(() => {
    setShowOfficeFullscreen(true);
  }, []);

  // 文件目录点击 → 在全屏编辑器浮层中打开真正的编辑器(复用 chat 同款
  // EditorBrowserWorkspace)。team 页没有内置分屏编辑器,因此自己持有一份
  // useFileEditor 状态 + 一个铺满内容区的浮层,而不是依赖只有 ChatPage 才会
  // 填充的全局 FileEditorContext(在 /team 路由下那个 ref 永远是 null,导致
  // 之前点击文件「打开到编辑器」毫无反应)。
  const editorWorkspacePath = workspaceState.activeWorkspace?.defaultWorkingRoot ?? null;
  const fileEditor = useFileEditor(editorWorkspacePath);
  const [editorOverlayOpen, setEditorOverlayOpen] = useState(false);
  const [browserPreviewUrl, setBrowserPreviewUrl] = useState<string | null>(null);
  const [editorPaneTab, setEditorPaneTab] = useState<EditorPaneTab>('code');
  const [savingFile, setSavingFile] = useState(false);

  const teamEditorMode = useUIStateStore((s) => s.teamEditorMode);
  const teamSplitPos = useUIStateStore((s) => s.teamSplitPos);
  const setTeamSplitPos = useUIStateStore((s) => s.setTeamSplitPos);
  const setTeamEditorMode = useUIStateStore((s) => s.setTeamEditorMode);
  const workbenchLayoutMode = useUIStateStore((s) => s.workbenchLayoutMode);
  const isFusionWorkbench = workbenchLayoutMode === 'fusion';
  const isClassicWorkbench = workbenchLayoutMode === 'classic';
  // 全局侧栏（classic 的 AppSidebar / fusion 的 FusionSidebar）已承载「团队会话」段，
  // 团队页自己的左侧栏现仅渲染文件树（会话列表已从该栏彻底移除，而非隐藏）。
  const shellCollapsed = effectiveSidebarCollapsed;
  const handleOpenFile = useCallback(
    (path: string) => {
      if (isMobile) {
        setMobileSidebarOpen(false);
      }
      setEditorPaneTab('code');
      setEditorOverlayOpen(true);
      void fileEditor.openFile(path);
    },
    [fileEditor, isMobile],
  );
  const handleSaveFile = useCallback(
    async (path: string) => {
      setSavingFile(true);
      try {
        await fileEditor.saveFile(path);
      } finally {
        setSavingFile(false);
      }
    },
    [fileEditor],
  );

  // 编辑器浮层打开时按 ESC 关闭。
  useEffect(() => {
    if (!editorOverlayOpen) return;
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setEditorOverlayOpen(false);
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [editorOverlayOpen]);

  useEffect(() => {
    if (!showOfficeFullscreen) return;
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowOfficeFullscreen(false);
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [showOfficeFullscreen]);

  const openBrowserPreview = useCallback(
    (rawUrl?: string | null) => {
      const nextUrl = normalizeBrowserPreviewUrl(rawUrl?.trim() || DEFAULT_BROWSER_PREVIEW_URL);
      if (isMobile) {
        setMobileSidebarOpen(false);
      }
      setBrowserPreviewUrl(nextUrl);
      setEditorPaneTab('browser');
      setEditorOverlayOpen(true);
    },
    [isMobile],
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleOpenBrowser = () => {
      openBrowserPreview(DEFAULT_BROWSER_PREVIEW_URL);
    };
    const handleOpenBrowserUrl = (event: Event) => {
      const detail = (event as CustomEvent<{ url?: string }>).detail;
      openBrowserPreview(detail?.url ?? DEFAULT_BROWSER_PREVIEW_URL);
    };

    window.addEventListener('openAwork:open-browser', handleOpenBrowser);
    window.addEventListener('openawork:browser:open-url', handleOpenBrowserUrl as EventListener);
    return () => {
      window.removeEventListener('openAwork:open-browser', handleOpenBrowser);
      window.removeEventListener(
        'openawork:browser:open-url',
        handleOpenBrowserUrl as EventListener,
      );
    };
  }, [openBrowserPreview]);

  // grid template 列数（只在桌面/平板下生效）
  const gridTemplateColumns = '1fr';

  const showSidebarDivider = false;

  const mainGridStyle: CSSProperties = {
    ...MAIN_GRID_BASE_STYLE,
    gridTemplateColumns,
    columnGap: 0,
    rowGap: 0,
    // classic / fusion 均走并排工作台，贴边以最大化对话与侧栏可视区域
    padding: isMobile || isFusionWorkbench || isClassicWorkbench ? 0 : '6px 8px 10px',
  };

  if (isMobile || effectiveFocusMode) {
    mainGridStyle.position = 'relative';
  }

  // 派生当前选中会话的失败任务数（用于标签页红点 + 错误面板）
  const failedTaskCount = useMemo(() => {
    return selectedTeam?.taskFailed ?? scopedHandoffs.filter((h) => h.state === 'failed').length;
  }, [scopedHandoffs, selectedTeam?.taskFailed]);

  // 当前输入建议上下文
  const suggestionContext = useMemo<SuggestionContext>(() => {
    if (failedTaskCount > 0) return 'failure';
    if (effectiveMode === 'idle') return 'idle';
    if (effectiveMode === 'paused') return 'clarifying';
    if (effectiveMode === 'running') return 'running';
    return 'default';
  }, [effectiveMode, failedTaskCount]);

  const [suggestionDismissed, setSuggestionDismissed] = useState(false);

  // 失败任务数变化时重置 dismiss 状态
  useEffect(() => {
    if (failedTaskCount > 0) {
      setSuggestionDismissed(false);
    }
  }, [failedTaskCount]);

  const [retryingFailed, setRetryingFailed] = useState(false);

  const handleRetryFailed = useCallback(async () => {
    if (
      !accessToken ||
      !teamClient ||
      !selectedTeamId ||
      isSelectedSharedSession ||
      pauseResumeBusy
    ) {
      return;
    }
    setRetryingFailed(true);
    try {
      await teamClient.resumeAllRuntimeSessions(accessToken, selectedTeamId);
      refreshWorkspaceSnapshot();
      toast('已提交失败任务重试请求，正在断点续传…', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '重试失败任务时发生错误';
      toast(`重试失败：${message}`, 'error');
    } finally {
      setRetryingFailed(false);
    }
  }, [
    accessToken,
    isSelectedSharedSession,
    pauseResumeBusy,
    refreshWorkspaceSnapshot,
    selectedTeamId,
    teamClient,
  ]);

  const focusedHandoffEntry = useMemo(
    () => (focusedHandoffId ? (handoffs.get(focusedHandoffId) ?? null) : null),
    [focusedHandoffId, handoffs],
  );
  const conversationReceptionSessionId = useMemo(() => {
    if (!data.defaultReceptionSessionId) {
      return null;
    }
    const receptionSession = effectiveWorkspaceGroups
      .flatMap((group) => group.sessions)
      .find((session) => session.id === data.defaultReceptionSessionId);
    return receptionSession?.isSharedSession ? null : data.defaultReceptionSessionId;
  }, [data.defaultReceptionSessionId, effectiveWorkspaceGroups]);

  // 没有选中会话时，自动切到「对话」tab 显示欢迎页面。
  useEffect(() => {
    if (!selectedTeamId && middleTab !== 'conversation') {
      handleMiddleTabChange('conversation');
    }
  }, [handleMiddleTabChange, middleTab, selectedTeamId]);

  const focusSuggestedTab = useMemo<MiddleTabKey | null>(() => {
    if (!focusedHandoffEntry) return null;
    if (focusedHandoffEntry.toRoleLayer === 'pm2') return 'review';
    if (
      focusedHandoffEntry.toRoleLayer === 'executor' ||
      focusedHandoffEntry.toRoleLayer === 'reviewer'
    ) {
      return 'artifacts';
    }
    return 'health';
  }, [focusedHandoffEntry]);

  const lastActionFeedbackRef = useRef<string | null>(null);
  useEffect(() => {
    const feedback = data.feedback;
    if (!feedback) {
      lastActionFeedbackRef.current = null;
      return;
    }
    const key = `${feedback.tone}:${feedback.message}`;
    if (lastActionFeedbackRef.current === key) {
      return;
    }
    lastActionFeedbackRef.current = key;
    toast(feedback.message, feedback.tone);
  }, [data.feedback]);

  const renderTeamMiddleTabPanel = (targetMiddleTab: MiddleTabKey) => (
    <div
      key={`${targetMiddleTab}-${selectedTeamId}`}
      id={`middle-panel-${targetMiddleTab}`}
      role="tabpanel"
      aria-labelledby={`middle-tab-${targetMiddleTab}`}
      className="team-v2-panel-tab-content"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        flex: 1,
        minHeight: 0,
        overflow: 'hidden',
        background: 'var(--bg-base)',
        isolation: 'isolate',
      }}
    >
      {renderMiddleTabContent({
        middleTab: targetMiddleTab,
        selectedAgentId,
        selectedTeamId,
        selectedTeam,
        focusHandoffId: focusedHandoffId,
        officeSceneState,
        onSelectTeam: handleSelectTeam,
        onSelectAgent: handleSelectAgent,
        onOpenFullscreen: handleOpenFullscreen,
        onOpenClarifications: () => handleMiddleTabChange('artifacts'),
        onOpenHandoffContext: handleOpenHandoffContext,
        onOpenBlockingTarget: handleOpenBlockingTarget,
        onClearFocusedHandoff: () => setFocusedHandoffId(null),
        onSelectLayerSession: handleSelectLayerSession,
        onCancelHandoff: handleCancelHandoff,
        handoffs,
        gatewayUrl,
        accessToken,
        activeWorkspaceName: fileTreeWorkspacePath ?? undefined,
        onWorkspaceChanged: workspaceState.refresh,
        teamWorkspaceId: resolvedTeamWorkspaceId,
        onUseTemplate: handleOpenNewSessionModal,
        fileEditor,
        onSaveFile: handleSaveFile,
      })}
    </div>
  );

  const classicFailedHandoffs = useMemo(
    () => scopedHandoffs.filter((h) => h.state === 'failed'),
    [scopedHandoffs],
  );
  const classicRunningHandoffs = useMemo(
    () => scopedHandoffs.filter((h) => h.state === 'running' || h.state === 'claimed'),
    [scopedHandoffs],
  );
  const classicPendingClarifications = useMemo(() => {
    const pending = (clarificationItems ?? []).filter((item) => item.status === 'pending');
    if (!selectedRuntimeSessionScope) {
      // 未选中本地运行树会话时，不跨会话展示澄清，避免脏状态
      return selectedTeamId
        ? pending.filter(
            (item) => item.sessionId === selectedTeamId || item.fromSessionId === selectedTeamId,
          )
        : [];
    }
    return pending.filter(
      (item) =>
        selectedRuntimeSessionScope.has(item.sessionId) ||
        selectedRuntimeSessionScope.has(item.fromSessionId),
    );
  }, [clarificationItems, selectedRuntimeSessionScope, selectedTeamId]);

  const handleClassicFocusFail = useCallback(() => {
    // 优先滚到对话内联失败/澄清卡，否则滚到运营条 attention 锚点
    const inline = document.querySelector(
      '[data-team-classic-inline-cards] [data-team-attention-anchor="true"]',
    );
    const target =
      inline ??
      document.querySelector('[data-team-classic-ops-chrome] [data-team-attention-anchor="true"]');
    if (target instanceof HTMLElement) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, []);

  const handleClassicFocusWorkbench = useCallback(() => {
    if (effectiveFocusMode) {
      setFocusMode(false);
    }
    // 右侧任务台默认在 tasks tab；若中间主 tab 不在对话，classic 仍保持对话在左
  }, [effectiveFocusMode]);

  const handleClassicFillComposer = useCallback((text: string) => {
    // 与 TeamConversationView 监听的 composer-reference 事件对齐，填入输入框不直接发送
    if (typeof window === 'undefined') return;
    window.dispatchEvent(
      new CustomEvent('openawork:composer-reference', {
        detail: { text },
      }),
    );
  }, []);

  // 对话区只保留待处理/决策提示；状态与操作按钮统一在顶部 TeamStatusBar
  const classicOpsChrome =
    isClassicWorkbench && selectedTeamId && !isSelectedSharedSession ? (
      <ClassicTeamConversationOpsChrome
        failedHandoffs={classicFailedHandoffs}
        pendingClarifications={classicPendingClarifications}
        onFocusFail={handleClassicFocusFail}
      />
    ) : null;

  const classicInlineCards =
    isClassicWorkbench && selectedTeamId && !isSelectedSharedSession ? (
      <ClassicTeamConversationInlineCards
        failedHandoffs={classicFailedHandoffs}
        pendingClarifications={classicPendingClarifications}
        runningHandoffs={classicRunningHandoffs}
        onRetryFailed={canManageSelectedRuntimeTree ? handleRetryFailed : undefined}
        onFocusWorkbench={handleClassicFocusWorkbench}
        onFillComposer={handleClassicFillComposer}
      />
    ) : null;

  const conversationMessagesOverride = isSelectedSharedSession ? (
    <div
      style={{
        width: '100%',
        maxWidth: isClassicWorkbench ? undefined : 1080,
        margin: '0 auto',
        minHeight: 0,
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <TeamSharedConversationPanel
        key={selectedTeamId}
        selectedTeamTitle={selectedTeam?.title ?? null}
        selectedTeamSubtitle={selectedTeam?.subtitle ?? null}
        sharedSession={data.activeSharedSession}
        sharedSessionLoading={data.sharedSessionLoading}
        onOpenReview={() => handleMiddleTabChange('review')}
        onOpenShares={() => handleMiddleTabChange('shares')}
      />
    </div>
  ) : selectedTeamId && selectedTeamId !== conversationReceptionSessionId ? (
    <div
      style={{
        width: '100%',
        maxWidth: isClassicWorkbench ? undefined : 1080,
        margin: '0 auto',
        minHeight: 0,
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <TeamConversationView
        key={selectedTeamId}
        sessionId={selectedTeamId}
        composerEnabled={inboundComposerEnabled}
        classicWorkbench={isClassicWorkbench}
        beforeMessages={classicOpsChrome}
        afterMessages={classicInlineCards}
      />
    </div>
  ) : undefined;
  // classic-only：右侧 layer/todo 工作台；fusion 保持无侧栏（内容仍走中间主 tab）
  const classicLayerNodes = useMemo(() => Array.from(layerNodesMap.values()), [layerNodesMap]);
  // 右侧 layer/todo 工作台只挂在「对话」相关中间区；其它主 tab 必须回到中间内容切换
  const classicConversationSurface = middleTab === 'conversation' || middleTab === 'office';
  const workbenchSidePanel =
    isClassicWorkbench && classicConversationSurface && !effectiveFocusMode && !isMobile ? (
      <ClassicTeamLayerTodoSidePanel
        handoffs={scopedHandoffs}
        layerNodes={classicLayerNodes}
        taskLanes={data.taskLanes}
        overviewSlot={renderTeamMiddleTabPanel(getDefaultLeafFor('overview'))}
        metricsSlot={renderTeamMiddleTabPanel(getDefaultLeafFor('metrics'))}
        governanceSlot={renderTeamMiddleTabPanel(getDefaultLeafFor('governance'))}
      />
    ) : undefined;
  // 注意：不得因 classic 布局锁死对话区，否则顶部主 tab / 子 tab 会失效
  const conversationAreaMessagesOverride =
    middleTab === 'conversation' || middleTab === 'office'
      ? conversationMessagesOverride
      : renderTeamMiddleTabPanel(middleTab);

  return (
    <TeamRuntimeReferenceDataProvider value={data}>
      <div
        className="page-root team-v2-root"
        aria-label="团队运行 V2"
        data-mode={effectiveMode}
        data-breakpoint={breakpoint}
        data-workbench-layout={workbenchLayoutMode}
        style={{ position: 'relative' }}
      >
        <TeamPageV2RuntimeNotices
          canManageSelectedRuntimeTree={canManageSelectedRuntimeTree}
          effectiveMode={effectiveMode}
          isMobile={isMobile}
          pauseResumeBusy={pauseResumeBusy}
          runtimeControlError={runtimeControlError}
          runtimeResumeNotice={runtimeResumeNotice}
          onRequestResumeAll={handleRequestResumeAll}
        />

        <main className="team-v2-main-shell" style={mainGridStyle}>
          {/* 中：对话区（紧凑流程栏已并入「概览 / 拓扑」子 tab） */}
          <section
            className="team-v2-pane team-v2-pane--main"
            style={{ ...LEFT_AREA_STYLE, position: 'relative' }}
          >
            {/* classic 工作台：失败诊断/专注按钮改由左侧 ops chrome 承载，去掉旧浮动控件 */}
            {!isClassicWorkbench && failedTaskCount > 0 && !isSelectedSharedSession ? (
              <ErrorDiagnosticsPanel
                failedHandoffs={scopedHandoffs}
                selectedTeam={selectedTeam}
                onRetryFailed={canManageSelectedRuntimeTree ? handleRetryFailed : undefined}
                retrying={retryingFailed}
              />
            ) : null}

            {/* 专注模式切换按钮（classic 用 ChatOpsBar「专注对话」） */}
            {!isClassicWorkbench && !isMobile ? (
              <button
                type="button"
                onClick={handleToggleFocusMode}
                title={effectiveFocusMode ? '退出专注模式' : '进入专注模式（收起侧栏）'}
                aria-label={effectiveFocusMode ? '退出专注模式' : '进入专注模式'}
                style={{
                  position: 'absolute',
                  bottom: 8,
                  right: 8,
                  zIndex: 10,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 28,
                  height: 28,
                  borderRadius: 8,
                  border: '1px solid color-mix(in srgb, var(--border-default) 40%, transparent)',
                  background: 'var(--bg-overlay)',
                  color: 'var(--fg-muted)',
                  fontSize: 14,
                  cursor: 'pointer',
                  flexShrink: 0,
                  boxShadow: 'var(--shadow-sm)',
                  transition: 'background 120ms ease, color 120ms ease',
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
                  {effectiveFocusMode ? (
                    <>
                      <path d="M8 3v5H3" />
                      <path d="M16 3v5h5" />
                      <path d="M8 21v-5H3" />
                      <path d="M16 21v-5h5" />
                    </>
                  ) : (
                    <>
                      <path d="M3 8V3h5" />
                      <path d="M21 8V3h-5" />
                      <path d="M3 16v5h5" />
                      <path d="M21 16v5h-5" />
                    </>
                  )}
                </svg>
              </button>
            ) : null}

            {/* 智能输入引导气泡（classic 由 ops/inline cards 替代，避免双套引导） */}
            {!isClassicWorkbench &&
            selectedTeamId &&
            (suggestionContext === 'failure' || suggestionContext === 'idle') &&
            !suggestionDismissed &&
            !isMobile ? (
              <SmartSuggestionBubble
                context={suggestionContext}
                failedCount={failedTaskCount}
                onSelectSuggestion={data.canManageSessionEntries ? handleSubmitMessage : undefined}
                onDismiss={() => setSuggestionDismissed(true)}
              />
            ) : null}

            <div
              style={
                teamEditorMode === 'split' && editorOverlayOpen
                  ? {
                      flex: 1,
                      minHeight: 0,
                      display: 'flex',
                      flexDirection: 'row',
                      overflow: 'hidden',
                    }
                  : {
                      flex: 1,
                      minHeight: 0,
                      display: 'flex',
                      flexDirection: 'column',
                      // 必须 overflow:hidden —— 下层 ConversationArea 内部的
                      // TeamConversationLayout 返回 fragment，内容直接拍平进本容器。
                      // 若不设 overflow，column flex 子项的最小高度会取内容高度，
                      // 导致滚动区不收缩、composer 被推出视口且无法滚动。
                      overflow: 'hidden',
                    }
              }
            >
              <div
                style={
                  teamEditorMode === 'split' && editorOverlayOpen
                    ? {
                        flex: 1,
                        minWidth: 0,
                        display: 'flex',
                        flexDirection: 'column',
                        overflow: 'hidden',
                      }
                    : {
                        flex: 1,
                        minWidth: 0,
                        display: 'flex',
                        flexDirection: 'column',
                        overflow: 'hidden',
                      }
                }
              >
                <ConversationArea
                  canCreateSession={Boolean(
                    data.canManageSessionEntries &&
                    data.canCreateSession &&
                    resolvedTeamWorkspaceId,
                  )}
                  canCreateWorkspace={canCreateWorkspace}
                  workspaceLabel={selectedTeamId ? teamWorkspaceDisplayName : null}
                  onCreateWorkspace={
                    canCreateWorkspace ? () => setShowNewWorkspaceModal(true) : undefined
                  }
                  onNewSession={
                    data.canManageSessionEntries ? () => handleOpenNewSessionModal() : undefined
                  }
                  onSelectSuggestion={
                    data.canManageSessionEntries ? handleSubmitMessage : undefined
                  }
                  onSubmitMessage={data.canManageSessionEntries ? handleSubmitMessage : undefined}
                  onRetryConnection={handleRetryConnection}
                  receptionSessionId={selectedTeamId ? conversationReceptionSessionId : null}
                  receptionComposerEnabled={true}
                  classicWorkbench={isClassicWorkbench}
                  conversationBeforeMessages={
                    // reception 内嵌路径也挂 classic 运营条；子 session 覆盖路径在 messagesOverride 内已注入
                    classicOpsChrome &&
                    selectedTeamId &&
                    selectedTeamId === conversationReceptionSessionId
                      ? classicOpsChrome
                      : undefined
                  }
                  conversationAfterMessages={
                    classicInlineCards &&
                    selectedTeamId &&
                    selectedTeamId === conversationReceptionSessionId
                      ? classicInlineCards
                      : undefined
                  }
                  topBar={
                    selectedTeamId ? (
                      <>
                        <TeamTabBar
                          variant="single"
                          activePrimary={activePrimary}
                          middleTab={middleTab}
                          onPrimaryChange={handlePrimaryTabChange}
                          onMiddleChange={handleMiddleTabChange}
                          unreadCount={scopedUnreadCount}
                          clarificationPending={clarificationPending}
                          failedTaskCount={failedTaskCount}
                          showOffice={showOffice}
                          officeActive={middleTab === 'office'}
                          onOfficeClick={() => {
                            if (middleTab === 'office') {
                              handleOpenFullscreen();
                            } else {
                              handleMiddleTabChange('office');
                            }
                          }}
                          leadingSlot={
                            !isMobile ? (
                              <TeamPageSuperbarLeading
                                activeWorkspaceId={resolvedTeamWorkspaceId}
                                activeWorkspaceName={teamWorkspaceDisplayName}
                                compact={
                                  isFusionWorkbench ||
                                  isClassicWorkbench ||
                                  breakpoint !== 'desktop'
                                }
                                memberCount={data.topSummary.memberCount}
                                onlineCount={data.topSummary.onlineCount}
                                selectedTeam={selectedTeam}
                                summaryDescription={data.topSummary.description}
                                workspaces={workspaceState.workspaces}
                              />
                            ) : null
                          }
                          // classic：状态/操作按钮放最顶上下文行 trailing，避免第二行堆叠
                          // fusion/其它：保持 centerSlot 状态栏 + trailing 摘要
                          centerSlot={
                            !isMobile && !isClassicWorkbench ? (
                              <div
                                className="team-v2-control team-v2-control--transparent"
                                style={SUPERBAR_STATUS_TRIGGER_STYLE}
                                onClick={handleStatusBarClick}
                                role="button"
                                tabIndex={0}
                                aria-label="展开层级对话抽屉"
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault();
                                    setDrawerVisible(true);
                                  }
                                }}
                              >
                                <TeamStatusBar
                                  paused={effectiveMode === 'paused'}
                                  busy={pauseResumeBusy}
                                  selectedSessionId={selectedTeamId || null}
                                  onPauseAll={
                                    canManageSelectedRuntimeTree ? handlePauseAll : undefined
                                  }
                                  onResumeAll={
                                    canManageSelectedRuntimeTree
                                      ? handleRequestResumeAll
                                      : undefined
                                  }
                                />
                              </div>
                            ) : null
                          }
                          stackCenterSlot={
                            // classic 不把状态挤到第二行；tablet/fusion 仍可 stack
                            isClassicWorkbench ? false : isTablet || isFusionWorkbench
                          }
                          hideRunStatePill={isClassicWorkbench}
                          trailingSlot={
                            !isMobile ? (
                              isClassicWorkbench ? (
                                <div
                                  className="team-v2-classic-top-actions"
                                  data-testid="team-classic-top-actions"
                                >
                                  <TeamStatusBar
                                    paused={effectiveMode === 'paused'}
                                    busy={pauseResumeBusy || retryingFailed}
                                    selectedSessionId={selectedTeamId || null}
                                    failCount={failedTaskCount}
                                    focusMode={effectiveFocusMode}
                                    onPauseAll={
                                      canManageSelectedRuntimeTree ? handlePauseAll : undefined
                                    }
                                    onResumeAll={
                                      canManageSelectedRuntimeTree
                                        ? handleRequestResumeAll
                                        : undefined
                                    }
                                    onRetryFailed={
                                      canManageSelectedRuntimeTree ? handleRetryFailed : undefined
                                    }
                                    onFocusFail={handleClassicFocusFail}
                                    onToggleFocus={handleToggleFocusMode}
                                  />
                                </div>
                              ) : isFusionWorkbench ? (
                                <TeamFusionSuperbarSummary
                                  description={data.topSummary.description}
                                  footerLead={data.footerLead}
                                  footerStats={data.footerStats}
                                />
                              ) : (
                                <TeamPageSuperbarSummary
                                  description={data.topSummary.description}
                                  footerLead={data.footerLead}
                                  footerStats={data.footerStats}
                                />
                              )
                            ) : null
                          }
                        />
                        {focusedHandoffId ? (
                          <TeamFocusHandoffBanner
                            focusHandoffId={focusedHandoffId}
                            entry={focusedHandoffEntry}
                            suggestedTab={focusSuggestedTab}
                            onSelectTab={handleMiddleTabChange}
                            onClear={() => setFocusedHandoffId(null)}
                          />
                        ) : null}
                      </>
                    ) : null
                  }
                  messagesOverride={conversationAreaMessagesOverride}
                  sidePanel={workbenchSidePanel}
                  fallbackContent={
                    // 对话主 tab：依赖 chat 流自身的视觉，不再额外注入 IdleHint
                    // 与 EmptyState（避免在已经有 composer / 接待对话流的页面下方
                    // 再堆一段「团队待命中」的 hero 卡）。
                    middleTab === 'conversation' ? null : effectiveMode === 'idle' ? (
                      <IdleHint />
                    ) : effectiveMode === 'paused' ? null : (
                      <div
                        style={{
                          fontSize: 12,
                          color: 'var(--fg-muted)',
                          padding: 12,
                          fontStyle: 'italic',
                        }}
                      >
                        暂无更多消息。任务执行中…
                      </div>
                    )
                  }
                />
              </div>

              <WorkspaceEditorOverlay
                open={editorOverlayOpen}
                onClose={() => setEditorOverlayOpen(false)}
                workspacePath={editorWorkspacePath}
                fileEditor={fileEditor}
                saving={savingFile}
                onSave={handleSaveFile}
                browserPreviewUrl={browserPreviewUrl}
                activeTab={editorPaneTab}
                onTabChange={setEditorPaneTab}
                mode={teamEditorMode}
                splitPos={teamSplitPos}
                onSplitPosChange={setTeamSplitPos}
                onModeChange={setTeamEditorMode}
              />
            </div>
          </section>
        </main>

        {/* classic 弃用底部「层级对话」面板；fusion 保留 */}
        {!isClassicWorkbench ? (
          <LayerConversationDrawer
            visible={drawerVisible}
            onClose={() => setDrawerVisible(false)}
          />
        ) : null}
        <PauseConfirmDialog
          open={showPauseConfirm}
          activeCount={activeHandoffCount}
          onConfirm={() => void handleConfirmPauseAll()}
          onCancel={() => setShowPauseConfirm(false)}
        />
        <ResumeStaleDialog
          open={showResumeStale}
          staleCount={staleHandoffCount}
          onResumeAll={() => void handleResumeAll()}
          onDismiss={() => setShowResumeStale(false)}
        />
        {showNewSessionModal && resolvedTeamWorkspaceId ? (
          <NewTeamSessionModal
            onClose={() => {
              setShowNewSessionModal(false);
              setInitialTemplateId(null);
              setInitialWorkingDirectory(null);
            }}
            onSubmitDraft={handleSubmitDraft}
            workspaceLabel={teamWorkspaceDisplayName}
            teamWorkspaceId={resolvedTeamWorkspaceId}
            defaultMemberSlots={workspaceState.activeWorkspace?.defaultTeamRoster}
            initialTemplateId={initialTemplateId}
            initialWorkingDirectory={initialWorkingDirectory}
          />
        ) : null}

        {showNewWorkspaceModal ? (
          <NewTeamWorkspaceModal
            onClose={() => {
              setShowNewWorkspaceModal(false);
              clearNewWorkspaceAction();
            }}
            onCreated={(newWorkspaceId) => {
              workspaceState.refresh();
              requestSessionListRefresh();
              if (newWorkspaceId) {
                navigate(`/team/${newWorkspaceId}`);
              }
            }}
          />
        ) : null}

        {deleteWorkspaceTarget ? (
          <ConfirmDeleteWorkspaceModal
            workspace={deleteWorkspaceTarget}
            workspaceGroups={effectiveWorkspaceGroups}
            onCancel={() => setDeleteWorkspaceTarget(null)}
            onConfirm={async () => {
              const target = deleteWorkspaceTarget;
              if (!target) return false;
              const ok = await data.deleteWorkspace(target.id);
              if (!ok) return false;
              setDeleteWorkspaceTarget(null);
              // 若删除的是当前激活工作区，切换到第一个剩余工作区
              if (target.id === resolvedTeamWorkspaceId) {
                const next = workspaceState.workspaces.find((ws) => ws.id !== target.id);
                if (next) {
                  navigate(`/team/${next.id}`, { replace: true });
                } else {
                  navigate('/team', { replace: true });
                }
              }
              return true;
            }}
          />
        ) : null}

        {showOfficeFullscreen ? (
          <div
            className="team-v2-fullscreen-shell"
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 100,
              display: 'flex',
              flexDirection: 'column',
            }}
            role="dialog"
            aria-label="3D 全屏视图"
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-end',
                padding: '8px 16px',
                borderBottom: '1px solid var(--border-default)',
                flexShrink: 0,
              }}
            >
              <button
                type="button"
                onClick={() => setShowOfficeFullscreen(false)}
                style={{
                  padding: '6px 14px',
                  borderRadius: 8,
                  border: '1px solid color-mix(in srgb, var(--border-default) 60%, transparent)',
                  background: 'var(--bg-overlay)',
                  color: 'var(--fg-strong)',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
                aria-label="关闭全屏"
              >
                ESC 关闭
              </button>
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
              <OfficeThreeCanvas
                selectedAgentId={selectedAgentId}
                runtimeStatus={selectedTeam?.status ?? null}
                selectedSessionTitle={selectedTeam?.title ?? null}
                onSelectAgent={handleSelectAgent}
                state={officeSceneState}
              />
            </div>
          </div>
        ) : null}
      </div>
    </TeamRuntimeReferenceDataProvider>
  );
}
