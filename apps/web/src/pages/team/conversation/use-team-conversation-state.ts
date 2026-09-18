/**
 * useTeamConversationState · team 端对话 state hook
 *
 * 把 team 端"单 session 对话布局"所需的全部 state 打包成一个 hook，让
 * `<TeamConversationView/>` 通过它获得消息流 / 流式 / 滚动 / Q/P 回复 /
 * provider 列表 / inbound 提交所需的全部 props。
 *
 * **本 hook 是 `useChatConversationState` 的 team 独立版本**（260518 解耦
 * 方案 §6.4）：从 chat 复制为模板，再裁剪 chat-only 字段（dialogueMode /
 * yoloMode / webSearchEnabled / manualAgentId 等），加 team 专属字段（roleLayer / substate /
 * sessionMetadata 已在共享层；handoffsInline / layeredGroups 等后续 v2 加）。
 *
 * 与 chat 端的关键差异：
 * 1. **写入路径默认 enable**：team session 默认开启 composer，按
 *    `resolveTeamSubmitStrategy(roleLayer, substate)` 在 `inbound` 与
 *    `stream` 之间路由。
 * 2. **只传 team 需要的模型参数到 stream**：dialogue mode / yolo / web search
 *    不参与 team stream；provider/model 与 thinking/reasoning effort 会跟随
 *    请求；只传 provider/model（来自 session metadata）+ agentId（来自
 *    role 默认 agent）。
 * 3. **不读 localStorage 的 chat 默认值**：chat 端的
 *    `loadSavedChatSessionDefaults` 来自用户在 ChatPage 设置面板的偏好；
 *    team 端的 provider/model 来自服务端 session metadata，不重叠。
 *
 * **演化历史**：从 `pages/chat-page/conversation/use-chat-conversation-state.ts`
 * 复制而来。两边后续将各自独立演进，互不引用。
 *
 * 关联文档：
 * - `.agentdocs/workflow/260518-team-conversation-decouple-plan.md` §6.4
 * - `docs/chat-conversation-reuse-plan.md` v1.5 D5 决策
 * - `docs/team-architecture-l1-3-streaming-handoff-spec.md` §1.3
 */
import { useMemo, useRef, useState } from 'react';
import type { UpstreamStreamSummary } from '@openAwork/shared';
import type {
  ChatMessagePart,
  ReasoningEffort,
} from '../../../components/conversation-runtime/messages/support.js';
import type { ChatBackendUsageSnapshot } from '../../../components/conversation-runtime/stream/stream-usage.js';
import type { StreamingThinkingBlock } from '../../../components/conversation-runtime/stream/streaming-thinking.js';
import type { ChatSettingsProvider } from '../../../utils/chat/chat-session-defaults.js';
import { usePrefersReducedMotion } from '../../../hooks/ui/usePrefersReducedMotion.js';
import { useScrollManager } from '../../../components/conversation-runtime/scroll/use-scroll-manager.js';
import { useStreamReveal } from '../../../components/conversation-runtime/reveal/use-stream-reveal.js';
import { useTeamConversationProviders } from './use-team-conversation-state-providers.js';
import { useTeamConversationSnapshot } from './use-team-conversation-state-snapshot.js';
import { useTeamConversationStreaming } from './use-team-conversation-state-streaming.js';
import type {
  TeamConversationState,
  UseTeamConversationStateOptions,
} from './team-conversation-state-contract.js';
import {
  computeTeamConversationProvidersRetryDelay,
  computeTeamConversationRecoveryRetryDelay,
  formatTeamConversationProvidersLoadError,
  formatTeamConversationRecoveryLoadError,
} from './team-conversation-load-policy.js';

export type { TeamConversationState, UseTeamConversationStateOptions };
export {
  computeTeamConversationProvidersRetryDelay,
  computeTeamConversationRecoveryRetryDelay,
  formatTeamConversationProvidersLoadError,
  formatTeamConversationRecoveryLoadError,
};

// ─── 主 hook 实现 ─────────────────────────────────────────────────────────

/**
 * v0.1 骨架版实现：
 * - 加载 session recovery 快照
 * - 订阅 pending permissions / questions
 * - 提供 streaming / composer / 模型 / 滚动等 state 容器（实际 streaming
 *   逻辑由消费方驱动；本 hook 只暴露 state setter）
 *
 * 这意味着 chat 端暂时仍由 ChatPage 自己驱动 streaming，team 端在 Phase 2a
 * 是只读模式（composer disabled），不需要触发 streaming——可以直接用本
 * hook 的快照加载部分看到执行流。
 */
export function useTeamConversationState(
  options: UseTeamConversationStateOptions,
): TeamConversationState {
  const {
    sessionId,
    gatewayUrl,
    token,
    enabled = true,
    defaults,
    enableWriters = false,
    effectiveAgentId,
  } = options;
  const prefersReducedMotion = usePrefersReducedMotion();

  // ─── refs ────────────────────────────────────────────────────────
  const scrollRegionRef = useRef<HTMLDivElement>(null);
  const contentColumnRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pendingScrollFrameRef = useRef<number | null>(null);
  // editorPaneRef is reused as an inert sentinel because session-conversation
  // does not host an editor pane; the scroll manager just needs a stable ref.
  const editorPaneRef = useRef<HTMLDivElement>(null);

  // ─── 消息 + 流式 ────────────────────────────────────────────────
  const [streaming, setStreaming] = useState(false);
  const [stoppingStream, setStoppingStream] = useState(false);
  const [streamBuffer, setStreamBuffer] = useState('');
  const [streamThinkingBuffer, setStreamThinkingBuffer] = useState('');
  const [streamThinkingBlocks, setStreamThinkingBlocks] = useState<StreamingThinkingBlock[]>([]);
  const [streamingSegments, setStreamingSegments] = useState<ChatMessagePart[]>([]);
  const [reportedStreamUsage, setReportedStreamUsage] = useState<ChatBackendUsageSnapshot | null>(
    null,
  );
  const [streamError, setStreamError] = useState<string | null>(null);
  const [providersError, setProvidersError] = useState<string | null>(null);
  const [, setActiveStreamStartedAt] = useState<number | null>(null);
  const [, setActiveStreamFirstTokenLatencyMs] = useState<number | null>(null);
  const [, setLatestUpstreamSummary] = useState<UpstreamStreamSummary | null>(null);

  // ─── composer ─────────────────────────────────────────────────────
  const [input, setInput] = useState('');

  // ─── 模型 + 设置 ──────────────────────────────────────────────────
  // team 端保留 provider / model 与模型思考等级；dialogueMode / yoloMode /
  // webSearchEnabled / manualAgentId 仍不参与 team 数据流。
  const [providers, setProviders] = useState<ChatSettingsProvider[]>([]);
  const [activeProviderId, setActiveProviderId] = useState<string>(
    defaults?.activeProviderId ?? '',
  );
  const [activeModelId, setActiveModelId] = useState<string>(defaults?.activeModelId ?? '');
  const [thinkingEnabled, setThinkingEnabled] = useState(defaults?.thinkingEnabled ?? false);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>(
    defaults?.reasoningEffort ?? 'medium',
  );

  // ─── 滚动 ──────────────────────────────────────────────────────
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [hasPendingFollowContent, setHasPendingFollowContent] = useState(false);

  // ─── 多路 SSE 状态 ──────────────────────────────────────────────
  // multiAttachActive 必须在所有引用它的 effect（如轮询 effect）之前声明，
  // 否则 const 暂时性死区会导致 ReferenceError。
  // multiAttachActiveRef 是 ref 版本，供 callback 中同步读取。
  const multiAttachActiveRef = useRef(false);
  const [multiAttachActive, setMultiAttachActive] = useState(false);

  // ─── stream reveal + scroll manager ───────────────────────────────
  const { streamingRef, stoppingStreamRef, currentAssistantStreamMessageIdRef } = useStreamReveal(
    prefersReducedMotion,
    {
      setStreamBuffer,
      setStreamThinkingBuffer,
      setStreamThinkingBlocks,
      setStreamingSegments,
      setRecoveredStreamSnapshot: () => {
        // session-conversation v0.3 does not surface RecoveredActiveAssistantStream
        // outside the hook; this setter is a no-op so useStreamReveal can call it
        // during reset without crashing.
      },
      setStreaming,
      setStoppingStream,
      setActiveStreamStartedAt,
      setActiveStreamFirstTokenLatencyMs,
    },
  );

  const {
    messages,
    setMessages,
    childSessions,
    setChildSessions,
    sessionStateStatus,
    setSessionStateStatus,
    isSessionSnapshotReady,
    isSessionLoading,
    snapshotError,
    setSnapshotError,
    sessionTodos,
    pendingPermissions,
    setPendingPermissions,
    pendingQuestions,
    setPendingQuestions,
    runEvents,
    setRunEvents,
    roleLayer,
    substate,
    sessionMetadata,
    serverTotalTurnCount,
    isLoadingEarlier,
    reload,
    loadEarlierMessagesWithAnchor,
  } = useTeamConversationSnapshot({
    sessionId,
    gatewayUrl,
    token,
    enabled,
    streaming,
    multiAttachActive,
    streamingRef,
    scrollRegionRef,
    setActiveProviderId,
    setActiveModelId,
    setStreaming,
    setStoppingStream,
    setStreamBuffer,
    setStreamThinkingBuffer,
    setStreamThinkingBlocks,
    setStreamingSegments,
    setReportedStreamUsage,
    setStreamError,
    setInput,
    setShowScrollToBottom,
    setHasPendingFollowContent,
  });

  // ─── 派生 ────────────────────────────────────────────────────────
  const remoteSessionBusyState = useMemo<'running' | 'paused' | null>(() => {
    if (sessionStateStatus === 'running') return 'running';
    if (sessionStateStatus === 'paused') return 'paused';
    return null;
  }, [sessionStateStatus]);

  const visibleStreaming = useMemo(() => {
    return streaming || streamingSegments.length > 0 || streamBuffer.length > 0;
  }, [streaming, streamingSegments.length, streamBuffer.length]);

  const hiddenMessageCount = useMemo(() => {
    if (typeof serverTotalTurnCount !== 'number' || serverTotalTurnCount <= 0) {
      return 0;
    }
    const loadedUserTurnCount = messages.filter((message) => message.role === 'user').length;
    return Math.max(0, serverTotalTurnCount - loadedUserTurnCount);
  }, [messages, serverTotalTurnCount]);

  const { handleScroll: scrollManagerHandleScroll, scrollToBottom } = useScrollManager(
    {
      scrollRegionRef,
      bottomRef,
      pendingScrollFrameRef,
      contentColumnRef,
      editorPaneRef,
      textareaRef,
    },
    {
      setShowScrollToBottom,
      setHasPendingFollowContent,
    },
    {
      // team 会话身份 = 当前渲染的 sessionId：切换会话时重置滚动保持，
      // 流式 tick（buffer / streamingSegments 更新）不会改变它。
      sessionKey: sessionId,
      messagesLength: messages.length,
      visibleStreaming,
      visibleStreamBufferLength: streamBuffer.length,
      editorMode: false,
    },
    {
      onNearTop: () => {
        if (hiddenMessageCount > 0) {
          void loadEarlierMessagesWithAnchor();
        }
      },
      nearTopThreshold: 120,
      nearTopDebounceMs: 800,
    },
  );

  const {
    startStream,
    stopStream,
    attachToSessionStream,
    submitInbound,
    replyPermission,
    replyQuestion,
  } = useTeamConversationStreaming({
    sessionId,
    token,
    gatewayUrl,
    enabled,
    enableWriters,
    effectiveAgentId,
    roleLayer,
    providers,
    activeProviderId,
    activeModelId,
    thinkingEnabled,
    reasoningEffort,
    multiAttachActive,
    sessionStateStatus,
    childSessions,
    setChildSessions,
    setMessages,
    setSessionStateStatus,
    setPendingPermissions,
    setPendingQuestions,
    setMultiAttachActive,
    setStreaming,
    setStoppingStream,
    setStreamBuffer,
    setStreamThinkingBuffer,
    setStreamThinkingBlocks,
    setStreamingSegments,
    setReportedStreamUsage,
    setStreamError,
    setActiveStreamStartedAt,
    setActiveStreamFirstTokenLatencyMs,
    setLatestUpstreamSummary,
    streamingRef,
    stoppingStreamRef,
    currentAssistantStreamMessageIdRef,
    reload,
  });

  const { loadProviders } = useTeamConversationProviders({
    token,
    gatewayUrl,
    enableWriters,
    defaults,
    providers,
    setProviders,
    setProvidersError,
    activeProviderId,
    setActiveProviderId,
    activeModelId,
    setActiveModelId,
    setThinkingEnabled,
    setReasoningEffort,
  });

  return {
    messages,
    setMessages,
    streaming,
    stoppingStream,
    streamBuffer,
    streamThinkingBuffer,
    streamThinkingBlocks,
    streamingSegments,
    reportedStreamUsage,
    streamError,
    setStreamError,
    snapshotError,
    setSnapshotError,
    providersError,
    setProvidersError,

    input,
    setInput,
    textareaRef,

    providers,
    setProviders,
    activeProviderId,
    setActiveProviderId,
    activeModelId,
    setActiveModelId,
    thinkingEnabled,
    setThinkingEnabled,
    reasoningEffort,
    setReasoningEffort,

    scrollRegionRef,
    contentColumnRef,
    bottomRef,
    showScrollToBottom,
    hasPendingFollowContent,
    isSessionLoading,

    sessionStateStatus,
    isSessionSnapshotReady,
    sessionTodos,
    pendingPermissions,
    setPendingPermissions,
    pendingQuestions,
    setPendingQuestions,
    runEvents,
    setRunEvents,
    roleLayer,
    substate,
    sessionMetadata,
    childSessions,

    remoteSessionBusyState,
    visibleStreaming,
    hiddenMessageCount,

    reload,
    loadEarlierMessages: loadEarlierMessagesWithAnchor,
    isLoadingEarlier,
    submitInbound,
    startStream,
    stopStream,
    attachToSessionStream,
    replyPermission,
    replyQuestion,
    loadProviders,
    onScroll: scrollManagerHandleScroll,
    scrollToBottom,
  };
}
