import type { InputImageContent, SubagentNotice, WorkflowRuntimeState } from '@openAwork/shared';
import type { AttachmentItem } from '@openAwork/shared-ui';
import type { RollbackReceipt, Session, SessionTask } from '@openAwork/web-client';
import {
  createArtifactsClient,
  createQuestionsClient,
  createSessionsClient,
  createSettingsClient,
  createSshClient,
} from '@openAwork/web-client';
import type { CSSProperties } from 'react';
import React, {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
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
import { type UnifiedComposerActivity } from '../../components/chat/composer/UnifiedComposer.js';
import type { MentionFileSearchFn } from '../../components/chat/composer/use-mention-file-search.js';
import {
  ComposerWorkspaceMenu,
  type ComposerSshConnectionSummary,
} from '../../components/chat/composer/ComposerWorkspaceMenu.js';
import type { WorkspaceBindingChipState } from '../../components/chat/session/ChatTopBar.js';
import type { ComposerPermissionMode } from '../../components/chat/composer/ComposerPermissionModeSelect.js';
import { LatestAssistantMessageContext } from '../../components/chat/message/collapsible-assistant-content.js';
import { QuickTerminalPanel } from '../../components/chat/terminal/QuickTerminalPanel.js';

import { useChatSearch } from '../../components/chat/search/chat-search-overlay.js';

import { CompanionStage } from '../../components/chat/companion/companion-stage.js';
import { useBuddyIdleDetector } from '../../components/chat/companion/use-buddy-idle-detector.js';
import { InlineQuestionPanel } from '../../components/chat/misc/InlineQuestionPanel.js';
import { toast } from '../../components/common/feedback/ToastNotification.js';
import WorkspacePickerModal from '../../components/common/modal/WorkspacePickerModal.js';
import SshWorkspacePickerModal, {
  type SshPickerConnection,
  type SshWorkspaceSelection,
} from '../../components/common/modal/SshWorkspacePickerModal.js';
import type { SshConnectionDraft } from '../../components/common/modal/SshConnectionCreateForm.js';
import { useCommandRegistry } from '../../hooks/command/useCommandRegistry.js';
import { useComposerWorkspaceCatalog } from '../../hooks/chat/useComposerWorkspaceCatalog.js';
import { useFileEditor } from '../../hooks/editor/useFileEditor.js';
import { useGatewayClient } from '../../hooks/gateway/useGatewayClient.js';
import { usePrefersReducedMotion } from '../../hooks/ui/usePrefersReducedMotion.js';
import { useAuthStore } from '../../stores/auth/auth.js';
import { useCurrentUserDisplayName } from '../../stores/user-profile/current-user-profile.js';
import { resolveEffectiveTerminalPanelPosition, useUIStateStore } from '../../stores/ui/uiState.js';
import {
  type ChatSettingsProvider,
  loadSavedChatSessionDefaults,
} from '../../utils/chat/chat-session-defaults.js';
import {
  COMPOSER_REFERENCE_EVENT_NAME,
  isComposerReferenceEvent,
} from '../../utils/chat/composer-reference-events.js';
import { logger } from '../../utils/log/logger.js';

import {
  requestCurrentSessionRefresh,
  requestSessionListRefresh,
} from '../../utils/session/session-list-events.js';
import { subscribeSessionDialogueModeSwitch } from '../../utils/session/dialogue-mode-events.js';
import { subscribeSessionStreamResumeAttach } from '../../utils/session/session-stream-resume-events.js';

import { UNBOUND_WORKSPACE_LABEL } from '../../utils/session/session-grouping.js';
import { resolveNewSessionWorkspace } from '../../utils/session/new-session-workspace.js';
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
  createSessionMetadataSnapshot,
  isImmediatelyRenderableStructuredContent,
  prepareSessionRecoveryState,
  REMOTE_STREAM_RECOVERY_POLL_MS,
} from './conversation/render/chat-page-utils.js';
import { ChatRightPanel } from './panels/chat-right-panel.js';
import { useBackgroundTaskPanel } from './panels/use-background-task-panel.js';

import {
  type ImageEditReferenceArtifact,
  toImageEditReferenceArtifacts,
} from './conversation/render/image-edit-reference-artifacts.js';
import { makeOrderedMessageId } from '../../components/conversation-runtime/messages/ordered-id.js';
import { collectSubagentNotices } from '../../components/conversation-runtime/messages/subagent-notices.js';

import { startSequentialPolling } from '../../components/conversation-runtime/session/sequential-polling.js';

import {
  type SessionStateStatus,
  type SessionTodoItem,
  shouldPollSessionRuntime,
} from '../../components/conversation-runtime/session/session-runtime.js';

import { type ChatBackendUsageSnapshot } from '../../components/conversation-runtime/stream/stream-usage.js';

import {
  extractStreamingThinkingTexts,
  joinStreamingThinkingTexts,
  type StreamingThinkingBlock,
} from '../../components/conversation-runtime/stream/streaming-thinking.js';
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
  type ChatMessagePart,
  estimateTokenCount,
  MENTION_SEARCH_LIMIT,
  type ReasoningEffort,
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
import { resolveRollbackDerivedState } from './conversation/snapshot/rollback-derived-state.js';
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

import { useChatPendingActions } from './hooks/use-chat-pending-actions.js';
import { useChatRetryAndEdit } from './hooks/use-chat-retry-and-edit.js';
import { useChatSessionLifecycle } from './hooks/use-chat-session-lifecycle.js';
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
import { useModelPrices } from './conversation/settings/use-model-prices.js';
import { useProviderModelInfo } from './conversation/settings/use-provider-model-info.js';
import { useScrollManager } from '../../components/conversation-runtime/scroll/use-scroll-manager.js';
import { useSessionContentArtifactCount } from './conversation/snapshot/use-session-content-artifact-count.js';
import { useSessionTerminals } from '../../components/conversation-runtime/terminals/use-session-terminals.js';

import { useSessionSettingsCallbacks } from './conversation/settings/use-session-settings-callbacks.js';
import {
  resolveModelSelectionSourceFromMetadata,
  shouldAdoptSessionModelSelectionDefaults,
  type ModelSelectionSource,
} from './conversation/settings/model-selection-source.js';
import { useSessionSidebarRunState } from './conversation/snapshot/use-session-sidebar-run-state.js';
import { useSessionSnapshotLoader } from './conversation/snapshot/use-session-snapshot-loader.js';

import { type SessionArtifactsResponse } from '../artifacts/workspace/artifact-workspace-types.js';

import { useStreamAttachRetry } from '../../components/conversation-runtime/attach/use-stream-attach-retry.js';
import { normalizeChatThinkingState } from './conversation/settings/resolve-chat-thinking-request.js';
import {
  type ChatRightPanelState,
  createInitialChatRightPanelState,
  getToolCallCards,
} from './state/chat-stream-state.js';
import {
  DIALOGUE_MODE_OPTIONS,
  type DialogueMode,
  getDefaultAgentForDialogueMode,
} from './mode/dialogue-mode.js';
import { useDialogueModeSwitch } from './mode/use-dialogue-mode-switch.js';
import { useDisplayPreferencesStore } from '../../stores/settings/display-preferences.js';
import { useChatStreaming } from './conversation/render/use-chat-streaming.js';
import { usePersistedStreamError } from './hooks/use-persisted-stream-error.js';

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
const LOAD_MORE_MESSAGE_INCREMENT = 20;

type SplitStyle = {
  readonly flex: number;
  readonly minHeight: CSSProperties['minHeight'];
  readonly minWidth: CSSProperties['minWidth'];
  readonly display: CSSProperties['display'];
  readonly overflow: CSSProperties['overflow'];
  readonly '--split-pos': string;
};
const INITIAL_TURN_LIMIT = 10;

export default function ChatPage() {
  const routeParams = useParams<{ sessionId: string }>();
  const sessionId = routeParams.sessionId;
  const location = useLocation();
  const navigate = useNavigate();
  const pageActivation = usePageActivation();
  const isPageActive = pageActivation;
  const token = useAuthStore((s) => s.accessToken);
  const gatewayUrl = useAuthStore((s) => s.gatewayUrl);

  // ─── 会话生命周期域 — 抽到 useChatSessionLifecycle。
  // 参见 docs/architecture/chat-page-split-plan.md 域 A。
  const sessionLifecycle = useChatSessionLifecycle({
    routeSessionId: sessionId,
    gatewayUrl,
    token,
    defaultVisibleMessageCount: DEFAULT_VISIBLE_MESSAGE_COUNT,
  });
  const {
    currentSessionId,
    setCurrentSessionId,
    messages,
    setMessages,
    messageRatings,
    setMessageRatings,
    sessionReloadNonce,
    setSessionReloadNonce,
    hasPendingFollowContent,
    setHasPendingFollowContent,
    isSessionLoading,
    setIsSessionLoading,
    visibleMessageCount,
    setVisibleMessageCount,
    serverTotalTurnCount,
    setServerTotalTurnCount,
    messagesRef,
    activeSessionRef,
    currentLoadedSessionIdRef,
    sessionViewEpochRef,
    currentSessionViewRef,
    pendingBootstrapSessionRef,
    previousRouteSessionIdRef,
    pendingSessionNormalizeTimeoutRef,
    workspace,
    sessionViewCache,
    activateSessionView,
    isCurrentSessionView,
    isCurrentSessionRequest,
    handleToggleMessageRating,
  } = sessionLifecycle;
  const [activeProviderId, setActiveProviderId] = useState<string>('');
  const [activeModelId, setActiveModelId] = useState<string>('');
  const currentUserEmail = useAuthStore((s) => s.email) ?? '';
  const currentUserDisplayName = useCurrentUserDisplayName();
  const [providers, setProviders] = useState<ChatSettingsProvider[]>([]);
  const [input, setInput] = useState('');
  const [companionComposerActivity, setCompanionComposerActivity] =
    useState<UnifiedComposerActivity>({
      attachedCount: 0,
      queuedCount: 0,
      showVoice: false,
    });
  const idleSeconds = useBuddyIdleDetector({ input });
  const lastParentTaskSyncMarkerRef = useRef<string | null>(null);
  const hasAppliedSavedImageDefaultsRef = useRef(false);
  const savedChatDefaultsRef = useRef<{
    modelId: string;
    providerId: string;
    reasoningEffort: ReasoningEffort;
    thinkingEnabled: boolean;
  } | null>(null);

  const [dialogueMode, setDialogueMode] = useState<DialogueMode>(
    () => useDisplayPreferencesStore.getState().defaultDialogueMode,
  );
  const [manualAgentId, setManualAgentId] = useState('');
  const [permissionMode, setPermissionMode] = useState<ComposerPermissionMode>('ask');
  // 档位是唯一事实来源；布尔 yoloMode 是派生投影，供顶栏 / 命令面板 / 流式请求等旧读者消费。
  const yoloMode = permissionMode === 'yolo';
  const [webSearchEnabled, setWebSearchEnabled] = useState(true);
  const [thinkingEnabled, setThinkingEnabled] = useState(false);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>('medium');
  const [streamError, setStreamError] = usePersistedStreamError(currentSessionId);
  const modelPrices = useModelPrices(gatewayUrl, token);
  const [rightPanelState, setRightPanelState] = useState(() => createInitialChatRightPanelState());
  const streamingState = useChatStreaming();
  const {
    streaming,
    setStreaming,
    stoppingStream,
    setStoppingStream,
    streamBuffer,
    setStreamBuffer,
    streamThinkingBuffer,
    setStreamThinkingBuffer,
    streamThinkingBlocks,
    setStreamThinkingBlocks,
    streamingSegments,
    setStreamingSegments,
    reportedStreamUsage,
    setReportedStreamUsage,
    recoveryActiveStream,
    setRecoveryActiveStream,
    recoveredStreamSnapshot,
    setRecoveredStreamSnapshot,
    activeStreamStartedAt,
    setActiveStreamStartedAt,
    activeStreamRoundStartedAt,
    setActiveStreamRoundStartedAt,
    activeStreamFirstTokenLatencyMs,
    setActiveStreamFirstTokenLatencyMs,
    latestUpstreamSummary,
    setLatestUpstreamSummary,
    streamingRef,
    stoppingStreamRef,
    currentAssistantStreamMessageIdRef,
    pendingStreamRevealFrameRef,
    streamRevealTargetRef,
    streamRevealVisibleRef,
    streamRevealTargetCodePointsRef,
    streamRevealVisibleCodePointCountRef,
    streamRevealNextAllowedAtRef,
    resetStreamState,
    scheduleStreamReveal,
    isImmediatelyRenderableStructuredContent,
  } = streamingState;
  // Live refs that mirror streaming/right-panel state so that effects (especially
  // session-switch cleanup) can read the latest values without depending on them.
  const streamBufferRef = useRef('');
  streamBufferRef.current = streamBuffer;
  const streamThinkingBlocksRef = useRef<StreamingThinkingBlock[]>([]);
  streamThinkingBlocksRef.current = streamThinkingBlocks;
  const streamingSegmentsRef = useRef<ChatMessagePart[]>([]);
  streamingSegmentsRef.current = streamingSegments;
  const reportedStreamUsageRef = useRef<ChatBackendUsageSnapshot | null>(null);
  reportedStreamUsageRef.current = reportedStreamUsage;
  const activeStreamStartedAtRef = useRef<number | null>(null);
  activeStreamStartedAtRef.current = activeStreamStartedAt;
  const rightPanelStateRef = useRef<ChatRightPanelState>(rightPanelState);
  rightPanelStateRef.current = rightPanelState;
  const lastAttachAttemptTimestampRef = useRef<number>(0);
  const [reviewRefreshRevision, setReviewRefreshRevision] = useState(0);
  const previousStreamingRef = useRef(streaming);
  useEffect(() => {
    if (previousStreamingRef.current && !streaming) {
      setReviewRefreshRevision((revision) => revision + 1);
    }
    previousStreamingRef.current = streaming;
  }, [streaming]);

  // ─── 待处理操作域 — 抽到 useChatPendingActions。
  // 参见 docs/architecture/chat-page-split-plan.md 域 C。
  const pendingActions = useChatPendingActions({
    gatewayUrl,
    token,
    currentSessionId,
    setMessages,
    setRightPanelState,
    setStreamError,
  });
  const {
    pendingPermissions,
    setPendingPermissions,
    pendingQuestions,
    setPendingQuestions,
    activePendingQuestion,
    inlineQuestionAnswers,
    inlineQuestionCustomInputs,
    inlineQuestionReplyStatus,
    inlineQuestionReplyError,
    toggleInlineQuestionOption,
    handleInlineQuestionCustomInput,
    replyInlineQuestion,
    resolveInlinePermissionActions,
  } = pendingActions;

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
  const [sessionImageEditReferenceArtifacts, setSessionImageEditReferenceArtifacts] = useState<
    ImageEditReferenceArtifact[]
  >([]);
  const [selectedImageEditReferenceArtifactId, setSelectedImageEditReferenceArtifactId] = useState<
    string | null
  >(null);
  const devServerDetectedTerminalIdsRef = useRef<Set<string>>(new Set());
  const [sessionStateStatus, setSessionStateStatus] = useState<SessionStateStatus | null>(null);
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
  const setBrowserPreviewUrlForWorkspace = useUIStateStore(
    (s) => s.setBrowserPreviewUrlForWorkspace,
  );
  const chatView = useUIStateStore((s) => s.chatView);
  const workspaceTreeVersion = useUIStateStore((s) => s.workspaceTreeVersion);
  const selectedWorkspacePath = useUIStateStore((s) => s.selectedWorkspacePath);
  const setSelectedWorkspacePath = useUIStateStore((s) => s.setSelectedWorkspacePath);
  const addSavedWorkspacePath = useUIStateStore((s) => s.addSavedWorkspacePath);
  const savedWorkspacePaths = useUIStateStore((s) => s.savedWorkspacePaths);
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
  const openFileRef = useFileEditorContext();
  const effectiveWorkingDirectory = currentSessionId
    ? workspace.workingDirectory
    : selectedWorkspacePath;
  const searchMentionFiles = useMemo<MentionFileSearchFn>(
    () => (query, signal) =>
      effectiveWorkingDirectory
        ? workspace.searchFileIndex(effectiveWorkingDirectory, {
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
    [
      currentSessionId,
      effectiveWorkingDirectory,
      selectedSshConnectionId,
      workspace.searchFileIndex,
    ],
  );
  const uiWorkspaceScope = resolveChatUiWorkspaceScope(effectiveWorkingDirectory, currentSessionId);

  // SSH 工作区文件读取身份：读取消费方（文件编辑器 / 预览）不带会话上下文，
  // 只能从这里读瞬态身份，所以会话 / 草稿远程选择一变就同步写入。
  // - 已有会话：传 sessionId，网关沿父会话链解析 SSH 绑定；
  // - 草稿态：传草稿选中的 sshConnectionId；
  // - remote 只是提示位，不参与请求参数。
  useEffect(() => {
    setReadIdentity({
      sessionId: currentSessionId ?? null,
      sshConnectionId: currentSessionId ? null : (selectedSshConnectionId ?? null),
      remote:
        Boolean(workspace.sshConnectionId) || Boolean(!currentSessionId && selectedSshConnectionId),
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
    showWorkspaceSelector,
    setShowWorkspaceSelector,
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
    lastPersistedSessionMetadataSnapshotRef.current = null;
    resetStreamState();
    setStreamError(null);
    setDialogueMode(useDisplayPreferencesStore.getState().defaultDialogueMode);
    currentLoadedSessionIdRef.current = null;
    consumeResetToWelcomeSignal();
  }, [resetToWelcomeSignal, consumeResetToWelcomeSignal]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const { contentArtifactCount, status: contentArtifactCountStatus } =
    useSessionContentArtifactCount({
      currentSessionId,
      gatewayUrl,
      refreshKey: sessionReloadNonce + messages.length,
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
    setSidePanelActiveTab,
    setTerminalPanelOpened,
    sidePanelActiveTab,
    terminalPanelOpened,
    terminalRunningCount: sessionTerminals.runningCount,
  });
  const classicConversationLayoutState = useMemo(
    () => resolveClassicConversationLayoutState({ editorMode }),
    [editorMode],
  );
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

  const {
    buildSessionMetadata,
    markSessionMetadataDirty,
    clearSessionMetadataDirty,
    handleDialogueModeChange,
    handleToggleYolo,
    handlePermissionModeChange,
    handleToggleWebSearch: rawHandleToggleWebSearch,
    handleThinkingEnabledChange,
    handleReasoningEffortChange,
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
      modelSelectionSource: sessionModelSelectionSourceRef.current,
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
    previousRouteSessionIdRef.current = nextSessionId;
  }, [sessionId]);

  // 任务同步 marker 与会话生命周期耦合(切会话即清空,避免上一会话的
  // task marker 误导新会话的 polling 比较),但 marker 本身属任务同步域,
  // 留在父组件管理。useChatSessionLifecycle 负责其它 ref 的镜像。
  useEffect(() => {
    lastParentTaskSyncMarkerRef.current = null;
  }, [currentSessionId, sessionId]);

  useEffect(() => {
    setLastChatPath(location.pathname);
  }, [location.pathname, setLastChatPath]);

  useEffect(() => {
    void currentSessionId;
    setReportedStreamUsage(null);
    setMessageRatings({});
    setLatestGeneratedImageResult(null);
    setSessionImageEditReferenceArtifacts([]);
    setSelectedImageEditReferenceArtifactId(null);
    // browserPreviewUrl 是按 workspace 路径持久化的(browserPreviewUrlByWorkspace),
    // 跨 workspace 切会话自动切到对应 workspace 的 url;同 workspace 内会话共享 url。
    devServerDetectedTerminalIdsRef.current = new Set();
  }, [currentSessionId]);

  useEffect(() => {
    if (!currentSessionId || !token) {
      setSessionImageEditReferenceArtifacts([]);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    void createArtifactsClient(gatewayUrl)
      .listForSession(token, currentSessionId, { signal: controller.signal })
      .then((rawPayload) => {
        if (cancelled) {
          return;
        }
        const payload = rawPayload as unknown as SessionArtifactsResponse;
        setSessionImageEditReferenceArtifacts(
          toImageEditReferenceArtifacts(payload.contentArtifacts ?? []),
        );
      })
      .catch((error: unknown) => {
        if (cancelled || (error instanceof DOMException && error.name === 'AbortError')) {
          return;
        }

        setSessionImageEditReferenceArtifacts([]);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [currentSessionId, gatewayUrl, sessionReloadNonce, token]);

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
  const taskToolRuntimeLookup = useMemo(
    () => buildTaskToolRuntimeLookup(childSessions, sessionTasks),
    [childSessions, sessionTasks],
  );
  const subAgentRunItems = useMemo(
    () => buildSubAgentRunItems(childSessions, sessionTasks, currentSessionId),
    [childSessions, sessionTasks, currentSessionId],
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
    selectedChildSessionId,
    setReviewPanelOpened,
    setRightOpen,
    setRightTab,
    setSelectedChildSessionId,
    setSidePanelActiveTab,
    subAgentRunItems,
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
  }, [isFusionLayout, setReviewPanelOpened, setSidePanelActiveTab]);

  const loadSavedChatDefaults = useCallback(async () => {
    if (!token) {
      return null;
    }
    const {
      defaults,
      imageDefaults,
      providers: loadedProviders,
    } = await loadSavedChatSessionDefaults(gatewayUrl, token);
    savedChatDefaultsRef.current = defaults;

    return {
      defaults,
      imageDefaults,
      providers: loadedProviders,
    };
  }, [gatewayUrl, token]);

  const handleContextWindowOverrideChange = useCallback(
    async (value: number | undefined) => {
      if (!token || !activeProviderId || !activeModelId) {
        throw new Error('当前模型尚未准备好，无法保存上下文挡位。');
      }

      const result = await createSettingsClient(gatewayUrl).putModelContext(token, {
        providerId: activeProviderId,
        modelId: activeModelId,
        contextWindowOverride: value ?? null,
      });
      setProviders((previous) =>
        previous.map((provider) => {
          if (provider.id !== result.providerId) return provider;
          return {
            ...provider,
            defaultModels: provider.defaultModels.map((model) => {
              if (model.id !== result.modelId) return model;
              if (result.contextWindowOverride === null) {
                const { contextWindowOverride: _removed, ...rest } = model;
                return rest;
              }
              return { ...model, contextWindowOverride: result.contextWindowOverride };
            }),
          };
        }),
      );
    },
    [activeModelId, activeProviderId, gatewayUrl, token],
  );

  useEffect(() => {
    if (!token) return;
    void loadSavedChatDefaults()
      .then((loaded) => {
        if (!loaded) {
          return;
        }

        const { defaults, imageDefaults, providers: loadedProviders } = loaded;

        setActiveProviderId((prev) => {
          const normalizedPrev = prev.trim();
          if (sessionId) {
            return normalizedPrev || defaults.providerId;
          }
          return defaults.providerId;
        });

        setActiveModelId((prev) => {
          const normalizedPrev = prev.trim();
          if (sessionId) {
            return normalizedPrev || defaults.modelId;
          }
          return defaults.modelId;
        });

        setProviders(loadedProviders);
        // Only seed chat-page image defaults from saved settings on first load.
        // Re-applying on every sessionId change would silently revert any
        // size/quality/format/background the user just adjusted in the composer.
        if (!hasAppliedSavedImageDefaultsRef.current) {
          applySavedImageDefaults(imageDefaults);
          hasAppliedSavedImageDefaultsRef.current = true;
        }

        if (!sessionId) {
          setThinkingEnabled(defaults.thinkingEnabled);
          setReasoningEffort(defaults.reasoningEffort);
        }
      })
      .catch(() => null);
  }, [applySavedImageDefaults, loadSavedChatDefaults, sessionId, token]);

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

  /**
   * 历史跳转 / 搜索 / 收藏三个入口共用:点目标消息时,如果它没在当前
   * 渲染窗口里(分页只渲染最近 N 条 / 服务端还没拉到本地),先把它「弄
   * 出来」再让调用方滚动。否则点击会静默无响应,用户看不到任何反馈。
   *
   * 必须放在 `useSessionSnapshotLoader` 解构之后,否则 useCallback 的
   * 依赖数组会在初始化时读取尚未声明的 `loadCurrentSessionSnapshot`
   * 触发 TDZ 错误。
   */
  const ensureMessageVisible = useCallback(
    async (messageId: string) => {
      if (!messageId) return;
      // 先在本地完整列表里找。如果在,但被分页裁掉了 → 把窗口拉到包含它。
      const localIndex = messages.findIndex((m) => m.id === messageId);
      if (localIndex >= 0) {
        // visibleMessageCount === undefined 表示「全部展开」,本就可见。
        if (visibleMessageCount !== undefined) {
          // 渲染的是 `slice(-visibleMessageCount)`,所以可见区间是
          // [messages.length - visibleMessageCount, messages.length)。
          // 把窗口扩到能覆盖目标的位置。多加 5 条作为上下文 buffer。
          const requiredCount = messages.length - localIndex + 5;
          if (requiredCount > visibleMessageCount) {
            setVisibleMessageCount(requiredCount);
          }
        }
        return;
      }
      // 本地数组里也没有 → 服务端可能还没拉过来,触发一次 snapshot
      // 重载并把窗口扩到全部新消息可见。
      if (currentSessionId) {
        try {
          await loadCurrentSessionSnapshot(currentSessionId, { replaceMessages: true });
          setServerTotalTurnCount(null);
          // 拉一个足够大的值,使 `slice(-visibleMessageCount)` 等同于全部。
          // useChatRenderData 会在 visibleMessageCount >= 总长时返回完整列表,
          // 不会真的展示 9999 条空 slot。
          setVisibleMessageCount(9_999);
        } catch {
          /* swallow — caller will fall through to its own missing-target branch */
        }
      }
    },
    [
      messages,
      visibleMessageCount,
      currentSessionId,
      loadCurrentSessionSnapshot,
      setVisibleMessageCount,
      setServerTotalTurnCount,
    ],
  );

  const remoteSessionBusyState = useMemo<Extract<
    SessionStateStatus,
    'running' | 'paused'
  > | null>(() => {
    if (streaming) {
      return null;
    }

    // 如果刚发送消息（5秒内），不显示"正在重新接入"提示
    // 这是正常的发送流程，不是远程流恢复场景
    const timeSinceStreamStart =
      activeStreamStartedAt !== null ? Date.now() - activeStreamStartedAt : Infinity;
    if (timeSinceStreamStart < 5000) {
      return null;
    }

    // 有待处理交互（权限/提问）时，会话实质处于 paused；必须在这里返回，
    // 否则下面的 idle 提前返回会让 remoteSessionBusyState 变成 null，
    // 进而关闭 /recovery 轮询（见下方 useEffect 的门控），前端就再也学不到
    // 服务端的 paused 状态，只能整页刷新。
    if (pendingPermissions.length > 0 || pendingQuestions.length > 0) {
      return 'paused';
    }

    // 如果会话状态是 idle 且没有 active stream，不应该显示忙碌状态
    if (sessionStateStatus === 'idle' && recoveryActiveStream === null) {
      return null;
    }

    if (sessionStateStatus === 'running' || sessionStateStatus === 'paused') {
      return sessionStateStatus;
    }

    if (recoveryActiveStream !== null) {
      return 'running';
    }

    return null;
  }, [
    activeStreamStartedAt,
    pendingPermissions,
    pendingQuestions,
    recoveryActiveStream,
    sessionStateStatus,
    streaming,
  ]);
  // 有 attach 重试待触发且归属当前会话 = 客户端正在重新接入；用于状态条显示「恢复中」。
  const sessionReconnecting =
    currentSessionId !== null &&
    attachRetryScheduledSessionId !== null &&
    attachRetryScheduledSessionId === currentSessionId;
  const activeGatewayStreamClientRequestId = client.getActiveStreamClientRequestId();
  const activeGatewayStreamSessionId = client.getActiveStreamSessionId();
  const isCurrentSessionRunning = sessionStateStatus === 'running';
  const canStopCurrentSessionStream = Boolean(
    currentSessionId &&
    activeGatewayStreamSessionId === currentSessionId &&
    (streaming || isCurrentSessionRunning),
  );
  const stopCapability = useMemo<'none' | 'precise' | 'best_effort' | 'observe_only'>(() => {
    if (streaming || canStopCurrentSessionStream) {
      return 'precise';
    }

    if (currentSessionId && sessionStateStatus === 'running') {
      return 'best_effort';
    }

    if (remoteSessionBusyState !== null) {
      return 'observe_only';
    }

    return 'none';
  }, [
    canStopCurrentSessionStream,
    currentSessionId,
    remoteSessionBusyState,
    sessionStateStatus,
    streaming,
  ]);
  const visibleStreaming = streaming || recoveredStreamSnapshot !== null;
  const visibleStreamBuffer = streaming ? streamBuffer : (recoveredStreamSnapshot?.text ?? '');
  const visibleStreamThinkingBlocks = streaming
    ? extractStreamingThinkingTexts(streamThinkingBlocks)
    : extractStreamingThinkingTexts(recoveredStreamSnapshot?.thinkingBlocks ?? []);
  const visibleStreamThinkingBuffer = streaming
    ? streamThinkingBuffer
    : joinStreamingThinkingTexts(recoveredStreamSnapshot?.thinkingBlocks ?? []);
  const visibleStreamStartedAt = streaming
    ? activeStreamStartedAt
    : (recoveredStreamSnapshot?.startedAt ?? null);
  // 实时气泡的 createdAt 必须落在**本轮**（网关按轮持久化），否则同请求内已提交的
  // 轮次时间戳更晚，排序会把实时气泡顶到最上面。恢复快照的 startedAt 就是本轮起点。
  const activeStreamRoundStart =
    streaming && activeStreamRoundStartedAt !== null
      ? activeStreamRoundStartedAt
      : visibleStreamStartedAt;
  const visibleReportedStreamUsage = reportedStreamUsage ?? recoveredStreamSnapshot?.usage ?? null;
  const visibleLatestUpstreamSummary =
    latestUpstreamSummary ?? recoveredStreamSnapshot?.upstreamSummary ?? null;
  // Surfaces the wire-faithful ordered parts during an active stream so the
  // live render reflects gateway event order. During recovery (before the
  // live attach completes) the real segment list is still empty, so we
  // synthesize ordered parts from the snapshot's thinking blocks + text.
  // This preserves `startedAt` / `endedAt` on reasoning parts so the UI
  // correctly marks ended thinking blocks instead of showing an infinite
  // streaming cursor.
  const visibleStreamingSegments = streaming
    ? streamingSegments
    : recoveredStreamSnapshot
      ? recoveredStreamSnapshot.parts
      : [];
  const activeStreamMessageId =
    currentAssistantStreamMessageIdRef.current ?? recoveredStreamSnapshot?.messageId ?? null;

  const shouldPollSessionSubresources = useMemo(
    () =>
      Boolean(
        currentSessionId &&
        token &&
        isPageActive &&
        isSessionSnapshotReady &&
        !isSessionLoading &&
        remoteSessionBusyState === null &&
        sessionModesHydrated &&
        shouldPollSessionRuntime({
          pendingPermissions,
          sessionStateStatus,
          sessionTasks,
          streaming,
        }),
      ),
    [
      currentSessionId,
      isPageActive,
      isSessionLoading,
      isSessionSnapshotReady,
      pendingPermissions,
      remoteSessionBusyState,
      sessionModesHydrated,
      sessionStateStatus,
      sessionTasks,
      streaming,
      token,
    ],
  );

  useEffect(() => {
    if (!currentSessionId || !token) {
      return;
    }

    const nextMarker = buildTerminalTaskSyncMarker(sessionTasks);
    if (lastParentTaskSyncMarkerRef.current === null) {
      lastParentTaskSyncMarkerRef.current = nextMarker;
      return;
    }

    if (
      nextMarker.length === 0 ||
      nextMarker === lastParentTaskSyncMarkerRef.current ||
      streaming ||
      isSessionLoading
    ) {
      return;
    }

    let cancelled = false;
    const targetSessionId = currentSessionId;
    const expectedSessionViewEpoch = currentSessionViewRef.current.epoch;

    void createSessionsClient(gatewayUrl)
      .getRecovery(token, targetSessionId, { messageLimit: INITIAL_TURN_LIMIT })
      .then((session) => {
        if (cancelled || !isCurrentSessionView(targetSessionId, expectedSessionViewEpoch)) {
          return;
        }

        const prepared = prepareSessionRecoveryState(session);
        lastParentTaskSyncMarkerRef.current = nextMarker;
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
      streamBufferRef,
      streamThinkingBlocksRef,
      streamingRef,
      streamingSegmentsRef,
      syncRecoveredStreamSnapshot,
      token,
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
    token,
  ]);

  useChatDataLoaders({
    effectiveWorkingDirectory,
    workspace,
    workspaceTreeVersion,
    setWorkspaceFileItems,
    token,
    gatewayUrl,
    rightOpen,
    rightTab,
    setMcpServers,
  });

  useEffect(() => {
    if (!currentSessionId || !token || !shouldPollSessionSubresources) {
      return;
    }

    const targetSessionId = currentSessionId;
    const expectedSessionViewEpoch = currentSessionViewRef.current.epoch;

    const polling = startSequentialPolling({
      initialDelayMs: streaming ? 0 : 3000,
      intervalMs: 3000,
      run: async (signal) => {
        await loadSessionRuntimeSnapshot(targetSessionId, signal, expectedSessionViewEpoch);
      },
    });

    return () => {
      polling.cancel();
    };
  }, [
    currentSessionId,
    loadSessionRuntimeSnapshot,
    shouldPollSessionSubresources,
    streaming,
    token,
  ]);

  useEffect(() => {
    if (
      !currentSessionId ||
      !token ||
      !remoteSessionBusyState ||
      !isPageActive ||
      !isSessionSnapshotReady ||
      !sessionModesHydrated
    ) {
      return;
    }

    const targetSessionId = currentSessionId;
    const expectedSessionViewEpoch = currentSessionViewRef.current.epoch;
    const polling = startSequentialPolling({
      initialDelayMs: REMOTE_STREAM_RECOVERY_POLL_MS,
      intervalMs: REMOTE_STREAM_RECOVERY_POLL_MS,
      run: async (signal) => {
        // During active streaming, messages arrive via SSE in real-time.
        // Use lightweight /status endpoint instead of full /recovery to
        // avoid redundant full-message queries and serialization.
        if (streamingRef.current) {
          await loadSessionRuntimeSnapshot(targetSessionId, signal, expectedSessionViewEpoch);
        } else {
          await loadCurrentSessionSnapshot(targetSessionId, {
            expectedSessionViewEpoch,
            messageLimit: INITIAL_TURN_LIMIT,
            signal,
          });
        }
      },
    });

    return () => {
      polling.cancel();
    };
  }, [
    currentSessionId,
    isPageActive,
    isSessionSnapshotReady,
    loadCurrentSessionSnapshot,
    loadSessionRuntimeSnapshot,
    remoteSessionBusyState,
    sessionModesHydrated,
    token,
  ]);

  useEffect(() => {
    if (!currentSessionId || !token || !sessionModesHydrated || !sessionMetadataDirty) return;

    // 从 providers 列表中查找当前选中模型的 label
    const currentProvider = providers.find((p) => p.id === activeProviderId);
    const currentModel = currentProvider?.defaultModels.find((m) => m.id === activeModelId);
    const modelLabel = currentModel?.label;

    const nextMetadata = buildSessionMetadata(modelLabel ? { modelLabel } : {});
    const nextSnapshot = createSessionMetadataSnapshot(nextMetadata);
    const targetSessionId = currentSessionId;

    if (lastPersistedSessionMetadataSnapshotRef.current === nextSnapshot) {
      clearSessionMetadataDirty();
      return;
    }

    void createSessionsClient(gatewayUrl)
      .updateMetadata(token, targetSessionId, nextMetadata)
      .then(() => {
        if (activeSessionRef.current !== targetSessionId) {
          return;
        }
        lastPersistedSessionMetadataSnapshotRef.current = nextSnapshot;
        sessionModelSelectionSourceRef.current = resolveModelSelectionSourceFromMetadata({
          modelSelectionSource:
            typeof nextMetadata['modelSelectionSource'] === 'string'
              ? nextMetadata['modelSelectionSource']
              : undefined,
          providerId:
            typeof nextMetadata['providerId'] === 'string' ? nextMetadata['providerId'] : undefined,
          modelId:
            typeof nextMetadata['modelId'] === 'string' ? nextMetadata['modelId'] : undefined,
        });
        clearSessionMetadataDirty();
        requestSessionListRefresh();
      })
      .catch(() => undefined);
  }, [
    activeModelId,
    activeProviderId,
    buildSessionMetadata,
    clearSessionMetadataDirty,
    currentSessionId,
    gatewayUrl,
    providers,
    sessionMetadataDirty,
    sessionModesHydrated,
    token,
  ]);

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
  );

  const prevSnapshotReadyRef = useRef(false);
  const prevPageActiveRef = useRef(isPageActive);
  // When true, the next scroll-to-latest trigger (Effect A or B) should be
  // suppressed because the cache-restore path already set scrollTop.
  const suppressNextScrollRef = useRef(false);

  // Refs mirroring reactive state for use inside effects that must NOT
  // re-run when these values change (to avoid canceling an in-progress
  // settleObserver via cleanup).
  const isSessionSnapshotReadyRef = useRef(isSessionSnapshotReady);
  isSessionSnapshotReadyRef.current = isSessionSnapshotReady;
  const messagesLengthRef = useRef(messages.length);
  messagesLengthRef.current = messages.length;

  // ── Effect A: First snapshot ready → scroll to bottom ────────────────
  // Triggers when `isSessionSnapshotReady` transitions to `true` for the
  // first time after a session switch (prevSnapshotReadyRef guards against
  // re-triggering on every messages.length change).
  //
  // IMPORTANT: Only depends on `isSessionSnapshotReady` and the stable
  // `forceFollowToLatest` callback.  `messages.length` is read via ref so
  // streaming updates don't cause cleanup to cancel the settle loop.
  //
  // 用 layout effect 而非 passive effect：`forceFollowToLatest` 的同步首帧会在
  // 本帧绘制前贴底；放到 passive effect（绘制之后才跑）时，长历史会话打开后的
  // 第一帧会画在旧位置（用户先看到最旧的消息），慢机 / 后台标签页下该窗口可达数秒。
  useLayoutEffect(() => {
    if (!prevSnapshotReadyRef.current && isSessionSnapshotReady && messagesLengthRef.current > 0) {
      // When restored from cache, scroll was already set — skip the forced scroll-to-bottom
      if (sessionRestoredFromCacheRef.current) {
        sessionRestoredFromCacheRef.current = false;
        suppressNextScrollRef.current = true;
        prevSnapshotReadyRef.current = isSessionSnapshotReady;
        return;
      }
      suppressNextScrollRef.current = false;
      const cleanup = forceFollowToLatest('auto');
      prevSnapshotReadyRef.current = isSessionSnapshotReady;
      return cleanup;
    }
    prevSnapshotReadyRef.current = isSessionSnapshotReady;
  }, [isSessionSnapshotReady, forceFollowToLatest, sessionRestoredFromCacheRef]);

  useEffect(() => {
    if (!isSessionSnapshotReady) {
      prevSnapshotReadyRef.current = false;
    }
  }, [isSessionSnapshotReady]);

  // ── Effect B: Page reactivation → scroll to bottom ───────────────────
  // In classic layout, CachedRouteOutlet keeps ChatPage mounted but toggles
  // `display: none / flex` on the wrapper.  When the user navigates away
  // (e.g. to Settings) and back, `isPageActive` goes false → true.  Since
  // `isSessionSnapshotReady` never changed, Effect A won't re-fire.  This
  // effect bridges the gap: when the page becomes active again and there
  // are messages, force a scroll to the latest message.
  //
  // 产品决策：页面重新激活**不**无条件把用户拉回底部。跟随仅在启用
  // （用户没有明确离开 latest）时才重新贴底；正在翻历史的用户保持原位。
  //
  // IMPORTANT: This effect only depends on `isPageActive` (and the stable
  // `forceFollowToLatest` / `isFollowEngaged` callbacks).  We deliberately
  // exclude `isSessionSnapshotReady` and `messages.length` from the dep array
  // so streaming updates (which change messages.length) don't cause the
  // cleanup to cancel an in-progress smooth scroll.  Those values are read
  // via refs instead.
  //
  // 与 Effect A 同理用 layout effect：面板从 `display: none` 恢复时，同步首帧
  // 贴底才能保证重新显示的第一帧就在最新处。
  useLayoutEffect(() => {
    const wasActive = prevPageActiveRef.current;
    prevPageActiveRef.current = isPageActive;
    if (
      !wasActive &&
      isPageActive &&
      isSessionSnapshotReadyRef.current &&
      messagesLengthRef.current > 0 &&
      isFollowEngaged()
    ) {
      // If Effect A just ran a cache-restore skip, don't override the
      // restored scrollTop with a forced scroll-to-bottom.
      if (suppressNextScrollRef.current) {
        suppressNextScrollRef.current = false;
        return;
      }
      const cleanup = forceFollowToLatest('auto');
      return cleanup;
    }
  }, [isPageActive, forceFollowToLatest, isFollowEngaged]);

  const focusComposerWithText = useCallback((text: string) => {
    setInput(text);
    requestAnimationFrame(() => {
      if (!textareaRef.current) return;
      textareaRef.current.focus();
      const caret = text.length;
      textareaRef.current.setSelectionRange(caret, caret);
    });
  }, []);

  /**
   * 欢迎页「新建会话」：把当前视图复位为空白草稿并聚焦输入框，不立即在服务端
   * 创建空会话——真正的会话在首条消息发出时才落库，因此连续点击不会堆积空对话。
   *
   * 草稿工作区按「点击来源」继承当前上下文：已有会话取 store 里已解析的工作区
   * 绑定（含父会话链 / SSH，与 useWorkspace 同源），尚未解析时回落当前全局选中值
   * （不能把「未知」当成「未绑定」而误清）；草稿态沿用当前草稿工作区。
   */
  const handleStartNewSession = useCallback(() => {
    setDialogueMode(useDisplayPreferencesStore.getState().defaultDialogueMode);
    focusComposerWithText('');
    const resolvedWorkspace = resolveNewSessionWorkspace({
      contextSessionId: currentSessionId,
      activeSessionWorkspace: useUIStateStore.getState().activeSessionWorkspace,
      fallbackWorkspacePath: selectedWorkspacePath,
    });
    useUIStateStore
      .getState()
      .openDraftSession(resolvedWorkspace.workspacePath, resolvedWorkspace.sshConnectionId);
    if (currentSessionId) {
      void navigate('/chat');
    }
  }, [currentSessionId, focusComposerWithText, navigate, selectedWorkspacePath]);

  const appendTextToComposer = useCallback((text: string) => {
    setInput((previous) => {
      const separator = previous.length > 0 && !previous.endsWith(' ') ? ' ' : '';
      return `${previous}${separator}${text}`;
    });
    requestAnimationFrame(() => {
      if (!textareaRef.current) return;
      textareaRef.current.focus();
      const caret = textareaRef.current.value.length;
      textareaRef.current.setSelectionRange(caret, caret);
    });
  }, []);

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

  const {
    getCopyableMessageText,
    handleCopyMessage,
    handleCopyMessageGroup,
    handleEditRetryMessage,
    handleRetryMessage,
    findRetrySource,
    isHistoricalUserMessage,
    containsCodeMarkers,
    buildMessageActions,
  } = useChatMessageActions({
    messages,
    messageRatings,
    onToggleMessageRating: handleToggleMessageRating,
    setHistoryEditPrompt,
    setRetryPrompt,
  });

  const handleEditPreviousUserMessage = useCallback(() => {
    const previousUserMessage = [...messages].reverse().find((message) => message.role === 'user');
    if (!previousUserMessage) {
      return;
    }
    handleEditRetryMessage(previousUserMessage);
  }, [handleEditRetryMessage, messages]);

  const handleRetryLastFailedTurn = useCallback(() => {
    // Prefer the most recent assistant error / cancelled message as the
    // retry target; fall back to the latest user turn.
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (!message) continue;
      if (
        message.role === 'assistant' &&
        (message.status === 'error' ||
          message.status === 'cancelled' ||
          message.stopReason === 'error' ||
          message.stopReason === 'cancelled')
      ) {
        handleRetryMessage(message.id);
        return;
      }
    }
    const lastUser = [...messages].reverse().find((message) => message.role === 'user');
    if (lastUser) {
      handleRetryMessage(lastUser.id);
    }
  }, [handleRetryMessage, messages]);

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

  const appendImageGenerationSummaryMessage = useCallback(
    (input: {
      artifactTitle: string;
      messageSummary: string;
      modelId: string;
      providerId: string;
      revisedPrompt: string | null;
      sourcePrompt: string;
    }) => {
      const revisedPromptText = input.revisedPrompt?.trim();
      const content =
        revisedPromptText && revisedPromptText !== input.sourcePrompt.trim()
          ? `${input.messageSummary}\n结果：${input.artifactTitle}\n提示词改写：${revisedPromptText}\n已写入产物工作区。`
          : `${input.messageSummary}\n结果：${input.artifactTitle}\n已写入产物工作区。`;
      const createdAt = Date.now();

      setMessages((previous) => [
        ...previous,
        {
          id: makeOrderedMessageId(createdAt),
          role: 'assistant',
          content,
          createdAt,
          model: input.modelId,
          providerId: input.providerId,
          status: 'completed',
          tokenEstimate: estimateTokenCount(content),
        },
      ]);
    },
    [],
  );

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
        remoteSessionBusyState,
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
    );
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

  const handleRetryMcpServer = useCallback(
    (serverId: string) => {
      if (!token) return;
      setMcpServers((prev) =>
        prev.map((server) =>
          server.id === serverId
            ? { ...server, retryFeedback: { kind: 'pending' as const } }
            : server,
        ),
      );

      void (async () => {
        try {
          const data = (await createSettingsClient(gatewayUrl).retryMcpServer(token, serverId)) as {
            status: 'connected' | 'error' | 'disabled';
            toolCount: number;
            durationMs: number;
            error?: string;
          };
          setMcpServers((prev) =>
            prev.map((server) => {
              if (server.id !== serverId) return server;
              if (data.status === 'connected') {
                return {
                  ...server,
                  status: 'connected' as const,
                  toolCount: data.toolCount,
                  retryFeedback: {
                    kind: 'ok' as const,
                    toolCount: data.toolCount,
                    durationMs: data.durationMs,
                  },
                };
              }
              if (data.status === 'error') {
                return {
                  ...server,
                  status: 'error' as const,
                  retryFeedback: {
                    kind: 'fail' as const,
                    error: data.error ?? '未知错误',
                  },
                };
              }
              return {
                ...server,
                status: 'disabled' as const,
                retryFeedback: undefined,
              };
            }),
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          setMcpServers((prev) =>
            prev.map((server) =>
              server.id === serverId
                ? {
                    ...server,
                    status: 'error' as const,
                    retryFeedback: { kind: 'fail' as const, error: message },
                  }
                : server,
            ),
          );
        }
      })();
    },
    [gatewayUrl, setMcpServers, token],
  );

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
      openFileRef,
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
  /**
   * 回退（截断生效）后清理「子代理派生状态」：后端只删该回合的派生物（任务图节点 /
   * run events / 团队记录…），**子会话本身保留**；这里把属于被作废回合的子会话、
   * 任务与完成通知从展示中摘掉，避免回退后子代理信息仍挂在页面上。
   */
  const handleRollbackApplied = useCallback(
    (receipt: RollbackReceipt | null) => {
      const next = resolveRollbackDerivedState({
        receipt,
        childSessions,
        subagentNotices,
        sessionTasks,
      });
      const changed =
        next.childSessions.length !== childSessions.length ||
        next.sessionTasks.length !== sessionTasks.length ||
        next.subagentNotices.length !== subagentNotices.length;
      if (!changed) {
        return;
      }
      setChildSessions(next.childSessions);
      setSessionTasks(next.sessionTasks);
      setSubagentNotices(next.subagentNotices);
      setSelectedChildSessionId((previous) =>
        previous && next.removedChildSessionIds.includes(previous) ? null : previous,
      );
    },
    [childSessions, sessionTasks, subagentNotices],
  );

  const { handleRetryInCurrentSession, handleEditResendInCurrentSession, handleRetryInNewSession } =
    useChatRetryAndEdit({
      gatewayUrl,
      token,
      currentSessionId,
      messages,
      setMessages,
      resetStreamState,
      setStreamError,
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
      attachEligibilitySignatureRef,
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

  const [workspacePickerCreateMode, setWorkspacePickerCreateMode] = useState(false);
  /** 工作区选择弹窗来源：本地文件夹 / SSH 远端目录。 */
  const [workspacePickerSource, setWorkspacePickerSource] = useState<'local' | 'ssh'>('local');
  const [sshPickerConnections, setSshPickerConnections] = useState<SshPickerConnection[]>([]);
  const [sshPickerConnectionsLoading, setSshPickerConnectionsLoading] = useState(false);

  /**
   * 打开工作区选择弹窗。`create` 模式用于「新建工作空间」：弹窗打开后直接展开新建表单。
   */
  const openWorkspacePicker = useCallback(
    (mode: 'browse' | 'create' = 'browse') => {
      setWorkspacePickerCreateMode(mode === 'create');
      setWorkspacePickerSource('local');
      setShowWorkspaceSelector(true);
    },
    [setShowWorkspaceSelector],
  );

  /** 弹窗统一关闭：复位来源，避免下次打开停在 SSH 模式。 */
  const closeWorkspacePicker = useCallback(() => {
    setShowWorkspaceSelector(false);
    setWorkspacePickerSource('local');
  }, [setShowWorkspaceSelector]);

  /** 懒加载 SSH 连接列表（切到 SSH 来源时才拉取）。 */
  const loadSshPickerConnections = useCallback(async (): Promise<void> => {
    if (!token) {
      setSshPickerConnections([]);
      return;
    }
    setSshPickerConnectionsLoading(true);
    try {
      const connections = await createSshClient(gatewayUrl).list(token);
      setSshPickerConnections(connections);
    } catch (error: unknown) {
      toast(error instanceof Error ? error.message : '加载 SSH 连接失败', 'error');
      setSshPickerConnections([]);
    } finally {
      setSshPickerConnectionsLoading(false);
    }
  }, [gatewayUrl, token]);

  const switchWorkspacePickerToSsh = useCallback((): void => {
    setWorkspacePickerSource('ssh');
    void loadSshPickerConnections();
  }, [loadSshPickerConnections]);

  /**
   * 新建 SSH 连接：写入网关的 SSH 连接表（`POST /ssh/connections`）后刷新列表，
   * 下次打开工作区选择器即可直接选中，无需再进设置页录入。
   *
   * 保存成功后尽力自动连接一次，让用户立刻能浏览远端目录；自动连接失败
   * 不向上抛错（连接已入库），仅提示用户可在设置 → 工作区中重试连接。
   */
  const createSshPickerConnection = useCallback(
    async (draft: SshConnectionDraft): Promise<SshPickerConnection> => {
      if (!token) {
        throw new Error('未登录，无法保存 SSH 连接。');
      }

      const client = createSshClient(gatewayUrl);
      const created = await client.create(token, {
        name: draft.name,
        host: draft.host,
        port: draft.port,
        username: draft.username,
        authType: draft.authType,
        ...(draft.password ? { password: draft.password } : {}),
        ...(draft.authType === 'key' || draft.authType === 'key-password'
          ? draft.privateKey
            ? { privateKey: draft.privateKey, privateKeyPath: null }
            : draft.privateKeyPath
              ? { privateKeyPath: draft.privateKeyPath, privateKey: null }
              : {}
          : {}),
        ...(draft.passphrase ? { passphrase: draft.passphrase } : {}),
      });

      let resolved: SshPickerConnection = created;
      try {
        await client.connect(token, created.id);
        // connect 未抛错即视为握手成功（网关侧状态已更新为 connected）：
        // 新建接口返回的是创建时的状态，这里要按握手结果推进，
        // 否则弹窗会误判为「尚未连通」而不去读取远端目录。
        resolved = { ...created, status: 'connected' };
      } catch (error: unknown) {
        toast(
          `连接已保存，但自动连接失败：${error instanceof Error ? error.message : '未知错误'}`,
          'warning',
        );
      }

      await loadSshPickerConnections();
      return resolved;
    },
    [gatewayUrl, loadSshPickerConnections, token],
  );

  /**
   * 更新已有 SSH 连接的配置：PATCH 到网关后刷新列表。
   * 未提供的字段按「保留原值」处理，因此编辑表单里留空的密码不会清空已保存凭据。
   */
  const updateSshPickerConnection = useCallback(
    async (connectionId: string, draft: SshConnectionDraft): Promise<SshPickerConnection> => {
      if (!token) {
        throw new Error('未登录，无法更新 SSH 连接。');
      }

      const updated = await createSshClient(gatewayUrl).update(token, connectionId, {
        name: draft.name,
        host: draft.host,
        port: draft.port,
        username: draft.username,
        authType: draft.authType,
        ...(draft.password !== undefined ? { password: draft.password } : {}),
        ...(draft.authType === 'key' || draft.authType === 'key-password'
          ? draft.privateKey
            ? { privateKey: draft.privateKey, privateKeyPath: null }
            : draft.privateKeyPath
              ? { privateKeyPath: draft.privateKeyPath, privateKey: null }
              : {}
          : {}),
        ...(draft.passphrase ? { passphrase: draft.passphrase } : {}),
      });

      await loadSshPickerConnections();
      return updated;
    },
    [gatewayUrl, loadSshPickerConnections, token],
  );

  /** 测试连接：让网关实际握手一次远端（`/ssh/connections/:id/connect`），随后刷新列表同步状态。 */
  const testSshPickerConnection = useCallback(
    async (connectionId: string): Promise<void> => {
      if (!token) {
        throw new Error('未登录，无法测试 SSH 连接。');
      }

      await createSshClient(gatewayUrl).connect(token, connectionId);
      await loadSshPickerConnections();
    },
    [gatewayUrl, loadSshPickerConnections, token],
  );

  /**
   * 「调整绑定工作区」所有入口的统一收口：可调整时打开选择器；已锁定则提示并忽略，
   * 让文件树 / 侧栏里的切换入口在对话开始后自然失效。
   */
  const requestWorkspaceBindingChange = useCallback(() => {
    if (workspaceBindingLocked) {
      toast('会话已开始对话，工作区绑定已锁定', 'warning');
      return;
    }

    openWorkspacePicker('browse');
  }, [openWorkspacePicker, workspaceBindingLocked]);

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

  /**
   * 工作区绑定的统一落地点：草稿态只改本地选中值；已有会话（且绑定未锁定）时同步 PATCH 到网关。
   * 绑定锁兜底：即使入口在锁定后仍被触发，也不会修改已开始对话的会话。
   */
  const applyWorkspaceSelection = useCallback(
    async (path: string): Promise<void> => {
      const normalizedPath = path.trim();
      if (!normalizedPath) {
        return;
      }

      try {
        if (currentSessionId && canAdjustWorkspaceBinding) {
          await workspace.setWorkspace(normalizedPath);
        }
        addSavedWorkspacePath(normalizedPath);
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
      addSavedWorkspacePath,
      canAdjustWorkspaceBinding,
      currentSessionId,
      setFileTreeRootPath,
      setSelectedSshConnectionId,
      setSelectedWorkspacePath,
      workspace.setWorkspace,
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

  /** 「不绑定工作区」：解除当前绑定；已有会话时同步清空网关侧 metadata。 */
  const clearWorkspaceSelection = useCallback(async (): Promise<void> => {
    try {
      if (currentSessionId && canAdjustWorkspaceBinding) {
        await workspace.clearWorkspace();
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
    workspace.clearWorkspace,
  ]);

  /** 「打开本地文件夹」：桌面端调用原生选择器，浏览器端退化为完整浏览弹窗。 */
  const openLocalWorkspaceFolder = useCallback((): void => {
    if (!isTauriRuntime()) {
      openWorkspacePicker('browse');
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
  }, [applyWorkspaceSelection, openWorkspacePicker]);

  /** 「新建工作空间」：打开浏览弹窗并直接展开新建文件夹表单。 */
  const createWorkspaceFromComposer = useCallback((): void => {
    openWorkspacePicker('create');
  }, [openWorkspacePicker]);

  /**
   * 「连接 SSH 远端目录」：直接以 SSH 来源打开工作区选择弹窗，复用
   * SshWorkspacePickerModal 的连接选择 → 远端目录浏览 → 绑定流程。
   */
  const openSshWorkspaceFromComposer = useCallback((): void => {
    setWorkspacePickerCreateMode(false);
    setShowWorkspaceSelector(true);
    switchWorkspacePickerToSsh();
  }, [setShowWorkspaceSelector, switchWorkspacePickerToSsh]);

  /** 草稿态绑定的 SSH 连接摘要：供 composer 工作区菜单标注「远端执行」。 */
  const composerSshConnection = useMemo<ComposerSshConnectionSummary | null>(() => {
    if (!selectedSshConnectionId) {
      return null;
    }

    const matched = sshPickerConnections.find(
      (connection) => connection.id === selectedSshConnectionId,
    );
    if (!matched) {
      // 连接列表尚未加载（懒加载）时先给出通用标签，避免菜单显示成未绑定。
      return { id: selectedSshConnectionId, label: 'SSH 远端连接' };
    }

    const name = matched.name?.trim();
    return {
      id: matched.id,
      label: name && name.length > 0 ? name : `${matched.username}@${matched.host}:${matched.port}`,
    };
  }, [selectedSshConnectionId, sshPickerConnections]);

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
    defaultProviderId: savedChatDefaultsRef.current?.providerId,
    defaultModelId: savedChatDefaultsRef.current?.modelId,
    setActiveProviderId,
    setActiveModelId,
  });

  const handleFastModeToggle = useCallback(
    async (enabled: boolean): Promise<void> => {
      if (!token || !effectiveProviderId || activeProvider?.type !== 'openai') {
        throw new Error('当前没有可配置的 OpenAI Provider。');
      }

      await createSettingsClient(gatewayUrl).putProviderFastMode(token, {
        providerId: effectiveProviderId,
        enabled,
      });
      setProviders((current) =>
        current.map((provider) =>
          provider.id === effectiveProviderId
            ? { ...provider, openaiFastMode: enabled ? true : undefined }
            : provider,
        ),
      );
    },
    [activeProvider?.type, effectiveProviderId, gatewayUrl, token],
  );

  useEffect(() => {
    const normalizedThinkingState = normalizeChatThinkingState({
      providerType: activeProvider?.type,
      modelId: activeModelOption?.id ?? effectiveModelId,
      declaredSupportsThinking: activeModelOption?.supportsThinking === true,
      thinkingEnabled,
      reasoningEffort,
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
    activeProvider?.type,
    reasoningEffort,
    thinkingEnabled,
  ]);

  const {
    assistantUsageDetails,
    messageInputTokens,
    streamingOutputTokens,
    effectiveReportedStreamUsage,
    streamingUsageDetails,
    contextUsageSnapshot,
    effectiveContextMessageCount,
    sanitizedHistoricalMessages,
    hiddenMessageCount,
    historicalRenderedMessageEntries,
    streamingRenderedMessageEntry,
    historicalGroupedMessageEntries,
    groupedMessageEntries,
  } = useChatRenderData({
    messages,
    subagentNotices,
    pendingPermissions,
    modelPrices,
    activeProviderId: effectiveProviderId,
    activeModelId: effectiveModelId,
    activeModelOption,
    visibleStreaming,
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
    buildMessageActions: (message) => {
      const baseActions = buildMessageActions(message);
      const isBookmarked = bookmarkStore.isBookmarked(message.id);

      // 对于压缩消息，只返回基础操作（复制），不添加收藏和选择按钮
      const isCompaction = baseActions.length === 1 && baseActions[0]?.id === 'copy';
      if (isCompaction) {
        return baseActions;
      }

      return [
        ...baseActions,
        {
          id: 'bookmark',
          label: isBookmarked ? '⭐ 已收藏' : '☆ 收藏',
          onClick: () => {
            if (isBookmarked) {
              bookmarkStore.removeBookmark(message.id);
            } else {
              bookmarkStore.addBookmark({
                messageId: message.id,
                sessionId: currentSessionId ?? '',
                content: message.content.slice(0, 200),
                role: message.role,
              });
            }
          },
        },
        ...(multiSelect.multiSelect.enabled
          ? [
              {
                id: 'select',
                label: multiSelect.isSelected(message.id) ? '☑ 已选' : '☐ 选择',
                onClick: () => multiSelect.toggleMessage(message.id),
              },
            ]
          : []),
      ];
    },
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

  const chatSearch = useChatSearch({ messages, scrollRegionRef, ensureMessageVisible });

  // ─── 输入框下方统计栏数据 ──────────────────────────────────────────────
  const {
    composerStatsData,
    handleFusionContextCompactSession,
    handleFusionContextOpenRecoveryStrategy,
    fusionContextSessionStateStatus,
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
      onScrollToNextUser: () => {
        const region = scrollRegionRef.current;
        if (!region) return;
        const userMessages = region.querySelectorAll<HTMLElement>('[data-role="user"]');
        const regionRect = region.getBoundingClientRect();
        for (const el of Array.from(userMessages)) {
          const rect = el.getBoundingClientRect();
          if (rect.top > regionRect.top + 60) {
            el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            break;
          }
        }
      },
      onScrollToPrevUser: () => {
        const region = scrollRegionRef.current;
        if (!region) return;
        const userMessages = region.querySelectorAll<HTMLElement>('[data-role="user"]');
        const regionRect = region.getBoundingClientRect();
        const arr = Array.from(userMessages).reverse();
        for (const el of arr) {
          const rect = el.getBoundingClientRect();
          if (rect.bottom < regionRect.top + 60) {
            el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            break;
          }
        }
      },
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
      onToggleReviewPanel: () => {
        // 审查面板状态固定在共享 store（reviewPanelOpened / sidePanelActiveTab），
        // classic 布局与顶栏按钮走同一条路径（否则 Cmd/Ctrl+Shift+R 在 classic 是死键）。
        fusionChatLayout.toggleReviewPanel();
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
        currentUserEmail={currentUserEmail}
        editorMode={editorMode}
        hasStreamError={streamError !== null}
        idleSeconds={idleSeconds}
        input={input}
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
    pendingPermissions,
    resolveInlinePermissionActions,
    providerCatalog,
    activeProviderId: effectiveProviderId,
    activeModelId: effectiveModelId,
    activeModelLabel: activeModelOption?.label,
    onLoadEarlier: () => {
      const localHidden =
        sanitizedHistoricalMessages.length -
        (visibleMessageCount ?? sanitizedHistoricalMessages.length);
      if (localHidden > 0) {
        setVisibleMessageCount((prev) => prev + LOAD_MORE_MESSAGE_INCREMENT);
      } else if (currentSessionId) {
        void loadCurrentSessionSnapshot(currentSessionId, {
          replaceMessages: true,
        })
          .then(() => {
            setServerTotalTurnCount(null);
            setVisibleMessageCount((prev) => prev + LOAD_MORE_MESSAGE_INCREMENT);
          })
          .catch(() => undefined);
      }
    },
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
      });
      setActiveProviderId(pid);
      setActiveModelId(mid);
      setThinkingEnabled(normalizedThinkingState.thinkingEnabled);
      setReasoningEffort(normalizedThinkingState.reasoningEffort);
      sessionModelSelectionSourceRef.current = 'manual';
      markSessionMetadataDirty();
    },
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
            <WorkspacePickerModal
              isOpen={showWorkspaceSelector && workspacePickerSource === 'local'}
              onClose={closeWorkspacePicker}
              onSelect={async (path) => {
                // 绑定锁兜底：即使选择器被其它入口打开，已开始对话的会话也不允许改绑。
                if (currentSessionId && canAdjustWorkspaceBinding) {
                  await workspace.setWorkspace(path);
                }
                // 选择本地工作区即清理 SSH 草稿连接。
                setSelectedSshConnectionId(null);
                addSavedWorkspacePath(path);
                setSelectedWorkspacePath(path);
                setFileTreeRootPath(path);
                closeWorkspacePicker();
              }}
              fetchRootPath={workspace.fetchRootPath}
              fetchWorkspaceRoots={workspace.fetchWorkspaceRoots}
              fetchTree={workspace.fetchTree}
              createDirectory={workspace.createDirectory}
              initialPath={effectiveWorkingDirectory ?? undefined}
              initialCreateMode={workspacePickerCreateMode}
              validatePath={workspace.validatePath}
              loading={workspace.loading}
              onSwitchToSshSource={switchWorkspacePickerToSsh}
            />
            <SshWorkspacePickerModal
              isOpen={showWorkspaceSelector && workspacePickerSource === 'ssh'}
              onClose={closeWorkspacePicker}
              connections={sshPickerConnections}
              loadingConnections={sshPickerConnectionsLoading}
              onSelect={applySshWorkspaceSelection}
              fetchTree={workspace.fetchSshTree}
              createDirectory={workspace.createSshDirectory}
              onSwitchToLocalSource={() => setWorkspacePickerSource('local')}
              onCreateConnection={createSshPickerConnection}
              onUpdateConnection={updateSshPickerConnection}
              onTestConnection={testSshPickerConnection}
              initialConnectionId={selectedSshConnectionId}
            />
            <LatestAssistantMessageContext value={latestAssistantMessageId}>
              <FusionChatRegion model={conversationViewModel} />
            </LatestAssistantMessageContext>
          </SessionPanelFrame>
        </FusionChatMainShell>
      ) : (
        <>
          <WorkspacePickerModal
            isOpen={showWorkspaceSelector && workspacePickerSource === 'local'}
            onClose={closeWorkspacePicker}
            onSelect={async (path) => {
              // 绑定锁兜底：即使选择器被其它入口打开，已开始对话的会话也不允许改绑。
              if (currentSessionId && canAdjustWorkspaceBinding) {
                await workspace.setWorkspace(path);
              }
              // 选择本地工作区即清理 SSH 草稿连接。
              setSelectedSshConnectionId(null);
              addSavedWorkspacePath(path);
              setSelectedWorkspacePath(path);
              setFileTreeRootPath(path);
              closeWorkspacePicker();
            }}
            fetchRootPath={workspace.fetchRootPath}
            fetchWorkspaceRoots={workspace.fetchWorkspaceRoots}
            fetchTree={workspace.fetchTree}
            createDirectory={workspace.createDirectory}
            initialPath={effectiveWorkingDirectory ?? undefined}
            initialCreateMode={workspacePickerCreateMode}
            validatePath={workspace.validatePath}
            loading={workspace.loading}
            onSwitchToSshSource={switchWorkspacePickerToSsh}
          />
          <SshWorkspacePickerModal
            isOpen={showWorkspaceSelector && workspacePickerSource === 'ssh'}
            onClose={closeWorkspacePicker}
            connections={sshPickerConnections}
            loadingConnections={sshPickerConnectionsLoading}
            onSelect={applySshWorkspaceSelection}
            fetchTree={workspace.fetchSshTree}
            createDirectory={workspace.createSshDirectory}
            onSwitchToLocalSource={() => setWorkspacePickerSource('local')}
            onCreateConnection={createSshPickerConnection}
            onUpdateConnection={updateSshPickerConnection}
            onTestConnection={testSshPickerConnection}
            initialConnectionId={selectedSshConnectionId}
          />
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
                    workspacePath={effectiveWorkingDirectory}
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
