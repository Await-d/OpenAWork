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
  createArtifactsClient,
  createPendingPermissionRequestSnapshot,
  createQuestionsClient,
  createSessionsClient,
  createWorkflowsClient,
  dedupePendingPermissionRequests,
} from '@openAwork/web-client';
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
import { useFileEditorContext } from '../App.js';
import { usePageActivation } from '../components/CachedRouteOutlet.js';

import { ChatImageGenerationResultStrip } from '../components/chat/ChatImageGenerationResultStrip.js';
import {
  ModelPicker,
  ModelSettingsPopover,
  renderChatMessageContentWithOptions,
  renderStreamingChatMessageContentWithOptions,
  sharedUiThemeVars,
  WelcomeScreen,
} from '../components/chat/ChatPageSections.js';
import { UnifiedComposer } from '../components/chat/UnifiedComposer.js';
import { ChatTopBar } from '../components/chat/ChatTopBar.js';
import { SessionTerminalsChip } from '../components/chat/SessionTerminalsChip.js';
import { LatestAssistantMessageContext } from '../components/chat/collapsible-assistant-content.js';
import { QuickTerminalToggle } from '../components/chat/QuickTerminalToggle.js';
import { QuickTerminalPanel } from '../components/chat/QuickTerminalPanel.js';
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
} from '../components/session-conversation/runtime/attach-stream-eligibility.js';
import { handleInterruptedAttachStream } from '../components/session-conversation/runtime/attach-stream-reconnect.js';
import { createAttachStreamReconnectWiring } from '../components/session-conversation/runtime/attach-stream-reconnect-wiring.js';
import {
  appendAttachmentSummary,
  buildUploadedAttachmentSummaryLine,
  uploadChatAttachments,
} from '../components/session-conversation/runtime/attachment-upload.js';
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
} from '../components/session-conversation/runtime/chat-page-utils.js';
import { ChatRightPanel } from './chat-page/chat-right-panel.js';
import { SessionSidebar } from '../components/layout/SessionSidebar.js';
import type { RightPanelTabId } from './chat-page/right-panel-tabs.js';
import { ChatScrollBottomButton } from '../components/session-conversation/runtime/scroll-bottom-button.js';
import { ChatStreamErrorBar } from '../components/session-conversation/runtime/stream-error-bar.js';
import HistoryEditDialog from '../components/session-conversation/runtime/history-edit-dialog.js';
import {
  type ImageEditReferenceArtifact,
  toImageEditReferenceArtifacts,
} from '../components/session-conversation/runtime/image-edit-reference-artifacts.js';
import { makeOrderedMessageId } from '../components/session-conversation/runtime/ordered-id.js';
import { isAutoAcceptEnabled } from '../components/session-conversation/runtime/permission-auto-respond.js';
import { deleteQueuedComposerFiles } from '../components/session-conversation/runtime/queued-composer-file-store.js';
import RetryModeDialog from '../components/session-conversation/runtime/retry-mode-dialog.js';
import { startSequentialPolling } from '../components/session-conversation/runtime/sequential-polling.js';
import { executeServerCommand } from '../components/session-conversation/runtime/server-command-item.js';
import {
  SessionRunStateBar,
  SessionRunStatePlaceholder,
} from '../components/session-conversation/runtime/session-run-state-bar.js';
import {
  flattenSessionTodoLanes,
  type SessionStateStatus,
  type SessionTodoItem,
  shouldPollSessionRuntime,
  toSessionPendingPermissionState,
} from '../components/session-conversation/runtime/session-runtime.js';
import {
  type RecoveredActiveAssistantStream,
  recoverActiveAssistantStream,
} from '../components/session-conversation/runtime/stream-recovery.js';
import {
  type ChatBackendUsageSnapshot,
  mergeChatBackendUsageSnapshot,
} from '../components/session-conversation/runtime/stream-usage.js';
import {
  appendStreamingTextDelta,
  appendStreamingThinkingDelta,
  applyToolResultToStreamingSegment,
  markStreamingReasoningSegmentEnded,
  segmentsFromRecoverySnapshot,
  upsertStreamingToolSegment,
} from '../components/session-conversation/runtime/streaming-segments.js';
import {
  appendStreamingThinkingChunk,
  extractStreamingThinkingDurations,
  extractStreamingThinkingEndedFlags,
  extractStreamingThinkingTexts,
  joinStreamingThinkingTexts,
  markStreamingThinkingChunkEnded,
  type StreamingThinkingBlock,
} from '../components/session-conversation/runtime/streaming-thinking.js';
import { buildSubAgentRunItems, SubAgentRunList } from './chat-page/sub-agent-run-list.js';
import { SubSessionDetailPanel } from './chat-page/sub-session-detail-panel.js';
import {
  buildUserHistoryJumpItems,
  UserHistoryJumpList,
} from './chat-page/user-history-jump-list.js';
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
} from '../components/session-conversation/runtime/support.js';
import {
  buildTaskToolRuntimeLookup,
  buildTerminalTaskSyncMarker,
  resolveTaskToolRuntimeSnapshot,
} from '../components/session-conversation/runtime/task-tool-runtime.js';
import { detectThinkKeyword } from '../components/session-conversation/runtime/think-keyword-detector.js';
import { useChatTodoController } from '../components/session-conversation/runtime/todo-bar.js';
import {
  filterTranscriptMessages,
  shouldShowRunEventInTranscript,
} from '../components/session-conversation/runtime/transcript-visibility.js';
import { useAssistantMessageProcessing } from '../components/session-conversation/runtime/use-assistant-message-processing.js';
import { useChatDataLoaders } from '../components/session-conversation/runtime/use-chat-data-loaders.js';
import type { SessionImageGenerationResponse } from './chat-page/use-chat-image-generation.js';
import { useChatImageGeneration } from './chat-page/use-chat-image-generation.js';
import {
  type HistoryEditPrompt,
  type RetryPrompt,
  useChatMessageActions,
} from './chat-page/use-chat-message-actions.js';
import { useChatRenderData } from '../components/session-conversation/runtime/use-chat-render-data.js';
import { useChatUiActions } from './chat-page/use-chat-ui-actions.js';
import { readSplitPos, writeSplitPos } from './chat-page/split-pos-storage.js';
import { useModelPrices } from '../components/session-conversation/runtime/use-model-prices.js';
import { useProviderModelInfo } from '../components/session-conversation/runtime/use-provider-model-info.js';
import { useScrollManager } from '../components/session-conversation/runtime/use-scroll-manager.js';
import { useSessionContentArtifactCount } from '../components/session-conversation/runtime/use-session-content-artifact-count.js';
import { useSessionTerminals } from '../components/session-conversation/runtime/use-session-terminals.js';
import {
  detectDevServerUrl,
  isLikelyDevServerCommand,
} from '../components/session-conversation/runtime/dev-server-detect.js';
import { useSessionSettingsCallbacks } from '../components/session-conversation/runtime/use-session-settings-callbacks.js';
import { useSessionSidebarRunState } from '../components/session-conversation/runtime/use-session-sidebar-run-state.js';
import { useSessionSnapshotLoader } from '../components/session-conversation/runtime/use-session-snapshot-loader.js';
import { type SessionArtifactsResponse } from './artifacts/artifact-workspace-types.js';
import {
  type SessionViewStreamingSnapshot,
  useSessionViewCache,
} from '../components/session-conversation/runtime/use-session-view-cache.js';
import { useSessionViewGuard } from '../components/session-conversation/runtime/use-session-view-guard.js';
import { useStreamAttachRetry } from '../components/session-conversation/runtime/use-stream-attach-retry.js';
import { useStreamReveal } from '../components/session-conversation/runtime/use-stream-reveal.js';
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
import {
  CommandPalette,
  useCommandPalette,
  type CommandPaletteItem,
} from '../components/chat/command-palette.js';
import { PromptTemplatePanel } from '../components/chat/prompt-template-panel.js';
import {
  useMessageMultiSelect,
  MultiSelectToolbar,
} from '../components/chat/message-multi-select.js';
import {
  exportMessages,
  downloadExport,
  copyExportToClipboard,
} from '../components/chat/message-export.js';
import { useBookmarkStore } from '../stores/bookmarks.js';
import { useChatKeyboardShortcuts } from '../hooks/useChatKeyboardShortcuts.js';
import { SessionConversationView } from '../components/session-conversation/SessionConversationView.js';

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
  const bottomRef = useRef<HTMLDivElement>(null);
  const contentColumnRef = useRef<HTMLDivElement>(null);
  const scrollRegionRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
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

  const rightTabRaw = useUIStateStore((s) => s.rightTab);
  const setRightTabStore = useUIStateStore((s) => s.setRightTab);
  const rightTab = (rightTabRaw as RightPanelTabId) ?? 'overview';
  const setRightTab = useCallback(
    (value: RightPanelTabId | ((prev: RightPanelTabId) => RightPanelTabId)) => {
      const next =
        typeof value === 'function'
          ? (value as (p: RightPanelTabId) => RightPanelTabId)(rightTab)
          : value;
      setRightTabStore(next);
    },
    [rightTab, setRightTabStore],
  );
  const [toolFilter, setToolFilter] = useState<'all' | 'lsp' | 'file' | 'network' | 'other'>('all');
  const [mcpServers, setMcpServers] = useState<MCPServerStatus[]>([]);
  const rightOpen = useUIStateStore((s) => s.rightOpen);
  const setRightOpenStore = useUIStateStore((s) => s.setRightOpen);
  const setRightOpen = useCallback(
    (value: boolean | ((prev: boolean) => boolean)) => {
      const next =
        typeof value === 'function' ? (value as (p: boolean) => boolean)(rightOpen) : value;
      setRightOpenStore(next);
    },
    [rightOpen, setRightOpenStore],
  );
  const [companionPanelSignal, setCompanionPanelSignal] = useState(0);
  const [dialogueMode, setDialogueMode] = useState<DialogueMode>('coding');
  const [manualAgentId, setManualAgentId] = useState('');
  const [yoloMode, setYoloMode] = useState(false);
  const [webSearchEnabled, setWebSearchEnabled] = useState(true);
  const [thinkingEnabled, setThinkingEnabled] = useState(false);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>('medium');
  const [streamError, setStreamError] = useState<string | null>(null);
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
  // 待办控制器：在 ChatPage 创建一份，让 ChatTopBar 内嵌 todo slot 与
  // SessionConversationView 内的浮层共享展开状态、避免双份 state。
  const todoController = useChatTodoController(sessionTodos);
  const todoDetailsId = useId();
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
  const browserActive = useUIStateStore((s) => s.browserActive);
  const setBrowserActive = useUIStateStore((s) => s.setBrowserActive);
  const editorPaneTabByWorkspace = useUIStateStore((s) => s.editorPaneTabByWorkspace);
  const setEditorPaneTabForWorkspace = useUIStateStore((s) => s.setEditorPaneTabForWorkspace);
  const browserPreviewUrlByWorkspace = useUIStateStore((s) => s.browserPreviewUrlByWorkspace);
  const setBrowserPreviewUrlForWorkspace = useUIStateStore(
    (s) => s.setBrowserPreviewUrlForWorkspace,
  );
  // 快捷终端面板:by-workspace 持久化是否开启 + 全局共用高度。
  const quickTerminalOpenByWorkspace = useUIStateStore((s) => s.quickTerminalOpenByWorkspace);
  const setQuickTerminalOpenForWorkspace = useUIStateStore(
    (s) => s.setQuickTerminalOpenForWorkspace,
  );
  // browserPreviewUrl / setBrowserPreviewUrl 在 effectiveWorkingDirectory 定义之后才声明
  // (见下方),因为它们依赖 workspace path。
  const devServerDetectedTerminalIdsRef = useRef<Set<string>>(new Set());
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

  // ─── Enhanced chat operations state ───────────────────────────────────────
  const [showTemplatePanel, setShowTemplatePanel] = useState(false);
  const bookmarkStore = useBookmarkStore();
  const multiSelect = useMessageMultiSelect();

  const lastPersistedSessionMetadataSnapshotRef = useRef<string | null>(null);
  const composerCommandDescriptors = useCommandRegistry('composer');
  const prefersReducedMotion = usePrefersReducedMotion();
  const editorMode = useUIStateStore((s) => s.editorMode);
  const setEditorMode = useUIStateStore((s) => s.setEditorMode);
  // splitPos 完全独立于 zustand UI state,直接走自己的小 localStorage 键:
  //   1) 不订阅,避免拖动结束 commit 触发整树 rerender
  //   2) 不走 zustand persist,避免每次 commit 都把 75 个字段的整个
  //      UI state JSON.stringify 写盘 (即 [Violation] 'click'/
  //      'requestIdleCallback' handler took 70~167ms 的根因)
  // 见 ./chat-page/split-pos-storage.ts 的注释。
  const [splitPos] = useState(() => readSplitPos());
  const setSplitPos = writeSplitPos;
  const navigateToHome = useUIStateStore((s) => s.navigateToHome);
  const navigateToSession = useUIStateStore((s) => s.navigateToSession);
  const chatView = useUIStateStore((s) => s.chatView);
  const workspaceTreeVersion = useUIStateStore((s) => s.workspaceTreeVersion);
  const selectedWorkspacePath = useUIStateStore((s) => s.selectedWorkspacePath);
  const setSelectedWorkspacePath = useUIStateStore((s) => s.setSelectedWorkspacePath);
  const addSavedWorkspacePath = useUIStateStore((s) => s.addSavedWorkspacePath);
  const setFileTreeRootPath = useUIStateStore((s) => s.setFileTreeRootPath);
  const setLastChatPath = useUIStateStore((s) => s.setLastChatPath);
  const toggleLeftSidebar = useUIStateStore((s) => s.toggleLeftSidebar);
  const leftSidebarOpen = useUIStateStore((s) => s.leftSidebarOpen);
  const setLeftSidebarOpen = useUIStateStore((s) => s.setLeftSidebarOpen);

  // 窄屏(≤960px)下 sidebar 改为 overlay 模式,会浮在主对话区上而不是占位。
  const [isNarrowViewport, setIsNarrowViewport] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth <= 960 : false,
  );
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(max-width: 960px)');
    const update = () => setIsNarrowViewport(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  // 自愈:首次进入 chat 路由 + 宽屏时,如果 sidebar 因历史原因被关闭,自动展开一次。
  // 只在 ChatPage 挂载的"首次"跑(empty deps),用户后续手动关闭后不会被强制重开。
  const sidebarSelfHealRef = useRef(false);
  useEffect(() => {
    if (sidebarSelfHealRef.current) return;
    sidebarSelfHealRef.current = true;
    if (!leftSidebarOpen && !isNarrowViewport) {
      setLeftSidebarOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shouldOverlaySidebar = isNarrowViewport;
  const sidebarWidth = shouldOverlaySidebar
    ? 'min(86vw, var(--sidebar-width, 260px))'
    : 'var(--sidebar-width, 260px)';
  const splitDragging = useRef(false);
  const rightOpenRef = useRef(rightOpen);
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
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const editorPaneRef = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);
  const openFileRef = useFileEditorContext();
  const effectiveWorkingDirectory = currentSessionId
    ? workspace.workingDirectory
    : selectedWorkspacePath;
  // useFileEditor 按 workspace 隔离打开的文件:跨 workspace 切换时自动加载对应 workspace
  // 上次留下的文件,而不是共享一个全局文件列表。
  const fileEditor = useFileEditor(effectiveWorkingDirectory);
  // 快捷终端面板:by-workspace 持久化(跟 BuiltInBrowser / fileEditor 同一套 wsKey 兜底)。
  const quickTerminalWorkspaceKey =
    effectiveWorkingDirectory && effectiveWorkingDirectory.trim().length > 0
      ? effectiveWorkingDirectory
      : '__default__';
  const quickTerminalOpen = quickTerminalOpenByWorkspace[quickTerminalWorkspaceKey] ?? false;
  // 浏览器预览 URL 按 workspace 路径派生:同 workspace 的会话共享 url,跨 workspace
  // 自动切到对应 workspace 的 url(若无则 null)。无 workspace 的会话归入 __default__ 桶。
  const browserWorkspaceKey =
    effectiveWorkingDirectory && effectiveWorkingDirectory.trim().length > 0
      ? effectiveWorkingDirectory
      : '__default__';
  const browserPreviewUrl = browserPreviewUrlByWorkspace[browserWorkspaceKey] ?? null;
  const setBrowserPreviewUrl = useCallback(
    (url: string | null) => {
      setBrowserPreviewUrlForWorkspace(effectiveWorkingDirectory, url);
      if (url) setBrowserActive(true);
    },
    [effectiveWorkingDirectory, setBrowserPreviewUrlForWorkspace, setBrowserActive],
  );
  // editor pane 当前 tab(code/browser)按 workspace 持久化,跨 workspace 切换时
  // 各自互不影响;用户上次在 workspace A 留在 code,B 留在 browser → 切回时自动恢复。
  const editorPaneTab = editorPaneTabByWorkspace[browserWorkspaceKey] ?? 'code';
  const setEditorPaneTab = useCallback(
    (tab: 'code' | 'browser') => {
      setEditorPaneTabForWorkspace(effectiveWorkingDirectory, tab);
    },
    [effectiveWorkingDirectory, setEditorPaneTabForWorkspace],
  );
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
  const client = useGatewayClient(token);
  const taskToolRuntimeLookup = useMemo(
    () => buildTaskToolRuntimeLookup(childSessions, sessionTasks),
    [childSessions, sessionTasks],
  );
  const subAgentRunItems = useMemo(
    () => buildSubAgentRunItems(childSessions, sessionTasks, currentSessionId),
    [childSessions, sessionTasks, currentSessionId],
  );
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
      // Apply cached messages immediately — skip skeleton.
      // Wrap state mutations in `startTransition` so React 19 can yield
      // during the commit. With long histories the cached snapshot
      // applies in one synchronous setState chain; without a transition
      // that's a single ~200–350ms task surfacing as
      // `[Violation] 'message' handler took XYZms`.
      sessionRestoredFromCacheRef.current = true;
      const cachedMessages = cachedView.messages;
      const cachedScrollTop = cachedView.scrollTop;
      startSessionSwitchTransition(() => {
        setMessages(cachedMessages);
        setVisibleMessageCount(DEFAULT_VISIBLE_MESSAGE_COUNT);
        setIsSessionLoading(false);
      });
      // Restore scroll position after React renders the cached messages
      ignoreScrollEventsUntilRef.current = performance.now() + 600;
      requestAnimationFrame(() => {
        const sr = scrollRegionRef.current;
        if (sr && !cancelled) {
          sr.scrollTo({ top: cachedScrollTop, behavior: 'auto' });
        }
      });
    } else {
      sessionRestoredFromCacheRef.current = false;
      startSessionSwitchTransition(() => {
        setIsSessionLoading(true);
        setMessages([]);
        setVisibleMessageCount(DEFAULT_VISIBLE_MESSAGE_COUNT);
      });
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
      return createSessionsClient(gatewayUrl).truncateMessages(token, sessionId, messageId, {
        inclusive: true,
        ...(messageText !== undefined ? { messageText } : {}),
      });
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
    const sourceInput = sanitizeComposerPlainText(overrideText ?? '');
    const effectiveFiles = options?.queuedFiles ?? [];
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

    // ── 内置 client 命令:/open <url> ─────────────────────────────────
    // 直接打开内置浏览器到指定 URL,不发送给 LLM。
    // 支持:/open https://example.com、/open localhost:3000、/open example.com
    {
      const openMatch = text.match(/^\/open\s+(.+)$/i);
      if (openMatch) {
        const arg = openMatch[1]?.trim() ?? '';
        if (arg.length === 0) {
          toast('用法:/open <url>', 'warning');
          return false;
        }
        const normalizedUrl = (() => {
          if (/^https?:\/\//i.test(arg)) return arg;
          if (/^[a-z0-9-]+\.[a-z]{2,}/i.test(arg)) return `https://${arg}`;
          // localhost:3000 / 127.0.0.1:5173 之类不带 schema 的本地地址
          if (/^(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?(?:\/.*)?$/i.test(arg)) {
            return `http://${arg}`;
          }
          return arg;
        })();
        // 派发 BuiltInBrowser 监听的事件,新建 tab 并跳转。
        window.dispatchEvent(
          new CustomEvent('openawork:browser:open-url', {
            detail: { url: normalizedUrl, mode: 'newTab' },
          }),
        );
        // 同时激活浏览器面板:存到 store + 切到 browser tab
        setBrowserPreviewUrl(normalizedUrl);
        setEditorMode(true);
        toast(`已在浏览器中打开 ${normalizedUrl}`, 'success');
        return true;
      }
    }

    if (imageGenerationMode) {
      if (!hasConfiguredImageModel) {
        const message = '请先在设置中配置可用的图片模型，然后再使用图片生成模式。';
        setStreamError(message);
        toast(message, 'warning');
        return false;
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
      setCompanionPanelSignal((value) => value + 1);
      return true;
    }

    if (matchedServerCommand) {
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
          // First-token latency is "time-to-first-content of any kind".
          // Without this, reasoning-heavy rounds that emit tool calls before
          // any text delta would render "首 token --" forever even though the
          // model has clearly started producing output. The same observation
          // is later attached to the first finalized round (gated by
          // `firstTokenLatencyAttached`) so this does not double-count.
          if (firstTokenObservedAt === null) {
            firstTokenObservedAt = event.occurredAt ?? Date.now();
            setActiveStreamFirstTokenLatencyMs(firstTokenObservedAt - requestStartedAt);
          }
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

        if (
          event.type === 'terminal_started' ||
          event.type === 'terminal_output' ||
          event.type === 'terminal_exited'
        ) {
          sessionTerminals.applyRunEvent(event);

          // Auto-detect dev-server URLs from terminal output
          if (
            (event.type === 'terminal_output' || event.type === 'terminal_started') &&
            !devServerDetectedTerminalIdsRef.current.has(
              (event as { terminalId: string }).terminalId,
            )
          ) {
            const terminalId = (event as { terminalId: string }).terminalId;
            const outputText =
              event.type === 'terminal_output' ? (event as { outputTail: string }).outputTail : '';
            const command =
              event.type === 'terminal_started' ? (event as { command: string }).command : '';

            if (
              event.type === 'terminal_started' &&
              command &&
              !isLikelyDevServerCommand(command)
            ) {
              // Not a dev-server command — mark as skip so future output events are ignored
              devServerDetectedTerminalIdsRef.current.add(terminalId);
            } else if (outputText) {
              const detected = detectDevServerUrl(outputText);
              if (detected) {
                devServerDetectedTerminalIdsRef.current.add(terminalId);
                setBrowserPreviewUrl(detected.url);
                // Open the editor pane with browser preview instead of right panel
                setEditorMode(true);
              }
            }
          }
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

        // First-token latency tracks "time-to-first-content of any kind".
        // For reasoning models, the very first response chunk is typically
        // a thinking delta (sometimes minutes before any text token), so we
        // must capture it here too — otherwise rounds that emit reasoning
        // and then a tool call without text would render "首 token --" even
        // when the gateway has clearly delivered tokens.
        if (firstTokenObservedAt === null) {
          firstTokenObservedAt = Date.now();
          setActiveStreamFirstTokenLatencyMs(firstTokenObservedAt - requestStartedAt);
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
      onDone: (stopReason, streamAgentId, cancellation) => {
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
        // P1-CANCEL / T-CANCEL-08: render a precise toast based on
        // the cascade reason. Three branches:
        //   - `parent_aborted` / `ancestor_aborted` → this session is
        //     a descendant; the user did NOT click stop here, the
        //     parent did. We tell them so they understand why their
        //     stream just terminated.
        //   - `user_aborted` with a non-empty cascade → the user
        //     stopped this session and the gateway also took N
        //     children down with it; show that count.
        //   - everything else (`user_aborted` + no cascade) → bare
        //     "已停止" remains the default and we do not toast.
        if (wasCancelled && cancellation) {
          const suffix = cancellation.timedOut ? '（超时）' : '';
          if (
            cancellation.reason === 'parent_aborted' ||
            cancellation.reason === 'ancestor_aborted'
          ) {
            toast(
              `本会话由${cancellation.reason === 'parent_aborted' ? '父' : '上游'}会话中断${suffix}`,
              'info',
              3200,
            );
          } else if (cancellation.descendantSessions > 0) {
            const desc = cancellation.descendantSessions;
            const streams = cancellation.cancelledStreams;
            toast(
              `已停止当前会话 + ${desc} 个子会话${
                streams > 0 ? `（共 ${streams} 个运行中请求）` : ''
              }${suffix}`,
              'success',
              3200,
            );
          }
        }
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
      setEditorPaneTab,
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
            // Mirror the main stream handler: capture first-token latency on
            // the first tool_call_delta when no text has arrived yet, so
            // attach replays of reasoning-heavy rounds also show "首 token X"
            // instead of "首 token --".
            if (firstTokenObservedAt === null) {
              firstTokenObservedAt = event.occurredAt ?? Date.now();
              setActiveStreamFirstTokenLatencyMs(firstTokenObservedAt - requestStartedAt);
            }
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

          if (
            event.type === 'terminal_started' ||
            event.type === 'terminal_output' ||
            event.type === 'terminal_exited'
          ) {
            sessionTerminals.applyRunEvent(event);

            // Auto-detect dev-server URLs from terminal output (attach path)
            if (
              (event.type === 'terminal_output' || event.type === 'terminal_started') &&
              !devServerDetectedTerminalIdsRef.current.has(
                (event as { terminalId: string }).terminalId,
              )
            ) {
              const terminalId = (event as { terminalId: string }).terminalId;
              const outputText =
                event.type === 'terminal_output'
                  ? (event as { outputTail: string }).outputTail
                  : '';
              const command =
                event.type === 'terminal_started' ? (event as { command: string }).command : '';

              if (
                event.type === 'terminal_started' &&
                command &&
                !isLikelyDevServerCommand(command)
              ) {
                // Not a dev-server command — mark as skip
                devServerDetectedTerminalIdsRef.current.add(terminalId);
              } else if (outputText) {
                const detected = detectDevServerUrl(outputText);
                if (detected) {
                  devServerDetectedTerminalIdsRef.current.add(terminalId);
                  setBrowserPreviewUrl(detected.url);
                  // Open the editor pane with browser preview
                  setEditorMode(true);
                }
              }
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
          // Mirror the main stream handler: reasoning chunks are real model
          // output, so capturing first-token latency here keeps the assistant
          // footer showing "首 token X" on attach replays of reasoning-heavy
          // rounds instead of "首 token --".
          if (firstTokenObservedAt === null) {
            firstTokenObservedAt = Date.now();
            setActiveStreamFirstTokenLatencyMs(firstTokenObservedAt - requestStartedAt);
          }
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
        onDone: (stopReason, streamAgentId, cancellation) => {
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
    buildMessageActions: (message) => {
      const baseActions = buildMessageActions(message);
      const isBookmarked = bookmarkStore.isBookmarked(message.id);
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

  // ─── Command Palette items ──────────────────────────────────────────────
  const commandPaletteItems = useMemo<CommandPaletteItem[]>(
    () => [
      {
        id: 'search',
        label: '在对话中查找',
        description: '搜索当前会话的消息内容',
        category: '导航',
        shortcut: '⌘F',
        icon: '🔍',
        onExecute: () => chatSearch.open(),
      },
      {
        id: 'templates',
        label: '提示词模板',
        description: '打开模板库，快速插入常用提示词',
        category: '输入',
        shortcut: '⌘⇧T',
        icon: '📋',
        onExecute: () => setShowTemplatePanel(true),
      },
      {
        id: 'multi-select',
        label: multiSelect.multiSelect.enabled ? '退出多选模式' : '多选消息',
        description: '批量选择消息进行复制、导出或收藏',
        category: '操作',
        shortcut: '⌘⇧M',
        icon: '☑',
        onExecute: () => {
          if (multiSelect.multiSelect.enabled) {
            multiSelect.disableMultiSelect();
          } else {
            multiSelect.enableMultiSelect();
            // 默认全选,避免空选导致用户以为操作失效。
            // 用户随后用 toolbar 的"全选/取消"或单条菜单的"☐ 选择"调整。
            requestAnimationFrame(() => multiSelect.selectAll(messages));
          }
        },
      },
      {
        id: 'export-markdown',
        label: '导出对话为 Markdown',
        description: '将当前会话导出为 Markdown 文件',
        category: '导出',
        icon: '📤',
        onExecute: () => {
          const content = exportMessages(messages, 'markdown');
          downloadExport(content, `chat-export-${Date.now()}.md`, 'text/markdown');
        },
      },
      {
        id: 'export-json',
        label: '导出对话为 JSON',
        description: '将当前会话导出为 JSON 文件',
        category: '导出',
        icon: '📦',
        onExecute: () => {
          const content = exportMessages(messages, 'json');
          downloadExport(content, `chat-export-${Date.now()}.json`, 'application/json');
        },
      },
      {
        id: 'copy-last-assistant',
        label: '复制最后一条助手消息',
        description: '将最近的助手回复复制到剪贴板',
        category: '操作',
        shortcut: '⌘⇧C',
        icon: '📋',
        onExecute: () => {
          const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
          if (lastAssistant) {
            handleCopyMessage(lastAssistant);
            toast('已复制最后一条助手消息', 'success');
          }
        },
      },
      {
        id: 'toggle-editor',
        label: editorMode ? '关闭编辑器' : '打开编辑器',
        description: '切换分屏代码编辑器',
        category: '视图',
        icon: '💻',
        onExecute: () => setEditorMode(!editorMode),
      },
      {
        id: 'open-browser-preview',
        label: '打开浏览器预览',
        description: '在编辑器面板中打开内置浏览器（输入 URL 或自动检测 dev server）',
        category: '视图',
        icon: '🌐',
        onExecute: () => {
          // Set a default URL if none detected yet
          if (!browserPreviewUrl) {
            setBrowserPreviewUrl('http://localhost:3000');
          }
          setEditorMode(true);
        },
      },
      {
        id: 'toggle-right-panel',
        label: rightOpen ? '收起右侧面板' : '展开右侧面板',
        description: '切换计划/工具/概览面板',
        category: '视图',
        shortcut: '⌘\\',
        icon: '📊',
        onExecute: () => setRightOpen((v) => !v),
      },
      {
        id: 'compact-session',
        label: '压缩当前会话',
        description: '压缩对话历史以释放上下文空间',
        category: '会话',
        icon: '🗜',
        onExecute: () => void handleCompactCurrentSession(),
      },
      {
        id: 'new-session',
        label: '新建会话',
        description: '创建一个新的对话会话',
        category: '会话',
        shortcut: '⌘N',
        icon: '✨',
        onExecute: () => {
          navigate('/chat');
          navigateToHome();
        },
      },
      {
        id: 'toggle-yolo',
        label: yoloMode ? '关闭 YOLO 模式' : '开启 YOLO 模式',
        description: '切换自动审批模式',
        category: '设置',
        icon: '⚡',
        onExecute: () => handleToggleYolo(),
      },
      {
        id: 'view-bookmarks',
        label: '查看收藏消息',
        description: `当前会话有 ${bookmarkStore.getSessionBookmarks(currentSessionId ?? '').length} 条收藏`,
        category: '操作',
        icon: '⭐',
        onExecute: () => {
          setRightOpen(true);
          setRightTab('overview');
        },
      },
    ],
    [
      chatSearch,
      messages,
      multiSelect,
      editorMode,
      rightOpen,
      yoloMode,
      currentSessionId,
      bookmarkStore,
      handleCopyMessage,
      handleCompactCurrentSession,
      navigate,
      navigateToHome,
      setEditorMode,
      setRightOpen,
      setRightTab,
      handleToggleYolo,
    ],
  );

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
        const nextMode: DialogueMode = dialogueMode === 'coding' ? 'clarify' : 'coding';
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
      onToggleSidebar: () => toggleLeftSidebar(),
      onToggleRightPanel: () => setRightOpen((v) => !v),
      onNewSession: () => {
        navigate('/chat');
        navigateToHome();
      },
    },
    isPageActive,
  );

  const showSessionSwitchSkeleton = currentSessionId !== null && isSessionLoading && !streaming;

  // Listen for custom events from slash commands
  useEffect(() => {
    const handleOpenTemplates = () => setShowTemplatePanel(true);
    const handleExportChat = () => {
      const content = exportMessages(messages, 'markdown');
      downloadExport(content, `chat-export-${Date.now()}.md`, 'text/markdown');
      toast('对话已导出为 Markdown', 'success');
    };
    const handleOpenBrowser = () => {
      if (!browserPreviewUrl) {
        setBrowserPreviewUrl('http://localhost:3000');
      }
      setEditorMode(true);
    };
    const handleComposerInsert = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | { text?: string; mode?: 'append' | 'replace' }
        | undefined;
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

  return (
    <div className="page-root page-root-row" style={{ position: 'relative' }}>
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

      <div
        aria-hidden={!leftSidebarOpen}
        style={{
          width: shouldOverlaySidebar ? sidebarWidth : leftSidebarOpen ? sidebarWidth : 0,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          height: '100%',
          borderRight: leftSidebarOpen ? '1px solid var(--border-subtle)' : 'none',
          transition: shouldOverlaySidebar
            ? 'transform 200ms ease, opacity 200ms ease'
            : 'width 200ms ease',
          pointerEvents: leftSidebarOpen ? undefined : 'none',
          position: shouldOverlaySidebar ? 'absolute' : 'relative',
          left: shouldOverlaySidebar ? 0 : undefined,
          top: shouldOverlaySidebar ? 0 : undefined,
          bottom: shouldOverlaySidebar ? 0 : undefined,
          zIndex: shouldOverlaySidebar ? 35 : undefined,
          transform: shouldOverlaySidebar
            ? leftSidebarOpen
              ? 'translateX(0)'
              : 'translateX(-100%)'
            : undefined,
          opacity: shouldOverlaySidebar ? (leftSidebarOpen ? 1 : 0) : 1,
          boxShadow: shouldOverlaySidebar && leftSidebarOpen ? 'var(--shadow-lg)' : 'none',
          background: shouldOverlaySidebar ? 'var(--surface)' : undefined,
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            width: sidebarWidth,
            maxWidth: '100%',
          }}
        >
          <SessionSidebar
            onOpenFile={(path) => {
              void fileEditor.openFile(path);
              setEditorMode(true);
              setEditorPaneTab('code');
            }}
            fetchRootPath={workspace.fetchRootPath}
            fetchTree={workspace.fetchTree}
            onOpenWorkspacePicker={() => setShowWorkspaceSelector(true)}
          />
        </div>
      </div>

      {shouldOverlaySidebar && leftSidebarOpen && (
        <button
          type="button"
          aria-label="关闭侧栏遮罩"
          onClick={() => setLeftSidebarOpen(false)}
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 30,
            background: 'oklch(0 0 0 / 0.42)',
            backdropFilter: 'blur(1px)',
          }}
        />
      )}

      <div
        ref={splitContainerRef}
        style={
          {
            display: 'flex',
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            background: 'var(--bg)',
            // CSS variable — drag handler 在拖动期间直接更新这个值,
            // 避免每帧通过 React state 触发整页 rerender + persist 落盘。
            ['--split-pos' as string]: `${splitPos}%`,
          } as React.CSSProperties
        }
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            flex: editorMode ? '0 0 auto' : 1,
            width: editorMode ? 'calc(var(--split-pos) - 2.5px)' : '100%',
            minWidth: 0,
            minHeight: 0,
            overflow: 'hidden',
            transition: splitDragging.current ? 'none' : 'width 240ms ease',
            position: 'relative',
          }}
        >
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
          <LatestAssistantMessageContext.Provider value={latestAssistantMessageId}>
            <SessionConversationView
              sessionId={currentSessionId}
              sessionSource="chat"
              currentUserEmail={currentUserEmail}
              gatewayUrl={gatewayUrl}
              token={token}
              topBar={
                <>
                  <ChatTopBar
                    dialogueMode={dialogueMode}
                    onChangeDialogueMode={handleDialogueModeChange}
                    yoloMode={yoloMode}
                    onToggleYolo={handleToggleYolo}
                    editorMode={editorMode}
                    onToggleEditorMode={() =>
                      startSessionSwitchTransition(() => setEditorMode(!editorMode))
                    }
                    rightOpen={rightOpen}
                    onToggleRightOpen={() => setRightOpen((o) => !o)}
                    terminalsChip={
                      currentSessionId ? (
                        <SessionTerminalsChip
                          terminals={sessionTerminals.terminals}
                          runningCount={sessionTerminals.runningCount}
                          loading={sessionTerminals.loading}
                          error={sessionTerminals.error}
                          pendingKillIds={sessionTerminals.pendingKillIds}
                          onKillTerminal={sessionTerminals.killTerminal}
                          onReload={sessionTerminals.reload}
                          gatewayUrl={gatewayUrl}
                          token={token}
                          sessionId={currentSessionId}
                        />
                      ) : null
                    }
                    quickTerminalToggle={
                      currentSessionId ? (
                        <QuickTerminalToggle
                          open={quickTerminalOpen}
                          onToggle={() =>
                            setQuickTerminalOpenForWorkspace(
                              effectiveWorkingDirectory,
                              !quickTerminalOpen,
                            )
                          }
                        />
                      ) : null
                    }
                    onOpenCommandPalette={commandPalette.open}
                    bookmarkCount={bookmarkStore.getSessionBookmarks(currentSessionId ?? '').length}
                    multiSelectActive={multiSelect.multiSelect.enabled}
                    onToggleMultiSelect={() => {
                      if (multiSelect.multiSelect.enabled) {
                        multiSelect.disableMultiSelect();
                      } else {
                        multiSelect.enableMultiSelect();
                        requestAnimationFrame(() => multiSelect.selectAll(messages));
                      }
                    }}
                    onOpenBrowser={() => {
                      startSessionSwitchTransition(() => {
                        if (!browserPreviewUrl) {
                          setBrowserPreviewUrl('http://localhost:3000');
                        }
                        setEditorMode(true);
                        setEditorPaneTab('browser');
                      });
                    }}
                    browserActive={!!browserPreviewUrl}
                    sidebarOpen={leftSidebarOpen}
                    onToggleSidebar={() => toggleLeftSidebar()}
                    editorPaneTab={editorPaneTab}
                    onActivateCodeTab={() => {
                      // 用 transition 降级为非阻塞更新 — `editorMode` /
                      // `editorPaneTab` 同时被多处 ChatPage 订阅,没有
                      // transition 的话整树 rerender 会在 click handler
                      // 内同步发生,触发 [Violation] 'click' handler
                      // took ~190ms。视觉切换走 React concurrent 调度。
                      startSessionSwitchTransition(() => {
                        if (editorMode && editorPaneTab === 'code') {
                          setEditorMode(false);
                          return;
                        }
                        setEditorMode(true);
                        setEditorPaneTab('code');
                      });
                    }}
                    onActivateBrowserTab={() => {
                      startSessionSwitchTransition(() => {
                        if (editorMode && editorPaneTab === 'browser') {
                          setEditorMode(false);
                          return;
                        }
                        if (!browserPreviewUrl) {
                          setBrowserPreviewUrl('http://localhost:3000');
                        }
                        setEditorMode(true);
                        setEditorPaneTab('browser');
                      });
                    }}
                    todoController={todoController}
                    todoDetailsId={todoDetailsId}
                  />
                  {multiSelect.multiSelect.enabled && (
                    <MultiSelectToolbar
                      selectedCount={multiSelect.selectedCount}
                      onCopy={() => {
                        const selected = multiSelect.getSelectedMessages(messages);
                        if (selected.length > 0) {
                          void copyExportToClipboard(selected, 'text').then((ok) => {
                            if (ok) toast(`已复制 ${selected.length} 条消息`, 'success');
                          });
                        }
                      }}
                      onExport={() => {
                        const selected = multiSelect.getSelectedMessages(messages);
                        if (selected.length > 0) {
                          const content = exportMessages(selected, 'markdown');
                          downloadExport(
                            content,
                            `chat-selected-${Date.now()}.md`,
                            'text/markdown',
                          );
                          toast(`已导出 ${selected.length} 条消息`, 'success');
                        }
                      }}
                      onBookmark={() => {
                        const selected = multiSelect.getSelectedMessages(messages);
                        for (const msg of selected) {
                          if (!bookmarkStore.isBookmarked(msg.id)) {
                            bookmarkStore.addBookmark({
                              messageId: msg.id,
                              sessionId: currentSessionId ?? '',
                              content: msg.content.slice(0, 200),
                              role: msg.role,
                            });
                          }
                        }
                        toast(`已收藏 ${selected.length} 条消息`, 'success');
                        multiSelect.disableMultiSelect();
                      }}
                      onSelectAll={() => multiSelect.selectAll(messages)}
                      onCancel={() => multiSelect.disableMultiSelect()}
                    />
                  )}
                </>
              }
              beforeMessages={
                <>
                  <SubAgentRunList
                    items={subAgentRunItems}
                    selectedSessionId={selectedChildSessionId}
                    onSelectSession={openChildSessionInspector}
                  />
                  <UserHistoryJumpList
                    items={userHistoryJumpItems}
                    scrollRegionRef={scrollRegionRef}
                    ensureMessageVisible={ensureMessageVisible}
                  />
                </>
              }
              afterMessages={
                <>
                  {latestGeneratedImageResult && artifactsWorkspaceHref && (
                    <ChatImageGenerationResultStrip
                      artifactTitle={latestGeneratedImageResult.artifactTitle}
                      modelLabel={latestGeneratedImageResult.modelLabel}
                      onContinueEditing={continueEditingLatestGeneratedImage}
                      onOpenArtifactsWorkspace={() => navigate(artifactsWorkspaceHref)}
                    />
                  )}
                </>
              }
              composerRightSlot={
                <CompanionStage
                  agentId={effectiveAgentId}
                  attachedCount={0}
                  currentUserEmail={currentUserEmail}
                  editorMode={editorMode}
                  input={input}
                  panelOpenSignal={companionPanelSignal}
                  pendingPermissionCount={pendingPermissions.length}
                  prefersReducedMotion={prefersReducedMotion}
                  queuedCount={0}
                  rightOpen={rightOpen}
                  sessionBusyState={remoteSessionBusyState}
                  sessionId={currentSessionId}
                  showVoice={false}
                  streaming={streaming}
                  todoCount={sessionTodos.length}
                />
              }
              composerExtras={{
                imageGeneration: true,
                skillRecommendation: true,
                multiSelect: true,
                bookmarks: true,
                promptTemplate: true,
                commandPalette: true,
                dialogueModeToggle: true,
                yoloMode: true,
                agentSwitch: true,
              }}
              messages={messages}
              groupedMessageEntries={groupedMessageEntries}
              visibleMessageCount={visibleMessageCount ?? sanitizedHistoricalMessages.length}
              hiddenMessageCount={hiddenMessageCount}
              visibleStreaming={visibleStreaming}
              showSessionSwitchSkeleton={showSessionSwitchSkeleton}
              remoteSessionBusyState={remoteSessionBusyState}
              pendingPermissions={pendingPermissions}
              resolveInlinePermissionActions={resolveInlinePermissionActions}
              providerCatalog={providerCatalog}
              activeProviderId={activeProviderId}
              activeModelId={activeModelId}
              activeModelLabel={activeModelOption?.label}
              onLoadEarlier={() => {
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
              }}
              welcomeScreen={{
                hasWorkspace: !!effectiveWorkingDirectory,
                dialogueMode,
                onNewSession: () => void ensureSession(),
                onOpenWorkspace: () => setShowWorkspaceSelector(true),
                onSelectMode: handleDialogueModeChange,
              }}
              streaming={streaming}
              stoppingStream={stoppingStream}
              streamError={streamError}
              onDismissStreamError={() => setStreamError(null)}
              checkpointCount={compactions.length}
              pendingQuestionsCount={pendingQuestions.length}
              stopCapability={stopCapability}
              onOpenRecovery={() => {
                setRightOpen(true);
                setRightTab('overview');
              }}
              scrollRegionRef={scrollRegionRef}
              contentColumnRef={contentColumnRef}
              bottomRef={bottomRef}
              onScroll={handleScroll}
              showScrollToBottom={showScrollToBottom}
              hasPendingFollowContent={hasPendingFollowContent}
              onScrollToBottom={(behavior, target) => scrollToBottom(behavior, target)}
              editorMode={editorMode}
              sessionTodos={sessionTodos}
              rightOpen={rightOpen}
              activePendingQuestion={activePendingQuestion}
              inlineQuestionAnswers={inlineQuestionAnswers}
              inlineQuestionCustomInputs={inlineQuestionCustomInputs}
              inlineQuestionReplyStatus={inlineQuestionReplyStatus}
              inlineQuestionReplyError={inlineQuestionReplyError}
              onToggleInlineQuestionOption={toggleInlineQuestionOption}
              onChangeInlineQuestionCustomInput={handleInlineQuestionCustomInput}
              onReplyInlineQuestion={replyInlineQuestion}
              historyEditPrompt={historyEditPrompt}
              onCloseHistoryEdit={() => setHistoryEditPrompt(null)}
              onResendHistoryEdit={(text, editedInputParts) => {
                if (!historyEditPrompt) return;
                void handleEditResendInCurrentSession(
                  text,
                  historyEditPrompt.messageId,
                  editedInputParts as never,
                );
                setHistoryEditPrompt(null);
              }}
              onContinueHistoryEdit={(text, editedInputParts) => {
                if (editedInputParts && (editedInputParts as unknown[]).length > 0) {
                  void sendMessage(text, {
                    existingInputParts: editedInputParts as never,
                  });
                } else {
                  focusComposerWithText(text);
                }
                setHistoryEditPrompt(null);
              }}
              onCreateBranchFromHistoryEdit={(text, editedInputParts) => {
                if (!historyEditPrompt) return;
                void createBranchSessionFromMessage(
                  text,
                  historyEditPrompt.messageId,
                  editedInputParts as never,
                );
                setHistoryEditPrompt(null);
              }}
              retryPrompt={retryPrompt}
              onCloseRetry={() => setRetryPrompt(null)}
              onRetryCurrent={() => {
                void handleRetryInCurrentSession();
              }}
              onRetryBranch={() => {
                void handleRetryInNewSession();
              }}
              chatSearch={chatSearch}
              composerVariant={composerVariant}
              providers={providers}
              activeProvider={activeProvider}
              activeModelOption={activeModelOption}
              activeModelCanConfigureThinking={activeModelCanConfigureThinking}
              activeModelTooltip={activeModelTooltip}
              canStopCurrentSessionStream={canStopCurrentSessionStream}
              dialogueMode={dialogueMode}
              manualAgentId={manualAgentId}
              yoloMode={yoloMode}
              webSearchEnabled={webSearchEnabled}
              thinkingEnabled={thinkingEnabled}
              reasoningEffort={reasoningEffort}
              imageReferenceArtifacts={availableImageEditReferenceArtifacts}
              selectedImageEditReferenceArtifactId={selectedImageEditReferenceArtifactId}
              latestGeneratedImageResult={latestGeneratedImageResult}
              artifactsWorkspaceHref={artifactsWorkspaceHref}
              imageGenerationMode={imageGenerationMode}
              hasConfiguredImageModel={hasConfiguredImageModel}
              imageGenerationBusy={imageGenerationBusy}
              imageGenerationDefaults={imageGenerationDefaults}
              imageModelLabel={imageModelLabel}
              imagePluginEnabled={imagePluginEnabled}
              toggleImageGenerationMode={toggleImageGenerationMode}
              updateImageGenerationDefaults={updateImageGenerationDefaults}
              composerWorkspaceCatalog={composerWorkspaceCatalog}
              composerCommandDescriptors={composerCommandDescriptors}
              agentOptions={agentOptions}
              effectiveAgentId={effectiveAgentId}
              defaultAgentLabel={defaultAgentLabel}
              input={input}
              setInput={setInput}
              textareaRef={textareaRef}
              onComposerSubmit={async (payload) => {
                await sendMessage(payload.text, {
                  queuedFiles: payload.files,
                  queuedAttachmentItems: payload.attachmentItems,
                  queuedMessageId: payload.queuedMessageId,
                });
              }}
              onStopComposer={() => void stopActiveMessage()}
              onComposerModelSelect={async (pid: string, mid: string) => {
                setActiveProviderId(pid);
                setActiveModelId(mid);
                markSessionMetadataDirty();
              }}
              onToggleWebSearch={handleToggleWebSearch}
              onThinkingEnabledChange={(enabled) => {
                setThinkingEnabled(enabled);
                markSessionMetadataDirty();
              }}
              onReasoningEffortChange={(effort) => {
                setReasoningEffort(effort);
                markSessionMetadataDirty();
              }}
              onManualAgentChange={handleManualAgentChange}
              onClearManualAgentId={handleClearManualAgentId}
              onContinueEditingImage={continueEditingLatestGeneratedImage}
              onNavigateToArtifacts={
                artifactsWorkspaceHref ? () => navigate(artifactsWorkspaceHref) : undefined
              }
              onSelectImageReferenceArtifactId={setSelectedImageEditReferenceArtifactId}
              markSessionMetadataDirty={markSessionMetadataDirty}
              contextUsedTokens={contextUsageSnapshot?.usedTokens}
              contextMaxTokens={contextUsageSnapshot?.maxTokens}
              contextIsEstimated={contextUsageSnapshot?.estimated}
            />
            {currentSessionId ? (
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
              />
            ) : null}
          </LatestAssistantMessageContext.Provider>
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
          workspacePath={effectiveWorkingDirectory}
          activeTab={editorPaneTab}
          onTabChange={setEditorPaneTab}
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
        attachmentItems={[]}
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
        sessionTerminals={sessionTerminals.terminals}
        sessionTerminalsRunningCount={sessionTerminals.runningCount}
        sessionTerminalsLoading={sessionTerminals.loading}
        sessionTerminalsError={sessionTerminals.error}
        sessionTerminalsPendingKillIds={sessionTerminals.pendingKillIds}
        onKillTerminal={sessionTerminals.killTerminal}
        onReloadTerminals={sessionTerminals.reload}
        ensureMessageVisible={ensureMessageVisible}
      />
    </div>
  );
}
