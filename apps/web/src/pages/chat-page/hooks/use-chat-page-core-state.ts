import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { UnifiedComposerActivity } from '../../../components/chat/composer/UnifiedComposer.js';
import type { ComposerPermissionMode } from '../../../components/chat/composer/ComposerPermissionModeSelect.js';
import { deriveCompanionInputFlags } from '../../../components/chat/companion/companion-display-model.js';
import { useBuddyIdleDetector } from '../../../components/chat/companion/use-buddy-idle-detector.js';
import type {
  ChatMessagePart,
  ReasoningEffort,
} from '../../../components/conversation-runtime/messages/support.js';
import { type ScrollAnchorSnapshot } from '../../../components/conversation-runtime/scroll/scroll-anchor.js';
import { type SessionStateStatus } from '../../../components/conversation-runtime/session/session-runtime.js';
import { type ChatBackendUsageSnapshot } from '../../../components/conversation-runtime/stream/stream-usage.js';
import { type StreamingThinkingBlock } from '../../../components/conversation-runtime/stream/streaming-thinking.js';
import { useAuthStore } from '../../../stores/auth/auth.js';
import { useDisplayPreferencesStore } from '../../../stores/settings/display-preferences.js';
import { useCurrentUserDisplayName } from '../../../stores/user-profile/current-user-profile.js';
import type { ChatSettingsProvider } from '../../../utils/chat/chat-session-defaults.js';
import { writeRefCurrent } from '../../../utils/ref/ref-current.js';

import {
  type AttachProgressState,
  createInitialAttachProgressState,
} from './attach-effect-retry-policy.js';
import { useChatPendingActions } from './use-chat-pending-actions.js';
import { useChatSessionLifecycle } from './use-chat-session-lifecycle.js';
import { usePersistedStreamError } from './use-persisted-stream-error.js';
import { useChatStreaming } from '../conversation/render/use-chat-streaming.js';
import { useModelPrices } from '../conversation/settings/use-model-prices.js';
import type { DialogueMode } from '../mode/dialogue-mode.js';
import {
  type ChatRightPanelState,
  createInitialChatRightPanelState,
} from '../state/chat-stream-state.js';

const DEFAULT_VISIBLE_MESSAGE_COUNT = 20;

type UseChatPageCoreStateDeps = {
  readonly gatewayUrl: string;
  readonly routeSessionId: string | undefined;
  readonly token: string | null;
};

/**
 * ChatPage 的核心状态层：会话生命周期、流式状态、待处理交互，以及页面的
 * 本地 UI state / ref 镜像。
 *
 * 从 `ChatPage` 整体搬出，正文逐字保留。依赖只有路由会话 id、网关地址与 token，
 * 其余全部在 hook 内部创建，因此不存在隐藏的父子耦合。
 */
export function useChatPageCoreState(deps: UseChatPageCoreStateDeps) {
  const { gatewayUrl, routeSessionId: sessionId, token } = deps;

  /**
   * `token` 的 ref 镜像，专供「会话切换」大 effect 读取。
   *
   * 该 effect 的职责是「会话身份变化时重建会话视图」：它会重置快照就绪标记、
   * 挂骨架屏、重拉一次全量 recovery。而 access token 轮换（每 ~13 分钟一次）
   * 与「用户切到了哪个会话」毫无关系——把 token 放进依赖，等于让一个**停止状态
   * 的会话**定期整体重载一遍：状态条归零、骨架屏闪一下、消息列表被服务端快照
   * 重排，表现为「放着不动界面自己刷新了」。
   */
  const sessionSwitchTokenRef = useRef<string | null>(token);
  useEffect(() => {
    writeRefCurrent(sessionSwitchTokenRef, token);
  }, [token]);

  /**
   * 「是否已拿到访问令牌」的布尔镜像，**替代** token 值进入会话切换 effect 的依赖。
   *
   * 只用 `token` 的 ref 还不够：令牌从「没有」变成「有」时，该 effect 必须重跑一次
   * （否则鉴权就绪后会话永远不会加载）。而令牌在非空区间内的**轮换**绝不能触发重跑。
   * 一个布尔量正好把这两种情况区分开。
   */
  const hasSessionToken = token !== null;

  // ─── 会话生命周期域 — useChatSessionLifecycle。
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
   * 这里只把「真正影响它行为」的 4 个布尔量 + 「`/buddy` 触发时的文本」筛出来。
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
  // 可见窗口第一条消息 id 的 ref 镜像（在 `useChatRenderData` 返回后同步）。
  const firstVisibleMessageIdRef = useRef<string | null>(null);
  // armHistoryAnchor 的实际实现由 `useHistoryScrollAnchor` 提供；此处 ref 转发，
  // 让更早位置的回调能稳定引用同一实现。
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
  // 加载更多历史消息的实现在 `useHistoryScrollAnchor`；此处 ref 转发，
  // 让更早位置的上滑触发（onNearTop）能调用它。
  const loadEarlierMessagesRef = useRef<(() => void) | null>(null);
  // 隐藏（未加载）历史消息数的 ref 镜像：onNearTop 门控需任意时刻可读。
  const hiddenMessageCountRef = useRef(0);
  const [permissionMode, setPermissionMode] = useState<ComposerPermissionMode>('ask');
  // 档位是唯一事实来源；布尔 yoloMode 是派生投影，供旧读者消费。
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
   * 六个镜像的同步刻意放进无依赖 effect，而非渲染期顶层赋值：
   * 渲染期写 ref 会被 React Compiler 判定为 "Cannot access refs during render"。
   * 无依赖数组 = 每次渲染跑一次，与原来的逐帧赋值严格等价。
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
   * attach。如果新传输建立后立刻再次断开，这条链路会形成「attach → 断开 → 重置 →
   * 再 attach」的无限循环：每轮都关闭并重建传输、重放事件，几秒内就能把主线程占满。
   * 这里在固定窗口内限制自动 attach 次数，超过即熔断并提示用户。
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
  /** attach 的「无进展」检测：连续多次重连时 `lastSeq` 完全相同就说明没有新事件。 */
  const attachProgressRef = useRef<AttachProgressState>(createInitialAttachProgressState());
  /** 已做过「终态收尾」的会话 id，避免 attach effect 每次重跑都做一次全量快照加载。 */
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

  // ─── 待处理操作域 — useChatPendingActions。
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

  return {
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
    isImmediatelyRenderableStructuredContent,
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
    pendingActions,
    pendingBootstrapSessionRef,
    pendingHistoryAnchor,
    pendingMessageScroll,
    pendingMessageScrollNonceRef,
    pendingPermissions,
    pendingQuestions,
    pendingSessionNormalizeTimeoutRef,
    pendingStreamRevealFrameRef,
    permissionMode,
    previousRouteSessionIdRef,
    previousStreamingRef,
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
    sessionLifecycle,
    sessionReloadNonce,
    sessionStateStatus,
    sessionSwitchTokenRef,
    sessionViewCache,
    sessionViewEpochRef,
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
    streamError,
    streaming,
    streamingRef,
    streamingSegments,
    streamingSegmentsRef,
    streamingState,
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
  };
}
