import React, { useEffect, useRef, useState, useCallback, useMemo, useTransition } from 'react';
import { useFileEditor } from '../hooks/useFileEditor.js';
import { FileEditorPanel } from '../components/FileEditorPanel.js';
import { usePageActivation } from '../components/CachedRouteOutlet.js';
import { ChatComposer } from '../components/chat/ChatComposer.js';
import { TaskToolInline } from '../components/chat/task-tool-inline.js';
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
import { useCommandRegistry } from '../hooks/useCommandRegistry.js';
import { useComposerWorkspaceCatalog } from '../hooks/useComposerWorkspaceCatalog.js';
import { useWorkspace } from '../hooks/useWorkspace.js';
import { createSessionsClient } from '@openAwork/web-client';
import type { PendingPermissionRequest, Session, SessionTask } from '@openAwork/web-client';
import type { CommandResultCard, Message, RunEvent } from '@openAwork/shared';
import type { GenerativeUIMessage } from '@openAwork/shared-ui';
import { logger } from '../utils/logger.js';
import {
  publishSessionPendingPermission,
  requestSessionListRefresh,
  subscribeCurrentSessionRefresh,
} from '../utils/session-list-events.js';
import { extractWorkingDirectory } from '../utils/session-metadata.js';
import {
  PlanPanel,
  AgentVizPanel,
  ToolCallCard,
  AgentDAGGraph,
  MCPServerList,
  canConfigureThinkingForModel,
} from '@openAwork/shared-ui';
import type { MCPServerStatus } from '@openAwork/shared-ui';
import type { AttachmentItem } from '@openAwork/shared-ui';
import WorkspacePickerModal from '../components/WorkspacePickerModal.js';
import HistoryEditDialog from './chat-page/history-edit-dialog.js';
import RetryModeDialog from './chat-page/retry-mode-dialog.js';
import { applyChatModesToMessage, type DialogueMode } from './dialogue-mode.js';
import {
  type AssistantEventKind,
  createAssistantEventContent,
  createAssistantTraceContent,
  createCommandCardContent,
  type ChatUsageDetails,
  detectComposerTrigger,
  estimateTokenCount,
  flattenWorkspaceFiles,
  matchServerSlashCommand,
  normalizeChatMessages,
  parseAssistantEventContent,
  parseAssistantTraceContent,
  parseToolCallInputText,
  parseSessionModeMetadata,
  type ReasoningEffort,
  type ChatMessage,
  type ComposerMenuState,
  type MentionItem,
  type SlashCommandItem,
  type WorkspaceFileMentionItem,
} from './chat-page/support.js';
import { buildComposerSlashItems } from './chat-page/composer-slash-items.js';
import { ChatHistoryTabContent, ChatOverviewTabContent } from './chat-page/right-panel-sections.js';
import { executeServerCommand } from './chat-page/server-command-item.js';
import { ChatTodoBar } from './chat-page/chat-todo-bar.js';
import {
  SessionRunStateBar,
  SessionRunStatePlaceholder,
} from './chat-page/session-run-state-bar.js';
import {
  fetchSessionRuntimeSnapshot,
  flattenSessionTodoLanes,
  mergeChildSessions,
  mergeSessionTasks,
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
  createInitialChatRightPanelState,
  getToolCallCards,
  startChatRightPanelRun,
} from './chat-stream-state.js';
import {
  calculateStreamingRevealDelay,
  calculateStreamingRevealStep,
} from './chat-page/streaming-reveal.js';
import {
  createQueuedComposerPreview,
  hydrateQueuedComposerMessage,
  toPersistedQueuedComposerMessage,
  type QueuedComposerMessage,
} from './chat-page/queued-composer-state.js';
import {
  deleteQueuedComposerFiles,
  persistQueuedComposerFiles,
  restoreQueuedComposerFiles,
} from './chat-page/queued-composer-file-store.js';
import {
  loadSavedChatSessionDefaults,
  type ChatSettingsProvider,
} from '../utils/chat-session-defaults.js';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion.js';
import { CompanionStage } from '../components/chat/companion/companion-stage.js';

interface ModelPriceEntry {
  modelName: string;
  inputPer1m: number;
  outputPer1m: number;
  cachedPer1m?: number;
}

interface LiveToolCallState {
  createdAt: number;
  inputText: string;
  isError?: boolean;
  output?: unknown;
  pendingPermissionRequestId?: string;
  status: 'streaming' | 'paused' | 'completed' | 'error';
  toolCallId: string;
  toolName: string;
}

const SESSION_SWITCH_DEFER_THRESHOLD = 32;
const CHAT_SCROLL_BOTTOM_PADDING = '0.95rem';
const CHAT_SCROLL_BOTTOM_SPACER_HEIGHT = 'clamp(180px, 34vh, 320px)';
const CHAT_LATEST_FOCUS_THRESHOLD_PX = 32;
const CHAT_LATEST_EDGE_VISIBILITY_THRESHOLD_PX = 40;
const CHAT_LATEST_REGION_FALLBACK_PX = 420;
const CHAT_PROGRAMMATIC_SCROLL_LOCK_SMOOTH_MS = 420;

function normalizeModelLookupKey(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function buildQueuedComposerScopeKey(email: string, sessionId: string): string {
  const normalizedEmail = email.trim().toLowerCase() || 'anonymous';
  return `${normalizedEmail}:${sessionId}`;
}

type SessionsClientWithActiveStop = ReturnType<typeof createSessionsClient> & {
  stopActiveStream: (token: string, sessionId: string) => Promise<boolean>;
};

function buildAssistantTextWithThinking(text: string, thinking: string): string {
  const normalizedThinking = thinking.trim();
  const normalizedText = text.trim();

  if (normalizedThinking.length === 0) {
    return text;
  }

  const fenceMatches = normalizedThinking.match(/`{3,}/g);
  const longestFence = fenceMatches?.reduce((max, value) => Math.max(max, value.length), 2) ?? 2;
  const fence = '`'.repeat(longestFence + 1);
  const thinkingBlock = `${fence}thinking\n${normalizedThinking}\n${fence}`;
  return normalizedText.length > 0 ? `${thinkingBlock}\n\n${text}` : thinkingBlock;
}

function createSessionMetadataSnapshot(metadata: {
  dialogueMode?: DialogueMode;
  modelId?: string;
  providerId?: string;
  reasoningEffort?: ReasoningEffort;
  thinkingEnabled?: boolean;
  webSearchEnabled?: boolean;
  workingDirectory?: string | null;
  yoloMode?: boolean;
}): string {
  const snapshot: Record<string, unknown> = {
    dialogueMode: metadata.dialogueMode ?? 'clarify',
    yoloMode: metadata.yoloMode === true,
    webSearchEnabled: metadata.webSearchEnabled === true,
    thinkingEnabled: metadata.thinkingEnabled === true,
    reasoningEffort: metadata.reasoningEffort ?? 'medium',
  };

  const providerId = metadata.providerId?.trim();
  if (providerId) {
    snapshot['providerId'] = providerId;
  }

  const modelId = metadata.modelId?.trim();
  if (modelId) {
    snapshot['modelId'] = modelId;
  }

  const workingDirectory = metadata.workingDirectory?.trim();
  if (workingDirectory) {
    snapshot['workingDirectory'] = workingDirectory;
  }

  return JSON.stringify(snapshot);
}

function resolveModelPriceEntry(
  prices: ModelPriceEntry[],
  candidates: Array<string | undefined>,
): ModelPriceEntry | undefined {
  const normalizedCandidates = candidates
    .map((candidate) => normalizeModelLookupKey(candidate))
    .filter((candidate) => candidate.length > 0);

  if (normalizedCandidates.length === 0) {
    return undefined;
  }

  return prices.find((entry) => {
    const normalizedModelName = normalizeModelLookupKey(entry.modelName);
    return normalizedCandidates.some(
      (candidate) =>
        candidate === normalizedModelName ||
        candidate.includes(normalizedModelName) ||
        normalizedModelName.includes(candidate),
    );
  });
}

function groupChatRenderEntries(entries: ChatRenderEntry[]): ChatRenderGroup[] {
  const groups: ChatRenderGroup[] = [];

  for (const entry of entries) {
    const lastGroup = groups[groups.length - 1];
    const lastEntry = lastGroup?.entries[lastGroup.entries.length - 1];

    if (lastEntry && lastEntry.message.role === entry.message.role) {
      lastGroup.entries.push(entry);
      continue;
    }

    groups.push({
      entries: [entry],
      key: entry.message.id,
      role: entry.message.role,
    });
  }

  return groups;
}

function decorateAssistantGroupActions(
  group: ChatRenderGroup,
  handleCopyMessageGroup: (messages: ChatMessage[]) => void,
): ChatRenderGroup {
  const firstEntry = group.entries[0];
  if (!firstEntry) {
    return group;
  }

  if (group.role !== 'assistant' || group.entries.length <= 1) {
    return group;
  }

  return {
    ...group,
    actions: (firstEntry.actions ?? []).map((action) =>
      action.id === 'copy'
        ? {
            ...action,
            onClick: () => handleCopyMessageGroup(group.entries.map((entry) => entry.message)),
            title: '复制这次回答的完整内容',
          }
        : action,
    ),
  };
}

function isImmediatelyRenderableStructuredContent(content: string): boolean {
  const normalized = content.trim();
  if (!normalized.startsWith('{') || !normalized.includes('"type"')) {
    return false;
  }

  try {
    JSON.parse(normalized);
    return true;
  } catch {
    return false;
  }
}

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
  const [activeStreamStartedAt, setActiveStreamStartedAt] = useState<number | null>(null);
  const [activeStreamFirstTokenLatencyMs, setActiveStreamFirstTokenLatencyMs] = useState<
    number | null
  >(null);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRegionRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingScrollFrameRef = useRef<number | null>(null);
  const pendingStreamRevealFrameRef = useRef<number | null>(null);
  const pendingSessionNormalizeTimeoutRef = useRef<number | null>(null);
  const activeSessionRef = useRef<string | null>(sessionId ?? null);
  const lastParentTaskSyncMarkerRef = useRef<string | null>(null);
  const pendingBootstrapSessionRef = useRef<string | null>(null);
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
  const [dialogueMode, setDialogueMode] = useState<DialogueMode>('clarify');
  const [yoloMode, setYoloMode] = useState(false);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
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
  const [modelPrices, setModelPrices] = useState<ModelPriceEntry[]>([]);
  const [rightPanelState, setRightPanelState] = useState(() => createInitialChatRightPanelState());
  const [childSessions, setChildSessions] = useState<Session[]>([]);
  const [selectedChildSessionId, setSelectedChildSessionId] = useState<string | null>(null);
  const [sessionTodos, setSessionTodos] = useState<SessionTodoItem[]>([]);
  const [sessionTasks, setSessionTasks] = useState<SessionTask[]>([]);
  const [pendingPermissions, setPendingPermissions] = useState<PendingPermissionRequest[]>([]);
  const [sessionStateStatus, setSessionStateStatus] = useState<SessionStateStatus | null>(null);
  const [isSessionSnapshotReady, setIsSessionSnapshotReady] = useState(false);
  const [historyEditPrompt, setHistoryEditPrompt] = useState<{
    hasCodeMarkers: boolean;
    messageId: string;
    text: string;
  } | null>(null);
  const [, startSessionSwitchTransition] = useTransition();
  const [retryPrompt, setRetryPrompt] = useState<{
    sourceMessageId: string;
    text: string;
  } | null>(null);
  const [sessionModesHydrated, setSessionModesHydrated] = useState(false);
  const [sessionMetadataDirty, setSessionMetadataDirty] = useState(false);
  const [workspaceFileItems, setWorkspaceFileItems] = useState<WorkspaceFileMentionItem[]>([]);
  const [composerMenu, setComposerMenu] = useState<ComposerMenuState>(null);
  const modelPickerBtnRef = useRef<HTMLButtonElement>(null);
  const modelSettingsBtnRef = useRef<HTMLButtonElement>(null);
  const lastPersistedSessionMetadataSnapshotRef = useRef<string | null>(null);
  const composerCommandDescriptors = useCommandRegistry('composer');
  const prefersReducedMotion = usePrefersReducedMotion();
  const uiState = useUIStateStore();
  const editorMode = uiState.editorMode;
  const setEditorMode = uiState.setEditorMode;
  const splitPos = uiState.splitPos;
  const setSplitPos = uiState.setSplitPos;
  const navigateToHome = uiState.navigateToHome;
  const navigateToSession = uiState.navigateToSession;
  const workspaceTreeVersion = uiState.workspaceTreeVersion;
  const selectedWorkspacePath = uiState.selectedWorkspacePath;
  const setSelectedWorkspacePath = uiState.setSelectedWorkspacePath;
  const addSavedWorkspacePath = uiState.addSavedWorkspacePath;
  const setFileTreeRootPath = uiState.setFileTreeRootPath;
  const setLastChatPath = uiState.setLastChatPath;
  const splitDragging = useRef(false);
  const rightOpenRef = useRef(rightOpen);
  const queueFlushInFlightRef = useRef(false);
  const queueHydratingRef = useRef(false);
  const stoppingStreamRef = useRef(false);
  const streamRevealTargetRef = useRef('');
  const streamRevealVisibleRef = useRef('');
  const streamRevealTargetCodePointsRef = useRef<string[]>([]);
  const streamRevealVisibleCodePointCountRef = useRef(0);
  const streamRevealNextAllowedAtRef = useRef(0);
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
  const composerWorkspaceCatalog = useComposerWorkspaceCatalog(Boolean(token));
  const queuedComposerScope = useMemo(() => {
    if (!currentSessionId) {
      return null;
    }

    return buildQueuedComposerScopeKey(currentUserEmail, currentSessionId);
  }, [currentSessionId, currentUserEmail]);

  const buildSessionMetadata = useCallback(
    (overrides: Record<string, unknown> = {}): Record<string, unknown> => {
      const metadata: Record<string, unknown> = {
        dialogueMode,
        yoloMode,
        webSearchEnabled,
        thinkingEnabled,
        reasoningEffort,
      };

      if (activeProviderId) {
        metadata['providerId'] = activeProviderId;
      }

      if (activeModelId) {
        metadata['modelId'] = activeModelId;
      }

      if (effectiveWorkingDirectory) {
        metadata['workingDirectory'] = effectiveWorkingDirectory;
      }

      return { ...metadata, ...overrides };
    },
    [
      activeModelId,
      activeProviderId,
      dialogueMode,
      effectiveWorkingDirectory,
      reasoningEffort,
      thinkingEnabled,
      webSearchEnabled,
      yoloMode,
    ],
  );

  const resetStreamState = useCallback(() => {
    if (pendingStreamRevealFrameRef.current !== null) {
      cancelAnimationFrame(pendingStreamRevealFrameRef.current);
      pendingStreamRevealFrameRef.current = null;
    }
    stoppingStreamRef.current = false;
    streamRevealTargetRef.current = '';
    streamRevealVisibleRef.current = '';
    streamRevealTargetCodePointsRef.current = [];
    streamRevealVisibleCodePointCountRef.current = 0;
    streamRevealNextAllowedAtRef.current = 0;
    setStreamBuffer('');
    setStreaming(false);
    setStoppingStream(false);
    setActiveStreamStartedAt(null);
    setActiveStreamFirstTokenLatencyMs(null);
  }, []);

  const scheduleStreamReveal = useCallback(() => {
    if (pendingStreamRevealFrameRef.current !== null) {
      return;
    }

    const advance = (timestamp: number) => {
      pendingStreamRevealFrameRef.current = null;
      const shouldApplyCadence = timestamp > 0;

      if (prefersReducedMotion) {
        const immediateVisible = streamRevealTargetRef.current;
        streamRevealVisibleCodePointCountRef.current =
          streamRevealTargetCodePointsRef.current.length;
        streamRevealVisibleRef.current = immediateVisible;
        setStreamBuffer(immediateVisible);
        return;
      }

      if (shouldApplyCadence && timestamp < streamRevealNextAllowedAtRef.current) {
        pendingStreamRevealFrameRef.current = requestAnimationFrame(advance);
        return;
      }

      const currentVisibleCount = streamRevealVisibleCodePointCountRef.current;
      const targetCodePoints = streamRevealTargetCodePointsRef.current;
      const pendingCharacters = targetCodePoints.length - currentVisibleCount;

      if (pendingCharacters <= 0) {
        return;
      }

      const nextVisibleCount = Math.min(
        targetCodePoints.length,
        currentVisibleCount + calculateStreamingRevealStep(pendingCharacters),
      );
      const appendedChunk = targetCodePoints.slice(currentVisibleCount, nextVisibleCount).join('');
      const nextVisible = streamRevealVisibleRef.current + appendedChunk;
      const lastRevealedCharacter = targetCodePoints[nextVisibleCount - 1];

      if (nextVisible !== streamRevealVisibleRef.current) {
        streamRevealVisibleCodePointCountRef.current = nextVisibleCount;
        streamRevealVisibleRef.current = nextVisible;
        setStreamBuffer(nextVisible);
      }

      streamRevealNextAllowedAtRef.current = shouldApplyCadence
        ? timestamp +
          calculateStreamingRevealDelay(
            lastRevealedCharacter,
            targetCodePoints.length - nextVisibleCount,
          )
        : 0;

      if (nextVisibleCount < targetCodePoints.length) {
        pendingStreamRevealFrameRef.current = requestAnimationFrame(advance);
      }
    };

    pendingStreamRevealFrameRef.current = requestAnimationFrame(advance);
  }, [prefersReducedMotion]);

  useEffect(() => {
    return () => {
      if (pendingStreamRevealFrameRef.current !== null) {
        cancelAnimationFrame(pendingStreamRevealFrameRef.current);
      }
    };
  }, []);

  const markSessionMetadataDirty = useCallback(() => {
    setSessionMetadataDirty(true);
  }, []);

  const handleDialogueModeChange = useCallback(
    (mode: DialogueMode) => {
      setDialogueMode(mode);
      markSessionMetadataDirty();
    },
    [markSessionMetadataDirty],
  );

  const handleToggleYolo = useCallback(() => {
    setYoloMode((prev) => !prev);
    markSessionMetadataDirty();
  }, [markSessionMetadataDirty]);

  const handleToggleWebSearch = useCallback(() => {
    setWebSearchEnabled((prev) => !prev);
    markSessionMetadataDirty();
  }, [markSessionMetadataDirty]);

  const handleThinkingEnabledChange = useCallback(
    (enabled: boolean) => {
      setThinkingEnabled(enabled);
      markSessionMetadataDirty();
    },
    [markSessionMetadataDirty],
  );

  const handleReasoningEffortChange = useCallback(
    (effort: ReasoningEffort) => {
      setReasoningEffort(effort);
      markSessionMetadataDirty();
    },
    [markSessionMetadataDirty],
  );

  useEffect(() => {
    activeSessionRef.current = sessionId ?? currentSessionId ?? null;
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
    setFileTreeRootPath(effectiveWorkingDirectory ?? null);
  }, [effectiveWorkingDirectory, setFileTreeRootPath]);

  useEffect(() => {
    openFileRef.current = (path: string) => {
      setEditorMode(true);
      void fileEditor.openFile(path);
    };
    return () => {
      openFileRef.current = null;
    };
  }, [openFileRef, fileEditor, setEditorMode]);

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
      setSelectedChildSessionId(null);
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
    setSelectedChildSessionId(runningCandidate?.sessionId ?? null);
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

  const loadSessionRuntimeSnapshot = useCallback(
    async (targetSessionId: string, signal?: AbortSignal) => {
      if (!token) {
        return;
      }

      const { childrenResult, pendingPermissionsResult, tasksResult, todoLanesResult } =
        await fetchSessionRuntimeSnapshot({
          gatewayUrl,
          sessionId: targetSessionId,
          signal,
          token,
        });

      if (signal?.aborted || activeSessionRef.current !== targetSessionId) {
        return;
      }

      setSessionTodos(
        todoLanesResult.status === 'fulfilled'
          ? flattenSessionTodoLanes(todoLanesResult.value)
          : [],
      );
      setChildSessions((previous) =>
        childrenResult.status === 'fulfilled'
          ? mergeChildSessions(previous, childrenResult.value)
          : previous,
      );
      setSessionTasks((previous) =>
        tasksResult.status === 'fulfilled'
          ? mergeSessionTasks(previous, tasksResult.value)
          : previous,
      );
      setPendingPermissions(
        pendingPermissionsResult.status === 'fulfilled' ? pendingPermissionsResult.value : [],
      );
    },
    [gatewayUrl, token],
  );

  const loadCurrentSessionSnapshot = useCallback(
    async (targetSessionId: string, signal?: AbortSignal) => {
      if (!token) {
        return;
      }

      const session = await createSessionsClient(gatewayUrl).get(token, targetSessionId);
      if (signal?.aborted || activeSessionRef.current !== targetSessionId) {
        return;
      }

      const sessionWithRuntime = session as Session & { state_status?: SessionStateStatus };
      setMessages(normalizeChatMessages(session.messages));
      setSessionTodos(Array.isArray(session.todos) ? session.todos : []);
      setSessionStateStatus(sessionWithRuntime.state_status ?? null);
      setIsSessionSnapshotReady(true);
    },
    [gatewayUrl, token],
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
        !isSessionLoading &&
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
      pendingPermissions,
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

    void createSessionsClient(gatewayUrl)
      .get(token, targetSessionId)
      .then((session) => {
        if (cancelled || activeSessionRef.current !== targetSessionId) {
          return;
        }

        lastParentTaskSyncMarkerRef.current = nextMarker;
        const sessionWithRuntime = session as Session & { state_status?: SessionStateStatus };
        setMessages(normalizeChatMessages(session.messages));
        setSessionStateStatus(sessionWithRuntime.state_status ?? null);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [currentSessionId, gatewayUrl, isSessionLoading, sessionTasks, streaming, token]);

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
    if (!token) {
      setModelPrices([]);
      return;
    }

    let cancelled = false;
    void fetch(`${gatewayUrl}/settings/model-prices`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('fail'))))
      .then((data: { models?: ModelPriceEntry[] }) => {
        if (!cancelled) {
          setModelPrices(data.models ?? []);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setModelPrices([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [gatewayUrl, token]);

  const handleSaveFile = useCallback(
    async (path: string) => {
      setSaving(true);
      await fileEditor.saveFile(path);
      setSaving(false);
    },
    [fileEditor],
  );

  const handleSplitMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      splitDragging.current = true;
      const container = splitContainerRef.current;
      if (!container) return;
      const onMove = (ev: MouseEvent) => {
        if (!splitDragging.current) return;
        const rect = container.getBoundingClientRect();
        const pct = Math.min(80, Math.max(20, ((ev.clientX - rect.left) / rect.width) * 100));
        setSplitPos(pct);
      };
      const onUp = () => {
        splitDragging.current = false;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [setSplitPos],
  );

  useEffect(() => {
    const requestedSessionId = sessionId ?? null;
    const shouldPreserveBootstrapState = pendingBootstrapSessionRef.current === requestedSessionId;
    void sessionReloadNonce;

    if (!requestedSessionId || !token) {
      navigateToHome();
      setCurrentSessionId(null);
      setSelectedChildSessionId(null);
      setIsSessionLoading(false);
      setMessages([]);
      setSessionTodos([]);
      setChildSessions([]);
      setSessionTasks([]);
      setPendingPermissions([]);
      setSessionStateStatus(null);
      setIsSessionSnapshotReady(true);
      setSessionModesHydrated(false);
      setSessionMetadataDirty(false);
      lastPersistedSessionMetadataSnapshotRef.current = null;
      resetStreamState();
      setStreamError(null);
      return;
    }

    let cancelled = false;
    const runtimeSnapshotController = new AbortController();

    navigateToSession();
    setCurrentSessionId(requestedSessionId);
    setSelectedChildSessionId(null);

    if (shouldPreserveBootstrapState) {
      pendingBootstrapSessionRef.current = null;
      setIsSessionLoading(false);
      setIsSessionSnapshotReady(true);
      setSessionMetadataDirty(false);
      setSessionModesHydrated(true);
      return () => {
        cancelled = true;
      };
    }

    setIsSessionLoading(true);
    setMessages([]);
    setChildSessions([]);
    setSessionTasks([]);
    setPendingPermissions([]);
    setSessionStateStatus(null);
    setIsSessionSnapshotReady(false);
    setSessionModesHydrated(false);
    setSessionMetadataDirty(false);
    lastPersistedSessionMetadataSnapshotRef.current = null;
    resetStreamState();
    setStreamError(null);
    setDialogueMode('clarify');
    setYoloMode(false);
    setWebSearchEnabled(false);
    setThinkingEnabled(false);
    setReasoningEffort('medium');
    setActiveProviderId('');
    setActiveModelId('');

    createSessionsClient(gatewayUrl)
      .get(token, requestedSessionId)
      .then((s) => {
        const sessionWithRuntime = s as Session & { state_status?: SessionStateStatus };
        if (cancelled || activeSessionRef.current !== requestedSessionId) {
          return;
        }
        const metadata = parseSessionModeMetadata(s.metadata_json);
        const applySessionPayload = () => {
          if (cancelled || activeSessionRef.current !== requestedSessionId) {
            return;
          }

          const normalizedMessages = normalizeChatMessages(s.messages);

          startSessionSwitchTransition(() => {
            setMessages(normalizedMessages);
            setSessionTodos(Array.isArray(s.todos) ? s.todos : []);
            setSessionStateStatus(sessionWithRuntime.state_status ?? null);
            setIsSessionSnapshotReady(true);
            setDialogueMode(metadata.dialogueMode);
            setYoloMode(metadata.yoloMode);
            setWebSearchEnabled(metadata.webSearchEnabled);
            setThinkingEnabled(metadata.thinkingEnabled);
            setReasoningEffort(metadata.reasoningEffort);
            setActiveProviderId(metadata.providerId ?? '');
            setActiveModelId(metadata.modelId ?? '');
            lastPersistedSessionMetadataSnapshotRef.current = createSessionMetadataSnapshot({
              dialogueMode: metadata.dialogueMode,
              yoloMode: metadata.yoloMode,
              webSearchEnabled: metadata.webSearchEnabled,
              thinkingEnabled: metadata.thinkingEnabled,
              reasoningEffort: metadata.reasoningEffort,
              providerId: metadata.providerId,
              modelId: metadata.modelId,
              workingDirectory: extractWorkingDirectory(s.metadata_json),
            });
            setSessionMetadataDirty(false);
            setSessionModesHydrated(true);
            setIsSessionLoading(false);
          });

          if (
            sessionWithRuntime.state_status !== 'paused' &&
            sessionWithRuntime.state_status !== 'running'
          ) {
            void loadSessionRuntimeSnapshot(requestedSessionId, runtimeSnapshotController.signal);
          }
        };

        if (Array.isArray(s.messages) && s.messages.length > SESSION_SWITCH_DEFER_THRESHOLD) {
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
        if (cancelled || activeSessionRef.current !== requestedSessionId) {
          return null;
        }
        setSessionTodos([]);
        setSessionStateStatus(null);
        setIsSessionSnapshotReady(false);
        setSessionMetadataDirty(false);
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
    gatewayUrl,
    navigateToHome,
    navigateToSession,
    resetStreamState,
    sessionId,
    sessionReloadNonce,
    loadSessionRuntimeSnapshot,
    token,
  ]);

  useEffect(() => {
    let cancelled = false;
    void workspaceTreeVersion;

    if (!effectiveWorkingDirectory) {
      setWorkspaceFileItems([]);
      return;
    }

    void (async () => {
      try {
        const nodes = await workspace.fetchTree(effectiveWorkingDirectory, 2);
        const files = flattenWorkspaceFiles(nodes, effectiveWorkingDirectory);

        if (!cancelled) {
          setWorkspaceFileItems(files);
        }
      } catch {
        if (!cancelled) {
          setWorkspaceFileItems([]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [effectiveWorkingDirectory, workspace.fetchTree, workspaceTreeVersion]);

  useEffect(() => {
    if (!token || !rightOpen || rightTab !== 'mcp') return;
    let cancelled = false;
    void fetch(`${gatewayUrl}/settings/mcp-status`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('fail'))))
      .then(
        (data: {
          servers?: Array<{
            id: string;
            name: string;
            type?: string;
            status?: string;
            enabled?: boolean;
          }>;
        }) => {
          if (!cancelled) {
            setMcpServers(
              (data.servers ?? []).map((server) => ({
                id: server.id,
                name: server.name,
                status:
                  server.status === 'connected' ||
                  server.status === 'connecting' ||
                  server.status === 'error'
                    ? server.status
                    : server.enabled === false
                      ? 'disconnected'
                      : 'connecting',
                toolCount: 0,
                authType: server.type,
              })),
            );
          }
        },
      )
      .catch(() => {
        if (!cancelled) setMcpServers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [rightOpen, rightTab, token, gatewayUrl]);

  useEffect(() => {
    if (!currentSessionId || !token || !shouldPollSessionSubresources) {
      return;
    }

    const targetSessionId = currentSessionId;

    const polling = startSequentialPolling({
      intervalMs: 3000,
      run: async (signal) => {
        await loadSessionRuntimeSnapshot(targetSessionId, signal);
      },
    });

    return () => {
      polling.cancel();
    };
  }, [currentSessionId, loadSessionRuntimeSnapshot, shouldPollSessionSubresources, token]);

  useEffect(() => {
    if (
      !currentSessionId ||
      !token ||
      !remoteSessionBusyState ||
      !isPageActive ||
      !sessionModesHydrated
    ) {
      return;
    }

    const targetSessionId = currentSessionId;
    const polling = startSequentialPolling({
      initialDelayMs: 3000,
      intervalMs: 3000,
      run: async (signal) => {
        await loadCurrentSessionSnapshot(targetSessionId, signal);
      },
    });

    return () => {
      polling.cancel();
    };
  }, [
    currentSessionId,
    isPageActive,
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
      setSessionMetadataDirty(false);
      return;
    }

    void createSessionsClient(gatewayUrl)
      .updateMetadata(token, targetSessionId, nextMetadata)
      .then(() => {
        if (activeSessionRef.current !== targetSessionId) {
          return;
        }
        lastPersistedSessionMetadataSnapshotRef.current = nextSnapshot;
        setSessionMetadataDirty(false);
        requestSessionListRefresh();
      })
      .catch(() => undefined);
  }, [
    buildSessionMetadata,
    currentSessionId,
    gatewayUrl,
    sessionMetadataDirty,
    sessionModesHydrated,
    token,
  ]);

  const isNearBottomRef = useRef(true);
  const ignoreScrollEventsUntilRef = useRef(0);

  const getLatestAssistantAnchor = useCallback((): HTMLElement | null => {
    const scrollRegion = scrollRegionRef.current;
    if (!scrollRegion) {
      return bottomRef.current;
    }

    const groups = scrollRegion.querySelectorAll<HTMLElement>(
      '[data-chat-group-root="true"][data-role="assistant"]',
    );

    return groups[groups.length - 1] ?? bottomRef.current;
  }, []);

  const isScrollRegionNearLatest = useCallback(
    (scrollRegion: HTMLDivElement | null): boolean => {
      if (!scrollRegion) {
        return true;
      }

      const distanceToBottom =
        scrollRegion.scrollHeight - scrollRegion.scrollTop - scrollRegion.clientHeight;
      if (distanceToBottom <= CHAT_LATEST_EDGE_VISIBILITY_THRESHOLD_PX) {
        return true;
      }

      const latestAnchor = getLatestAssistantAnchor();
      if (
        !latestAnchor ||
        latestAnchor === bottomRef.current ||
        !scrollRegion.contains(latestAnchor)
      ) {
        return (
          scrollRegion.scrollHeight - scrollRegion.scrollTop - scrollRegion.clientHeight <
          CHAT_LATEST_REGION_FALLBACK_PX
        );
      }

      const scrollRegionRect = scrollRegion.getBoundingClientRect();
      const latestAnchorRect = latestAnchor.getBoundingClientRect();
      const latestAnchorCenter =
        latestAnchorRect.top - scrollRegionRect.top + latestAnchorRect.height / 2;
      const viewportCenter = scrollRegion.clientHeight / 2;
      const centerTolerance = Math.min(
        160,
        Math.max(CHAT_LATEST_FOCUS_THRESHOLD_PX * 2, scrollRegion.clientHeight * 0.18),
      );

      return Math.abs(latestAnchorCenter - viewportCenter) <= centerTolerance;
    },
    [getLatestAssistantAnchor],
  );

  function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    if (performance.now() < ignoreScrollEventsUntilRef.current) {
      return;
    }

    const isNearLatest = isScrollRegionNearLatest(el);
    isNearBottomRef.current = isNearLatest;
    setShowScrollToBottom(!isNearLatest);
    if (isNearLatest) {
      setHasPendingFollowContent(false);
    }
  }

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = 'smooth', align: 'center' | 'latest-edge' = 'center') => {
      const scrollRegion = scrollRegionRef.current;
      const latestAnchor = getLatestAssistantAnchor();

      isNearBottomRef.current = true;
      setShowScrollToBottom(false);
      setHasPendingFollowContent(false);
      if (pendingScrollFrameRef.current !== null) {
        cancelAnimationFrame(pendingScrollFrameRef.current);
      }

      ignoreScrollEventsUntilRef.current =
        behavior === 'smooth' ? performance.now() + CHAT_PROGRAMMATIC_SCROLL_LOCK_SMOOTH_MS : 0;

      pendingScrollFrameRef.current = requestAnimationFrame(() => {
        if (scrollRegion) {
          const maxScrollTop = Math.max(0, scrollRegion.scrollHeight - scrollRegion.clientHeight);
          let nextTop = maxScrollTop;
          let shouldForceScroll = scrollRegion.clientHeight === 0;

          if (
            align === 'center' &&
            latestAnchor &&
            latestAnchor !== bottomRef.current &&
            scrollRegion.contains(latestAnchor)
          ) {
            const scrollRegionRect = scrollRegion.getBoundingClientRect();
            const latestAnchorRect = latestAnchor.getBoundingClientRect();
            shouldForceScroll =
              shouldForceScroll || scrollRegionRect.height === 0 || latestAnchorRect.height === 0;
            const latestAnchorCenter =
              scrollRegion.scrollTop +
              (latestAnchorRect.top - scrollRegionRect.top) +
              latestAnchorRect.height / 2;
            nextTop = Math.max(
              0,
              Math.min(maxScrollTop, latestAnchorCenter - scrollRegion.clientHeight / 2),
            );
          }

          if (
            shouldForceScroll ||
            Math.abs(scrollRegion.scrollTop - nextTop) > CHAT_LATEST_FOCUS_THRESHOLD_PX
          ) {
            scrollRegion.scrollTo({ top: nextTop, behavior });
          }
        } else {
          bottomRef.current?.scrollIntoView({
            behavior,
            block: align === 'center' ? 'center' : 'end',
          });
        }
        pendingScrollFrameRef.current = null;
      });
    },
    [getLatestAssistantAnchor],
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

  const getCopyableMessageText = useCallback((message: ChatMessage): string => {
    if (message.role === 'user') return message.content;
    const assistantEvent = parseAssistantEventContent(message.content);
    if (assistantEvent) {
      return [assistantEvent.title, assistantEvent.message, `状态：${assistantEvent.status}`]
        .filter((item) => item && item.trim().length > 0)
        .join('\n');
    }
    const assistantTrace = parseAssistantTraceContent(message.content);
    if (assistantTrace) {
      const lines = [assistantTrace.text];
      for (const toolCall of assistantTrace.toolCalls) {
        lines.push(`工具：${toolCall.toolName}`);
        lines.push(`输入：${JSON.stringify(toolCall.input, null, 2)}`);
        if (toolCall.output !== undefined) {
          lines.push(`输出：${JSON.stringify(toolCall.output, null, 2)}`);
        }
      }
      return lines.filter((item) => item && item.trim().length > 0).join('\n\n');
    }

    try {
      const parsed = JSON.parse(message.content) as GenerativeUIMessage;
      if (parsed.type === 'status') {
        const payload = parsed.payload as Record<string, unknown>;
        return [payload['title'], payload['message']]
          .filter((item) => typeof item === 'string')
          .join('\n');
      }
      if (parsed.type === 'compaction') {
        const payload = parsed.payload as Record<string, unknown>;
        return [payload['title'], payload['summary']]
          .filter((item) => typeof item === 'string')
          .join('\n');
      }
      if (parsed.type === 'tool_call') {
        const payload = parsed.payload as Record<string, unknown>;
        const lines = [
          typeof payload['toolName'] === 'string' ? `工具：${payload['toolName']}` : undefined,
          payload['input'] !== undefined
            ? `输入：${JSON.stringify(payload['input'], null, 2)}`
            : undefined,
          payload['output'] !== undefined
            ? `输出：${JSON.stringify(payload['output'], null, 2)}`
            : undefined,
        ].filter((item): item is string => Boolean(item));
        return lines.join('\n');
      }
    } catch {
      return message.content;
    }
    return message.content;
  }, []);

  const findRetrySource = useCallback(
    (messageId: string): { id: string; text: string } | null => {
      const index = messages.findIndex((item) => item.id === messageId);
      if (index === -1) return null;
      for (let cursor = index; cursor >= 0; cursor -= 1) {
        const candidate = messages[cursor];
        if (candidate?.role === 'user') {
          return { id: candidate.id, text: candidate.content };
        }
      }
      return null;
    },
    [messages],
  );

  const isHistoricalUserMessage = useCallback(
    (messageId: string): boolean => {
      const index = messages.findIndex((item) => item.id === messageId && item.role === 'user');
      return index !== -1 && index < messages.length - 1;
    },
    [messages],
  );

  const containsCodeMarkers = useCallback((text: string): boolean => {
    return /```|<file\s+name=|diff --git|^\s*(import|export|function|const|let|class)\s+/m.test(
      text,
    );
  }, []);

  const createBranchSessionFromMessage = useCallback(
    async (text: string, sourceMessageId: string) => {
      if (!token) return;
      const originSessionId = activeSessionRef.current;

      const baseSession = currentSessionId
        ? await createSessionsClient(gatewayUrl).get(token, currentSessionId)
        : null;
      const baseMessages = Array.isArray(baseSession?.messages) ? baseSession.messages : [];
      const sourceIndex = baseMessages.findIndex((message) => message.id === sourceMessageId);
      const truncatedMessages = (sourceIndex >= 0 ? baseMessages.slice(0, sourceIndex) : []).map(
        (message) => ({
          ...message,
          id: crypto.randomUUID(),
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
      setMessages(normalizeChatMessages(truncatedMessages));
      setSessionMetadataDirty(false);
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

  useEffect(() => {
    return () => {
      if (pendingScrollFrameRef.current !== null) {
        cancelAnimationFrame(pendingScrollFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (messages.length === 0 && !streaming && !streamBuffer) {
      setShowScrollToBottom(false);
      setHasPendingFollowContent(false);
    }
  }, [messages.length, streamBuffer, streaming]);

  useEffect(() => {
    if (streaming && isNearBottomRef.current) {
      scrollToBottom('auto');
    }
  }, [scrollToBottom, streaming]);

  useEffect(() => {
    if (streaming && isNearBottomRef.current && streamBuffer.length > 0) {
      scrollToBottom('auto');
    }
  }, [scrollToBottom, streamBuffer.length, streaming]);

  useEffect(() => {
    if (editorMode) {
      return;
    }

    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement && editorPaneRef.current?.contains(activeElement)) {
      textareaRef.current?.focus();
    }
  }, [editorMode]);

  useEffect(() => {
    if (isNearBottomRef.current && messages.length > 0) {
      scrollToBottom('auto', 'latest-edge');
    }
  }, [messages.length, scrollToBottom]);

  async function ensureSession(): Promise<string> {
    if (currentSessionId) {
      activeSessionRef.current = currentSessionId;
      return currentSessionId;
    }

    const originSessionId = activeSessionRef.current;
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
    if (activeSessionRef.current !== originSessionId) {
      throw new Error('当前会话已切换，请重试');
    }

    lastPersistedSessionMetadataSnapshotRef.current =
      createSessionMetadataSnapshot(resolvedMetadata);
    activeSessionRef.current = session.id;
    pendingBootstrapSessionRef.current = session.id;
    setCurrentSessionId(session.id);
    setSessionMetadataDirty(false);
    setSessionModesHydrated(true);
    requestSessionListRefresh();
    void navigate(`/chat/${session.id}`, { replace: true });
    return session.id;
  }

  const readFileAsText = useCallback((file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('文件读取失败'));
      reader.readAsText(file);
    });
  }, []);

  const appendFiles = useCallback((files: File[]) => {
    if (files.length === 0) return;
    setAttachedFiles((prev) => [...prev, ...files]);
    const newItems: AttachmentItem[] = files.map((file) => ({
      id: `${file.name}-${Date.now()}-${Math.random()}`,
      name: file.name,
      type: file.type.startsWith('image/')
        ? 'image'
        : file.type.startsWith('audio/')
          ? 'audio'
          : 'file',
      sizeBytes: file.size,
    }));
    setAttachmentItems((prev) => [...prev, ...newItems]);
  }, []);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    appendFiles(files);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function removeFile(index: number) {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
  }

  function removeAttachment(id: string) {
    const idx = attachmentItems.findIndex((a) => a.id === id);
    if (idx !== -1) removeFile(idx);
    setAttachmentItems((prev) => prev.filter((a) => a.id !== id));
  }

  const clearComposerDraft = useCallback(() => {
    setInput('');
    setAttachedFiles([]);
    setAttachmentItems([]);
    setComposerMenu(null);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
  }, []);

  const enqueueComposerMessage = useCallback(async () => {
    const nextText = input.trim();
    if (nextText.length === 0 && attachedFiles.length === 0) {
      return false;
    }

    const queueItem: QueuedComposerMessage = {
      attachmentItems: attachmentItems.map((item) => ({ ...item })),
      files: [...attachedFiles],
      id: crypto.randomUUID(),
      requiresAttachmentRebind: attachedFiles.length > 0 && !queuedComposerScope,
      text: nextText,
    };
    setQueuedComposerMessages((previous) => [...previous, queueItem]);
    clearComposerDraft();

    if (attachedFiles.length > 0 && queuedComposerScope) {
      const persisted = await persistQueuedComposerFiles({
        attachmentItems: queueItem.attachmentItems,
        files: queueItem.files,
        queueId: queueItem.id,
        scope: queuedComposerScope,
      });
      if (!persisted) {
        setQueuedComposerMessages((previous) =>
          previous.map((item) =>
            item.id === queueItem.id ? { ...item, requiresAttachmentRebind: true } : item,
          ),
        );
      }
    }

    return true;
  }, [attachedFiles, attachmentItems, clearComposerDraft, input, queuedComposerScope]);

  const removeQueuedComposerMessage = useCallback(
    (messageId: string) => {
      if (queuedComposerScope) {
        void deleteQueuedComposerFiles({ queueId: messageId, scope: queuedComposerScope });
      }
      setQueuedComposerMessages((previous) => previous.filter((item) => item.id !== messageId));
    },
    [queuedComposerScope],
  );

  const restoreQueuedComposerMessage = useCallback(
    (messageId: string) => {
      const queueItem = queuedComposerMessages.find((item) => item.id === messageId);
      if (!queueItem) {
        return;
      }

      if (queuedComposerScope) {
        void deleteQueuedComposerFiles({ queueId: messageId, scope: queuedComposerScope });
      }
      setQueuedComposerMessages((previous) => previous.filter((item) => item.id !== messageId));
      setInput((previous) =>
        previous.trim().length > 0 ? `${queueItem.text}\n\n${previous}` : queueItem.text,
      );
      setAttachedFiles(queueItem.files);
      setAttachmentItems(queueItem.files.length > 0 ? queueItem.attachmentItems : []);
      setComposerMenu(null);
      setStreamError(
        queueItem.requiresAttachmentRebind && queueItem.attachmentItems.length > 0
          ? `已恢复待发文本，原有 ${queueItem.attachmentItems.length} 个附件需要重新选择后再发送。`
          : null,
      );
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });
    },
    [queuedComposerMessages, queuedComposerScope],
  );

  async function sendMessage(
    overrideText?: string,
    options?: {
      forcedSessionId?: string;
      queuedAttachmentItems?: AttachmentItem[];
      queuedFiles?: File[];
      queuedMessageId?: string;
    },
  ): Promise<boolean> {
    const sourceInput = overrideText ?? input;
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
    const matchedServerCommand =
      effectiveFiles.length === 0
        ? matchServerSlashCommand(text, composerCommandDescriptors)
        : null;

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
          appendAssistantEventMessages(events);
        },
        onOpenRightPanel: () => setRightOpen(true),
      });
      requestSessionListRefresh();
      return true;
    }

    if (overrideText === undefined && options?.queuedFiles === undefined) {
      clearComposerDraft();
    }

    if (effectiveFiles.length > 0) {
      const parts: string[] = [];
      for (const file of effectiveFiles) {
        try {
          const content = await readFileAsText(file);
          parts.push(`<file name="${file.name}">
${content}
</file>`);
        } catch {
          parts.push(`<file name="${file.name}">[二进制文件 — 无法显示]</file>`);
        }
      }
      text = parts.join('\n') + (text ? '\n\n' + text : '');
      if (options?.queuedFiles === undefined) {
        setAttachedFiles([]);
        setAttachmentItems([]);
      }
    }

    setStreaming(true);
    setStoppingStream(false);
    stoppingStreamRef.current = false;
    setSessionStateStatus('running');
    streamRevealTargetRef.current = '';
    streamRevealVisibleRef.current = '';
    streamRevealTargetCodePointsRef.current = [];
    streamRevealVisibleCodePointCountRef.current = 0;
    streamRevealNextAllowedAtRef.current = 0;
    setStreamBuffer('');
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
      finalStatus?: 'completed' | 'error' | 'cancelled',
    ): string => {
      return createAssistantTraceContent({
        text: buildAssistantTextWithThinking(textContent, accumulatedThinking),
        toolCalls: Array.from(liveToolCalls.values()).map((toolCallState) => {
          const nextToolState =
            finalStatus === 'error' && toolCallState.status === 'streaming'
              ? { ...toolCallState, isError: true, status: 'error' as const }
              : finalStatus === 'completed' && toolCallState.status === 'streaming'
                ? { ...toolCallState, status: 'completed' as const }
                : finalStatus === 'cancelled' && toolCallState.status === 'streaming'
                  ? { ...toolCallState, status: 'paused' as const }
                  : toolCallState;

          return {
            kind: resolveAssistantCapabilityKind(nextToolState.toolName),
            toolCallId: nextToolState.toolCallId,
            toolName: nextToolState.toolName,
            input: parseToolCallInputText(nextToolState.inputText),
            output: nextToolState.output,
            isError: nextToolState.isError,
            pendingPermissionRequestId: nextToolState.pendingPermissionRequestId,
            status:
              nextToolState.status === 'error'
                ? 'failed'
                : nextToolState.status === 'paused'
                  ? 'paused'
                  : nextToolState.status === 'completed'
                    ? 'completed'
                    : 'running',
          };
        }),
      });
    };

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      createdAt: requestStartedAt,
      tokenEstimate: estimateTokenCount(text),
      status: 'completed',
    };
    setMessages((prev) => [...prev, userMsg]);

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

    if (options?.queuedMessageId && queuedComposerScope) {
      void deleteQueuedComposerFiles({
        queueId: options.queuedMessageId,
        scope: queuedComposerScope,
      });
    }

    const requestText = applyChatModesToMessage(dialogueMode, yoloMode, text);
    let accumulated = '';
    let accumulatedThinking = '';
    let firstTokenObservedAt: number | null = null;
    let toolPanelRevealed = false;
    let pausedForPermission = false;
    const requestModelSupportsThinking = activeModelOption?.supportsThinking === true;
    setRightPanelState((prev) => startChatRightPanelRun(prev, text));

    client.stream(sid, requestText, {
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
            toolCallId: event.toolCallId,
            status: 'streaming',
            toolName: event.toolName,
          });
        }

        if (event.type === 'tool_result') {
          toolCallIds.add(event.toolCallId);
          const previous = liveToolCalls.get(event.toolCallId);
          liveToolCalls.set(event.toolCallId, {
            createdAt: previous?.createdAt ?? event.occurredAt ?? Date.now(),
            inputText: previous?.inputText ?? '',
            output: event.output,
            isError: event.pendingPermissionRequestId ? false : event.isError,
            pendingPermissionRequestId: event.pendingPermissionRequestId,
            toolCallId: event.toolCallId,
            status: event.pendingPermissionRequestId
              ? 'paused'
              : event.isError
                ? 'error'
                : 'completed',
            toolName: event.toolName,
          });
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
          setPendingPermissions((previous) =>
            previous.filter((permission) => permission.requestId !== event.requestId),
          );
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

        appendAssistantEventMessages([event]);
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
        if (activeSessionRef.current !== sid) {
          return;
        }

        accumulatedThinking += delta;
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
            setRightOpen(true);
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
        const finalAccumulatedText = wasCancelled ? streamRevealVisibleRef.current : accumulated;
        const traceFinalStatus = wasCancelled
          ? 'cancelled'
          : resolvedStopReason === 'error'
            ? 'error'
            : 'completed';
        const hasRenderableAssistantReply =
          finalAccumulatedText.trim().length > 0 || toolCallIds.size > 0;
        if (hasRenderableAssistantReply || !wasCancelled) {
          setMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: 'assistant',
              content:
                toolCallIds.size > 0
                  ? buildAssistantTraceMessageContent(finalAccumulatedText, traceFinalStatus)
                  : buildAssistantTextWithThinking(finalAccumulatedText, accumulatedThinking),
              createdAt: finishedAt,
              durationMs: finishedAt - requestStartedAt,
              stopReason: resolvedStopReason,
              tokenEstimate: estimateTokenCount(finalAccumulatedText),
              toolCallCount: toolCallIds.size,
              providerId: requestProviderId,
              model: requestModelLabel,
              firstTokenLatencyMs:
                firstTokenObservedAt !== null ? firstTokenObservedAt - requestStartedAt : undefined,
              status: 'completed',
            },
          ]);
        } else if (wasCancelled) {
          setMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: 'assistant',
              content: buildAssistantTextWithThinking('已停止', accumulatedThinking),
              createdAt: finishedAt,
              durationMs: finishedAt - requestStartedAt,
              stopReason: resolvedStopReason,
              tokenEstimate: estimateTokenCount('已停止'),
              toolCallCount: toolCallIds.size,
              providerId: requestProviderId,
              model: requestModelLabel,
              firstTokenLatencyMs:
                firstTokenObservedAt !== null ? firstTokenObservedAt - requestStartedAt : undefined,
              status: 'completed',
            },
          ]);
        }
        setSessionStateStatus('idle');
        resetStreamState();
        requestSessionListRefresh();
      },
      onError: (code: string, message?: string) => {
        if (activeSessionRef.current !== sid) {
          requestSessionListRefresh();
          return;
        }
        if (pausedForPermission) {
          requestSessionListRefresh();
          return;
        }
        const finishedAt = Date.now();
        const errorContent = message ? `[错误: ${code}] ${message}` : `[错误: ${code}]`;
        logger.error('stream error', message ? `${code}: ${message}` : code);
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            content:
              toolCallIds.size > 0
                ? buildAssistantTraceMessageContent(errorContent, 'error')
                : buildAssistantTextWithThinking(errorContent, accumulatedThinking),
            createdAt: finishedAt,
            durationMs: finishedAt - requestStartedAt,
            stopReason: 'error',
            tokenEstimate: estimateTokenCount(errorContent),
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
      reasoningEffort: requestModelSupportsThinking ? reasoningEffort : undefined,
      webSearchEnabled,
    });
    return true;
  }

  sendMessageRef.current = sendMessage;

  const handleCopyMessage = useCallback(
    (message: ChatMessage) => {
      const copyRequest = navigator.clipboard?.writeText(getCopyableMessageText(message));
      void copyRequest?.catch(() => undefined);
    },
    [getCopyableMessageText],
  );

  const handleCopyMessageGroup = useCallback(
    (groupMessages: ChatMessage[]) => {
      const combinedText = groupMessages
        .map((message) => getCopyableMessageText(message))
        .filter((text) => text.trim().length > 0)
        .join('\n\n');

      if (combinedText.length === 0) {
        return;
      }

      const copyRequest = navigator.clipboard?.writeText(combinedText);
      void copyRequest?.catch(() => undefined);
    },
    [getCopyableMessageText],
  );

  const handleEditRetryMessage = useCallback(
    (message: ChatMessage) => {
      if (isHistoricalUserMessage(message.id)) {
        setHistoryEditPrompt({
          messageId: message.id,
          text: message.content,
          hasCodeMarkers: containsCodeMarkers(message.content),
        });
        return;
      }
      focusComposerWithText(message.content);
    },
    [containsCodeMarkers, focusComposerWithText, isHistoricalUserMessage],
  );

  const handleRetryMessage = useCallback(
    (messageId: string) => {
      const retrySource = findRetrySource(messageId);
      if (!retrySource) return;
      setRetryPrompt({ sourceMessageId: retrySource.id, text: retrySource.text });
    },
    [findRetrySource],
  );

  const buildMessageActions = useCallback(
    (message: ChatMessage) => [
      {
        id: 'copy',
        label: '复制',
        onClick: () => handleCopyMessage(message),
      },
      ...(message.role === 'user'
        ? [
            {
              id: 'edit-retry',
              label: '编辑重试',
              onClick: () => handleEditRetryMessage(message),
            },
          ]
        : [
            {
              id: 'retry',
              label: '重试',
              onClick: () => handleRetryMessage(message.id),
            },
          ]),
    ],
    [handleCopyMessage, handleEditRetryMessage, handleRetryMessage],
  );

  const capabilityKindHints = useMemo(
    () =>
      [
        ...composerWorkspaceCatalog.agents.flatMap((item) => [
          { kind: 'agent' as const, value: item.label.trim().toLowerCase() },
          { kind: 'agent' as const, value: item.id.trim().toLowerCase() },
        ]),
        ...composerWorkspaceCatalog.installedSkills.flatMap((item) => [
          { kind: 'skill' as const, value: item.label.trim().toLowerCase() },
          { kind: 'skill' as const, value: item.id.trim().toLowerCase() },
        ]),
        ...composerWorkspaceCatalog.mcpServers.flatMap((item) => [
          { kind: 'mcp' as const, value: item.label.trim().toLowerCase() },
          { kind: 'mcp' as const, value: item.id.trim().toLowerCase() },
        ]),
        ...composerWorkspaceCatalog.agentTools.map((item) => ({
          kind: 'tool' as const,
          value: item.name.trim().toLowerCase(),
        })),
      ].filter((item) => item.value.length > 0),
    [composerWorkspaceCatalog],
  );

  const resolveAssistantCapabilityKind = useCallback(
    (text: string | undefined): 'agent' | 'mcp' | 'skill' | 'tool' | undefined => {
      const normalized = (text ?? '').trim().toLowerCase();
      if (normalized.length === 0) {
        return undefined;
      }

      const matched = capabilityKindHints.find(
        (item) => normalized === item.value || normalized.includes(item.value),
      );
      return matched?.kind;
    },
    [capabilityKindHints],
  );

  const resolveAssistantEventKind = useCallback(
    (event: RunEvent): AssistantEventKind | undefined => {
      if (event.type === 'compaction') {
        return 'compaction';
      }
      if (event.type === 'permission_asked' || event.type === 'permission_replied') {
        return 'permission';
      }
      if (event.type === 'audit_ref') {
        return resolveAssistantCapabilityKind(event.toolName) ?? 'audit';
      }
      if (event.type === 'task_update') {
        return resolveAssistantCapabilityKind(event.label);
      }
      if (event.type === 'session_child') {
        return resolveAssistantCapabilityKind(event.title ?? event.sessionId);
      }
      return undefined;
    },
    [resolveAssistantCapabilityKind],
  );

  const appendAssistantDerivedMessages = useCallback(
    (
      contents: Array<{
        content: string;
        createdAt?: number;
      }>,
    ) => {
      if (contents.length === 0) {
        return;
      }
      setMessages((prev) => [
        ...prev,
        ...contents.map((item) => ({
          id: crypto.randomUUID(),
          role: 'assistant' as const,
          content: item.content,
          createdAt: item.createdAt ?? Date.now(),
          status: 'completed' as const,
        })),
      ]);
    },
    [],
  );

  const appendAssistantEventMessages = useCallback(
    (events: RunEvent[], options?: { excludeCompaction?: boolean }) => {
      const contents = events.flatMap((event) => {
        if (options?.excludeCompaction === true && event.type === 'compaction') {
          return [];
        }
        const content = createAssistantEventContent(event, {
          kindOverride: resolveAssistantEventKind(event),
        });
        return content
          ? [
              {
                content,
                createdAt: event.occurredAt,
              },
            ]
          : [];
      });
      appendAssistantDerivedMessages(contents);
    },
    [appendAssistantDerivedMessages, resolveAssistantEventKind],
  );

  async function handleRetryInCurrentSession() {
    if (!retryPrompt) return;
    if (!currentSessionId || !token) return;
    const remainingMessages = await truncateSessionMessagesInPlace(
      currentSessionId,
      retryPrompt.sourceMessageId,
    );
    const normalizedRemainingMessages = normalizeChatMessages(remainingMessages);
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
          ? loadCurrentSessionSnapshot(currentSessionId).catch(() => undefined)
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
          ? loadCurrentSessionSnapshot(currentSessionId).catch(() => undefined)
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

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (composerMenu) {
      const currentItems = composerMenu.type === 'slash' ? slashCommandItems : mentionItems;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setComposerMenu((prev) =>
          prev
            ? {
                ...prev,
                selectedIndex:
                  currentItems.length === 0 ? 0 : (prev.selectedIndex + 1) % currentItems.length,
              }
            : prev,
        );
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setComposerMenu((prev) =>
          prev
            ? {
                ...prev,
                selectedIndex:
                  currentItems.length === 0
                    ? 0
                    : (prev.selectedIndex - 1 + currentItems.length) % currentItems.length,
              }
            : prev,
        );
        return;
      }
      if ((e.key === 'Enter' || e.key === 'Tab') && currentItems.length > 0) {
        e.preventDefault();
        const selectedItem = currentItems[composerMenu.selectedIndex] ?? currentItems[0];
        if (selectedItem) {
          void applyComposerSelection(selectedItem);
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setComposerMenu(null);
        return;
      }
    }
    if ((stopCapability === 'precise' || stopCapability === 'best_effort') && e.key === 'Escape') {
      e.preventDefault();
      void stopActiveMessage();
      return;
    }
    if (
      (streaming || canStopCurrentSessionStream || remoteSessionBusyState !== null) &&
      e.key === 'Enter' &&
      !e.shiftKey
    ) {
      e.preventDefault();
      enqueueComposerMessage();
      return;
    }
    if (canStopCurrentSessionStream && e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const nextValue = e.target.value;
    setInput(nextValue);
    updateComposerMenu(nextValue, e.target.selectionStart ?? nextValue.length);
  }

  function handleInputSelect(e: React.SyntheticEvent<HTMLTextAreaElement>) {
    const target = e.currentTarget;
    updateComposerMenu(target.value, target.selectionStart ?? target.value.length);
  }

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const imageFiles = Array.from(e.clipboardData.items)
      .filter((item) => item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file))
      .map((file, index) => {
        if (file.name) return file;
        const extension = file.type.split('/')[1] || 'png';
        return new File([file], `pasted-image-${Date.now()}-${index}.${extension}`, {
          type: file.type,
        });
      });

    const pastedText = e.clipboardData.getData('text/plain');

    if (imageFiles.length > 0 && !pastedText) {
      e.preventDefault();
      appendFiles(imageFiles);
    }
  }

  function replaceComposerToken(start: number, end: number, replacement: string) {
    const before = input.slice(0, start);
    const after = input.slice(end);
    const nextValue = `${before}${replacement}${after}`;
    setInput(nextValue);
    setComposerMenu(null);
    requestAnimationFrame(() => {
      if (!textareaRef.current) return;
      const nextCaret = before.length + replacement.length;
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(nextCaret, nextCaret);
    });
  }

  async function applyComposerSelection(item: SlashCommandItem | MentionItem) {
    if (!composerMenu) return;

    if (item.kind === 'slash') {
      if (item.type === 'insert') {
        replaceComposerToken(composerMenu.start, composerMenu.end, item.insertText ?? '');
        return;
      }
      setComposerMenu(null);
      await item.onSelect();
      return;
    }

    replaceComposerToken(composerMenu.start, composerMenu.end, item.insertText);
  }

  const appendCommandCard = useCallback(
    (card: CommandResultCard) => {
      appendAssistantDerivedMessages([
        {
          content: createCommandCardContent(card, {
            kindOverride:
              card.type === 'compaction'
                ? 'compaction'
                : resolveAssistantCapabilityKind(`${card.title}\n${card.message}`),
          }),
        },
      ]);
    },
    [appendAssistantDerivedMessages, resolveAssistantCapabilityKind],
  );

  function updateComposerMenu(value: string, caret: number) {
    const trigger = detectComposerTrigger(value, caret);
    if (!trigger) {
      setComposerMenu(null);
      return;
    }
    setComposerMenu((prev) => {
      if (
        !prev ||
        prev.type !== trigger.type ||
        prev.start !== trigger.start ||
        prev.end !== trigger.end
      ) {
        return { ...trigger, selectedIndex: 0 };
      }
      return { ...trigger, selectedIndex: prev.selectedIndex };
    });
  }

  const slashCommandItems = useMemo<SlashCommandItem[]>(() => {
    const allItems = buildComposerSlashItems({
      agents: composerWorkspaceCatalog.agents,
      commandDescriptors: composerCommandDescriptors,
      installedSkills: composerWorkspaceCatalog.installedSkills,
      agentTools: composerWorkspaceCatalog.agentTools,
      mcpServers: composerWorkspaceCatalog.mcpServers,
    });

    if (!composerMenu || composerMenu.type !== 'slash') {
      return [];
    }
    const query = composerMenu.query.toLowerCase();
    return allItems.filter((item) =>
      `${item.label} ${item.description} ${item.badgeLabel ?? ''}`.toLowerCase().includes(query),
    );
  }, [composerMenu, composerCommandDescriptors, composerWorkspaceCatalog]);

  const mentionItems = useMemo<MentionItem[]>(() => {
    if (!composerMenu || composerMenu.type !== 'mention') {
      return [];
    }
    const query = composerMenu.query.toLowerCase();
    return workspaceFileItems
      .filter((file) => `${file.label} ${file.relativePath}`.toLowerCase().includes(query))
      .slice(0, 8)
      .map((file) => ({
        id: file.path,
        kind: 'mention',
        label: file.label,
        description: file.relativePath,
        insertText: `@${file.relativePath} `,
      }));
  }, [composerMenu, workspaceFileItems]);

  const composerVariant =
    messages.length === 0 && !streaming && !streamBuffer && !remoteSessionBusyState
      ? 'home'
      : 'session';
  const activeProvider = providers.find((provider) => provider.id === activeProviderId);
  const activeModelOption = activeProvider?.defaultModels.find(
    (model) => model.id === activeModelId,
  );
  const activeModelCanConfigureThinking = canConfigureThinkingForModel(
    activeProvider?.type,
    activeModelOption?.id ?? activeModelId,
  );
  const activeModelTooltip = activeModelOption?.label
    ? `当前使用模型：${activeProvider?.name ? `${activeProvider.name} / ` : ''}${activeModelOption.label}`
    : activeProvider?.name
      ? `当前使用提供商：${activeProvider.name}`
      : '当前使用模型';
  const assistantUsageDetails = useMemo(() => {
    const usageByMessageId = new Map<string, ChatUsageDetails>();
    let contextTokens = 0;
    let requestIndex = 0;

    for (const message of messages) {
      const messageTokens = message.tokenEstimate ?? estimateTokenCount(message.content);

      if (message.role === 'assistant') {
        requestIndex += 1;
        const matchedPrice = resolveModelPriceEntry(modelPrices, [
          message.model,
          activeModelId,
          activeModelOption?.label,
        ]);
        const estimatedCostUsd = matchedPrice
          ? (contextTokens * matchedPrice.inputPer1m + messageTokens * matchedPrice.outputPer1m) /
            1_000_000
          : undefined;

        usageByMessageId.set(message.id, {
          requestIndex,
          inputTokens: contextTokens,
          outputTokens: messageTokens,
          totalTokens: contextTokens + messageTokens,
          estimatedCostUsd,
          durationMs: message.durationMs,
          firstTokenLatencyMs: message.firstTokenLatencyMs,
          tokensPerSecond:
            message.durationMs && message.durationMs > 0
              ? messageTokens / (message.durationMs / 1000)
              : undefined,
        });
      }

      contextTokens += messageTokens;
    }

    return usageByMessageId;
  }, [activeModelId, activeModelOption?.label, messages, modelPrices]);

  const messageInputTokens = useMemo(() => {
    return messages.reduce((sum, message) => {
      return sum + (message.tokenEstimate ?? estimateTokenCount(message.content));
    }, 0);
  }, [messages]);

  const streamingOutputTokens = useMemo(() => {
    return streamBuffer.length > 0 ? estimateTokenCount(streamBuffer) : 0;
  }, [streamBuffer]);

  const streamingUsageDetails = useMemo<ChatUsageDetails | undefined>(() => {
    if (!streaming || streamBuffer.length === 0) {
      return undefined;
    }

    const inputTokens = messageInputTokens;
    const outputTokens = streamingOutputTokens;
    const matchedPrice = resolveModelPriceEntry(modelPrices, [
      activeModelId,
      activeModelOption?.label,
    ]);
    const estimatedCostUsd = matchedPrice
      ? (inputTokens * matchedPrice.inputPer1m + outputTokens * matchedPrice.outputPer1m) /
        1_000_000
      : undefined;
    const activeDurationMs = activeStreamStartedAt ? Date.now() - activeStreamStartedAt : undefined;

    return {
      requestIndex: assistantUsageDetails.size + 1,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      estimatedCostUsd,
      durationMs: activeDurationMs,
      firstTokenLatencyMs: activeStreamFirstTokenLatencyMs ?? undefined,
      tokensPerSecond:
        activeDurationMs && activeDurationMs > 0
          ? outputTokens / (activeDurationMs / 1000)
          : undefined,
    };
  }, [
    activeModelId,
    activeModelOption?.label,
    activeStreamFirstTokenLatencyMs,
    activeStreamStartedAt,
    assistantUsageDetails.size,
    messageInputTokens,
    modelPrices,
    streamingOutputTokens,
    streamBuffer.length,
    streaming,
  ]);

  const historicalRenderedMessageEntries = useMemo<ChatRenderEntry[]>(() => {
    return (Array.isArray(messages) ? messages : []).map((message) => ({
      message,
      actions: buildMessageActions(message),
      renderContent: (currentMessage) =>
        renderChatMessageContentWithOptions(currentMessage, {
          onOpenChildSession: openChildSessionInspector,
          selectedChildSessionId,
          taskRuntimeLookup: taskToolRuntimeLookup,
        }),
      usageDetails: assistantUsageDetails.get(message.id),
    }));
  }, [
    assistantUsageDetails,
    buildMessageActions,
    messages,
    openChildSessionInspector,
    selectedChildSessionId,
    taskToolRuntimeLookup,
  ]);

  const streamingRenderedMessageEntry = useMemo<ChatRenderEntry | null>(() => {
    if (!streaming) {
      return null;
    }

    return {
      message: {
        id: '__streaming__',
        role: 'assistant',
        content:
          toolCallCards.length > 0
            ? createAssistantTraceContent({
                text: streamBuffer,
                toolCalls: toolCallCards.map((toolCall) => ({
                  kind: resolveAssistantCapabilityKind(toolCall.toolName),
                  toolCallId: toolCall.toolCallId,
                  toolName: toolCall.toolName,
                  input: toolCall.input,
                  output: toolCall.output,
                  isError: toolCall.isError,
                  status: toolCall.status,
                })),
              })
            : streamBuffer,
        model: (activeModelOption?.label ?? activeModelId) || undefined,
        providerId: activeProviderId || undefined,
        createdAt: activeStreamStartedAt ?? Date.now(),
        tokenEstimate: streamingOutputTokens,
        toolCallCount: toolCallCards.length > 0 ? toolCallCards.length : undefined,
        status: 'streaming',
      },
      renderContent: (message) =>
        renderStreamingChatMessageContentWithOptions(message.content, {
          onOpenChildSession: openChildSessionInspector,
          selectedChildSessionId,
          taskRuntimeLookup: taskToolRuntimeLookup,
        }),
      usageDetails: streamingUsageDetails,
    };
  }, [
    activeModelId,
    activeModelOption?.label,
    activeProviderId,
    activeStreamStartedAt,
    openChildSessionInspector,
    resolveAssistantCapabilityKind,
    selectedChildSessionId,
    streamBuffer,
    streaming,
    streamingOutputTokens,
    streamingUsageDetails,
    taskToolRuntimeLookup,
    toolCallCards,
  ]);

  const historicalGroupedMessageEntries = useMemo<ChatRenderGroup[]>(() => {
    return groupChatRenderEntries(historicalRenderedMessageEntries).map((group) =>
      decorateAssistantGroupActions(group, handleCopyMessageGroup),
    );
  }, [handleCopyMessageGroup, historicalRenderedMessageEntries]);

  const groupedMessageEntries = useMemo<ChatRenderGroup[]>(() => {
    if (!streamingRenderedMessageEntry) {
      return historicalGroupedMessageEntries;
    }

    const lastHistoricalGroup =
      historicalGroupedMessageEntries[historicalGroupedMessageEntries.length - 1];

    if (
      lastHistoricalGroup &&
      lastHistoricalGroup.role === streamingRenderedMessageEntry.message.role
    ) {
      const mergedGroup = decorateAssistantGroupActions(
        {
          ...lastHistoricalGroup,
          entries: [...lastHistoricalGroup.entries, streamingRenderedMessageEntry],
        },
        handleCopyMessageGroup,
      );

      return [...historicalGroupedMessageEntries.slice(0, -1), mergedGroup];
    }

    return [
      ...historicalGroupedMessageEntries,
      decorateAssistantGroupActions(
        {
          entries: [streamingRenderedMessageEntry],
          key: streamingRenderedMessageEntry.message.id,
          role: streamingRenderedMessageEntry.message.role,
        },
        handleCopyMessageGroup,
      ),
    ];
  }, [handleCopyMessageGroup, historicalGroupedMessageEntries, streamingRenderedMessageEntry]);

  const showSessionSwitchSkeleton = currentSessionId !== null && isSessionLoading && !streaming;

  useEffect(() => {
    if (providers.length === 0) {
      return;
    }

    const fallbackProvider = providers.find((provider) => provider.defaultModels.length > 0);
    const nextProvider =
      providers.find(
        (provider) => provider.id === activeProviderId && provider.defaultModels.length > 0,
      ) ?? fallbackProvider;
    const nextModel = nextProvider?.defaultModels.find((model) => model.id === activeModelId);
    const fallbackModel = nextProvider?.defaultModels[0];
    const nextProviderId = nextProvider?.id ?? '';
    const nextModelId = nextModel?.id ?? fallbackModel?.id ?? '';

    if (activeProviderId !== nextProviderId) {
      setActiveProviderId(nextProviderId);
    }

    if (activeModelId !== nextModelId) {
      setActiveModelId(nextModelId);
    }
  }, [providers, activeProviderId, activeModelId]);

  const rightPanelWidth = rightOpen
    ? rightTab === 'agent'
      ? 'clamp(360px, 40vw, 520px)'
      : 'clamp(320px, 32vw, 400px)'
    : 0;
  const rightPanelMaxWidth = rightOpen ? 'calc(100vw - 88px)' : 0;

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
                  setSessionMetadataDirty(false);
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
                  ) : messages.length === 0 && !streaming && !remoteSessionBusyState ? (
                    <WelcomeScreen
                      hasWorkspace={!!effectiveWorkingDirectory}
                      onNewSession={() => void ensureSession()}
                      onOpenWorkspace={() => setShowWorkspaceSelector(true)}
                    />
                  ) : messages.length === 0 && remoteSessionBusyState ? (
                    <SessionRunStatePlaceholder
                      status={remoteSessionBusyState}
                      stopCapability={stopCapability}
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
                <button
                  type="button"
                  data-testid="chat-scroll-bottom"
                  onClick={() => scrollToBottom('smooth', 'latest-edge')}
                  aria-label={
                    streaming
                      ? hasPendingFollowContent
                        ? '有新内容，恢复最新对话聚焦'
                        : '恢复最新对话聚焦'
                      : '定位最新对话'
                  }
                  style={{
                    position: 'absolute',
                    left: '50%',
                    bottom: 'calc(env(safe-area-inset-bottom, 0px) + 18px)',
                    transform: 'translateX(-50%)',
                    zIndex: 18,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    minHeight: 36,
                    padding: '0 14px',
                    maxWidth: 'calc(100% - 28px)',
                    borderRadius: 999,
                    border: hasPendingFollowContent
                      ? '1px solid color-mix(in oklch, var(--accent) 55%, var(--border))'
                      : '1px solid var(--border)',
                    background: hasPendingFollowContent
                      ? 'color-mix(in oklch, var(--surface) 82%, var(--accent) 18%)'
                      : 'color-mix(in oklch, var(--surface) 90%, transparent)',
                    color: hasPendingFollowContent ? 'var(--text)' : 'var(--text-2)',
                    boxShadow: 'var(--shadow-md)',
                    backdropFilter: 'blur(10px)',
                    cursor: 'pointer',
                    fontSize: 11,
                    fontWeight: 600,
                    touchAction: 'manipulation',
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
                    <path d="M12 5v14" />
                    <path d="m19 12-7 7-7-7" />
                  </svg>
                  {streaming
                    ? hasPendingFollowContent
                      ? '有新内容 · 恢复聚焦'
                      : '恢复最新对话'
                    : '定位最新对话'}
                </button>
              )}
            </div>
          </div>

          {streamError && (
            <div
              style={{
                padding: '0 10px 6px',
                background: 'var(--bg)',
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  maxWidth: 700,
                  margin: '0 auto',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  border: '1px solid rgba(239, 68, 68, 0.22)',
                  background: 'rgba(239, 68, 68, 0.08)',
                  color: 'var(--danger)',
                  borderRadius: 10,
                  padding: '7px 10px',
                }}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  style={{ flexShrink: 0 }}
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <div
                  style={{
                    minWidth: 0,
                    flex: 1,
                    fontSize: 11,
                    lineHeight: 1.45,
                    color: 'var(--danger)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={streamError}
                >
                  {streamError}
                </div>
                <button
                  type="button"
                  onClick={() => setStreamError(null)}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--danger)',
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer',
                    padding: '0 2px',
                    flexShrink: 0,
                  }}
                >
                  知道了
                </button>
              </div>
            </div>
          )}

          {remoteSessionBusyState && (
            <SessionRunStateBar status={remoteSessionBusyState} stopCapability={stopCapability} />
          )}

          <SubAgentRunList
            items={subAgentRunItems}
            selectedSessionId={selectedChildSessionId}
            onSelectSession={openChildSessionInspector}
          />

          <ChatTodoBar sessionTodos={sessionTodos} editorMode={editorMode} rightOpen={rightOpen} />

          <CompanionStage
            attachedCount={attachmentItems.length}
            currentUserEmail={currentUserEmail}
            editorMode={editorMode}
            input={input}
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
          />
        </div>
        <>
          <button
            type="button"
            aria-label="拖动调整编辑器宽度"
            onMouseDown={handleSplitMouseDown}
            disabled={!editorMode}
            style={{
              width: editorMode ? 5 : 0,
              flexShrink: 0,
              cursor: editorMode ? 'col-resize' : 'default',
              background: 'var(--border-subtle)',
              transition: splitDragging.current
                ? 'none'
                : 'width 240ms ease, opacity 180ms ease, background 150ms ease',
              zIndex: 10,
              border: 'none',
              padding: 0,
              opacity: editorMode ? 1 : 0,
              pointerEvents: editorMode ? 'auto' : 'none',
            }}
          />
          <div
            ref={editorPaneRef}
            aria-hidden={!editorMode}
            style={{
              flex: '0 0 auto',
              width: editorMode ? `calc(${100 - splitPos}% - 2.5px)` : 0,
              minWidth: 0,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              borderLeft: editorMode ? '1px solid var(--border)' : '1px solid transparent',
              opacity: editorMode ? 1 : 0,
              transform: editorMode ? 'translateX(0)' : 'translateX(10px)',
              pointerEvents: editorMode ? 'auto' : 'none',
              transition: splitDragging.current
                ? 'none'
                : 'width 240ms ease, opacity 180ms ease, transform 240ms ease, border-color 180ms ease',
            }}
          >
            <FileEditorPanel
              files={fileEditor.openFiles}
              activeFile={fileEditor.activeFile}
              activeFilePath={fileEditor.activeFilePath}
              isDirty={fileEditor.isDirty}
              saving={saving}
              saveError={fileEditor.saveError}
              onActivate={fileEditor.setActiveFilePath}
              onClose={fileEditor.closeFile}
              onChange={fileEditor.updateContent}
              onSave={handleSaveFile}
            />
          </div>
        </>
      </div>

      <div
        aria-hidden={!rightOpen}
        style={{
          width: rightPanelWidth,
          maxWidth: rightPanelMaxWidth,
          flexShrink: 0,
          overflow: 'hidden',
          borderLeft: rightOpen ? '1px solid var(--border)' : 'none',
          transition: 'width 200ms ease',
          display: 'flex',
          flexDirection: 'column',
          alignSelf: 'stretch',
        }}
      >
        {rightOpen ? (
          <div
            style={{
              width: rightPanelWidth,
              maxWidth: rightPanelMaxWidth,
              display: 'flex',
              flexDirection: 'row',
              height: '100%',
              minWidth: 0,
              minHeight: 0,
              background: 'color-mix(in oklch, var(--surface) 96%, var(--bg) 4%)',
            }}
          >
            <div
              data-testid="chat-right-nav-rail"
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'stretch',
                gap: 6,
                width: 76,
                minWidth: 76,
                padding: '8px 5px',
                borderRight: '1px solid var(--border)',
                flexShrink: 0,
                background:
                  'linear-gradient(180deg, color-mix(in oklch, var(--surface) 92%, var(--bg) 8%), color-mix(in oklch, var(--surface) 88%, var(--bg) 12%))',
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: 'var(--text-3)',
                  padding: '0 5px',
                }}
              >
                面板
              </div>
              <div
                role="tablist"
                aria-label="右侧面板切换"
                aria-orientation="vertical"
                style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
              >
                {(
                  [
                    { id: 'overview', label: '概览' },
                    { id: 'plan', label: '计划' },
                    { id: 'tools', label: '工具' },
                    { id: 'history', label: '历史' },
                    { id: 'viz', label: '可视化' },
                    { id: 'mcp', label: 'MCP' },
                    { id: 'agent', label: '代理' },
                  ] as const
                ).map((tab) => {
                  const isActive = rightTab === tab.id;

                  return (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      aria-controls={`chat-right-panel-${tab.id}`}
                      id={`chat-right-tab-${tab.id}`}
                      tabIndex={isActive ? 0 : -1}
                      onClick={() => setRightTab(tab.id)}
                      className={`toolbar-btn${isActive ? ' active' : ''}`}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'flex-start',
                        minHeight: 30,
                        padding: '6px 7px',
                        borderRadius: 8,
                        border: isActive
                          ? '1px solid color-mix(in oklch, var(--accent) 24%, var(--border))'
                          : '1px solid transparent',
                        background: isActive
                          ? 'color-mix(in oklch, var(--accent) 16%, var(--surface))'
                          : 'transparent',
                        color: isActive ? 'var(--accent)' : 'var(--text-2)',
                        boxShadow: isActive
                          ? 'inset 0 0 0 1px color-mix(in oklch, var(--accent) 10%, transparent)'
                          : 'none',
                        fontSize: 11,
                        fontWeight: isActive ? 600 : 500,
                        whiteSpace: 'nowrap',
                        textAlign: 'left',
                        lineHeight: 1.15,
                      }}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div
              role="tabpanel"
              id={`chat-right-panel-${rightTab}`}
              aria-labelledby={`chat-right-tab-${rightTab}`}
              style={{
                flex: 1,
                minHeight: 0,
                minWidth: 0,
                overflow: rightTab === 'agent' ? 'hidden' : 'auto',
                padding: rightTab === 'agent' ? 0 : 12,
                display: 'flex',
                flexDirection: 'column',
                background: 'color-mix(in oklch, var(--surface) 98%, var(--bg) 2%)',
              }}
            >
              {rightTab === 'plan' && <PlanPanel tasks={planTasks} />}
              {rightTab === 'tools' &&
                (() => {
                  const lspPrefixes = ['lsp_', 'ast_grep'];
                  const filePrefixes = [
                    'read',
                    'write',
                    'edit',
                    'glob',
                    'multi_edit',
                    'workspace_',
                  ];
                  const networkPrefixes = [
                    'webfetch',
                    'websearch',
                    'google_search',
                    'playwright',
                    'mcp_',
                  ];
                  const filtered = toolCallCards.filter((tc) => {
                    if (toolFilter === 'all') return true;
                    const n = tc.toolName.toLowerCase();
                    if (toolFilter === 'lsp') return lspPrefixes.some((p) => n.startsWith(p));
                    if (toolFilter === 'file') return filePrefixes.some((p) => n.startsWith(p));
                    if (toolFilter === 'network')
                      return networkPrefixes.some((p) => n.startsWith(p));
                    return (
                      !lspPrefixes.some((p) => n.startsWith(p)) &&
                      !filePrefixes.some((p) => n.startsWith(p)) &&
                      !networkPrefixes.some((p) => n.startsWith(p))
                    );
                  });
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {(['all', 'lsp', 'file', 'network', 'other'] as const).map((f) => (
                          <button
                            key={f}
                            type="button"
                            onClick={() => setToolFilter(f)}
                            style={{
                              height: 22,
                              padding: '0 7px',
                              borderRadius: 5,
                              border: 'none',
                              fontSize: 11,
                              fontWeight: 600,
                              cursor: 'pointer',
                              background: toolFilter === f ? 'var(--accent-muted)' : 'transparent',
                              color: toolFilter === f ? 'var(--accent)' : 'var(--text-3)',
                            }}
                          >
                            {f === 'all'
                              ? '全部'
                              : f === 'lsp'
                                ? 'LSP'
                                : f === 'file'
                                  ? '文件'
                                  : f === 'network'
                                    ? '网络'
                                    : '其他'}
                          </button>
                        ))}
                      </div>
                      {filtered.length > 0 ? (
                        filtered.map((toolCall, index) =>
                          toolCall.toolName.trim().toLowerCase() === 'task' ? (
                            <TaskToolInline
                              key={`${toolCall.toolName}-${index}`}
                              toolCallId={toolCall.toolCallId}
                              toolName={toolCall.toolName}
                              input={toolCall.input}
                              output={toolCall.output}
                              isError={toolCall.isError}
                              status={toolCall.status}
                              onOpenChildSession={openChildSessionInspector}
                              runtimeSnapshot={resolveTaskToolRuntimeSnapshot(
                                toolCall.input,
                                toolCall.output,
                                taskToolRuntimeLookup,
                              )}
                              selectedChildSessionId={selectedChildSessionId}
                            />
                          ) : (
                            <ToolCallCard
                              key={`${toolCall.toolName}-${index}`}
                              toolCallId={toolCall.toolCallId}
                              toolName={toolCall.toolName}
                              input={toolCall.input}
                              output={toolCall.output}
                              isError={toolCall.isError}
                              status={toolCall.status}
                            />
                          ),
                        )
                      ) : (
                        <div
                          style={{
                            fontSize: 11,
                            color: 'var(--text-3)',
                            padding: '4px 0',
                          }}
                        >
                          暂无工具调用记录
                        </div>
                      )}
                    </div>
                  );
                })()}
              {rightTab === 'viz' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={sharedUiThemeVars}>
                    <AgentDAGGraph nodes={dagNodes} edges={dagEdges} />
                  </div>
                  <div style={sharedUiThemeVars}>
                    <AgentVizPanel events={agentEvents} />
                  </div>
                </div>
              )}
              {rightTab === 'history' && (
                <ChatHistoryTabContent
                  childSessions={childSessions}
                  compactions={compactions}
                  pendingPermissions={pendingPermissions}
                  planHistory={planHistory}
                  sessionTodos={sessionTodos}
                  sessionTasks={sessionTasks}
                  onOpenSession={(nextSessionId) => {
                    void navigate(`/chat/${nextSessionId}`);
                  }}
                  sharedUiThemeVars={sharedUiThemeVars}
                />
              )}
              {rightTab === 'overview' && (
                <ChatOverviewTabContent
                  attachmentItems={attachmentItems}
                  childSessions={childSessions}
                  compactions={compactions}
                  currentSessionId={currentSessionId}
                  dialogueMode={dialogueMode}
                  effectiveWorkingDirectory={effectiveWorkingDirectory}
                  messages={messages}
                  pendingPermissions={pendingPermissions}
                  sessionTodos={sessionTodos}
                  sessionTasks={sessionTasks}
                  workspaceFileItems={workspaceFileItems}
                  yoloMode={yoloMode}
                />
              )}
              {rightTab === 'mcp' && (
                <div style={sharedUiThemeVars}>
                  <MCPServerList servers={mcpServers} />
                </div>
              )}
              {rightTab === 'agent' && (
                <div
                  style={{
                    flex: 1,
                    minHeight: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                    padding: 8,
                  }}
                >
                  <SubSessionDetailPanel
                    childSessionId={selectedChildSessionId}
                    currentUserEmail={currentUserEmail}
                    gatewayUrl={gatewayUrl}
                    onOpenFullSession={(nextSessionId) => {
                      void navigate(`/chat/${nextSessionId}`);
                    }}
                    parentTaskRuntimeLookup={taskToolRuntimeLookup}
                    token={token}
                  />
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
