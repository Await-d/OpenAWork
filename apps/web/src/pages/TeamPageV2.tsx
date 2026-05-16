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
 *   ├────────┬─────────────────────────────────────┬───────────────────┤
 *   │        │ OfficeCompactBar（折叠 36 / 展开 132） │  RightPanel       │
 *   │ 左侧    ├─────────────────────────────────────┤   240/360         │
 *   │ 会话栏  │                                     │   tabs：           │
 *   │ 240    │  ConversationArea（flex 1）          │  任务/团队/设置    │
 *   │ 可折叠  │   - 系统/事件徽章                    │                    │
 *   │        │   - 对话流（占位）                    │                    │
 *   │        │   - 推送提示                          │                    │
 *   │        ├─────────────────────────────────────┤                    │
 *   │        │ MessageInput（粘底）                 │                    │
 *   └────────┴─────────────────────────────────────┴───────────────────┘
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
  type CSSProperties,
  type MouseEvent,
} from 'react';
import { useParams } from 'react-router';
import {
  TeamRuntimeReferenceDataProvider,
  useResolvedTeamRuntimeReferenceData,
} from './team/runtime/team-runtime-reference-data.js';
import { useTeamWorkspaceState } from './team/use-team-workspace-state.js';
import { useTeamWorkspaceSnapshotState } from './team/use-team-workspace-snapshot-state.js';
import { ConversationArea } from './team/runtime/ConversationArea.js';
import { OfficeCompactBar } from './team/runtime/OfficeCompactBar.js';
import { RightPanel, useRightPanelState } from './team/runtime/RightPanel.js';
import { TeamStatusBar } from './team/runtime/TeamStatusBar.js';
import { LayerConversationDrawer } from './team/runtime/LayerConversationDrawer.js';
import { SessionTreeView } from './team/runtime/SessionTreeView.js';
import { TeamArtifactSection } from './team/runtime/TeamArtifactSection.js';
import { ReviewReportView } from './team/runtime/ReviewReportView.js';
import { TeamRuntimeSettingsPanel } from './team/runtime/team-runtime-settings-panel.js';
import { TeamTabContent } from './team/runtime/TeamTabContent.js';
import { TeamSessionListSidebar } from './team/runtime/TeamSessionListSidebar.js';
import {
  useBreakpoint,
  useTeamPageMode,
  setTeamPagePaused,
} from './team/runtime/use-team-page-state.js';
import { useAuthStore } from '../stores/auth.js';
import {
  connectTeamEvents,
  disconnectTeamEvents,
  useHandoffStore,
  type HandoffEntry,
} from '../stores/team-events.js';
import { OfficeThreeCanvas } from './team/runtime/OfficeThreeCanvas.js';
import { useOfficeSceneState } from './team/runtime/OfficeScene.js';
import type { TeamSessionCreationDraft } from './team/runtime/team-session-creation.types.js';

// ───── 尺寸常量 ─────

const SIDEBAR_WIDTH = 240;
const SIDEBAR_TABLET_WIDTH = 200;
const SIDEBAR_COLLAPSED_WIDTH = 52;
const RIGHT_PANEL_WIDTH = 360;
const RIGHT_PANEL_TABLET_WIDTH = 320;

type MiddleTabKey = 'conversation' | 'tasks' | 'artifacts' | 'review';

const MIDDLE_TABS: ReadonlyArray<{ key: MiddleTabKey; label: string; icon: string }> = [
  { key: 'conversation', label: '对话', icon: '💬' },
  { key: 'tasks', label: '任务流', icon: '📋' },
  { key: 'artifacts', label: '产物', icon: '📦' },
  { key: 'review', label: '评审', icon: '✅' },
];

const MIDDLE_TAB_BAR_STYLE: CSSProperties = {
  display: 'flex',
  gap: 4,
  padding: '6px 12px 0',
  borderBottom: '1px solid color-mix(in srgb, var(--border) 40%, transparent)',
  flexShrink: 0,
  background: 'color-mix(in srgb, var(--surface) 60%, var(--bg))',
};

const MIDDLE_TAB_BTN_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '7px 14px 8px',
  border: 'none',
  borderBottom: '2px solid transparent',
  background: 'transparent',
  color: 'var(--text-3)',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  borderRadius: '6px 6px 0 0',
};

const MIDDLE_TAB_BTN_ACTIVE_STYLE: CSSProperties = {
  ...MIDDLE_TAB_BTN_STYLE,
  borderBottomColor: 'var(--accent)',
  color: 'var(--text)',
  background: 'color-mix(in srgb, var(--accent) 8%, transparent)',
};

// ───── 样式 ─────

const HEADER_STYLE: CSSProperties = {
  // 仅扩展 .page-header 的默认样式（间距、布局），保留默认 height/padding/background/border
  gap: 12,
};

const TITLE_GROUP_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 6,
  minWidth: 0,
  flexShrink: 0,
  maxWidth: '50%',
};

const STATUS_SLOT_STYLE: CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: 'flex',
  justifyContent: 'flex-start',
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
  border: '1px solid color-mix(in srgb, var(--border) 60%, transparent)',
  color: 'var(--text-2)',
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
  background: 'color-mix(in srgb, #f59e0b 14%, var(--surface))',
  borderBottom: '1px solid color-mix(in srgb, #f59e0b 35%, transparent)',
  fontSize: 12,
  color: '#b45309',
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
  background: 'var(--bg)',
};

// ───── 入口组件 ─────

export default function TeamPageV2() {
  const { teamWorkspaceId } = useParams<{ teamWorkspaceId?: string }>();
  const workspaceState = useTeamWorkspaceState(teamWorkspaceId);
  const resolvedTeamWorkspaceId = teamWorkspaceId ?? workspaceState.workspaces[0]?.id ?? null;
  const workspaceSnapshotState = useTeamWorkspaceSnapshotState(
    resolvedTeamWorkspaceId ?? undefined,
  );
  const [selectedTeamId, setSelectedTeamId] = useState('');
  const [officeCollapsed, setOfficeCollapsed] = useState(true);
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('teamV2.leftSidebar.collapsed') === '1';
  });
  const [selectedWorkspacePath, setSelectedWorkspacePath] = useState<string | null>(null);
  const [showOfficeFullscreen, setShowOfficeFullscreen] = useState(false);
  const [middleTab, setMiddleTab] = useState<MiddleTabKey>(() => {
    if (typeof window === 'undefined') return 'conversation';
    const saved = window.localStorage.getItem('teamV2.middleTab');
    return (
      saved === 'tasks' || saved === 'artifacts' || saved === 'review' ? saved : 'conversation'
    ) as MiddleTabKey;
  });
  const {
    collapsed: rightCollapsed,
    toggleCollapsed: toggleRight,
    activeTab,
    setActiveTab,
  } = useRightPanelState();
  const { accessToken, gatewayUrl } = useAuthStore();
  const mode = useTeamPageMode();
  const breakpoint = useBreakpoint();
  const handoffs = useHandoffStore((s) => s.handoffs);
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
  const effectiveRightCollapsed = isMobile ? true : rightCollapsed;
  const showOffice = !isMobile;
  const rightPanelExpandedWidth = isTablet ? RIGHT_PANEL_TABLET_WIDTH : RIGHT_PANEL_WIDTH;

  const handleToggleSidebar = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('teamV2.leftSidebar.collapsed', next ? '1' : '0');
      }
      return next;
    });
  };

  const handleSelectTeam = (teamId: string) => {
    setSelectedTeamId(teamId);
    data.selectTeam(teamId);
  };

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
    async (_draft: TeamSessionCreationDraft) => {
      await data.createSession(_draft.teamWorkspaceId);
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

  const handleCancelHandoff = useCallback(
    (handoffId: string) => {
      if (!gatewayUrl || !accessToken) return;
      // TODO: 后续迁移到 @openAwork/web-client 封装
      void fetch(`${gatewayUrl}/team/handoffs/${handoffId}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      }).then((res) => {
        if (!res.ok) {
          console.error('[TeamPageV2] cancel handoff failed:', handoffId, res.status);
        }
      });
    },
    [gatewayUrl, accessToken],
  );

  const handleOpenFullscreen = useCallback(() => {
    setShowOfficeFullscreen(true);
  }, []);

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
    const right = effectiveRightCollapsed ? '0px' : `${rightPanelExpandedWidth}px`;
    return `${left} minmax(0, 1fr) ${right}`;
  }, [
    effectiveRightCollapsed,
    effectiveSidebarCollapsed,
    isMobile,
    isTablet,
    rightPanelExpandedWidth,
  ]);

  const mainGridStyle: CSSProperties = {
    ...MAIN_GRID_BASE_STYLE,
    gridTemplateColumns,
  };

  const selectedTeamLabel = useMemo(() => {
    for (const group of data.workspaceGroups) {
      const session = group.sessions.find((s) => s.id === selectedTeamId);
      if (session) return session.title;
    }
    return null;
  }, [data.workspaceGroups, selectedTeamId]);

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
            {workspaceState.activeWorkspace ? (
              <span
                style={{
                  fontSize: 12,
                  color: 'var(--text-3)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  maxWidth: 200,
                }}
                title={workspaceState.activeWorkspace.name}
              >
                · {workspaceState.activeWorkspace.name}
              </span>
            ) : null}
            {selectedTeamLabel ? (
              <span
                style={{
                  fontSize: 12,
                  color: 'var(--text-2)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  maxWidth: 280,
                }}
                title={selectedTeamLabel}
              >
                / {selectedTeamLabel}
              </span>
            ) : null}
          </div>

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
            <span style={{ color: 'var(--text-3)', flex: 1 }}>所有运行中的 LLM 调用已停止</span>
            <button
              className="team-v2-control team-v2-control--transparent"
              type="button"
              onClick={() => setTeamPagePaused(false)}
              style={{
                padding: '3px 12px',
                borderRadius: 6,
                border: '1px solid color-mix(in srgb, var(--success, #22c55e) 50%, transparent)',
                color: 'var(--success, #22c55e)',
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
          {/* 左：会话列表 */}
          {!isMobile ? (
            <TeamSessionListSidebar
              collapsed={effectiveSidebarCollapsed}
              onToggleCollapsed={handleToggleSidebar}
              workspaceGroups={data.workspaceGroups}
              selectedTeamId={selectedTeamId}
              onSelectTeam={handleSelectTeam}
              teamWorkspaceId={resolvedTeamWorkspaceId ?? undefined}
              onSubmitDraft={handleSubmitDraft}
              onDeleteSession={handleDeleteSession}
              selectedWorkspacePath={selectedWorkspacePath}
              onWorkspaceChange={handleWorkspaceChange}
              loading={workspaceState.loading || workspaceSnapshotState.loading}
            />
          ) : null}

          {/* 中：紧凑栏 + 对话区 */}
          <section style={LEFT_AREA_STYLE}>
            {showOffice ? (
              <>
                {officeCollapsed ? (
                  <button
                    className="team-v2-control team-v2-control--surface"
                    type="button"
                    onClick={() => setOfficeCollapsed(false)}
                    style={OFFICE_EXPAND_BUTTON_STYLE}
                    aria-label="展开 3D 流程动画"
                    title="展开 3D 流程动画"
                  >
                    ▼ 流程
                  </button>
                ) : null}
                <OfficeCompactBar
                  collapsed={officeCollapsed}
                  onToggle={() => setOfficeCollapsed((v) => !v)}
                  onFullscreen={handleOpenFullscreen}
                />
              </>
            ) : null}

            <ConversationArea
              onSubmitMessage={handleSubmitMessage}
              onSelectSuggestion={handleSubmitMessage}
              onRetryConnection={handleRetryConnection}
              topBar={
                <div style={MIDDLE_TAB_BAR_STYLE} role="tablist" aria-label="中间区视图切换">
                  {MIDDLE_TABS.map((tab) => {
                    const active = middleTab === tab.key;
                    return (
                      <button
                        key={tab.key}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        aria-controls={`middle-panel-${tab.key}`}
                        onClick={() => handleMiddleTabChange(tab.key)}
                        style={active ? MIDDLE_TAB_BTN_ACTIVE_STYLE : MIDDLE_TAB_BTN_STYLE}
                        onMouseEnter={(e) => {
                          if (!active) {
                            e.currentTarget.style.color = 'var(--text-2)';
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!active) {
                            e.currentTarget.style.color = 'var(--text-3)';
                          }
                        }}
                      >
                        <span aria-hidden>{tab.icon}</span>
                        <span>{tab.label}</span>
                      </button>
                    );
                  })}
                </div>
              }
              messagesOverride={
                middleTab === 'conversation' ? undefined : (
                  <div
                    id={`middle-panel-${middleTab}`}
                    role="tabpanel"
                    aria-labelledby={`middle-tab-${middleTab}`}
                    style={{ display: 'grid', gap: 12 }}
                  >
                    {middleTab === 'tasks' ? (
                      <SessionTreeView onSelectSession={handleSelectLayerSession} />
                    ) : null}
                    {middleTab === 'artifacts' ? <TeamArtifactSection /> : null}
                    {middleTab === 'review' ? (
                      <ReviewReportView
                        reportMarkdown={null}
                        overallVerdict={null}
                        specReviewPassed={null}
                        qualityReviewPassed={null}
                      />
                    ) : null}
                  </div>
                )
              }
              fallbackContent={
                mode === 'idle' ? (
                  <IdleHint />
                ) : mode === 'paused' ? null : (
                  <div
                    style={{
                      fontSize: 12,
                      color: 'var(--text-3)',
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

          {/* 右：任务/团队/设置 Tab */}
          {!isMobile ? (
            <RightPanel
              collapsed={effectiveRightCollapsed}
              expandedWidth={rightPanelExpandedWidth}
              onToggleCollapsed={toggleRight}
              activeTab={activeTab}
              onTabChange={setActiveTab}
              tasksContent={
                <div style={{ display: 'grid', gap: 12 }}>
                  <SessionTreeView onSelectSession={handleSelectLayerSession} />
                  <HandoffCancelList handoffs={handoffs} onCancel={handleCancelHandoff} />
                  <TeamArtifactSection />
                </div>
              }
              teamContent={
                <TeamTabContent
                  workspaceName={workspaceState.activeWorkspace?.name ?? undefined}
                  onOpenFullscreen3D={handleOpenFullscreen}
                />
              }
              settingsContent={
                <TeamRuntimeSettingsPanel
                  gatewayUrl={gatewayUrl}
                  accessToken={accessToken}
                  teamWorkspaceId={resolvedTeamWorkspaceId}
                />
              }
            />
          ) : null}
        </main>

        {/* 右侧面板折叠态浮动展开按钮（贴右边缘，相对 page-root 定位） */}
        {!isMobile && effectiveRightCollapsed ? (
          <button
            className="team-v2-control team-v2-control--surface"
            type="button"
            onClick={toggleRight}
            aria-label="展开右侧面板"
            title="展开右侧面板"
            style={{
              position: 'absolute',
              right: 0,
              top: 100,
              width: 22,
              height: 44,
              border: '1px solid color-mix(in srgb, var(--border) 50%, transparent)',
              borderRight: 'none',
              borderTopLeftRadius: 8,
              borderBottomLeftRadius: 8,
              color: 'var(--text-2)',
              fontSize: 12,
              cursor: 'pointer',
              display: 'grid',
              placeItems: 'center',
              boxShadow: '-2px 0 8px color-mix(in srgb, #000 10%, transparent)',
              zIndex: 5,
            }}
          >
            ◀
          </button>
        ) : null}

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
              border: '1px solid color-mix(in srgb, var(--border) 60%, transparent)',
              color: 'var(--text)',
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

        {showOfficeFullscreen ? (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 100,
              background: 'var(--bg)',
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
                borderBottom: '1px solid var(--border)',
                flexShrink: 0,
              }}
            >
              <button
                type="button"
                onClick={() => setShowOfficeFullscreen(false)}
                style={{
                  padding: '6px 14px',
                  borderRadius: 8,
                  border: '1px solid color-mix(in srgb, var(--border) 60%, transparent)',
                  background: 'var(--surface)',
                  color: 'var(--text)',
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
        background: 'color-mix(in srgb, var(--accent) 4%, var(--surface))',
      }}
    >
      <div style={{ display: 'grid', gap: 4 }}>
        <strong style={{ fontSize: 16, color: 'var(--text)', letterSpacing: '0.01em' }}>
          👋 团队待命中
        </strong>
        <span style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.6 }}>
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
                background: 'color-mix(in srgb, var(--accent) 10%, var(--surface))',
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
              <span aria-hidden style={{ fontSize: 11, color: 'var(--text-3)' }}>
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
          borderTop: '1px solid color-mix(in srgb, var(--border) 40%, transparent)',
          fontSize: 11,
          color: 'var(--text-3)',
        }}
      >
        <span aria-hidden>↓</span>
        <span>在下方输入框开始你的第一个需求</span>
      </div>
    </div>
  );
}

function HandoffCancelList({
  handoffs,
  onCancel,
}: {
  handoffs: Map<string, HandoffEntry>;
  onCancel: (handoffId: string) => void;
}) {
  const cancellable = useMemo(() => {
    const result: HandoffEntry[] = [];
    for (const entry of handoffs.values()) {
      if (entry.state === 'running' || entry.state === 'pending' || entry.state === 'claimed') {
        result.push(entry);
      }
    }
    return result;
  }, [handoffs]);

  if (cancellable.length === 0) return null;

  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: 'var(--text-3)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}
      >
        运行中任务
      </span>
      {cancellable.map((entry) => (
        <div
          key={entry.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 10px',
            borderRadius: 8,
            border: '1px solid color-mix(in srgb, var(--border) 50%, transparent)',
            background: 'color-mix(in srgb, var(--surface) 80%, var(--bg))',
            fontSize: 12,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: 999,
              background: entry.state === 'running' ? 'var(--success, #22c55e)' : '#f59e0b',
              flexShrink: 0,
            }}
          />
          <span
            style={{
              flex: 1,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: 'var(--text-2)',
            }}
          >
            {entry.fromRoleLayer} → {entry.toRoleLayer}
          </span>
          <button
            type="button"
            onClick={() => onCancel(entry.id)}
            style={{
              padding: '2px 8px',
              borderRadius: 6,
              border: '1px solid color-mix(in srgb, var(--danger, #d4574e) 40%, transparent)',
              background: 'color-mix(in srgb, var(--danger, #d4574e) 8%, transparent)',
              color: 'var(--danger, #d4574e)',
              fontSize: 10,
              fontWeight: 700,
              cursor: 'pointer',
              flexShrink: 0,
            }}
            aria-label={`取消任务 ${entry.id}`}
          >
            取消
          </button>
        </div>
      ))}
    </div>
  );
}
