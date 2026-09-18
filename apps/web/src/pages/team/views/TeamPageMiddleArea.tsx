/**
 * TeamPageV2 中间区（内容列）呈现层。
 *
 * 负责「中间区到底渲染什么」的 JSX 组装：classic 运营条 / 内联卡、对话流尾部
 * 卡片、共享会话覆盖、layer-todo 侧栏、主 tab 面板，以及 ConversationArea 的
 * 各 slot 绑定。状态与派生数据由 useTeamMiddleArea 提供（页面注入），本组件
 * 不读写 storage，也不持有会话级状态。
 */

import type { CSSProperties, ReactNode } from 'react';
import { ClassicTeamConversationInlineCards } from '../conversation/ops/ClassicTeamConversationInlineCards.js';
import { ClassicTeamConversationOpsChrome } from '../conversation/ops/ClassicTeamConversationOpsChrome.js';
import { TeamConversationView } from '../conversation/TeamConversationView.js';
import type { AgentTeamsSidebarTeam } from '../runtime/data/team-runtime-types.js';
import type { TeamRuntimeReferenceViewData } from '../runtime/data/team-runtime-reference-types.js';
import type { TeamPageMode } from '../runtime/hooks/use-team-page-state.js';
import { ConversationArea } from '../runtime/shell/controls/ConversationArea.js';
import { ErrorDiagnosticsPanel } from '../runtime/shell/controls/ErrorDiagnosticsPanel.js';
import { SmartSuggestionBubble } from '../runtime/shell/controls/SmartInputGuide.js';
import type { OfficeSceneState } from '../runtime/tabs/office/OfficeScene.js';
import { renderMiddleTabContent, type MiddleTabKey } from '../runtime/tabs/MiddleTabRouter.js';
import { getDefaultLeafFor } from '../runtime/tabs/team-page-v2-tabs.js';
import type { TeamRuntimeHandoffContextInput } from '../runtime/tabs/team-runtime-navigation.js';
import type { HandoffEntry, HandoffEvent } from '../../../stores/team/team-events.js';
import type { TeamMiddleAreaState } from '../hooks/use-team-middle-area.js';
import type { TeamEditorOverlayControls } from '../hooks/use-team-editor-overlay.js';
import { IdleHint, TeamSharedConversationPanel } from './team-page-v2-panels.js';
import { TeamPageEditorOverlay } from './TeamPageEditorOverlay.js';
import { ClassicTeamLayerTodoSidePanel } from './workbench/ClassicTeamLayerTodoSidePanel.js';

const LEFT_AREA_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  minHeight: 0,
  overflow: 'hidden',
  isolation: 'isolate',
};

export interface TeamPageMiddleAreaProps {
  readonly accessToken: string | null;
  readonly canCreateWorkspace: boolean;
  readonly canManageSelectedRuntimeTree: boolean;
  readonly data: TeamRuntimeReferenceViewData;
  readonly editorOverlay: TeamEditorOverlayControls;
  readonly effectiveFocusMode: boolean;
  readonly effectiveMode: TeamPageMode;
  readonly fileTreeWorkspacePath: string | null;
  readonly focusedHandoffId: string | null;
  readonly gatewayUrl: string | null;
  readonly handoffs: Map<string, HandoffEntry>;
  readonly inboundComposerEnabled: boolean;
  readonly isClassicWorkbench: boolean;
  readonly isMobile: boolean;
  readonly middleArea: TeamMiddleAreaState;
  readonly middleTab: MiddleTabKey;
  readonly officeSceneState: OfficeSceneState;
  readonly onCancelHandoff: (handoffId: string) => void;
  readonly onClearFocusedHandoff: () => void;
  readonly onMiddleTabChange: (next: MiddleTabKey) => void;
  readonly onOpenBlockingTarget: (event: HandoffEvent) => void;
  readonly onOpenFullscreen: () => void;
  readonly onOpenHandoffContext: (input: TeamRuntimeHandoffContextInput) => void;
  readonly onOpenNewSessionModal: (
    templateId?: string | null,
    workingDirectory?: string | null,
  ) => void;
  readonly onOpenNewWorkspaceModal: () => void;
  readonly onOpenSession: (sessionId: string) => void;
  readonly onRetryConnection: () => void;
  readonly onSelectAgent: (agentId: string) => void;
  readonly onSelectLayerSession: () => void;
  readonly onSelectTeam: (teamId: string) => void;
  readonly onSubmitMessage: (text: string) => Promise<void>;
  readonly onToggleFocusMode: () => void;
  readonly onWorkspaceChanged: () => void;
  readonly resolvedTeamWorkspaceId: string | null;
  readonly scopedHandoffs: HandoffEntry[];
  readonly selectedAgentId: string;
  readonly selectedTeam: AgentTeamsSidebarTeam | null;
  readonly selectedTeamId: string;
  readonly teamWorkspaceDisplayName: string;
  readonly topBar: ReactNode;
}

export function TeamPageMiddleArea({
  accessToken,
  canCreateWorkspace,
  canManageSelectedRuntimeTree,
  data,
  editorOverlay,
  effectiveFocusMode,
  effectiveMode,
  fileTreeWorkspacePath,
  focusedHandoffId,
  gatewayUrl,
  handoffs,
  inboundComposerEnabled,
  isClassicWorkbench,
  isMobile,
  middleArea,
  middleTab,
  officeSceneState,
  onCancelHandoff,
  onClearFocusedHandoff,
  onMiddleTabChange,
  onOpenBlockingTarget,
  onOpenFullscreen,
  onOpenHandoffContext,
  onOpenNewSessionModal,
  onOpenNewWorkspaceModal,
  onOpenSession,
  onRetryConnection,
  onSelectAgent,
  onSelectLayerSession,
  onSelectTeam,
  onSubmitMessage,
  onToggleFocusMode,
  onWorkspaceChanged,
  resolvedTeamWorkspaceId,
  scopedHandoffs,
  selectedAgentId,
  selectedTeam,
  selectedTeamId,
  teamWorkspaceDisplayName,
  topBar,
}: TeamPageMiddleAreaProps) {
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
        onSelectTeam,
        onSelectAgent,
        onOpenFullscreen,
        onOpenClarifications: () => onMiddleTabChange('artifacts'),
        onOpenHandoffContext,
        onOpenBlockingTarget,
        onClearFocusedHandoff,
        onSelectLayerSession,
        onCancelHandoff,
        handoffs,
        gatewayUrl,
        accessToken,
        activeWorkspaceName: fileTreeWorkspacePath ?? undefined,
        onWorkspaceChanged,
        teamWorkspaceId: resolvedTeamWorkspaceId,
        onUseTemplate: onOpenNewSessionModal,
        fileEditor: editorOverlay.fileEditor,
        onSaveFile: editorOverlay.saveFile,
      })}
    </div>
  );

  // 对话区只保留待处理/决策提示；状态与操作按钮统一在顶部 TeamStatusBar
  const classicOpsChrome = middleArea.classicConversationChromeActive ? (
    <ClassicTeamConversationOpsChrome
      failedHandoffs={middleArea.classicFailedHandoffs}
      pendingClarifications={middleArea.classicPendingClarifications}
      onFocusFail={middleArea.handleClassicFocusFail}
      onFocusClarifications={middleArea.handleClassicFocusWorkbench}
    />
  ) : null;

  const classicInlineCards = middleArea.classicConversationChromeActive ? (
    <ClassicTeamConversationInlineCards
      failedHandoffs={middleArea.classicFailedHandoffs}
      pendingClarifications={middleArea.classicPendingClarifications}
      runningHandoffs={middleArea.classicRunningHandoffs}
      onRetryFailed={canManageSelectedRuntimeTree ? middleArea.handleRetryFailed : undefined}
      onFocusWorkbench={middleArea.handleClassicFocusWorkbench}
    />
  ) : null;

  /**
   * 错误诊断简报（非 classic）：注入对话流尾部的 afterMessages，
   * 跟随对话流渲染在消息末尾、composer 上方——与 classic 的 InlineOpsCard
   * 共用同一落点。不再挂在主面板最顶部（原先会压在顶栏 tab 栏之上并
   * 挤占顶部空间）；失败提醒本身由「任务」主 tab 的红色徽标承担。
   */
  const errorDiagnosticsSlot = middleArea.showErrorDiagnostics ? (
    <ErrorDiagnosticsPanel
      failedHandoffs={scopedHandoffs}
      selectedTeam={selectedTeam}
      onRetryFailed={canManageSelectedRuntimeTree ? middleArea.handleRetryFailed : undefined}
      retrying={middleArea.retryingFailed}
    />
  ) : null;

  /**
   * 智能输入引导气泡（非 classic）：失败态给出「改写需求 / 针对性修复 / 拆分任务」
   * 等一键填入建议，空闲态提示 / 命令与 @ 引用。与错误诊断简报一样注入对话流尾部，
   * 紧贴输入区上方（点击建议即填入 composer，越靠近输入框越顺手），
   * 不再占用主面板顶部空间。
   */
  const smartSuggestionSlot = middleArea.showSmartSuggestion ? (
    <SmartSuggestionBubble
      context={middleArea.suggestionContext}
      failedCount={middleArea.failedTaskCount}
      onSelectSuggestion={data.canManageSessionEntries ? onSubmitMessage : undefined}
      onDismiss={() => middleArea.setSuggestionDismissed(true)}
    />
  ) : null;

  /**
   * 对话流尾部的运行反馈卡：classic InlineOpsCard、非 classic 错误诊断简报
   * 与智能输入引导气泡共用同一落点（自上而下：诊断 → 引导）。
   */
  const conversationTailCards =
    classicInlineCards || errorDiagnosticsSlot || smartSuggestionSlot ? (
      <>
        {classicInlineCards}
        {errorDiagnosticsSlot}
        {smartSuggestionSlot}
      </>
    ) : null;

  const conversationMessagesOverride = middleArea.isSelectedSharedSession ? (
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
        onOpenReview={() => onMiddleTabChange('review')}
        onOpenShares={() => onMiddleTabChange('shares')}
      />
    </div>
  ) : selectedTeamId && selectedTeamId !== middleArea.conversationReceptionSessionId ? (
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
        afterMessages={conversationTailCards}
        onOpenSession={onOpenSession}
      />
    </div>
  ) : undefined;

  const workbenchSidePanel = middleArea.showWorkbenchSidePanel ? (
    <ClassicTeamLayerTodoSidePanel
      handoffs={scopedHandoffs}
      layerNodes={middleArea.classicLayerNodes}
      taskLanes={data.taskLanes}
      overviewSlot={renderTeamMiddleTabPanel(getDefaultLeafFor('overview'))}
      metricsSlot={renderTeamMiddleTabPanel(getDefaultLeafFor('metrics'))}
      governanceSlot={renderTeamMiddleTabPanel(getDefaultLeafFor('governance'))}
    />
  ) : undefined;
  // 注意：不得因 classic 布局锁死对话区，否则顶部主 tab / 子 tab 会失效
  const conversationAreaMessagesOverride = middleArea.classicConversationSurface
    ? conversationMessagesOverride
    : renderTeamMiddleTabPanel(middleTab);

  return (
    <section
      className="team-v2-pane team-v2-pane--main"
      style={{ ...LEFT_AREA_STYLE, position: 'relative' }}
    >
      {/* 失败诊断简报已迁至对话流尾部（afterMessages）；classic 的
        失败/澄清/重试入口由左侧 ops chrome 与 InlineOpsCard 承载。 */}

      {/* 专注模式切换按钮（classic 用 ChatOpsBar「专注对话」） */}
      {!isClassicWorkbench && !isMobile ? (
        <button
          type="button"
          onClick={onToggleFocusMode}
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

      {/* 智能输入引导气泡已迁至对话流尾部（afterMessages），紧贴输入区；
        classic 由 ops/inline cards 替代，避免双套引导。 */}

      <div
        style={
          editorOverlay.mode === 'split' && editorOverlay.open
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
            editorOverlay.mode === 'split' && editorOverlay.open
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
              data.canManageSessionEntries && data.canCreateSession && resolvedTeamWorkspaceId,
            )}
            canCreateWorkspace={canCreateWorkspace}
            workspaceLabel={selectedTeamId ? teamWorkspaceDisplayName : null}
            onCreateWorkspace={canCreateWorkspace ? onOpenNewWorkspaceModal : undefined}
            onNewSession={data.canManageSessionEntries ? () => onOpenNewSessionModal() : undefined}
            onSelectSuggestion={data.canManageSessionEntries ? onSubmitMessage : undefined}
            onSubmitMessage={data.canManageSessionEntries ? onSubmitMessage : undefined}
            onRetryConnection={onRetryConnection}
            receptionSessionId={selectedTeamId ? middleArea.conversationReceptionSessionId : null}
            receptionComposerEnabled={true}
            classicWorkbench={isClassicWorkbench}
            onOpenSession={onOpenSession}
            conversationBeforeMessages={
              // reception 内嵌路径也挂 classic 运营条；子 session 覆盖路径在 messagesOverride 内已注入
              classicOpsChrome &&
              selectedTeamId &&
              selectedTeamId === middleArea.conversationReceptionSessionId
                ? classicOpsChrome
                : undefined
            }
            conversationAfterMessages={
              selectedTeamId && selectedTeamId === middleArea.conversationReceptionSessionId
                ? conversationTailCards
                : undefined
            }
            topBar={topBar}
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

        <TeamPageEditorOverlay controls={editorOverlay} />
      </div>
    </section>
  );
}
