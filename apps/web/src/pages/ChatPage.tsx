import React, { useEffect, useRef, useState, useCallback, useMemo, useTransition } from 'react';
import { makeOrderedMessageId } from './chat-page/ordered-id.js';
import { useFileEditor } from '../hooks/useFileEditor.js';
import { usePageActivation } from '../components/CachedRouteOutlet.js';
import { ChatComposer } from '../components/chat/ChatComposer.js';
import {
  ChatMessageGroupList,
  type ChatRenderEntry,
  type ChatRenderGroup,
} from '../components/chat/chat-message-group-list.js';
import { ChatSessionSkeleton } from '../components/chat/chat-session-skeleton.js';
import { ChatTopBar } from '../components/chat/ChatTopBar.js';
import {
  ModelPicker,
  ModelSettingsPopover,
  renderChatMessageContentWithOptions,
  renderStreamingChatMessageContentWithOptions,
  sharedUiThemeVars,
  WelcomeScreen,
} from '../components/chat/ChatPageSections.js';
import { useFileEditorContext } from '../App.js';
import { useUIStateStore } from '../stores/uiState.js';
import { useChatQueueStore } from '../stores/chat-queue.js';
import { useLocation, useParams, useNavigate } from 'react-router';
import { useAuthStore } from '../stores/auth.js';
import { useGatewayClient } from '../hooks/useGatewayClient.js';
import { detectThinkKeyword } from './chat-page/think-keyword-detector.js';
import { useCommandRegistry } from '../hooks/useCommandRegistry.js';
import { useComposerWorkspaceCatalog } from '../hooks/useComposerWorkspaceCatalog.js';
import { useWorkspace } from '../hooks/useWorkspace.js';
import {
  createPermissionsClient,
  createSessionsClient,
  createWorkflowsClient,
} from '@openAwork/web-client';
import type {
  PendingPermissionRequest,
  PendingQuestionRequest,
  PermissionDecision,
  Session,
  SessionMessageRatingRecord,
  SessionMessageRatingValue,
  SessionRecoveryReadModel,
  SessionTask,
} from '@openAwork/web-client';
import type { CommandResultCard, Message, RunEvent } from '@openAwork/shared';
import { logger } from '../utils/logger.js';
import {
  publishSessionPendingPermission,
  publishSessionPendingQuestion,
  requestCurrentSessionRefresh,
  requestSessionListRefresh,
  subscribeCurrentSessionRefresh,
} from '../utils/session-list-events.js';
import { extractWorkingDirectory } from '../utils/session-metadata.js';
import type { MCPServerStatus } from '@openAwork/shared-ui';
import type { AttachmentItem } from '@openAwork/shared-ui';
import WorkspacePickerModal from '../components/WorkspacePickerModal.js';
import HistoryEditDialog from './chat-page/history-edit-dialog.js';
import RetryModeDialog from './chat-page/retry-mode-dialog.js';
import { getDefaultAgentForDialogueMode, type DialogueMode } from './dialogue-mode.js';
import {
  applyPermissionDecisionToLocalAssistantMessages,
  applyToolResultToLocalAssistantMessages,
  createAssistantTraceContent,
  dismissPermissionEventMessage,
  detectComposerTrigger,
  estimateTokenCount,
  matchClientSlashCommand,
  matchServerSlashCommand,
  normalizeChatMessages,
  parseAssistantTraceContent,
  parseToolCallInputText,
  parseSessionModeMetadata,
  reconcileSnapshotChatMessages,
  sanitizeComposerPlainText,
  hasActivePendingPermissionRequest,
  upsertPermissionEventMessage,
  type ReasoningEffort,
  type ChatMessage,
  type ComposerMenuState,
  type WorkspaceFileMentionItem,
} from './chat-page/support.js';
import {
  filterTranscriptMessages,
  shouldShowRunEventInTranscript,
} from './chat-page/transcript-visibility.js';
import { ChatRightPanel } from './chat-page/chat-right-panel.js';
import {
  useChatMessageActions,
  type HistoryEditPrompt,
  type RetryPrompt,
} from './chat-page/use-chat-message-actions.js';
import {
  type PreparedSessionRecoveryState,
  type LiveToolCallState,
  type SessionsClientWithActiveStop,
  SESSION_SWITCH_DEFER_THRESHOLD,
  REMOTE_STREAM_RECOVERY_POLL_MS,
  CHAT_SCROLL_BOTTOM_PADDING,
  CHAT_SCROLL_BOTTOM_SPACER_HEIGHT,
  normalizeModelLookupKey,
  buildQueuedComposerScopeKey,
  createSessionMetadataSnapshot,
  prepareSessionRecoveryState,
  deriveLatestUserGoal,
  buildRightPanelStateFromSessionSnapshot,
  isImmediatelyRenderableStructuredContent,
} from './chat-page/chat-page-utils.js';
import { useSessionViewGuard } from './chat-page/use-session-view-guard.js';
import { useStreamReveal } from './chat-page/use-stream-reveal.js';
import { useScrollManager } from './chat-page/use-scroll-manager.js';
import { useComposerCallbacks } from './chat-page/use-composer-callbacks.js';
import { useComposerQueue } from './chat-page/use-composer-queue.js';
import { useSessionSnapshotLoader } from './chat-page/use-session-snapshot-loader.js';
import { useModelPrices } from './chat-page/use-model-prices.js';
import { useSessionSettingsCallbacks } from './chat-page/use-session-settings-callbacks.js';
import { useChatRenderData } from './chat-page/use-chat-render-data.js';
import { useChatUiActions } from './chat-page/use-chat-ui-actions.js';
import { useAssistantMessageProcessing } from './chat-page/use-assistant-message-processing.js';
import { useProviderModelInfo } from './chat-page/use-provider-model-info.js';
import { useComposerMenuItems } from './chat-page/use-composer-menu-items.js';
import { useChatDataLoaders } from './chat-page/use-chat-data-loaders.js';
import { ChatScrollBottomButton } from './chat-page/chat-scroll-bottom-button.js';
import { ChatStreamErrorBar } from './chat-page/chat-stream-error-bar.js';
import { toast } from '../components/ToastNotification.js';
import { ChatEditorPane } from './chat-page/chat-editor-pane.js';
import { executeServerCommand } from './chat-page/server-command-item.js';
import { ChatTodoBar } from './chat-page/chat-todo-bar.js';
import { useSessionContentArtifactCount } from './chat-page/use-session-content-artifact-count.js';
import { useSessionSidebarRunState } from './chat-page/use-session-sidebar-run-state.js';
import {
  SessionRunStateBar,
  SessionRunStatePlaceholder,
} from './chat-page/session-run-state-bar.js';
import {
  flattenSessionTodoLanes,
  shouldPollSessionRuntime,
  toSessionPendingPermissionState,
  type SessionStateStatus,
  type SessionTodoItem,
} from './chat-page/session-runtime.js';
import { buildSubAgentRunItems, SubAgentRunList } from './chat-page/sub-agent-run-list.js';
import { startSequentialPolling } from './chat-page/sequential-polling.js';
import { SubSessionDetailPanel } from './chat-page/sub-session-detail-panel.js';
import {
  buildTaskToolRuntimeLookup,
  buildTerminalTaskSyncMarker,
  resolveTaskToolRuntimeSnapshot,
} from './chat-page/task-tool-runtime.js';
import {
  applyChatRightPanelEvent,
  applyChatRightPanelChunk,
  buildChatRightPanelStateFromRunEvents,
  clearResolvedPendingPermissionToolCalls,
  createInitialChatRightPanelState,
  getToolCallCards,
  startChatRightPanelRun,
} from './chat-stream-state.js';
import {
  mergeChatBackendUsageSnapshot,
  type ChatBackendUsageSnapshot,
} from './chat-page/stream-usage.js';
import {
  recoverActiveAssistantStream,
  type RecoveredActiveAssistantStream,
} from './chat-page/stream-recovery.js';
import {
  createQueuedComposerPreview,
  hydrateQueuedComposerMessage,
  toPersistedQueuedComposerMessage,
  type QueuedComposerMessage,
} from './chat-page/queued-composer-state.js';
import {
  deleteQueuedComposerFiles,
  restoreQueuedComposerFiles,
} from './chat-page/queued-composer-file-store.js';
import { appendAttachmentSummary, uploadChatAttachments } from './chat-page/attachment-upload.js';
import {
  loadSavedChatSessionDefaults,
  type ChatSettingsProvider,
} from '../utils/chat-session-defaults.js';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion.js';
import { CompanionStage } from '../components/chat/companion/companion-stage.js';

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
  const [reportedStreamUsage, setReportedStreamUsage] = useState<ChatBackendUsageSnapshot | null>(
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
  const pendingSessionNormalizeTimeoutRef = useRef<number | null>(null);
  const activeSessionRef = useRef<string | null>(sessionId ?? null);
  const currentLoadedSessionIdRef = useRef<string | null>(currentSessionId);
  const sessionViewEpochRef = useRef(0);
  const currentSessionViewRef = useRef<{ epoch: number; sessionId: string | null }>({
    epoch: 0,
    sessionId: sessionId ?? null,
  });
  const lastParentTaskSyncMarkerRef = useRef<string | null>(null);
  const pendingBootstrapSessionRef = useRef<string | null>(null);
  const previousRouteSessionIdRef = useRef<string | null>(sessionId ?? null);
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
  const [dialogueMode, setDialogueMode] = useState<DialogueMode>('clarify');
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
  const modelPrices = useModelPrices(gatewayUrl, token);
  const [rightPanelState, setRightPanelState] = useState(() => createInitialChatRightPanelState());
  const [childSessions, setChildSessions] = useState<Session[]>([]);
  const [selectedChildSessionId, setSelectedChildSessionId] = useState<string | null>(null);
  const [sessionTodos, setSessionTodos] = useState<SessionTodoItem[]>([]);
  const [sessionTasks, setSessionTasks] = useState<SessionTask[]>([]);
  const [pendingPermissions, setPendingPermissions] = useState<PendingPermissionRequest[]>([]);
  const [pendingQuestions, setPendingQuestions] = useState<PendingQuestionRequest[]>([]);
  const [inlinePermissionPendingDecision, setInlinePermissionPendingDecision] = useState<{
    decision: PermissionDecision;
    requestId: string;
  } | null>(null);
  const [inlinePermissionErrors, setInlinePermissionErrors] = useState<Record<string, string>>({});
  const [sessionStateStatus, setSessionStateStatus] = useState<SessionStateStatus | null>(null);
  const [isSessionSnapshotReady, setIsSessionSnapshotReady] = useState(false);
  const sessionMetadataDirtyRef = useRef(false);
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
    setRecoveredStreamSnapshot,
    setStreaming,
    setStoppingStream,
    setActiveStreamStartedAt,
    setActiveStreamFirstTokenLatencyMs,
  });
  const attachAttemptedSessionRef = useRef<string | null>(null);
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
  }, [currentSessionId]);

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
    const { defaults, providers: loadedProviders } = await loadSavedChatSessionDefaults(
      gatewayUrl,
      token,
    );
    savedChatDefaultsRef.current = defaults;

    return { defaults, providers: loadedProviders };
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

        const { defaults, providers: loadedProviders } = loaded;

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

        if (!sessionId) {
          setThinkingEnabled(defaults.thinkingEnabled);
          setReasoningEffort(defaults.reasoningEffort);
        }
      })
      .catch(() => null);
  }, [loadSavedChatDefaults, sessionId, token]);

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

    return null;
  }, [sessionStateStatus, streaming]);
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
  const visibleStreamThinkingBuffer = streaming
    ? streamThinkingBuffer
    : (recoveredStreamSnapshot?.thinking ?? '');
  const visibleStreamStartedAt = streaming
    ? activeStreamStartedAt
    : (recoveredStreamSnapshot?.startedAt ?? null);
  const visibleReportedStreamUsage = reportedStreamUsage ?? recoveredStreamSnapshot?.usage ?? null;
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
      .getRecovery(token, targetSessionId)
      .then((session) => {
        if (cancelled || !isCurrentSessionView(targetSessionId, expectedSessionViewEpoch)) {
          return;
        }

        const prepared = prepareSessionRecoveryState(session);
        lastParentTaskSyncMarkerRef.current = nextMarker;
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
        );
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
      if (currentLoadedSessionIdRef.current !== null) {
        if (chatView !== 'home') {
          navigateToHome();
        }
        setCurrentSessionId(null);
        setSelectedChildSessionId(null);
        setIsSessionLoading(false);
        setMessages([]);
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

    navigateToSession();
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
        .getRecovery(token, requestedSessionId, { signal: runtimeSnapshotController.signal })
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
            syncRecoveredStreamSnapshot(
              prepared.session,
              prepared.sessionStateStatus,
              recovery.activeStream,
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

    setSelectedChildSessionId(null);
    setIsSessionLoading(true);
    setMessages([]);
    setRightPanelState(createInitialChatRightPanelState());
    setChildSessions([]);
    setSessionTasks([]);
    setPendingPermissions([]);
    setPendingQuestions([]);
    setSessionStateStatus(null);
    setIsSessionSnapshotReady(false);
    setSessionModesHydrated(false);
    setSessionMetadataDirty(false);
    lastPersistedSessionMetadataSnapshotRef.current = null;
    resetStreamState();
    setStreamError(null);
    setDialogueMode('clarify');
    setManualAgentId('');
    setYoloMode(false);
    setWebSearchEnabled(true);
    setThinkingEnabled(false);
    setReasoningEffort('medium');
    setActiveProviderId('');
    setActiveModelId('');

    createSessionsClient(gatewayUrl)
      .getRecovery(token, requestedSessionId, { signal: runtimeSnapshotController.signal })
      .then((recovery) => {
        if (cancelled || !isCurrentSessionView(requestedSessionId, sessionViewEpoch)) {
          return;
        }
        const prepared = prepareSessionRecoveryState(recovery);
        const metadata = prepared.metadata;
        const applySessionPayload = () => {
          if (cancelled || !isCurrentSessionView(requestedSessionId, sessionViewEpoch)) {
            return;
          }

          startSessionSwitchTransition(() => {
            setMessages(prepared.normalizedMessages);
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
            syncRecoveredStreamSnapshot(
              prepared.session,
              prepared.sessionStateStatus,
              recovery.activeStream,
            );
            setIsSessionSnapshotReady(true);
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
    gatewayUrl,
    isCurrentSessionView,
    navigateToHome,
    navigateToSession,
    resetStreamState,
    sessionId,
    sessionReloadNonce,
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
        await loadCurrentSessionSnapshot(targetSessionId, {
          expectedSessionViewEpoch,
          signal,
        });
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
        setMessageRatings((previous) => ({ ...previous, [message.id]: nextRating }));
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
    focusComposerWithText,
    setHistoryEditPrompt,
    setRetryPrompt,
  });

  const createBranchSessionFromMessage = useCallback(
    async (text: string, sourceMessageId: string) => {
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
      focusComposerWithText(text);
      requestSessionListRefresh();
      void navigate(`/chat/${imported.sessionId}`);
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
      token,
    ],
  );

  const truncateSessionMessagesInPlace = useCallback(
    async (sessionId: string, messageId: string): Promise<Message[]> => {
      if (!token) return [];
      const res = await fetch(`${gatewayUrl}/sessions/${sessionId}/messages/truncate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ messageId, inclusive: true }),
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

  async function sendMessage(
    overrideText?: string,
    options?: {
      forcedSessionId?: string;
      queuedAttachmentItems?: AttachmentItem[];
      queuedFiles?: File[];
      queuedMessageId?: string;
    },
  ): Promise<boolean> {
    const sourceInput = sanitizeComposerPlainText(overrideText ?? input);
    const effectiveFiles = options?.queuedFiles ?? attachedFiles;
    if (
      (!sourceInput.trim() && effectiveFiles.length === 0) ||
      streaming ||
      remoteSessionBusyState
    ) {
      return false;
    }
    const requestOriginSessionId = activeSessionRef.current;
    setStreamError(null);
    let text = sourceInput.trim();
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

    if (effectiveFiles.length > 0) {
      const uploadedAttachmentLines = await uploadChatAttachments({
        files: effectiveFiles,
        gatewayUrl,
        sessionId: sid,
        token,
      });
      text = appendAttachmentSummary(text, uploadedAttachmentLines);
      if (options?.queuedFiles === undefined) {
        setAttachedFiles([]);
        setAttachmentItems([]);
      }
    }

    currentAssistantStreamMessageIdRef.current = makeOrderedMessageId();
    streamingRef.current = true;
    setStreaming(true);
    setStoppingStream(false);
    stoppingStreamRef.current = false;
    setSessionStateStatus('running');
    setReportedStreamUsage(null);
    streamRevealTargetRef.current = '';
    streamRevealVisibleRef.current = '';
    streamRevealTargetCodePointsRef.current = [];
    streamRevealVisibleCodePointCountRef.current = 0;
    streamRevealNextAllowedAtRef.current = 0;
    setStreamBuffer('');
    setStreamThinkingBuffer('');
    isNearBottomRef.current = true;
    setHasPendingFollowContent(false);
    setShowScrollToBottom(false);

    const requestStartedAt = Date.now();
    setActiveStreamStartedAt(requestStartedAt);
    setActiveStreamFirstTokenLatencyMs(null);
    const toolCallIds = new Set<string>();
    const liveToolCalls = new Map<string, LiveToolCallState>();
    const requestProviderId = activeProviderId || undefined;
    const requestModelLabel = (activeModelOption?.label ?? activeModelId) || undefined;

    const buildAssistantTraceMessageContent = (
      textContent: string,
      finalStatus?: 'completed' | 'error' | 'cancelled' | 'paused',
    ): string => {
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
          input: parseToolCallInputText(nextToolState.inputText),
          output: nextToolState.output,
          isError: nextToolState.isError,
          ...(hasPendingPermission
            ? { pendingPermissionRequestId: nextToolState.pendingPermissionRequestId }
            : {}),
          resumedAfterApproval: nextToolState.resumedAfterApproval,
          status,
          ...(durationMs !== undefined ? { durationMs } : {}),
        };
      });

      const reasoningBlocks = accumulatedThinking.trim().length > 0 ? [accumulatedThinking] : [];
      if (reasoningBlocks.length === 0 && toolCalls.length === 0) {
        return textContent;
      }

      return createAssistantTraceContent({
        ...(reasoningBlocks.length > 0 ? { reasoningBlocks } : {}),
        text: textContent,
        toolCalls,
      });
    };

    const userMsg: ChatMessage = {
      id: makeOrderedMessageId(),
      role: 'user',
      content: text,
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
    let firstTokenObservedAt: number | null = null;
    let toolPanelRevealed = false;
    let pausedForPermission = false;
    let pausedForQuestion = false;
    const requestModelSupportsThinking = activeModelOption?.supportsThinking === true;
    setRightPanelState((prev) => startChatRightPanelRun(prev, text));

    client.stream(sid, requestText, {
      agentId: effectiveAgentId,
      dialogueMode,
      displayMessage: text,
      onEvent: (event) => {
        if (activeSessionRef.current !== sid) {
          return;
        }

        if (event.type === 'tool_call_delta') {
          toolCallIds.add(event.toolCallId);
          const previous = liveToolCalls.get(event.toolCallId);
          liveToolCalls.set(event.toolCallId, {
            createdAt: previous?.createdAt ?? event.occurredAt ?? Date.now(),
            inputText: `${previous?.inputText ?? ''}${event.inputDelta}`,
            output: previous?.output,
            isError: previous?.isError,
            resumedAfterApproval: previous?.resumedAfterApproval,
            toolCallId: event.toolCallId,
            status: 'streaming',
            toolName: event.toolName,
          });
        }

        if (event.type === 'usage') {
          setReportedStreamUsage((previous) => mergeChatBackendUsageSnapshot(previous, event));
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
          pausedForPermission = true;
          setSessionStateStatus('paused');
          setMessages((previous) => upsertPermissionEventMessage(previous, event));
          setPendingPermissions((previous) => {
            const nextPermission: PendingPermissionRequest = {
              createdAt: new Date(event.occurredAt ?? Date.now()).toISOString(),
              decision: undefined,
              previewAction: event.previewAction,
              reason: event.reason,
              requestId: event.requestId,
              riskLevel: event.riskLevel,
              scope: event.scope,
              sessionId: sid,
              status: 'pending',
              toolName: event.toolName,
            };

            const existingIndex = previous.findIndex(
              (permission) => permission.requestId === event.requestId,
            );
            if (existingIndex === -1) {
              return [nextPermission, ...previous];
            }

            return previous.map((permission, index) =>
              index === existingIndex ? { ...permission, ...nextPermission } : permission,
            );
          });
          resetStreamState();
          requestSessionListRefresh();
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
          if (event.type === 'tool_call_delta' || event.type === 'done' || event.type === 'error') {
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
      onThinkingDelta: (delta: string) => {
        if (activeSessionRef.current !== sid || stoppingStreamRef.current) {
          return;
        }

        accumulatedThinking += delta;
        setStreamThinkingBuffer(accumulatedThinking);
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
      onDone: (stopReason) => {
        if (activeSessionRef.current !== sid) {
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
          const content = buildAssistantTraceMessageContent(finalAccumulatedText, traceFinalStatus);
          setMessages((prev) => [
            ...prev,
            {
              id: currentAssistantStreamMessageIdRef.current ?? makeOrderedMessageId(),
              role: 'assistant',
              content,
              createdAt: finishedAt,
              durationMs: finishedAt - requestStartedAt,
              stopReason: resolvedStopReason,
              tokenEstimate: estimateTokenCount(
                [accumulatedThinking, finalAccumulatedText]
                  .filter((item) => item.trim().length > 0)
                  .join('\n\n'),
              ),
              toolCallCount: toolCallIds.size,
              providerId: requestProviderId,
              model: requestModelLabel,
              firstTokenLatencyMs:
                firstTokenObservedAt !== null ? firstTokenObservedAt - requestStartedAt : undefined,
              status: 'completed',
            },
          ]);
        } else if (wasCancelled) {
          const content = buildAssistantTraceMessageContent('已停止', traceFinalStatus);
          setMessages((prev) => [
            ...prev,
            {
              id: currentAssistantStreamMessageIdRef.current ?? makeOrderedMessageId(),
              role: 'assistant',
              content,
              createdAt: finishedAt,
              durationMs: finishedAt - requestStartedAt,
              stopReason: resolvedStopReason,
              tokenEstimate: estimateTokenCount(
                [accumulatedThinking, '已停止']
                  .filter((item) => item.trim().length > 0)
                  .join('\n\n'),
              ),
              toolCallCount: toolCallIds.size,
              providerId: requestProviderId,
              model: requestModelLabel,
              firstTokenLatencyMs:
                firstTokenObservedAt !== null ? firstTokenObservedAt - requestStartedAt : undefined,
              status: 'completed',
            },
          ]);
        }
        setSessionStateStatus(isPausedForPermission ? 'paused' : 'idle');
        resetStreamState();
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
        const content = buildAssistantTraceMessageContent(errorContent, 'error');
        setMessages((prev) => [
          ...prev,
          {
            id: makeOrderedMessageId(),
            role: 'assistant',
            content,
            createdAt: finishedAt,
            durationMs: finishedAt - requestStartedAt,
            stopReason: 'error',
            tokenEstimate: estimateTokenCount(
              [accumulatedThinking, errorContent]
                .filter((item) => item.trim().length > 0)
                .join('\n\n'),
            ),
            toolCallCount: toolCallIds.size,
            providerId: requestProviderId,
            model: requestModelLabel,
            firstTokenLatencyMs:
              firstTokenObservedAt !== null ? firstTokenObservedAt - requestStartedAt : undefined,
            status: 'error',
          },
        ]);
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
    async (request: PendingPermissionRequest, decision: PermissionDecision) => {
      if (!token) {
        setStreamError('当前未登录，无法处理权限审批。');
        return;
      }

      setInlinePermissionPendingDecision({ decision, requestId: request.requestId });
      setInlinePermissionErrors((previous) => {
        const next = { ...previous };
        delete next[request.requestId];
        return next;
      });

      try {
        await createPermissionsClient(gatewayUrl).reply(token, request.sessionId, {
          requestId: request.requestId,
          decision,
        });
        const successMessage =
          decision === 'once'
            ? '已提交：本次允许'
            : decision === 'session'
              ? '已提交：本会话允许'
              : decision === 'permanent'
                ? '已提交：永久允许'
                : '已提交：已拒绝';
        setMessages((previous) =>
          dismissPermissionEventMessage(
            applyPermissionDecisionToLocalAssistantMessages(previous, request.requestId, decision),
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
        const status =
          typeof error === 'object' &&
          error !== null &&
          typeof Reflect.get(error, 'status') === 'number'
            ? (Reflect.get(error, 'status') as number)
            : null;
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
    const shouldAttemptAttach =
      Boolean(currentSessionId) && sessionStateStatus === 'running' && isPageActive && !streaming;

    if (!shouldAttemptAttach || !currentSessionId) {
      if (!currentSessionId || sessionStateStatus !== 'running' || !isPageActive) {
        attachAttemptedSessionRef.current = null;
      }
      return;
    }

    if (attachAttemptedSessionRef.current === currentSessionId) {
      return;
    }
    attachAttemptedSessionRef.current = currentSessionId;

    const sid = currentSessionId;
    const attachSessionViewEpoch = currentSessionViewRef.current.epoch;
    const initialText = recoveredStreamSnapshot?.text ?? '';
    const initialThinking = recoveredStreamSnapshot?.thinking ?? '';
    const initialUsage = recoveredStreamSnapshot?.usage ?? null;
    const requestStartedAt = recoveredStreamSnapshot?.startedAt ?? Date.now();
    const requestProviderId = activeProviderId || undefined;
    const requestModelLabel = activeModelId || undefined;
    const requestTextCodePoints = Array.from(initialText);
    let attachStateInitialized = false;
    let accumulated = initialText;
    let accumulatedThinking = initialThinking;
    let firstTokenObservedAt: number | null = null;
    let pausedForPermission = false;
    let pausedForQuestion = false;
    const toolCallIds = new Set<string>();
    const liveToolCalls = new Map<string, LiveToolCallState>();
    const buildAttachTraceContent = (
      textContent: string,
      finalStatus?: 'completed' | 'error' | 'cancelled' | 'paused',
    ): string => {
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
          input: parseToolCallInputText(nextToolState.inputText),
          output: nextToolState.output,
          isError: nextToolState.isError,
          ...(hasPendingPermission
            ? { pendingPermissionRequestId: nextToolState.pendingPermissionRequestId }
            : {}),
          resumedAfterApproval: nextToolState.resumedAfterApproval,
          status,
          ...(durationMs !== undefined ? { durationMs } : {}),
        };
      });

      const reasoningBlocks = accumulatedThinking.trim().length > 0 ? [accumulatedThinking] : [];
      if (reasoningBlocks.length === 0 && toolCalls.length === 0) {
        return textContent;
      }
      return createAssistantTraceContent({
        ...(reasoningBlocks.length > 0 ? { reasoningBlocks } : {}),
        text: textContent,
        toolCalls,
      });
    };

    const ensureAttachStateInitialized = () => {
      if (attachStateInitialized) {
        return;
      }
      attachStateInitialized = true;
      currentAssistantStreamMessageIdRef.current = makeOrderedMessageId();
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

          if (event.type === 'tool_call_delta' || event.type === 'tool_result') {
            toolCallIds.add(event.toolCallId);
          }

          if (event.type === 'tool_call_delta') {
            const previous = liveToolCalls.get(event.toolCallId);
            liveToolCalls.set(event.toolCallId, {
              createdAt: previous?.createdAt ?? event.occurredAt ?? Date.now(),
              inputText: `${previous?.inputText ?? ''}${event.inputDelta}`,
              output: previous?.output,
              isError: previous?.isError,
              resumedAfterApproval: previous?.resumedAfterApproval,
              toolCallId: event.toolCallId,
              status: 'streaming',
              toolName: event.toolName,
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
            pausedForPermission = true;
            setSessionStateStatus('paused');
            setMessages((previous) => upsertPermissionEventMessage(previous, event));
            setPendingPermissions((previous) => {
              const nextPermission: PendingPermissionRequest = {
                createdAt: new Date(event.occurredAt ?? Date.now()).toISOString(),
                decision: undefined,
                previewAction: event.previewAction,
                reason: event.reason,
                requestId: event.requestId,
                riskLevel: event.riskLevel,
                scope: event.scope,
                sessionId: sid,
                status: 'pending',
                toolName: event.toolName,
              };

              const existingIndex = previous.findIndex(
                (permission) => permission.requestId === event.requestId,
              );
              if (existingIndex === -1) {
                return [nextPermission, ...previous];
              }

              return previous.map((permission, index) =>
                index === existingIndex ? { ...permission, ...nextPermission } : permission,
              );
            });
            resetStreamState();
            requestSessionListRefresh();
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
        onThinkingDelta: (delta) => {
          if (!isCurrentSessionRequest(sid, attachSessionViewEpoch) || stoppingStreamRef.current) {
            return;
          }
          ensureAttachStateInitialized();
          accumulatedThinking += delta;
          setStreamThinkingBuffer(accumulatedThinking);
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
        onDone: (stopReason) => {
          if (!isCurrentSessionRequest(sid, attachSessionViewEpoch)) {
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
            const content = buildAttachTraceContent(finalAccumulatedText, traceFinalStatus);
            setMessages((prev) => [
              ...prev,
              {
                id: currentAssistantStreamMessageIdRef.current ?? makeOrderedMessageId(),
                role: 'assistant',
                content,
                createdAt: finishedAt,
                durationMs: finishedAt - requestStartedAt,
                stopReason: resolvedStopReason,
                tokenEstimate: estimateTokenCount(
                  [accumulatedThinking, finalAccumulatedText]
                    .filter((item) => item.trim().length > 0)
                    .join('\n\n'),
                ),
                toolCallCount: toolCallIds.size,
                providerId: requestProviderId,
                model: requestModelLabel,
                firstTokenLatencyMs:
                  firstTokenObservedAt !== null
                    ? firstTokenObservedAt - requestStartedAt
                    : undefined,
                status: 'completed',
              },
            ]);
          }
          setSessionStateStatus(isPausedForPermission ? 'paused' : 'idle');
          resetStreamState();
          window.setTimeout(() => {
            void loadCurrentSessionSnapshot(sid, {
              expectedSessionViewEpoch: attachSessionViewEpoch,
              // Preserve the richer local ordering until the backend snapshot catches up.
            }).catch(() => undefined);
          }, 0);
          requestSessionListRefresh();
        },
        onError: (code, message) => {
          if (!isCurrentSessionRequest(sid, attachSessionViewEpoch)) {
            requestSessionListRefresh();
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
          const content = buildAttachTraceContent(errorContent, 'error');
          setMessages((prev) => [
            ...prev,
            {
              id: currentAssistantStreamMessageIdRef.current ?? makeOrderedMessageId(),
              role: 'assistant',
              content,
              createdAt: finishedAt,
              durationMs: finishedAt - requestStartedAt,
              stopReason: 'error',
              tokenEstimate: estimateTokenCount(
                [accumulatedThinking, errorContent]
                  .filter((item) => item.trim().length > 0)
                  .join('\n\n'),
              ),
              toolCallCount: toolCallIds.size,
              providerId: requestProviderId,
              model: requestModelLabel,
              firstTokenLatencyMs:
                firstTokenObservedAt !== null ? firstTokenObservedAt - requestStartedAt : undefined,
              status: 'error',
            },
          ]);
          setSessionStateStatus('idle');
          resetStreamState();
          setStreamError(message ? `${code}: ${message}` : code);
          window.setTimeout(() => {
            void loadCurrentSessionSnapshot(sid, {
              expectedSessionViewEpoch: attachSessionViewEpoch,
              replaceMessages: true,
            }).catch(() => undefined);
          }, 0);
          requestSessionListRefresh();
        },
      })
      .then((attached) => {
        if (!isCurrentSessionRequest(sid, attachSessionViewEpoch)) {
          return;
        }
        if (attached) {
          return;
        }

        // Allow retry if session is still running (e.g. permission-approved resume hasn't started yet)
        // Delay the retry to give the backend time to start the resume runtime thread
        window.setTimeout(() => {
          attachAttemptedSessionRef.current = null;
        }, 1500);

        resetStreamState();
        void loadCurrentSessionSnapshot(sid, {
          expectedSessionViewEpoch: attachSessionViewEpoch,
        }).catch(() => undefined);
      });
  }, [
    activeModelId,
    activeProviderId,
    client,
    currentSessionId,
    isCurrentSessionRequest,
    isPageActive,
    loadCurrentSessionSnapshot,
    prefersReducedMotion,
    appendAssistantEventMessages,
    recoveredStreamSnapshot,
    resetStreamState,
    resolveAssistantCapabilityKind,
    scheduleStreamReveal,
    sessionStateStatus,
    streaming,
  ]);

  async function handleRetryInCurrentSession() {
    if (!retryPrompt) return;
    if (!currentSessionId || !token) return;
    const remainingMessages = await truncateSessionMessagesInPlace(
      currentSessionId,
      retryPrompt.sourceMessageId,
    );
    const normalizedRemainingMessages = filterTranscriptMessages(
      normalizeChatMessages(remainingMessages),
    );
    const fallbackMessages = trimMessagesFromSource(messages, retryPrompt.sourceMessageId);
    const truncateRemovedSource =
      normalizedRemainingMessages.findIndex(
        (message) => message.id === retryPrompt.sourceMessageId,
      ) === -1;
    const nextMessages =
      normalizedRemainingMessages.length > 0 && truncateRemovedSource
        ? normalizedRemainingMessages
        : fallbackMessages;
    setMessages(nextMessages);
    resetStreamState();
    setStreamError(null);
    await sendMessage(retryPrompt.text);
    setRetryPrompt(null);
  }

  async function handleRetryInNewSession() {
    if (!retryPrompt) return;
    const branchSessionId = await createBranchSessionFromMessage(
      retryPrompt.text,
      retryPrompt.sourceMessageId,
    );
    if (!branchSessionId) return;
    await sendMessage(retryPrompt.text, { forcedSessionId: branchSessionId });
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
    visibleStreamStartedAt,
    visibleReportedStreamUsage,
    activeStreamFirstTokenLatencyMs,
    currentAssistantStreamMessageIdRef,
    toolCallCards,
    resolveAssistantCapabilityKind,
    resolveInlinePermissionActions,
    buildMessageActions,
    handleCopyMessageGroup,
    openChildSessionInspector,
    selectedChildSessionId,
    taskToolRuntimeLookup,
  });

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
                  const selectedMetadata = buildSessionMetadata({ providerId: pid, modelId: mid });
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
            onClose={() => setHistoryEditPrompt(null)}
            onContinueCurrent={(text) => {
              focusComposerWithText(text);
              setHistoryEditPrompt(null);
            }}
            onCreateBranch={(text) => {
              if (!historyEditPrompt) return;
              void createBranchSessionFromMessage(text, historyEditPrompt.messageId);
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
            }}
          >
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
                  {!showSessionSwitchSkeleton ? (
                    <ChatMessageGroupList
                      activeModelId={activeModelId}
                      activeModelLabel={activeModelOption?.label}
                      activeProviderId={activeProviderId}
                      bottomRef={bottomRef}
                      currentUserEmail={currentUserEmail}
                      groups={groupedMessageEntries}
                      providerCatalog={providerCatalog}
                      scrollRegionRef={scrollRegionRef}
                    />
                  ) : (
                    <div
                      ref={bottomRef}
                      style={{ height: CHAT_SCROLL_BOTTOM_SPACER_HEIGHT, flexShrink: 0 }}
                    />
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

          <SubAgentRunList
            items={subAgentRunItems}
            selectedSessionId={selectedChildSessionId}
            onSelectSession={openChildSessionInspector}
          />

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
            onToggleWebSearch={handleToggleWebSearch}
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
