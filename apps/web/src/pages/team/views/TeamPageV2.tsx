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
 * Feature flag：默认启用，`localStorage['teamV2.enabled']='0'` 强制回退
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
import { useParams, useNavigate } from 'react-router';
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
import { TeamStatusBar } from '../runtime/shell/header/TeamStatusBar.js';
import { LayerConversationDrawer } from '../runtime/shell/session-view/LayerConversationDrawer.js';
import { TeamSessionListSidebar } from '../runtime/shell/sidebar/TeamSessionListSidebar.js';
import { TeamSidebarWithFileTree } from '../runtime/shell/sidebar/TeamSidebarWithFileTree.js';
import { WorkspaceSwitcher } from '../runtime/shell/header/WorkspaceSwitcher.js';
import { TeamHeaderMetrics } from '../runtime/shell/header/TeamHeaderMetrics.js';
import { NewTeamWorkspaceModal } from '../runtime/shell/modals/NewTeamWorkspaceModal.js';
import { ConfirmDeleteWorkspaceModal } from '../runtime/shell/modals/ConfirmDeleteWorkspaceModal.js';
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
import {
  useBreakpoint,
  useTeamPageMode,
  setTeamPagePaused,
} from '../runtime/hooks/use-team-page-state.js';
import { useAuthStore } from '../../../stores/auth/auth.js';
import {
  connectTeamEvents,
  disconnectTeamEvents,
  useHandoffStore,
  useTeamNotificationStore,
  useClarificationStore,
  type HandoffEntry,
  type HandoffEvent,
  type TeamRoleLayer,
} from '../../../stores/team/team-events.js';
import { OfficeThreeCanvas } from '../runtime/tabs/office/OfficeThreeCanvas.js';
import { useOfficeSceneState } from '../runtime/tabs/office/OfficeScene.js';
import type { TeamSessionCreationDraft } from '../runtime/data/team-session-creation.types.js';
import { createTeamHandoffsClient, type TeamWorkspaceSummary } from '@openAwork/web-client';
import { useFileEditor } from '../../../hooks/editor/useFileEditor.js';
import { WorkspaceEditorOverlay } from '../../../components/file-editor/WorkspaceEditorOverlay.js';

// ───── 尺寸常量 ─────

const SIDEBAR_WIDTH = 240;
const SIDEBAR_TABLET_WIDTH = 200;
const SIDEBAR_COLLAPSED_WIDTH = 52;

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

const HEADER_STYLE: CSSProperties = {
  // 仅扩展 .page-header 的默认样式（间距、布局），保留默认 height/padding/background/border
  gap: 12,
};

const TITLE_GROUP_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  minWidth: 0,
  flexShrink: 1,
  maxWidth: '40%',
};

const STATUS_SLOT_STYLE: CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: 'flex',
  justifyContent: 'flex-end',
  overflow: 'hidden',
};

const STATUS_TRIGGER_STYLE: CSSProperties = {
  display: 'flex',
  minWidth: 0,
  flex: 1,
  cursor: 'pointer',
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

const PAUSED_RIBBON_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '6px 14px',
  background: 'color-mix(in srgb, var(--warning) 14%, var(--bg-overlay))',
  borderBottom: '1px solid color-mix(in srgb, var(--warning) 35%, transparent)',
  fontSize: 12,
  color: 'var(--warning)',
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
  background: 'var(--bg-base)',
  // 与左侧会话栏的视觉分隔
  borderLeft: '1px solid color-mix(in srgb, var(--border-default) 40%, transparent)',
};

const FOCUS_BANNER_STYLE: CSSProperties = {
  display: 'grid',
  gap: 8,
  padding: '10px 12px',
  borderTop: '1px solid color-mix(in srgb, var(--border-default) 40%, transparent)',
  borderBottom: '1px solid color-mix(in srgb, var(--border-default) 40%, transparent)',
  background: 'color-mix(in srgb, var(--accent) 6%, var(--bg-overlay))',
};

const FOCUS_BANNER_ROW_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap',
};

const FOCUS_BANNER_ACTION_STYLE: CSSProperties = {
  padding: '4px 10px',
  borderRadius: 8,
  border: '1px solid color-mix(in srgb, var(--border-default) 55%, transparent)',
  background: 'transparent',
  color: 'var(--fg-default)',
  fontSize: 11,
  fontWeight: 700,
  cursor: 'pointer',
};

const FOCUS_BANNER_PRIMARY_ACTION_STYLE: CSSProperties = {
  ...FOCUS_BANNER_ACTION_STYLE,
  borderColor: 'color-mix(in srgb, var(--accent) 45%, transparent)',
  background: 'color-mix(in srgb, var(--accent) 14%, transparent)',
  color: 'var(--accent)',
};

const FOCUS_LAYER_LABELS: Record<TeamRoleLayer, string> = {
  user: '用户',
  reception: '接待',
  pm1: 'PM1',
  pm2: 'PM2',
  executor: '执行',
  tester: '测试',
  reviewer: '评审',
};

const FOCUS_STATE_LABELS: Record<HandoffEntry['state'], string> = {
  pending: '等待中',
  claimed: '已认领',
  running: '运行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

// ───── 入口组件 ─────

export default function TeamPageV2() {
  const { teamWorkspaceId } = useParams<{ teamWorkspaceId?: string }>();
  const navigate = useNavigate();
  const workspaceState = useTeamWorkspaceState(teamWorkspaceId);
  const resolvedTeamWorkspaceId = teamWorkspaceId ?? workspaceState.workspaces[0]?.id ?? null;

  // 当 URL 没指定工作区但已加载到工作区列表时，自动跳转到第一个工作区。
  // 这样 useTeamWorkspaceState 的 activeWorkspace 才能正确加载，
  // 顶部 WorkspaceSwitcher 与会话列表也能显示对应工作区的内容。
  useEffect(() => {
    if (!teamWorkspaceId && workspaceState.workspaces.length > 0 && !workspaceState.loading) {
      const firstId = workspaceState.workspaces[0]?.id;
      if (firstId) {
        navigate(`/team/${firstId}`, { replace: true });
      }
    }
  }, [teamWorkspaceId, workspaceState.workspaces, workspaceState.loading, navigate]);
  const workspaceSnapshotState = useTeamWorkspaceSnapshotState(
    resolvedTeamWorkspaceId ?? undefined,
  );
  const [selectedTeamId, setSelectedTeamId] = useState('');
  /**
   * 标识用户是否主动从左栏 / TeamPageV2 自己的菜单选过具体 team session。
   * - false：自动填充的 selectedTeamId 视为「未选」，对话 tab 默认显示接待
   * - true：用户明确选了某个 team session，对话 tab 优先显示该会话
   */
  const userSelectedTeamRef = useRef(false);
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [showNewWorkspaceModal, setShowNewWorkspaceModal] = useState(false);
  const [deleteWorkspaceTarget, setDeleteWorkspaceTarget] = useState<TeamWorkspaceSummary | null>(
    null,
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('teamV2.leftSidebar.collapsed') === '1';
  });
  const [selectedWorkspacePath, setSelectedWorkspacePath] = useState<string | null>(null);
  const [showOfficeFullscreen, setShowOfficeFullscreen] = useState(false);
  const [focusedHandoffId, setFocusedHandoffId] = useState<string | null>(null);
  const [middleTab, setMiddleTab] = useState<MiddleTabKey>(() => {
    if (typeof window === 'undefined') return 'conversation';
    const saved = window.localStorage.getItem('teamV2.middleTab');
    if (saved && MIDDLE_TAB_KEYS.has(saved as MiddleTabKey)) {
      return saved as MiddleTabKey;
    }
    return 'conversation';
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
  const mode = useTeamPageMode();
  const breakpoint = useBreakpoint();
  const handoffs = useHandoffStore((s) => s.handoffs);
  const unreadCount = useTeamNotificationStore((s) => s.unreadCount);
  const notificationEvents = useTeamNotificationStore((s) => s.events);
  const clarificationPending = useClarificationStore((s) => s.pendingCount);
  const officeSceneState = useOfficeSceneState();

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

  useEffect(() => {
    if (!selectedTeamId && data.defaultSelectedTeamId) {
      setSelectedTeamId(data.defaultSelectedTeamId);
    }
  }, [data.defaultSelectedTeamId, selectedTeamId]);

  // 派生当前选中的会话（用于 tab 中的展示）
  const selectedTeam = useMemo(() => {
    if (!selectedTeamId) return null;
    for (const group of data.workspaceGroups) {
      const found = group.sessions.find((s) => s.id === selectedTeamId);
      if (found) return found;
    }
    return null;
  }, [data.workspaceGroups, selectedTeamId]);

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
  const showOffice = !isMobile;

  const handleToggleSidebar = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('teamV2.leftSidebar.collapsed', next ? '1' : '0');
      }
      return next;
    });
  };

  const selectTeamInternal = useCallback(
    (teamId: string, options?: { preserveFocus?: boolean }) => {
      userSelectedTeamRef.current = true;
      if (!options?.preserveFocus) {
        setFocusedHandoffId(null);
      }
      setSelectedTeamId(teamId);
      data.selectTeam(teamId);
    },
    [data],
  );

  const handleSelectTeam = useCallback(
    (teamId: string) => {
      selectTeamInternal(teamId);
    },
    [selectTeamInternal],
  );

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

  const handleSelectLayerSession = useCallback(() => {
    setDrawerVisible(true);
  }, []);

  const handleStatusBarClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLElement && event.target.closest('button')) {
      return;
    }
    setDrawerVisible(true);
  }, []);

  const handleSubmitDraft = useCallback(
    async (draft: TeamSessionCreationDraft) => {
      // 把 4 步向导产出的完整 draft（title / source / defaultProvider /
      // optionalAgentIds / requiredRoleBindings）整体下发给后端 /sessions
      // 路径，由 createSession 内部映射到 CreateTeamSessionInput。
      // 之前只传 teamWorkspaceId 会导致 source / defaultProvider / optional
      // agents 全部丢失（参见 docs/team-architecture-deferred-decisions.md）。
      await data.createSession(draft);
    },
    [data],
  );

  const handleDeleteSession = useCallback(
    (sessionId: string) => {
      void data.deleteSession(sessionId);
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
      void handoffsClient.cancelHandoff(accessToken, handoffId).then((result) => {
        if (!result.ok) {
          console.error(
            '[TeamPageV2] cancel handoff failed:',
            handoffId,
            result.errorMessage ?? (result.state ? `state=${result.state}` : 'unknown'),
          );
        }
      });
    },
    [handoffsClient, accessToken],
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
  const [savingFile, setSavingFile] = useState(false);
  const handleOpenFile = useCallback(
    (path: string) => {
      setEditorOverlayOpen(true);
      void fileEditor.openFile(path);
    },
    [fileEditor],
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

  // grid template 列数（只在桌面/平板下生效）
  const gridTemplateColumns = useMemo(() => {
    if (isMobile) return '1fr';
    const sidebarExpanded = isTablet ? SIDEBAR_TABLET_WIDTH : SIDEBAR_WIDTH;
    const left = effectiveSidebarCollapsed
      ? `${SIDEBAR_COLLAPSED_WIDTH}px`
      : `${sidebarExpanded}px`;
    return `${left} minmax(0, 1fr)`;
  }, [effectiveSidebarCollapsed, isMobile, isTablet]);

  const mainGridStyle: CSSProperties = {
    ...MAIN_GRID_BASE_STYLE,
    gridTemplateColumns,
  };

  // ─── header 指标统计 ────────────────────────────────────────────
  const headerMetrics = useMemo(() => {
    const allSessions = data.workspaceGroups.flatMap((group) => group.sessions);
    const runningSessions = allSessions.filter((s) => s.status === 'running').length;
    const activeHandoffs = Array.from(handoffs.values()).filter(
      (h) => h.state === 'pending' || h.state === 'claimed' || h.state === 'running',
    ).length;
    const blockingNotifications = notificationEvents.filter(
      (event) =>
        event.type === 'waiting_confirmation' ||
        event.type === 'blocking' ||
        Boolean(event.payload['blocking']),
    ).length;
    return {
      runningSessions,
      activeHandoffs,
      blockingNotifications,
    };
  }, [data.workspaceGroups, handoffs, notificationEvents]);

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

  return (
    <TeamRuntimeReferenceDataProvider value={data}>
      <div
        className="page-root team-v2-root"
        aria-label="团队运行 V2"
        data-mode={mode}
        data-breakpoint={breakpoint}
        style={{ position: 'relative' }}
      >
        {/* ───── 顶部页头（使用项目标准 .page-header 高度 + 自定义背景） ───── */}
        <header className="page-header" style={HEADER_STYLE}>
          <div style={TITLE_GROUP_STYLE}>
            <strong style={{ fontSize: 14, whiteSpace: 'nowrap' }}>团队</strong>
            <span style={{ color: 'var(--fg-muted)', fontSize: 12 }}>·</span>
            <WorkspaceSwitcher
              workspaces={workspaceState.workspaces}
              activeWorkspaceId={workspaceState.activeWorkspace?.id ?? null}
              loading={workspaceState.loading}
              onSelect={(id) => navigate(`/team/${id}`)}
              onCreateNew={() => setShowNewWorkspaceModal(true)}
              onRename={data.renameWorkspace}
              onRequestDelete={(ws) => setDeleteWorkspaceTarget(ws)}
            />
          </div>

          {/* 中部：工作区指标卡片 */}
          {!isMobile ? (
            <TeamHeaderMetrics
              metrics={data.metricCards}
              activeHandoffCount={headerMetrics.activeHandoffs}
              blockingNotificationCount={headerMetrics.blockingNotifications}
              clarificationPendingCount={clarificationPending}
              runningSessionCount={headerMetrics.runningSessions}
            />
          ) : null}

          <div style={STATUS_SLOT_STYLE}>
            <div
              className="team-v2-control team-v2-control--transparent"
              style={STATUS_TRIGGER_STYLE}
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
                paused={mode === 'paused'}
                onPauseAll={() => setTeamPagePaused(true)}
                onResumeAll={() => setTeamPagePaused(false)}
              />
            </div>
          </div>
        </header>

        {/* ───── 暂停态浮条（精简）───── */}
        {mode === 'paused' ? (
          <div style={PAUSED_RIBBON_STYLE} role="alert">
            <span aria-hidden>⏸</span>
            <span style={{ fontWeight: 600 }}>团队已暂停</span>
            <span style={{ color: 'var(--fg-muted)', flex: 1 }}>所有运行中的 LLM 调用已停止</span>
            <button
              className="team-v2-control team-v2-control--transparent"
              type="button"
              onClick={() => setTeamPagePaused(false)}
              style={{
                padding: '3px 12px',
                borderRadius: 6,
                border: '1px solid color-mix(in srgb, var(--success) 50%, transparent)',
                color: 'var(--success)',
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              全部恢复
            </button>
          </div>
        ) : null}

        {/* ───── 主内容（三栏 grid，flex: 1 占满剩余空间） ───── */}
        <main style={mainGridStyle}>
          {/* 左：会话列表 + 文件目录 */}
          {!isMobile ? (
            <TeamSidebarWithFileTree
              collapsed={effectiveSidebarCollapsed}
              onToggleCollapsed={handleToggleSidebar}
              workspaceGroups={data.workspaceGroups}
              selectedTeamId={selectedTeamId}
              onSelectTeam={handleSelectTeam}
              teamWorkspaceId={resolvedTeamWorkspaceId ?? undefined}
              workspaceLabel={workspaceState.activeWorkspace?.name}
              defaultMemberSlots={workspaceState.activeWorkspace?.defaultTeamRoster}
              onSubmitDraft={handleSubmitDraft}
              onDeleteSession={handleDeleteSession}
              selectedWorkspacePath={selectedWorkspacePath}
              onWorkspaceChange={handleWorkspaceChange}
              loading={workspaceState.loading || workspaceSnapshotState.loading}
              workspacePath={workspaceState.activeWorkspace?.defaultWorkingRoot ?? null}
              onOpenFile={handleOpenFile}
            />
          ) : null}

          {/* 中：对话区（紧凑流程栏已并入「概览 / 拓扑」子 tab） */}
          <section style={LEFT_AREA_STYLE}>
            <ConversationArea
              onSubmitMessage={handleSubmitMessage}
              onSelectSuggestion={handleSubmitMessage}
              onRetryConnection={handleRetryConnection}
              receptionSessionId={data.defaultReceptionSessionId}
              receptionComposerEnabled={true}
              topBar={
                <>
                  <TeamTabBar
                    activePrimary={activePrimary}
                    middleTab={middleTab}
                    onPrimaryChange={handlePrimaryTabChange}
                    onMiddleChange={handleMiddleTabChange}
                    unreadCount={unreadCount}
                    clarificationPending={clarificationPending}
                    showOffice={showOffice}
                    officeActive={middleTab === 'office'}
                    onOfficeClick={() => {
                      if (middleTab === 'office') {
                        handleOpenFullscreen();
                      } else {
                        handleMiddleTabChange('office');
                      }
                    }}
                  />
                  {focusedHandoffId ? (
                    <div style={FOCUS_BANNER_STYLE} aria-live="polite">
                      <div style={FOCUS_BANNER_ROW_STYLE}>
                        <strong style={{ color: 'var(--accent)', fontSize: 12 }}>
                          当前聚焦 Handoff #{focusedHandoffId.slice(0, 8)}
                        </strong>
                        {focusedHandoffEntry ? (
                          <span
                            style={{ color: 'var(--fg-default)', fontSize: 12, fontWeight: 600 }}
                          >
                            {FOCUS_LAYER_LABELS[focusedHandoffEntry.fromRoleLayer]} →{' '}
                            {FOCUS_LAYER_LABELS[focusedHandoffEntry.toRoleLayer]} ·{' '}
                            {FOCUS_STATE_LABELS[focusedHandoffEntry.state]}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--fg-muted)', fontSize: 12 }}>
                            当前视图正在定位相关上下文。
                          </span>
                        )}
                      </div>
                      <div style={FOCUS_BANNER_ROW_STYLE}>
                        {focusSuggestedTab ? (
                          <button
                            type="button"
                            onClick={() => handleMiddleTabChange(focusSuggestedTab)}
                            style={FOCUS_BANNER_PRIMARY_ACTION_STYLE}
                          >
                            {focusSuggestedTab === 'review'
                              ? '回到评审上下文'
                              : focusSuggestedTab === 'artifacts'
                                ? '回到任务与产物'
                                : '查看健康度'}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => handleMiddleTabChange('health')}
                          style={FOCUS_BANNER_ACTION_STYLE}
                        >
                          查看健康度
                        </button>
                        <button
                          type="button"
                          onClick={() => setFocusedHandoffId(null)}
                          style={FOCUS_BANNER_ACTION_STYLE}
                        >
                          清除定位
                        </button>
                      </div>
                    </div>
                  ) : null}
                </>
              }
              messagesOverride={
                middleTab === 'conversation' ? (
                  // 默认行为：进入对话 tab 时优先显示「接待 b 层对话」（receptionSessionId）。
                  // 仅当用户主动从左栏点了某个 team session 后（userSelectedTeamRef=true），
                  // 才切到该 team session 的 chat 视图。这样新用户首次进入直接看到接待对话。
                  userSelectedTeamRef.current &&
                  selectedTeamId &&
                  selectedTeamId !== data.defaultReceptionSessionId ? (
                    <TeamConversationView
                      sessionId={selectedTeamId}
                      composerEnabled={inboundComposerEnabled}
                    />
                  ) : undefined
                ) : (
                  <div
                    id={`middle-panel-${middleTab}`}
                    role="tabpanel"
                    aria-labelledby={`middle-tab-${middleTab}`}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      flex: 1,
                      minHeight: 0,
                      overflow: 'hidden',
                      background: 'var(--bg-base)',
                      // 让 tab 内部的 sticky header 不被父级的 overflow 截断
                      isolation: 'isolate',
                    }}
                  >
                    {renderMiddleTabContent({
                      middleTab,
                      selectedTeamId,
                      selectedTeam,
                      focusHandoffId: focusedHandoffId,
                      officeSceneState,
                      onSelectTeam: handleSelectTeam,
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
                      activeWorkspaceName: workspaceState.activeWorkspace?.name ?? undefined,
                      onWorkspaceChanged: workspaceState.refresh,
                      teamWorkspaceId: resolvedTeamWorkspaceId,
                    })}
                  </div>
                )
              }
              fallbackContent={
                // 对话主 tab：依赖 chat 流自身的视觉，不再额外注入 IdleHint
                // 与 EmptyState（避免在已经有 composer / 接待对话流的页面下方
                // 再堆一段「团队待命中」的 hero 卡）。
                middleTab === 'conversation' ? null : mode === 'idle' ? (
                  <IdleHint />
                ) : mode === 'paused' ? null : (
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
          </section>
        </main>

        {/* 移动端浮动按钮：唤起会话列表 */}
        {isMobile && effectiveSidebarCollapsed ? (
          <button
            className="team-v2-control team-v2-control--surface"
            type="button"
            onClick={handleToggleSidebar}
            aria-label="展开会话列表"
            style={{
              position: 'fixed',
              left: 12,
              bottom: 80,
              padding: '10px 12px',
              borderRadius: 999,
              border: '1px solid color-mix(in srgb, var(--border-default) 60%, transparent)',
              color: 'var(--fg-strong)',
              fontSize: 12,
              fontWeight: 600,
              boxShadow: '0 6px 24px color-mix(in srgb, #000 14%, transparent)',
              cursor: 'pointer',
              zIndex: 20,
            }}
          >
            ☰ 会话
          </button>
        ) : null}

        <LayerConversationDrawer visible={drawerVisible} onClose={() => setDrawerVisible(false)} />
        {showNewWorkspaceModal ? (
          <NewTeamWorkspaceModal
            onClose={() => setShowNewWorkspaceModal(false)}
            onCreated={() => {
              // 刷新工作区列表，让新创建的工作区出现在 dropdown 中
              workspaceState.refresh();
            }}
          />
        ) : null}

        {deleteWorkspaceTarget ? (
          <ConfirmDeleteWorkspaceModal
            workspace={deleteWorkspaceTarget}
            workspaceGroups={data.workspaceGroups}
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
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 100,
              background: 'var(--bg-base)',
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
                selectedAgentId={selectedTeamId}
                onSelectAgent={handleSelectTeam}
                state={officeSceneState}
              />
            </div>
          </div>
        ) : null}

        <WorkspaceEditorOverlay
          open={editorOverlayOpen}
          onClose={() => setEditorOverlayOpen(false)}
          workspacePath={editorWorkspacePath}
          fileEditor={fileEditor}
          saving={savingFile}
          onSave={handleSaveFile}
        />
      </div>
    </TeamRuntimeReferenceDataProvider>
  );
}

const IDLE_FLOW_STEPS = ['接待', '规划', '管控', '执行', '评审'] as const;

function IdleHint() {
  return (
    <div
      style={{
        display: 'grid',
        gap: 14,
        padding: '24px 20px',
        margin: '16px 0',
        borderRadius: 14,
        border: '1px dashed color-mix(in srgb, var(--accent) 40%, transparent)',
        background: 'color-mix(in srgb, var(--accent) 4%, var(--bg-overlay))',
      }}
    >
      <div style={{ display: 'grid', gap: 4 }}>
        <strong style={{ fontSize: 16, color: 'var(--fg-strong)', letterSpacing: '0.01em' }}>
          👋 团队待命中
        </strong>
        <span style={{ fontSize: 12, color: 'var(--fg-muted)', lineHeight: 1.6 }}>
          在下方对话框输入需求，团队会按选定 workflow 自动流转
        </span>
      </div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 6,
        }}
        aria-label="团队工作流"
      >
        {IDLE_FLOW_STEPS.map((step, idx) => (
          <span key={step} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span
              style={{
                padding: '3px 10px',
                borderRadius: 999,
                background: 'color-mix(in srgb, var(--accent) 10%, var(--bg-overlay))',
                border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
                fontSize: 11,
                fontWeight: 600,
                color: 'var(--accent)',
                whiteSpace: 'nowrap',
              }}
            >
              {step}
            </span>
            {idx < IDLE_FLOW_STEPS.length - 1 ? (
              <span aria-hidden style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
                →
              </span>
            ) : null}
          </span>
        ))}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          paddingTop: 6,
          borderTop: '1px solid color-mix(in srgb, var(--border-default) 40%, transparent)',
          fontSize: 11,
          color: 'var(--fg-muted)',
        }}
      >
        <span aria-hidden>↓</span>
        <span>在下方输入框开始你的第一个需求</span>
      </div>
    </div>
  );
}
