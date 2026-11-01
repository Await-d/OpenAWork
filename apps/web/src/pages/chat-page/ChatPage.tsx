import type { InputImageContent, SubagentNotice, WorkflowRuntimeState } from '@openAwork/shared';
import type { AttachmentItem } from '@openAwork/shared-ui';
import type { Session, SessionTask } from '@openAwork/web-client';
import {
  createQuestionsClient,
  createSessionsClient,
  createSshClient,
} from '@openAwork/web-client';
import type { CSSProperties } from 'react';
import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { useFileEditorContext } from '../../App.js';
import { usePageActivation } from '../../components/common/routing/CachedRouteOutlet.js';

import { ChatImageGenerationResultStrip } from '../../components/chat/image/ChatImageGenerationResultStrip.js';
import { sharedUiThemeVars } from '../../components/chat/session/ChatPageSections.js';
import type { MentionFileSearchFn } from '../../components/chat/composer/use-mention-file-search.js';
import {
  ComposerWorkspaceMenu,
  type ComposerSshConnectionSummary,
} from '../../components/chat/composer/ComposerWorkspaceMenu.js';
import type { WorkspaceBindingChipState } from '../../components/chat/session/ChatTopBar.js';
import { LatestAssistantMessageContext } from '../../components/chat/message/collapsible-assistant-content.js';
import { QuickTerminalPanel } from '../../components/chat/terminal/QuickTerminalPanel.js';

import { useChatSearch } from '../../components/chat/search/chat-search-overlay.js';

import { CompanionStage } from '../../components/chat/companion/companion-stage.js';
import { scrollToNextUserMessage, scrollToPrevUserMessage } from './history/scroll-user-message.js';
import { useAppendImageGenerationSummary } from './hooks/use-append-image-generation-summary.js';
import { useChatComposerShortcuts } from './hooks/use-chat-composer-shortcuts.js';
import { useChatPageCoreState } from './hooks/use-chat-page-core-state.js';
import { useSessionMetadataPersist } from './hooks/use-session-metadata-persist.js';
import { useSessionRecoveryPolling } from './hooks/use-session-recovery-polling.js';
import { useChatScrollSettleEffects } from './hooks/use-chat-scroll-settle-effects.js';
import { useChatSessionRuntimeView } from './hooks/use-chat-session-runtime-view.js';
import { useHistoryScrollAnchor } from './hooks/use-history-scroll-anchor.js';
import { useRollbackDerivedCleanup } from './hooks/use-rollback-derived-cleanup.js';
import { useMcpServerRetry } from './hooks/use-mcp-server-retry.js';
import { useProviderFastMode } from './hooks/use-provider-fast-mode.js';
import { useRenderMessageActions } from './hooks/use-render-message-actions.js';
import { useEnsureMessageVisible } from './hooks/use-ensure-message-visible.js';
import { useModelContextOverride } from './hooks/use-model-context-override.js';
import { toast } from '../../components/common/feedback/ToastNotification.js';
import WorkspacePickerModal from '../../components/common/modal/WorkspacePickerModal.js';
import SshWorkspacePickerModal from '../../components/common/modal/SshWorkspacePickerModal.js';
import type { SshWorkspaceSelection } from '../../components/common/modal/SshWorkspacePickerModal.js';
import { useWorkspacePickerSources } from '../../components/common/modal/use-workspace-picker-sources.js';
import { useCommandRegistry } from '../../hooks/command/useCommandRegistry.js';
import { useComposerWorkspaceCatalog } from '../../hooks/chat/useComposerWorkspaceCatalog.js';
import { useFileEditor } from '../../hooks/editor/useFileEditor.js';
import { useGatewayClient } from '../../hooks/gateway/useGatewayClient.js';
import { usePrefersReducedMotion } from '../../hooks/ui/usePrefersReducedMotion.js';
import { useAuthStore } from '../../stores/auth/auth.js';
import {
  resolveEffectiveTerminalPanelPosition,
  useLocalSavedWorkspacePaths,
  useUIStateStore,
} from '../../stores/ui/uiState.js';
import { loadSavedChatSessionDefaults } from '../../utils/chat/chat-session-defaults.js';
import {
  COMPOSER_REFERENCE_EVENT_NAME,
  isComposerReferenceEvent,
} from '../../utils/chat/composer-reference-events.js';
import { logger } from '../../utils/log/logger.js';
import { writeRefCurrent } from '../../utils/ref/ref-current.js';

import {
  requestCurrentSessionRefresh,
  requestSessionListRefresh,
} from '../../utils/session/session-list-events.js';
import { subscribeSessionDialogueModeSwitch } from '../../utils/session/dialogue-mode-events.js';
import { subscribeSessionStreamResumeAttach } from '../../utils/session/session-stream-resume-events.js';

import { UNBOUND_WORKSPACE_LABEL } from '../../utils/session/session-grouping.js';
import {
  SESSION_RECOVERY_MESSAGE_LIMIT,
  fetchSessionRecoveryOnce,
} from '../../utils/session/session-recovery-flight.js';
import { getPathBasename } from '../../utils/workspace-path.js';
import { useLinkPreviewRequest } from '../../utils/preview/use-link-preview-request.js';
import { isTauriRuntime, pickDesktopFolder } from '../../utils/gateway/desktop-gateway.js';

import { ChatEditorPane } from './panels/chat-editor-pane.js';
import {
  collapseFusionWorkspaceToPanel,
  promoteFusionWorkspaceTab,
} from './panels/fusion-workspace-promotion.js';
import { WorkspaceFileTreePanel } from '../../components/layout/sidebar/WorkspaceFileTreePanel.js';
import {
  buildQueuedComposerScopeKey,
  buildRightPanelStateFromSessionSnapshot,
  prepareSessionRecoveryState,
} from './conversation/render/chat-page-utils.js';
import { ChatRightPanel } from './panels/chat-right-panel.js';
import { useBackgroundTaskPanel } from './panels/use-background-task-panel.js';

import { collectSubagentNotices } from '../../components/conversation-runtime/messages/subagent-notices.js';

import { type SessionTodoItem } from '../../components/conversation-runtime/session/session-runtime.js';

import {
  buildSubAgentRunItems,
  isActiveStatus,
  SubAgentRunList,
} from './panels/sub-agent-run-list.js';
import { BatchStopSubAgentsControl } from './panels/batch-stop-sub-agents-control.js';
import { BackgroundTaskQuickChip } from './panels/background-task-quick-chip.js';

import {
  buildUserHistoryJumpItems,
  UserHistoryJumpList,
} from './history/user-history-jump-list.js';
import {
  MENTION_SEARCH_LIMIT,
  reconcileSnapshotChatMessages,
  type WorkspaceFileMentionItem,
} from '../../components/conversation-runtime/messages/support.js';
import {
  buildTaskToolRuntimeLookup,
  buildTerminalTaskSyncMarker,
  resolveTaskToolRuntimeSnapshot,
} from './conversation/render/task-tool-runtime.js';
import {
  mergePendingQuestion,
  selectPendingQuestionForRequest,
} from './conversation/render/select-pending-question.js';
import { useChatTodoController } from '../../components/conversation-runtime/views/todo-bar.js';

import { useAssistantMessageProcessing } from './conversation/snapshot/use-assistant-message-processing.js';
import { useChatDataLoaders } from './conversation/data/use-chat-data-loaders.js';

import { useChatImageGeneration } from './hooks/use-chat-image-generation.js';
import { useWebSearchAvailable } from './hooks/use-web-search-available.js';
import {
  type HistoryEditPrompt,
  type RetryPrompt,
  useChatMessageActions,
} from './hooks/use-chat-message-actions.js';
import { useChatBranchSession } from './hooks/use-chat-branch-session.js';
import { useChatRenderData } from './conversation/render/use-chat-render-data.js';

import { useChatRetryAndEdit } from './hooks/use-chat-retry-and-edit.js';
import { useChatStopActiveMessage } from './hooks/use-chat-stop-active-message.js';
import { useChatStopChildSessions } from './hooks/use-chat-stop-child-sessions.js';
import { useChildSessionSelection } from './hooks/use-child-session-selection.js';
import { runEnsureSession } from './hooks/run-ensure-session.js';
import { runSendMessage } from './hooks/run-send-message.js';
import { useChatPageDerivations } from './hooks/use-chat-page-derivations.js';
import { runSessionAttachEffect } from './hooks/run-session-attach-effect.js';
import { runChatSessionSwitchEffect } from './hooks/run-chat-session-switch-effect.js';
import { useChatUiActions } from './hooks/use-chat-ui-actions.js';
import { resolveChatUiWorkspaceScope, useChatUiState } from './hooks/use-chat-ui-state.js';
import { useProviderModelInfo } from './conversation/settings/use-provider-model-info.js';
import { useScrollManager } from '../../components/conversation-runtime/scroll/use-scroll-manager.js';
import {} from '../../components/conversation-runtime/scroll/scroll-anchor.js';
import { useSessionContentArtifacts } from './conversation/snapshot/use-session-content-artifacts.js';
import { useSessionTerminals } from '../../components/conversation-runtime/terminals/use-session-terminals.js';

import { useSessionSettingsCallbacks } from './conversation/settings/use-session-settings-callbacks.js';
import {
  shouldAdoptSessionModelSelectionDefaults,
  type ModelSelectionSource,
} from './conversation/settings/model-selection-source.js';
import { useSessionSidebarRunState } from './conversation/snapshot/use-session-sidebar-run-state.js';
import { useSessionSnapshotLoader } from './conversation/snapshot/use-session-snapshot-loader.js';
import { useSessionHistoryLoader } from './conversation/snapshot/use-session-history-loader.js';
import { useStaleRunningResync } from './conversation/snapshot/use-stale-running-resync.js';

import { useStreamAttachRetry } from '../../components/conversation-runtime/attach/use-stream-attach-retry.js';
import { normalizeChatThinkingState } from './conversation/settings/resolve-chat-thinking-request.js';
import { createInitialChatRightPanelState, getToolCallCards } from './state/chat-stream-state.js';
import {
  DIALOGUE_MODE_OPTIONS,
  type DialogueMode,
  getDefaultAgentForDialogueMode,
} from './mode/dialogue-mode.js';
import { useDialogueModeSwitch } from './mode/use-dialogue-mode-switch.js';
import { useDisplayPreferencesStore } from '../../stores/settings/display-preferences.js';

import { CommandPalette, useCommandPalette } from '../../components/chat/misc/command-palette.js';
import { PromptTemplatePanel } from '../../components/chat/misc/prompt-template-panel.js';
import { useMessageMultiSelect } from '../../components/chat/message/message-multi-select.js';
import { exportMessages, downloadExport } from '../../components/chat/message/message-export.js';
import { useBookmarkStore } from '../../stores/chat/bookmarks.js';
import { useChatKeyboardShortcuts } from '../../hooks/chat/useChatKeyboardShortcuts.js';
import { useChatConversationViewProps } from './conversation/use-chat-conversation-view-props.js';
import { ClassicChatRegion } from './layout/ClassicChatRegion.js';
import { FusionChatRegion } from './layout/FusionChatRegion.js';
import { TerminalPanel } from './panels/TerminalPanel.js';
import { SessionPanelFrame } from './panels/SessionPanelFrame.js';
import { FusionDockedSidePanel } from './panels/FusionDockedSidePanel.js';
import type { FusionContextRuntimeSummary } from './panels/FusionContextTab.js';
import { FusionChatMainShell } from './layout/FusionChatMainShell.js';
import { useFusionChatLayout } from './layout/use-fusion-chat-layout.js';
import { useFusionDockedPanelViewport } from './layout/use-fusion-docked-panel-viewport.js';
import { useMobileViewport } from './layout/use-mobile-viewport.js';
import { resolveClassicConversationLayoutState } from './layout/conversation-layout-state.js';
import { FusionMobileBottomPanel } from './panels/FusionMobileBottomPanel.js';
import { useFusionWorkspaceBrowserSurface } from './panels/use-fusion-workspace-browser-surface.js';
import { useOpenFusionBrowserPreview } from './hooks/use-fusion-browser-preview.js';

const DEFAULT_VISIBLE_MESSAGE_COUNT = 20;

type SplitStyle = {
  readonly flex: number;
  readonly minHeight: CSSProperties['minHeight'];
  readonly minWidth: CSSProperties['minWidth'];
  readonly display: CSSProperties['display'];
  readonly overflow: CSSProperties['overflow'];
  readonly '--split-pos': string;
};
const INITIAL_TURN_LIMIT = SESSION_RECOVERY_MESSAGE_LIMIT;

/**
 * 刷新模型目录的统一包装：置 busy → try → catch 交给 `onError` → finally 清 busy。
 *
 * 必须留在模块级：React Compiler 1.0.0 不支持 `try/catch` 的 finally 子句，本组件这处
 * try 会让整个组件脱靶（实测）。语义逐字照搬。
 */
async function runProviderCatalogRefreshOnce(ctx: {
  onStart: () => void;
  onError: (error: unknown) => void;
  onFinally: () => void;
  run: () => Promise<void>;
}): Promise<void> {
  ctx.onStart();
  try {
    await ctx.run();
  } catch (error) {
    ctx.onError(error);
  } finally {
    ctx.onFinally();
  }
}

export default function ChatPage() {
  const routeParams = useParams<{ sessionId: string }>();
  const sessionId = routeParams.sessionId;
  const location = useLocation();
  const navigate = useNavigate();
  const pageActivation = usePageActivation();
  const isPageActive = pageActivation;
  const token = useAuthStore((s) => s.accessToken);
  const gatewayUrl = useAuthStore((s) => s.gatewayUrl);
  const {
    activateSessionView,
    activeModelId,
    activePendingQuestion,
    activeProviderId,
    activeSessionRef,
    activeStreamFirstTokenLatencyMs,
    activeStreamRoundStartedAt,
    activeStreamStartedAt,
    activeStreamStartedAtRef,
    armHistoryAnchor,
    armHistoryAnchorImplRef,
    attachAttemptWindowRef,
    attachProgressRef,
    attachTerminalReloadRef,
    companionBuddyTriggerText,
    companionComposerActivity,
    companionInputFlags,
    currentAssistantStreamMessageIdRef,
    currentLoadedSessionIdRef,
    currentSessionId,
    currentSessionViewRef,
    currentUserDisplayName,
    currentUserEmail,
    dialogueMode,
    firstVisibleMessageIdRef,
    handleInlineQuestionCustomInput,
    handleToggleMessageRating,
    hasAppliedSavedImageDefaultsRef,
    hasPendingFollowContent,
    hasSessionToken,
    hiddenMessageCountRef,
    historyAnchorRestoreCancelRef,
    idleSeconds,
    inlinePermissionPendingDecision,
    inlineQuestionAnswers,
    inlineQuestionCustomInputs,
    inlineQuestionReplyError,
    inlineQuestionReplyStatus,
    input,
    isCurrentSessionRequest,
    isCurrentSessionView,
    isSessionLoading,
    lastAnchorMessageIdRef,
    lastAttachAttemptTimestampRef,
    lastParentTaskSyncMarkerRef,
    latestUpstreamSummary,
    loadEarlierMessagesRef,
    manualAgentId,
    messageRatings,
    messages,
    messagesRef,
    modelPrices,
    pendingBootstrapSessionRef,
    pendingHistoryAnchor,
    pendingMessageScroll,
    pendingPermissions,
    pendingQuestions,
    pendingSessionNormalizeTimeoutRef,
    pendingStreamRevealFrameRef,
    permissionMode,
    previousRouteSessionIdRef,
    providers,
    providersRefreshing,
    reasoningEffort,
    recoveredStreamSnapshot,
    recoveryActiveStream,
    replyInlineQuestion,
    reportedStreamUsage,
    reportedStreamUsageRef,
    requestMessageScroll,
    resetStreamState,
    resolveInlinePermissionActions,
    reviewRefreshRevision,
    rightPanelState,
    rightPanelStateRef,
    savedChatDefaultsRef,
    scheduleStreamReveal,
    serverTotalTurnCount,
    sessionReloadNonce,
    sessionStateStatus,
    sessionSwitchTokenRef,
    sessionViewCache,
    setActiveModelId,
    setActiveProviderId,
    setActiveStreamFirstTokenLatencyMs,
    setActiveStreamRoundStartedAt,
    setActiveStreamStartedAt,
    setCompanionComposerActivity,
    setCurrentSessionId,
    setDialogueMode,
    setHasPendingFollowContent,
    setInput,
    setIsSessionLoading,
    setLatestUpstreamSummary,
    setManualAgentId,
    setMessageRatings,
    setMessages,
    setPendingHistoryAnchor,
    setPendingMessageScroll,
    setPendingPermissions,
    setPendingQuestions,
    setPermissionMode,
    setProviders,
    setProvidersRefreshing,
    setReasoningEffort,
    setRecoveredStreamSnapshot,
    setRecoveryActiveStream,
    setReportedStreamUsage,
    setReviewRefreshRevision,
    setRightPanelState,
    setServerTotalTurnCount,
    setSessionReloadNonce,
    setSessionStateStatus,
    setStoppingStream,
    setStreamBuffer,
    setStreamError,
    setStreaming,
    setStreamingSegments,
    setStreamThinkingBlocks,
    setStreamThinkingBuffer,
    setThinkingEnabled,
    setVisibleMessageCount,
    setWebSearchEnabled,
    stoppingStream,
    stoppingStreamRef,
    streamBuffer,
    streamBufferRef,
    streamFrameHandleRef,
    streamError,
    streaming,
    streamingRef,
    streamingSegments,
    streamingSegmentsRef,
    streamRevealNextAllowedAtRef,
    streamRevealTargetCodePointsRef,
    streamRevealTargetRef,
    streamRevealVisibleCodePointCountRef,
    streamRevealVisibleRef,
    streamThinkingBlocks,
    streamThinkingBlocksRef,
    streamThinkingBuffer,
    thinkingEnabled,
    toggleInlineQuestionOption,
    visibleMessageCount,
    webSearchEnabled,
    workspace,
    yoloMode,
  } = useChatPageCoreState({ gatewayUrl, routeSessionId: sessionId, token });

  // When a `question_asked` event arrives mid-stream, the stream chunk only
  // carries `requestId`/`toolName`/`title` — not the full `questions` array
  // with selectable options that InlineQuestionPanel needs to render (and its
  // submit button). Fetch the full pending question detail and merge it into
  // `pendingQuestions` so the inline answer panel (incl. its 提交/确认 button)
  // appears without waiting for a page reload / recovery snapshot.
  const loadPendingQuestionForSession = useCallback(
    async (targetSessionId: string, requestId: string) => {
      if (!token || !targetSessionId) {
        return;
      }
      try {
        const pending = await createQuestionsClient(gatewayUrl).listPending(token, targetSessionId);
        const match = selectPendingQuestionForRequest(pending, requestId);
        if (!match) {
          return;
        }
        setPendingQuestions((previous) => mergePendingQuestion(previous, match));
      } catch {
        // Non-fatal: the global Layout question prompt and recovery snapshot
        // remain as fallbacks. Surfacing a toast here would be noisy mid-stream.
      }
    },
    [gatewayUrl, token, setPendingQuestions],
  );

  const [childSessions, setChildSessions] = useState<Session[]>([]);
  const [selectedChildSessionId, setSelectedChildSessionId] = useState<string | null>(null);
  /**
   * 子代理完成通知（网关注入的 `role: 'synthetic'` 消息）。
   *
   * 与 `messages` 同源解析但走独立通道：`normalizeChatMessages` 会把 synthetic
   * 排除在 transcript 之外（它不是用户输入），因此通知由渲染层按时间位置
   * 插入消息群组之间（`ChatRenderGroup` 的 `subagent-notice` 变体）。
   */
  const [subagentNotices, setSubagentNotices] = useState<SubagentNotice[]>([]);
  const [sessionTodos, setSessionTodos] = useState<SessionTodoItem[]>([]);
  // 待办控制器：在 ChatPage 创建一份，让 ChatTopBar 内嵌 todo slot 与
  // SessionConversationView 内的浮层共享展开状态、避免双份 state。
  const todoController = useChatTodoController(sessionTodos);
  const todoDetailsId = useId();
  const [sessionTasks, setSessionTasks] = useState<SessionTask[]>([]);
  const {
    stoppingSubAgentIds,
    stoppingAllSubAgents,
    handleStopChildSession,
    handleStopAllChildSessions,
  } = useChatStopChildSessions({
    currentSessionId,
    gatewayUrl,
    token,
    requestSessionListRefresh,
  });
  const [workflowRuntime, setWorkflowRuntime] = useState<WorkflowRuntimeState | null>(null);
  const [latestGeneratedImageResult, setLatestGeneratedImageResult] = useState<{
    artifactId: string;
    artifactTitle: string;
    modelLabel: string;
  } | null>(null);
  const [selectedImageEditReferenceArtifactId, setSelectedImageEditReferenceArtifactId] = useState<
    string | null
  >(null);
  const devServerDetectedTerminalIdsRef = useRef<Set<string>>(new Set());
  const [isSessionSnapshotReady, setIsSessionSnapshotReady] = useState(false);
  const sessionMetadataDirtyRef = useRef(false);
  const sessionRestoredFromCacheRef = useRef(false);
  const [showSkeletonAfterDelay, setShowSkeletonAfterDelay] = useState(false);
  const skeletonDelayTimerRef = useRef<number | null>(null);
  const [historyEditPrompt, setHistoryEditPrompt] = useState<HistoryEditPrompt | null>(null);
  const [retryPrompt, setRetryPrompt] = useState<RetryPrompt | null>(null);
  const [, startSessionSwitchTransition] = useTransition();
  const [sessionModesHydrated, setSessionModesHydrated] = useState(false);
  const [sessionMetadataDirty, setSessionMetadataDirty] = useState(false);
  const [workspaceFileItems, setWorkspaceFileItems] = useState<WorkspaceFileMentionItem[]>([]);
  const sessionModelSelectionSourceRef = useRef<ModelSelectionSource | null>(null);

  // ─── Enhanced chat operations state ───────────────────────────────────────
  const [showTemplatePanel, setShowTemplatePanel] = useState(false);
  const bookmarkStore = useBookmarkStore();
  const multiSelect = useMessageMultiSelect();

  const lastPersistedSessionMetadataSnapshotRef = useRef<string | null>(null);
  const composerCommandDescriptors = useCommandRegistry('composer');
  const prefersReducedMotion = usePrefersReducedMotion();
  const navigateToHome = useUIStateStore((s) => s.navigateToHome);
  const navigateToSession = useUIStateStore((s) => s.navigateToSession);
  const layoutMode = useUIStateStore((s) => s.workbenchLayoutMode);
  const reviewPanelOpened = useUIStateStore((s) => s.reviewPanelOpened);
  const setReviewPanelOpened = useUIStateStore((s) => s.setReviewPanelOpened);
  const fusionDockSplitPos = useUIStateStore((s) => s.fusionDockSplitPos);
  const terminalPanelOpened = useUIStateStore((s) => s.terminalPanelOpened);
  const setTerminalPanelOpened = useUIStateStore((s) => s.setTerminalPanelOpened);
  const toggleTerminalPanelOpened = useUIStateStore((s) => s.toggleTerminalPanelOpened);
  const terminalPanelMaximized = useUIStateStore((s) => s.terminalPanelMaximized);
  const terminalPanelPosition = useUIStateStore((s) => s.terminalPanelPosition);
  // 最大化只在面板可见时折叠工作台行：面板收起后如果仍然折叠，聊天区会凭空消失；
  // 重新展开时 store 的瞬态标记还在，面板会自动回到最大化。
  const terminalMaximizedForLayout = terminalPanelMaximized && terminalPanelOpened;
  const updateTabStreaming = useUIStateStore((s) => s.updateTabStreaming);
  const sidePanelActiveTab = useUIStateStore((s) => s.sidePanelActiveTab);
  const setSidePanelActiveTab = useUIStateStore((s) => s.setSidePanelActiveTab);
  const resetBrowserPreviewView = useUIStateStore((s) => s.resetBrowserPreviewView);
  const setBrowserPreviewUrlForWorkspace = useUIStateStore(
    (s) => s.setBrowserPreviewUrlForWorkspace,
  );
  const chatView = useUIStateStore((s) => s.chatView);
  const workspaceTreeVersion = useUIStateStore((s) => s.workspaceTreeVersion);
  const selectedWorkspacePath = useUIStateStore((s) => s.selectedWorkspacePath);
  const setSelectedWorkspacePath = useUIStateStore((s) => s.setSelectedWorkspacePath);
  const addSavedWorkspace = useUIStateStore((s) => s.addSavedWorkspace);
  const savedWorkspacePaths = useLocalSavedWorkspacePaths();
  const setFileTreeRootPath = useUIStateStore((s) => s.setFileTreeRootPath);
  const selectedSshConnectionId = useUIStateStore((s) => s.selectedSshConnectionId);
  const setSelectedSshConnectionId = useUIStateStore((s) => s.setSelectedSshConnectionId);
  const setActiveSessionWorkspace = useUIStateStore((s) => s.setActiveSessionWorkspace);
  // 工作区文件读取身份（瞬态 slice）：会话切换时写入，卸载时清空。
  const setReadIdentity = useUIStateStore((s) => s.setReadIdentity);
  const clearReadIdentity = useUIStateStore((s) => s.clearReadIdentity);
  const setLastChatPath = useUIStateStore((s) => s.setLastChatPath);
  const resetToWelcomeSignal = useUIStateStore((s) => s.resetToWelcomeSignal);
  const consumeResetToWelcomeSignal = useUIStateStore((s) => s.consumeResetToWelcomeSignal);
  const isFusionLayout = layoutMode === 'fusion';
  const canDockFusionSidePanel = useFusionDockedPanelViewport();
  const isMobileViewport = useMobileViewport();
  // 窄视口必须降级为底部渲染（与 TerminalPanel 共用同一个判据），否则外壳会按
  // 持久化的侧停靠切进横向分栏，而面板自己已经退回底部抽屉。
  // 收起时不切横向分栏：收起态是横跨整宽的 rail，落到行布局里会变成一条不可用的竖条；
  // 与 terminalMaximizedForLayout 同一条「面板可见才让外壳改布局」的原则。
  const terminalPositionForLayout = terminalPanelOpened
    ? resolveEffectiveTerminalPanelPosition(terminalPanelPosition, isMobileViewport)
    : 'bottom';

  // sidebar / viewport / overlay 自愈 + 整个 UI 状态域 — 抽到 useChatUiState。
  // 参见 docs/architecture/chat-page-split-plan.md 域 D。
  const { openRef, setAvailable: setFileEditorAvailable } = useFileEditorContext();
  const effectiveWorkingDirectory = currentSessionId
    ? workspace.workingDirectory
    : selectedWorkspacePath;
  // 文件浏览根：已绑定时与 effectiveWorkingDirectory 相同；未绑定的普通会话
  // 回退到默认工作区（`~/Documents/OpenAWork`，由 useWorkspace 异步解析），让
  // 文件树 / @ 引用在无工作区会话里也能浏览 Agent 创建的文件。绑定 chip 与
  // 编辑器作用域仍使用 effectiveWorkingDirectory（未绑定语义不变）。
  const fileBrowseRoot = effectiveWorkingDirectory ?? workspace.fallbackWorkspacePath;
  // 编译器把「hook 返回对象上的方法调用」推断为整个对象依赖(workspace),与源码里更
  // 具体的 workspace.searchFileIndex 不匹配,会放弃优化整个 ChatPage。先取成局部量即可
  // 精确对应(useWorkspace 内该方法为 useCallback,引用身份与原先完全一致)。
  const { searchFileIndex } = workspace;
  const searchMentionFiles = useMemo<MentionFileSearchFn>(
    () => (query, signal) =>
      fileBrowseRoot
        ? searchFileIndex(fileBrowseRoot, {
            query,
            limit: MENTION_SEARCH_LIMIT,
            signal,
            // SSH 会话必须带上身份，网关才能解析远端工作区，否则 Windows 网关
            // 会直接拒绝 POSIX 路径。已有会话传当前会话 id（网关沿父会话链找
            // 连接）；草稿态尚无会话，只能传草稿选中的 SSH 连接 id。
            ...(currentSessionId
              ? { sessionId: currentSessionId }
              : { sshConnectionId: selectedSshConnectionId }),
          })
        : Promise.resolve({ files: [], directories: [] }),
    [currentSessionId, fileBrowseRoot, selectedSshConnectionId, searchFileIndex],
  );
  const uiWorkspaceScope = resolveChatUiWorkspaceScope(effectiveWorkingDirectory, currentSessionId);

  // SSH 工作区文件读取身份：读取消费方（文件编辑器 / 预览）不带会话上下文，
  // 只能从这里读瞬态身份，所以会话 / 草稿远程选择一变就同步写入。
  // - 已有会话：传 sessionId，网关沿父会话链解析 SSH 绑定；
  // - 草稿态：传草稿选中的 sshConnectionId；
  // - 已有会话**仍**保留 sshConnectionId 作为回退：会话的 SSH 绑定可能解析为
  //   unbound（历史会话 / 绑定未落库），此时网关会回落到本地路径校验，把远端
  //   POSIX 路径判成跨主机不可访问而拒绝。消费方据此改用连接身份重试远端读取，
  //   见 utils/file/preview-read-identity.ts。
  // - remote 只是提示位，不参与请求参数。
  useEffect(() => {
    setReadIdentity({
      sessionId: currentSessionId ?? null,
      sshConnectionId: currentSessionId
        ? (workspace.sshConnectionId ?? selectedSshConnectionId ?? null)
        : (selectedSshConnectionId ?? null),
      remote: Boolean(workspace.sshConnectionId) || Boolean(selectedSshConnectionId),
    });
  }, [currentSessionId, selectedSshConnectionId, workspace.sshConnectionId, setReadIdentity]);

  // 卸载（离开 ChatPage）时清空身份：它是会话级瞬态状态，不能留给下一个页面。
  useEffect(
    () => () => {
      clearReadIdentity();
    },
    [clearReadIdentity],
  );
  // useFileEditor 按 workspace 隔离打开的文件:跨 workspace 切换时自动加载对应 workspace
  // 上次留下的文件,而不是共享一个全局文件列表。
  const fileEditor = useFileEditor(effectiveWorkingDirectory, uiWorkspaceScope);
  const ui = useChatUiState({ effectiveWorkingDirectory, uiWorkspaceScope });
  const {
    // 右侧面板
    rightTab,
    setRightTab,
    rightOpen,
    setRightOpen,
    rightOpenRef,
    // 工具过滤 / MCP
    toolFilter,
    setToolFilter,
    mcpServers,
    setMcpServers,
    // 编辑器模式 / 分屏 / 保存
    editorMode,
    setEditorMode,
    editorFullScreen,
    setEditorFullScreen,
    splitPos,
    setSplitPos,
    splitDragging,
    splitContainerRef,
    editorPaneRef,
    saving,
    setSaving,
    // editor pane tab / 浏览器预览(workspace-keyed)
    editorPaneTab,
    setEditorPaneTab,
    browserPreviewUrl,
    setBrowserPreviewUrl,
    // 快捷终端
    quickTerminalOpen,
    setQuickTerminalOpenForWorkspace,
    // 弹窗 / 信号
    companionPanelSignal,
    bumpCompanionPanelSignal,
    // 滚动
    isNarrowViewport,
    bottomRef,
    contentColumnRef,
    scrollRegionRef,
    textareaRef,
    pendingScrollFrameRef,
    showScrollToBottom,
    setShowScrollToBottom,
  } = ui;
  const attachAttemptedSessionRef = useRef<string | null>(null);
  // 当前已建立 attach 传输的会话 id（无在途 attach 时为 null）。
  // 与 attachAttemptedSessionRef 分开：后者在重试调度 / 终态复位时会被置空，
  // 无法表达「传输仍属于哪个会话」，而 runSessionAttachEffect 的 cleanup 需要
  // 据此区分「token delta 重跑」（保留传输）与「切走会话」（掐断传输）。
  const attachOwnerSessionIdRef = useRef<string | null>(null);
  // Tracks the last logged attach-eligibility signature so the diagnostic
  // [ATTACH_ELIGIBILITY] line in the effect below only prints when the
  // decision-relevant inputs actually change (not on every token delta).
  const attachEligibilitySignatureRef = useRef<string | null>(null);

  // 同步当前会话的 streaming 状态到 Titlebar tab
  useEffect(() => {
    if (currentSessionId) {
      updateTabStreaming(currentSessionId, streaming);
    }
  }, [currentSessionId, streaming, updateTabStreaming]);

  // useSessionSettingsCallbacks 刻意声明在此处（而非原先靠后位置）：
  // 其 clearSessionMetadataDirty 在下方 reset-to-welcome effect 与
  // session-switch effect 里都要用，声明晚于使用会被编译器判为
  // 「声明前访问」而放弃优化整个 ChatPage。全部入参在本行之前均已声明。
  const {
    buildSessionMetadata,
    markSessionMetadataDirty,
    clearSessionMetadataDirty,
    handleDialogueModeChange,
    handleToggleYolo,
    handlePermissionModeChange,
    handleToggleWebSearch: rawHandleToggleWebSearch,
    handleManualAgentChange,
    handleClearManualAgentId,
  } = useSessionSettingsCallbacks(
    {
      dialogueMode,
      permissionMode,
      webSearchEnabled,
      thinkingEnabled,
      reasoningEffort,
      activeProviderId,
      activeModelId,
      // 传 ref 而不是渲染期读出的值：渲染期读 ref 会让 React Compiler 判定为
      // "Cannot access refs during render" 并放弃优化整个 ChatPage。该值只在
      // `buildSessionMetadata` 被调用时（事件 / effect 内）读取，`useCallback`
      // 体内读 ref 不受该规则约束。
      modelSelectionSourceRef: sessionModelSelectionSourceRef,
      manualAgentId,
      effectiveWorkingDirectory,
      sessionMetadataDirty,
      sessionMetadataDirtyRef,
    },
    {
      setDialogueMode,
      setPermissionMode,
      setWebSearchEnabled,
      setThinkingEnabled,
      setReasoningEffort,
      setManualAgentId,
      setSessionMetadataDirty,
    },
    gatewayUrl,
    token,
  );

  // 点击导航栏 Chat 图标时（已在 /chat 路由），清除当前会话回到欢迎页面。
  useEffect(() => {
    if (!resetToWelcomeSignal || resetToWelcomeSignal.route !== 'chat') return;
    setCurrentSessionId(null);
    setSelectedChildSessionId(null);
    setIsSessionLoading(false);
    setMessages([]);
    setVisibleMessageCount(DEFAULT_VISIBLE_MESSAGE_COUNT);
    setServerTotalTurnCount(null);
    setRightPanelState(createInitialChatRightPanelState());
    setSessionTodos([]);
    setChildSessions([]);
    setSessionTasks([]);
    setWorkflowRuntime(null);
    setPendingPermissions([]);
    setPendingQuestions([]);
    setSessionStateStatus(null);
    setIsSessionSnapshotReady(true);
    setSessionModesHydrated(false);
    clearSessionMetadataDirty();
    // 这些共享 ref 由 useChatSessionRefs() 创建后返回，直接写 .current 会被
    // React Compiler 判为「修改函数返回值」并放弃优化整个 ChatPage——写入统一走
    // 收敛函数（见 utils/ref/ref-current.ts）。
    writeRefCurrent(lastPersistedSessionMetadataSnapshotRef, null);
    resetStreamState();
    setStreamError(null);
    setDialogueMode(useDisplayPreferencesStore.getState().defaultDialogueMode);
    writeRefCurrent(currentLoadedSessionIdRef, null);
    consumeResetToWelcomeSignal();
    // 依赖省略是刻意取舍（reset 全量状态，不需要逐 setter 列入）。不要在此处
    // 加回 lint 抑制指令——编译器按文本匹配识别它，会放弃优化整个 ChatPage。
  }, [resetToWelcomeSignal, consumeResetToWelcomeSignal]);

  const {
    attachRetryExhausted,
    attachRetryNonce,
    attachRetryProgress,
    attachRetryScheduledSessionId,
    cancelAttachRetry,
    scheduleAttachRetry,
  } = useStreamAttachRetry();
  useEffect(() => {
    return subscribeSessionStreamResumeAttach((sessionId) => {
      if (sessionId !== currentSessionId || !isPageActive) {
        return;
      }

      attachAttemptedSessionRef.current = null;
      setSessionStateStatus('running');
      requestCurrentSessionRefresh(sessionId);
      scheduleAttachRetry({
        sessionId,
        delayMs: 100,
        beforeRetry: () => {
          if (activeSessionRef.current !== sessionId) {
            return 'abort';
          }
          attachAttemptedSessionRef.current = null;
          return 'proceed';
        },
      });
    });
  }, [currentSessionId, isPageActive, scheduleAttachRetry]);
  const artifactsWorkspaceHref = currentSessionId
    ? `/artifacts?sessionId=${encodeURIComponent(currentSessionId)}`
    : null;
  const {
    referenceArtifacts: sessionImageEditReferenceArtifacts,
    contentArtifactCount,
    status: contentArtifactCountStatus,
  } = useSessionContentArtifacts({
    currentSessionId,
    gatewayUrl,
    reloadKey: sessionReloadNonce,
    messageCount: messages.length,
    token,
  });
  const sessionTerminals = useSessionTerminals({
    currentSessionId,
    gatewayUrl,
    token,
  });
  /**
   * 「后台任务」面板模型：把当前会话的子代理任务与终端行归一为统一列表
   * （子代理 + 后台命令），由右栏 `background` tab 消费。数据源与实时性口径
   * 完全复用 `sessionTasks` / `sessionTerminals`，v1 不新增网关请求。
   */
  const backgroundTaskPanel = useBackgroundTaskPanel({
    tasks: sessionTasks,
    terminals: sessionTerminals.terminals,
  });
  const fusionChatLayout = useFusionChatLayout({
    canDockSidePanel: canDockFusionSidePanel,
    currentSessionId,
    editorFullScreen,
    editorMode,
    enabled: isFusionLayout,
    isNarrowViewport,
    reviewPanelOpened,
    setEditorFullScreen,
    setEditorMode,
    setReviewPanelOpened,
    setTerminalPanelOpened,
    terminalPanelOpened,
    terminalRunningCount: sessionTerminals.runningCount,
  });
  const classicConversationLayoutState = useMemo(() => resolveClassicConversationLayoutState(), []);
  const conversationLayoutState = isFusionLayout
    ? fusionChatLayout.conversationLayoutState
    : classicConversationLayoutState;
  const classicConversationHidden = !isFusionLayout && editorMode && editorFullScreen;
  const classicPageRootStyle = useMemo(
    () => ({
      height: '100%',
      flex: 1,
      minHeight: 0,
      minWidth: 0,
      display: 'flex',
      flexDirection: 'row' as const,
      overflow: 'hidden',
    }),
    [],
  );
  const classicWorkbenchSplitStyle = useMemo(
    () =>
      ({
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        display: 'flex',
        overflow: 'hidden',
        '--split-pos': `${splitPos}%`,
      }) satisfies SplitStyle,
    [splitPos],
  );
  const pageRootClassName = isFusionLayout
    ? fusionChatLayout.pageRootClassName
    : 'page-root page-root-row';
  const pageRootStyle = isFusionLayout ? fusionChatLayout.pageRootStyle : classicPageRootStyle;
  const availableImageEditReferenceArtifacts = useMemo(() => {
    if (!latestGeneratedImageResult) {
      return sessionImageEditReferenceArtifacts;
    }

    if (
      sessionImageEditReferenceArtifacts.some(
        (artifact) => artifact.artifactId === latestGeneratedImageResult.artifactId,
      )
    ) {
      return sessionImageEditReferenceArtifacts;
    }

    return [
      {
        artifactId: latestGeneratedImageResult.artifactId,
        title: latestGeneratedImageResult.artifactTitle,
        updatedAt: new Date().toISOString(),
      },
      ...sessionImageEditReferenceArtifacts,
    ];
  }, [latestGeneratedImageResult, sessionImageEditReferenceArtifacts]);
  const selectedImageEditReferenceArtifact = useMemo(
    () =>
      availableImageEditReferenceArtifacts.find(
        (artifact) => artifact.artifactId === selectedImageEditReferenceArtifactId,
      ) ?? null,
    [availableImageEditReferenceArtifacts, selectedImageEditReferenceArtifactId],
  );
  const composerWorkspaceCatalog = useComposerWorkspaceCatalog({
    enabled: Boolean(token),
    gatewayUrl,
    sessionId: currentSessionId,
    token,
  });
  const TAB_CYCLE_ALLOWED_AGENT_IDS = new Set(['hephaestus', 'sisyphus', 'prometheus']);
  const agentOptions = useMemo(
    () =>
      composerWorkspaceCatalog.agents
        .filter((agent) => TAB_CYCLE_ALLOWED_AGENT_IDS.has(agent.id))
        .map((agent) => ({
          id: agent.id,
          label: agent.label,
        })),
    [composerWorkspaceCatalog.agents],
  );
  const modeDefaultAgentId = useMemo(
    () => getDefaultAgentForDialogueMode(dialogueMode),
    [dialogueMode],
  );
  const effectiveAgentId = useMemo(
    () => manualAgentId.trim() || modeDefaultAgentId,
    [manualAgentId, modeDefaultAgentId],
  );
  const defaultAgentLabel = useMemo(() => {
    if (!modeDefaultAgentId) {
      return dialogueMode === 'clarify' ? '不指定（方案模式）' : '不指定';
    }

    return (
      agentOptions.find((agent) => agent.id === modeDefaultAgentId)?.label ?? modeDefaultAgentId
    );
  }, [agentOptions, dialogueMode, modeDefaultAgentId]);
  const queuedComposerScope = useMemo(() => {
    if (!currentSessionId) {
      return null;
    }

    return buildQueuedComposerScopeKey(currentUserEmail, currentSessionId);
  }, [currentSessionId, currentUserEmail]);
  const {
    applySavedImageDefaults,
    generateImageForSession,
    hasConfiguredImageModel,
    imageGenerationBusy,
    imageGenerationPreview,
    imageGenerationDefaults,
    imageGenerationMode,
    imageModelLabel,
    imagePluginEnabled,
    setImageGenerationMode,
    toggleImageGenerationMode,
    updateImageGenerationDefaults,
  } = useChatImageGeneration({
    gatewayUrl,
    providers,
    token,
  });

  const { webSearchAvailable } = useWebSearchAvailable({ gatewayUrl, token });

  // 当全局 Web 搜索不可用时，强制关闭会话级开关
  useEffect(() => {
    if (!webSearchAvailable && webSearchEnabled) {
      setWebSearchEnabled(false);
    }
  }, [webSearchAvailable, webSearchEnabled]);

  // 包装 toggle：全局不可用时禁止开启
  const handleToggleWebSearch = useCallback(() => {
    if (!webSearchAvailable) return;
    rawHandleToggleWebSearch();
  }, [webSearchAvailable, rawHandleToggleWebSearch]);

  /**
   * 对话模式切换（自动门控 / 用户点「确认转换」）后的本地同步。
   * 服务端已在同一请求内落库 `dialogueMode`，这里只对齐本地状态并提示用户；
   * 不做 markSessionMetadataDirty（无需回写，避免与落库竞态）。
   */
  useEffect(() => {
    return subscribeSessionDialogueModeSwitch(({ dialogueMode: nextMode, sessionId, source }) => {
      if (sessionId !== currentSessionId) {
        return;
      }
      setDialogueMode(nextMode);
      if (nextMode === 'coding') {
        toast(
          source === 'user'
            ? '已切换到编程模式，可以直接开始实现。'
            : '已自动切换到编程模式，可以直接开始实现。',
          'success',
          3200,
        );
      }
    });
  }, [currentSessionId]);

  /**
   * 「确认转换」按钮（澄清模式顶栏 CTA）：用户显式确认方案完成 → 服务端切换模式
   * 并结算澄清确认门控。模式状态仍由上面的订阅统一落地。
   */
  const { confirmSwitchToCoding, pending: clarifySwitchPending } = useDialogueModeSwitch({
    enabled: dialogueMode === 'clarify',
    gatewayUrl,
    sessionId: currentSessionId,
    token,
  });

  useEffect(() => {
    if (
      manualAgentId &&
      agentOptions.length > 0 &&
      !agentOptions.some((agent) => agent.id === manualAgentId)
    ) {
      setManualAgentId('');
    }
  }, [agentOptions, manualAgentId]);

  useEffect(() => {
    const previousSessionId = previousRouteSessionIdRef.current;
    const nextSessionId = sessionId ?? null;
    if (previousSessionId && previousSessionId !== nextSessionId) {
      setManualAgentId('');
    }
    writeRefCurrent(previousRouteSessionIdRef, nextSessionId);
  }, [sessionId]);

  // 任务同步 marker 与会话生命周期耦合(切会话即清空,避免上一会话的
  // task marker 误导新会话的 polling 比较),但 marker 本身属任务同步域,
  // 留在父组件管理。useChatSessionLifecycle 负责其它 ref 的镜像。
  useEffect(() => {
    // `lastParentTaskSyncMarkerRef` 来自 hook 返回值（属「函数返回值」），直接赋值
    // 会被 React Compiler 判为 "Mutating a variable that React considers immutable"
    // 并让整个 ChatPage 静默退出优化。写入收进模块函数，时机与语义不变。
    writeRefCurrent(lastParentTaskSyncMarkerRef, null);
  }, [currentSessionId, sessionId]);

  useEffect(() => {
    setLastChatPath(location.pathname);
  }, [location.pathname, setLastChatPath]);

  // 预览宿主（EditorBrowserWorkspace / BuiltInBrowser）是 keep-alive 的，切会话只切
  // hidden 不卸载。视图状态若也不回收，旧会话的页面就会永久停在面板上且无法关闭。
  // 用 ref 守卫只回收「真实切换」的那一次：首屏挂载（刷新后恢复上次预览）不动。
  const previewResetSessionIdRef = useRef<string | null>(null);
  useEffect(() => {
    const previousSessionId = previewResetSessionIdRef.current;
    previewResetSessionIdRef.current = currentSessionId;
    void currentSessionId;
    setReportedStreamUsage(null);
    setMessageRatings({});
    setLatestGeneratedImageResult(null);
    setSelectedImageEditReferenceArtifactId(null);
    // browserPreviewUrl 是按 workspace 路径持久化的(browserPreviewUrlByWorkspace),
    // 跨 workspace 切会话自动切到对应 workspace 的 url;同 workspace 内会话共享 url。
    if (previousSessionId !== null && previousSessionId !== currentSessionId) {
      resetBrowserPreviewView();
    }
    devServerDetectedTerminalIdsRef.current = new Set();
  }, [currentSessionId, resetBrowserPreviewView]);

  useEffect(() => {
    if (!selectedImageEditReferenceArtifactId) {
      return;
    }

    if (
      !availableImageEditReferenceArtifacts.some(
        (artifact) => artifact.artifactId === selectedImageEditReferenceArtifactId,
      )
    ) {
      setSelectedImageEditReferenceArtifactId(null);
    }
  }, [availableImageEditReferenceArtifacts, selectedImageEditReferenceArtifactId]);

  const continueEditingLatestGeneratedImage = useCallback(() => {
    if (!latestGeneratedImageResult) {
      return;
    }

    setSelectedImageEditReferenceArtifactId(latestGeneratedImageResult.artifactId);
    setImageGenerationMode(true);
    toast('已选择最新图片作为参考图，请继续输入编辑提示词。', 'success');
  }, [latestGeneratedImageResult, setImageGenerationMode]);

  useEffect(() => {
    setFileTreeRootPath(effectiveWorkingDirectory ?? null);
  }, [effectiveWorkingDirectory, setFileTreeRootPath]);

  // workspace 变化时 fileEditor 内部自动加载该 workspace 持久化的文件,无需在这里
  // 主动关闭 / 重载。useFileEditor 按 workspace 桶隔离 openFilePaths,跨 workspace
  // 切回旧 workspace 时上次留下的文件会自动恢复。

  const { planTasks, agentEvents, planHistory, dagNodes, dagEdges, compactions } = rightPanelState;
  const toolCallCards = useMemo(() => getToolCallCards(rightPanelState), [rightPanelState]);
  const fusionContextRuntimeSummary = useMemo<FusionContextRuntimeSummary>(
    () => ({
      activePlanTaskCount: planTasks.filter(
        (task) => task.status === 'pending' || task.status === 'in_progress',
      ).length,
      childSessionCount: childSessions.length,
      dagEdgeCount: dagEdges.length,
      dagNodeCount: dagNodes.length,
      failedToolCallCount: toolCallCards.filter((toolCall) => toolCall.isError).length,
      mcpServerCount: mcpServers.length,
      pendingPermissionCount: pendingPermissions.length,
      toolCallCount: toolCallCards.length,
      totalPlanTaskCount: planTasks.length,
    }),
    [
      childSessions.length,
      dagEdges.length,
      dagNodes.length,
      mcpServers.length,
      pendingPermissions.length,
      planTasks,
      toolCallCards,
    ],
  );
  const handleTerminalPanelToggle = useCallback(() => {
    toggleTerminalPanelOpened();
  }, [toggleTerminalPanelOpened]);
  const lastToolName = useMemo(() => {
    if (toolCallCards.length === 0) {
      return null;
    }
    return toolCallCards[toolCallCards.length - 1]?.toolName ?? null;
  }, [toolCallCards]);
  const client = useGatewayClient(token);
  /**
   * 会话切换时立刻断开旧会话的传输。
   *
   * attach 的 cleanup 判据读的是 `currentSessionViewRef`，而该 ref 要等**下一个**
   * effect 才更新；React 又是先跑旧 cleanup、再跑新 effect。于是切走这一拍两个
   * 判据都还是旧值，旧 SSE 会继续存活到下一次 effect 重跑，期间的迟到回调
   * （onerror / onDone / onReconnectRequired）正是「切会话后突然提示断流」的来源。
   *
   * 这里用 `currentSessionId` 的变化作为权威信号，在提交后立刻关闭。只关浏览器侧
   * 连接、不停止服务端 run，回切时按 `afterSeq` 续接。刻意跳过「首页 → 会话」
   * （previous 为 null）这一拍：新建会话的首条消息可能已经先建好了流。
   */
  const previousSessionIdRef = useRef(currentSessionId);
  useEffect(() => {
    const previousSessionId = previousSessionIdRef.current;
    previousSessionIdRef.current = currentSessionId;
    if (previousSessionId === null || previousSessionId === currentSessionId) {
      return;
    }
    // 关键守卫：只关**属于上一个会话**的传输。
    //
    // 「从会话 A 切到新会话 B 并立刻发第一条消息」这条路径上，`setCurrentSessionId(B)`
    // 与 `client.stream(B)` 落在同一个 microtask 里，而 React 的 passive effect 是
    // macrotask——于是 `stream()` 先建立、`closeTransports()` 后执行，会把刚开的流
    // 当场掐断（`activeRequestRef` / `streaming` 都不回滚），表现为「新建 / 分支会话
    // 丢消息 + 一直转圈」。此时在途传输的 sessionId 已经是 B，不能关。
    if (client.getActiveStreamSessionId() !== previousSessionId) {
      return;
    }
    client.closeTransports();
  }, [client, currentSessionId]);
  const taskToolRuntimeLookup = useMemo(
    () => buildTaskToolRuntimeLookup(childSessions, sessionTasks),
    [childSessions, sessionTasks],
  );
  const subAgentRunItems = useMemo(
    () => buildSubAgentRunItems(childSessions, sessionTasks, currentSessionId),
    [childSessions, sessionTasks, currentSessionId],
  );
  /**
   * 「上次查看了哪个子会话」按会话记在 `uiState` 里：刷新 / 换端 / 切走再切回时，
   * 右侧「子代理」面板仍停在上次那个子会话，而不是被自动选择改回运行中的那个。
   */
  const rememberedChildSessionId = useUIStateStore((s) =>
    currentSessionId === null ? null : (s.activeChildSessionIdBySession[currentSessionId] ?? null),
  );
  const persistActiveChildSessionId = useUIStateStore((s) => s.setActiveChildSessionId);
  /**
   * 只在用户**显式**选中子会话时落库（点击卡片 / 通知行 / 列表 / 切换器 / Alt+↑↓）。
   *
   * 不用 effect 监听 `selectedChildSessionId` 变化：自动回填也会改它，而切会话时父会话
   * 与选中态的更新不在同一提交里——监听变化会把上一个会话的子会话 id 写进新会话的桶。
   * 显式选择发生在当前会话上下文内，归属天然正确。
   */
  const rememberActiveChildSession = useCallback(
    (childSessionId: string) => {
      if (currentSessionId === null) {
        return;
      }
      persistActiveChildSessionId(currentSessionId, childSessionId);
    },
    [currentSessionId, persistActiveChildSessionId],
  );
  /**
   * 子代理选择编排：显式选择（点击卡片 / 通知行 / 列表 / 键盘导航）优先，
   * 运行列表变化只做兜底回填，绝不覆盖用户刚点开的目标。
   * 自动选择 / Alt+↑↓ 导航 / 面板打开策略的细节见 hook 内注释。
   */
  const { openChildSessionInspector } = useChildSessionSelection({
    currentSessionId,
    isFusionLayout,
    isMobileViewport,
    rightTab,
    rememberedChildSessionId,
    selectedChildSessionId,
    setReviewPanelOpened,
    setRightOpen,
    setRightTab,
    setSelectedChildSessionId,
    setSidePanelActiveTab,
    subAgentRunItems,
    onExplicitChildSessionSelected: rememberActiveChildSession,
  });
  const userHistoryJumpItems = useMemo(() => buildUserHistoryJumpItems(messages), [messages]);
  /**
   * Latest non-streaming assistant message id. `CollapsibleAssistantContent`
   * skips its auto-fold for this exact message so the most recent reply
   * stays fully visible — long replies usually carry the answer to the
   * just-asked question and folding them hides the punchline. Older long
   * replies still collapse to keep the scrollback compact.
   *
   * Streaming messages are skipped because their fold wrapper is already
   * disabled (the streaming branch in AssistantRichContentBody bypasses
   * CollapsibleAssistantContent entirely).
   */
  const latestAssistantMessageId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i];
      if (!m) continue;
      if (m.role !== 'assistant') continue;
      if (m.status === 'streaming') continue;
      return m.id;
    }
    return null;
  }, [messages]);
  /**
   * 「后台任务」面板的「查看终端」入口：后台命令行与终端管理分属两个 tab，
   * 这里把跳转与选中态一起提升到 ChatPage —— 切到 `terminals` tab，并把目标
   * 终端 id 透传给右栏（终端列表据此展开 / 高亮该行）。
   */
  const [backgroundTaskPreviewTerminalId, setBackgroundTaskPreviewTerminalId] = useState<
    string | null
  >(null);
  const handlePreviewBackgroundTerminal = useCallback(
    (terminalId: string) => {
      setRightOpen(true);
      setRightTab('terminals');
      setBackgroundTaskPreviewTerminalId(terminalId);
    },
    [setRightOpen, setRightTab],
  );
  /**
   * Fusion 布局的「查看终端」：Fusion 没有右栏「终端管理」tab，终端在**底部终端面板**，
   * 因此改为展开底部面板并把目标终端 id 记入同一份选中态（供后续聚焦高亮消费）。
   */
  const handlePreviewBackgroundTerminalFusion = useCallback(
    (terminalId: string) => {
      setTerminalPanelOpened(true);
      setBackgroundTaskPreviewTerminalId(terminalId);
    },
    [setTerminalPanelOpened],
  );
  // 离开「终端管理」后清除选中高亮：下次手动切回时不应残留上一次的预览态。
  useEffect(() => {
    if (rightTab !== 'terminals') {
      setBackgroundTaskPreviewTerminalId(null);
    }
  }, [rightTab]);

  /**
   * 常驻胶囊的「打开后台面板」：按布局路由到已交付的完整面板——
   * fusion 切停靠侧栏的 `background` tab，classic 展开右栏并切到「后台任务」tab。
   */
  const handleOpenBackgroundTaskPanel = useCallback(() => {
    if (isFusionLayout) {
      setSidePanelActiveTab('background');
      return;
    }
    setRightOpen(true);
    setRightTab('background');
  }, [isFusionLayout, setRightOpen, setRightTab, setSidePanelActiveTab]);

  /**
   * 打开「文件变更」面板：fusion 布局走停靠侧栏的审查 tab（可接受/拒绝），
   * classic 布局没有审查面板，退回到右栏「快照」tab（可预览 / 恢复）。
   * 顺带自增 review revision，确保打开时拉取的是最新投影。
   *
   * 同时关闭重试 / 编辑弹窗：它们都是全屏遮罩（zIndex 高于右栏），不关掉会挡住面板。
   */
  const openFileChangesPanel = useCallback(() => {
    setRetryPrompt(null);
    setHistoryEditPrompt(null);
    setReviewRefreshRevision((revision) => revision + 1);
    if (isFusionLayout) {
      setSidePanelActiveTab('review');
      setReviewPanelOpened(true);
      return;
    }
    setRightOpen(true);
    setRightTab('snapshots');
    // setRightOpen / setRightTab 来自 useChatUiState(自定义 hook,编译器视为反应式值),
    // 原依赖漏列会让编译器放弃优化整个 ChatPage;setter 身份稳定,补上不改变行为。
  }, [isFusionLayout, setReviewPanelOpened, setRightOpen, setRightTab, setSidePanelActiveTab]);

  // 路由 sessionId 的 ref 镜像。用于让「与当前会话无关」的 effect（保存的
  // provider/model 默认值加载）读取最新 sessionId 而不必把它列入依赖 ——
  // 否则每次切会话都会重发一次与会话无关的 /settings/providers。
  // 镜像写在 effect 里（渲染期写 ref 会让 React Compiler 放弃优化整个 ChatPage）；
  // 唯一读取点是下方「保存的默认值加载」effect（声明在本 effect 之后，passive effect
  // 按注册顺序执行），其 `.then` 回调更是异步读取，因此读到的必定是本次提交的最新值。
  const routeSessionIdRef = useRef(sessionId);
  useEffect(() => {
    routeSessionIdRef.current = sessionId;
  }, [sessionId]);

  const loadSavedChatDefaults = useCallback(async () => {
    if (!token) {
      return null;
    }
    const {
      defaults,
      imageDefaults,
      providers: loadedProviders,
    } = await loadSavedChatSessionDefaults(gatewayUrl, token);
    writeRefCurrent(savedChatDefaultsRef, defaults);

    return {
      defaults,
      imageDefaults,
      providers: loadedProviders,
    };
  }, [gatewayUrl, token]);

  /**
   * 输入框模型弹层里的「刷新模型列表」。
   *
   * `providers` 是本页进页面时抓取的快照；用户在设置页增删模型 / 启停 Provider 后，
   * 不重载整页这里永远是旧目录，只能靠刷新页面才能看到新模型。该回调按需重拉一次
   * `/settings/providers` 并原地替换目录（同时刷新会话默认值 ref，供无绑定会话回退
   * 使用），**不改动当前会话已选中的模型**——刷新目录不等于替用户改选型。
   */
  const refreshProviderCatalog = useCallback(async () => {
    if (!token || providersRefreshing) {
      return;
    }
    // try/catch/finally 下沉到模块级 `runProviderCatalogRefreshOnce`（见其注释）。
    await runProviderCatalogRefreshOnce({
      onStart: () => {
        setProvidersRefreshing(true);
      },
      onError: (error) => {
        toast(error instanceof Error ? error.message : '刷新模型列表失败，请稍后重试', 'error');
      },
      onFinally: () => {
        setProvidersRefreshing(false);
      },
      run: async () => {
        const loaded = await loadSavedChatDefaults();
        if (!loaded) {
          return;
        }
        setProviders(loaded.providers);
      },
    });
  }, [loadSavedChatDefaults, providersRefreshing, token]);

  const handleContextWindowOverrideChange = useModelContextOverride({
    activeModelId,
    activeProviderId,
    gatewayUrl,
    setProviders,
    token,
  });

  useEffect(() => {
    if (!token) return;
    void loadSavedChatDefaults()
      .then((loaded) => {
        if (!loaded) {
          return;
        }

        const { defaults, imageDefaults, providers: loadedProviders } = loaded;

        // 会话路由下**不**用全局默认值填补 provider/model：切换会话会先把二者清空，
        // 再由异步 recovery 应用该会话持久化的绑定。若此处抢先补默认值，一旦会话绑定
        // 「慢一拍」，输入框就会先显示全局默认模型并把它当作会话选型（dirty）回写，
        // 覆盖会话原本指定的模型 / 思考等级。默认值只服务于无会话的欢迎页输入框；
        // 会话确实没有绑定（metadata 无 providerId/modelId）时，由
        // `shouldAdoptSessionModelSelectionDefaults` 在水合完成后统一接管。
        setActiveProviderId((prev) => (routeSessionIdRef.current ? prev : defaults.providerId));
        setActiveModelId((prev) => (routeSessionIdRef.current ? prev : defaults.modelId));

        setProviders(loadedProviders);
        // Only seed chat-page image defaults from saved settings on first load.
        // Re-applying on every sessionId change would silently revert any
        // size/quality/format/background the user just adjusted in the composer.
        if (!hasAppliedSavedImageDefaultsRef.current) {
          applySavedImageDefaults(imageDefaults);
          writeRefCurrent(hasAppliedSavedImageDefaultsRef, true);
        }

        if (!routeSessionIdRef.current) {
          setThinkingEnabled(defaults.thinkingEnabled);
          setReasoningEffort(defaults.reasoningEffort);
        }
      })
      .catch(() => null);
    // 刻意不含 sessionId：保存的 provider/model 默认值与会话无关，切换会话时
    // 通过 routeSessionIdRef 读取最新值即可，无需重发 /settings/providers。
    // 依赖省略是刻意取舍。不要在此处加回 lint 抑制指令——编译器按文本匹配
    // 识别它，会放弃优化整个 ChatPage。
  }, [applySavedImageDefaults, loadSavedChatDefaults, token]);

  useEffect(() => {
    const savedDefaults = savedChatDefaultsRef.current;
    if (!savedDefaults || !sessionModesHydrated) {
      return;
    }

    if (
      !shouldAdoptSessionModelSelectionDefaults({
        sessionId,
        source: sessionModelSelectionSourceRef.current,
        defaultProviderId: savedDefaults.providerId,
        defaultModelId: savedDefaults.modelId,
      })
    ) {
      return;
    }

    sessionModelSelectionSourceRef.current = 'defaults';
    setActiveProviderId((prev) => prev.trim() || savedDefaults.providerId);
    setActiveModelId((prev) => prev.trim() || savedDefaults.modelId);
    markSessionMetadataDirty();
  }, [markSessionMetadataDirty, sessionId, sessionModesHydrated]);

  const { loadSessionRuntimeSnapshot, syncRecoveredStreamSnapshot, loadCurrentSessionSnapshot } =
    useSessionSnapshotLoader(
      gatewayUrl,
      token,
      isCurrentSessionView,
      { currentSessionViewRef, streamingRef },
      {
        setMessages,
        setMessageRatings,
        setRightPanelState,
        setSessionTodos,
        setChildSessions,
        setSessionTasks,
        setWorkflowRuntime,
        setPendingPermissions,
        setPendingQuestions,
        setSessionStateStatus,
        setRecoveryActiveStream,
        setLatestUpstreamSummary,
        setRecoveredStreamSnapshot,
        setIsSessionSnapshotReady,
        setSubagentNotices,
      },
    );

  const { loadEarlierHistory, hasMoreHistory } = useSessionHistoryLoader({
    gatewayUrl,
    token,
    currentSessionId,
    reloadKey: sessionReloadNonce,
    currentSessionViewRef,
    messagesRef,
    isCurrentSessionView,
    setMessages,
    setSubagentNotices,
    setServerTotalTurnCount,
  });
  const ensureMessageVisible = useEnsureMessageVisible({
    currentSessionId,
    loadEarlierHistory,
    messages,
    requestMessageScroll,
    setVisibleMessageCount,
    visibleMessageCount,
  });

  const {
    activeStreamMessageId,
    activeStreamRoundStart,
    canStopCurrentSessionStream,
    composerSessionBusyState,
    remoteSessionBusyState,
    sessionReconnecting,
    shouldPollSessionSubresources,
    stopCapability,
    visibleLatestUpstreamSummary,
    visibleReportedStreamUsage,
    visibleStreamBuffer,
    visibleStreamRenderable,
    visibleStreamStartedAt,
    visibleStreamThinkingBlocks,
    visibleStreamThinkingBuffer,
    visibleStreaming,
    visibleStreamingSegments,
  } = useChatSessionRuntimeView({
    activeStreamRoundStartedAt,
    activeStreamStartedAt,
    attachRetryScheduledSessionId,
    client,
    currentAssistantStreamMessageIdRef,
    currentSessionId,
    inlinePermissionPendingDecision,
    inlineQuestionReplyStatus,
    isPageActive,
    isSessionLoading,
    isSessionSnapshotReady,
    latestUpstreamSummary,
    pendingPermissions,
    pendingQuestions,
    recoveredStreamSnapshot,
    recoveryActiveStream,
    reportedStreamUsage,
    sessionModesHydrated,
    sessionStateStatus,
    sessionTasks,
    streamBuffer,
    streamThinkingBlocks,
    streamThinkingBuffer,
    streaming,
    streamingSegments,
    token,
  });
  const activeGatewayStreamClientRequestId = client.getActiveStreamClientRequestId();
  const activeGatewayStreamSessionId = client.getActiveStreamSessionId();

  useEffect(() => {
    if (!currentSessionId || !token) {
      return;
    }

    // recovery 在途期间必须**既不发请求、也不消费 null 基线**。
    //
    // 切会话时 `lastParentTaskSyncMarkerRef` 被重置为 null，而 `sessionTasks`
    // 也被同步清空 —— 若此处照旧把「清空态」记成基线，基线就变成空串；待
    // recovery 落地、真实任务集到达时 marker 与空串不等，会被误判为「任务集
    // 发生变化」而多打一次 recovery（每次切会话必现的重复请求）。
    //
    // 因此加载中直接返回且不写入 marker：等 `sessionTasks` 随 recovery 落地后
    // 再由下方 `:null` 分支用真实任务集建立基线。
    if (isSessionLoading) {
      return;
    }

    const nextMarker = buildTerminalTaskSyncMarker(sessionTasks);
    if (lastParentTaskSyncMarkerRef.current === null) {
      writeRefCurrent(lastParentTaskSyncMarkerRef, nextMarker);
      return;
    }

    if (
      nextMarker.length === 0 ||
      nextMarker === lastParentTaskSyncMarkerRef.current ||
      streaming
    ) {
      return;
    }

    let cancelled = false;
    const targetSessionId = currentSessionId;
    const expectedSessionViewEpoch = currentSessionViewRef.current.epoch;
    const snapshotController = new AbortController();

    // 走会话 recovery 的在途单飞层：切会话同一 commit 内 ChatPage 的任务同步
    // 与 `run-chat-session-switch-effect`、`useLayoutShared` 读的是同一份快照，
    // 直连 getRecovery 会把同一次切换的快照请求打两遍。
    void fetchSessionRecoveryOnce({
      gatewayUrl,
      token,
      sessionId: targetSessionId,
      messageLimit: INITIAL_TURN_LIMIT,
      signal: snapshotController.signal,
    })
      .then((session) => {
        if (cancelled || !isCurrentSessionView(targetSessionId, expectedSessionViewEpoch)) {
          return;
        }

        const prepared = prepareSessionRecoveryState(session);
        writeRefCurrent(lastParentTaskSyncMarkerRef, nextMarker);
        // Recovery commit involves a full message-list re-render incl.
        // markdown / reasoning / tool cards — keep it non-urgent so React
        // can split work across frames instead of blocking the main thread.
        startSessionSwitchTransition(() => {
          // 如果当前正在流式发送，不更新消息列表——流式状态是权威的，
          // 避免用服务器的旧快照覆盖本地刚添加的用户消息和流式内容。
          // 额外保护：即使 streaming 为 false，但距离流式开始不到 3 秒，也跳过更新。
          const timeSinceStreamStart =
            activeStreamStartedAt !== null ? Date.now() - activeStreamStartedAt : Infinity;
          if (!streamingRef.current && timeSinceStreamStart > 3000) {
            setMessages((previous) => {
              const reconciled = reconcileSnapshotChatMessages(
                previous,
                prepared.normalizedMessages,
              );
              // 额外保护：如果协调后的消息为空，但本地有消息，保留本地消息
              // 这防止在对话完成后消息被意外清空
              if (reconciled.length === 0 && previous.length > 0) {
                console.log('[RECOVERY] 跳过清空消息，保护本地状态', {
                  previousLength: previous.length,
                  reconciledLength: reconciled.length,
                  snapshotLength: prepared.normalizedMessages.length,
                });
                return previous;
              }
              return reconciled;
            });
          } else {
            console.log('[RECOVERY] 跳过消息协调，保护本地流式状态', {
              streaming: streamingRef.current,
              timeSinceStreamStart,
            });
          }
          setMessageRatings(prepared.messageRatings);
          setRightPanelState(
            buildRightPanelStateFromSessionSnapshot(prepared.session, prepared.normalizedMessages),
          );
          setSessionTodos(prepared.sessionTodos);
          setChildSessions(session.children);
          setSessionTasks(session.tasks);
          setWorkflowRuntime(prepared.session.workflowRuntime ?? null);
          setPendingPermissions(prepared.pendingPermissions);
          setPendingQuestions(prepared.pendingQuestions);
          // 父任务状态变化（例如子代理结算）会走到这里；通知必须同源刷新，
          // 否则后台子代理完成时用户要等到下一次流式结束才看得到通知行。
          setSubagentNotices(collectSubagentNotices(session.session?.messages ?? []));
          setSessionStateStatus(prepared.sessionStateStatus);
          syncRecoveredStreamSnapshot(
            prepared.session,
            prepared.sessionStateStatus,
            session.activeStream,
            prepared.normalizedMessages,
          );
        });
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      // 只掐断自己这一份等待；共享请求由在途层按订阅者计数决定何时真正中止。
      snapshotController.abort();
    };
  }, [
    currentSessionId,
    gatewayUrl,
    isCurrentSessionView,
    isSessionLoading,
    sessionTasks,
    streaming,
    syncRecoveredStreamSnapshot,
    token,
  ]);

  useSessionSidebarRunState({
    activeStreamSessionId: activeGatewayStreamSessionId,
    currentSessionId,
    sessionStateStatus,
    streaming,
  });

  // useScrollManager 刻意声明在此处（而非原先靠后位置）：其 forceFollowToLatest /
  // restoreScrollTop 在下方 session-switch effect 的配置里就要用，声明晚于使用
  // 会被编译器判为「声明前访问」而放弃优化整个 ChatPage。
  // 全部入参（ui 的 refs / setter、currentSessionId、messages、visibleStreaming /
  // visibleStreamBuffer、editorMode）在本行之前均已声明。
  const {
    isFollowingRef,
    handleScroll,
    scrollToBottom,
    forceFollowToLatest,
    isFollowEngaged,
    restoreScrollTop,
  } = useScrollManager(
    {
      scrollRegionRef,
      bottomRef,
      pendingScrollFrameRef,
      contentColumnRef,
      editorPaneRef,
      textareaRef,
    },
    { setShowScrollToBottom, setHasPendingFollowContent },
    {
      sessionKey: currentSessionId,
      messagesLength: messages.length,
      visibleStreaming,
      visibleStreamBufferLength: visibleStreamBuffer.length,
      editorMode,
    },
    {
      // 上滑到顶部附近时动态加载更早的历史消息（本地窗口 / 服务端快照）。
      // 门控走 ref：`hiddenMessageCount` 在下方 `useChatRenderData` 才派生。
      onNearTop: () => {
        if (hiddenMessageCountRef.current > 0) {
          loadEarlierMessagesRef.current?.();
        }
      },
      nearTopThreshold: 120,
      nearTopDebounceMs: 800,
    },
  );

  useEffect(() => {
    return runChatSessionSwitchEffect({
      activateSessionView,
      activeSessionRef,
      activeStreamStartedAtRef,
      attachAttemptedSessionRef,
      cancelAttachRetry,
      chatView,
      clearSessionMetadataDirty,
      currentAssistantStreamMessageIdRef,
      currentLoadedSessionIdRef,
      // 缓存恢复分支在「上次离开时就在最新处」时用它贴底（而不是按绝对值
      // 恢复位置）——见 run-chat-session-switch-effect 的缓存恢复注释。
      forceFollowToLatest,
      gatewayUrl,
      isCurrentSessionView,
      lastPersistedSessionMetadataSnapshotRef,
      latestUpstreamSummary,
      messagesRef,
      navigateToHome,
      navigateToSession,
      pendingBootstrapSessionRef,
      pendingSessionNormalizeTimeoutRef,
      reportedStreamUsageRef,
      resetStreamState,
      restoreScrollTop,
      rightPanelStateRef,
      scrollRegionRef,
      sessionId,
      sessionMetadataDirtyRef,
      sessionModelSelectionSourceRef,
      sessionReloadNonce,
      sessionRestoredFromCacheRef,
      sessionStateStatus,
      sessionViewCache,
      setActiveModelId,
      setActiveProviderId,
      setChildSessions,
      setCurrentSessionId,
      setDialogueMode,
      setIsSessionLoading,
      setIsSessionSnapshotReady,
      setManualAgentId,
      setMessageRatings,
      setMessages,
      setPendingPermissions,
      setPendingQuestions,
      setPermissionMode,
      setReasoningEffort,
      setRecoveredStreamSnapshot,
      setRecoveryActiveStream,
      setRightPanelState,
      setSelectedChildSessionId,
      setServerTotalTurnCount,
      setSessionModesHydrated,
      setSessionStateStatus,
      setSessionTasks,
      setSessionTodos,
      setShowSkeletonAfterDelay,
      setSubagentNotices,
      setThinkingEnabled,
      setVisibleMessageCount,
      setWebSearchEnabled,
      setWorkflowRuntime,
      skeletonDelayTimerRef,
      startSessionSwitchTransition,
      streamFrameHandleRef,
      streamBufferRef,
      streamThinkingBlocksRef,
      streamingRef,
      streamingSegmentsRef,
      syncRecoveredStreamSnapshot,
      tokenRef: sessionSwitchTokenRef,
      webSearchAvailable,
      DEFAULT_VISIBLE_MESSAGE_COUNT,
      INITIAL_TURN_LIMIT,
    });
  }, [
    activateSessionView,
    chatView,
    clearSessionMetadataDirty,
    cancelAttachRetry,
    gatewayUrl,
    isCurrentSessionView,
    navigateToHome,
    navigateToSession,
    resetStreamState,
    sessionId,
    sessionReloadNonce,
    sessionViewCache,
    syncRecoveredStreamSnapshot,
    // 刻意不含 `token` 值：token 轮换与会话身份无关，放进来会让「已停止的会话」
    // 每 ~13 分钟整体重载一次（骨架屏 + 状态归零 + 全量 recovery）。effect 内
    // 通过 `sessionSwitchTokenRef` 读取最新 token，语义不变。
    // 只保留「有没有令牌」这个布尔量，保证鉴权就绪时仍会跑一次。
    hasSessionToken,
  ]);

  useChatDataLoaders({
    currentSessionId,
    // 传文件浏览根（而非 effectiveWorkingDirectory）：未绑定会话同样加载
    // 默认工作区的文件树，让 @ 引用在无工作区会话里可用。
    effectiveWorkingDirectory: fileBrowseRoot,
    workspace,
    workspaceTreeVersion,
    setWorkspaceFileItems,
    token,
    gatewayUrl,
    rightOpen,
    rightTab,
    setMcpServers,
  });

  useSessionRecoveryPolling({
    attachRetryScheduledSessionId,
    currentSessionId,
    currentSessionViewRef,
    isPageActive,
    isSessionSnapshotReady,
    loadCurrentSessionSnapshot,
    loadSessionRuntimeSnapshot,
    recoveryActiveStream,
    remoteSessionBusyState,
    sessionModesHydrated,
    shouldPollSessionSubresources,
    streaming,
    streamingRef,
    token,
  });

  // 「running 但持续无活跃流」检测与恢复入口（"批准后卡住"的客户端兜底）：
  // 网关侧 resume 早期失败若未把会话状态收敛回 idle，会话会永远停在 running 却
  // 没有活跃流——attach 重试全部落空、发送键被无限禁用。超过阈值后状态条展示
  // 「重新同步」：stop-active 权威收敛（无活跃流时是纯状态修复，语义安全）+
  // 刷新本地快照。
  //
  // 已知取舍：stop-active 的既有语义是「整会话停止」——会连带作废该会话全部
  // 待审批 / 待回答。只有「running + 无活跃流持续 60s+」这一矛盾形态（网关正确
  // 时应为 paused）才会亮按钮，此时那些待办本就卡在不可操作的界面上；网关修复
  // （stream-runtime.ts 的 convergeSessionStateAfterFailedResume）上线后该形态
  // 不再产生，此处仅纵深防御。
  const handleStaleRunningResync = useCallback(async () => {
    if (!currentSessionId || !token) {
      return;
    }
    try {
      await createSessionsClient(gatewayUrl).stopActiveStream(token, currentSessionId);
    } catch (error) {
      toast(error instanceof Error ? error.message : '重新同步失败', 'error');
      return;
    }
    requestCurrentSessionRefresh(currentSessionId);
  }, [currentSessionId, gatewayUrl, token]);

  const staleRunningResync = useStaleRunningResync({
    hasActiveStream: recoveryActiveStream !== null,
    isPageActive,
    onResync: handleStaleRunningResync,
    sessionId: currentSessionId,
    status: remoteSessionBusyState,
  });

  // 下面三个写入器把「改父组件 ref」收回到组件内：hook 内直接写 ref 会被
  // React Compiler 判为 mutating hook arguments，从而放弃编译整个 ChatPage。
  const markSessionCacheRestoreConsumed = useCallback((): void => {
    sessionRestoredFromCacheRef.current = false;
  }, [sessionRestoredFromCacheRef]);

  const setLastAnchorMessageId = useCallback(
    (id: string | null): void => {
      // `lastAnchorMessageIdRef` 来自 hook 返回值，直接写会被 React Compiler
      // 判为不可变值的变更并放弃优化整个 ChatPage。
      writeRefCurrent(lastAnchorMessageIdRef, id);
    },
    [lastAnchorMessageIdRef],
  );

  const setModelSelectionSource = useCallback(
    (
      source: Parameters<
        Parameters<typeof useSessionMetadataPersist>[0]['setModelSelectionSource']
      >[0],
    ): void => {
      sessionModelSelectionSourceRef.current = source;
    },
    [sessionModelSelectionSourceRef],
  );
  useSessionMetadataPersist({
    activeModelId,
    activeProviderId,
    activeSessionRef,
    buildSessionMetadata,
    clearSessionMetadataDirty,
    currentSessionId,
    gatewayUrl,
    lastPersistedSessionMetadataSnapshotRef,
    providers,
    requestSessionListRefresh,
    sessionMetadataDirty,
    sessionModesHydrated,
    sessionModelSelectionSourceRef,
    setModelSelectionSource,
    token,
  });

  useChatScrollSettleEffects({
    forceFollowToLatest,
    isFollowEngaged,
    isPageActive,
    isSessionSnapshotReady,
    markSessionCacheRestoreConsumed,
    messagesLength: messages.length,
    sessionRestoredFromCacheRef,
  });

  const {
    handleCopyMessage,
    handleCopyMessageGroup,
    handleEditRetryMessage,
    handleRetryMessage,
    buildMessageActions,
  } = useChatMessageActions({
    messages,
    messageRatings,
    onToggleMessageRating: handleToggleMessageRating,
    setHistoryEditPrompt,
    setRetryPrompt,
  });

  const {
    appendTextToComposer,
    focusComposerWithText,
    handleEditPreviousUserMessage,
    handleRetryLastFailedTurn,
    handleStartNewSession,
  } = useChatComposerShortcuts({
    currentSessionId,
    handleEditRetryMessage,
    handleRetryMessage,
    messages,
    navigate,
    selectedSshConnectionId,
    selectedWorkspacePath,
    setDialogueMode,
    setInput,
    textareaRef,
  });

  useEffect(() => {
    const handleComposerReference = (event: Event) => {
      if (!isComposerReferenceEvent(event)) {
        return;
      }

      appendTextToComposer(event.detail.text);
    };

    window.addEventListener(COMPOSER_REFERENCE_EVENT_NAME, handleComposerReference);
    return () => {
      window.removeEventListener(COMPOSER_REFERENCE_EVENT_NAME, handleComposerReference);
    };
  }, [appendTextToComposer]);

  const { createBranchSessionFromMessage } = useChatBranchSession({
    token,
    gatewayUrl,
    currentSessionId,
    activeSessionRef,
    pendingBootstrapSessionRef,
    setCurrentSessionId,
    setMessages,
    clearSessionMetadataDirty,
    buildSessionMetadata,
    lastPersistedSessionMetadataSnapshotRef,
    setSessionModesHydrated,
    resetStreamState,
    setStreamError,
    focusComposerWithText,
    requestSessionListRefresh,
    navigateToSession: (nextSessionId) => {
      void navigate(`/chat/${nextSessionId}`);
    },
    sendMessage,
  });

  async function ensureSession(): Promise<string> {
    return runEnsureSession({
      activateSessionView,
      activeModelId,
      activeProviderId,
      activeSessionRef,
      applySavedImageDefaults,
      buildSessionMetadata,
      clearSessionMetadataDirty,
      currentSessionId,
      currentSessionViewRef,
      gatewayUrl,
      hasAppliedSavedImageDefaultsRef,
      lastPersistedSessionMetadataSnapshotRef,
      loadSavedChatDefaults,
      navigate,
      pendingBootstrapSessionRef,
      providers,
      reasoningEffort,
      savedChatDefaultsRef,
      sessionMetadataDirty,
      sessionModelSelectionSourceRef,
      setActiveModelId,
      setActiveProviderId,
      setCurrentSessionId,
      setProviders,
      setReasoningEffort,
      setSessionModesHydrated,
      setThinkingEnabled,
      thinkingEnabled,
      token,
    });
  }

  const appendImageGenerationSummaryMessage = useAppendImageGenerationSummary({ setMessages });

  // 提交单飞闩：从点击到 `startStandardChatStream` 置位 streaming 之间存在异步窗口
  // （新建会话、上传附件都可能有秒级延迟），期间 streaming / streamingRef 都还是
  // false，第二次点击会绕过 runSendMessage 的忙判定再起一个流，两个流撞在一起被
  // 网关单飞锁拒成 SESSION_ALREADY_RUNNING——用户看到的就是「第一次没反应，再点
  // 一次报错」。闩在入口同步置位、结算即释放；释放后若流已在跑，由 streamingRef 兜底。
  const sendingRef = useRef(false);

  // useProviderModelInfo 刻意声明在此处（而非原先靠后位置）：其 activeModelOption /
  // effectiveProviderId / effectiveModelId 在下方 sendMessage 的配置里就要用，
  // 声明晚于使用会被编译器判为「声明前访问」而放弃优化整个 ChatPage。
  // 全部入参（providers / activeProviderId / activeModelId / savedChatDefaultsRef /
  // setter）在本行之前均已声明。
  const {
    activeProvider,
    providerCatalog,
    activeModelOption,
    activeModelCanConfigureThinking,
    activeModelTooltip,
    effectiveProviderId,
    effectiveModelId,
  } = useProviderModelInfo({
    providers,
    activeProviderId,
    activeModelId,
    // 传 ref 而不是渲染期读出的值：`savedChatDefaultsRef.current` 只能在异步加载
    // 回调（loadSavedChatDefaults）里改写，而渲染期读 ref 会被 React Compiler 判定为
    // "Cannot access refs during render" 并放弃优化整个 ChatPage。hook 内部以参数对象
    // 成员访问取 `.current?.providerId / modelId`，等价于原来的渲染期读取。
    chatDefaultsRef: savedChatDefaultsRef,
    // 已有会话路由但会话 metadata 尚未水合：这一窗口内不得用全局默认值填补空选型，
    // 否则会话自己的模型绑定到达时已经被默认模型抢先占位（见
    // use-provider-model-info 的 `sessionBindingPending` 说明）。
    sessionBindingPending: Boolean(sessionId) && !sessionModesHydrated,
    setActiveProviderId,
    setActiveModelId,
  });

  async function sendMessage(
    overrideText?: string,
    options?: {
      existingInputParts?: InputImageContent[];
      forcedSessionId?: string;
      queuedAttachmentItems?: AttachmentItem[];
      queuedFiles?: File[];
      queuedMessageId?: string;
    },
  ): Promise<boolean> {
    if (sendingRef.current) {
      // 队列来源的发送是后台行为，静默返回即可（flush 会自行回填并退避重试）；
      // 用户手动再点则必须给出反馈，否则又一次「看起来没反应」。
      if (!options?.queuedMessageId) {
        toast('上一条消息正在发送中，请稍候', 'warning');
      }
      return false;
    }
    sendingRef.current = true;
    return runSendMessage(
      {
        activeModelOption,
        activeProvider,
        activeSessionRef,
        appendAssistantEventMessages,
        appendCommandCard,
        appendImageGenerationSummaryMessage,
        bumpCompanionPanelSignal,
        client,
        composerCommandDescriptors,
        currentAssistantStreamMessageIdRef,
        currentSessionId,
        devServerDetectedTerminalIdsRef,
        dialogueMode,
        effectiveAgentId,
        effectiveModelId,
        effectiveProviderId,
        ensureSession,
        gatewayUrl,
        generateImageForSession,
        hasConfiguredImageModel,
        imageGenerationBusy,
        imageGenerationMode,
        imageModelLabel,
        isFollowingRef,
        loadCurrentSessionSnapshot,
        loadPendingQuestionForSession,
        prefersReducedMotion,
        queuedComposerScope,
        reasoningEffort,
        remoteSessionBusyState: composerSessionBusyState,
        resetStreamState,
        resolveAssistantCapabilityKind,
        rightOpenRef,
        scheduleStreamReveal,
        scrollToBottom,
        selectedImageEditReferenceArtifact,
        sessionModelSelectionSourceRef,
        sessionModesHydrated,
        sessionTerminals,
        setActiveStreamFirstTokenLatencyMs,
        setActiveStreamRoundStartedAt,
        setActiveStreamStartedAt,
        setBrowserPreviewUrl,
        setChildSessions,
        setEditorMode,
        setHasPendingFollowContent,
        setInput,
        setLatestGeneratedImageResult,
        setLatestUpstreamSummary,
        setMessages,
        setPendingPermissions,
        setPendingQuestions,
        setReportedStreamUsage,
        setRightOpen,
        setRightPanelState,
        setRightTab,
        setSessionReloadNonce,
        setSessionStateStatus,
        setSessionTasks,
        setShowScrollToBottom,
        setStoppingStream,
        setStreamBuffer,
        setStreamError,
        setStreamThinkingBlocks,
        setStreamThinkingBuffer,
        setStreaming,
        setStreamingSegments,
        streamFrameHandleRef,
        streamBufferRef,
        streamThinkingBlocksRef,
        streamingSegmentsRef,
        stoppingStreamRef,
        streamRevealNextAllowedAtRef,
        streamRevealTargetCodePointsRef,
        streamRevealTargetRef,
        streamRevealVisibleCodePointCountRef,
        streamRevealVisibleRef,
        streaming,
        streamingRef,
        thinkingEnabled,
        token,
        webSearchEnabled,
        yoloMode,
        INITIAL_TURN_LIMIT,
      },
      overrideText,
      options,
    ).finally(() => {
      sendingRef.current = false;
    });
  }

  const {
    resolveAssistantCapabilityKind,
    appendAssistantDerivedMessages,
    appendAssistantEventMessages,
  } = useAssistantMessageProcessing({
    composerWorkspaceCatalog,
    setMessages,
  });

  const { stopActiveMessage } = useChatStopActiveMessage({
    client,
    currentSessionId,
    currentSessionViewRef,
    gatewayUrl,
    initialTurnLimit: INITIAL_TURN_LIMIT,
    loadCurrentSessionSnapshot,
    logger,
    pendingStreamRevealFrameRef,
    requestSessionListRefresh,
    setStoppingStream,
    setStreamError,
    stopCapability,
    stoppingStream,
    stoppingStreamRef,
    streamRevealNextAllowedAtRef,
    streamRevealTargetCodePointsRef,
    streamRevealTargetRef,
    streamRevealVisibleCodePointCountRef,
    streamRevealVisibleRef,
    streaming,
    token,
  });

  const handleRetryMcpServer = useMcpServerRetry({ gatewayUrl, setMcpServers, token });

  // ─── 统一工作区面板（Fusion 桌面）────────────────────────────────────────
  // 编辑器 / 浏览器预览在 Fusion 桌面的唯一入口是会话面板的「代码 / 预览」一级
  // tab（共享一个常驻工作区 pane，全屏提升到主内容区）；主内容区的 ChatEditorPane
  // 只服务于移动端与面板的「放大」提升。经典布局保持原分屏行为。
  const dockOwnsWorkspacePanels = isFusionLayout && !isMobileViewport;

  // 浏览器宿主面由「谁可见」派生（见 hook 注释）：提升 / 分屏态归主内容区，
  // 否则归停靠面板。面板 pane 常驻挂载，因此互斥不能依赖挂载 / 卸载副作用。
  useFusionWorkspaceBrowserSurface({ enabled: dockOwnsWorkspacePanels, editorMode });

  const openWorkspacePanelTab = (tab: 'code' | 'preview') => {
    setSidePanelActiveTab(tab);
    setReviewPanelOpened(true);
  };

  const promoteWorkspaceTab = (tab: 'code' | 'browser') => {
    startSessionSwitchTransition(() => {
      promoteFusionWorkspaceTab(
        { setEditorFullScreen, setEditorMode, setEditorPaneTab, setReviewPanelOpened },
        tab,
      );
    });
  };

  const collapseWorkspaceToPanel = () => {
    startSessionSwitchTransition(() => {
      collapseFusionWorkspaceToPanel({
        setEditorFullScreen,
        setEditorMode,
        setEditorPaneTab,
        setReviewPanelOpened,
      });
    });
  };

  // 命令面板与 `/browser` 事件共用：桌面 Fusion 落到面板的「预览」一级 tab
  // （空态带地址输入，绝不伪造默认地址）；经典布局 / 移动端保持原行为。
  const openBrowserPreview = useOpenFusionBrowserPreview({
    browserPreviewUrl,
    collapseWorkspaceToPanel,
    dockOwnsWorkspacePanels,
    editorMode,
    openPreviewPanel: () => openWorkspacePanelTab('preview'),
    setBrowserPreviewUrl,
    setEditorMode,
    setEditorPaneTab,
  });

  // `/browser` 事件只在 messages 变化时重新订阅，而路由决策依赖 editorMode /
  // 布局；这里暴露最新编排，避免事件落进旧闭包（提升态下点了没反应）。
  const openBrowserPreviewRef = useRef(openBrowserPreview);
  useEffect(() => {
    openBrowserPreviewRef.current = openBrowserPreview;
  });

  // 聊天消息 / 工具输出 / 文件预览里的 markdown 链接点击 → 落到会话面板「预览」一级
  // tab（Fusion 桌面）或主内容区浏览器 tab（经典 / 移动端），与 `/open <url>` 的编排
  // 保持一致。事件只在当前页激活时认领；CachedRouteOutlet 会同时挂载多个页面。
  const openLinkPreview = (url: string) => {
    if (dockOwnsWorkspacePanels) {
      setBrowserPreviewUrlForWorkspace(uiWorkspaceScope, url);
      if (editorMode) {
        collapseWorkspaceToPanel();
      }
      openWorkspacePanelTab('preview');
      return;
    }
    setBrowserPreviewUrl(url);
    setEditorMode(true);
    setEditorPaneTab('browser');
  };
  useLinkPreviewRequest(pageActivation, openLinkPreview);

  const { appendCommandCard, handleCompactCurrentSession, handleSaveFile, handleSplitMouseDown } =
    useChatUiActions({
      token,
      gatewayUrl,
      currentSessionId,
      composerCommandDescriptors,
      appendAssistantDerivedMessages,
      appendAssistantEventMessages,
      resolveAssistantCapabilityKind,
      setRightPanelState,
      setRightOpen,
      setRightTab,
      fileEditor,
      openFileRef: openRef,
      setFileEditorAvailable,
      openFileInDockPanel: dockOwnsWorkspacePanels
        ? () => openWorkspacePanelTab('code')
        : undefined,
      setEditorMode,
      setEditorPaneTab,
      setSaving,
      splitDragging,
      splitContainerRef,
      setSplitPos,
    });

  // ─── 重试与历史编辑域 — 抽到 useChatRetryAndEdit。
  // 参见 docs/architecture/chat-page-split-plan.md 域 E。
  const handleRollbackApplied = useRollbackDerivedCleanup({
    childSessions,
    sessionTasks,
    setChildSessions,
    setSelectedChildSessionId,
    setSessionTasks,
    setSubagentNotices,
    subagentNotices,
  });

  const { handleRetryInCurrentSession, handleEditResendInCurrentSession, handleRetryInNewSession } =
    useChatRetryAndEdit({
      gatewayUrl,
      token,
      currentSessionId,
      messages,
      setMessages,
      resetStreamState,
      setStreamError,
      getActiveSessionId: () => activeSessionRef.current,
      retryPrompt,
      setRetryPrompt,
      historyEditPrompt,
      sendMessage,
      createBranchSessionFromMessage,
      onOpenFileChangesPanel: openFileChangesPanel,
      onRollbackApplied: handleRollbackApplied,
    });

  useEffect(() => {
    return runSessionAttachEffect({
      activeGatewayStreamSessionId,
      activeModelOption,
      activeSessionRef,
      activeStreamStartedAt,
      appendAssistantEventMessages,
      attachAttemptedSessionRef,
      attachAttemptWindowRef,
      attachProgressRef,
      attachTerminalReloadRef,
      attachEligibilitySignatureRef,
      attachOwnerSessionIdRef,
      attachRetryExhausted,
      attachRetryScheduledSessionId,
      cancelAttachRetry,
      client,
      currentAssistantStreamMessageIdRef,
      currentSessionId,
      currentSessionViewRef,
      devServerDetectedTerminalIdsRef,
      effectiveAgentId,
      effectiveModelId,
      effectiveProviderId,
      gatewayUrl,
      isCurrentSessionRequest,
      isFollowingRef,
      isPageActive,
      isSessionSnapshotReady,
      lastAttachAttemptTimestampRef,
      loadCurrentSessionSnapshot,
      loadPendingQuestionForSession,
      messagesRef,
      pendingStreamRevealFrameRef,
      prefersReducedMotion,
      recoveredStreamSnapshot,
      recoveryActiveStream,
      resetStreamState,
      resolveAssistantCapabilityKind,
      rightOpenRef,
      scheduleAttachRetry,
      scheduleStreamReveal,
      sessionModesHydrated,
      sessionStateStatus,
      sessionTerminals,
      setActiveStreamFirstTokenLatencyMs,
      setActiveStreamRoundStartedAt,
      setActiveStreamStartedAt,
      setBrowserPreviewUrl,
      setChildSessions,
      setEditorMode,
      setHasPendingFollowContent,
      setLatestUpstreamSummary,
      setMessages,
      setPendingPermissions,
      setPendingQuestions,
      setRecoveredStreamSnapshot,
      setReportedStreamUsage,
      setRightPanelState,
      setRightTab,
      setSessionStateStatus,
      setSessionTasks,
      setStoppingStream,
      setStreamBuffer,
      setStreamError,
      setStreamThinkingBlocks,
      setStreamThinkingBuffer,
      setStreaming,
      setStreamingSegments,
      stoppingStreamRef,
      streamRevealNextAllowedAtRef,
      streamRevealTargetCodePointsRef,
      streamRevealTargetRef,
      streamRevealVisibleCodePointCountRef,
      streamRevealVisibleRef,
      streaming,
      streamingRef,
      token,
      visibleLatestUpstreamSummary,
      INITIAL_TURN_LIMIT,
    });
  }, [
    activeGatewayStreamSessionId,
    activeModelId,
    activeProviderId,
    attachRetryExhausted,
    attachRetryNonce,
    attachRetryScheduledSessionId,
    client,
    cancelAttachRetry,
    currentSessionId,
    isCurrentSessionRequest,
    isPageActive,
    isSessionSnapshotReady,
    loadCurrentSessionSnapshot,
    prefersReducedMotion,
    appendAssistantEventMessages,
    recoveryActiveStream,
    recoveredStreamSnapshot,
    resetStreamState,
    resolveAssistantCapabilityKind,
    scheduleStreamReveal,
    scheduleAttachRetry,
    sessionStateStatus,
    sessionModesHydrated,
    setStreamError,
    streaming,
  ]);

  const composerVariant =
    messages.length === 0 &&
    !visibleStreaming &&
    visibleStreamBuffer.length === 0 &&
    !remoteSessionBusyState
      ? 'home'
      : 'session';
  // 工作区绑定锁：会话一旦产生消息（或正在流式 / 远端运行 / 历史仍在加载）即锁定绑定。
  // 只有「尚未开始对话」的新会话允许快速调整绑定，避免对话开始后误改上下文目录。
  const workspaceBindingLocked =
    messages.length > 0 ||
    streaming ||
    remoteSessionBusyState !== null ||
    (currentSessionId !== null && (isSessionLoading || !isSessionSnapshotReady));
  const canAdjustWorkspaceBinding = !workspaceBindingLocked;

  /**
   * 工作区绑定的统一落地点：草稿态只改本地选中值；已有会话（且绑定未锁定）时同步 PATCH 到网关。
   * 绑定锁兜底：即使入口在锁定后仍被触发，也不会修改已开始对话的会话。
   *
   * 这里只处理**本地**目录：入口是输入框工作区菜单与本地文件树，列表数据来自
   * `useLocalSavedWorkspacePaths()`（已过滤掉远端目录），所以 `sshConnectionId` 恒为 null。
   * 远端工作区必须走 `applySshWorkspaceSelection`，否则会被当成裸路径绑到本机。
   */
  // 同 clearWorkspaceSelection：方法调用会被推断为整个 workspace 依赖 → 取成局部量，
  // 与依赖数组里的 setWorkspace 精确对应（useWorkspace 内该值为 useCallback，身份不变）。
  const { setWorkspace } = workspace;
  const applyWorkspaceSelection = useCallback(
    async (path: string): Promise<void> => {
      const normalizedPath = path.trim();
      if (!normalizedPath) {
        return;
      }

      // `currentSessionId && canAdjustWorkspaceBinding` 是值块：留在 try 内会让编译器脱靶，
      // 故先算好布尔量。
      const shouldRebindWorkspace = Boolean(currentSessionId && canAdjustWorkspaceBinding);
      try {
        if (shouldRebindWorkspace) {
          await setWorkspace(normalizedPath);
        }
        addSavedWorkspace({ workspacePath: normalizedPath, sshConnectionId: null });
        setSelectedWorkspacePath(normalizedPath);
        setFileTreeRootPath(normalizedPath);
        // 绑定本地目录即清理草稿态 SSH 连接：否则菜单会继续标注「远端」，
        // 且新建会话会把残留的 sshConnectionId 写进元数据。
        setSelectedSshConnectionId(null);
      } catch (error: unknown) {
        toast(error instanceof Error ? error.message : '绑定工作区失败', 'error');
      }
    },
    [
      addSavedWorkspace,
      canAdjustWorkspaceBinding,
      currentSessionId,
      setFileTreeRootPath,
      setSelectedSshConnectionId,
      setSelectedWorkspacePath,
      setWorkspace,
    ],
  );

  /**
   * SSH 远端工作区的统一落地点：草稿态只记本地选中值（远端路径 + 连接 id）；
   * 已有会话（未锁定）时同步完成「会话↔连接绑定 + 会话元数据更新」，并立即
   * 刷新工作区显示。远端目录不写入本地文件树根，避免向本地 /workspace/* 发起
   * 对远端路径的无效请求。错误向上抛出，由选择弹窗就地展示。
   */
  const applySshWorkspaceSelection = useCallback(
    async (selection: SshWorkspaceSelection): Promise<void> => {
      const normalizedPath = selection.path.trim();
      if (!normalizedPath) {
        return;
      }

      if (currentSessionId && canAdjustWorkspaceBinding) {
        if (!token) {
          throw new Error('未登录，无法绑定远端工作区。');
        }
        await createSshClient(gatewayUrl).bind(token, selection.connectionId, currentSessionId);
        await createSessionsClient(gatewayUrl).updateMetadata(token, currentSessionId, {
          workingDirectory: normalizedPath,
          sshConnectionId: selection.connectionId,
        });
        setActiveSessionWorkspace(currentSessionId, normalizedPath, selection.connectionId);
      }

      setSelectedWorkspacePath(normalizedPath);
      setSelectedSshConnectionId(selection.connectionId);
      setFileTreeRootPath(null);
    },
    [
      canAdjustWorkspaceBinding,
      currentSessionId,
      gatewayUrl,
      setActiveSessionWorkspace,
      setFileTreeRootPath,
      setSelectedSshConnectionId,
      setSelectedWorkspacePath,
      token,
    ],
  );

  /**
   * 工作区选择弹窗：本地 + SSH 双来源。与侧栏头部 ＋ 共用同一份接线
   * （来源状态、SSH 连接 CRUD、两个弹窗的 props 组装），避免两处各写一套。
   *
   * 数据源注入 `useWorkspace` 的实现：它带着会话/ SSH 读取身份，与迁移前的
   * 内联行为逐字节一致。
   */
  const {
    openLocal,
    openSsh: openSshWorkspacePicker,
    localPickerProps,
    sshPickerProps,
    sshConnections,
  } = useWorkspacePickerSources({
    gatewayUrl,
    token,
    initialPath: effectiveWorkingDirectory ?? undefined,
    initialSshConnectionId: selectedSshConnectionId,
    onSelectLocal: applyWorkspaceSelection,
    onSelectSsh: applySshWorkspaceSelection,
    localSource: {
      fetchTree: workspace.fetchTree,
      createDirectory: workspace.createDirectory,
      validatePath: workspace.validatePath,
      loading: workspace.loading,
    },
    sshSource: {
      fetchTree: workspace.fetchSshTree,
      createDirectory: workspace.createSshDirectory,
    },
  });

  /**
   * 「调整绑定工作区」所有入口的统一收口：可调整时打开选择器；已锁定则提示并忽略，
   * 让文件树 / 侧栏里的切换入口在对话开始后自然失效。
   */
  const requestWorkspaceBindingChange = useCallback(() => {
    if (workspaceBindingLocked) {
      toast('会话已开始对话，工作区绑定已锁定', 'warning');
      return;
    }

    openLocal();
  }, [openLocal, workspaceBindingLocked]);
  const workspaceBindingChip = useMemo<WorkspaceBindingChipState>(
    () => ({
      label: effectiveWorkingDirectory
        ? getPathBasename(effectiveWorkingDirectory, effectiveWorkingDirectory)
        : UNBOUND_WORKSPACE_LABEL,
      fullPath: effectiveWorkingDirectory,
      ...(canAdjustWorkspaceBinding ? { onSelect: requestWorkspaceBindingChange } : {}),
    }),
    [canAdjustWorkspaceBinding, effectiveWorkingDirectory, requestWorkspaceBindingChange],
  );

  /** 「不绑定工作区」：解除当前绑定；已有会话时同步清空网关侧 metadata。 */
  // 同上:方法调用 → 取成局部量,依赖精确对应。
  const { clearWorkspace } = workspace;
  const clearWorkspaceSelection = useCallback(async (): Promise<void> => {
    // 同上：`&&` 值块先算好布尔量，避免留 try 内。
    const shouldClearWorkspace = Boolean(currentSessionId && canAdjustWorkspaceBinding);
    try {
      if (shouldClearWorkspace) {
        await clearWorkspace();
      }
      setSelectedWorkspacePath(null);
      setSelectedSshConnectionId(null);
      setFileTreeRootPath(null);
    } catch (error: unknown) {
      toast(error instanceof Error ? error.message : '解除工作区绑定失败', 'error');
    }
  }, [
    canAdjustWorkspaceBinding,
    currentSessionId,
    setFileTreeRootPath,
    setSelectedSshConnectionId,
    setSelectedWorkspacePath,
    clearWorkspace,
  ]);

  /** 「打开本地文件夹」：桌面端调用原生选择器，浏览器端退化为完整浏览弹窗。 */
  const openLocalWorkspaceFolder = useCallback((): void => {
    if (!isTauriRuntime()) {
      openLocal();
      return;
    }

    void pickDesktopFolder()
      .then(async (pickedPath) => {
        if (pickedPath) {
          await applyWorkspaceSelection(pickedPath);
        }
      })
      .catch((error: unknown) => {
        toast(error instanceof Error ? error.message : '打开系统文件夹选择器失败', 'error');
      });
  }, [applyWorkspaceSelection, openLocal]);

  /** 「新建工作空间」：打开浏览弹窗并直接展开新建文件夹表单。 */
  const createWorkspaceFromComposer = useCallback((): void => {
    openLocal('create');
  }, [openLocal]);

  /**
   * 「连接 SSH 远端目录」：直接以 SSH 来源打开工作区选择弹窗，复用
   * SshWorkspacePickerModal 的连接选择 → 远端目录浏览 → 绑定流程。
   */
  const openSshWorkspaceFromComposer = useCallback((): void => {
    openSshWorkspacePicker();
  }, [openSshWorkspacePicker]);

  /** 草稿态绑定的 SSH 连接摘要：供 composer 工作区菜单标注「远端执行」。 */
  const composerSshConnection = useMemo<ComposerSshConnectionSummary | null>(() => {
    if (!selectedSshConnectionId) {
      return null;
    }

    const matched = sshConnections.find((connection) => connection.id === selectedSshConnectionId);
    if (!matched) {
      // 连接列表尚未加载（懒加载）时先给出通用标签，避免菜单显示成未绑定。
      return { id: selectedSshConnectionId, label: 'SSH 远端连接' };
    }

    const name = matched.name?.trim();
    return {
      id: matched.id,
      label: name && name.length > 0 ? name : `${matched.username}@${matched.host}:${matched.port}`,
    };
  }, [selectedSshConnectionId, sshConnections]);

  /** 输入框外壳上方的「选择工作空间」下拉；仅在绑定未锁定时渲染（新建会话未发首条消息）。 */
  const composerWorkspaceSlot = canAdjustWorkspaceBinding ? (
    <ComposerWorkspaceMenu
      currentPath={effectiveWorkingDirectory}
      savedWorkspacePaths={savedWorkspacePaths}
      busy={workspace.loading}
      onSelectWorkspace={applyWorkspaceSelection}
      onClearWorkspace={clearWorkspaceSelection}
      onCreateWorkspace={createWorkspaceFromComposer}
      onOpenLocalFolder={openLocalWorkspaceFolder}
      onOpenSshWorkspace={openSshWorkspaceFromComposer}
      currentSshConnection={composerSshConnection}
    />
  ) : null;
  const activeSubAgentCount = subAgentRunItems.filter((item) => isActiveStatus(item.status)).length;
  /** 活跃后台任务数（含排队）——与常驻胶囊的显隐口径一致。 */
  const activeBackgroundTaskCount = backgroundTaskPanel.summary.activeTotal;
  /**
   * 左侧浮动栏的「后台命令」分组数据：只取 shell 行（调用方契约，行组件不做过滤）。
   * 引用保持稳定，避免 rail 内部按数组身份做的 memo 失效。
   */
  const backgroundTaskShellRows = useMemo(
    () => backgroundTaskPanel.rows.filter((row) => row.kind === 'shell'),
    [backgroundTaskPanel.rows],
  );
  /**
   * 输入框上方的 footer slot：工作空间选择 + 有活跃子代理时的批量停止入口
   * + 「后台任务」常驻胶囊（仅在有活跃任务时自渲染）。
   */
  const composerFooterSlot =
    composerWorkspaceSlot || activeSubAgentCount > 0 || activeBackgroundTaskCount > 0 ? (
      <>
        {composerWorkspaceSlot}
        {activeSubAgentCount > 0 ? (
          <BatchStopSubAgentsControl
            activeCount={activeSubAgentCount}
            stopping={stoppingAllSubAgents}
            onConfirm={handleStopAllChildSessions}
          />
        ) : null}
        <BackgroundTaskQuickChip
          model={backgroundTaskPanel}
          onKillTerminal={sessionTerminals.killTerminal}
          onOpenPanel={handleOpenBackgroundTaskPanel}
          onOpenSession={openChildSessionInspector}
          onPreviewTerminal={
            isFusionLayout ? handlePreviewBackgroundTerminalFusion : handlePreviewBackgroundTerminal
          }
          onStopAllSubagents={handleStopAllChildSessions}
          onStopSubagent={handleStopChildSession}
          pendingKillIds={sessionTerminals.pendingKillIds}
          stoppingSubAgentIds={stoppingSubAgentIds}
        />
      </>
    ) : null;
  const handleFastModeToggle = useProviderFastMode({
    activeProviderType: activeProvider?.type,
    effectiveProviderId,
    gatewayUrl,
    setProviders,
    token,
  });

  useEffect(() => {
    const normalizedThinkingState = normalizeChatThinkingState({
      providerType: activeProvider?.type,
      modelId: activeModelOption?.id ?? effectiveModelId,
      declaredSupportsThinking: activeModelOption?.supportsThinking === true,
      thinkingEnabled,
      reasoningEffort,
      reasoningOptions: activeModelOption?.reasoningOptions,
    });

    if (thinkingEnabled !== normalizedThinkingState.thinkingEnabled) {
      setThinkingEnabled(normalizedThinkingState.thinkingEnabled);
    }
    if (reasoningEffort !== normalizedThinkingState.reasoningEffort) {
      setReasoningEffort(normalizedThinkingState.reasoningEffort);
    }
  }, [
    effectiveModelId,
    activeModelOption?.id,
    activeModelOption?.supportsThinking,
    activeModelOption?.reasoningOptions,
    activeProvider?.type,
    reasoningEffort,
    thinkingEnabled,
  ]);

  /**
   * 消息 hover actions 构建器。必须保持引用稳定（依赖只在书签 / 多选 / 会话
   * 变化时更新）：它进入 useChatRenderData 的 memo 依赖，流式帧里若每帧换新，
   * 历史 entry / 分组缓存会整帧失效，整个消息列表随之重渲染。
   */
  // 同 workspace 的情形:multiSelect 是 useMessageMultiSelect() 返回的对象,对其方法
  // 调用会被推断为整个对象依赖 → 先取成局部量,依赖精确对应。
  const {
    isSelected: isMessageSelected,
    toggleMessage: toggleMessageSelection,
    multiSelect: messageMultiSelectState,
  } = multiSelect;
  const messageMultiSelectEnabled = messageMultiSelectState.enabled;
  const buildRenderMessageActions = useRenderMessageActions({
    bookmarkStore,
    buildMessageActions,
    currentSessionId,
    isMessageSelected,
    messageMultiSelectEnabled,
    toggleMessageSelection,
  });

  const {
    assistantUsageDetails,
    effectiveReportedStreamUsage,
    streamingUsageDetails,
    contextUsageSnapshot,
    effectiveContextMessageCount,
    sanitizedHistoricalMessages,
    hiddenMessageCount: renderHiddenMessageCount,
    firstVisibleMessageId,
    groupedMessageEntries,
  } = useChatRenderData({
    messages,
    subagentNotices,
    pendingPermissions,
    modelPrices,
    activeProviderId: effectiveProviderId,
    activeModelId: effectiveModelId,
    activeModelOption,
    // 传「是否渲染实时气泡」而非「是否流式」：`useChatRenderData` 里这个标志同时
    // 决定气泡是否存在、历史 streaming 光标归谁、以及是否优先用实时用量估算。
    // 空快照（上一轮已落库）三者都应回到历史侧的语义。
    visibleStreaming: visibleStreamRenderable,
    visibleStreamBuffer,
    visibleStreamThinkingBuffer,
    visibleStreamThinkingBlocks,
    visibleStreamStartedAt,
    activeStreamRoundStartedAt: activeStreamRoundStart,
    visibleReportedStreamUsage,
    activeStreamClientRequestId: activeGatewayStreamClientRequestId,
    activeStreamFirstTokenLatencyMs,
    activeStreamMessageId,
    toolCallCards,
    streamingOrderedParts: visibleStreamingSegments,
    resolveAssistantCapabilityKind,
    resolveInlinePermissionActions,
    buildMessageActions: buildRenderMessageActions,
    handleCopyMessageGroup,
    openChildSessionInspector,
    selectedChildSessionId,
    taskToolRuntimeLookup,
    visibleMessageCount,
    serverTotalTurnCount,
    stopCapability,
    stoppingStream,
    onStopActiveMessage: stopActiveMessage,
  });
  const hiddenMessageCount =
    hasMoreHistory === false
      ? Math.max(0, sanitizedHistoricalMessages.length - visibleMessageCount)
      : hasMoreHistory === true
        ? Math.max(1, renderHiddenMessageCount)
        : renderHiddenMessageCount;

  // ─── 头部插入历史消息的滚动锚点 ────────────────────────────────────
  // `messages` 是完整（或快照窗口）列表，加载旧消息 = 扩大 `slice(-visibleMessageCount)`
  // 窗口 / 替换 messages，旧消息插入渲染列表**头部**。视口若不加锚定，会被内容
  // 增长推离阅读位置。这里在插入前捕获「视口内最靠上的可见消息」，插入后恢复。

  // 两个镜像的写入同样下沉到 effect（渲染期写 ref 会让 React Compiler 放弃优化整个
  // ChatPage）。读取点只有事件回调——`onNearTop`（上滑加载更早）与
  // `captureHistoryScrollAnchor` / `armHistoryAnchorImpl`（按钮点击），均发生在本次
  // 提交的 effect 之后，读到的仍是本次提交的值。
  useEffect(() => {
    writeRefCurrent(firstVisibleMessageIdRef, firstVisibleMessageId);
    writeRefCurrent(hiddenMessageCountRef, hiddenMessageCount);
  });

  const { handleLoadEarlierMessages } = useHistoryScrollAnchor({
    armHistoryAnchor,
    armHistoryAnchorImplRef,
    currentSessionId,
    firstVisibleMessageId,
    firstVisibleMessageIdRef,
    historyAnchorRestoreCancelRef,
    lastAnchorMessageIdRef,
    setLastAnchorMessageId,
    loadEarlierHistory,
    pendingHistoryAnchor,
    sanitizedHistoricalMessagesLength: sanitizedHistoricalMessages.length,
    scrollRegionRef,
    setPendingHistoryAnchor,
    setPendingMessageScroll,
    setVisibleMessageCount,
    visibleMessageCount,
  });
  useEffect(() => {
    writeRefCurrent(loadEarlierMessagesRef, handleLoadEarlierMessages);
  }, [handleLoadEarlierMessages, loadEarlierMessagesRef]);

  const chatSearch = useChatSearch({ messages, scrollRegionRef, ensureMessageVisible });

  // ─── 输入框下方统计栏数据 ──────────────────────────────────────────────
  const {
    composerStatsData,
    fusionContextOverview,
    handleOpenFusionEditorFile,
    handleShowFusionEditor,
    renderWorkspaceFileTree,
    commandPaletteItems,
  } = useChatPageDerivations({
    artifactsWorkspaceHref,
    assistantUsageDetails,
    bookmarkStore,
    browserPreviewUrl,
    canAdjustWorkspaceBinding,
    chatSearch,
    childSessions,
    collapseWorkspaceToPanel,
    compactions,
    contentArtifactCount,
    contentArtifactCountStatus,
    contextUsageSnapshot,
    currentSessionId,
    dialogueMode,
    dockOwnsWorkspacePanels,
    editorFullScreen,
    editorPaneTab,
    effectiveContextMessageCount,
    effectiveReportedStreamUsage,
    effectiveWorkingDirectory,
    fileBrowseRoot,
    fileEditor,
    fusionChatLayout,
    handleCompactCurrentSession,
    handleCopyMessage,
    handleToggleYolo,
    hiddenMessageCount,
    isFusionLayout,
    messages,
    multiSelect,
    onStartNewSession: handleStartNewSession,
    openBrowserPreview,
    openWorkspacePanelTab,
    pendingPermissions,
    pendingQuestions,
    permissionMode,
    promoteWorkspaceTab,
    requestWorkspaceBindingChange,
    reviewPanelOpened,
    rightOpen,
    rightPanelState,
    serverTotalTurnCount,
    sessionStateStatus,
    sessionTasks,
    sessionTodos,
    setEditorMode,
    setEditorPaneTab,
    setRightOpen,
    setRightTab,
    setShowTemplatePanel,
    startSessionSwitchTransition,
    streamingUsageDetails,
    visibleStreaming,
    workspace,
    workspaceFileItems,
    yoloMode,
  });

  const commandPalette = useCommandPalette({
    items: commandPaletteItems,
    enabled: isPageActive,
  });

  // ─── Keyboard shortcuts ─────────────────────────────────────────────────
  useChatKeyboardShortcuts(
    {
      onCommandPalette: commandPalette.toggle,
      onSearch: () => chatSearch.open(),
      onToggleDialogueMode: () => {
        const preferred = useDisplayPreferencesStore.getState().defaultDialogueMode;
        const nextMode: DialogueMode = dialogueMode === preferred ? 'clarify' : preferred;
        handleDialogueModeChange(nextMode);
      },
      onCopyLastAssistant: () => {
        const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
        if (lastAssistant) {
          handleCopyMessage(lastAssistant);
          toast('已复制', 'success');
        }
      },
      onToggleMultiSelect: () => {
        if (multiSelect.multiSelect.enabled) {
          multiSelect.disableMultiSelect();
        } else {
          multiSelect.enableMultiSelect();
          requestAnimationFrame(() => multiSelect.selectAll(messages));
        }
      },
      onOpenTemplates: () => setShowTemplatePanel(true),
      onScrollToNextUser: () => scrollToNextUserMessage(scrollRegionRef.current),
      onScrollToPrevUser: () => scrollToPrevUserMessage(scrollRegionRef.current),
      onToggleSidebar: () => {
        useUIStateStore.getState().toggleLeftSidebar();
      },
      onToggleRightPanel: () => {
        if (isFusionLayout) {
          fusionChatLayout.toggleReviewPanel();
          return;
        }
        setRightOpen((v) => !v);
      },
      onToggleTerminalPanel: () => {
        toggleTerminalPanelOpened();
      },
      onCycleTheme: () => {
        // theme toggle is handled in Layout/App level via onToggleTheme prop
        // dispatch a custom event that App.tsx listens for
        window.dispatchEvent(new CustomEvent('app:cycle-theme'));
      },
      onNewSession: handleStartNewSession,
    },
    isPageActive,
  );

  // 只在真正的会话切换加载时显示骨架屏，而不是在发送新消息时显示
  // 如果距离上次流式开始不到 5 秒，说明是正常的对话流程，不显示骨架屏
  const timeSinceStreamStart =
    activeStreamStartedAt !== null ? Date.now() - activeStreamStartedAt : Infinity;
  const showSessionSwitchSkeleton =
    currentSessionId !== null &&
    isSessionLoading &&
    !streaming &&
    showSkeletonAfterDelay &&
    timeSinceStreamStart > 5000;
  const dialogueModeLabel =
    DIALOGUE_MODE_OPTIONS.find((option) => option.value === dialogueMode)?.label ?? dialogueMode;

  // Listen for custom events from slash commands
  useEffect(() => {
    const handleOpenTemplates = () => setShowTemplatePanel(true);
    const handleExportChat = () => {
      const content = exportMessages(messages, 'markdown');
      downloadExport(content, `chat-export-${Date.now()}.md`, 'text/markdown');
      toast('对话已导出为 Markdown', 'success');
    };
    const handleOpenBrowser = () => openBrowserPreviewRef.current();
    const handleComposerInsert = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        { text?: string; mode?: 'append' | 'replace' } | undefined;
      const insertText = detail?.text;
      if (typeof insertText !== 'string' || insertText.length === 0) return;
      setInput((prev) => {
        if (detail?.mode === 'replace') return insertText;
        // append:trim 末尾,中间用换行连接
        if (prev.trim().length === 0) return insertText;
        return `${prev.trimEnd()}\n${insertText}`;
      });
      requestAnimationFrame(() => textareaRef.current?.focus());
    };
    window.addEventListener('openAwork:open-templates', handleOpenTemplates);
    window.addEventListener('openAwork:export-chat', handleExportChat);
    window.addEventListener('openAwork:open-browser', handleOpenBrowser);
    window.addEventListener('openawork:composer:insert', handleComposerInsert);
    return () => {
      window.removeEventListener('openAwork:open-templates', handleOpenTemplates);
      window.removeEventListener('openAwork:export-chat', handleExportChat);
      window.removeEventListener('openAwork:open-browser', handleOpenBrowser);
      window.removeEventListener('openawork:composer:insert', handleComposerInsert);
    };
  }, [messages]);

  // P1 组装层瘦身：fusion / classic 两分支共享的 <ChatConversationView> props 只组装一次。
  // 分支差异（compact 与 topBar）由 layout/{Fusion,Classic}ChatRegion 负责。
  const conversationViewModel = useChatConversationViewProps({
    sessionId: currentSessionId,
    workspaceFileItems,
    searchMentionFiles,
    centerContent: conversationLayoutState.centerContent,
    contentMaxWidth: conversationLayoutState.contentMaxWidth,
    currentUserEmail,
    currentUserDisplayName,
    gatewayUrl,
    token,
    beforeMessages: (
      <>
        <SubAgentRunList
          items={subAgentRunItems}
          onKillShell={sessionTerminals.killTerminal}
          onPreviewShell={
            isFusionLayout ? handlePreviewBackgroundTerminalFusion : handlePreviewBackgroundTerminal
          }
          onSelectSession={openChildSessionInspector}
          onStopSession={handleStopChildSession}
          pendingKillShellIds={sessionTerminals.pendingKillIds}
          selectedSessionId={selectedChildSessionId}
          sessionId={currentSessionId}
          shellItems={backgroundTaskShellRows}
          stoppingSessionIds={stoppingSubAgentIds}
        />
        <UserHistoryJumpList
          items={userHistoryJumpItems}
          scrollRegionRef={scrollRegionRef}
          ensureMessageVisible={ensureMessageVisible}
        />
      </>
    ),
    afterMessages: (
      <>
        {latestGeneratedImageResult && artifactsWorkspaceHref && (
          <ChatImageGenerationResultStrip
            artifactId={latestGeneratedImageResult.artifactId}
            artifactTitle={latestGeneratedImageResult.artifactTitle}
            modelLabel={latestGeneratedImageResult.modelLabel}
            onContinueEditing={continueEditingLatestGeneratedImage}
            onOpenArtifactsWorkspace={() => navigate(artifactsWorkspaceHref)}
          />
        )}
      </>
    ),
    composerRightSlot: (
      <CompanionStage
        agentId={effectiveAgentId}
        attachedCount={companionComposerActivity.attachedCount}
        buddyTriggerText={companionBuddyTriggerText}
        currentUserEmail={currentUserEmail}
        editorMode={editorMode}
        hasStreamError={streamError !== null}
        idleSeconds={idleSeconds}
        inputHasMention={companionInputFlags.inputHasMention}
        inputIsLong={companionInputFlags.inputIsLong}
        inputMentionsBuddy={companionInputFlags.inputMentionsBuddy}
        inputStartsWithSlash={companionInputFlags.inputStartsWithSlash}
        lastToolName={lastToolName}
        panelOpenSignal={companionPanelSignal}
        pendingPermissionCount={pendingPermissions.length}
        prefersReducedMotion={prefersReducedMotion}
        queuedCount={companionComposerActivity.queuedCount}
        rightOpen={rightOpen}
        sessionBusyState={remoteSessionBusyState}
        sessionId={currentSessionId}
        showVoice={companionComposerActivity.showVoice}
        streamErrorMessage={streamError}
        streaming={streaming}
        todoCount={sessionTodos.length}
        toolCallCount={toolCallCards.length}
      />
    ),
    messages,
    groupedMessageEntries,
    onOpenSubagentChild: openChildSessionInspector,
    visibleMessageCount: visibleMessageCount ?? sanitizedHistoricalMessages.length,
    hiddenMessageCount,
    visibleStreaming,
    showSessionSwitchSkeleton,
    remoteSessionBusyState,
    reconnecting: sessionReconnecting,
    staleRunningResync: staleRunningResync.stale,
    onStaleRunningResync: staleRunningResync.resync,
    pendingPermissions,
    resolveInlinePermissionActions,
    providerCatalog,
    activeProviderId: effectiveProviderId,
    activeModelId: effectiveModelId,
    activeModelLabel: activeModelOption?.label,
    onLoadEarlier: () => handleLoadEarlierMessages(),
    welcomeScreen: {
      hasWorkspace: !!effectiveWorkingDirectory,
      dialogueMode,
      onNewSession: handleStartNewSession,
      onOpenWorkspace: requestWorkspaceBindingChange,
      onSelectMode: handleDialogueModeChange,
    },
    streaming,
    stoppingStream,
    streamError,
    latestUpstreamSummary: visibleLatestUpstreamSummary,
    latestCompaction: compactions[0] ?? null,
    onDismissStreamError: () => setStreamError(null),
    onRetryStreamError: handleRetryLastFailedTurn,
    streamRetryProgress: attachRetryProgress,
    checkpointCount: compactions.length,
    pendingQuestionsCount: pendingQuestions.length,
    stopCapability,
    onOpenRecovery: () => {
      setRightOpen(true);
      setRightTab('overview');
    },
    scrollRegionRef,
    // 一次性「滚动到目标历史消息」请求（虚拟视口据此先把目标组挂载出来）。
    pendingMessageScroll,
    contentColumnRef,
    bottomRef,
    onScroll: handleScroll,
    showScrollToBottom,
    hasPendingFollowContent,
    onScrollToBottom: (behavior, target) => scrollToBottom(behavior, target),
    editorMode,
    sessionTodos,
    rightOpen,
    activePendingQuestion,
    inlineQuestionAnswers,
    inlineQuestionCustomInputs,
    inlineQuestionReplyStatus,
    inlineQuestionReplyError,
    onToggleInlineQuestionOption: toggleInlineQuestionOption,
    onChangeInlineQuestionCustomInput: handleInlineQuestionCustomInput,
    onReplyInlineQuestion: replyInlineQuestion,
    historyEditPrompt,
    onCloseHistoryEdit: () => setHistoryEditPrompt(null),
    onResendHistoryEdit: (text, editedInputParts) => {
      if (!historyEditPrompt) return;
      void handleEditResendInCurrentSession(text, historyEditPrompt.messageId, editedInputParts);
      setHistoryEditPrompt(null);
    },
    onContinueHistoryEdit: (text, editedInputParts) => {
      if (editedInputParts && editedInputParts.length > 0) {
        void sendMessage(text, {
          existingInputParts: editedInputParts,
        });
      } else {
        focusComposerWithText(text);
      }
      setHistoryEditPrompt(null);
    },
    onCreateBranchFromHistoryEdit: (text, editedInputParts) => {
      if (!historyEditPrompt) return;
      void createBranchSessionFromMessage(text, historyEditPrompt.messageId, editedInputParts);
      setHistoryEditPrompt(null);
    },
    retryPrompt,
    onCloseRetry: () => setRetryPrompt(null),
    onRetryCurrent: () => {
      void handleRetryInCurrentSession();
    },
    onRetryBranch: () => {
      void handleRetryInNewSession();
    },
    onOpenFileChangesPanel: openFileChangesPanel,
    chatSearch,
    composerVariant,
    providers,
    fastEnabled: activeProvider?.openaiFastMode === true,
    activeProvider,
    activeModelOption,
    activeModelCanConfigureThinking,
    activeModelTooltip,
    canStopCurrentSessionStream,
    dialogueMode,
    manualAgentId,
    permissionMode,
    onPermissionModeChange: handlePermissionModeChange,
    webSearchEnabled,
    webSearchAvailable,
    thinkingEnabled,
    reasoningEffort,
    imageReferenceArtifacts: availableImageEditReferenceArtifacts,
    selectedImageEditReferenceArtifactId,
    latestGeneratedImageResult,
    artifactsWorkspaceHref,
    imageGenerationMode,
    hasConfiguredImageModel,
    imageGenerationBusy,
    imageGenerationPreview,
    imageGenerationDefaults,
    imageModelLabel,
    imagePluginEnabled,
    toggleImageGenerationMode,
    updateImageGenerationDefaults,
    composerWorkspaceCatalog,
    composerCommandDescriptors,
    agentOptions,
    effectiveAgentId,
    defaultAgentLabel,
    input,
    setInput,
    textareaRef,
    onComposerSubmit: async (payload) => {
      return sendMessage(payload.text, {
        queuedFiles: payload.files,
        queuedAttachmentItems: payload.attachmentItems,
        queuedMessageId: payload.queuedMessageId,
      });
    },
    onStopComposer: () => void stopActiveMessage(),
    onComposerModelSelect: async (pid: string, mid: string) => {
      const nextProvider = providers.find((provider) => provider.id === pid);
      const nextModel = nextProvider?.defaultModels.find((model) => model.id === mid);
      const normalizedThinkingState = normalizeChatThinkingState({
        providerType: nextProvider?.type,
        modelId: nextModel?.id ?? mid,
        declaredSupportsThinking: nextModel?.supportsThinking === true,
        thinkingEnabled,
        reasoningEffort,
        reasoningOptions: nextModel?.reasoningOptions,
      });
      setActiveProviderId(pid);
      setActiveModelId(mid);
      setThinkingEnabled(normalizedThinkingState.thinkingEnabled);
      setReasoningEffort(normalizedThinkingState.reasoningEffort);
      sessionModelSelectionSourceRef.current = 'manual';
      markSessionMetadataDirty();
    },
    onRefreshProviders: refreshProviderCatalog,
    providersRefreshing,
    onFastModeToggle: handleFastModeToggle,
    onContextWindowOverrideChange: handleContextWindowOverrideChange,
    onToggleWebSearch: handleToggleWebSearch,
    onThinkingEnabledChange: (enabled) => {
      setThinkingEnabled(enabled);
      markSessionMetadataDirty();
    },
    onReasoningEffortChange: (effort) => {
      setReasoningEffort(effort);
      markSessionMetadataDirty();
    },
    onManualAgentChange: handleManualAgentChange,
    onClearManualAgentId: handleClearManualAgentId,
    onEditPreviousUserMessage: handleEditPreviousUserMessage,
    onContinueEditingImage: continueEditingLatestGeneratedImage,
    onNavigateToArtifacts: artifactsWorkspaceHref
      ? () => navigate(artifactsWorkspaceHref)
      : undefined,
    onSelectImageReferenceArtifactId: setSelectedImageEditReferenceArtifactId,
    onCompanionActivityChange: setCompanionComposerActivity,
    markSessionMetadataDirty,
    statsData: composerStatsData,
    composerFooterSlot,
    chrome: {
      onChangeDialogueMode: handleDialogueModeChange,
      onConfirmClarifySwitch: () => void confirmSwitchToCoding(),
      clarifySwitchPending,
      onToggleRightOpen: () => setRightOpen((o) => !o),
      sessionTerminals,
      terminalPanelOpened,
      onToggleTerminalPanel: handleTerminalPanelToggle,
      openCommandPalette: commandPalette.open,
      bookmarkStore,
      multiSelect,
      todoController,
      todoDetailsId,
      workspaceBinding: workspaceBindingChip,
      reviewPanelOpened,
      onToggleReviewPanel: fusionChatLayout.toggleReviewPanel,
      activeModelOptionLabel: activeModelOption?.label,
      effectiveModelId,
      dialogueModeLabel,
      workflowRuntime,
      sessionTasks,
      editorFullScreen,
      onToggleEditorMode: () =>
        startSessionSwitchTransition(() => {
          const next = !editorMode;
          setEditorMode(next);
          if (!next) setEditorFullScreen(false);
        }),
      onToggleEditorFullScreen: () =>
        startSessionSwitchTransition(() => {
          if (editorFullScreen) {
            setEditorFullScreen(false);
            return;
          }
          setEditorMode(true);
          setEditorFullScreen(true);
        }),
      quickTerminalOpen,
      onToggleQuickTerminal: () =>
        setQuickTerminalOpenForWorkspace(effectiveWorkingDirectory, !quickTerminalOpen),
      browserPreviewUrl,
      onOpenBrowser: () => {
        startSessionSwitchTransition(() => {
          if (!browserPreviewUrl) {
            setBrowserPreviewUrl('http://localhost:3000');
          }
          setEditorMode(true);
          setEditorPaneTab('browser');
        });
      },
      editorPaneTab,
      onActivateCodeTab: () => {
        startSessionSwitchTransition(() => {
          if (editorMode && editorPaneTab === 'code' && !editorFullScreen) {
            setEditorMode(false);
            return;
          }
          setEditorMode(true);
          setEditorPaneTab('code');
        });
      },
      onActivateBrowserTab: () => {
        startSessionSwitchTransition(() => {
          if (editorMode && editorPaneTab === 'browser' && !editorFullScreen) {
            setEditorMode(false);
            return;
          }
          if (!browserPreviewUrl) {
            setBrowserPreviewUrl('http://localhost:3000');
          }
          setEditorMode(true);
          setEditorPaneTab('browser');
        });
      },
    },
  });

  return (
    <div
      className={pageRootClassName}
      style={{
        position: 'relative',
        ...pageRootStyle,
      }}
    >
      {/* ─── Command Palette ─── */}
      <CommandPalette
        items={commandPaletteItems}
        isOpen={commandPalette.isOpen}
        onClose={commandPalette.close}
      />

      {/* ─── Prompt Template Panel ─── */}
      <PromptTemplatePanel
        isOpen={showTemplatePanel}
        onClose={() => setShowTemplatePanel(false)}
        onInsert={(content) => {
          setInput((prev) => (prev.trim() ? `${prev.trimEnd()}\n${content}` : content));
          requestAnimationFrame(() => textareaRef.current?.focus());
        }}
      />

      {isFusionLayout ? (
        <FusionChatMainShell
          dockSplitPos={fusionDockSplitPos}
          editorFullScreen={editorFullScreen}
          editorMode={editorMode}
          editorPane={
            <ChatEditorPane
              editorMode={editorMode}
              splitPos={splitPos}
              splitDragging={splitDragging}
              editorPaneRef={editorPaneRef}
              handleSplitMouseDown={handleSplitMouseDown}
              fileEditor={fileEditor}
              saving={saving}
              handleSaveFile={handleSaveFile}
              browserPreviewUrl={browserPreviewUrl}
              onBrowserPreviewUrlChange={setBrowserPreviewUrl}
              workspacePath={uiWorkspaceScope}
              activeTab={editorPaneTab}
              onTabChange={setEditorPaneTab}
              fullScreen={editorFullScreen}
              onToggleFullScreen={() => {
                if (editorFullScreen) {
                  // 桌面：退出放大 = 内容收回到统一面板；移动端保持原来的「退出全屏」。
                  if (isMobileViewport) {
                    startSessionSwitchTransition(() => setEditorFullScreen(false));
                    return;
                  }
                  collapseWorkspaceToPanel();
                  return;
                }
                promoteWorkspaceTab(editorPaneTab);
              }}
              fileTree={renderWorkspaceFileTree(editorMode)}
            />
          }
          hasSession={currentSessionId !== null}
          mobilePanel={
            isMobileViewport && currentSessionId !== null ? (
              <FusionMobileBottomPanel
                activeEditorFilePath={fileEditor.activeFilePath}
                activeTab={sidePanelActiveTab}
                currentSessionId={currentSessionId}
                editorMode={editorMode}
                editorFileState={fileEditor}
                editorOpenFilePaths={fileEditor.openFiles.map((file) => file.path)}
                effectiveWorkingDirectory={effectiveWorkingDirectory}
                fileBrowseRoot={fileBrowseRoot}
                fetchTree={workspace.fetchTree}
                gatewayUrl={gatewayUrl}
                handleSaveFile={handleSaveFile}
                isOpen={reviewPanelOpened}
                onClose={() => {
                  setReviewPanelOpened(false);
                }}
                onOpen={() => {
                  setReviewPanelOpened(true);
                }}
                onOpenFileInEditor={handleOpenFusionEditorFile}
                onOpenWorkspace={requestWorkspaceBindingChange}
                onShowEditor={handleShowFusionEditor}
                onTabChange={setSidePanelActiveTab}
                overview={fusionContextOverview}
                reviewRevision={reviewRefreshRevision}
                runtimeSummary={fusionContextRuntimeSummary}
                saving={saving}
                token={token}
                workspaceFileItems={workspaceFileItems}
              />
            ) : null
          }
          showDockedSidePanel={fusionChatLayout.showDockedSidePanel}
          sidePanel={
            <FusionDockedSidePanel
              activeTab={sidePanelActiveTab}
              backgroundTaskPanel={{
                model: backgroundTaskPanel,
                loading: sessionTerminals.loading,
                error: sessionTerminals.error,
                lastSyncedAtMs: sessionTerminals.lastSyncedAtMs,
                stoppingSubAgentIds,
                pendingKillIds: sessionTerminals.pendingKillIds,
                onReloadTerminals: sessionTerminals.reload,
                onOpenSession: openChildSessionInspector,
                onStopSubagent: handleStopChildSession,
                onStopAllSubagents: handleStopAllChildSessions,
                onPreviewTerminal: handlePreviewBackgroundTerminalFusion,
                onKillTerminal: sessionTerminals.killTerminal,
              }}
              currentSessionId={currentSessionId}
              currentUserDisplayName={currentUserDisplayName}
              currentUserEmail={currentUserEmail}
              effectiveWorkingDirectory={effectiveWorkingDirectory}
              fileEditor={fileEditor}
              fileTree={renderWorkspaceFileTree(true)}
              gatewayUrl={gatewayUrl}
              handleSaveFile={handleSaveFile}
              onOpenFullSession={(nextSessionId) => {
                void navigate(`/chat/${nextSessionId}`);
              }}
              onPromoteToFullScreen={promoteWorkspaceTab}
              onSelectChildSession={openChildSessionInspector}
              onTabChange={setSidePanelActiveTab}
              overview={fusionContextOverview}
              providerCatalog={providerCatalog}
              reviewRevision={reviewRefreshRevision}
              runtimeSummary={fusionContextRuntimeSummary}
              saving={saving}
              selectedChildSessionId={selectedChildSessionId}
              subAgentCount={subAgentRunItems.length}
              subAgentItems={subAgentRunItems}
              taskToolRuntimeLookup={taskToolRuntimeLookup}
              token={token}
              workspacePath={uiWorkspaceScope}
              workspacePromoted={editorMode}
            />
          }
          splitContainerRef={splitContainerRef}
          splitDragging={splitDragging}
          splitPos={splitPos}
          terminalMaximized={terminalMaximizedForLayout}
          terminalPosition={terminalPositionForLayout}
          terminal={
            <TerminalPanel
              workspacePath={effectiveWorkingDirectory}
              gatewayUrl={gatewayUrl}
              token={token}
              sessionId={currentSessionId}
              terminals={sessionTerminals.terminals}
              loading={sessionTerminals.loading}
              onReload={sessionTerminals.reload}
              onRenameTerminal={sessionTerminals.renameTerminal}
              onDismissTerminal={sessionTerminals.dismissTerminal}
              onKillTerminal={sessionTerminals.killTerminal}
              shellProfiles={sessionTerminals.shellProfiles}
            />
          }
        >
          <SessionPanelFrame>
            <WorkspacePickerModal {...localPickerProps} />
            <SshWorkspacePickerModal {...sshPickerProps} />
            <LatestAssistantMessageContext value={latestAssistantMessageId}>
              <FusionChatRegion model={conversationViewModel} />
            </LatestAssistantMessageContext>
          </SessionPanelFrame>
        </FusionChatMainShell>
      ) : (
        <>
          <WorkspacePickerModal {...localPickerProps} />
          <SshWorkspacePickerModal {...sshPickerProps} />
          <LatestAssistantMessageContext value={latestAssistantMessageId}>
            <div
              ref={splitContainerRef}
              data-testid="classic-chat-workbench"
              style={classicWorkbenchSplitStyle}
            >
              <div
                data-testid="classic-chat-main-column"
                style={{
                  flex: editorMode ? '0 0 auto' : 1,
                  width: classicConversationHidden
                    ? 0
                    : editorMode
                      ? 'calc(var(--split-pos) - 2.5px)'
                      : undefined,
                  opacity: classicConversationHidden ? 0 : 1,
                  pointerEvents: classicConversationHidden ? 'none' : undefined,
                  transition: splitDragging.current
                    ? 'none'
                    : 'width 240ms ease, opacity 180ms ease',
                  minWidth: 0,
                  minHeight: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                <ClassicChatRegion model={conversationViewModel} />
                {currentSessionId && !isFusionLayout ? (
                  // classic overlay 不显式接线最大化：QuickTerminalPanel 缺省回落 store 的
                  // 瞬态开关，rail 的最大化/还原在两种 presentation 下语义一致（无死控件）。
                  <QuickTerminalPanel
                    open={quickTerminalOpen}
                    onRequestClose={() =>
                      setQuickTerminalOpenForWorkspace(effectiveWorkingDirectory, false)
                    }
                    workspacePath={effectiveWorkingDirectory}
                    gatewayUrl={gatewayUrl}
                    token={token}
                    sessionId={currentSessionId}
                    terminals={sessionTerminals.terminals}
                    loading={sessionTerminals.loading}
                    onReload={sessionTerminals.reload}
                    onRenameTerminal={sessionTerminals.renameTerminal}
                    onDismissTerminal={sessionTerminals.dismissTerminal}
                  />
                ) : null}
              </div>
              <ChatEditorPane
                editorMode={editorMode}
                splitPos={splitPos}
                splitDragging={splitDragging}
                editorPaneRef={editorPaneRef}
                handleSplitMouseDown={handleSplitMouseDown}
                fileEditor={fileEditor}
                saving={saving}
                handleSaveFile={handleSaveFile}
                browserPreviewUrl={browserPreviewUrl}
                onBrowserPreviewUrlChange={setBrowserPreviewUrl}
                workspacePath={uiWorkspaceScope}
                activeTab={editorPaneTab}
                onTabChange={setEditorPaneTab}
                fullScreen={editorFullScreen}
                onToggleFullScreen={() =>
                  startSessionSwitchTransition(() => {
                    if (editorFullScreen) {
                      setEditorFullScreen(false);
                      return;
                    }
                    setEditorMode(true);
                    setEditorFullScreen(true);
                  })
                }
                fileTree={
                  <WorkspaceFileTreePanel
                    workspacePath={fileBrowseRoot}
                    sessionId={currentSessionId}
                    onOpenFile={(path) => void fileEditor.openFile(path)}
                    fetchTree={workspace.fetchTree}
                    active={editorMode}
                    variant="embedded"
                    onSwitchWorkspace={
                      canAdjustWorkspaceBinding ? requestWorkspaceBindingChange : undefined
                    }
                    style={{
                      flex: 1,
                      minHeight: 0,
                      background: 'var(--bg-surface)',
                      overflow: 'hidden',
                    }}
                  />
                }
              />
            </div>
          </LatestAssistantMessageContext>
        </>
      )}

      {/* Classic: ChatRightPanel 作为唯一右侧面板。
          Fusion: ChatRightPanel 不渲染，改由 FusionSessionSidePanel 提供
          「审查 / 代码 / 预览 / Context」标签式侧面板。 */}
      {!isFusionLayout ? (
        <ChatRightPanel
          rightOpen={rightOpen && !(editorMode && editorFullScreen)}
          rightTab={rightTab}
          setRightTab={setRightTab}
          selectedChildSessionId={selectedChildSessionId}
          currentUserEmail={currentUserEmail}
          currentUserDisplayName={currentUserDisplayName}
          gatewayUrl={gatewayUrl}
          token={token}
          navigate={(path: string) => void navigate(path)}
          openChildSessionInspector={openChildSessionInspector}
          taskToolRuntimeLookup={taskToolRuntimeLookup}
          toolCallCards={toolCallCards}
          toolFilter={toolFilter}
          setToolFilter={setToolFilter}
          compactions={compactions}
          upstreamSummaries={rightPanelState.upstreamSummaries}
          pendingPermissions={pendingPermissions}
          resolveInlinePermissionActions={resolveInlinePermissionActions}
          planTasks={planTasks}
          planHistory={planHistory}
          sessionTodos={sessionTodos}
          sessionTasks={sessionTasks}
          childSessions={childSessions}
          pendingQuestions={pendingQuestions}
          dagNodes={dagNodes}
          dagEdges={dagEdges}
          agentEvents={agentEvents}
          mcpServers={mcpServers}
          onRetryMcpServer={handleRetryMcpServer}
          sharedUiThemeVars={sharedUiThemeVars}
          resolveTaskToolRuntimeSnapshot={resolveTaskToolRuntimeSnapshot}
          onCompactSession={() => void handleCompactCurrentSession()}
          onOpenRecoveryStrategy={() => {
            setRightOpen(true);
            setRightTab('history');
          }}
          providerCatalog={providerCatalog}
          attachmentItems={[]}
          artifactsWorkspaceHref={artifactsWorkspaceHref}
          contextUsageSnapshot={contextUsageSnapshot}
          contentArtifactCount={contentArtifactCount}
          contentArtifactCountStatus={contentArtifactCountStatus}
          currentSessionId={currentSessionId}
          dialogueMode={dialogueMode}
          effectiveWorkingDirectory={effectiveWorkingDirectory}
          effectiveContextMessageCount={effectiveContextMessageCount}
          messages={messages}
          sessionStateStatus={sessionStateStatus}
          workspaceFileItems={workspaceFileItems}
          permissionMode={permissionMode}
          yoloMode={yoloMode}
          sessionTerminals={sessionTerminals.terminals}
          sessionTerminalsRunningCount={sessionTerminals.runningCount}
          sessionTerminalsLoading={sessionTerminals.loading}
          sessionTerminalsError={sessionTerminals.error}
          sessionTerminalsPendingKillIds={sessionTerminals.pendingKillIds}
          sessionTerminalsLastSyncedAtMs={sessionTerminals.lastSyncedAtMs}
          onKillTerminal={sessionTerminals.killTerminal}
          onReloadTerminals={sessionTerminals.reload}
          backgroundTaskModel={backgroundTaskPanel}
          stoppingSubAgentIds={stoppingSubAgentIds}
          onStopSubagent={handleStopChildSession}
          onStopAllSubagents={handleStopAllChildSessions}
          onPreviewTerminal={handlePreviewBackgroundTerminal}
          backgroundTaskPreviewTerminalId={backgroundTaskPreviewTerminalId}
          ensureMessageVisible={ensureMessageVisible}
        />
      ) : null}
    </div>
  );
}
