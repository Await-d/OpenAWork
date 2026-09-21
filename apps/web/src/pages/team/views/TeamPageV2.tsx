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
import { useTeamSessionViewState } from '../hooks/use-team-session-view-state.js';
import { useTeamMiddleArea } from '../hooks/use-team-middle-area.js';
import { useTeamEditorOverlay } from '../hooks/use-team-editor-overlay.js';
import { useTeamOfficeScene } from '../hooks/use-team-office-scene.js';
import { TeamSessionViewStateProvider } from '../hooks/team-session-view-state-context.js';
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
import type { MiddleTabKey } from '../runtime/tabs/MiddleTabRouter.js';
import {
  extractTeamRuntimeHandoffContextFromEvent,
  type TeamRuntimeHandoffContextInput,
} from '../runtime/tabs/team-runtime-navigation.js';
import {
  LEAF_TO_PRIMARY,
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
import {
  filterActiveAuditEntries,
  useRollbackVoidWindows,
} from '../../../stores/team/rollback-tombstones.js';
import type { HandoffEvent } from '../../../stores/team/team-events.js';
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
  isSessionInScope,
} from '../runtime/data/team-runtime-session-scope.js';
import { toast } from '../../../components/common/feedback/ToastNotification.js';
import { usePageActivation } from '../../../components/common/routing/CachedRouteOutlet.js';
import { requestSessionListRefresh } from '../../../utils/session/session-list-events.js';
import { isPathWithinRoot } from '../../../utils/workspace-path.js';
import { useLinkPreviewRequest } from '../../../utils/preview/use-link-preview-request.js';
import {
  TeamFocusHandoffBanner,
  TeamPageSuperbarLeading,
  TeamPageSuperbarSummary,
} from './team-page-v2-panels.js';
import {
  buildRuntimeResumeResumingNotice,
  buildRuntimeResumeSubmittedNotice,
  type RuntimeResumeNotice,
} from './team-page-v2-runtime-resume-notice.js';
import { resolveMatchedSharedSessionDetail } from '../runtime/data/team-runtime-shared-context.js';
import { TeamPageV2RuntimeNotices } from './TeamPageV2RuntimeNotices.js';
import { TeamPageMiddleArea } from './TeamPageMiddleArea.js';
import { TeamPageOfficeScene } from './TeamPageOfficeScene.js';
import { TeamFusionSuperbarSummary } from './TeamFusionSuperbarSummary.js';
import {
  buildTeamSessionRoute,
  resolveTeamSessionFromRoute,
  resolveTeamSessionWorkspacePath,
  resolveTeamWorkspaceIdForWorkspacePath,
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
  // basis auto：让外层收缩型容器（team-tab-bar__center）能按内容算出宽度；
  // 三栏同行时该块再吸收容器内剩余空间。
  flex: '1 1 auto',
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
  /**
   * 会话视图 / tab 记忆（焦点模式、办公全屏、编辑器浮层、层级抽屉、选中角色、
   * middleTab 与「主 tab → 叶子」记忆）现已按会话作用域由 useTeamSessionViewState
   * 持有并写盘；TeamPageV2 本身不得再读写这些字段，也不得在切换会话 / 回欢迎页时
   * 手动 reset——那样写入会落在「上一个会话」的条目里，抹掉它自己的记忆。
   */
  const viewState = useTeamSessionViewState({ sessionId: selectedTeamId || null });
  const {
    middleTab,
    setMiddleTab,
    readRememberedLeaf,
    rememberLeaf,
    selectedAgentId,
    setSelectedAgentId,
    drawerVisible,
    setDrawerVisible,
    drawerTarget,
    setDrawerTarget,
    focusMode,
    setFocusMode,
    setShowOfficeFullscreen,
  } = viewState;
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
  /** 跨会话跳转时，等目标会话装载完再应用一次的 tab 意图。 */
  const pendingMiddleTabRef = useRef<{ sessionId: string; tab: MiddleTabKey } | null>(null);
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
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [selectedWorkspacePath, setSelectedWorkspacePath] = useState<string | null>(null);
  const [focusedHandoffId, setFocusedHandoffId] = useState<string | null>(null);
  const [dismissingFailedHandoffIds, setDismissingFailedHandoffIds] = useState<readonly string[]>(
    [],
  );
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
  const rollbackVoidWindows = useRollbackVoidWindows();
  const layerNodesMap = useLayerStore((s) => s.nodes);
  const notificationEvents = useTeamNotificationStore((s) => s.events);
  const readEventKeys = useTeamNotificationStore((s) => s.readEventKeys);
  const globalUnreadCount = useTeamNotificationStore((s) => s.unreadCount);
  const clarificationPending = useClarificationStore((s) => s.pendingCount);
  const clarificationItems = useClarificationStore((s) => s.items);
  // 3D 场景状态 + 办公全屏开关（ESC 退出）收敛到 useTeamOfficeScene；
  // officeSceneState 同时供中间区与全屏视图共享。
  const officeScene = useTeamOfficeScene({ viewState });
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

  // 跨会话跳转时（例如点开 handoff 卡片）记录下来的 tab 意图：要等目标会话真正装载完
  // 再应用。立即 setMiddleTab 会写进旧会话作用域，并被目标会话的作用域装载覆盖。
  useEffect(() => {
    const pending = pendingMiddleTabRef.current;
    if (!pending || pending.sessionId !== selectedTeamId) {
      return;
    }
    pendingMiddleTabRef.current = null;
    setMiddleTab(pending.tab);
  }, [selectedTeamId, setMiddleTab]);

  // 抽屉目标归属守卫：恢复出来的 drawerTarget 是角色实例子会话，必须落在当前选中
  // 会话的子树内。数据尚未加载完时保守等待，确认越界才关闭抽屉并清空目标。
  useEffect(() => {
    if (!drawerTarget) return;
    if (data.sessions.length === 0) return; // 运行时会话尚未加载，等下一轮再判定
    const scope = collectSessionScope(selectedTeamId || null, data.sessions);
    if (scope.size <= 1) return; // 只有根会话，说明子树还没加载出来，保守等待
    if (isSessionInScope(drawerTarget.sessionId, scope)) return;
    setDrawerVisible(false);
    setDrawerTarget(null);
  }, [data.sessions, drawerTarget, selectedTeamId, setDrawerTarget, setDrawerVisible]);

  useEffect(() => {
    if (selectedTeamId || !data.workspaceGroups.length) {
      return;
    }
    const requestedSessionId = searchParams.get('sessionId');
    const routeSessionId = resolveTeamSessionFromRoute({
      defaultSessionId: teamWorkspaceId ? data.defaultSelectedTeamId : '',
      groups: data.workspaceGroups,
      requestedSessionId,
    });
    if (!routeSessionId) {
      return;
    }
    userSelectedTeamRef.current = true;
    setSelectedTeamId(routeSessionId);
    data.selectTeam(routeSessionId);
    if (!teamWorkspaceId) {
      // /team 入口下 URL 缺少工作区 id：反推会话归属的工作区并写入路径，
      // 否则刷新会退回到默认欢迎页。反推失败时退回只规范化 sessionId。
      const derivedWorkspaceId = resolveTeamWorkspaceIdForWorkspacePath({
        workspacePath: resolveTeamSessionWorkspacePath({
          groups: data.workspaceGroups,
          sessionId: routeSessionId,
        }),
        workspaces: workspaceState.workspaces,
      });
      if (derivedWorkspaceId) {
        navigate(buildTeamSessionRoute(derivedWorkspaceId, routeSessionId), { replace: true });
        return;
      }
    }
    if (requestedSessionId !== routeSessionId) {
      const nextSearchParams = new URLSearchParams(searchParams);
      nextSearchParams.set('sessionId', routeSessionId);
      setSearchParams(nextSearchParams, { replace: true });
    }
  }, [
    data.defaultSelectedTeamId,
    data.selectTeam,
    data.workspaceGroups,
    navigate,
    searchParams,
    selectedTeamId,
    setSearchParams,
    teamWorkspaceId,
    workspaceState.workspaces,
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
  const scopedHandoffs = useMemo(() => {
    if (!selectedRuntimeSessionScope) {
      return [];
    }
    const scoped = Array.from(handoffs.values()).filter((handoff) =>
      isHandoffInSessionScope(handoff, selectedRuntimeSessionScope),
    );
    // 被回退回合的 handoff 不再参与任何派生态（失败计数 / 内联诊断卡 / 状态条）。
    return filterActiveAuditEntries(scoped, rollbackVoidWindows);
  }, [handoffs, rollbackVoidWindows, selectedRuntimeSessionScope]);
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
  /**
   * 失败项的处置权限（重试 / 关闭）：只反映归属与权限，**不含**会话运行状态。
   * failed 态恰恰是最需要「关闭」入口的场景，不能再被 canManageSelectedRuntimeTree
   * 的 completed/failed 排除条件挡住。
   */
  const canActOnRuntimeFailures =
    data.canManageRuntime && Boolean(accessToken && selectedTeamId && !isSelectedSharedSession);

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
      // 这里刻意不再强制 middleTab / 关闭浮层与抽屉：这些状态按会话记忆，由
      // useTeamSessionViewState 在作用域切换时装载；此处写入会落在「上一个会话」的
      // 条目里，抹掉它自己的记忆。没有记忆的新会话默认就是 conversation。
      if (isMobile) {
        setMobileSidebarOpen(false);
      }

      // 侧边栏现在显示所有工作区的会话。如果选中的会话属于其他工作区，
      // 自动切换 URL 到那个工作区，让 activeWorkspace / snapshot / 文件树
      // 全部跟随切换。跨工作区切换时先清空 selectedTeamId，避免新工作区
      // 数据加载完成前用旧工作区的 sessionId 去加载对话内容。
      const sessionWorkspaceId =
        resolveTeamWorkspaceIdForWorkspacePath({
          workspacePath: resolveTeamSessionWorkspacePath({
            groups: data.workspaceGroups,
            sessionId: teamId,
          }),
          workspaces: workspaceState.workspaces,
        }) ?? resolvedTeamWorkspaceId;
      let isCrossWorkspaceNavigation = false;
      if (sessionWorkspaceId && sessionWorkspaceId !== resolvedTeamWorkspaceId) {
        navigate(buildTeamSessionRoute(sessionWorkspaceId, teamId));
        isCrossWorkspaceNavigation = true;
        // 先记住用户想选的会话，等新工作区数据加载后再恢复
        pendingSelectedTeamIdRef.current = teamId;
        userSelectedTeamRef.current = true;
        setSelectedTeamId('');
      }

      if (!isCrossWorkspaceNavigation) {
        setSelectedTeamId(teamId);
        data.selectTeam(teamId);
        if (!teamWorkspaceId && sessionWorkspaceId) {
          // /team 入口下必须把工作区写进路径，刷新后才能恢复选中的会话。
          navigate(buildTeamSessionRoute(sessionWorkspaceId, teamId), { replace: true });
        } else if (sessionWorkspaceId) {
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
      teamWorkspaceId,
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
    // 回欢迎页要一并取消未完成的跨工作区恢复，否则它会把页面重新拉回刚才的会话。
    pendingSelectedTeamIdRef.current = null;
    setSelectedTeamId('');
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

  const handleMiddleTabChange = useCallback(
    (next: MiddleTabKey) => {
      // 只切换 tab；「主 tab → 叶子」记忆由 useTeamSessionViewState 的 setMiddleTab 记录。
      setMiddleTab(next);
    },
    [setMiddleTab],
  );

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
      if (sessionId && sessionId !== selectedTeamId) {
        // 同一事件里既切会话又指定 tab：立即 setMiddleTab 会落到旧会话作用域，并被
        // 目标会话的作用域装载覆盖，因此先记下意图，等 selectedTeamId 切换后再应用。
        pendingMiddleTabRef.current = { sessionId, tab: preferredTab };
        return;
      }
      handleMiddleTabChange(preferredTab);
    },
    [data.workspaceGroups, handleMiddleTabChange, selectTeamInternal, selectedTeamId],
  );

  const handleOpenBlockingTarget = useCallback(
    (event: HandoffEvent) => {
      handleOpenHandoffContext(extractTeamRuntimeHandoffContextFromEvent(event));
    },
    [handleOpenHandoffContext],
  );

  /**
   * 打开某个角色实例的完整会话 —— 卡片墙「完整会话」入口的落点。
   *
   * 刻意**不**把 `selectedTeamId` 切到这个子会话，而是打开底部「层级对话」抽屉：
   * 角色实例是子会话，正常情况下不在 workspaceGroups 里，而整页的 runtime 控件、
   * 文件树根、ops chrome 都建立在「selectedTeamId 一定在 workspaceGroups 中」这条
   * 不变式上（见 selectedTeam / effectiveWorkspaceGroups / 纠偏 effect）。为一个
   * 卡片按钮去破坏这条不变式，会让暂停/恢复、任务清单等一起偏离语义；而且刷新后
   * URL 里的 sessionId 会被 resolveTeamSessionFromRoute 判为无效又跳回默认会话。
   * 抽屉是自带会话上下文的自足面板，既不扰动页面作用域，又真的能看到完整对话。
   */
  const handleOpenRoleSession = useCallback((sessionId: string) => {
    // classic 工作台弃用底部「层级对话」抽屉（该布局下卡片墙本身也不可达）
    if (useUIStateStore.getState().workbenchLayoutMode === 'classic') return;
    if (!sessionId) return;
    setDrawerTarget({ sessionId, nonce: Date.now() });
    setDrawerVisible(true);
  }, []);

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
      // 切主 tab 时：若当前 leaf 已属于该主 tab，则保留 leaf；
      // 否则优先恢复该主 tab 上次停留的子视图，无记忆时回落到默认子 tab。
      if (LEAF_TO_PRIMARY.get(middleTab) === next) return;
      handleMiddleTabChange(readRememberedLeaf(next) ?? getDefaultLeafFor(next));
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

  const handleDismissFailedHandoffs = useCallback(
    (handoffIds: readonly string[]) => {
      if (!handoffsClient || !accessToken || handoffIds.length === 0) return;
      setDismissingFailedHandoffIds(handoffIds);
      void Promise.all(handoffIds.map((id) => handoffsClient.dismissFailedHandoff(accessToken, id)))
        .then((results) => {
          const failedResult = results.find((result) => !result.ok);
          if (!failedResult) {
            toast(
              handoffIds.length > 1 ? `已关闭 ${handoffIds.length} 条失败项` : '已关闭失败项',
              'success',
            );
            return;
          }
          const message =
            failedResult.errorMessage ??
            (failedResult.state ? `当前状态：${failedResult.state}` : '未知错误');
          console.error('[TeamPageV2] dismiss failed handoff failed:', handoffIds, message);
          toast(`关闭失败项失败：${message}`, 'error');
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : '未知错误';
          console.error('[TeamPageV2] dismiss failed handoff request failed:', handoffIds, message);
          toast(`关闭失败项失败：${message}`, 'error');
        })
        .finally(() => {
          setDismissingFailedHandoffIds([]);
          refreshWorkspaceSnapshot();
        });
    },
    [handoffsClient, accessToken, refreshWorkspaceSnapshot],
  );

  const handleOpenFullscreen = useCallback(() => {
    setShowOfficeFullscreen(true);
  }, []);

  // 文件目录点击 → 编辑器浮层。文件状态 / 浮层开关 / pane / 预览地址的接线已收敛到
  // useTeamEditorOverlay。viewState 显式注入：本组件自己渲染
  // <TeamSessionViewStateProvider>，组件体不在该 Provider 内，读不到 context。
  const editorWorkspacePath = workspaceState.activeWorkspace?.defaultWorkingRoot ?? null;
  const editorOverlay = useTeamEditorOverlay({
    workspacePath: editorWorkspacePath,
    isMobile,
    setMobileSidebarOpen,
    viewState,
  });

  // 团队页 markdown 链接点击 → 打开编辑器浮层的浏览器预览（与既有
  // `openawork:browser:open-url` 行为一致，但只在本页激活时认领）。
  useLinkPreviewRequest(pageActive, editorOverlay.openBrowserPreview);

  const workbenchLayoutMode = useUIStateStore((s) => s.workbenchLayoutMode);
  const isFusionWorkbench = workbenchLayoutMode === 'fusion';
  const isClassicWorkbench = workbenchLayoutMode === 'classic';
  // 全局侧栏（classic 的 AppSidebar / fusion 的 FusionSidebar）已承载「团队会话」段，
  // 团队页自己的左侧栏现仅渲染文件树（会话列表已从该栏彻底移除，而非隐藏）。
  const shellCollapsed = effectiveSidebarCollapsed;

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

  // 中间区装配（数据 / 可见性 / 回调）收敛到 useTeamMiddleArea，节点组装见 TeamPageMiddleArea
  const middleArea = useTeamMiddleArea({
    accessToken,
    clarificationItems,
    data,
    effectiveFocusMode,
    effectiveMode,
    effectiveWorkspaceGroups,
    isClassicWorkbench,
    isMobile,
    isSelectedSharedSession,
    layerNodesMap,
    middleTab,
    pauseResumeBusy,
    refreshWorkspaceSnapshot,
    scopedHandoffs,
    selectedRuntimeSessionScope,
    selectedTeam,
    selectedTeamId,
    setFocusMode,
    teamClient,
  });
  const { failedTaskCount, retryingFailed, handleRetryFailed, handleClassicFocusFail } = middleArea;

  const focusedHandoffEntry = useMemo(
    () => (focusedHandoffId ? (handoffs.get(focusedHandoffId) ?? null) : null),
    [focusedHandoffId, handoffs],
  );

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

  return (
    <TeamRuntimeReferenceDataProvider value={data}>
      <TeamSessionViewStateProvider value={viewState}>
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
            <TeamPageMiddleArea
              accessToken={accessToken}
              canActOnRuntimeFailures={canActOnRuntimeFailures}
              canCreateWorkspace={canCreateWorkspace}
              canManageSelectedRuntimeTree={canManageSelectedRuntimeTree}
              data={data}
              dismissingHandoffIds={dismissingFailedHandoffIds}
              editorOverlay={editorOverlay}
              effectiveFocusMode={effectiveFocusMode}
              effectiveMode={effectiveMode}
              fileTreeWorkspacePath={fileTreeWorkspacePath}
              focusedHandoffId={focusedHandoffId}
              gatewayUrl={gatewayUrl}
              handoffs={handoffs}
              inboundComposerEnabled={inboundComposerEnabled}
              isClassicWorkbench={isClassicWorkbench}
              isMobile={isMobile}
              middleArea={middleArea}
              middleTab={middleTab}
              officeSceneState={officeScene.officeSceneState}
              onCancelHandoff={handleCancelHandoff}
              onClearFocusedHandoff={() => setFocusedHandoffId(null)}
              onDismissFailed={handleDismissFailedHandoffs}
              onMiddleTabChange={handleMiddleTabChange}
              onOpenBlockingTarget={handleOpenBlockingTarget}
              onOpenFullscreen={handleOpenFullscreen}
              onOpenHandoffContext={handleOpenHandoffContext}
              onOpenNewSessionModal={handleOpenNewSessionModal}
              onOpenNewWorkspaceModal={() => setShowNewWorkspaceModal(true)}
              onOpenSession={handleOpenRoleSession}
              onRetryConnection={handleRetryConnection}
              onSelectAgent={handleSelectAgent}
              onSelectLayerSession={handleSelectLayerSession}
              onSelectTeam={handleSelectTeam}
              onSubmitMessage={handleSubmitMessage}
              onToggleFocusMode={handleToggleFocusMode}
              onWorkspaceChanged={workspaceState.refresh}
              resolvedTeamWorkspaceId={resolvedTeamWorkspaceId}
              scopedHandoffs={scopedHandoffs}
              selectedAgentId={selectedAgentId}
              selectedTeam={selectedTeam}
              selectedTeamId={selectedTeamId}
              teamWorkspaceDisplayName={teamWorkspaceDisplayName}
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
                              isFusionWorkbench || isClassicWorkbench || breakpoint !== 'desktop'
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
                              onPauseAll={canManageSelectedRuntimeTree ? handlePauseAll : undefined}
                              onResumeAll={
                                canManageSelectedRuntimeTree ? handleRequestResumeAll : undefined
                              }
                            />
                          </div>
                        ) : null
                      }
                      stackCenterSlot={
                        // desktop（含 fusion）优先把「运行状态 + 操作」合并进
                        // 上下文行，与 leading/trailing 三栏同行，压缩顶部纵向占据；
                        // 宽度不足时由 TeamTabBar 内部按实测宽度自动降级。
                        // tablet 窄屏直接强制独立状态行。
                        isTablet
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
                                  canManageSelectedRuntimeTree ? handleRequestResumeAll : undefined
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
            />
          </main>

          {/* classic 弃用底部「层级对话」面板；fusion 保留 */}
          {!isClassicWorkbench ? (
            <LayerConversationDrawer
              visible={drawerVisible}
              onClose={() => setDrawerVisible(false)}
              target={drawerTarget}
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

          {officeScene.showOfficeFullscreen ? (
            <TeamPageOfficeScene
              officeSceneState={officeScene.officeSceneState}
              selectedAgentId={selectedAgentId}
              runtimeStatus={selectedTeam?.status ?? null}
              selectedSessionTitle={selectedTeam?.title ?? null}
              onSelectAgent={handleSelectAgent}
              onExitFullscreen={officeScene.exitOfficeFullscreen}
            />
          ) : null}
        </div>
      </TeamSessionViewStateProvider>
    </TeamRuntimeReferenceDataProvider>
  );
}
