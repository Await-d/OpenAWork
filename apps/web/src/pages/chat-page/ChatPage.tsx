import type { InputImageContent, SubagentNotice, WorkflowRuntimeState } from '@openAwork/shared';
import type { AttachmentItem } from '@openAwork/shared-ui';
import type { RollbackReceipt, Session, SessionTask } from '@openAwork/web-client';
import {
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
import { deriveCompanionInputFlags } from '../../components/chat/companion/companion-display-model.js';
import { useBuddyIdleDetector } from '../../components/chat/companion/use-buddy-idle-detector.js';
import { InlineQuestionPanel } from '../../components/chat/misc/InlineQuestionPanel.js';
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
import { useCurrentUserDisplayName } from '../../stores/user-profile/current-user-profile.js';
import {
  resolveEffectiveTerminalPanelPosition,
  useLocalSavedWorkspacePaths,
  useUIStateStore,
} from '../../stores/ui/uiState.js';
import {
  type ChatSettingsProvider,
  loadSavedChatSessionDefaults,
} from '../../utils/chat/chat-session-defaults.js';
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

import { makeOrderedMessageId } from '../../components/conversation-runtime/messages/ordered-id.js';
import { collectSubagentNotices } from '../../components/conversation-runtime/messages/subagent-notices.js';

import { startSequentialPolling } from '../../components/conversation-runtime/session/sequential-polling.js';

import {
  type SessionStateStatus,
  type SessionTodoItem,
  resolveSessionStopCapability,
  shouldPollSessionRuntime,
} from '../../components/conversation-runtime/session/session-runtime.js';

import { type ChatBackendUsageSnapshot } from '../../components/conversation-runtime/stream/stream-usage.js';
import { recoveredStreamHasVisibleContent } from '../../components/conversation-runtime/stream/stream-recovery.js';

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
  type ChatMessage,
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
import {
  createInitialAttachProgressState,
  runSessionAttachEffect,
  type AttachProgressState,
} from './hooks/run-session-attach-effect.js';
import { runChatSessionSwitchEffect } from './hooks/run-chat-session-switch-effect.js';
import { useChatUiActions } from './hooks/use-chat-ui-actions.js';
import { resolveChatUiWorkspaceScope, useChatUiState } from './hooks/use-chat-ui-state.js';
import { useModelPrices } from './conversation/settings/use-model-prices.js';
import { useProviderModelInfo } from './conversation/settings/use-provider-model-info.js';
import { useScrollManager } from '../../components/conversation-runtime/scroll/use-scroll-manager.js';
import {
  captureScrollAnchor,
  restoreScrollAnchor,
  type ScrollAnchorSnapshot,
} from '../../components/conversation-runtime/scroll/scroll-anchor.js';
import { useSessionContentArtifacts } from './conversation/snapshot/use-session-content-artifacts.js';
import { useSessionTerminals } from '../../components/conversation-runtime/terminals/use-session-terminals.js';

import { useSessionSettingsCallbacks } from './conversation/settings/use-session-settings-callbacks.js';
import {
  resolveModelSelectionSourceFromMetadata,
  shouldAdoptSessionModelSelectionDefaults,
  type ModelSelectionSource,
} from './conversation/settings/model-selection-source.js';
import { useSessionSidebarRunState } from './conversation/snapshot/use-session-sidebar-run-state.js';
import { useSessionSnapshotLoader } from './conversation/snapshot/use-session-snapshot-loader.js';
import { useStaleRunningResync } from './conversation/snapshot/use-stale-running-resync.js';

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
  const [providersRefreshing, setProvidersRefreshing] = useState(false);
  const [input, setInput] = useState('');
  const [companionComposerActivity, setCompanionComposerActivity] =
    useState<UnifiedComposerActivity>({
      attachedCount: 0,
      queuedCount: 0,
      showVoice: false,
    });
  const idleSeconds = useBuddyIdleDetector({ input });
  /**
   * Buddy（CompanionStage）的输入派生量。
   *
   * **不要把 `input` 原文传给它**：`input` 每敲一键就变一次，而那棵树含 sprite 动画、
   * `createPortal` 面板、9 个 effect 与语音合成——逐键整体重渲染正是打字卡顿的主因。
   * 这里只把「真正影响它行为」的 4 个布尔量 + 「`/buddy` 触发时的文本」筛出来，
   * 于是绝大多数按键下这些 prop 引用不变，上游编译器的自动 memo 能真正生效。
   */
  const companionInputFlags = useMemo(() => deriveCompanionInputFlags(input), [input]);
  const companionBuddyTriggerText = useMemo(
    () => (companionInputFlags.inputMentionsBuddy ? input : null),
    [companionInputFlags.inputMentionsBuddy, input],
  );
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
  /**
   * 头部插入旧消息（加载更多历史 / 跳转到更早消息）的滚动锚点快照：
   * 非 null 时「恢复视口」effect 会在下一帧把加载前的阅读位置恢复回去。
   */
  const [pendingHistoryAnchor, setPendingHistoryAnchor] = useState<ScrollAnchorSnapshot | null>(
    null,
  );
  const lastAnchorMessageIdRef = useRef<string | null>(null);
  // 可见窗口第一条消息 id 的 ref 镜像（在 `useChatRenderData` 返回后同步）：
  // 头部加载锚点捕获的回调定义在更早的位置，需要在任意时刻读到最新值。
  const firstVisibleMessageIdRef = useRef<string | null>(null);
  // armHistoryAnchor 的实际实现在下方 `useChatRenderData` 之后；此处用 ref
  // 转发，让 `ensureMessageVisible`（本文件更早位置）稳定调用同一实现。
  // 更正:上面两行的描述已过时——`ensureMessageVisible` 不再武装滚动锚点。
  // 该转发现在只服务「加载更早」(手动按钮 / 上滑 onNearTop);历史跳转与搜索
  // 改走 `pendingMessageScroll` 的一次性粗滚动(见虚拟视口的同名 effect)。
  // 两者不能同时生效:锚点恢复会把视口拉回加载前的阅读位置,从而覆盖跳转的目标位。
  const armHistoryAnchorImplRef = useRef<(() => void) | null>(null);
  const armHistoryAnchor = useCallback((): void => {
    armHistoryAnchorImplRef.current?.();
  }, []);
  /**
   * 悬挂的锚点恢复 rAF 取消句柄。**不能**由恢复 effect 的 cleanup 返回：
   * 该 effect 内部会 `setPendingHistoryAnchor(null)`，重渲染时 cleanup 若取消
   * rAF，恢复就永远不会落地。改为手动管理，只在重新武装 / 会话切换 / 卸载时取消。
   */
  const historyAnchorRestoreCancelRef = useRef<(() => void) | null>(null);
  /**
   * 一次性「滚动到指定历史消息」请求（虚拟化下用于先把目标组挂载出来）。
   * 历史跳转 / 搜索走 `ensureMessageVisible` 扩窗后，若目标在虚拟视口挂载
   * 窗口外，DOM 里查不到节点，调用方的 `scrollIntoView` 就会静默失效；
   * 这条请求让虚拟视口按目标组偏移先粗滚动一次，目标挂载后调用方再精确居中。
   */
  const [pendingMessageScroll, setPendingMessageScroll] = useState<{
    messageId: string;
    nonce: number;
  } | null>(null);
  const pendingMessageScrollNonceRef = useRef(0);
  const requestMessageScroll = useCallback((messageId: string): void => {
    pendingMessageScrollNonceRef.current += 1;
    setPendingMessageScroll({ messageId, nonce: pendingMessageScrollNonceRef.current });
  }, []);
  // 加载更多历史消息的实际实现在下方 `conversationViewProps` 附近定义；此处
  // ref 转发，让更早位置的 `useScrollManager` 上滑触发（onNearTop）能调用它。
  const loadEarlierMessagesRef = useRef<(() => void) | null>(null);
  // 隐藏（未加载）历史消息数的 ref 镜像：`hiddenMessageCount` 在下方
  // `useChatRenderData` 才派生，onNearTop 门控需任意时刻可读。
  const hiddenMessageCountRef = useRef(0);
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
  const streamThinkingBlocksRef = useRef<StreamingThinkingBlock[]>([]);
  const streamingSegmentsRef = useRef<ChatMessagePart[]>([]);
  const reportedStreamUsageRef = useRef<ChatBackendUsageSnapshot | null>(null);
  const activeStreamStartedAtRef = useRef<number | null>(null);
  const rightPanelStateRef = useRef<ChatRightPanelState>(rightPanelState);
  /**
   * 六个镜像的同步刻意放进无依赖 effect，而非渲染期顶层 `xxxRef.current = value`：
   * 渲染期写 ref 会被 React Compiler 判定为 "Cannot access refs during render" 并
   * 放弃优化整个 ChatPage。无依赖数组 = 每次渲染跑一次，与原来的逐帧赋值严格等价
   * （同 `use-terminal-session.ts` / `use-chat-session-lifecycle.ts` 的收口写法）。
   * 读取点全部是下方 effect（会话切换 effect、attach effect 等），本 effect 声明在
   * 它们之前，passive effect 按注册顺序执行，因此同一提交内「镜像先写、读取方后读」，
   * 读到的仍是本次提交的最新值。
   */
  useEffect(() => {
    streamBufferRef.current = streamBuffer;
    streamThinkingBlocksRef.current = streamThinkingBlocks;
    streamingSegmentsRef.current = streamingSegments;
    reportedStreamUsageRef.current = reportedStreamUsage;
    activeStreamStartedAtRef.current = activeStreamStartedAt;
    rightPanelStateRef.current = rightPanelState;
  });
  const lastAttachAttemptTimestampRef = useRef<number>(0);
  /**
   * attach 重连风暴熔断窗口（`{ startedAt, count }`）。
   *
   * attach 成功、断线重连、权限回复都会清空 `attachAttemptedSessionRef` 并重新
   * attach。如果新传输建立后立刻再次断开（网关侧 activeStream 指向已结束的流、
   * 代理断链、订阅被顶掉），这条链路会形成「attach → 断开 → 重置 → 再 attach」的
   * 无限循环：每轮都关闭并重建传输、重放事件，几秒内就能把主线程占满，页面卡死到
   * 无法操作（刷新也只是重新开始循环）。
   *
   * 这里在固定窗口内限制自动 attach 次数，超过即熔断并提示用户，把「无限循环」
   * 降级为「有界重试 + 明确错误」。窗口的读写都在 `runSessionAttachEffect` 内。
   */
  const attachAttemptWindowRef = useRef<{
    startedAt: number;
    count: number;
    /** 窗口归属的会话：换会话必须重置，否则 A 的熔断会惩罚 B。 */
    sessionId: string | null;
  }>({
    startedAt: 0,
    count: 0,
    sessionId: null,
  });
  /**
   * attach 的「无进展」检测：网关可能长期返回一个**已僵死**的活跃流快照
   * （`lastSeq` 不再前进），此时 SSE 打开即结束，单靠「确认有没有活跃流」永远
   * 收敛不了。连续多次重连时 `lastSeq` 完全相同，就说明没有新事件可推，应停止重连。
   */
  const attachProgressRef = useRef<AttachProgressState>(createInitialAttachProgressState());
  /**
   * 已做过「终态收尾」的会话 id，避免 attach effect 每次重跑都做一次全量快照加载。
   */
  const attachTerminalReloadRef = useRef<string | null>(null);
  const [reviewRefreshRevision, setReviewRefreshRevision] = useState(0);
  const previousStreamingRef = useRef(streaming);
  useEffect(() => {
    if (previousStreamingRef.current && !streaming) {
      setReviewRefreshRevision((revision) => revision + 1);
    }
    previousStreamingRef.current = streaming;
  }, [streaming]);

  const [sessionStateStatus, setSessionStateStatus] = useState<SessionStateStatus | null>(null);

  // ─── 待处理操作域 — 抽到 useChatPendingActions。
  // 参见 docs/architecture/chat-page-split-plan.md 域 C。
  const pendingActions = useChatPendingActions({
    gatewayUrl,
    token,
    currentSessionId,
    setMessages,
    setRightPanelState,
    setSessionStateStatus,
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
    inlinePermissionPendingDecision,
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
    lastParentTaskSyncMarkerRef.current = null;
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
    savedChatDefaultsRef.current = defaults;

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
          hasAppliedSavedImageDefaultsRef.current = true;
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
            // 扩窗会把旧消息插到渲染列表头部:目标节点此前没挂载,调用方的
            // scrollIntoView 会静默失效。这里请求虚拟视口先按目标组偏移粗滚动
            // 一次,把目标挂载出来,再由调用方精确居中。
            requestMessageScroll(messageId);
            setVisibleMessageCount(requiredCount);
          }
        }
        return;
      }
      // 本地数组里也没有 → 服务端可能还没拉过来,触发一次 snapshot
      // 重载并把窗口扩到全部新消息可见。
      if (currentSessionId) {
        requestMessageScroll(messageId);
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
      requestMessageScroll,
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
  /**
   * composer 专用的占用态：只回答「现在能不能发消息」，与上面的展示态分离。
   *
   * `remoteSessionBusyState` 在有待办交互时**无条件**收敛成 `'paused'`，即使
   * `sessionStateStatus` 仍是 `'running'`（批量审批续跑中 / 另一端发起了新一轮，都是
   * 真实存在的瞬态——见 `resolveSessionStopCapability` 的同款注释）。
   *
   * 那种双轨态下网关**确实**持有单飞锁，硬发必被拒成 SESSION_ALREADY_RUNNING：用户消息
   * 只有乐观气泡、不会落库，等于白丢一条。所以这里把「paused 且 running」升级回
   * `'running'` 交回禁用/排队语义。
   *
   * 展示侧不跟着变：状态条要继续说「等待审批 / 等待回答」，而不是「持续运行中」。
   */
  const composerSessionBusyState = useMemo<'running' | 'paused' | null>(() => {
    // 回复问题 / 权限的 HTTP 请求尚未完成时，后台续跑即将启动。
    // 先按 running 处理，避免用户在状态刷新竞态窗口里抢发消息。
    if (inlineQuestionReplyStatus !== null || inlinePermissionPendingDecision !== null) {
      return 'running';
    }

    if (remoteSessionBusyState === 'paused' && sessionStateStatus === 'running') {
      return 'running';
    }
    return remoteSessionBusyState;
  }, [
    inlinePermissionPendingDecision,
    inlineQuestionReplyStatus,
    remoteSessionBusyState,
    sessionStateStatus,
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
    return resolveSessionStopCapability({
      canStopCurrentSessionStream,
      currentSessionId,
      remoteSessionBusyState,
      sessionStateStatus,
      streaming,
    });
  }, [
    canStopCurrentSessionStream,
    currentSessionId,
    remoteSessionBusyState,
    sessionStateStatus,
    streaming,
  ]);
  // `visibleStreaming` 保持「**流式态**」语义（滚动跟随 / 输入框形态 / 停止按钮都用它）：
  // 只要本端在流式，或网关还有活跃流快照，就仍算流式。
  const visibleStreaming = streaming || recoveredStreamSnapshot !== null;
  /**
   * 是否应该渲染**实时气泡**。
   *
   * 与 `visibleStreaming` 分开：恢复快照在「上一轮已落库、下一轮还没开始」时是空的
   * （只带 `usage` / `upstreamSummary`）。若拿它撑起实时气泡，渲染层会造一条
   * `status: 'streaming'` 的空消息，`mergeStreamingEntryIntoHistoricalEntries` 再按
   * `clientRequestId` 精确匹配到历史上刚结束的那一轮并**用它替换** —— 内容是瞬间消失的。
   * 所以气泡是否出现必须以快照里**有没有可见内容**为准，而流式态不受影响。
   */
  const visibleStreamRenderable =
    streaming ||
    (recoveredStreamSnapshot !== null && recoveredStreamHasVisibleContent(recoveredStreamSnapshot));
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
  /**
   * 实时助手占位消息 id。真源是 `currentAssistantStreamMessageIdRef`（由
   * `start-standard-chat-stream` / `commit-streaming-round` / attach effect 在异步
   * 回调里改写），但渲染期（`useChatRenderData` 的 id 与排序判定）需要它的值，
   * 而渲染期读 ref 会被 React Compiler 判定为 "Cannot access refs during render"
   * 并放弃优化整个 ChatPage。故镜像到 state：layout effect 无依赖、每次提交后同步
   * 读取 ref，值变化时才 setState——值变化必定伴随一次渲染，而下一次渲染由
   * layout effect 在**绘制前**同步冲刷，因此首帧可见输出与改前一致。
   *
   * 用**先比对、再 setState**而不是只依赖同值 updater 兜底：
   * `setState(prev => prev === next ? prev : next)` 在同值时的确会被 React 的 eager
   * bailout 丢弃（已实测：把本 effect 与一个无界自增 effect 放一起，抛错时的自增次数
   * 与「只有自增 effect」完全一致，说明同值 dispatch 对嵌套更新计数零贡献）。
   * 但那次比较本身仍有成本，且依赖 bailout 生效的**前提**（fiber 无待办 lane）在
   * 并发渲染下不显然；先比对能直接省掉这次 dispatch，属于纯收益。
   *
   * **注意**：本 effect 只是「占位消息 id」的镜像，量级上不可能自持成环——实测
   * `Maximum update depth exceeded` 的抛点是「该次提交里**第一个真实入队**的
   * dispatcher」，而非循环的成因（把无界自增 effect 声明在本 effect 之前/之后，
   * 抛点会随之在两者间移动）。若再次看到报错落在这里，应当去别处找真正的驱动方。
   *
   * 比对基准取「本次渲染的 state」而非另一个镜像 ref：layout effect 只在**已提交**的
   * 渲染后执行，无依赖数组 ⇒ 闭包里的 state 就是本帧真实渲染值，天然自愈（不会出现
   * 「ref 已前移、state 因丢弃渲染而没跟上」导致后续永久跳过同步的形态）。
   */
  const [activeStreamMessageId, setActiveStreamMessageId] = useState<string | null>(null);
  useLayoutEffect(() => {
    const nextActiveStreamMessageId =
      currentAssistantStreamMessageIdRef.current ?? recoveredStreamSnapshot?.messageId ?? null;
    if (activeStreamMessageId === nextActiveStreamMessageId) {
      return;
    }
    setActiveStreamMessageId(nextActiveStreamMessageId);
  });

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
      lastParentTaskSyncMarkerRef.current = nextMarker;
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
        //
        // 判定必须用「本轮运行是否结束」，而不是只看 `streamingRef`：
        // attach 断开进入重连时 `handleInterruptedAttachStream` 会把 streaming
        // 置 false（内容转存到 recoveredStreamSnapshot 继续渲染），但**流并没有
        // 结束**。此时若按「非流式」走全量 `/recovery`，就会在重连等待期内每秒
        // 序列化整段会话——实测单会话 362 消息 / 363 parts ≈ 1.6MB，退避到 30s
        // 时就是连续 30 次，主线程直接被打满（「能动能但非常卡」）。
        // 网关仍报活跃流（`recoveryActiveStream`）或正在等待 attach 重试时，
        // 一律走轻量 `/status`：消息内容由重连后的 run event 重放补齐。
        const isStreamInFlight =
          streamingRef.current ||
          recoveryActiveStream !== null ||
          (attachRetryScheduledSessionId !== null &&
            attachRetryScheduledSessionId === targetSessionId);
        if (isStreamInFlight) {
          await loadSessionRuntimeSnapshot(targetSessionId, signal, expectedSessionViewEpoch);
        } else {
          await loadCurrentSessionSnapshot(targetSessionId, {
            expectedSessionViewEpoch,
            // 远端运行中的这条 1s 轮询是全程唯一会「反复」拉取活跃 scope 的调用方：
            // run event 走增量续读，单拍成本从 O(本轮已产生事件数) 降到 O(新增事件数)，
            // 下游累加 reduce 拿到的仍是完整序列（拼接由 loader 内的前缀缓冲完成）。
            incrementalRunEvents: true,
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
    attachRetryScheduledSessionId,
    currentSessionId,
    isPageActive,
    isSessionSnapshotReady,
    loadCurrentSessionSnapshot,
    loadSessionRuntimeSnapshot,
    recoveryActiveStream,
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
        writeRefCurrent(lastPersistedSessionMetadataSnapshotRef, nextSnapshot);
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

  const prevSnapshotReadyRef = useRef(false);
  const prevPageActiveRef = useRef(isPageActive);
  // When true, the next scroll-to-latest trigger (Effect A or B) should be
  // suppressed because the cache-restore path already set scrollTop.
  const suppressNextScrollRef = useRef(false);

  // Refs mirroring reactive state for use inside effects that must NOT
  // re-run when these values change (to avoid canceling an in-progress
  // settleObserver via cleanup).
  // 镜像写下沉到 **layout** effect：渲染期写 ref 会让 React Compiler 放弃优化整个
  // ChatPage；而下方 Effect A / Effect B 同为 layout effect，layout effect 按声明
  // 顺序执行，本 effect 声明在它们之前，因此它们读到的仍是本次提交的最新值。
  // （若改成 passive effect，Effect A 会先于镜像执行并读到上一帧的值。）
  const isSessionSnapshotReadyRef = useRef(isSessionSnapshotReady);
  const messagesLengthRef = useRef(messages.length);
  useLayoutEffect(() => {
    isSessionSnapshotReadyRef.current = isSessionSnapshotReady;
    messagesLengthRef.current = messages.length;
  });

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

  const focusComposerWithText = useCallback(
    (text: string) => {
      setInput(text);
      requestAnimationFrame(() => {
        if (!textareaRef.current) return;
        textareaRef.current.focus();
        const caret = text.length;
        textareaRef.current.setSelectionRange(caret, caret);
      });
      // 把 textareaRef（useChatUiState 返回的 ref）列入依赖：编译器要求 memo 内
      // 用到的 ref 在依赖里可查；ref 身份稳定，行为不变。
    },
    [textareaRef],
  );

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
      // 全局选中工作区的「路径 + 连接」是成对的，路径回落时连接必须一起回落：
      // 在远端工作区里点 ⌘N 时漏掉这一步，新会话会以裸路径落库。
      fallbackSshConnectionId: selectedSshConnectionId,
    });
    useUIStateStore
      .getState()
      .openDraftSession(resolvedWorkspace.workspacePath, resolvedWorkspace.sshConnectionId);
    if (currentSessionId) {
      void navigate('/chat');
    }
  }, [
    currentSessionId,
    focusComposerWithText,
    navigate,
    selectedSshConnectionId,
    selectedWorkspacePath,
  ]);

  const appendTextToComposer = useCallback(
    (text: string) => {
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
      // 同上:textareaRef 列入依赖,满足编译器对既有 memo 的依赖校验。
    },
    [textareaRef],
  );

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
      // setMessages（会话状态 hook 的 setter，身份稳定）列入依赖：原 deps 为空，
      // 编译器校验既有 memo 时要求补上，行为不变。
    },
    [setMessages],
  );

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
  const buildRenderMessageActions = useCallback(
    (message: ChatMessage) => {
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
        ...(messageMultiSelectEnabled
          ? [
              {
                id: 'select',
                label: isMessageSelected(message.id) ? '☑ 已选' : '☐ 选择',
                onClick: () => toggleMessageSelection(message.id),
              },
            ]
          : []),
      ];
    },
    [
      bookmarkStore,
      buildMessageActions,
      currentSessionId,
      isMessageSelected,
      messageMultiSelectEnabled,
      toggleMessageSelection,
    ],
  );

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
    firstVisibleMessageId,
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

  // ─── 头部插入历史消息的滚动锚点 ────────────────────────────────────
  // `messages` 是完整（或快照窗口）列表，加载旧消息 = 扩大 `slice(-visibleMessageCount)`
  // 窗口 / 替换 messages，旧消息插入渲染列表**头部**。视口若不加锚定，会被内容
  // 增长推离阅读位置。这里在插入前捕获「视口内最靠上的可见消息」，插入后恢复。

  // 两个镜像的写入同样下沉到 effect（渲染期写 ref 会让 React Compiler 放弃优化整个
  // ChatPage）。读取点只有事件回调——`onNearTop`（上滑加载更早）与
  // `captureHistoryScrollAnchor` / `armHistoryAnchorImpl`（按钮点击），均发生在本次
  // 提交的 effect 之后，读到的仍是本次提交的值。
  useEffect(() => {
    firstVisibleMessageIdRef.current = firstVisibleMessageId;
    hiddenMessageCountRef.current = hiddenMessageCount;
  });

  /** 捕获当前滚动锚点：视口内最靠上的一条可见消息 + 滚动区几何。 */
  const captureHistoryScrollAnchor = useCallback((): ScrollAnchorSnapshot => {
    const region = scrollRegionRef.current;
    const messageId = firstVisibleMessageIdRef.current;
    const anchorElement =
      messageId !== null && region !== null
        ? region.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`)
        : null;
    return captureScrollAnchor(region, anchorElement);
  }, [scrollRegionRef]);

  /**
   * 武装头部插入锚点：记录加载前的阅读位置快照。旧消息插入渲染列表头部后，
   * 「恢复视口」 effect 会把视口恢复到该位置。实现同时挂到
   * `armHistoryAnchorImplRef`，让文件更早位置定义的 `ensureMessageVisible`
   * 也能通过 `armHistoryAnchor` 稳定引用（ref 转发，无 TDZ 问题）。
   */
  const armHistoryAnchorImpl = useCallback((): void => {
    // 目前只有「加载更早」两条路径调用(按钮 / onNearTop)。历史跳转与搜索走
    // `pendingMessageScroll` 粗滚动,不再武装锚点,否则会互相覆盖。
    lastAnchorMessageIdRef.current = firstVisibleMessageIdRef.current;
    setPendingHistoryAnchor(captureHistoryScrollAnchor());
  }, [captureHistoryScrollAnchor]);
  useEffect(() => {
    armHistoryAnchorImplRef.current = armHistoryAnchorImpl;
  }, [armHistoryAnchorImpl]);

  /**
   * 加载更多历史消息（手动「加载更早」按钮 与 上滑 onNearTop 共用）：
   * 本地窗口还有隐藏消息时直接扩窗口，否则拉一次服务端快照。
   * 两条路径都会往渲染列表**头部**插入旧消息，因此先武装滚动锚点。
   */
  const handleLoadEarlierMessages = useCallback((): void => {
    const localHidden =
      sanitizedHistoricalMessages.length -
      (visibleMessageCount ?? sanitizedHistoricalMessages.length);
    if (localHidden > 0) {
      armHistoryAnchor();
      setVisibleMessageCount((prev) => prev + LOAD_MORE_MESSAGE_INCREMENT);
      return;
    }
    if (!currentSessionId) return;
    armHistoryAnchor();
    void loadCurrentSessionSnapshot(currentSessionId, {
      replaceMessages: true,
    })
      .then(() => {
        setServerTotalTurnCount(null);
        setVisibleMessageCount((prev) => prev + LOAD_MORE_MESSAGE_INCREMENT);
      })
      .catch(() => undefined);
  }, [
    armHistoryAnchor,
    currentSessionId,
    loadCurrentSessionSnapshot,
    sanitizedHistoricalMessages.length,
    setServerTotalTurnCount,
    setVisibleMessageCount,
    visibleMessageCount,
  ]);
  useEffect(() => {
    loadEarlierMessagesRef.current = handleLoadEarlierMessages;
  }, [handleLoadEarlierMessages]);

  // 会话切换：旧会话的待恢复锚点必须丢弃，不能落到新会话的滚动区上。
  useEffect(() => {
    historyAnchorRestoreCancelRef.current?.();
    historyAnchorRestoreCancelRef.current = null;
    setPendingHistoryAnchor(null);
    setPendingMessageScroll(null);
    lastAnchorMessageIdRef.current = null;
  }, [currentSessionId]);

  // 卸载时清理悬挂的恢复 rAF。
  useEffect(() => {
    return () => {
      historyAnchorRestoreCancelRef.current?.();
      historyAnchorRestoreCancelRef.current = null;
    };
  }, []);

  // 「恢复视口」：旧消息落入窗口后（`firstVisibleMessageId` 相对锚点时刻变化），
  // 在下一帧把视口恢复到加载前的阅读位置。layout effect 保证恢复先于绘制落地。
  useLayoutEffect(() => {
    if (pendingHistoryAnchor === null) return;
    if (firstVisibleMessageId === lastAnchorMessageIdRef.current) return;

    const anchorSnapshot = pendingHistoryAnchor;
    // 先取消上一次仍未落地的恢复，再排新的；**不能**把 cancel 作为 effect 的
    // 返回值——下方 setState 会触发重渲染，cleanup 会在 rAF 落地前把它取消掉。
    historyAnchorRestoreCancelRef.current?.();
    historyAnchorRestoreCancelRef.current = restoreScrollAnchor(
      scrollRegionRef.current,
      anchorSnapshot,
      (): Element | null => {
        const messageRegion = scrollRegionRef.current;
        if (messageRegion === null || lastAnchorMessageIdRef.current === null) return null;
        return messageRegion.querySelector<HTMLElement>(
          `[data-message-id="${lastAnchorMessageIdRef.current}"]`,
        );
      },
    );
    setPendingHistoryAnchor(null);
  }, [firstVisibleMessageId, pendingHistoryAnchor, scrollRegionRef]);

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
