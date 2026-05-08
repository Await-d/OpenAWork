import type {
  CommandResultCard,
  InputImageContent,
  Message,
  RunEvent,
  StreamThinkingChunk,
} from '@openAwork/shared';
import type { AttachmentItem, MCPServerStatus } from '@openAwork/shared-ui';
import type {
  PendingPermissionRequest,
  PendingQuestionRequest,
  PermissionDecision,
  Session,
  SessionActiveStream,
  SessionMessageRatingRecord,
  SessionMessageRatingValue,
  SessionRecoveryReadModel,
  SessionTask,
} from '@openAwork/web-client';
import {
  createPendingPermissionRequestSnapshot,
  createQuestionsClient,
  createSessionsClient,
  createWorkflowsClient,
  dedupePendingPermissionRequests,
} from '@openAwork/web-client';
import React, { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { useFileEditorContext } from '../App.js';
import { usePageActivation } from '../components/CachedRouteOutlet.js';
import { ChatComposer } from '../components/chat/ChatComposer.js';
import { ChatImageGenerationResultStrip } from '../components/chat/ChatImageGenerationResultStrip.js';
import {
  ModelPicker,
  ModelSettingsPopover,
  renderChatMessageContentWithOptions,
  renderStreamingChatMessageContentWithOptions,
  sharedUiThemeVars,
  WelcomeScreen,
} from '../components/chat/ChatPageSections.js';
import { ChatTopBar } from '../components/chat/ChatTopBar.js';
import {
  ChatMessageGroupList,
  type ChatRenderEntry,
  type ChatRenderGroup,
} from '../components/chat/chat-message-group-list.js';
import { ChatRemoteStreamPlaceholder } from '../components/chat/chat-remote-stream-placeholder.js';
import { ChatSearchOverlay, useChatSearch } from '../components/chat/chat-search-overlay.js';
import { ChatSessionSkeleton } from '../components/chat/chat-session-skeleton.js';
import { CompanionStage } from '../components/chat/companion/companion-stage.js';
import { InlineQuestionPanel } from '../components/chat/InlineQuestionPanel.js';
import { toast } from '../components/ToastNotification.js';
import WorkspacePickerModal from '../components/WorkspacePickerModal.js';
import { useCommandRegistry } from '../hooks/useCommandRegistry.js';
import { useComposerWorkspaceCatalog } from '../hooks/useComposerWorkspaceCatalog.js';
import { useFileEditor } from '../hooks/useFileEditor.js';
import { useGatewayClient } from '../hooks/useGatewayClient.js';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion.js';
import { useWorkspace } from '../hooks/useWorkspace.js';
import { useAuthStore } from '../stores/auth.js';
import { useChatQueueStore } from '../stores/chat-queue.js';
import { useUIStateStore } from '../stores/uiState.js';
import {
  type ChatSettingsProvider,
  loadSavedChatSessionDefaults,
} from '../utils/chat-session-defaults.js';
import {
  COMPOSER_REFERENCE_EVENT_NAME,
  isComposerReferenceEvent,
} from '../utils/composer-reference-events.js';
import { logger } from '../utils/logger.js';
import {
  getPermissionReplyStatusCode,
  getPermissionReplySuccessMessage,
  replyPermissionRequest,
} from '../utils/permission-reply.js';
import {
  publishSessionPendingPermission,
  publishSessionPendingQuestion,
  requestCurrentSessionRefresh,
  requestSessionListRefresh,
  subscribeCurrentSessionRefresh,
} from '../utils/session-list-events.js';
import { extractWorkingDirectory } from '../utils/session-metadata.js';
import {
  shouldAttemptAttachToSession,
  shouldResetAttachAttempt,
} from './chat-page/attach-stream-eligibility.js';
import { handleInterruptedAttachStream } from './chat-page/attach-stream-reconnect.js';
import { createAttachStreamReconnectWiring } from './chat-page/attach-stream-reconnect-wiring.js';
import {
  appendAttachmentSummary,
  buildUploadedAttachmentSummaryLine,
  uploadChatAttachments,
} from './chat-page/attachment-upload.js';
import { ChatEditorPane } from './chat-page/chat-editor-pane.js';
import {
  buildQueuedComposerScopeKey,
  buildRightPanelStateFromSessionSnapshot,
  CHAT_SCROLL_BOTTOM_PADDING,
  CHAT_SCROLL_BOTTOM_SPACER_HEIGHT,
  createSessionMetadataSnapshot,
  deriveLatestUserGoal,
  isImmediatelyRenderableStructuredContent,
  type LiveToolCallState,
  normalizeModelLookupKey,
  type PreparedSessionRecoveryState,
  prepareSessionRecoveryState,
  REMOTE_STREAM_RECOVERY_POLL_MS,
  SESSION_SWITCH_DEFER_THRESHOLD,
  type SessionsClientWithActiveStop,
} from './chat-page/chat-page-utils.js';
import { ChatRightPanel } from './chat-page/chat-right-panel.js';
import { ChatScrollBottomButton } from './chat-page/chat-scroll-bottom-button.js';
import { ChatStreamErrorBar } from './chat-page/chat-stream-error-bar.js';
import { ChatTodoBar } from './chat-page/chat-todo-bar.js';
import HistoryEditDialog from './chat-page/history-edit-dialog.js';
import {
  type ImageEditReferenceArtifact,
  toImageEditReferenceArtifacts,
} from './chat-page/image-edit-reference-artifacts.js';
import { makeOrderedMessageId } from './chat-page/ordered-id.js';
import { isAutoAcceptEnabled } from './chat-page/permission-auto-respond.js';
import {
  deleteQueuedComposerFiles,
  restoreQueuedComposerFiles,
} from './chat-page/queued-composer-file-store.js';
import {
  createQueuedComposerPreview,
  hydrateQueuedComposerMessage,
  type QueuedComposerMessage,
  toPersistedQueuedComposerMessage,
} from './chat-page/queued-composer-state.js';
import RetryModeDialog from './chat-page/retry-mode-dialog.js';
import { startSequentialPolling } from './chat-page/sequential-polling.js';
import { executeServerCommand } from './chat-page/server-command-item.js';
import {
  SessionRunStateBar,
  SessionRunStatePlaceholder,
} from './chat-page/session-run-state-bar.js';
import {
  flattenSessionTodoLanes,
  type SessionStateStatus,
  type SessionTodoItem,
  shouldPollSessionRuntime,
  toSessionPendingPermissionState,
} from './chat-page/session-runtime.js';
import {
  type RecoveredActiveAssistantStream,
  recoverActiveAssistantStream,
} from './chat-page/stream-recovery.js';
import {
  type ChatBackendUsageSnapshot,
  mergeChatBackendUsageSnapshot,
} from './chat-page/stream-usage.js';
import {
  appendStreamingTextDelta,
  appendStreamingThinkingDelta,
  applyToolResultToStreamingSegment,
  markStreamingReasoningSegmentEnded,
  segmentsFromRecoverySnapshot,
  upsertStreamingToolSegment,
} from './chat-page/streaming-segments.js';
import {
  appendStreamingThinkingChunk,
  extractStreamingThinkingDurations,
  extractStreamingThinkingEndedFlags,
  extractStreamingThinkingTexts,
  joinStreamingThinkingTexts,
  markStreamingThinkingChunkEnded,
  type StreamingThinkingBlock,
} from './chat-page/streaming-thinking.js';
import { buildSubAgentRunItems, SubAgentRunList } from './chat-page/sub-agent-run-list.js';
import { SubSessionDetailPanel } from './chat-page/sub-session-detail-panel.js';
import {
  type AssistantTraceToolCall,
  applyPermissionDecisionToLocalAssistantMessages,
  applyToolResultToLocalAssistantMessages,
  type ChatMessage,
  type ChatMessagePart,
  type ComposerMenuState,
  createAssistantTraceContent,
  detectComposerTrigger,
  dismissPermissionEventMessage,
  estimateTokenCount,
  hasActivePendingPermissionRequest,
  matchClientSlashCommand,
  matchServerSlashCommand,
  normalizeChatMessages,
  parseAssistantTraceContent,
  parseSessionModeMetadata,
  parseToolCallInputText,
  partsFromAssistantTrace,
  type ReasoningEffort,
  reconcileSnapshotChatMessages,
  replaceOrAppendStreamedAssistantMessage,
  sanitizeComposerPlainText,
  upsertPermissionEventMessage,
  type WorkspaceFileMentionItem,
} from './chat-page/support.js';
import {
  buildTaskToolRuntimeLookup,
  buildTerminalTaskSyncMarker,
  resolveTaskToolRuntimeSnapshot,
} from './chat-page/task-tool-runtime.js';
import { detectThinkKeyword } from './chat-page/think-keyword-detector.js';
import {
  filterTranscriptMessages,
  shouldShowRunEventInTranscript,
} from './chat-page/transcript-visibility.js';
import { useAssistantMessageProcessing } from './chat-page/use-assistant-message-processing.js';
import { useChatDataLoaders } from './chat-page/use-chat-data-loaders.js';
import type { SessionImageGenerationResponse } from './chat-page/use-chat-image-generation.js';
import { useChatImageGeneration } from './chat-page/use-chat-image-generation.js';
import {
  type HistoryEditPrompt,
  type RetryPrompt,
  useChatMessageActions,
} from './chat-page/use-chat-message-actions.js';
import { useChatRenderData } from './chat-page/use-chat-render-data.js';
import { useChatUiActions } from './chat-page/use-chat-ui-actions.js';
import { useComposerCallbacks } from './chat-page/use-composer-callbacks.js';
import { useComposerMenuItems } from './chat-page/use-composer-menu-items.js';
import { useComposerQueue } from './chat-page/use-composer-queue.js';
import { useModelPrices } from './chat-page/use-model-prices.js';
import { useProviderModelInfo } from './chat-page/use-provider-model-info.js';
import { useScrollManager } from './chat-page/use-scroll-manager.js';
import { useSessionContentArtifactCount } from './chat-page/use-session-content-artifact-count.js';
import { useSessionSettingsCallbacks } from './chat-page/use-session-settings-callbacks.js';
import { useSessionSidebarRunState } from './chat-page/use-session-sidebar-run-state.js';
import { useSessionSnapshotLoader } from './chat-page/use-session-snapshot-loader.js';
import { type SessionArtifactsResponse } from './artifacts/artifact-workspace-types.js';
import {
  type SessionViewStreamingSnapshot,
  useSessionViewCache,
} from './chat-page/use-session-view-cache.js';
import { useSessionViewGuard } from './chat-page/use-session-view-guard.js';
import { useStreamAttachRetry } from './chat-page/use-stream-attach-retry.js';
import { useStreamReveal } from './chat-page/use-stream-reveal.js';
import {
  applyChatRightPanelChunk,
  applyChatRightPanelEvent,
  buildChatRightPanelStateFromRunEvents,
  type ChatRightPanelState,
  clearResolvedPendingPermissionToolCalls,
  createInitialChatRightPanelState,
  getToolCallCards,
  startChatRightPanelRun,
} from './chat-stream-state.js';
import { type DialogueMode, getDefaultAgentForDialogueMode } from './dialogue-mode.js';

const DEFAULT_VISIBLE_MESSAGE_COUNT = 20;
const LOAD_MORE_MESSAGE_INCREMENT = 20;
const INITIAL_TURN_LIMIT = 10;

export default function ChatPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const isPageActive = usePageActivation();
  const token = useAuthStore((s) => s.accessToken);
  const gatewayUrl = useAuthStore((s) => s.gatewayUrl);

  const [currentSessionId, setCurrentSessionId] = useState<string | null>(sessionId ?? null);
  const workspace = useWorkspace(currentSessionId);
  const [showWorkspaceSelector, setShowWorkspaceSelector] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messageRatings, setMessageRatings] = useState<Record<string, SessionMessageRatingRecord>>(
    {},
  );
  const [activeProviderId, setActiveProviderId] = useState<string>('');
  const [activeModelId, setActiveModelId] = useState<string>('');
  const currentUserEmail = useAuthStore((s) => s.email) ?? '';
  const [providers, setProviders] = useState<ChatSettingsProvider[]>([]);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [showModelSettings, setShowModelSettings] = useState(false);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [stoppingStream, setStoppingStream] = useState(false);
  const [streamBuffer, setStreamBuffer] = useState('');
  const [streamThinkingBuffer, setStreamThinkingBuffer] = useState('');
  const [streamThinkingBlocks, setStreamThinkingBlocks] = useState<StreamingThinkingBlock[]>([]);
  // Ordered live-stream parts (reasoning / text / tool) preserving the wire
  // arrival sequence. Drives both the live render (so interleaving like
  // tool → text → tool is faithful) and the per-round commit message so the
  // committed messages match the gateway's ordered persistence. Empty when
  // there is no active stream.
  const [streamingSegments, setStreamingSegments] = useState<ChatMessagePart[]>([]);
  const [reportedStreamUsage, setReportedStreamUsage] = useState<ChatBackendUsageSnapshot | null>(
    null,
  );
  const [recoveryActiveStream, setRecoveryActiveStream] = useState<SessionActiveStream | null>(
    null,
  );
  const [recoveredStreamSnapshot, setRecoveredStreamSnapshot] =
    useState<RecoveredActiveAssistantStream | null>(null);
  const [activeStreamStartedAt, setActiveStreamStartedAt] = useState<number | null>(null);
  const [activeStreamFirstTokenLatencyMs, setActiveStreamFirstTokenLatencyMs] = useState<
    number | null
  >(null);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const contentColumnRef = useRef<HTMLDivElement>(null);
  const scrollRegionRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingScrollFrameRef = useRef<number | null>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  messagesRef.current = messages;
  const pendingSessionNormalizeTimeoutRef = useRef<number | null>(null);
  const activeSessionRef = useRef<string | null>(sessionId ?? null);
  const currentLoadedSessionIdRef = useRef<string | null>(currentSessionId);
  const sessionViewEpochRef = useRef(0);
  const currentSessionViewRef = useRef<{
    epoch: number;
    sessionId: string | null;
  }>({
    epoch: 0,
    sessionId: sessionId ?? null,
  });
  const lastParentTaskSyncMarkerRef = useRef<string | null>(null);
  const pendingBootstrapSessionRef = useRef<string | null>(null);
  const previousRouteSessionIdRef = useRef<string | null>(sessionId ?? null);
  const hasAppliedSavedImageDefaultsRef = useRef(false);
  const savedChatDefaultsRef = useRef<{
    modelId: string;
    providerId: string;
    reasoningEffort: ReasoningEffort;
    thinkingEnabled: boolean;
  } | null>(null);

  const [rightTab, setRightTab] = useState<
    'overview' | 'plan' | 'tools' | 'viz' | 'history' | 'mcp' | 'agent'
  >('overview');
  const [toolFilter, setToolFilter] = useState<'all' | 'lsp' | 'file' | 'network' | 'other'>('all');
  const [mcpServers, setMcpServers] = useState<MCPServerStatus[]>([]);
  const [rightOpen, setRightOpen] = useState(false);
  const [companionPanelSignal, setCompanionPanelSignal] = useState(0);
  const [dialogueMode, setDialogueMode] = useState<DialogueMode>('coding');
  const [manualAgentId, setManualAgentId] = useState('');
  const [yoloMode, setYoloMode] = useState(false);
  const [webSearchEnabled, setWebSearchEnabled] = useState(true);
  const [thinkingEnabled, setThinkingEnabled] = useState(false);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>('medium');
  const [attachmentItems, setAttachmentItems] = useState<AttachmentItem[]>([]);
  const [showVoice, setShowVoice] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [queuedComposerMessages, setQueuedComposerMessages] = useState<QueuedComposerMessage[]>([]);
  const [sessionReloadNonce, setSessionReloadNonce] = useState(0);
  const [hasPendingFollowContent, setHasPendingFollowContent] = useState(false);
  const [isSessionLoading, setIsSessionLoading] = useState(false);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [visibleMessageCount, setVisibleMessageCount] = useState(DEFAULT_VISIBLE_MESSAGE_COUNT);
  const [serverTotalTurnCount, setServerTotalTurnCount] = useState<number | null>(null);
  const modelPrices = useModelPrices(gatewayUrl, token);
  const [rightPanelState, setRightPanelState] = useState(() => createInitialChatRightPanelState());
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
  const [childSessions, setChildSessions] = useState<Session[]>([]);
  const [selectedChildSessionId, setSelectedChildSessionId] = useState<string | null>(null);
  const [sessionTodos, setSessionTodos] = useState<SessionTodoItem[]>([]);
  const [sessionTasks, setSessionTasks] = useState<SessionTask[]>([]);
  const [pendingPermissions, setPendingPermissions] = useState<PendingPermissionRequest[]>([]);
  const [pendingQuestions, setPendingQuestions] = useState<PendingQuestionRequest[]>([]);
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
  const [inlineQuestionAnswers, setInlineQuestionAnswers] = useState<string[][]>([]);
  const [inlineQuestionCustomInputs, setInlineQuestionCustomInputs] = useState<string[]>([]);
  const [inlineQuestionReplyStatus, setInlineQuestionReplyStatus] = useState<
    'answered' | 'dismissed' | null
  >(null);
  const [inlineQuestionReplyError, setInlineQuestionReplyError] = useState<string | null>(null);
  const [inlinePermissionPendingDecision, setInlinePermissionPendingDecision] = useState<{
    decision: PermissionDecision;
    requestId: string;
  } | null>(null);
  const [inlinePermissionErrors, setInlinePermissionErrors] = useState<Record<string, string>>({});
  const [sessionStateStatus, setSessionStateStatus] = useState<SessionStateStatus | null>(null);
  const [isSessionSnapshotReady, setIsSessionSnapshotReady] = useState(false);
  const sessionMetadataDirtyRef = useRef(false);
  const sessionRestoredFromCacheRef = useRef(false);
  const [historyEditPrompt, setHistoryEditPrompt] = useState<HistoryEditPrompt | null>(null);
  const [, startSessionSwitchTransition] = useTransition();
  const [retryPrompt, setRetryPrompt] = useState<RetryPrompt | null>(null);
  const [sessionModesHydrated, setSessionModesHydrated] = useState(false);
  const [sessionMetadataDirty, setSessionMetadataDirty] = useState(false);
  const [workspaceFileItems, setWorkspaceFileItems] = useState<WorkspaceFileMentionItem[]>([]);
  const [composerMenu, setComposerMenu] = useState<ComposerMenuState>(null);
  const modelPickerBtnRef = useRef<HTMLButtonElement>(null);
  const modelSettingsBtnRef = useRef<HTMLButtonElement>(null);
  const lastPersistedSessionMetadataSnapshotRef = useRef<string | null>(null);
  const composerCommandDescriptors = useCommandRegistry('composer');
  const prefersReducedMotion = usePrefersReducedMotion();
  const editorMode = useUIStateStore((s) => s.editorMode);
  const setEditorMode = useUIStateStore((s) => s.setEditorMode);
  const splitPos = useUIStateStore((s) => s.splitPos);
  const setSplitPos = useUIStateStore((s) => s.setSplitPos);
  const navigateToHome = useUIStateStore((s) => s.navigateToHome);
  const navigateToSession = useUIStateStore((s) => s.navigateToSession);
  const chatView = useUIStateStore((s) => s.chatView);
  const workspaceTreeVersion = useUIStateStore((s) => s.workspaceTreeVersion);
  const selectedWorkspacePath = useUIStateStore((s) => s.selectedWorkspacePath);
  const setSelectedWorkspacePath = useUIStateStore((s) => s.setSelectedWorkspacePath);
  const addSavedWorkspacePath = useUIStateStore((s) => s.addSavedWorkspacePath);
  const setFileTreeRootPath = useUIStateStore((s) => s.setFileTreeRootPath);
  const setLastChatPath = useUIStateStore((s) => s.setLastChatPath);
  const splitDragging = useRef(false);
  const rightOpenRef = useRef(rightOpen);
  const queueFlushInFlightRef = useRef(false);
  const queueHydratingRef = useRef(false);
  const {
    streamRevealTargetRef,
    streamRevealVisibleRef,
    streamRevealTargetCodePointsRef,
    streamRevealVisibleCodePointCountRef,
    streamRevealNextAllowedAtRef,
    pendingStreamRevealFrameRef,
    streamingRef,
    stoppingStreamRef,
    currentAssistantStreamMessageIdRef,
    resetStreamState,
    scheduleStreamReveal,
  } = useStreamReveal(prefersReducedMotion, {
    setStreamBuffer,
    setStreamThinkingBuffer,
    setStreamThinkingBlocks,
    setStreamingSegments,
    setRecoveredStreamSnapshot,
    setStreaming,
    setStoppingStream,
    setActiveStreamStartedAt,
    setActiveStreamFirstTokenLatencyMs,
  });
  const attachAttemptedSessionRef = useRef<string | null>(null);
  // Tracks the last logged attach-eligibility signature so the diagnostic
  // [ATTACH_ELIGIBILITY] line in the effect below only prints when the
  // decision-relevant inputs actually change (not on every token delta).
  const attachEligibilitySignatureRef = useRef<string | null>(null);
  const { attachRetryNonce, cancelAttachRetry, scheduleAttachRetry } = useStreamAttachRetry();
  const sessionViewCache = useSessionViewCache();
  const { activateSessionView, isCurrentSessionView, isCurrentSessionRequest } =
    useSessionViewGuard({
      activeSessionRef,
      sessionViewEpochRef,
      currentSessionViewRef,
    });
  const sendMessageRef = useRef<
    (
      overrideText?: string,
      options?: {
        forcedSessionId?: string;
        queuedAttachmentItems?: AttachmentItem[];
        queuedFiles?: File[];
        queuedMessageId?: string;
      },
    ) => Promise<boolean>
  >(async () => false);
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const editorPaneRef = useRef<HTMLDivElement>(null);
  const fileEditor = useFileEditor();
  const [saving, setSaving] = useState(false);
  const openFileRef = useFileEditorContext();
  const replacePersistedQueue = useChatQueueStore((state) => state.replaceQueue);
  const effectiveWorkingDirectory = currentSessionId
    ? workspace.workingDirectory
    : selectedWorkspacePath;
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
  const composerWorkspaceCatalog = useComposerWorkspaceCatalog(Boolean(token));
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

  const {
    buildSessionMetadata,
    markSessionMetadataDirty,
    clearSessionMetadataDirty,
    handleDialogueModeChange,
    handleToggleYolo,
    handleToggleWebSearch,
    handleThinkingEnabledChange,
    handleReasoningEffortChange,
    handleManualAgentChange,
    handleClearManualAgentId,
  } = useSessionSettingsCallbacks(
    {
      dialogueMode,
      yoloMode,
      webSearchEnabled,
      thinkingEnabled,
      reasoningEffort,
      activeProviderId,
      activeModelId,
      manualAgentId,
      effectiveWorkingDirectory,
      sessionMetadataDirty,
      sessionMetadataDirtyRef,
    },
    {
      setDialogueMode,
      setYoloMode,
      setWebSearchEnabled,
      setThinkingEnabled,
      setReasoningEffort,
      setManualAgentId,
      setSessionMetadataDirty,
    },
    gatewayUrl,
    token,
  );

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

  useEffect(() => {
    activeSessionRef.current = sessionId ?? currentSessionId ?? null;
    currentLoadedSessionIdRef.current = currentSessionId;
    lastParentTaskSyncMarkerRef.current = null;
  }, [currentSessionId, sessionId]);

  useEffect(() => {
    let cancelled = false;
    queueHydratingRef.current = true;
    queueFlushInFlightRef.current = false;

    const persistedQueue = queuedComposerScope
      ? (useChatQueueStore.getState().queuesByScope[queuedComposerScope] ?? [])
      : [];

    const finishHydration = (items: QueuedComposerMessage[]) => {
      if (cancelled) {
        return;
      }
      setQueuedComposerMessages(items);
      queueHydratingRef.current = false;
    };

    if (!queuedComposerScope || persistedQueue.length === 0) {
      finishHydration([]);
      return () => {
        cancelled = true;
      };
    }

    void Promise.all(
      persistedQueue.map(async (item) => {
        const hydratedItem = hydrateQueuedComposerMessage(item);
        if (item.attachmentItems.length === 0) {
          return hydratedItem;
        }

        const restoredFiles = await restoreQueuedComposerFiles({
          attachmentItems: item.attachmentItems,
          queueId: item.id,
          scope: queuedComposerScope,
        });

        if (restoredFiles.restored) {
          return {
            ...hydratedItem,
            files: restoredFiles.files,
            requiresAttachmentRebind: false,
          } satisfies QueuedComposerMessage;
        }

        return {
          ...hydratedItem,
          requiresAttachmentRebind:
            hydratedItem.requiresAttachmentRebind || item.attachmentItems.length > 0,
        } satisfies QueuedComposerMessage;
      }),
    )
      .then((items) => {
        finishHydration(items);
      })
      .catch(() => {
        finishHydration(
          persistedQueue.map((item) => ({
            ...hydrateQueuedComposerMessage(item),
            requiresAttachmentRebind:
              item.requiresAttachmentRebind || item.attachmentItems.length > 0,
          })),
        );
      });

    return () => {
      cancelled = true;
    };
  }, [queuedComposerScope]);

  useEffect(() => {
    if (!queuedComposerScope) {
      return;
    }

    if (queueHydratingRef.current) {
      queueHydratingRef.current = false;
      return;
    }

    replacePersistedQueue(
      queuedComposerScope,
      queuedComposerMessages.map((item) => toPersistedQueuedComposerMessage(item)),
    );
  }, [queuedComposerMessages, queuedComposerScope, replacePersistedQueue]);

  useEffect(() => {
    return subscribeCurrentSessionRefresh((targetSessionId) => {
      if (targetSessionId === activeSessionRef.current) {
        setSessionReloadNonce((value) => value + 1);
      }
    });
  }, []);

  useEffect(() => {
    rightOpenRef.current = rightOpen;
  }, [rightOpen]);

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
  }, [currentSessionId]);

  useEffect(() => {
    if (!currentSessionId || !token) {
      setSessionImageEditReferenceArtifacts([]);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    void fetch(`${gatewayUrl}/sessions/${currentSessionId}/artifacts`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        return (await response.json()) as SessionArtifactsResponse;
      })
      .then((payload) => {
        if (cancelled) {
          return;
        }

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

  const { planTasks, agentEvents, planHistory, dagNodes, dagEdges, compactions } = rightPanelState;
  const toolCallCards = useMemo(() => getToolCallCards(rightPanelState), [rightPanelState]);
  const client = useGatewayClient(token);
  const taskToolRuntimeLookup = useMemo(
    () => buildTaskToolRuntimeLookup(childSessions, sessionTasks),
    [childSessions, sessionTasks],
  );
  const subAgentRunItems = useMemo(
    () => buildSubAgentRunItems(childSessions, sessionTasks),
    [childSessions, sessionTasks],
  );
  const openChildSessionInspector = useCallback((nextSessionId: string) => {
    setSelectedChildSessionId(nextSessionId);
    setRightOpen(true);
    setRightTab('agent');
  }, []);

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

    return { defaults, imageDefaults, providers: loadedProviders };
  }, [gatewayUrl, token]);

  useEffect(() => {
    if (subAgentRunItems.length === 0) {
      if (selectedChildSessionId !== null) {
        setSelectedChildSessionId(null);
      }
      if (rightTab === 'agent') {
        setRightTab('overview');
      }
      return;
    }

    if (
      selectedChildSessionId &&
      subAgentRunItems.some((item) => item.sessionId === selectedChildSessionId)
    ) {
      return;
    }

    const runningCandidate =
      subAgentRunItems.find((item) => item.status === 'running' || item.status === 'pending') ??
      subAgentRunItems[0];
    const nextId = runningCandidate?.sessionId ?? null;
    if (nextId !== selectedChildSessionId) {
      setSelectedChildSessionId(nextId);
    }
  }, [rightTab, selectedChildSessionId, subAgentRunItems]);

  useEffect(() => {
    if (subAgentRunItems.length < 2) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.altKey || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) {
        return;
      }

      event.preventDefault();
      const currentIndex = subAgentRunItems.findIndex(
        (item) => item.sessionId === selectedChildSessionId,
      );
      const safeIndex = currentIndex === -1 ? 0 : currentIndex;
      const nextIndex =
        event.key === 'ArrowDown'
          ? (safeIndex + 1) % subAgentRunItems.length
          : (safeIndex - 1 + subAgentRunItems.length) % subAgentRunItems.length;
      const nextItem = subAgentRunItems[nextIndex];
      if (!nextItem) {
        return;
      }

      setSelectedChildSessionId(nextItem.sessionId);
      setRightOpen(true);
      setRightTab('agent');
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectedChildSessionId, subAgentRunItems]);

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
        setPendingPermissions,
        setPendingQuestions,
        setSessionStateStatus,
        setRecoveryActiveStream,
        setRecoveredStreamSnapshot,
        setIsSessionSnapshotReady,
      },
    );

  const remoteSessionBusyState = useMemo<Extract<
    SessionStateStatus,
    'running' | 'paused'
  > | null>(() => {
    if (streaming) {
      return null;
    }

    if (sessionStateStatus === 'running' || sessionStateStatus === 'paused') {
      return sessionStateStatus;
    }

    if (recoveryActiveStream !== null) {
      return 'running';
    }

    return null;
  }, [recoveryActiveStream, sessionStateStatus, streaming]);
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
  const visibleReportedStreamUsage = reportedStreamUsage ?? recoveredStreamSnapshot?.usage ?? null;
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
      ? segmentsFromRecoverySnapshot(
          recoveredStreamSnapshot.messageId ?? '__recovery__',
          recoveredStreamSnapshot.thinkingBlocks ?? [],
          recoveredStreamSnapshot.text ?? '',
        )
      : [];
  const activeStreamMessageId =
    currentAssistantStreamMessageIdRef.current ?? recoveredStreamSnapshot?.messageId ?? null;
  const queuedComposerPreviews = useMemo(
    () => queuedComposerMessages.map((item) => createQueuedComposerPreview(item)),
    [queuedComposerMessages],
  );

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
          setMessages((previous) =>
            reconcileSnapshotChatMessages(previous, prepared.normalizedMessages),
          );
          setMessageRatings(prepared.messageRatings);
          setRightPanelState(
            buildRightPanelStateFromSessionSnapshot(prepared.session, prepared.normalizedMessages),
          );
          setSessionTodos(prepared.sessionTodos);
          setChildSessions(session.children);
          setSessionTasks(session.tasks);
          setPendingPermissions(prepared.pendingPermissions);
          setPendingQuestions(prepared.pendingQuestions);
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

  useEffect(() => {
    if (!currentSessionId) {
      return;
    }

    publishSessionPendingPermission(
      currentSessionId,
      toSessionPendingPermissionState(pendingPermissions),
    );
  }, [currentSessionId, pendingPermissions]);

  useEffect(() => {
    if (!currentSessionId) {
      return;
    }

    publishSessionPendingQuestion(
      currentSessionId,
      pendingQuestions.find((question) => question.status === 'pending') ?? null,
    );
  }, [currentSessionId, pendingQuestions]);

  const activePendingQuestion = useMemo(
    () => pendingQuestions.find((q) => q.status === 'pending') ?? null,
    [pendingQuestions],
  );

  useEffect(() => {
    if (!activePendingQuestion) {
      return;
    }
    setInlineQuestionAnswers(activePendingQuestion.questions.map(() => []));
    setInlineQuestionCustomInputs(activePendingQuestion.questions.map(() => ''));
    setInlineQuestionReplyStatus(null);
    setInlineQuestionReplyError(null);
  }, [activePendingQuestion?.requestId]);

  const toggleInlineQuestionOption = useCallback(
    (questionIndex: number, optionLabel: string, multiple: boolean) => {
      setInlineQuestionAnswers((prev) => {
        const next = prev.map((a) => [...a]);
        while (next.length <= questionIndex) {
          next.push([]);
        }
        const current = next[questionIndex] ?? [];
        if (multiple) {
          next[questionIndex] = current.includes(optionLabel)
            ? current.filter((a) => a !== optionLabel)
            : [...current, optionLabel];
        } else {
          next[questionIndex] = current.includes(optionLabel) ? [] : [optionLabel];
        }
        return next;
      });
    },
    [],
  );

  const handleInlineQuestionCustomInput = useCallback((questionIndex: number, value: string) => {
    setInlineQuestionCustomInputs((prev) => {
      const next = [...prev];
      while (next.length <= questionIndex) {
        next.push('');
      }
      next[questionIndex] = value;
      return next;
    });
  }, []);

  const replyInlineQuestion = useCallback(
    async (status: 'answered' | 'dismissed') => {
      if (!token || !activePendingQuestion) {
        return;
      }

      const mergedAnswers = activePendingQuestion.questions.map((_, index) => {
        const selected = inlineQuestionAnswers[index] ?? [];
        const custom = (inlineQuestionCustomInputs[index] ?? '').trim();
        return custom ? [...selected, custom] : selected;
      });

      const payload =
        status === 'answered'
          ? {
              answers: mergedAnswers,
              requestId: activePendingQuestion.requestId,
              status,
            }
          : { requestId: activePendingQuestion.requestId, status };

      try {
        setInlineQuestionReplyStatus(status);
        setInlineQuestionReplyError(null);
        await createQuestionsClient(gatewayUrl).reply(
          token,
          activePendingQuestion.sessionId,
          payload,
        );
        setPendingQuestions((prev) =>
          prev.filter((q) => q.requestId !== activePendingQuestion.requestId),
        );
        if (currentSessionId) {
          requestCurrentSessionRefresh(currentSessionId);
        }
        requestSessionListRefresh();
      } catch (error) {
        const isHttp =
          typeof error === 'object' &&
          error !== null &&
          typeof Reflect.get(error, 'status') === 'number';
        if (isHttp) {
          const httpStatus = Reflect.get(error, 'status') as number;
          const data = Reflect.get(error, 'data') as { error?: string } | undefined;
          if (
            (httpStatus === 409 || httpStatus === 404) &&
            (data?.error === 'Question request expired' ||
              data?.error === 'Question request already resolved' ||
              httpStatus === 404)
          ) {
            setPendingQuestions((prev) =>
              prev.filter((q) => q.requestId !== activePendingQuestion.requestId),
            );
            toast('问题已过期或已处理，已重新同步。', 'warning', 3000);
            if (currentSessionId) {
              requestCurrentSessionRefresh(currentSessionId);
            }
            requestSessionListRefresh();
            return;
          }
        }
        setInlineQuestionReplyError(
          error instanceof Error ? error.message : '提交回答失败，请重试。',
        );
      } finally {
        setInlineQuestionReplyStatus(null);
      }
    },
    [
      token,
      gatewayUrl,
      activePendingQuestion,
      currentSessionId,
      inlineQuestionAnswers,
      inlineQuestionCustomInputs,
    ],
  );

  useSessionSidebarRunState({
    activeStreamSessionId: activeGatewayStreamSessionId,
    currentSessionId,
    sessionStateStatus,
    streaming,
  });

  useEffect(() => {
    const requestedSessionId = sessionId ?? null;
    const shouldPreserveBootstrapState = pendingBootstrapSessionRef.current === requestedSessionId;
    const shouldSoftReloadCurrentSession =
      sessionReloadNonce > 0 &&
      requestedSessionId !== null &&
      requestedSessionId === currentLoadedSessionIdRef.current;
    void sessionReloadNonce;

    const sessionViewEpoch =
      shouldPreserveBootstrapState || shouldSoftReloadCurrentSession
        ? activateSessionView(requestedSessionId, { incrementEpoch: false })
        : activateSessionView(requestedSessionId);

    if (!requestedSessionId || !token) {
      cancelAttachRetry();
      attachAttemptedSessionRef.current = null;
      setRecoveryActiveStream(null);
      if (currentLoadedSessionIdRef.current !== null) {
        if (chatView !== 'home') {
          navigateToHome();
        }
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
        setPendingPermissions([]);
        setPendingQuestions([]);
        setSessionStateStatus(null);
        setIsSessionSnapshotReady(true);
        setSessionModesHydrated(false);
        clearSessionMetadataDirty();
        lastPersistedSessionMetadataSnapshotRef.current = null;
        resetStreamState();
        setStreamError(null);
        currentLoadedSessionIdRef.current = null;
      }
      return;
    }

    let cancelled = false;
    const runtimeSnapshotController = new AbortController();

    // Save current session view to cache before switching away. When a stream is
    // mid-flight on the previous session, also snapshot the live streaming buffers
    // and right-panel state so that switching back can immediately repaint the
    // in-progress assistant message instead of waiting for an attach event.
    const previousSessionId = currentLoadedSessionIdRef.current;
    if (previousSessionId && previousSessionId !== requestedSessionId) {
      let streamingSnapshot: SessionViewStreamingSnapshot | undefined;
      if (streamingRef.current) {
        const cachedToolCalls: AssistantTraceToolCall[] = getToolCallCards(
          rightPanelStateRef.current,
        ).map((toolCall) => ({
          toolCallId: toolCall.toolCallId,
          toolName: toolCall.toolName,
          input: toolCall.input,
          ...(toolCall.output !== undefined ? { output: toolCall.output } : {}),
          isError: toolCall.isError,
          ...(toolCall.pendingPermissionRequestId
            ? {
                pendingPermissionRequestId: toolCall.pendingPermissionRequestId,
              }
            : {}),
          ...(toolCall.resumedAfterApproval ? { resumedAfterApproval: true } : {}),
          status: toolCall.status,
        }));
        streamingSnapshot = {
          recoveredStream: {
            messageId: currentAssistantStreamMessageIdRef.current,
            startedAt: activeStreamStartedAtRef.current,
            text: streamBufferRef.current,
            thinkingBlocks: streamThinkingBlocksRef.current,
            toolCalls: cachedToolCalls,
            usage: reportedStreamUsageRef.current,
          },
          rightPanelState: rightPanelStateRef.current,
        };
      }
      sessionViewCache.save(
        previousSessionId,
        messagesRef.current,
        scrollRegionRef.current,
        streamingSnapshot,
      );
    }

    navigateToSession();
    cancelAttachRetry();
    attachAttemptedSessionRef.current = null;
    setRecoveryActiveStream(null);
    setCurrentSessionId(requestedSessionId);

    if (shouldPreserveBootstrapState) {
      setSelectedChildSessionId(null);
      pendingBootstrapSessionRef.current = null;
      setIsSessionLoading(false);
      setIsSessionSnapshotReady(true);
      clearSessionMetadataDirty();
      setSessionModesHydrated(true);
      return () => {
        cancelled = true;
      };
    }

    if (shouldSoftReloadCurrentSession) {
      createSessionsClient(gatewayUrl)
        .getRecovery(token, requestedSessionId, {
          messageLimit: INITIAL_TURN_LIMIT,
          signal: runtimeSnapshotController.signal,
        })
        .then((recovery) => {
          if (cancelled || !isCurrentSessionView(requestedSessionId, sessionViewEpoch)) {
            return;
          }

          const prepared = prepareSessionRecoveryState(recovery);
          startSessionSwitchTransition(() => {
            if (!streamingRef.current) {
              setMessages((previous) =>
                reconcileSnapshotChatMessages(previous, prepared.normalizedMessages),
              );
            }
            setMessageRatings(prepared.messageRatings);
            setRightPanelState(
              buildRightPanelStateFromSessionSnapshot(
                prepared.session,
                prepared.normalizedMessages,
              ),
            );
            setSessionTodos(prepared.sessionTodos);
            setChildSessions(recovery.children);
            setSessionTasks(recovery.tasks);
            setPendingPermissions(prepared.pendingPermissions);
            setPendingQuestions(prepared.pendingQuestions);
            setSessionStateStatus(prepared.sessionStateStatus);
            setRecoveryActiveStream(recovery.activeStream);
            syncRecoveredStreamSnapshot(
              prepared.session,
              prepared.sessionStateStatus,
              recovery.activeStream,
              prepared.normalizedMessages,
            );
            setIsSessionSnapshotReady(true);
          });
        })
        .catch(() => undefined);

      return () => {
        cancelled = true;
        runtimeSnapshotController.abort();
        if (pendingSessionNormalizeTimeoutRef.current !== null) {
          window.clearTimeout(pendingSessionNormalizeTimeoutRef.current);
          pendingSessionNormalizeTimeoutRef.current = null;
        }
      };
    }

    // Check cache for the target session to avoid skeleton flash
    const cachedView = sessionViewCache.restore(requestedSessionId);

    setSelectedChildSessionId(null);
    if (cachedView) {
      // Apply cached messages immediately — skip skeleton
      sessionRestoredFromCacheRef.current = true;
      setMessages(cachedView.messages);
      setVisibleMessageCount(DEFAULT_VISIBLE_MESSAGE_COUNT);
      setIsSessionLoading(false);
      // Restore scroll position after React renders the cached messages
      const cachedScrollTop = cachedView.scrollTop;
      ignoreScrollEventsUntilRef.current = performance.now() + 600;
      requestAnimationFrame(() => {
        const sr = scrollRegionRef.current;
        if (sr && !cancelled) {
          sr.scrollTo({ top: cachedScrollTop, behavior: 'auto' });
        }
      });
    } else {
      sessionRestoredFromCacheRef.current = false;
      setIsSessionLoading(true);
      setMessages([]);
      setVisibleMessageCount(DEFAULT_VISIBLE_MESSAGE_COUNT);
    }
    setRightPanelState(createInitialChatRightPanelState());
    setServerTotalTurnCount(null);
    setChildSessions([]);
    setSessionTasks([]);
    setPendingPermissions([]);
    setPendingQuestions([]);
    setSessionStateStatus(null);
    setRecoveryActiveStream(null);
    setIsSessionSnapshotReady(false);
    setSessionModesHydrated(false);
    setSessionMetadataDirty(false);
    lastPersistedSessionMetadataSnapshotRef.current = null;
    resetStreamState();
    setStreamError(null);
    setDialogueMode('coding');
    setManualAgentId('');
    setYoloMode(false);
    setWebSearchEnabled(true);
    setThinkingEnabled(false);
    setReasoningEffort('medium');
    setActiveProviderId('');
    setActiveModelId('');

    // If we cached an in-flight streaming snapshot for this session, replay it
    // immediately so the user sees the in-progress assistant message right away.
    // The subsequent getRecovery + attach pipeline will then take over without
    // a visible "blank" gap.
    if (cachedView?.streamingSnapshot) {
      setRightPanelState(cachedView.streamingSnapshot.rightPanelState);
      setRecoveredStreamSnapshot(cachedView.streamingSnapshot.recoveredStream);
      setSessionStateStatus('running');
    }

    createSessionsClient(gatewayUrl)
      .getRecovery(token, requestedSessionId, {
        messageLimit: INITIAL_TURN_LIMIT,
        signal: runtimeSnapshotController.signal,
      })
      .then((recovery) => {
        console.log('[RECOVERY]', requestedSessionId, {
          activeStream: recovery.activeStream,
          sessionStateStatus: (recovery.session as unknown as Record<string, unknown>)
            ?.state_status,
        });
        if (cancelled || !isCurrentSessionView(requestedSessionId, sessionViewEpoch)) {
          console.log('[RECOVERY] skipped — cancelled or view mismatch');
          return;
        }
        const prepared = prepareSessionRecoveryState(recovery);
        const metadata = prepared.metadata;
        const applySessionPayload = () => {
          if (cancelled || !isCurrentSessionView(requestedSessionId, sessionViewEpoch)) {
            return;
          }

          startSessionSwitchTransition(() => {
            if (streamingRef.current) {
              // While streaming, don't replace messages — the stream is authoritative
            } else if (cachedView) {
              setMessages((previous) =>
                reconcileSnapshotChatMessages(previous, prepared.normalizedMessages),
              );
            } else {
              setMessages(prepared.normalizedMessages);
            }
            setMessageRatings(prepared.messageRatings);
            // When the previous in-flight streaming snapshot was just replayed from
            // the view cache, prefer keeping the cached right-panel state — the
            // server-side runEvents typically lag behind the live stream, so
            // rebuilding from them here would visually "lose" the in-progress tool
            // cards until attach catches up. The attach pipeline will continue
            // updating the right-panel state as new events arrive.
            const sessionStillStreamingFromRecovery =
              recovery.activeStream !== null ||
              prepared.sessionStateStatus === 'running' ||
              prepared.sessionStateStatus === 'paused';
            const shouldKeepCachedRightPanel = Boolean(
              cachedView?.streamingSnapshot && sessionStillStreamingFromRecovery,
            );
            if (!shouldKeepCachedRightPanel) {
              setRightPanelState(
                buildRightPanelStateFromSessionSnapshot(
                  prepared.session,
                  prepared.normalizedMessages,
                ),
              );
            }
            setSessionTodos(prepared.sessionTodos);
            setChildSessions(recovery.children);
            setSessionTasks(recovery.tasks);
            setPendingPermissions(prepared.pendingPermissions);
            setPendingQuestions(prepared.pendingQuestions);
            setSessionStateStatus(prepared.sessionStateStatus);
            setRecoveryActiveStream(recovery.activeStream);
            syncRecoveredStreamSnapshot(
              prepared.session,
              prepared.sessionStateStatus,
              recovery.activeStream,
              prepared.normalizedMessages,
            );
            setIsSessionSnapshotReady(true);
            setServerTotalTurnCount(recovery.totalTurnCount ?? null);
            if (!sessionMetadataDirtyRef.current) {
              setDialogueMode(metadata.dialogueMode);
              setManualAgentId(metadata.agentId ?? '');
              setYoloMode(metadata.yoloMode);
              setWebSearchEnabled(metadata.webSearchEnabled);
              setThinkingEnabled(metadata.thinkingEnabled);
              setReasoningEffort(metadata.reasoningEffort);
              setActiveProviderId(metadata.providerId ?? '');
              setActiveModelId(metadata.modelId ?? '');
            }
            lastPersistedSessionMetadataSnapshotRef.current = createSessionMetadataSnapshot({
              dialogueMode: metadata.dialogueMode,
              agentId: metadata.agentId,
              yoloMode: metadata.yoloMode,
              webSearchEnabled: metadata.webSearchEnabled,
              thinkingEnabled: metadata.thinkingEnabled,
              reasoningEffort: metadata.reasoningEffort,
              providerId: metadata.providerId,
              modelId: metadata.modelId,
              workingDirectory: extractWorkingDirectory(prepared.session.metadata_json),
            });
            if (!sessionMetadataDirtyRef.current) {
              clearSessionMetadataDirty();
            }
            setSessionModesHydrated(true);
            setIsSessionLoading(false);
          });
        };

        if (prepared.normalizedMessages.length > SESSION_SWITCH_DEFER_THRESHOLD) {
          if (pendingSessionNormalizeTimeoutRef.current !== null) {
            window.clearTimeout(pendingSessionNormalizeTimeoutRef.current);
          }
          pendingSessionNormalizeTimeoutRef.current = window.setTimeout(() => {
            pendingSessionNormalizeTimeoutRef.current = null;
            applySessionPayload();
          }, 0);
          return;
        }

        applySessionPayload();
      })
      .catch(() => {
        if (cancelled || !isCurrentSessionView(requestedSessionId, sessionViewEpoch)) {
          return null;
        }
        setSessionTodos([]);
        setRightPanelState(createInitialChatRightPanelState());
        setSessionStateStatus(null);
        setRecoveryActiveStream(null);
        setIsSessionSnapshotReady(false);
        clearSessionMetadataDirty();
        setSessionModesHydrated(true);
        setIsSessionLoading(false);
        return null;
      });

    return () => {
      cancelled = true;
      runtimeSnapshotController.abort();
      if (pendingSessionNormalizeTimeoutRef.current !== null) {
        window.clearTimeout(pendingSessionNormalizeTimeoutRef.current);
        pendingSessionNormalizeTimeoutRef.current = null;
      }
    };
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
    const nextMetadata = buildSessionMetadata();
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
        clearSessionMetadataDirty();
        requestSessionListRefresh();
      })
      .catch(() => undefined);
  }, [
    buildSessionMetadata,
    clearSessionMetadataDirty,
    currentSessionId,
    gatewayUrl,
    sessionMetadataDirty,
    sessionModesHydrated,
    token,
  ]);

  const { isNearBottomRef, ignoreScrollEventsUntilRef, handleScroll, scrollToBottom } =
    useScrollManager(
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
        messagesLength: messages.length,
        visibleStreaming,
        visibleStreamBufferLength: visibleStreamBuffer.length,
        editorMode,
      },
    );

  const prevSnapshotReadyRef = useRef(false);
  useEffect(() => {
    if (!prevSnapshotReadyRef.current && isSessionSnapshotReady && messages.length > 0) {
      // When restored from cache, scroll was already set — skip the forced scroll-to-bottom
      if (sessionRestoredFromCacheRef.current) {
        sessionRestoredFromCacheRef.current = false;
        prevSnapshotReadyRef.current = isSessionSnapshotReady;
        return;
      }
      isNearBottomRef.current = true;
      ignoreScrollEventsUntilRef.current = performance.now() + 600;
      const timer = window.setTimeout(() => {
        const sr = scrollRegionRef.current;
        if (sr) {
          sr.scrollTo({ top: sr.scrollHeight, behavior: 'auto' });
        } else {
          bottomRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
        }
      }, 200);
      return () => {
        window.clearTimeout(timer);
      };
    }
    prevSnapshotReadyRef.current = isSessionSnapshotReady;
  }, [
    isSessionSnapshotReady,
    messages.length,
    isNearBottomRef,
    ignoreScrollEventsUntilRef,
    scrollRegionRef,
    bottomRef,
  ]);

  useEffect(() => {
    if (!isSessionSnapshotReady) {
      prevSnapshotReadyRef.current = false;
    }
  }, [isSessionSnapshotReady]);

  const focusComposerWithText = useCallback((text: string) => {
    setInput(text);
    setComposerMenu(null);
    requestAnimationFrame(() => {
      if (!textareaRef.current) return;
      textareaRef.current.focus();
      const caret = text.length;
      textareaRef.current.setSelectionRange(caret, caret);
    });
  }, []);

  const appendTextToComposer = useCallback((text: string) => {
    setInput((previous) => {
      const separator = previous.length > 0 && !previous.endsWith(' ') ? ' ' : '';
      return `${previous}${separator}${text}`;
    });
    setComposerMenu(null);
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

  const handleToggleMessageRating = useCallback(
    async (message: ChatMessage, rating: SessionMessageRatingValue) => {
      if (!token || !currentSessionId || message.role !== 'assistant' || !message.rawContent) {
        return;
      }

      const existingRating = messageRatings[message.id]?.rating;
      const sessionsClient = createSessionsClient(gatewayUrl);

      try {
        if (existingRating === rating) {
          await sessionsClient.deleteMessageRating(token, currentSessionId, message.id);
          setMessageRatings((previous) => {
            const next = { ...previous };
            delete next[message.id];
            return next;
          });
          return;
        }

        const nextRating = await sessionsClient.setMessageRating(
          token,
          currentSessionId,
          message.id,
          { rating },
        );
        setMessageRatings((previous) => ({
          ...previous,
          [message.id]: nextRating,
        }));
      } catch (error) {
        logger.error('message rating failed', error);
      }
    },
    [currentSessionId, gatewayUrl, messageRatings, token],
  );

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

  const createBranchSessionFromMessage = useCallback(
    async (text: string, sourceMessageId: string, inputParts?: InputImageContent[]) => {
      if (!token) return;
      const originSessionId = activeSessionRef.current;

      const baseRecovery = currentSessionId
        ? await createSessionsClient(gatewayUrl).getRecovery(token, currentSessionId)
        : null;
      const baseSession = baseRecovery?.session ?? null;
      const baseMessages = Array.isArray(baseSession?.messages) ? baseSession.messages : [];
      const sourceIndex = baseMessages.findIndex((message) => message.id === sourceMessageId);
      const truncatedMessages = (sourceIndex >= 0 ? baseMessages.slice(0, sourceIndex) : []).map(
        (message) => ({
          ...message,
          id: makeOrderedMessageId(),
        }),
      );

      const imported = await createSessionsClient(gatewayUrl).importSession(token, {
        messages: truncatedMessages,
      });
      const branchMetadata = buildSessionMetadata({
        editSourceMessageId: sourceMessageId,
        ...(currentSessionId ? { parentSessionId: currentSessionId } : {}),
      });
      await createSessionsClient(gatewayUrl).updateMetadata(
        token,
        imported.sessionId,
        branchMetadata,
      );
      lastPersistedSessionMetadataSnapshotRef.current =
        createSessionMetadataSnapshot(buildSessionMetadata());

      if (activeSessionRef.current !== originSessionId) {
        return;
      }

      activeSessionRef.current = imported.sessionId;
      pendingBootstrapSessionRef.current = imported.sessionId;
      setCurrentSessionId(imported.sessionId);
      setMessages(filterTranscriptMessages(normalizeChatMessages(truncatedMessages)));
      clearSessionMetadataDirty();
      setSessionModesHydrated(true);
      resetStreamState();
      setStreamError(null);
      if (inputParts && inputParts.length > 0) {
        requestSessionListRefresh();
        void navigate(`/chat/${imported.sessionId}`);
        await sendMessage(text, {
          existingInputParts: inputParts,
          forcedSessionId: imported.sessionId,
        });
      } else {
        focusComposerWithText(text);
        requestSessionListRefresh();
        void navigate(`/chat/${imported.sessionId}`);
      }
      return imported.sessionId;
    },
    [
      buildSessionMetadata,
      clearSessionMetadataDirty,
      currentSessionId,
      focusComposerWithText,
      gatewayUrl,
      navigate,
      resetStreamState,
      sendMessage,
      token,
    ],
  );

  const truncateSessionMessagesInPlace = useCallback(
    async (sessionId: string, messageId: string, messageText?: string): Promise<Message[]> => {
      if (!token) return [];
      const res = await fetch(`${gatewayUrl}/sessions/${sessionId}/messages/truncate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ messageId, inclusive: true, messageText }),
      });
      if (!res.ok) {
        throw new Error(`Failed to truncate session messages: ${res.status}`);
      }
      const data = (await res.json()) as { messages?: Message[] };
      return data.messages ?? [];
    },
    [gatewayUrl, token],
  );

  const trimMessagesFromSource = useCallback(
    <TMessage extends { id: string }>(
      sourceMessages: TMessage[],
      sourceMessageId: string,
    ): TMessage[] => {
      const sourceIndex = sourceMessages.findIndex((message) => message.id === sourceMessageId);
      return sourceIndex >= 0 ? sourceMessages.slice(0, sourceIndex) : sourceMessages;
    },
    [],
  );

  async function ensureSession(): Promise<string> {
    if (currentSessionId) {
      activeSessionRef.current = currentSessionId;
      currentSessionViewRef.current = {
        ...currentSessionViewRef.current,
        sessionId: currentSessionId,
      };
      return currentSessionId;
    }

    const originSessionId = activeSessionRef.current;
    const originSessionViewEpoch = currentSessionViewRef.current.epoch;
    let savedDefaults = savedChatDefaultsRef.current;
    if (!savedDefaults) {
      try {
        const loadedDefaults = await loadSavedChatDefaults();
        if (loadedDefaults) {
          savedDefaults = loadedDefaults.defaults;
          setProviders(loadedDefaults.providers);
          if (!hasAppliedSavedImageDefaultsRef.current) {
            applySavedImageDefaults(loadedDefaults.imageDefaults);
            hasAppliedSavedImageDefaultsRef.current = true;
          }
        }
      } catch {
        savedDefaults = null;
      }
    }

    const resolvedProviderId = sessionMetadataDirty
      ? activeProviderId || savedDefaults?.providerId || ''
      : savedDefaults?.providerId || activeProviderId || '';
    const resolvedModelId = sessionMetadataDirty
      ? activeModelId || savedDefaults?.modelId || ''
      : savedDefaults?.modelId || activeModelId || '';
    const resolvedThinkingEnabled = sessionMetadataDirty
      ? thinkingEnabled
      : (savedDefaults?.thinkingEnabled ?? thinkingEnabled);
    const resolvedReasoningEffort = sessionMetadataDirty
      ? reasoningEffort
      : (savedDefaults?.reasoningEffort ?? reasoningEffort);

    if (!activeProviderId && resolvedProviderId) {
      setActiveProviderId(resolvedProviderId);
    }
    if (!activeModelId && resolvedModelId) {
      setActiveModelId(resolvedModelId);
    }
    if (!sessionMetadataDirty) {
      setThinkingEnabled(resolvedThinkingEnabled);
      setReasoningEffort(resolvedReasoningEffort);
    }

    const resolvedMetadata = buildSessionMetadata({
      ...(resolvedProviderId ? { providerId: resolvedProviderId } : {}),
      ...(resolvedModelId ? { modelId: resolvedModelId } : {}),
      reasoningEffort: resolvedReasoningEffort,
      thinkingEnabled: resolvedThinkingEnabled,
    });
    const session = await createSessionsClient(gatewayUrl).create(token ?? '', {
      metadata: resolvedMetadata,
    });
    if (
      activeSessionRef.current !== originSessionId ||
      currentSessionViewRef.current.epoch !== originSessionViewEpoch
    ) {
      throw new Error('当前会话已切换，请重试');
    }

    lastPersistedSessionMetadataSnapshotRef.current =
      createSessionMetadataSnapshot(resolvedMetadata);
    activateSessionView(session.id);
    pendingBootstrapSessionRef.current = session.id;
    setCurrentSessionId(session.id);
    clearSessionMetadataDirty();
    setSessionModesHydrated(true);
    requestSessionListRefresh();
    void navigate(`/chat/${session.id}`, { replace: true });
    return session.id;
  }

  const {
    appendFiles,
    handleFileChange,
    removeFile,
    removeAttachment,
    clearComposerDraft,
    enqueueComposerMessage,
    removeQueuedComposerMessage,
    restoreQueuedComposerMessage,
  } = useComposerQueue({
    input,
    setInput,
    attachedFiles,
    setAttachedFiles,
    attachmentItems,
    setAttachmentItems,
    queuedComposerMessages,
    setQueuedComposerMessages,
    queuedComposerScope,
    setComposerMenu,
    setStreamError,
    textareaRef,
    fileInputRef,
  });

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
    const sourceInput = sanitizeComposerPlainText(overrideText ?? input);
    const effectiveFiles = options?.queuedFiles ?? attachedFiles;
    if (
      (!sourceInput.trim() && (imageGenerationMode || effectiveFiles.length === 0)) ||
      streaming ||
      remoteSessionBusyState ||
      imageGenerationBusy
    ) {
      return false;
    }
    const requestOriginSessionId = activeSessionRef.current;
    setStreamError(null);
    let text = sourceInput.trim();

    if (imageGenerationMode) {
      if (!hasConfiguredImageModel) {
        const message = '请先在设置中配置可用的图片模型，然后再使用图片生成模式。';
        setStreamError(message);
        toast(message, 'warning');
        return false;
      }

      if (overrideText === undefined && options?.queuedFiles === undefined) {
        clearComposerDraft();
      }

      let sid: string;
      try {
        sid = options?.forcedSessionId ?? (await ensureSession());
      } catch (err) {
        logger.error('session create failed', err);
        if (activeSessionRef.current === requestOriginSessionId) {
          setStreamError(err instanceof Error ? err.message : '会话创建失败');
        }
        return false;
      }

      if (activeSessionRef.current !== sid) {
        return false;
      }

      let imageEditArtifacts:
        | Array<{ artifactId: string; fileName?: string; mimeType?: string }>
        | undefined;
      let localImageInputs: InputImageContent[] | undefined;
      if (selectedImageEditReferenceArtifact && effectiveFiles.length > 0) {
        const message = '当前图片编辑一次只支持一张参考图，请在会话图片和新上传图片之间二选一。';
        setStreamError(message);
        toast(message, 'warning');
        return false;
      }

      if (selectedImageEditReferenceArtifact) {
        imageEditArtifacts = [
          {
            artifactId: selectedImageEditReferenceArtifact.artifactId,
            ...(selectedImageEditReferenceArtifact.fileName
              ? { fileName: selectedImageEditReferenceArtifact.fileName }
              : {}),
            ...(selectedImageEditReferenceArtifact.mimeType
              ? { mimeType: selectedImageEditReferenceArtifact.mimeType }
              : {}),
          },
        ];
        localImageInputs = [
          {
            type: 'input_image',
            artifactId: selectedImageEditReferenceArtifact.artifactId,
            ...(selectedImageEditReferenceArtifact.imageUrl
              ? { imageUrl: selectedImageEditReferenceArtifact.imageUrl }
              : {}),
            ...(selectedImageEditReferenceArtifact.fileName
              ? { fileName: selectedImageEditReferenceArtifact.fileName }
              : {}),
            ...(selectedImageEditReferenceArtifact.mimeType
              ? { mimeType: selectedImageEditReferenceArtifact.mimeType }
              : {}),
          },
        ];
      }

      if (effectiveFiles.length > 0) {
        const invalidAttachment = effectiveFiles.find((file) => !file.type.startsWith('image/'));
        if (invalidAttachment) {
          const message = '图片生成模式只支持图片作为参考图，请移除非图片附件后重试。';
          setStreamError(message);
          toast(message, 'warning');
          return false;
        }

        const uploadedAttachments = await uploadChatAttachments({
          files: effectiveFiles,
          gatewayUrl,
          sessionId: sid,
          token,
        });
        imageEditArtifacts = uploadedAttachments
          .filter((attachment) => attachment.type === 'image')
          .map((attachment) => ({
            artifactId: attachment.artifactId,
            ...(attachment.fileName ? { fileName: attachment.fileName } : {}),
            ...(attachment.mimeType ? { mimeType: attachment.mimeType } : {}),
          }));
        localImageInputs = uploadedAttachments
          .filter((attachment) => attachment.type === 'image')
          .map((attachment) => ({
            type: 'input_image',
            artifactId: attachment.artifactId,
            ...(attachment.dataUrl ? { imageUrl: attachment.dataUrl } : {}),
            ...(attachment.fileName ? { fileName: attachment.fileName } : {}),
            ...(attachment.mimeType ? { mimeType: attachment.mimeType } : {}),
          }));
        if (options?.queuedFiles === undefined) {
          setAttachedFiles([]);
          setAttachmentItems([]);
        }
      }

      const requestStartedAt = Date.now();
      const userMsg: ChatMessage = {
        id: makeOrderedMessageId(requestStartedAt),
        role: 'user',
        content: text,
        ...(localImageInputs ? { rawContent: [{ type: 'text', text }, ...localImageInputs] } : {}),
        createdAt: requestStartedAt,
        tokenEstimate: estimateTokenCount(text),
        status: 'completed',
      };
      setMessages((prev) => [...prev, userMsg]);

      if (options?.queuedMessageId && queuedComposerScope) {
        void deleteQueuedComposerFiles({
          queueId: options.queuedMessageId,
          scope: queuedComposerScope,
        });
      }

      try {
        const payload = await generateImageForSession({
          ...(imageEditArtifacts ? { inputArtifacts: imageEditArtifacts } : {}),
          prompt: text,
          sessionId: sid,
        });
        if (activeSessionRef.current !== sid) {
          return false;
        }

        const responsePayload = payload as SessionImageGenerationResponse;

        appendImageGenerationSummaryMessage({
          artifactTitle: responsePayload.artifact.title,
          messageSummary: responsePayload.messageSummary,
          modelId: responsePayload.parameters.modelId,
          providerId: responsePayload.parameters.providerId,
          revisedPrompt: responsePayload.revisedPrompt,
          sourcePrompt: text,
        });
        setLatestGeneratedImageResult({
          artifactId: responsePayload.artifact.id,
          artifactTitle: responsePayload.artifact.title,
          modelLabel: imageModelLabel || responsePayload.parameters.modelId,
        });
        setSessionReloadNonce((value) => value + 1);
        requestSessionListRefresh();
        toast(
          imageEditArtifacts
            ? '图片已处理，可在产物工作区查看。'
            : '图片已生成，可在产物工作区查看。',
          'success',
        );
        return true;
      } catch (error) {
        if (activeSessionRef.current === sid) {
          const message = error instanceof Error ? error.message : '图片生成失败，请稍后重试。';
          setStreamError(message);
          toast(message, 'error');
        }
        return false;
      }
    }

    const matchedClientCommand =
      effectiveFiles.length === 0
        ? matchClientSlashCommand(text, composerCommandDescriptors)
        : null;
    const matchedServerCommand =
      effectiveFiles.length === 0
        ? matchServerSlashCommand(text, composerCommandDescriptors)
        : null;

    if (matchedClientCommand?.action.kind === 'open_companion_panel') {
      if (overrideText === undefined && options?.queuedFiles === undefined) {
        clearComposerDraft();
      }
      setCompanionPanelSignal((value) => value + 1);
      return true;
    }

    if (matchedServerCommand) {
      if (overrideText === undefined && options?.queuedFiles === undefined) {
        clearComposerDraft();
      }
      await executeServerCommand({
        command: matchedServerCommand,
        currentSessionId,
        gatewayUrl,
        rawInput: text,
        token,
        unavailableTitle:
          matchedServerCommand.action.kind === 'generate_handoff'
            ? '交接暂不可用'
            : matchedServerCommand.action.kind === 'compact_session'
              ? '压缩暂不可用'
              : `${matchedServerCommand.label} 暂不可用`,
        unavailableMessage: `需要先进入一个已有会话后再执行 ${matchedServerCommand.label}。`,
        onCard: (card) => appendCommandCard(card),
        onEvents: (events) => {
          setRightPanelState((prev) =>
            events.reduce((next, event) => applyChatRightPanelEvent(next, event), prev),
          );
          appendAssistantEventMessages(events, { excludeCompaction: true });
        },
        onOpenRightPanel: () => {},
      });
      requestSessionListRefresh();
      return true;
    }

    if (overrideText === undefined && options?.queuedFiles === undefined) {
      clearComposerDraft();
    }

    let sid: string;
    try {
      sid = options?.forcedSessionId ?? (await ensureSession());
    } catch (err) {
      logger.error('session create failed', err);
      if (activeSessionRef.current === requestOriginSessionId) {
        resetStreamState();
        setStreamError(err instanceof Error ? err.message : '会话创建失败');
      }
      return false;
    }

    if (activeSessionRef.current !== sid) {
      return false;
    }

    let requestInputParts: InputImageContent[] | undefined;
    let localRequestInputParts: InputImageContent[] | undefined;

    if (effectiveFiles.length > 0) {
      const uploadedAttachments = await uploadChatAttachments({
        files: effectiveFiles,
        gatewayUrl,
        sessionId: sid,
        token,
      });
      const imageInputParts: InputImageContent[] = uploadedAttachments
        .filter((attachment) => attachment.type === 'image')
        .map((attachment) => ({
          type: 'input_image',
          artifactId: attachment.artifactId,
          ...(attachment.fileName ? { fileName: attachment.fileName } : {}),
          ...(attachment.mimeType ? { mimeType: attachment.mimeType } : {}),
        }));
      const localImageParts: InputImageContent[] = uploadedAttachments
        .filter((attachment) => attachment.type === 'image')
        .map((attachment) => ({
          type: 'input_image',
          artifactId: attachment.artifactId,
          ...(attachment.dataUrl ? { imageUrl: attachment.dataUrl } : {}),
          ...(attachment.fileName ? { fileName: attachment.fileName } : {}),
          ...(attachment.mimeType ? { mimeType: attachment.mimeType } : {}),
        }));
      const uploadedAttachmentLines = uploadedAttachments
        .filter((attachment) => attachment.type !== 'image')
        .map((attachment) => buildUploadedAttachmentSummaryLine(attachment));
      text = appendAttachmentSummary(text, uploadedAttachmentLines);
      if (options?.queuedFiles === undefined) {
        setAttachedFiles([]);
        setAttachmentItems([]);
      }

      if (imageInputParts.length > 0) {
        requestInputParts = imageInputParts;
        localRequestInputParts = localImageParts;
      }
    } else if (options?.existingInputParts && options.existingInputParts.length > 0) {
      requestInputParts = options.existingInputParts;
      localRequestInputParts = options.existingInputParts;
    }

    // ── Reset refs (no re-render) ──
    currentAssistantStreamMessageIdRef.current = makeOrderedMessageId();
    streamingRef.current = true;
    stoppingStreamRef.current = false;
    streamRevealTargetRef.current = '';
    streamRevealVisibleRef.current = '';
    streamRevealTargetCodePointsRef.current = [];
    streamRevealVisibleCodePointCountRef.current = 0;
    streamRevealNextAllowedAtRef.current = 0;
    isNearBottomRef.current = true;

    // ── Batch state updates (single React render) ──
    const requestStartedAt = Date.now();
    setStreaming(true);
    setStoppingStream(false);
    setSessionStateStatus('running');
    setReportedStreamUsage(null);
    setStreamBuffer('');
    setStreamThinkingBuffer('');
    setStreamThinkingBlocks([]);
    setHasPendingFollowContent(false);
    setShowScrollToBottom(false);
    setActiveStreamStartedAt(requestStartedAt);
    setActiveStreamFirstTokenLatencyMs(null);
    const toolCallIds = new Set<string>();
    const liveToolCalls = new Map<string, LiveToolCallState>();
    const requestProviderId = activeProviderId || undefined;
    const requestModelLabel = (activeModelOption?.label ?? activeModelId) || undefined;
    const requestAgentId = effectiveAgentId || undefined;

    const buildAssistantTraceMessage = (
      messageId: string,
      textContent: string,
      finalStatus?: 'completed' | 'error' | 'cancelled' | 'paused',
    ): {
      content: string;
      parts: ChatMessagePart[];
      reasoningBlocksEndedFlags?: boolean[];
      reasoningBlocksDurationsMs?: number[];
    } => {
      const toolCalls = Array.from(liveToolCalls.values()).map((toolCallState) => {
        const nextToolState =
          finalStatus === 'error' && toolCallState.status === 'streaming'
            ? { ...toolCallState, isError: true, status: 'error' as const }
            : finalStatus === 'completed' && toolCallState.status === 'streaming'
              ? { ...toolCallState, status: 'completed' as const }
              : (finalStatus === 'cancelled' || finalStatus === 'paused') &&
                  toolCallState.status === 'streaming'
                ? { ...toolCallState, status: 'paused' as const }
                : toolCallState;
        const hasPendingPermission = hasActivePendingPermissionRequest({
          isError: nextToolState.isError,
          pendingPermissionRequestId: nextToolState.pendingPermissionRequestId,
          resumedAfterApproval: nextToolState.resumedAfterApproval,
          status: nextToolState.status,
        });
        const status: 'running' | 'paused' | 'completed' | 'failed' =
          nextToolState.status === 'error'
            ? 'failed'
            : nextToolState.status === 'paused'
              ? 'paused'
              : nextToolState.status === 'completed'
                ? 'completed'
                : 'running';

        const durationMs =
          nextToolState.completedAt && nextToolState.createdAt
            ? nextToolState.completedAt - nextToolState.createdAt
            : undefined;

        return {
          kind: resolveAssistantCapabilityKind(nextToolState.toolName),
          toolCallId: nextToolState.toolCallId,
          toolName: nextToolState.toolName,
          input: {
            ...parseToolCallInputText(nextToolState.inputText),
            ...(nextToolState.batchProgress ? { _batchProgress: nextToolState.batchProgress } : {}),
          },
          output: nextToolState.output,
          isError: nextToolState.isError,
          ...(hasPendingPermission
            ? {
                pendingPermissionRequestId: nextToolState.pendingPermissionRequestId,
              }
            : {}),
          resumedAfterApproval: nextToolState.resumedAfterApproval,
          status,
          ...(durationMs !== undefined ? { durationMs } : {}),
        };
      });

      const reasoningBlocks = extractStreamingThinkingTexts(accumulatedThinkingBlocks);
      const reasoningBlocksEndedFlags =
        reasoningBlocks.length > 0
          ? extractStreamingThinkingEndedFlags(accumulatedThinkingBlocks)
          : undefined;
      const reasoningBlocksDurationsMs =
        reasoningBlocks.length > 0
          ? extractStreamingThinkingDurations(accumulatedThinkingBlocks)
          : undefined;
      const reasoningBlocksTimings =
        reasoningBlocks.length > 0
          ? accumulatedThinkingBlocks
              .filter((block) => block.text.trim().length > 0)
              .map((block) => ({
                ...(typeof block.startedAt === 'number' ? { startedAt: block.startedAt } : {}),
                ...(typeof block.endedAt === 'number' ? { endedAt: block.endedAt } : {}),
              }))
          : undefined;
      const hasPersistableTiming =
        reasoningBlocksTimings?.some(
          (entry) => typeof entry.startedAt === 'number' || typeof entry.endedAt === 'number',
        ) ?? false;
      const tracePayload = {
        ...(reasoningBlocks.length > 0 ? { reasoningBlocks } : {}),
        ...(hasPersistableTiming && reasoningBlocksTimings ? { reasoningBlocksTimings } : {}),
        text: textContent,
        toolCalls,
      };

      const content = textContent;
      const parts = partsFromAssistantTrace(messageId, tracePayload);

      return {
        content,
        parts,
        ...(reasoningBlocksEndedFlags ? { reasoningBlocksEndedFlags } : {}),
        ...(reasoningBlocksDurationsMs ? { reasoningBlocksDurationsMs } : {}),
      };
    };

    const userRawContent: Array<{ type: 'text'; text: string } | InputImageContent> = [
      ...(text.length > 0 ? [{ type: 'text' as const, text }] : []),
      ...(localRequestInputParts ?? requestInputParts ?? []),
    ];
    const displayMessageForStream =
      text.length > 0
        ? text
        : requestInputParts && requestInputParts.length > 0
          ? `上传了 ${requestInputParts.length} 张图片`
          : text;
    const userMsg: ChatMessage = {
      id: makeOrderedMessageId(),
      role: 'user',
      content: text,
      rawContent: userRawContent,
      createdAt: requestStartedAt,
      tokenEstimate: estimateTokenCount(text),
      status: 'completed',
    };
    setMessages((prev) => [...prev, userMsg]);

    if (options?.queuedMessageId && queuedComposerScope) {
      void deleteQueuedComposerFiles({
        queueId: options.queuedMessageId,
        scope: queuedComposerScope,
      });
    }

    const requestText = text;
    let accumulated = '';
    let accumulatedThinking = '';
    let accumulatedThinkingBlocks: StreamingThinkingBlock[] = [];
    // Ordered, wire-faithful segment list — kept alongside the legacy
    // accumulated* buffers so existing flows (thinking duration extraction,
    // stream-reveal, etc.) keep working while the UI now reads `parts`
    // straight from this list. Reset on round boundaries / cancel / done.
    let accumulatedSegments: ChatMessagePart[] = [];
    const reasoningSegmentMeta = new Map<string, { blockKey: string }>();
    let pendingThinkingFlushFrame: number | null = null;
    let pendingSegmentsFlushFrame: number | null = null;
    const flushThinkingState = () => {
      pendingThinkingFlushFrame = null;
      // Guard against late RAF callbacks landing after the stream was reset
      // (session switch / cancel / round-close) to prevent UI from flashing
      // stale reasoning content over the cleared buffer.
      if (!streamingRef.current || activeSessionRef.current !== sid) {
        return;
      }
      setStreamThinkingBlocks(accumulatedThinkingBlocks);
      setStreamThinkingBuffer(accumulatedThinking);
    };
    const scheduleThinkingFlush = () => {
      if (pendingThinkingFlushFrame !== null) return;
      pendingThinkingFlushFrame = window.requestAnimationFrame(flushThinkingState);
    };
    const cancelThinkingFlush = () => {
      if (pendingThinkingFlushFrame !== null) {
        window.cancelAnimationFrame(pendingThinkingFlushFrame);
        pendingThinkingFlushFrame = null;
      }
    };
    const flushSegmentsState = () => {
      pendingSegmentsFlushFrame = null;
      if (!streamingRef.current || activeSessionRef.current !== sid) return;
      setStreamingSegments(accumulatedSegments);
    };
    const scheduleSegmentsFlush = () => {
      if (pendingSegmentsFlushFrame !== null) return;
      pendingSegmentsFlushFrame = window.requestAnimationFrame(flushSegmentsState);
    };
    const cancelSegmentsFlush = () => {
      if (pendingSegmentsFlushFrame !== null) {
        window.cancelAnimationFrame(pendingSegmentsFlushFrame);
        pendingSegmentsFlushFrame = null;
      }
    };
    let firstTokenObservedAt: number | null = null;
    let toolPanelRevealed = false;
    let pausedForPermission = false;
    let pausedForQuestion = false;
    let currentRoundStartedAt = requestStartedAt;
    let firstTokenLatencyAttached = false;
    const requestModelSupportsThinking = activeModelOption?.supportsThinking === true;

    // Round boundary commit:
    // The gateway persists one assistant message per agent round (see
    // `routes/stream-model-round.ts`); the live UI must mirror that structure
    // so reasoning/tool/text parts render in the true wire order both during
    // streaming and after refresh. When a fresh wave of thinking arrives after
    // any tool_call has been issued in this round, commit the current round
    // as a finalized assistant message and roll the message id forward.
    const closeCurrentStreamingRoundIntoMessage = (timestamp: number) => {
      const closingMessageId = currentAssistantStreamMessageIdRef.current;
      if (!closingMessageId) return;
      if (
        liveToolCalls.size === 0 &&
        accumulatedThinking.trim().length === 0 &&
        accumulated.trim().length === 0
      ) {
        return;
      }
      // Cancel any pending RAF so the upcoming setStreamThinkingBlocks([])
      // / setStreamThinkingBuffer('') reset is not overwritten by a late flush.
      cancelThinkingFlush();
      cancelSegmentsFlush();
      const { content } = buildAssistantTraceMessage(closingMessageId, accumulated, 'completed');
      // Prefer the ordered segment list as the canonical parts source so the
      // committed round message reflects the wire-arrival order. Fall back
      // to the legacy reordered parts only when no segments were collected
      // (e.g. attach scenarios that bypass this path).
      const parts =
        accumulatedSegments.length > 0
          ? accumulatedSegments
          : buildAssistantTraceMessage(closingMessageId, accumulated, 'completed').parts;
      const roundToolCallIds = new Set(liveToolCalls.keys());
      // Only the first round that finalizes after the first token observation
      // should expose firstTokenLatencyMs; subsequent rounds reuse the same
      // observation and would double-render the metric in their footers.
      const shouldAttachFirstTokenLatency =
        firstTokenObservedAt !== null && !firstTokenLatencyAttached;
      setMessages((prev) =>
        replaceOrAppendStreamedAssistantMessage(
          prev,
          {
            id: closingMessageId,
            role: 'assistant',
            content,
            parts,
            createdAt: timestamp,
            durationMs: timestamp - currentRoundStartedAt,
            tokenEstimate: estimateTokenCount(
              [accumulatedThinking, accumulated]
                .filter((item) => item.trim().length > 0)
                .join('\n\n'),
            ),
            toolCallCount: roundToolCallIds.size,
            providerId: requestProviderId,
            model: requestModelLabel,
            agentId: requestAgentId,
            ...(shouldAttachFirstTokenLatency && firstTokenObservedAt !== null
              ? { firstTokenLatencyMs: firstTokenObservedAt - requestStartedAt }
              : {}),
            status: 'completed',
          },
          roundToolCallIds,
        ),
      );
      if (shouldAttachFirstTokenLatency) {
        firstTokenLatencyAttached = true;
      }

      accumulated = '';
      accumulatedThinking = '';
      accumulatedThinkingBlocks = [];
      accumulatedSegments = [];
      reasoningSegmentMeta.clear();
      liveToolCalls.clear();
      streamRevealTargetRef.current = '';
      streamRevealVisibleRef.current = '';
      streamRevealTargetCodePointsRef.current = [];
      streamRevealVisibleCodePointCountRef.current = 0;
      streamRevealNextAllowedAtRef.current = 0;
      setStreamBuffer('');
      setStreamThinkingBuffer('');
      setStreamingSegments([]);
      setStreamThinkingBlocks([]);
      currentAssistantStreamMessageIdRef.current = makeOrderedMessageId();
      currentRoundStartedAt = timestamp;
    };

    setRightPanelState((prev) => startChatRightPanelRun(prev, text));

    client.stream(sid, requestText, {
      agentId: effectiveAgentId,
      dialogueMode,
      displayMessage: displayMessageForStream,
      ...(requestInputParts ? { inputParts: requestInputParts } : {}),
      onEvent: (event) => {
        if (activeSessionRef.current !== sid) {
          return;
        }

        if (event.type === 'tool_call_delta') {
          toolCallIds.add(event.toolCallId);
          const previous = liveToolCalls.get(event.toolCallId);
          const nextInputText = `${previous?.inputText ?? ''}${event.inputDelta}`;
          liveToolCalls.set(event.toolCallId, {
            createdAt: previous?.createdAt ?? event.occurredAt ?? Date.now(),
            inputText: nextInputText,
            output: previous?.output,
            isError: previous?.isError,
            resumedAfterApproval: previous?.resumedAfterApproval,
            toolCallId: event.toolCallId,
            status: 'streaming',
            toolName: event.toolName,
          });
          // Mirror into the ordered segment list — first delta opens a new
          // tool segment positioned at the current end of the list, later
          // deltas update the segment in place with the parsed input.
          accumulatedSegments = upsertStreamingToolSegment(accumulatedSegments, {
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            input: parseToolCallInputText(nextInputText),
            status: 'running',
            kind: resolveAssistantCapabilityKind(event.toolName) as
              | 'agent'
              | 'mcp'
              | 'skill'
              | 'tool'
              | undefined,
          });
          scheduleSegmentsFlush();
        }

        if (event.type === 'usage') {
          setReportedStreamUsage((previous) => mergeChatBackendUsageSnapshot(previous, event));
        }

        if (event.type === 'tool_progress') {
          const previous = liveToolCalls.get(event.toolCallId);
          liveToolCalls.set(event.toolCallId, {
            createdAt: previous?.createdAt ?? event.occurredAt ?? Date.now(),
            inputText: previous?.inputText ?? '',
            output: previous?.output,
            isError: previous?.isError,
            toolCallId: event.toolCallId,
            status: 'streaming',
            toolName: event.toolName,
            batchProgress: {
              subTools: event.subTools,
              completedCount: event.completedCount,
              totalCount: event.totalCount,
            },
          });
        }

        if (event.type === 'tool_result') {
          toolCallIds.add(event.toolCallId);
          const previous = liveToolCalls.get(event.toolCallId);
          const rawPendingPermissionRequestId = event.pendingPermissionRequestId;
          const hasPendingPermission = hasActivePendingPermissionRequest(event);
          liveToolCalls.set(event.toolCallId, {
            createdAt: previous?.createdAt ?? event.occurredAt ?? Date.now(),
            completedAt: event.occurredAt ?? Date.now(),
            inputText: previous?.inputText ?? '',
            output: event.output,
            isError: hasPendingPermission ? false : event.isError,
            pendingPermissionRequestId: hasPendingPermission
              ? event.pendingPermissionRequestId
              : undefined,
            resumedAfterApproval: event.resumedAfterApproval,
            toolCallId: event.toolCallId,
            status: hasPendingPermission ? 'paused' : event.isError ? 'error' : 'completed',
            toolName: event.toolName,
          });
          // Update the matching tool segment with the result so the live
          // render (and the about-to-be-committed round message) shows the
          // tool output / error status alongside the right tool call.
          accumulatedSegments = applyToolResultToStreamingSegment(accumulatedSegments, {
            toolCallId: event.toolCallId,
            output: event.output,
            isError: hasPendingPermission ? false : event.isError,
            status: hasPendingPermission ? 'paused' : event.isError ? 'failed' : 'completed',
            ...(hasPendingPermission && rawPendingPermissionRequestId
              ? { pendingPermissionRequestId: rawPendingPermissionRequestId }
              : {}),
            ...(event.resumedAfterApproval ? { resumedAfterApproval: true } : {}),
          });
          scheduleSegmentsFlush();
          setMessages((previousMessages) => {
            const nextMessages = applyToolResultToLocalAssistantMessages(previousMessages, event);
            return typeof rawPendingPermissionRequestId === 'string' &&
              rawPendingPermissionRequestId.length > 0 &&
              !hasPendingPermission
              ? dismissPermissionEventMessage(nextMessages, rawPendingPermissionRequestId)
              : nextMessages;
          });
          if (
            typeof rawPendingPermissionRequestId === 'string' &&
            rawPendingPermissionRequestId.length > 0 &&
            !hasPendingPermission
          ) {
            setPendingPermissions((previousPermissions) =>
              previousPermissions.filter(
                (permission) => permission.requestId !== rawPendingPermissionRequestId,
              ),
            );
          }
        }

        if (event.type === 'session_child') {
          setChildSessions((previous) => {
            if (previous.some((session) => session.id === event.sessionId)) {
              return previous.map((session) =>
                session.id === event.sessionId
                  ? { ...session, title: event.title ?? session.title }
                  : session,
              );
            }

            return [
              {
                id: event.sessionId,
                title: event.title,
              },
              ...previous,
            ];
          });
        }

        if (event.type === 'task_update') {
          setSessionTasks((previous) => {
            const existingTask = previous.find((task) => task.id === event.taskId);
            const nextTask: SessionTask = {
              assignedAgent: event.assignedAgent ?? existingTask?.assignedAgent,
              blockedBy: existingTask?.blockedBy ?? [],
              completedSubtaskCount: existingTask?.completedSubtaskCount ?? 0,
              createdAt: existingTask?.createdAt ?? event.occurredAt ?? Date.now(),
              depth: event.parentTaskId ? 1 : (existingTask?.depth ?? 0),
              errorMessage: event.errorMessage ?? existingTask?.errorMessage,
              id: event.taskId,
              parentTaskId: event.parentTaskId,
              priority: existingTask?.priority ?? 'medium',
              readySubtaskCount: existingTask?.readySubtaskCount ?? 0,
              result: event.result ?? existingTask?.result,
              sessionId: event.sessionId ?? existingTask?.sessionId,
              status:
                event.status === 'in_progress'
                  ? 'running'
                  : event.status === 'done'
                    ? 'completed'
                    : event.status,
              subtaskCount: existingTask?.subtaskCount ?? 0,
              tags: existingTask?.tags ?? [],
              terminalReason: event.reason ?? existingTask?.terminalReason,
              timeoutSource: event.timeoutSource ?? existingTask?.timeoutSource,
              title: event.label,
              unmetDependencyCount: existingTask?.unmetDependencyCount ?? 0,
              updatedAt: event.occurredAt ?? Date.now(),
            };

            const existingIndex = previous.findIndex((task) => task.id === event.taskId);
            if (existingIndex === -1) {
              return [nextTask, ...previous];
            }

            return previous.map((task, index) =>
              index === existingIndex ? { ...task, ...nextTask } : task,
            );
          });
        }

        if (event.type === 'permission_asked') {
          // Auto-accept: if enabled for this session, auto-reply 'once' without pausing.
          // Mirrors opencode's permission-auto-respond pattern.
          if (token && isAutoAcceptEnabled(sid)) {
            void replyPermissionRequest({
              decision: 'once',
              gatewayUrl,
              requestId: event.requestId,
              sessionId: sid,
              token,
            }).catch(() => {
              // Fallback: if auto-reply fails, show permission UI normally
              setSessionStateStatus('paused');
              setMessages((previous) => upsertPermissionEventMessage(previous, event));
            });
          } else {
            pausedForPermission = true;
            setSessionStateStatus('paused');
            setMessages((previous) => upsertPermissionEventMessage(previous, event));
            setPendingPermissions((previous) => {
              return dedupePendingPermissionRequests([
                createPendingPermissionRequestSnapshot(event, sid),
                ...previous,
              ]);
            });
            // NOTE: Do NOT call resetStreamState() here.
            // permission_asked arrives before onDone(tool_permission). Resetting stream state
            // here clears currentAssistantStreamMessageIdRef, causing onDone to create a
            // duplicate assistant message with a new ID. Let onDone handle the reset.
            requestSessionListRefresh();
          }
        }

        if (event.type === 'permission_replied') {
          if (event.decision !== 'reject') {
            setSessionStateStatus('running');
          }
          setMessages((previous) =>
            dismissPermissionEventMessage(
              applyPermissionDecisionToLocalAssistantMessages(
                previous,
                event.requestId,
                event.decision,
                event.feedback,
              ),
              event.requestId,
            ),
          );
          setPendingPermissions((previous) =>
            previous.filter((permission) => permission.requestId !== event.requestId),
          );
          setRightPanelState((previous) =>
            clearResolvedPendingPermissionToolCalls(previous, event.requestId, event.decision),
          );
          requestCurrentSessionRefresh(sid);
        }

        if (event.type === 'question_asked') {
          pausedForQuestion = true;
          setSessionStateStatus('paused');
          resetStreamState();
          requestCurrentSessionRefresh(sid);
          requestSessionListRefresh();
        }

        if (event.type === 'question_replied') {
          setSessionStateStatus(event.status === 'answered' ? 'running' : 'idle');
          requestCurrentSessionRefresh(sid);
        }

        setRightPanelState((prev) => {
          if (
            event.type === 'tool_call_delta' ||
            event.type === 'tool_search' ||
            event.type === 'done' ||
            event.type === 'error'
          ) {
            return applyChatRightPanelChunk(prev, event);
          }
          return applyChatRightPanelEvent(prev, event);
        });

        if (!isNearBottomRef.current) {
          setHasPendingFollowContent((previous) => previous || true);
        }

        if (shouldShowRunEventInTranscript(event)) {
          appendAssistantEventMessages([event]);
        }
      },
      onDelta: (delta: string) => {
        if (activeSessionRef.current !== sid || stoppingStreamRef.current) {
          return;
        }
        if (firstTokenObservedAt === null) {
          firstTokenObservedAt = Date.now();
          setActiveStreamFirstTokenLatencyMs(firstTokenObservedAt - requestStartedAt);
        }
        accumulated += delta;
        // Mirror the delta into the ordered segment list so the live render
        // reflects the true wire-arrival order. Coalesces consecutive text
        // deltas into a single trailing text segment if no other segment
        // (reasoning / tool) was recorded between them.
        const messageId = currentAssistantStreamMessageIdRef.current ?? makeOrderedMessageId();
        accumulatedSegments = appendStreamingTextDelta(accumulatedSegments, delta, messageId);
        scheduleSegmentsFlush();
        streamRevealTargetRef.current = accumulated;
        streamRevealTargetCodePointsRef.current.push(...Array.from(delta));
        const shouldRevealStructuredContentImmediately =
          isImmediatelyRenderableStructuredContent(accumulated);
        if (prefersReducedMotion || shouldRevealStructuredContentImmediately) {
          streamRevealVisibleRef.current = accumulated;
          streamRevealVisibleCodePointCountRef.current =
            streamRevealTargetCodePointsRef.current.length;
          streamRevealNextAllowedAtRef.current = 0;
          setStreamBuffer(accumulated);
        } else {
          scheduleStreamReveal();
        }
        if (!isNearBottomRef.current) {
          setHasPendingFollowContent((previous) => previous || true);
        }
      },
      onThinkingDelta: (chunk: StreamThinkingChunk) => {
        if (activeSessionRef.current !== sid || stoppingStreamRef.current) {
          return;
        }

        if (liveToolCalls.size > 0) {
          closeCurrentStreamingRoundIntoMessage(Date.now());
        }

        accumulatedThinkingBlocks = appendStreamingThinkingChunk(accumulatedThinkingBlocks, chunk);
        accumulatedThinking = joinStreamingThinkingTexts(accumulatedThinkingBlocks);
        // Mirror reasoning chunks into the ordered segment list. Each
        // reasoning block has a stable identity (itemId/outputIndex/...) so
        // late deltas of the same block extend the existing segment in place
        // even if text/tool segments arrived between two reasoning chunks.
        const messageId = currentAssistantStreamMessageIdRef.current ?? makeOrderedMessageId();
        accumulatedSegments = appendStreamingThinkingDelta(
          accumulatedSegments,
          reasoningSegmentMeta,
          chunk,
          messageId,
        );
        scheduleSegmentsFlush();
        // Coalesce per-chunk setState into one React commit per animation frame
        // — SSE `EventSource.onmessage` runs outside React's batching scope, so
        // an unthrottled setState here would force a synchronous render (incl.
        // markdown / rehype-highlight) for every reasoning delta, blocking the
        // main thread for 100–400ms on dense streams.
        scheduleThinkingFlush();
      },
      onThinkingEnd: (chunk) => {
        if (activeSessionRef.current !== sid || stoppingStreamRef.current) {
          return;
        }
        accumulatedThinkingBlocks = markStreamingThinkingChunkEnded(
          accumulatedThinkingBlocks,
          chunk,
        );
        accumulatedSegments = markStreamingReasoningSegmentEnded(
          accumulatedSegments,
          reasoningSegmentMeta,
          chunk,
        );
        scheduleSegmentsFlush();
        scheduleThinkingFlush();
      },
      onToolCall: (chunk) => {
        if (activeSessionRef.current !== sid) {
          return;
        }
        toolCallIds.add(chunk.toolCallId);
        if (!toolPanelRevealed) {
          toolPanelRevealed = true;
          if (!rightOpenRef.current) {
            setRightTab('tools');
          }
        }
      },
      onDone: (stopReason, streamAgentId) => {
        if (activeSessionRef.current !== sid) {
          requestSessionListRefresh();
          return;
        }
        // question_asked already called resetStreamState(), so an unexpected onDone
        // would create a duplicate assistant message with a fresh ID. Bail out.
        if (pausedForQuestion) {
          requestSessionListRefresh();
          return;
        }
        const finishedAt = Date.now();
        const resolvedStopReason = stopReason ?? 'end_turn';
        const wasCancelled = String(resolvedStopReason) === 'cancelled';
        const isPausedForPermission = resolvedStopReason === 'tool_permission';
        const finalAccumulatedText = wasCancelled ? streamRevealVisibleRef.current : accumulated;
        const traceFinalStatus = wasCancelled
          ? 'cancelled'
          : resolvedStopReason === 'error'
            ? 'error'
            : isPausedForPermission
              ? 'paused'
              : 'completed';
        const hasRenderableAssistantReply =
          finalAccumulatedText.trim().length > 0 ||
          accumulatedThinking.trim().length > 0 ||
          toolCallIds.size > 0;
        if (hasRenderableAssistantReply || !wasCancelled) {
          const msgId = currentAssistantStreamMessageIdRef.current ?? makeOrderedMessageId();
          const {
            content,
            parts: legacyParts,
            reasoningBlocksEndedFlags,
            reasoningBlocksDurationsMs,
          } = buildAssistantTraceMessage(msgId, finalAccumulatedText, traceFinalStatus);
          // Prefer the ordered segment list as the canonical parts source so
          // the final committed message reflects the wire-arrival order. The
          // legacy `partsFromAssistantTrace`-built parts are kept as a
          // fallback for paths that don't accumulate segments (e.g. pre-flush
          // races where text arrived but no segment was opened yet).
          const parts = accumulatedSegments.length > 0 ? accumulatedSegments : legacyParts;
          // After round-boundary commits, only the final round's tool calls are
          // attached to this message; earlier rounds were already persisted as
          // independent assistant messages by closeCurrentStreamingRoundIntoMessage.
          const finalRoundToolCallIds = new Set(liveToolCalls.keys());
          const shouldAttachFirstTokenLatency =
            firstTokenObservedAt !== null && !firstTokenLatencyAttached;
          setMessages((prev) =>
            replaceOrAppendStreamedAssistantMessage(
              prev,
              {
                id: msgId,
                role: 'assistant',
                content,
                parts,
                ...(reasoningBlocksEndedFlags ? { reasoningBlocksEndedFlags } : {}),
                ...(reasoningBlocksDurationsMs ? { reasoningBlocksDurationsMs } : {}),
                createdAt: finishedAt,
                durationMs: finishedAt - currentRoundStartedAt,
                stopReason: resolvedStopReason,
                tokenEstimate: estimateTokenCount(
                  [accumulatedThinking, finalAccumulatedText]
                    .filter((item) => item.trim().length > 0)
                    .join('\n\n'),
                ),
                toolCallCount: finalRoundToolCallIds.size,
                providerId: requestProviderId,
                model: requestModelLabel,
                agentId: streamAgentId || requestAgentId,
                ...(shouldAttachFirstTokenLatency && firstTokenObservedAt !== null
                  ? {
                      firstTokenLatencyMs: firstTokenObservedAt - requestStartedAt,
                    }
                  : {}),
                status: 'completed',
              },
              finalRoundToolCallIds,
            ),
          );
          if (shouldAttachFirstTokenLatency) {
            firstTokenLatencyAttached = true;
          }
        } else if (wasCancelled) {
          const msgId = currentAssistantStreamMessageIdRef.current ?? makeOrderedMessageId();
          const {
            content,
            parts: legacyParts,
            reasoningBlocksEndedFlags,
            reasoningBlocksDurationsMs,
          } = buildAssistantTraceMessage(msgId, '已停止', traceFinalStatus);
          // Prefer the wire-ordered segments collected so far; only fall back
          // to the legacy reasoning → text → tool flattening when no segments
          // were captured (e.g. cancellation before any chunk arrived).
          const parts = accumulatedSegments.length > 0 ? accumulatedSegments : legacyParts;
          const finalRoundToolCallIds = new Set(liveToolCalls.keys());
          const shouldAttachFirstTokenLatency =
            firstTokenObservedAt !== null && !firstTokenLatencyAttached;
          setMessages((prev) =>
            replaceOrAppendStreamedAssistantMessage(
              prev,
              {
                id: msgId,
                role: 'assistant',
                content,
                parts,
                ...(reasoningBlocksEndedFlags ? { reasoningBlocksEndedFlags } : {}),
                ...(reasoningBlocksDurationsMs ? { reasoningBlocksDurationsMs } : {}),
                createdAt: finishedAt,
                durationMs: finishedAt - currentRoundStartedAt,
                stopReason: resolvedStopReason,
                tokenEstimate: estimateTokenCount(
                  [accumulatedThinking, '已停止']
                    .filter((item) => item.trim().length > 0)
                    .join('\n\n'),
                ),
                toolCallCount: finalRoundToolCallIds.size,
                providerId: requestProviderId,
                model: requestModelLabel,
                agentId: streamAgentId || requestAgentId,
                ...(shouldAttachFirstTokenLatency && firstTokenObservedAt !== null
                  ? {
                      firstTokenLatencyMs: firstTokenObservedAt - requestStartedAt,
                    }
                  : {}),
                status: 'completed',
              },
              finalRoundToolCallIds,
            ),
          );
          if (shouldAttachFirstTokenLatency) {
            firstTokenLatencyAttached = true;
          }
        }
        setSessionStateStatus(isPausedForPermission ? 'paused' : 'idle');
        resetStreamState();
        window.setTimeout(() => {
          void loadCurrentSessionSnapshot(sid, {
            messageLimit: INITIAL_TURN_LIMIT,
          }).catch(() => undefined);
        }, 500);
        requestSessionListRefresh();
      },
      onError: (code: string, message?: string) => {
        if (activeSessionRef.current !== sid) {
          requestSessionListRefresh();
          return;
        }
        if (pausedForPermission || pausedForQuestion) {
          requestSessionListRefresh();
          return;
        }
        const finishedAt = Date.now();
        const errorContent = message ? `[错误: ${code}] ${message}` : `[错误: ${code}]`;
        logger.error('stream error', message ? `${code}: ${message}` : code);
        const errorMsgId = makeOrderedMessageId();
        const { content: errorTraceContent, parts: errorParts } = buildAssistantTraceMessage(
          errorMsgId,
          errorContent,
          'error',
        );
        const errorRoundToolCallIds = new Set(liveToolCalls.keys());
        const shouldAttachFirstTokenLatency =
          firstTokenObservedAt !== null && !firstTokenLatencyAttached;
        setMessages((prev) => [
          ...prev,
          {
            id: errorMsgId,
            role: 'assistant',
            content: errorTraceContent,
            parts: errorParts,
            createdAt: finishedAt,
            durationMs: finishedAt - currentRoundStartedAt,
            stopReason: 'error',
            tokenEstimate: estimateTokenCount(
              [accumulatedThinking, errorContent]
                .filter((item) => item.trim().length > 0)
                .join('\n\n'),
            ),
            toolCallCount: errorRoundToolCallIds.size,
            providerId: requestProviderId,
            model: requestModelLabel,
            agentId: requestAgentId,
            ...(shouldAttachFirstTokenLatency && firstTokenObservedAt !== null
              ? { firstTokenLatencyMs: firstTokenObservedAt - requestStartedAt }
              : {}),
            status: 'error',
          },
        ]);
        if (shouldAttachFirstTokenLatency) {
          firstTokenLatencyAttached = true;
        }
        setSessionStateStatus('idle');
        resetStreamState();
        setStreamError(message ? `${code}: ${message}` : code);
        requestSessionListRefresh();
      },
      model: activeModelId || 'default',
      providerId: activeProviderId || undefined,
      thinkingEnabled: requestModelSupportsThinking ? thinkingEnabled : false,
      reasoningEffort: requestModelSupportsThinking
        ? thinkingEnabled && detectThinkKeyword(requestText)
          ? 'high'
          : reasoningEffort
        : undefined,
      webSearchEnabled,
      yoloMode,
    });
    return true;
  }

  sendMessageRef.current = sendMessage;

  const {
    resolveAssistantCapabilityKind,
    appendAssistantDerivedMessages,
    appendAssistantEventMessages,
  } = useAssistantMessageProcessing({
    composerWorkspaceCatalog,
    setMessages,
  });

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
      setEditorMode,
      setSaving,
      splitDragging,
      splitContainerRef,
      setSplitPos,
    });

  const refreshSessionsAfterInlinePermissionReply = useCallback(
    (targetSessionId: string) => {
      const refreshTargets = new Set<string>();
      if (currentSessionId) {
        refreshTargets.add(currentSessionId);
      }
      refreshTargets.add(targetSessionId);

      const flushRefresh = () => {
        refreshTargets.forEach((sessionId) => {
          requestCurrentSessionRefresh(sessionId);
        });
        requestSessionListRefresh();
      };

      flushRefresh();
      window.setTimeout(() => {
        flushRefresh();
      }, 2000);
    },
    [currentSessionId],
  );

  const handleInlinePermissionDecision = useCallback(
    async (request: PendingPermissionRequest, decision: PermissionDecision, feedback?: string) => {
      if (!token) {
        setStreamError('当前未登录，无法处理权限审批。');
        return;
      }

      setInlinePermissionPendingDecision({
        decision,
        requestId: request.requestId,
      });
      setInlinePermissionErrors((previous) => {
        const next = { ...previous };
        delete next[request.requestId];
        return next;
      });

      try {
        await replyPermissionRequest({
          decision,
          feedback,
          gatewayUrl,
          requestId: request.requestId,
          sessionId: request.sessionId,
          token,
        });
        const successMessage = getPermissionReplySuccessMessage(decision);
        setMessages((previous) =>
          dismissPermissionEventMessage(
            applyPermissionDecisionToLocalAssistantMessages(
              previous,
              request.requestId,
              decision,
              feedback,
            ),
            request.requestId,
          ),
        );
        setPendingPermissions((previous) =>
          previous.filter((permission) => permission.requestId !== request.requestId),
        );
        setRightPanelState((previous) =>
          clearResolvedPendingPermissionToolCalls(previous, request.requestId, decision),
        );
        toast(successMessage, decision === 'reject' ? 'warning' : 'success', 2200);
        refreshSessionsAfterInlinePermissionReply(request.sessionId);
      } catch (error) {
        const status = getPermissionReplyStatusCode(error);
        const errorMessage = error instanceof Error ? error.message : '权限处理失败，请重试。';

        if (status === 404 || status === 409) {
          setPendingPermissions((previous) =>
            previous.filter((permission) => permission.requestId !== request.requestId),
          );
          refreshSessionsAfterInlinePermissionReply(request.sessionId);
        } else {
          setInlinePermissionErrors((previous) => ({
            ...previous,
            [request.requestId]: errorMessage,
          }));
        }
      } finally {
        setInlinePermissionPendingDecision((current) =>
          current?.requestId === request.requestId ? null : current,
        );
      }
    },
    [
      gatewayUrl,
      refreshSessionsAfterInlinePermissionReply,
      setRightPanelState,
      token,
      setStreamError,
    ],
  );

  const pendingPermissionsById = useMemo(
    () => new Map(pendingPermissions.map((permission) => [permission.requestId, permission])),
    [pendingPermissions],
  );

  const resolveInlinePermissionActions = useCallback(
    (requestId: string) => {
      const request = pendingPermissionsById.get(requestId);
      if (!request) {
        return undefined;
      }

      const pendingDecision =
        inlinePermissionPendingDecision?.requestId === requestId
          ? inlinePermissionPendingDecision.decision
          : null;
      const disabled = pendingDecision !== null;

      return {
        items: [
          {
            id: 'session',
            label: pendingDecision === 'session' ? '处理中…' : '本会话允许',
            disabled,
            hint: '仅在当前会话内记住这次授权选择，适合继续当前任务。',
            primary: true,
            onClick: () => void handleInlinePermissionDecision(request, 'session'),
          },
          {
            id: 'once',
            label: pendingDecision === 'once' ? '处理中…' : '允许一次',
            disabled,
            hint: '只批准当前这一次工具调用，不保留后续授权。',
            onClick: () => void handleInlinePermissionDecision(request, 'once'),
          },
          {
            id: 'permanent',
            label: pendingDecision === 'permanent' ? '处理中…' : '永久允许',
            disabled,
            hint: '会记住后续同类请求，请在充分确认风险后再使用。',
            onClick: () => void handleInlinePermissionDecision(request, 'permanent'),
          },
          {
            id: 'reject',
            label: pendingDecision === 'reject' ? '处理中…' : '拒绝',
            danger: true,
            disabled,
            hint: '阻止本次调用，工具不会继续执行。',
            onClick: () => void handleInlinePermissionDecision(request, 'reject'),
          },
        ],
        pendingLabel: pendingDecision
          ? '正在提交审批结果…'
          : '推荐：本会话允许 · 临时：允许一次 · 持久：永久允许',
        helperMessage: pendingDecision ? undefined : '永久允许会记住后续同类请求，请谨慎选择。',
        errorMessage: inlinePermissionErrors[requestId],
      };
    },
    [
      handleInlinePermissionDecision,
      inlinePermissionErrors,
      inlinePermissionPendingDecision,
      pendingPermissionsById,
    ],
  );

  useEffect(() => {
    const attachEligibility = {
      activeGatewayStreamSessionId,
      currentSessionId,
      isPageActive,
      isSessionSnapshotReady,
      recoveryActiveStreamPresent: recoveryActiveStream !== null,
      sessionModesHydrated,
      sessionStateStatus,
      streaming,
    };
    const shouldAttemptAttach = shouldAttemptAttachToSession(attachEligibility);
    // The effect re-runs on every token delta because `streaming` /
    // `sessionStateStatus` mutate frequently, so log only when the decision
    // surface actually changes — otherwise the console becomes unreadable
    // during normal streams. Track the last signature on the ref attached
    // earlier in this component instead of allocating a new ref per render.
    const eligibilitySignature = `${currentSessionId ?? 'none'}|${shouldAttemptAttach ? 1 : 0}|${attachEligibility.sessionStateStatus ?? 'null'}|${attachEligibility.streaming ? 1 : 0}|${attachEligibility.recoveryActiveStreamPresent ? 1 : 0}|${attachEligibility.activeGatewayStreamSessionId ?? 'null'}|${attachEligibility.isSessionSnapshotReady ? 1 : 0}|${attachEligibility.sessionModesHydrated ? 1 : 0}|${attachEligibility.isPageActive ? 1 : 0}|${attachAttemptedSessionRef.current ?? 'none'}`;
    if (attachEligibilitySignatureRef.current !== eligibilitySignature) {
      attachEligibilitySignatureRef.current = eligibilitySignature;
      console.log('[ATTACH_ELIGIBILITY]', currentSessionId, {
        shouldAttemptAttach,
        ...attachEligibility,
        attachAttempted: attachAttemptedSessionRef.current,
      });
    }

    if (!shouldAttemptAttach || !currentSessionId) {
      cancelAttachRetry();
      if (shouldResetAttachAttempt(attachEligibility)) {
        attachAttemptedSessionRef.current = null;
      }
      return;
    }

    if (attachAttemptedSessionRef.current === currentSessionId) {
      return;
    }
    attachAttemptedSessionRef.current = currentSessionId;
    console.log('[ATTACH_ELIGIBILITY] proceeding with attach for', currentSessionId);

    const sid = currentSessionId;
    const attachSessionViewEpoch = currentSessionViewRef.current.epoch;
    const initialText = recoveredStreamSnapshot?.text ?? '';
    const initialThinkingBlocks = recoveredStreamSnapshot?.thinkingBlocks ?? [];
    const initialThinking = joinStreamingThinkingTexts(initialThinkingBlocks);
    const initialUsage = recoveredStreamSnapshot?.usage ?? null;
    const requestStartedAt = recoveredStreamSnapshot?.startedAt ?? Date.now();
    const requestProviderId = activeProviderId || undefined;
    const requestModelLabel = activeModelId || undefined;
    const requestAgentId = effectiveAgentId || undefined;
    const recoveredModifiedFilesSummary = recoveredStreamSnapshot?.modifiedFilesSummary;
    const requestTextCodePoints = Array.from(initialText);
    let attachStateInitialized = false;
    let accumulated = initialText;
    let accumulatedThinking = initialThinking;
    let accumulatedThinkingBlocks = initialThinkingBlocks;
    let accumulatedUsage = initialUsage;
    // Mirror the live-stream path: keep a wire-faithful ordered segment list
    // so attach-rendered messages preserve the same reasoning/text/tool
    // interleaving as the gateway recorded. Initial value is empty because
    // the recovery snapshot's reasoning/text/toolCalls are reconstructed via
    // ensureAttachStateInitialized below.
    let accumulatedSegments: ChatMessagePart[] = [];
    const reasoningSegmentMeta = new Map<string, { blockKey: string }>();
    let pendingThinkingFlushFrame: number | null = null;
    let pendingSegmentsFlushFrame: number | null = null;
    const flushThinkingState = () => {
      pendingThinkingFlushFrame = null;
      // Late RAF after attach was torn down (session switch / cancel /
      // round-close) must not overwrite the cleared buffer with stale text.
      if (!streamingRef.current || !isCurrentSessionRequest(sid, attachSessionViewEpoch)) {
        return;
      }
      setStreamThinkingBlocks(accumulatedThinkingBlocks);
      setStreamThinkingBuffer(accumulatedThinking);
    };
    const scheduleThinkingFlush = () => {
      if (pendingThinkingFlushFrame !== null) return;
      pendingThinkingFlushFrame = window.requestAnimationFrame(flushThinkingState);
    };
    const cancelThinkingFlush = () => {
      if (pendingThinkingFlushFrame !== null) {
        window.cancelAnimationFrame(pendingThinkingFlushFrame);
        pendingThinkingFlushFrame = null;
      }
    };
    const flushSegmentsState = () => {
      pendingSegmentsFlushFrame = null;
      if (!streamingRef.current || !isCurrentSessionRequest(sid, attachSessionViewEpoch)) {
        return;
      }
      setStreamingSegments(accumulatedSegments);
    };
    const scheduleSegmentsFlush = () => {
      if (pendingSegmentsFlushFrame !== null) return;
      pendingSegmentsFlushFrame = window.requestAnimationFrame(flushSegmentsState);
    };
    const cancelSegmentsFlush = () => {
      if (pendingSegmentsFlushFrame !== null) {
        window.cancelAnimationFrame(pendingSegmentsFlushFrame);
        pendingSegmentsFlushFrame = null;
      }
    };
    let firstTokenObservedAt: number | null = null;
    let pausedForPermission = false;
    let pausedForQuestion = false;
    let currentRoundStartedAt = requestStartedAt;
    let firstTokenLatencyAttached = false;
    const toolCallIds = new Set<string>();
    const liveToolCalls = new Map<string, LiveToolCallState>();
    const buildAttachToolCalls = (): AssistantTraceToolCall[] => {
      return Array.from(liveToolCalls.values()).map((toolCallState) => {
        const hasPendingPermission = hasActivePendingPermissionRequest({
          isError: toolCallState.isError,
          pendingPermissionRequestId: toolCallState.pendingPermissionRequestId,
          resumedAfterApproval: toolCallState.resumedAfterApproval,
          status: toolCallState.status,
        });
        const status: 'running' | 'paused' | 'completed' | 'failed' =
          toolCallState.status === 'error'
            ? 'failed'
            : toolCallState.status === 'paused'
              ? 'paused'
              : toolCallState.status === 'completed'
                ? 'completed'
                : 'running';

        const durationMs =
          toolCallState.completedAt && toolCallState.createdAt
            ? toolCallState.completedAt - toolCallState.createdAt
            : undefined;

        return {
          kind: resolveAssistantCapabilityKind(toolCallState.toolName),
          toolCallId: toolCallState.toolCallId,
          toolName: toolCallState.toolName,
          input: {
            ...parseToolCallInputText(toolCallState.inputText),
            ...(toolCallState.batchProgress ? { _batchProgress: toolCallState.batchProgress } : {}),
          },
          output: toolCallState.output,
          isError: toolCallState.isError,
          ...(hasPendingPermission
            ? {
                pendingPermissionRequestId: toolCallState.pendingPermissionRequestId,
              }
            : {}),
          resumedAfterApproval: toolCallState.resumedAfterApproval,
          status,
          ...(durationMs !== undefined ? { durationMs } : {}),
        } satisfies AssistantTraceToolCall;
      });
    };
    const buildAttachTraceMessage = (
      messageId: string,
      textContent: string,
      finalStatus?: 'completed' | 'error' | 'cancelled' | 'paused',
    ): {
      content: string;
      parts: ChatMessagePart[];
      reasoningBlocksEndedFlags?: boolean[];
      reasoningBlocksDurationsMs?: number[];
    } => {
      const toolCalls = buildAttachToolCalls().map((toolCallState) => {
        if (finalStatus === 'error' && toolCallState.status === 'running') {
          return { ...toolCallState, isError: true, status: 'failed' as const };
        }

        if (finalStatus === 'completed' && toolCallState.status === 'running') {
          return { ...toolCallState, status: 'completed' as const };
        }

        if (
          (finalStatus === 'cancelled' || finalStatus === 'paused') &&
          toolCallState.status === 'running'
        ) {
          return { ...toolCallState, status: 'paused' as const };
        }

        return toolCallState;
      });

      const reasoningBlocks = extractStreamingThinkingTexts(accumulatedThinkingBlocks);
      const reasoningBlocksEndedFlags =
        reasoningBlocks.length > 0
          ? extractStreamingThinkingEndedFlags(accumulatedThinkingBlocks)
          : undefined;
      const reasoningBlocksDurationsMs =
        reasoningBlocks.length > 0
          ? extractStreamingThinkingDurations(accumulatedThinkingBlocks)
          : undefined;
      const reasoningBlocksTimings =
        reasoningBlocks.length > 0
          ? accumulatedThinkingBlocks
              .filter((block) => block.text.trim().length > 0)
              .map((block) => ({
                ...(typeof block.startedAt === 'number' ? { startedAt: block.startedAt } : {}),
                ...(typeof block.endedAt === 'number' ? { endedAt: block.endedAt } : {}),
              }))
          : undefined;
      const hasPersistableTiming =
        reasoningBlocksTimings?.some(
          (entry) => typeof entry.startedAt === 'number' || typeof entry.endedAt === 'number',
        ) ?? false;
      const tracePayload = {
        ...(recoveredModifiedFilesSummary
          ? { modifiedFilesSummary: recoveredModifiedFilesSummary }
          : {}),
        ...(reasoningBlocks.length > 0 ? { reasoningBlocks } : {}),
        ...(hasPersistableTiming && reasoningBlocksTimings ? { reasoningBlocksTimings } : {}),
        text: textContent,
        toolCalls,
      };
      const content = textContent;
      const parts = partsFromAssistantTrace(messageId, tracePayload);
      return {
        content,
        parts,
        ...(reasoningBlocksEndedFlags ? { reasoningBlocksEndedFlags } : {}),
        ...(reasoningBlocksDurationsMs ? { reasoningBlocksDurationsMs } : {}),
      };
    };

    // Mirror the main stream handler's round-boundary commit logic so attach
    // (session-recovery) keeps the same per-round assistant-message structure
    // the gateway persists.
    const closeCurrentAttachRoundIntoMessage = (timestamp: number) => {
      const closingMessageId = currentAssistantStreamMessageIdRef.current;
      if (!closingMessageId) return;
      if (
        liveToolCalls.size === 0 &&
        accumulatedThinking.trim().length === 0 &&
        accumulated.trim().length === 0
      ) {
        return;
      }
      // Cancel pending RAF before resetting thinking buffers below.
      cancelThinkingFlush();
      cancelSegmentsFlush();
      const {
        content,
        parts: legacyParts,
        reasoningBlocksEndedFlags,
        reasoningBlocksDurationsMs,
      } = buildAttachTraceMessage(closingMessageId, accumulated, 'completed');
      // Prefer ordered segments so the committed attach round mirrors the
      // gateway's wire ordering. Fall back to the legacy reordered parts
      // only when no segments accumulated (defensive — should not happen on
      // normal paths since `ensureAttachStateInitialized` has run by now).
      const parts = accumulatedSegments.length > 0 ? accumulatedSegments : legacyParts;
      const roundToolCallIds = new Set(liveToolCalls.keys());
      const shouldAttachFirstTokenLatency =
        firstTokenObservedAt !== null && !firstTokenLatencyAttached;
      setMessages((prev) =>
        replaceOrAppendStreamedAssistantMessage(
          prev,
          {
            id: closingMessageId,
            role: 'assistant',
            content,
            parts,
            ...(reasoningBlocksEndedFlags ? { reasoningBlocksEndedFlags } : {}),
            ...(reasoningBlocksDurationsMs ? { reasoningBlocksDurationsMs } : {}),
            createdAt: timestamp,
            durationMs: timestamp - currentRoundStartedAt,
            tokenEstimate: estimateTokenCount(
              [accumulatedThinking, accumulated]
                .filter((item) => item.trim().length > 0)
                .join('\n\n'),
            ),
            toolCallCount: roundToolCallIds.size,
            providerId: requestProviderId,
            model: requestModelLabel,
            agentId: requestAgentId,
            ...(shouldAttachFirstTokenLatency && firstTokenObservedAt !== null
              ? { firstTokenLatencyMs: firstTokenObservedAt - requestStartedAt }
              : {}),
            status: 'completed',
          },
          roundToolCallIds,
        ),
      );
      if (shouldAttachFirstTokenLatency) {
        firstTokenLatencyAttached = true;
      }

      accumulated = '';
      accumulatedThinking = '';
      accumulatedThinkingBlocks = [];
      accumulatedSegments = [];
      reasoningSegmentMeta.clear();
      liveToolCalls.clear();
      streamRevealTargetRef.current = '';
      streamRevealVisibleRef.current = '';
      streamRevealTargetCodePointsRef.current = [];
      streamRevealVisibleCodePointCountRef.current = 0;
      streamRevealNextAllowedAtRef.current = 0;
      setStreamBuffer('');
      setStreamThinkingBuffer('');
      setStreamingSegments([]);
      setStreamThinkingBlocks([]);
      currentAssistantStreamMessageIdRef.current = makeOrderedMessageId();
      currentRoundStartedAt = timestamp;
    };

    const handleAttachReconnect = () => {
      handleInterruptedAttachStream({
        actions: {
          cancelPendingRevealAnimation: () => {
            if (pendingStreamRevealFrameRef.current !== null) {
              cancelAnimationFrame(pendingStreamRevealFrameRef.current);
              pendingStreamRevealFrameRef.current = null;
            }
          },
          clearCurrentAssistantStreamMessageId: () => {
            currentAssistantStreamMessageIdRef.current = null;
          },
          clearStreamingBuffers: () => {
            setStreamBuffer('');
            setStreamThinkingBuffer('');
            setStreamThinkingBlocks([]);
            setStreamingSegments([]);
          },
          isCurrentSessionRequest,
          loadCurrentSessionSnapshot,
          requestSessionListRefresh,
          resetAttachAttempt: () => {
            attachAttemptedSessionRef.current = null;
          },
          resetRevealState: () => {
            stoppingStreamRef.current = false;
            streamRevealTargetRef.current = '';
            streamRevealVisibleRef.current = '';
            streamRevealTargetCodePointsRef.current = [];
            streamRevealVisibleCodePointCountRef.current = 0;
            streamRevealNextAllowedAtRef.current = 0;
            streamingRef.current = false;
          },
          scheduleAttachRetry,
          setActiveStreamFirstTokenLatencyMs,
          setActiveStreamStartedAt,
          setRecoveredStreamSnapshot,
          setSessionStateStatus,
          setStoppingStream,
          setStreaming,
        },
        attachSessionViewEpoch,
        sessionId: sid,
        state: {
          accumulatedText: accumulated,
          accumulatedThinkingBlocks,
          accumulatedUsage,
          attachStateInitialized,
          currentAssistantStreamMessageId: currentAssistantStreamMessageIdRef.current,
          ...(recoveredModifiedFilesSummary ? { recoveredModifiedFilesSummary } : {}),
          requestStartedAt,
          toolCalls: buildAttachToolCalls(),
        },
      });
    };
    const attachReconnectWiring = createAttachStreamReconnectWiring({
      attachSessionViewEpoch,
      handleAttachReconnect,
      isCurrentSessionRequest,
      requestSessionListRefresh,
      sessionId: sid,
    });

    const ensureAttachStateInitialized = () => {
      if (attachStateInitialized) {
        return;
      }
      attachStateInitialized = true;
      currentAssistantStreamMessageIdRef.current =
        recoveredStreamSnapshot?.messageId ?? makeOrderedMessageId();
      for (const [index, recoveredToolCall] of (
        recoveredStreamSnapshot?.toolCalls ?? []
      ).entries()) {
        const recoveredToolCallId =
          recoveredToolCall.toolCallId ??
          `${currentAssistantStreamMessageIdRef.current ?? 'recovered-stream'}:tool:${index}`;
        toolCallIds.add(recoveredToolCallId);

        let recoveredInputText = '';
        try {
          recoveredInputText = JSON.stringify(recoveredToolCall.input);
        } catch (error) {
          logger.warn('failed to serialize recovered tool input', error);
        }

        liveToolCalls.set(recoveredToolCallId, {
          createdAt: requestStartedAt,
          ...(recoveredToolCall.durationMs !== undefined
            ? { completedAt: requestStartedAt + recoveredToolCall.durationMs }
            : {}),
          inputText: recoveredInputText,
          output: recoveredToolCall.output,
          isError: recoveredToolCall.isError,
          pendingPermissionRequestId: recoveredToolCall.pendingPermissionRequestId,
          resumedAfterApproval: recoveredToolCall.resumedAfterApproval,
          toolCallId: recoveredToolCallId,
          status:
            recoveredToolCall.status === 'paused'
              ? 'paused'
              : recoveredToolCall.status === 'completed'
                ? 'completed'
                : recoveredToolCall.status === 'failed'
                  ? 'error'
                  : 'streaming',
          toolName: recoveredToolCall.toolName,
        });
      }
      // Seed accumulatedSegments from the recovery snapshot. The snapshot
      // schema (text / thinkingBlocks / toolCalls) does not preserve true
      // event order, so we reconstruct using the legacy reasoning → text →
      // tool ordering. New stream events arriving after this point will
      // append in true wire order. After the attach round eventually closes,
      // `loadCurrentSessionSnapshot` reloads from DB which uses
      // `partsFromOrderedAssistantContent` and thus shows the gateway's
      // authoritative ordering.
      const seededMessageId = currentAssistantStreamMessageIdRef.current ?? 'recovered-stream';
      const seededSegments: ChatMessagePart[] = [];
      for (const [index, block] of initialThinkingBlocks.entries()) {
        if (block.text.trim().length === 0) continue;
        const partId = `${seededMessageId}:reasoning:${index}`;
        reasoningSegmentMeta.set(partId, { blockKey: block.key });
        seededSegments.push({
          id: partId,
          type: 'reasoning',
          text: block.text,
          ...(typeof block.startedAt === 'number' ? { startedAt: block.startedAt } : {}),
          ...(typeof block.endedAt === 'number' ? { endedAt: block.endedAt } : {}),
        });
      }
      if (initialText.trim().length > 0) {
        seededSegments.push({
          id: `${seededMessageId}:text`,
          type: 'text',
          text: initialText,
        });
      }
      for (const [, toolCallState] of liveToolCalls.entries()) {
        const inputText = toolCallState.inputText.trim();
        let parsedInput: Record<string, unknown> = {};
        if (inputText.length > 0) {
          try {
            parsedInput = JSON.parse(inputText) as Record<string, unknown>;
          } catch {
            parsedInput = {};
          }
        }
        const status: 'running' | 'paused' | 'completed' | 'failed' =
          toolCallState.status === 'error'
            ? 'failed'
            : toolCallState.status === 'paused'
              ? 'paused'
              : toolCallState.status === 'completed'
                ? 'completed'
                : 'running';
        seededSegments.push({
          id: toolCallState.toolCallId,
          type: 'tool',
          toolCallId: toolCallState.toolCallId,
          toolName: toolCallState.toolName,
          input: parsedInput,
          status,
          ...(toolCallState.output !== undefined ? { output: toolCallState.output } : {}),
          ...(toolCallState.isError !== undefined ? { isError: toolCallState.isError } : {}),
          ...(toolCallState.pendingPermissionRequestId
            ? {
                pendingPermissionRequestId: toolCallState.pendingPermissionRequestId,
              }
            : {}),
          ...(toolCallState.resumedAfterApproval ? { resumedAfterApproval: true } : {}),
          kind: resolveAssistantCapabilityKind(toolCallState.toolName) as
            | 'agent'
            | 'mcp'
            | 'skill'
            | 'tool'
            | undefined,
        });
      }
      accumulatedSegments = seededSegments;
      stoppingStreamRef.current = false;
      streamingRef.current = true;
      setStreaming(true);
      setStoppingStream(false);
      setSessionStateStatus('running');
      setReportedStreamUsage(initialUsage);
      setActiveStreamStartedAt(requestStartedAt);
      setActiveStreamFirstTokenLatencyMs(null);
      setStreamBuffer(initialText);
      setStreamThinkingBuffer(initialThinking);
      setStreamThinkingBlocks(initialThinkingBlocks);
      setStreamingSegments(seededSegments);
      setRecoveredStreamSnapshot(null);
      streamRevealTargetRef.current = initialText;
      streamRevealVisibleRef.current = initialText;
      streamRevealTargetCodePointsRef.current = requestTextCodePoints;
      streamRevealVisibleCodePointCountRef.current = requestTextCodePoints.length;
      streamRevealNextAllowedAtRef.current = 0;
    };

    void client
      .attachToActiveStream(sid, {
        onEvent: (event) => {
          if (!isCurrentSessionRequest(sid, attachSessionViewEpoch)) {
            return;
          }
          ensureAttachStateInitialized();

          if (
            event.type === 'tool_call_delta' ||
            event.type === 'tool_result' ||
            event.type === 'tool_progress'
          ) {
            toolCallIds.add(event.toolCallId);
          }

          if (event.type === 'tool_call_delta') {
            const previous = liveToolCalls.get(event.toolCallId);
            const nextInputText = `${previous?.inputText ?? ''}${event.inputDelta}`;
            liveToolCalls.set(event.toolCallId, {
              createdAt: previous?.createdAt ?? event.occurredAt ?? Date.now(),
              inputText: nextInputText,
              output: previous?.output,
              isError: previous?.isError,
              resumedAfterApproval: previous?.resumedAfterApproval,
              toolCallId: event.toolCallId,
              status: 'streaming',
              toolName: event.toolName,
            });
            // Mirror into the attach segment list so re-rendered messages
            // preserve the gateway's wire ordering. First delta opens a new
            // tool segment at the current end; later deltas update its input.
            accumulatedSegments = upsertStreamingToolSegment(accumulatedSegments, {
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              input: parseToolCallInputText(nextInputText),
              status: 'running',
              kind: resolveAssistantCapabilityKind(event.toolName) as
                | 'agent'
                | 'mcp'
                | 'skill'
                | 'tool'
                | undefined,
            });
            scheduleSegmentsFlush();
          }

          if (event.type === 'tool_progress') {
            const previous = liveToolCalls.get(event.toolCallId);
            liveToolCalls.set(event.toolCallId, {
              createdAt: previous?.createdAt ?? event.occurredAt ?? Date.now(),
              inputText: previous?.inputText ?? '',
              output: previous?.output,
              isError: previous?.isError,
              toolCallId: event.toolCallId,
              status: 'streaming',
              toolName: event.toolName,
              batchProgress: {
                subTools: event.subTools,
                completedCount: event.completedCount,
                totalCount: event.totalCount,
              },
            });
          }

          if (event.type === 'tool_result') {
            const previous = liveToolCalls.get(event.toolCallId);
            const rawPendingPermissionRequestId = event.pendingPermissionRequestId;
            const hasPendingPermission = hasActivePendingPermissionRequest(event);
            liveToolCalls.set(event.toolCallId, {
              createdAt: previous?.createdAt ?? event.occurredAt ?? Date.now(),
              completedAt: event.occurredAt ?? Date.now(),
              inputText: previous?.inputText ?? '',
              output: event.output,
              isError: hasPendingPermission ? false : event.isError,
              pendingPermissionRequestId: hasPendingPermission
                ? event.pendingPermissionRequestId
                : undefined,
              resumedAfterApproval: event.resumedAfterApproval,
              toolCallId: event.toolCallId,
              status: hasPendingPermission ? 'paused' : event.isError ? 'error' : 'completed',
              toolName: event.toolName,
            });
            accumulatedSegments = applyToolResultToStreamingSegment(accumulatedSegments, {
              toolCallId: event.toolCallId,
              output: event.output,
              isError: hasPendingPermission ? false : event.isError,
              status: hasPendingPermission ? 'paused' : event.isError ? 'failed' : 'completed',
              ...(hasPendingPermission && rawPendingPermissionRequestId
                ? {
                    pendingPermissionRequestId: rawPendingPermissionRequestId,
                  }
                : {}),
              ...(event.resumedAfterApproval ? { resumedAfterApproval: true } : {}),
            });
            scheduleSegmentsFlush();
            setMessages((previousMessages) => {
              const nextMessages = applyToolResultToLocalAssistantMessages(previousMessages, event);
              return typeof rawPendingPermissionRequestId === 'string' &&
                rawPendingPermissionRequestId.length > 0 &&
                !hasPendingPermission
                ? dismissPermissionEventMessage(nextMessages, rawPendingPermissionRequestId)
                : nextMessages;
            });
            if (
              typeof rawPendingPermissionRequestId === 'string' &&
              rawPendingPermissionRequestId.length > 0 &&
              !hasPendingPermission
            ) {
              setPendingPermissions((previousPermissions) =>
                previousPermissions.filter(
                  (permission) => permission.requestId !== rawPendingPermissionRequestId,
                ),
              );
            }
          }

          if (event.type === 'usage') {
            accumulatedUsage = mergeChatBackendUsageSnapshot(accumulatedUsage, event);
            setReportedStreamUsage((previous) => mergeChatBackendUsageSnapshot(previous, event));
          }

          if (event.type === 'session_child') {
            setChildSessions((previous) => {
              if (previous.some((session) => session.id === event.sessionId)) {
                return previous.map((session) =>
                  session.id === event.sessionId
                    ? { ...session, title: event.title ?? session.title }
                    : session,
                );
              }

              return [
                {
                  id: event.sessionId,
                  title: event.title,
                },
                ...previous,
              ];
            });
          }

          if (event.type === 'task_update') {
            setSessionTasks((previous) => {
              const existingTask = previous.find((task) => task.id === event.taskId);
              const nextTask: SessionTask = {
                assignedAgent: event.assignedAgent ?? existingTask?.assignedAgent,
                blockedBy: existingTask?.blockedBy ?? [],
                completedSubtaskCount: existingTask?.completedSubtaskCount ?? 0,
                createdAt: existingTask?.createdAt ?? event.occurredAt ?? Date.now(),
                depth: event.parentTaskId ? 1 : (existingTask?.depth ?? 0),
                errorMessage: event.errorMessage ?? existingTask?.errorMessage,
                id: event.taskId,
                parentTaskId: event.parentTaskId,
                priority: existingTask?.priority ?? 'medium',
                readySubtaskCount: existingTask?.readySubtaskCount ?? 0,
                result: event.result ?? existingTask?.result,
                sessionId: event.sessionId ?? existingTask?.sessionId,
                status:
                  event.status === 'in_progress'
                    ? 'running'
                    : event.status === 'done'
                      ? 'completed'
                      : event.status,
                subtaskCount: existingTask?.subtaskCount ?? 0,
                tags: existingTask?.tags ?? [],
                terminalReason: event.reason ?? existingTask?.terminalReason,
                timeoutSource: event.timeoutSource ?? existingTask?.timeoutSource,
                title: event.label,
                unmetDependencyCount: existingTask?.unmetDependencyCount ?? 0,
                updatedAt: event.occurredAt ?? Date.now(),
              };

              const existingIndex = previous.findIndex((task) => task.id === event.taskId);
              if (existingIndex === -1) {
                return [nextTask, ...previous];
              }

              return previous.map((task, index) =>
                index === existingIndex ? { ...task, ...nextTask } : task,
              );
            });
          }

          if (event.type === 'permission_asked') {
            if (token && isAutoAcceptEnabled(sid)) {
              void replyPermissionRequest({
                decision: 'once',
                gatewayUrl,
                requestId: event.requestId,
                sessionId: sid,
                token,
              }).catch(() => {
                setSessionStateStatus('paused');
                setMessages((previous) => upsertPermissionEventMessage(previous, event));
              });
            } else {
              pausedForPermission = true;
              setSessionStateStatus('paused');
              setMessages((previous) => upsertPermissionEventMessage(previous, event));
              setPendingPermissions((previous) => {
                return dedupePendingPermissionRequests([
                  createPendingPermissionRequestSnapshot(event, sid),
                  ...previous,
                ]);
              });
              // NOTE: Do NOT call resetStreamState() here.
              // permission_asked arrives before onDone(tool_permission). Resetting stream state
              // here clears currentAssistantStreamMessageIdRef, causing onDone to create a
              // duplicate assistant message with a new ID. Let onDone handle the reset.
              requestSessionListRefresh();
            }
          }

          if (event.type === 'permission_replied') {
            if (event.decision !== 'reject') {
              setSessionStateStatus('running');
            }
            setMessages((previous) =>
              dismissPermissionEventMessage(
                applyPermissionDecisionToLocalAssistantMessages(
                  previous,
                  event.requestId,
                  event.decision,
                  event.feedback,
                ),
                event.requestId,
              ),
            );
            setPendingPermissions((previous) =>
              previous.filter((permission) => permission.requestId !== event.requestId),
            );
            setRightPanelState((previous) =>
              clearResolvedPendingPermissionToolCalls(previous, event.requestId, event.decision),
            );
          }

          if (event.type === 'question_asked') {
            pausedForQuestion = true;
            setSessionStateStatus('paused');
            resetStreamState();
            requestCurrentSessionRefresh(sid);
            requestSessionListRefresh();
          }

          if (event.type === 'question_replied') {
            setSessionStateStatus(event.status === 'answered' ? 'running' : 'idle');
          }

          setRightPanelState((prev) => {
            if (
              event.type === 'tool_call_delta' ||
              event.type === 'tool_search' ||
              event.type === 'done' ||
              event.type === 'error'
            ) {
              return applyChatRightPanelChunk(prev, event);
            }
            return applyChatRightPanelEvent(prev, event);
          });

          if (!isNearBottomRef.current) {
            setHasPendingFollowContent((previous) => previous || true);
          }

          if (
            shouldShowRunEventInTranscript(event) &&
            event.type !== 'audit_ref' &&
            event.type !== 'permission_replied' &&
            event.type !== 'question_replied'
          ) {
            appendAssistantEventMessages([event]);
          }
        },
        onDelta: (delta) => {
          if (!isCurrentSessionRequest(sid, attachSessionViewEpoch) || stoppingStreamRef.current) {
            return;
          }
          ensureAttachStateInitialized();
          if (firstTokenObservedAt === null) {
            firstTokenObservedAt = Date.now();
            setActiveStreamFirstTokenLatencyMs(firstTokenObservedAt - requestStartedAt);
          }
          accumulated += delta;
          // Mirror into the ordered attach segment list so live re-attach
          // renders preserve wire-arrival order. Coalesces consecutive text
          // deltas with the trailing text segment when no other segment was
          // recorded between them.
          const messageId = currentAssistantStreamMessageIdRef.current ?? makeOrderedMessageId();
          accumulatedSegments = appendStreamingTextDelta(accumulatedSegments, delta, messageId);
          scheduleSegmentsFlush();
          streamRevealTargetRef.current = accumulated;
          streamRevealTargetCodePointsRef.current.push(...Array.from(delta));
          const shouldRevealStructuredContentImmediately =
            isImmediatelyRenderableStructuredContent(accumulated);
          if (prefersReducedMotion || shouldRevealStructuredContentImmediately) {
            streamRevealVisibleRef.current = accumulated;
            streamRevealVisibleCodePointCountRef.current =
              streamRevealTargetCodePointsRef.current.length;
            streamRevealNextAllowedAtRef.current = 0;
            setStreamBuffer(accumulated);
          } else {
            scheduleStreamReveal();
          }
          if (!isNearBottomRef.current) {
            setHasPendingFollowContent((previous) => previous || true);
          }
        },
        onThinkingDelta: (chunk) => {
          if (!isCurrentSessionRequest(sid, attachSessionViewEpoch) || stoppingStreamRef.current) {
            return;
          }
          ensureAttachStateInitialized();
          if (liveToolCalls.size > 0) {
            closeCurrentAttachRoundIntoMessage(Date.now());
          }
          accumulatedThinkingBlocks = appendStreamingThinkingChunk(
            accumulatedThinkingBlocks,
            chunk,
          );
          accumulatedThinking = joinStreamingThinkingTexts(accumulatedThinkingBlocks);
          const messageId = currentAssistantStreamMessageIdRef.current ?? makeOrderedMessageId();
          accumulatedSegments = appendStreamingThinkingDelta(
            accumulatedSegments,
            reasoningSegmentMeta,
            chunk,
            messageId,
          );
          scheduleSegmentsFlush();
          // RAF-batched: see comment in main stream handler.
          scheduleThinkingFlush();
        },
        onThinkingEnd: (chunk) => {
          if (!isCurrentSessionRequest(sid, attachSessionViewEpoch) || stoppingStreamRef.current) {
            return;
          }
          ensureAttachStateInitialized();
          accumulatedThinkingBlocks = markStreamingThinkingChunkEnded(
            accumulatedThinkingBlocks,
            chunk,
          );
          accumulatedSegments = markStreamingReasoningSegmentEnded(
            accumulatedSegments,
            reasoningSegmentMeta,
            chunk,
          );
          scheduleSegmentsFlush();
          scheduleThinkingFlush();
        },
        onToolCall: (chunk) => {
          if (!isCurrentSessionRequest(sid, attachSessionViewEpoch)) {
            return;
          }
          ensureAttachStateInitialized();
          toolCallIds.add(chunk.toolCallId);
          if (!rightOpenRef.current) {
            setRightTab('tools');
          }
        },
        onDone: (stopReason, streamAgentId) => {
          if (!isCurrentSessionRequest(sid, attachSessionViewEpoch)) {
            requestSessionListRefresh();
            return;
          }
          // question_asked already called resetStreamState(), so an unexpected onDone
          // would create a duplicate assistant message with a fresh ID. Bail out.
          if (pausedForQuestion) {
            requestSessionListRefresh();
            return;
          }
          ensureAttachStateInitialized();
          const finishedAt = Date.now();
          const resolvedStopReason = stopReason ?? 'end_turn';
          const wasCancelled = String(resolvedStopReason) === 'cancelled';
          const isPausedForPermission = resolvedStopReason === 'tool_permission';
          const finalAccumulatedText = wasCancelled ? streamRevealVisibleRef.current : accumulated;
          const traceFinalStatus = wasCancelled
            ? 'cancelled'
            : resolvedStopReason === 'error'
              ? 'error'
              : isPausedForPermission
                ? 'paused'
                : 'completed';
          const hasRenderableAssistantReply =
            finalAccumulatedText.trim().length > 0 ||
            accumulatedThinking.trim().length > 0 ||
            toolCallIds.size > 0;
          if (hasRenderableAssistantReply || !wasCancelled) {
            const attachMsgId =
              currentAssistantStreamMessageIdRef.current ?? makeOrderedMessageId();
            const {
              content,
              parts: legacyParts,
              reasoningBlocksEndedFlags,
              reasoningBlocksDurationsMs,
            } = buildAttachTraceMessage(attachMsgId, finalAccumulatedText, traceFinalStatus);
            // Prefer ordered segments so the final attach-committed message
            // mirrors gateway wire ordering. legacyParts is the fallback for
            // edge cases where no segments accumulated.
            const parts = accumulatedSegments.length > 0 ? accumulatedSegments : legacyParts;
            // After round-boundary commits, only the final round's tool calls are
            // attached to this message; earlier rounds were already persisted as
            // independent assistant messages by closeCurrentAttachRoundIntoMessage.
            const finalRoundToolCallIds = new Set(liveToolCalls.keys());
            const shouldAttachFirstTokenLatency =
              firstTokenObservedAt !== null && !firstTokenLatencyAttached;
            setMessages((prev) =>
              replaceOrAppendStreamedAssistantMessage(
                prev,
                {
                  id: attachMsgId,
                  role: 'assistant',
                  content,
                  parts,
                  ...(reasoningBlocksEndedFlags ? { reasoningBlocksEndedFlags } : {}),
                  ...(reasoningBlocksDurationsMs ? { reasoningBlocksDurationsMs } : {}),
                  createdAt: finishedAt,
                  durationMs: finishedAt - currentRoundStartedAt,
                  stopReason: resolvedStopReason,
                  tokenEstimate: estimateTokenCount(
                    [accumulatedThinking, finalAccumulatedText]
                      .filter((item) => item.trim().length > 0)
                      .join('\n\n'),
                  ),
                  toolCallCount: finalRoundToolCallIds.size,
                  providerId: requestProviderId,
                  model: requestModelLabel,
                  agentId: streamAgentId || requestAgentId,
                  ...(shouldAttachFirstTokenLatency && firstTokenObservedAt !== null
                    ? {
                        firstTokenLatencyMs: firstTokenObservedAt - requestStartedAt,
                      }
                    : {}),
                  status: 'completed',
                },
                finalRoundToolCallIds,
              ),
            );
            if (shouldAttachFirstTokenLatency) {
              firstTokenLatencyAttached = true;
            }
          }
          setSessionStateStatus(isPausedForPermission ? 'paused' : 'idle');
          resetStreamState();
          window.setTimeout(() => {
            void loadCurrentSessionSnapshot(sid, {
              expectedSessionViewEpoch: attachSessionViewEpoch,
              messageLimit: INITIAL_TURN_LIMIT,
            }).catch(() => undefined);
          }, 500);
          requestSessionListRefresh();
        },
        onError: (code, message) => {
          if (attachReconnectWiring.handleAttachDisconnectError(code) === 'handled') {
            return;
          }
          ensureAttachStateInitialized();
          if (pausedForPermission || pausedForQuestion) {
            requestSessionListRefresh();
            return;
          }
          const finishedAt = Date.now();
          const errorContent = message ? `[错误: ${code}] ${message}` : `[错误: ${code}]`;
          logger.error('attach stream error', message ? `${code}: ${message}` : code);
          const attachErrorMsgId =
            currentAssistantStreamMessageIdRef.current ?? makeOrderedMessageId();
          const {
            content: attachErrorContent,
            parts: attachErrorParts,
            reasoningBlocksEndedFlags: attachErrorEndedFlags,
            reasoningBlocksDurationsMs: attachErrorDurationsMs,
          } = buildAttachTraceMessage(attachErrorMsgId, errorContent, 'error');
          const errorRoundToolCallIds = new Set(liveToolCalls.keys());
          const shouldAttachFirstTokenLatency =
            firstTokenObservedAt !== null && !firstTokenLatencyAttached;
          setMessages((prev) => [
            ...prev,
            {
              id: attachErrorMsgId,
              role: 'assistant',
              content: attachErrorContent,
              parts: attachErrorParts,
              ...(attachErrorEndedFlags
                ? { reasoningBlocksEndedFlags: attachErrorEndedFlags }
                : {}),
              ...(attachErrorDurationsMs
                ? { reasoningBlocksDurationsMs: attachErrorDurationsMs }
                : {}),
              createdAt: finishedAt,
              durationMs: finishedAt - currentRoundStartedAt,
              stopReason: 'error',
              tokenEstimate: estimateTokenCount(
                [accumulatedThinking, errorContent]
                  .filter((item) => item.trim().length > 0)
                  .join('\n\n'),
              ),
              toolCallCount: errorRoundToolCallIds.size,
              providerId: requestProviderId,
              model: requestModelLabel,
              agentId: requestAgentId,
              ...(shouldAttachFirstTokenLatency && firstTokenObservedAt !== null
                ? {
                    firstTokenLatencyMs: firstTokenObservedAt - requestStartedAt,
                  }
                : {}),
              status: 'error',
            },
          ]);
          if (shouldAttachFirstTokenLatency) {
            firstTokenLatencyAttached = true;
          }
          setSessionStateStatus('idle');
          resetStreamState();
          setStreamError(message ? `${code}: ${message}` : code);
          window.setTimeout(() => {
            void loadCurrentSessionSnapshot(sid, {
              expectedSessionViewEpoch: attachSessionViewEpoch,
              messageLimit: INITIAL_TURN_LIMIT,
              replaceMessages: true,
            }).catch(() => undefined);
          }, 500);
          requestSessionListRefresh();
        },
        onReconnectRequired: () => {
          attachReconnectWiring.handleReconnectRequired();
        },
      })
      .then((attached) => {
        if (!isCurrentSessionRequest(sid, attachSessionViewEpoch)) {
          return;
        }
        if (attached) {
          cancelAttachRetry();
          return;
        }

        scheduleAttachRetry({
          delayMs: 1500,
          beforeRetry: () => {
            if (!isCurrentSessionRequest(sid, attachSessionViewEpoch)) {
              return false;
            }
            attachAttemptedSessionRef.current = null;
          },
        });

        void loadCurrentSessionSnapshot(sid, {
          expectedSessionViewEpoch: attachSessionViewEpoch,
          messageLimit: INITIAL_TURN_LIMIT,
        }).catch(() => undefined);
      });
  }, [
    activeGatewayStreamSessionId,
    activeModelId,
    activeProviderId,
    attachRetryNonce,
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
    streaming,
  ]);

  async function handleRetryInCurrentSession() {
    if (!retryPrompt) return;
    if (!currentSessionId || !token) return;
    const remainingMessages = await truncateSessionMessagesInPlace(
      currentSessionId,
      retryPrompt.sourceMessageId,
      retryPrompt.text,
    );
    const normalizedRemainingMessages = filterTranscriptMessages(
      normalizeChatMessages(remainingMessages),
    );
    const fallbackMessages = trimMessagesFromSource(messages, retryPrompt.sourceMessageId);
    const sourceFoundLocally =
      messages.findIndex((message) => message.id === retryPrompt.sourceMessageId) >= 0;
    // When the source message is found in the local messages array, prefer
    // fallbackMessages (local truncation) because the backend truncation may
    // silently fail: the frontend user message ID (makeOrderedMessageId) differs
    // from the backend user message ID (makeMessageId), so the backend
    // findIndex returns -1 and no messages are actually deleted. The previous
    // heuristic (truncateRemovedSource) was always true in this case because
    // the frontend ID was never present in the backend response, causing the
    // error message to persist in normalizedRemainingMessages.
    const nextMessages = sourceFoundLocally
      ? fallbackMessages
      : normalizedRemainingMessages.length > 0
        ? normalizedRemainingMessages
        : fallbackMessages;
    setMessages(nextMessages);
    resetStreamState();
    setStreamError(null);
    await sendMessage(retryPrompt.text, {
      ...(retryPrompt.inputParts ? { existingInputParts: retryPrompt.inputParts } : {}),
    });
    setRetryPrompt(null);
  }

  async function handleEditResendInCurrentSession(
    text: string,
    sourceMessageId: string,
    editedInputParts?: InputImageContent[],
  ) {
    if (!currentSessionId || !token) return;
    const sourceMessage = messages.find((message) => message.id === sourceMessageId);
    const remainingMessages = await truncateSessionMessagesInPlace(
      currentSessionId,
      sourceMessageId,
      sourceMessage?.content,
    );
    const normalizedRemainingMessages = filterTranscriptMessages(
      normalizeChatMessages(remainingMessages),
    );
    const fallbackMessages = trimMessagesFromSource(messages, sourceMessageId);
    const sourceFoundLocally = messages.findIndex((message) => message.id === sourceMessageId) >= 0;
    // Same rationale as handleRetryInCurrentSession: prefer local truncation
    // when the source message is present in the local state, because backend
    // truncation may silently fail due to frontend/backend message ID mismatch.
    const nextMessages = sourceFoundLocally
      ? fallbackMessages
      : normalizedRemainingMessages.length > 0
        ? normalizedRemainingMessages
        : fallbackMessages;
    setMessages(nextMessages);
    resetStreamState();
    setStreamError(null);
    const effectiveInputParts = editedInputParts ?? historyEditPrompt?.inputParts;
    await sendMessage(text, {
      ...(effectiveInputParts ? { existingInputParts: effectiveInputParts } : {}),
    });
  }

  async function handleRetryInNewSession() {
    if (!retryPrompt) return;
    if (retryPrompt.inputParts && retryPrompt.inputParts.length > 0) {
      await createBranchSessionFromMessage(
        retryPrompt.text,
        retryPrompt.sourceMessageId,
        retryPrompt.inputParts,
      );
    } else {
      const branchSessionId = await createBranchSessionFromMessage(
        retryPrompt.text,
        retryPrompt.sourceMessageId,
      );
      if (!branchSessionId) return;
      await sendMessage(retryPrompt.text, { forcedSessionId: branchSessionId });
    }
    setRetryPrompt(null);
  }

  const stopActiveMessage = useCallback(async () => {
    if (stopCapability === 'none' || stopCapability === 'observe_only' || stoppingStream) {
      return;
    }

    stoppingStreamRef.current = true;
    const stopSessionViewEpoch = currentSessionViewRef.current.epoch;
    if (pendingStreamRevealFrameRef.current !== null) {
      cancelAnimationFrame(pendingStreamRevealFrameRef.current);
      pendingStreamRevealFrameRef.current = null;
    }
    streamRevealTargetRef.current = streamRevealVisibleRef.current;
    streamRevealTargetCodePointsRef.current = Array.from(streamRevealVisibleRef.current);
    streamRevealVisibleCodePointCountRef.current = streamRevealTargetCodePointsRef.current.length;
    streamRevealNextAllowedAtRef.current = 0;
    setStoppingStream(true);
    setStreamError(null);
    try {
      const sessionsClient = createSessionsClient(gatewayUrl) as SessionsClientWithActiveStop;
      const stopped =
        stopCapability === 'best_effort'
          ? Boolean(
              currentSessionId &&
              token &&
              (await sessionsClient.stopActiveStream(token, currentSessionId)),
            )
          : await client.stopStream();
      if (!stopped) {
        stoppingStreamRef.current = false;
        setStoppingStream(false);
        void (currentSessionId
          ? loadCurrentSessionSnapshot(currentSessionId, {
              expectedSessionViewEpoch: stopSessionViewEpoch,
              messageLimit: INITIAL_TURN_LIMIT,
            }).catch(() => undefined)
          : Promise.resolve());
        if (stopCapability === 'best_effort') {
          setStreamError('当前会话没有可停止的活动运行，正在刷新状态。');
        } else {
          setStreamError('当前运行控制句柄已失效，正在刷新会话状态。');
        }
        return;
      }

      if (stopCapability === 'best_effort' || !streaming) {
        stoppingStreamRef.current = false;
        setStoppingStream(false);
        void (currentSessionId
          ? loadCurrentSessionSnapshot(currentSessionId, {
              expectedSessionViewEpoch: stopSessionViewEpoch,
              messageLimit: INITIAL_TURN_LIMIT,
            }).catch(() => undefined)
          : Promise.resolve());
        requestSessionListRefresh();
      }
    } catch (error) {
      stoppingStreamRef.current = false;
      logger.error('stop stream failed', error);
      setStoppingStream(false);
      setStreamError(error instanceof Error ? error.message : '停止对话失败');
    }
  }, [
    client,
    currentSessionId,
    gatewayUrl,
    loadCurrentSessionSnapshot,
    stopCapability,
    stoppingStream,
    streaming,
    token,
  ]);

  useEffect(() => {
    if (
      queuedComposerMessages.length === 0 ||
      isSessionLoading ||
      (currentSessionId !== null && !isSessionSnapshotReady) ||
      streaming ||
      stoppingStream ||
      canStopCurrentSessionStream ||
      remoteSessionBusyState !== null ||
      queueFlushInFlightRef.current
    ) {
      return;
    }

    const [nextQueuedMessage] = queuedComposerMessages;
    if (!nextQueuedMessage) {
      return;
    }

    if (nextQueuedMessage.requiresAttachmentRebind) {
      return;
    }

    queueFlushInFlightRef.current = true;
    setQueuedComposerMessages((previous) => previous.slice(1));

    void sendMessageRef
      .current(nextQueuedMessage.text, {
        queuedAttachmentItems: nextQueuedMessage.attachmentItems,
        queuedFiles: nextQueuedMessage.files,
        queuedMessageId: nextQueuedMessage.id,
      })
      .then((sent) => {
        if (sent) {
          return;
        }

        setQueuedComposerMessages((previous) => [nextQueuedMessage, ...previous]);
      })
      .catch(() => {
        setQueuedComposerMessages((previous) => [nextQueuedMessage, ...previous]);
      })
      .finally(() => {
        queueFlushInFlightRef.current = false;
      });
  }, [
    canStopCurrentSessionStream,
    currentSessionId,
    isSessionLoading,
    isSessionSnapshotReady,
    queuedComposerMessages,
    remoteSessionBusyState,
    stoppingStream,
    streaming,
  ]);

  const { slashCommandItems, mentionItems } = useComposerMenuItems({
    composerMenu,
    composerCommandDescriptors,
    composerWorkspaceCatalog,
    workspaceFileItems,
  });

  const {
    handleKeyDown,
    handleInputChange,
    handleInputSelect,
    handlePaste,
    replaceComposerToken,
    applyComposerSelection,
    updateComposerMenu,
  } = useComposerCallbacks({
    composerMenu,
    setComposerMenu,
    input,
    setInput,
    textareaRef,
    slashCommandItems,
    mentionItems,
    stopCapability,
    streaming,
    canStopCurrentSessionStream,
    remoteSessionBusyState,
    stopActiveMessage,
    enqueueComposerMessage,
    sendMessage,
    appendFiles,
  });

  const composerVariant =
    messages.length === 0 &&
    !visibleStreaming &&
    visibleStreamBuffer.length === 0 &&
    !remoteSessionBusyState
      ? 'home'
      : 'session';
  const {
    activeProvider,
    providerCatalog,
    activeModelOption,
    activeModelCanConfigureThinking,
    activeModelTooltip,
  } = useProviderModelInfo({
    providers,
    activeProviderId,
    activeModelId,
    setActiveProviderId,
    setActiveModelId,
  });

  const {
    assistantUsageDetails,
    messageInputTokens,
    streamingOutputTokens,
    effectiveReportedStreamUsage,
    streamingUsageDetails,
    contextUsageSnapshot,
    sanitizedHistoricalMessages,
    hiddenMessageCount,
    historicalRenderedMessageEntries,
    streamingRenderedMessageEntry,
    historicalGroupedMessageEntries,
    groupedMessageEntries,
  } = useChatRenderData({
    messages,
    pendingPermissions,
    modelPrices,
    activeProviderId,
    activeModelId,
    activeModelOption,
    visibleStreaming,
    visibleStreamBuffer,
    visibleStreamThinkingBuffer,
    visibleStreamThinkingBlocks,
    visibleStreamStartedAt,
    visibleReportedStreamUsage,
    activeStreamFirstTokenLatencyMs,
    activeStreamMessageId,
    toolCallCards,
    streamingOrderedParts: visibleStreamingSegments,
    resolveAssistantCapabilityKind,
    resolveInlinePermissionActions,
    buildMessageActions,
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

  const chatSearch = useChatSearch({ messages, scrollRegionRef });

  useEffect(() => {
    if (!isPageActive) return undefined;
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey) {
        if (event.key === 'f' || event.key === 'F') {
          event.preventDefault();
          chatSearch.open();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [chatSearch.open, isPageActive]);

  const showSessionSwitchSkeleton = currentSessionId !== null && isSessionLoading && !streaming;

  return (
    <div className="page-root page-root-row">
      <div
        ref={splitContainerRef}
        style={{
          display: 'flex',
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          background: 'var(--bg)',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            flex: editorMode ? '0 0 auto' : 1,
            width: editorMode ? `calc(${splitPos}% - 2.5px)` : '100%',
            minWidth: 0,
            minHeight: 0,
            overflow: 'hidden',
            transition: splitDragging.current ? 'none' : 'width 240ms ease',
          }}
        >
          <ChatTopBar
            dialogueMode={dialogueMode}
            onChangeDialogueMode={handleDialogueModeChange}
            yoloMode={yoloMode}
            onToggleYolo={handleToggleYolo}
            editorMode={editorMode}
            onToggleEditorMode={() => setEditorMode(!editorMode)}
            rightOpen={rightOpen}
            onToggleRightOpen={() => setRightOpen((o) => !o)}
            contextUsedTokens={contextUsageSnapshot?.usedTokens}
            contextMaxTokens={contextUsageSnapshot?.maxTokens}
            contextIsEstimated={contextUsageSnapshot?.estimated}
          />
          {showModelPicker && (
            <ModelPicker
              providers={providers}
              activeProviderId={activeProviderId}
              activeModelId={activeModelId}
              anchorRef={modelPickerBtnRef}
              onSelect={async (pid: string, mid: string) => {
                setActiveProviderId(pid);
                setActiveModelId(mid);
                if (!currentSessionId) {
                  markSessionMetadataDirty();
                }
                if (!token) return;
                if (currentSessionId) {
                  const targetSessionId = currentSessionId;
                  const selectedMetadata = buildSessionMetadata({
                    providerId: pid,
                    modelId: mid,
                  });
                  await createSessionsClient(gatewayUrl).updateMetadata(
                    token,
                    targetSessionId,
                    selectedMetadata,
                  );
                  if (activeSessionRef.current !== targetSessionId) {
                    return;
                  }
                  lastPersistedSessionMetadataSnapshotRef.current =
                    createSessionMetadataSnapshot(selectedMetadata);
                  clearSessionMetadataDirty();
                  requestSessionListRefresh();
                }
              }}
              onClose={() => setShowModelPicker(false)}
            />
          )}
          <ModelSettingsPopover
            anchorRef={modelSettingsBtnRef}
            open={showModelSettings}
            onClose={() => setShowModelSettings(false)}
            modelLabel={(activeModelOption?.label ?? activeModelId) || '当前模型'}
            providerType={activeProvider?.type}
            modelId={activeModelOption?.id ?? activeModelId}
            supportsThinking={activeModelOption?.supportsThinking === true}
            canConfigureThinking={activeModelCanConfigureThinking}
            contextWindow={activeModelOption?.contextWindow}
            supportsTools={activeModelOption?.supportsTools}
            supportsVision={activeModelOption?.supportsVision}
            thinkingEnabled={thinkingEnabled}
            reasoningEffort={reasoningEffort}
            onChangeThinkingEnabled={handleThinkingEnabledChange}
            onChangeReasoningEffort={handleReasoningEffortChange}
          />
          <WorkspacePickerModal
            isOpen={showWorkspaceSelector}
            onClose={() => setShowWorkspaceSelector(false)}
            onSelect={async (path) => {
              if (currentSessionId) {
                await workspace.setWorkspace(path);
              }
              addSavedWorkspacePath(path);
              setSelectedWorkspacePath(path);
              setFileTreeRootPath(path);
              setShowWorkspaceSelector(false);
            }}
            fetchRootPath={workspace.fetchRootPath}
            fetchWorkspaceRoots={workspace.fetchWorkspaceRoots}
            fetchTree={workspace.fetchTree}
            initialPath={effectiveWorkingDirectory ?? undefined}
            validatePath={workspace.validatePath}
            loading={workspace.loading}
          />
          <HistoryEditDialog
            open={historyEditPrompt !== null}
            initialText={historyEditPrompt?.text ?? ''}
            inputParts={historyEditPrompt?.inputParts}
            onClose={() => setHistoryEditPrompt(null)}
            onResendCurrent={(text, editedInputParts) => {
              if (!historyEditPrompt) return;
              void handleEditResendInCurrentSession(
                text,
                historyEditPrompt.messageId,
                editedInputParts,
              );
              setHistoryEditPrompt(null);
            }}
            onContinueCurrent={(text, editedInputParts) => {
              if (editedInputParts && editedInputParts.length > 0) {
                void sendMessage(text, {
                  existingInputParts: editedInputParts,
                });
              } else {
                focusComposerWithText(text);
              }
              setHistoryEditPrompt(null);
            }}
            onCreateBranch={(text, editedInputParts) => {
              if (!historyEditPrompt) return;
              void createBranchSessionFromMessage(
                text,
                historyEditPrompt.messageId,
                editedInputParts,
              );
              setHistoryEditPrompt(null);
            }}
          />
          <RetryModeDialog
            open={retryPrompt !== null}
            messagePreview={retryPrompt?.text ?? ''}
            onClose={() => setRetryPrompt(null)}
            onRetryCurrent={() => {
              void handleRetryInCurrentSession();
            }}
            onRetryBranch={() => {
              void handleRetryInNewSession();
            }}
          />
          <div
            style={{
              display: 'flex',
              flex: 1,
              minHeight: 0,
              overflow: 'hidden',
              position: 'relative',
            }}
          >
            <SubAgentRunList
              items={subAgentRunItems}
              selectedSessionId={selectedChildSessionId}
              onSelectSession={openChildSessionInspector}
            />
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                width: '100%',
                minWidth: 0,
                overflow: 'hidden',
                position: 'relative',
                transition: 'none',
              }}
            >
              <ChatSearchOverlay controller={chatSearch} />
              <div
                ref={scrollRegionRef}
                onScroll={handleScroll}
                data-testid="chat-scroll-region"
                style={{
                  flex: 1,
                  overflowY: 'auto',
                  padding: editorMode
                    ? `1rem clamp(20px, 4vw, 44px) ${CHAT_SCROLL_BOTTOM_PADDING}`
                    : `0.9rem clamp(10px, 3vw, 32px) ${CHAT_SCROLL_BOTTOM_PADDING}`,
                  display: 'flex',
                  flexDirection: 'column',
                  minHeight: 0,
                  scrollPaddingBottom: CHAT_SCROLL_BOTTOM_SPACER_HEIGHT,
                }}
              >
                <div
                  ref={contentColumnRef}
                  data-testid="chat-content-column"
                  style={{
                    width: '100%',
                    maxWidth: editorMode ? 680 : 768,
                    margin: '0 auto',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'stretch',
                    gap: '1.5rem',
                    minHeight: '100%',
                  }}
                >
                  {showSessionSwitchSkeleton ? (
                    <ChatSessionSkeleton />
                  ) : messages.length === 0 && !visibleStreaming && !remoteSessionBusyState ? (
                    <WelcomeScreen
                      hasWorkspace={!!effectiveWorkingDirectory}
                      dialogueMode={dialogueMode}
                      onNewSession={() => void ensureSession()}
                      onOpenWorkspace={() => setShowWorkspaceSelector(true)}
                      onSelectMode={handleDialogueModeChange}
                    />
                  ) : null}
                  {showSessionSwitchSkeleton ? (
                    <div
                      ref={bottomRef}
                      style={{
                        height: CHAT_SCROLL_BOTTOM_SPACER_HEIGHT,
                        flexShrink: 0,
                      }}
                    />
                  ) : messages.length > 0 || visibleStreaming || remoteSessionBusyState ? (
                    <>
                      {hiddenMessageCount > 0 && (
                        <button
                          type="button"
                          data-testid="chat-load-earlier"
                          onClick={() => {
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
                                  setVisibleMessageCount(
                                    (prev) => prev + LOAD_MORE_MESSAGE_INCREMENT,
                                  );
                                })
                                .catch(() => undefined);
                            }
                          }}
                          style={{
                            alignSelf: 'center',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                            minHeight: 32,
                            padding: '0 14px',
                            borderRadius: 999,
                            border: '1px solid var(--border)',
                            background: 'color-mix(in oklch, var(--surface) 90%, transparent)',
                            color: 'var(--text-2)',
                            fontSize: 11,
                            fontWeight: 600,
                            cursor: 'pointer',
                            marginBottom: 4,
                            flexShrink: 0,
                          }}
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
                            <path d="M12 19V5" />
                            <path d="m5 12 7-7 7 7" />
                          </svg>
                          加载更早的 {Math.min(hiddenMessageCount, LOAD_MORE_MESSAGE_INCREMENT)}{' '}
                          条消息（共 {hiddenMessageCount} 条隐藏）
                        </button>
                      )}
                      <ChatMessageGroupList
                        activeModelId={activeModelId}
                        activeModelLabel={activeModelOption?.label}
                        activeProviderId={activeProviderId}
                        bottomRef={bottomRef}
                        currentUserEmail={currentUserEmail}
                        groups={groupedMessageEntries}
                        pendingPermissions={pendingPermissions}
                        providerCatalog={providerCatalog}
                        resolveInlinePermissionActions={resolveInlinePermissionActions}
                        scrollRegionRef={scrollRegionRef}
                      />
                      {!visibleStreaming && remoteSessionBusyState ? (
                        <ChatRemoteStreamPlaceholder status={remoteSessionBusyState} />
                      ) : null}
                    </>
                  ) : (
                    <div ref={bottomRef} style={{ flexShrink: 0 }} />
                  )}
                </div>
              </div>

              {showScrollToBottom && (
                <ChatScrollBottomButton
                  streaming={streaming}
                  hasPendingFollowContent={hasPendingFollowContent}
                  onScrollToBottom={() => scrollToBottom('smooth', 'latest-edge')}
                />
              )}
            </div>
          </div>

          <ChatStreamErrorBar streamError={streamError} onDismiss={() => setStreamError(null)} />

          {remoteSessionBusyState && (
            <SessionRunStateBar
              checkpointCount={compactions.length}
              onOpenRecovery={() => {
                setRightOpen(true);
                setRightTab('overview');
              }}
              pendingPermissionsCount={pendingPermissions.length}
              pendingQuestionsCount={pendingQuestions.length}
              status={remoteSessionBusyState}
              stopCapability={stopCapability}
            />
          )}

          <ChatTodoBar sessionTodos={sessionTodos} editorMode={editorMode} rightOpen={rightOpen} />

          <CompanionStage
            agentId={effectiveAgentId}
            attachedCount={attachmentItems.length}
            currentUserEmail={currentUserEmail}
            editorMode={editorMode}
            input={input}
            panelOpenSignal={companionPanelSignal}
            pendingPermissionCount={pendingPermissions.length}
            prefersReducedMotion={prefersReducedMotion}
            queuedCount={queuedComposerPreviews.length}
            rightOpen={rightOpen}
            sessionBusyState={remoteSessionBusyState}
            sessionId={currentSessionId}
            showVoice={showVoice}
            streaming={streaming}
            todoCount={sessionTodos.length}
          />

          {activePendingQuestion && (
            <InlineQuestionPanel
              answers={inlineQuestionAnswers}
              customInputs={inlineQuestionCustomInputs}
              editorMode={editorMode}
              errorMessage={inlineQuestionReplyError ?? undefined}
              pendingAction={inlineQuestionReplyStatus}
              request={activePendingQuestion}
              onDismiss={() => void replyInlineQuestion('dismissed')}
              onSubmit={() => void replyInlineQuestion('answered')}
              onToggleOption={toggleInlineQuestionOption}
              onCustomInputChange={handleInlineQuestionCustomInput}
            />
          )}

          {latestGeneratedImageResult && artifactsWorkspaceHref && (
            <ChatImageGenerationResultStrip
              artifactTitle={latestGeneratedImageResult.artifactTitle}
              modelLabel={latestGeneratedImageResult.modelLabel}
              onContinueEditing={continueEditingLatestGeneratedImage}
              onOpenArtifactsWorkspace={() => navigate(artifactsWorkspaceHref)}
            />
          )}

          <ChatComposer
            variant={composerVariant}
            editorMode={editorMode}
            activeProviderId={activeProviderId}
            activeProviderName={activeProvider?.name}
            activeProviderType={activeProvider?.type}
            activeModelTooltip={activeModelTooltip}
            modelPickerRef={modelPickerBtnRef}
            modelSettingsRef={modelSettingsBtnRef}
            showModelPicker={showModelPicker}
            showModelSettings={showModelSettings}
            activeModelSupportsThinking={activeModelOption?.supportsThinking === true}
            hasConfiguredImageModel={hasConfiguredImageModel}
            imageGenerationBusy={imageGenerationBusy}
            imageGenerationDefaults={imageGenerationDefaults}
            imageGenerationMode={imageGenerationMode}
            imageModelLabel={imageModelLabel}
            imagePluginEnabled={imagePluginEnabled}
            imageReferenceArtifacts={availableImageEditReferenceArtifacts}
            webSearchEnabled={webSearchEnabled}
            thinkingEnabled={thinkingEnabled}
            input={input}
            canStopSession={canStopCurrentSessionStream}
            stopCapability={stopCapability}
            sessionBusyState={remoteSessionBusyState}
            streaming={streaming}
            stoppingStream={stoppingStream}
            attachedFiles={attachedFiles}
            attachmentItems={attachmentItems}
            queuedMessages={queuedComposerPreviews}
            showVoice={showVoice}
            composerMenu={composerMenu}
            slashCommandItems={slashCommandItems}
            mentionItems={mentionItems}
            textareaRef={textareaRef}
            fileInputRef={fileInputRef}
            onFileChange={handleFileChange}
            onInputChange={handleInputChange}
            onInputSelect={handleInputSelect}
            onInputPaste={handlePaste}
            onKeyDown={handleKeyDown}
            onRemoveAttachment={removeAttachment}
            onApplyComposerSelection={applyComposerSelection}
            onComposerHover={(index) =>
              setComposerMenu((prev) => (prev ? { ...prev, selectedIndex: index } : prev))
            }
            onToggleVoice={() => setShowVoice((v) => !v)}
            onVoiceTranscript={(text) => {
              setInput((prev) => (prev.trim() ? `${prev.trimEnd()}\n${text}` : text));
              setShowVoice(false);
            }}
            onQueueMessage={() => void enqueueComposerMessage()}
            onRemoveQueuedMessage={removeQueuedComposerMessage}
            onRestoreQueuedMessage={restoreQueuedComposerMessage}
            onSend={() => void sendMessage()}
            onStop={() => void stopActiveMessage()}
            onRequestFiles={() => fileInputRef.current?.click()}
            onToggleModelPicker={() => setShowModelPicker((v) => !v)}
            onToggleModelSettings={() => setShowModelSettings((v) => !v)}
            onToggleImageGenerationMode={toggleImageGenerationMode}
            onSelectImageReferenceArtifactId={setSelectedImageEditReferenceArtifactId}
            onToggleWebSearch={handleToggleWebSearch}
            onUpdateImageGenerationDefaults={updateImageGenerationDefaults}
            selectedImageReferenceArtifactId={selectedImageEditReferenceArtifactId}
            agentOptions={agentOptions}
            manualAgentId={manualAgentId}
            defaultAgentLabel={defaultAgentLabel}
            onChangeManualAgentId={handleManualAgentChange}
            onClearManualAgentId={handleClearManualAgentId}
            onOptimizePrompt={
              token
                ? async (text: string) => {
                    const client = createWorkflowsClient(gatewayUrl);
                    return client.optimizePrompt(token, {
                      originalPrompt: text,
                      context: 'AI对话提示词优化：提取关键内容、转换为专业术语、增强指令明确性',
                      targetAudience: 'AI助手',
                      candidateCount: 3,
                    });
                  }
                : undefined
            }
            onDropFiles={appendFiles}
            onReplaceInput={(nextValue: string) => setInput(nextValue)}
          />
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
        />
      </div>

      <ChatRightPanel
        rightOpen={rightOpen}
        rightTab={rightTab}
        setRightTab={setRightTab}
        selectedChildSessionId={selectedChildSessionId}
        currentUserEmail={currentUserEmail}
        gatewayUrl={gatewayUrl}
        token={token}
        navigate={(path: string) => void navigate(path)}
        openChildSessionInspector={openChildSessionInspector}
        taskToolRuntimeLookup={taskToolRuntimeLookup}
        toolCallCards={toolCallCards}
        toolFilter={toolFilter}
        setToolFilter={setToolFilter}
        compactions={compactions}
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
        sharedUiThemeVars={sharedUiThemeVars}
        resolveTaskToolRuntimeSnapshot={resolveTaskToolRuntimeSnapshot}
        onCompactSession={() => void handleCompactCurrentSession()}
        onOpenRecoveryStrategy={() => {
          setRightOpen(true);
          setRightTab('history');
        }}
        providerCatalog={providerCatalog}
        attachmentItems={attachmentItems}
        artifactsWorkspaceHref={artifactsWorkspaceHref}
        contextUsageSnapshot={contextUsageSnapshot}
        contentArtifactCount={contentArtifactCount}
        contentArtifactCountStatus={contentArtifactCountStatus}
        currentSessionId={currentSessionId}
        dialogueMode={dialogueMode}
        effectiveWorkingDirectory={effectiveWorkingDirectory}
        messages={messages}
        sessionStateStatus={sessionStateStatus}
        workspaceFileItems={workspaceFileItems}
        yoloMode={yoloMode}
      />
    </div>
  );
}
