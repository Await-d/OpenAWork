import { useCallback, useEffect, useRef } from 'react';
import type { RunEvent, UpstreamStreamSummary } from '@openAwork/shared';
import {
  createQuestionsClient,
  createTeamInboundClient,
  type InboundPayloadByType,
  type PendingPermissionRequest,
  type PendingQuestionRequest,
  type UserInputPayload,
} from '@openAwork/web-client';
import type {
  ChatMessage,
  ChatMessagePart,
  ReasoningEffort,
} from '../../../components/conversation-runtime/messages/support.js';
import type { SessionStateStatus } from '../../../components/conversation-runtime/session/session-runtime.js';
import type { ChatBackendUsageSnapshot } from '../../../components/conversation-runtime/stream/stream-usage.js';
import type { StreamingThinkingBlock } from '../../../components/conversation-runtime/stream/streaming-thinking.js';
import type { ChatSettingsProvider } from '../../../utils/chat/chat-session-defaults.js';
import { replyPermissionRequest } from '../../../utils/permission/permission-reply.js';
import { useLayerStore } from '../../../stores/team/team-events.js';
import { useMultiAttachStore } from '../../../stores/team/multi-attach-store.js';
import {
  formatGatewayStreamErrorMessage,
  useGatewayClient,
} from '../../../hooks/gateway/useGatewayClient.js';
import { resolveChatThinkingRequest } from '../../chat-page/conversation/settings/resolve-chat-thinking-request.js';
import { useConversationStream } from '../../../components/conversation-runtime/stream/use-conversation-stream.js';
import { makeOrderedMessageId } from '../../../components/conversation-runtime/messages/ordered-id.js';
import { estimateTokenCount } from '../../../components/conversation-runtime/messages/support.js';
import { toTeamRoleLayer } from './team-conversation-load-policy.js';
import type { TeamConversationState } from './team-conversation-state-contract.js';

export interface UseTeamConversationStreamingOptions {
  sessionId: string | null;
  token: string | null;
  gatewayUrl: string;
  enabled: boolean;
  enableWriters: boolean;
  effectiveAgentId?: string;
  roleLayer: string | null;
  providers: ChatSettingsProvider[];
  activeProviderId: string;
  activeModelId: string;
  thinkingEnabled: boolean;
  reasoningEffort: ReasoningEffort;
  multiAttachActive: boolean;
  sessionStateStatus: SessionStateStatus | null;
  childSessions: Array<{ id: string; role_layer?: string | null; messages: ChatMessage[] }>;
  setChildSessions: React.Dispatch<
    React.SetStateAction<Array<{ id: string; role_layer?: string | null; messages: ChatMessage[] }>>
  >;
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  setSessionStateStatus: React.Dispatch<React.SetStateAction<SessionStateStatus | null>>;
  setPendingPermissions: React.Dispatch<React.SetStateAction<PendingPermissionRequest[]>>;
  setPendingQuestions: React.Dispatch<React.SetStateAction<PendingQuestionRequest[]>>;
  setMultiAttachActive: React.Dispatch<React.SetStateAction<boolean>>;
  setStreaming: React.Dispatch<React.SetStateAction<boolean>>;
  setStoppingStream: React.Dispatch<React.SetStateAction<boolean>>;
  setStreamBuffer: React.Dispatch<React.SetStateAction<string>>;
  setStreamThinkingBuffer: React.Dispatch<React.SetStateAction<string>>;
  setStreamThinkingBlocks: React.Dispatch<React.SetStateAction<StreamingThinkingBlock[]>>;
  setStreamingSegments: React.Dispatch<React.SetStateAction<ChatMessagePart[]>>;
  setReportedStreamUsage: React.Dispatch<React.SetStateAction<ChatBackendUsageSnapshot | null>>;
  setStreamError: React.Dispatch<React.SetStateAction<string | null>>;
  setActiveStreamStartedAt: React.Dispatch<React.SetStateAction<number | null>>;
  setActiveStreamFirstTokenLatencyMs: React.Dispatch<React.SetStateAction<number | null>>;
  setLatestUpstreamSummary: React.Dispatch<React.SetStateAction<UpstreamStreamSummary | null>>;
  streamingRef: React.MutableRefObject<boolean>;
  stoppingStreamRef: React.MutableRefObject<boolean>;
  currentAssistantStreamMessageIdRef: React.MutableRefObject<string | null>;
  reload: () => Promise<void>;
}

export interface UseTeamConversationStreamingResult {
  startStream: TeamConversationState['startStream'];
  stopStream: TeamConversationState['stopStream'];
  attachToSessionStream: TeamConversationState['attachToSessionStream'];
  submitInbound: TeamConversationState['submitInbound'];
  replyPermission: TeamConversationState['replyPermission'];
  replyQuestion: TeamConversationState['replyQuestion'];
}

export function useTeamConversationStreaming(
  options: UseTeamConversationStreamingOptions,
): UseTeamConversationStreamingResult {
  const {
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
  } = options;

  const submitInbound = useCallback<TeamConversationState['submitInbound']>(
    async (messageType, payload, opts) => {
      if (!sessionId) {
        throw new Error('当前团队会话不存在，无法提交团队消息。');
      }
      if (!token) {
        throw new Error('未登录，无法提交团队消息。');
      }
      let resolvedPayload = payload;
      if (messageType === 'user_input' && roleLayer === 'reception') {
        const inboundPayload = payload as UserInputPayload;
        const activeProvider = providers.find((provider) => provider.id === activeProviderId);
        const activeModel = activeProvider?.defaultModels.find(
          (model) => model.id === activeModelId,
        );
        const resolvedThinkingRequest = resolveChatThinkingRequest({
          providerType: activeProvider?.type,
          modelId: activeModel?.id ?? activeModelId,
          declaredSupportsThinking: activeModel?.supportsThinking === true,
          thinkingEnabled,
          reasoningEffort,
        });
        resolvedPayload = {
          ...inboundPayload,
          ...(activeModelId ? { modelId: activeModelId } : {}),
          ...(activeProviderId ? { providerId: activeProviderId } : {}),
          ...(resolvedThinkingRequest.thinkingEnabled !== undefined
            ? { thinkingEnabled: resolvedThinkingRequest.thinkingEnabled }
            : {}),
          ...(resolvedThinkingRequest.reasoningEffort
            ? { reasoningEffort: resolvedThinkingRequest.reasoningEffort }
            : {}),
        } as InboundPayloadByType[typeof messageType];
      }
      const inboundClient = createTeamInboundClient(gatewayUrl);
      return inboundClient.submit(token, sessionId, {
        messageType,
        payload: resolvedPayload,
        clientIdempotencyKey: opts?.clientIdempotencyKey,
        expiresAt: opts?.expiresAt,
      });
    },
    [
      sessionId,
      token,
      gatewayUrl,
      roleLayer,
      providers,
      activeProviderId,
      activeModelId,
      thinkingEnabled,
      reasoningEffort,
    ],
  );

  // ─── v0.3 writers / stream consumer ───────────────────────────────
  const gatewayClient = useGatewayClient(token);
  // multiAttachActiveRef 是 ref 版本，供 callback 中同步读取。
  const multiAttachActiveRef = useRef(false);
  // Hold a `requestStartedAt` per round; refreshed on each startStream call.
  const streamRequestStartedAtRef = useRef<number>(Date.now());
  const onChatOnlyEventRef = useRef<((event: RunEvent) => void) | undefined>(undefined);
  const requestModelLabelRef = useRef<string | undefined>(undefined);
  const requestProviderIdRef = useRef<string | undefined>(undefined);
  const requestAgentIdRef = useRef<string | undefined>(undefined);
  // Rid the gateway persists against for the current stream; stamped on each
  // locally committed round so snapshot reconciliation can match by identity.
  const streamClientRequestIdRef = useRef<string | null>(null);

  const stream = useConversationStream(
    {
      currentAssistantStreamMessageIdRef,
      streamingRef,
      stoppingStreamRef,
    },
    {
      setMessages,
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
      setSessionStateStatus,
      setPendingPermissions,
    },
    {
      sessionId,
      requestStartedAt: streamRequestStartedAtRef.current,
      get clientRequestId() {
        return streamClientRequestIdRef.current;
      },
      get requestProviderId() {
        return requestProviderIdRef.current;
      },
      get requestModelLabel() {
        return requestModelLabelRef.current;
      },
      get requestAgentId() {
        return requestAgentIdRef.current;
      },
      onChatOnlyEvent: (event) => onChatOnlyEventRef.current?.(event),
      onStreamDone: () => {
        // Mirror finalized assistant message back through reload so the
        // gateway-persisted id replaces the locally generated message id
        // (keeps subsequent rounds aligned with backend state).
        void reload();
      },
      onStreamError: () => {
        // streamError state is already set by the consumer; no-op here.
      },
    },
  );

  // multiAttachActiveRef 和 multiAttachActive 已在会话状态区域声明（使用前定义）。

  const startStream: TeamConversationState['startStream'] = useCallback(
    async (text, opts) => {
      if (!enableWriters) {
        throw new Error('当前会话为只读模式，无法发送消息。');
      }
      if (!sessionId || !token) {
        throw new Error('当前团队会话或登录状态无效，无法开始对话。');
      }
      if (streamingRef.current) {
        // 已在流式生成中：明确抛错而非静默 return。早期实现这里直接 return，
        // 上层 handleComposerSubmit 已先清空输入框，导致这条消息被静默丢弃且
        // 无任何反馈。改为抛错让调用方据此保留输入框内容并提示用户。
        throw new Error('正在生成回复，请等待当前回复完成或点击停止后再发送。');
      }

      const trimmed = text.trim();
      if (!trimmed) return;

      onChatOnlyEventRef.current = opts?.onChatOnlyEvent;
      requestProviderIdRef.current = activeProviderId || undefined;
      const activeProvider = providers.find((provider) => provider.id === activeProviderId);
      const activeModel = activeProvider?.defaultModels.find((model) => model.id === activeModelId);
      const resolvedThinkingRequest = resolveChatThinkingRequest({
        providerType: activeProvider?.type,
        modelId: activeModel?.id ?? activeModelId,
        declaredSupportsThinking: activeModel?.supportsThinking === true,
        thinkingEnabled,
        reasoningEffort,
      });
      const activeModelLabel = activeModel?.label;
      requestModelLabelRef.current = activeModelLabel ?? activeModelId ?? undefined;
      requestAgentIdRef.current = opts?.agentId || effectiveAgentId || undefined;
      streamRequestStartedAtRef.current = Date.now();

      // Push the user message into the local list immediately for snappy UX.
      const userMessageId = makeOrderedMessageId();
      const userMessage: ChatMessage = {
        id: userMessageId,
        role: 'user',
        content: trimmed,
        createdAt: Date.now(),
        tokenEstimate: estimateTokenCount(trimmed),
      };
      setMessages((prev) => [...prev, userMessage]);
      // Pre-allocate the assistant streaming message id so the consumer can
      // accumulate segments under it before the gateway emits any event.
      currentAssistantStreamMessageIdRef.current = makeOrderedMessageId();
      stream.resetRoundAccumulators();
      // Disable multi-attach handling during user-initiated stream — the
      // WS/SSE stream from startStream provides events directly.
      multiAttachActiveRef.current = false;
      setMultiAttachActive(false);
      setStreaming(true);
      streamingRef.current = true;
      setActiveStreamStartedAt(streamRequestStartedAtRef.current);
      setActiveStreamFirstTokenLatencyMs(null);
      setSessionStateStatus('running');

      gatewayClient.stream(sessionId, trimmed, {
        agentId: requestAgentIdRef.current,
        displayMessage: opts?.displayMessage,
        ...(opts?.inputParts ? { inputParts: opts.inputParts } : {}),
        model: activeModelId || 'default',
        providerId: activeProviderId || undefined,
        thinkingEnabled: resolvedThinkingRequest.thinkingEnabled,
        reasoningEffort: resolvedThinkingRequest.reasoningEffort,
        // team 端不传 dialogueMode / webSearchEnabled / yoloMode：这些是
        // chat-only 偏好，与 team 数据流无关。
        onDelta: () => {
          // useConversationStream consumes `text_delta` via onEvent; this
          // legacy hook is unused but required by the StreamCallbacks shape.
        },
        onEvent: (event) => {
          // GatewayStreamEvent === RunEvent for our purposes; cast through.
          stream.handleEvent(event as RunEvent);
        },
        onDone: () => {
          streamingRef.current = false;
          setStreaming(false);
          setStoppingStream(false);
          setActiveStreamStartedAt(null);
          // Re-enable multi-attach if it's still connected.
          // We do this synchronously in onDone (rather than relying on
          // checkAndRegister) to avoid a window where streamingRef is false
          // but multiAttachActiveRef is also false, which could let multi-attach
          // events leak into the old round's accumulator.
          if (sessionId) {
            const maStatus = useMultiAttachStore.getState().sessions.get(sessionId);
            if (maStatus?.state === 'connected') {
              multiAttachActiveRef.current = true;
              setMultiAttachActive(true);
              currentAssistantStreamMessageIdRef.current = makeOrderedMessageId();
              stream.resetRoundAccumulators();
              setStreaming(true);
              streamingRef.current = true;
              setActiveStreamStartedAt(Date.now());
              setActiveStreamFirstTokenLatencyMs(null);
            }
          }
          // Trigger reload (also called inside the consumer's onStreamDone).
        },
        onError: (code, message, technicalDetail) => {
          streamingRef.current = false;
          setStreaming(false);
          setStoppingStream(false);
          setStreamError(formatGatewayStreamErrorMessage(code, message, technicalDetail));
          // Re-enable multi-attach on error too, if still connected.
          if (sessionId) {
            const maStatus = useMultiAttachStore.getState().sessions.get(sessionId);
            if (maStatus?.state === 'connected') {
              multiAttachActiveRef.current = true;
              setMultiAttachActive(true);
              currentAssistantStreamMessageIdRef.current = makeOrderedMessageId();
              stream.resetRoundAccumulators();
              setStreaming(true);
              streamingRef.current = true;
              setActiveStreamStartedAt(Date.now());
              setActiveStreamFirstTokenLatencyMs(null);
            }
          }
        },
      });
      // `stream()` mints the rid synchronously; capture it before any event
      // arrives so both the intermediate and final commits carry it.
      streamClientRequestIdRef.current = gatewayClient.getActiveStreamClientRequestId();
    },
    [
      enableWriters,
      sessionId,
      token,
      activeProviderId,
      activeModelId,
      thinkingEnabled,
      reasoningEffort,
      effectiveAgentId,
      providers,
      gatewayClient,
      stream,
      streamingRef,
      currentAssistantStreamMessageIdRef,
    ],
  );

  const stopStream: TeamConversationState['stopStream'] = useCallback(async () => {
    if (!enableWriters) return false;
    setStoppingStream(true);
    stoppingStreamRef.current = true;
    try {
      const ok = await gatewayClient.stopStream();
      if (ok) {
        // The stream's `done` event will reset state shortly; meanwhile mark
        // streaming false eagerly so the UI reflects the user's intent.
        streamingRef.current = false;
        setStreaming(false);
      }
      return ok;
    } catch (err) {
      setStreamError(err instanceof Error ? err.message : 'stopStream failed');
      return false;
    } finally {
      setStoppingStream(false);
      stoppingStreamRef.current = false;
    }
  }, [enableWriters, gatewayClient, streamingRef, stoppingStreamRef]);

  // ─── attach to background stream ────────────────────────────────
  // reception session 走 inbound 路径后，后端通过 `runSessionInBackground`
  // 启动 LLM stream（direct 路径）或派发到子 session（orchestrate 路径）。
  // 对于 direct 路径，流式 token 通过 `publishSessionRunEvent` 发布到
  // session 级别事件总线，前端可通过 `/sessions/:id/stream/attach` SSE
  // 端点实时消费。本方法封装 attach 连接，将收到的 RunEvent 转发给
  // `useConversationStream.handleEvent`，实现与 `startStream` 相同的
  // 逐 token 流式渲染效果。
  const attachAttemptedSessionRef = useRef<string | null>(null);
  const attachRetryCountRef = useRef(0);
  const ATTACH_MAX_RETRIES = 3;

  const attachToSessionStream: TeamConversationState['attachToSessionStream'] =
    useCallback(async () => {
      if (!sessionId || !token) {
        return false;
      }
      // 已在流式中（startStream 路径）不需要 attach。
      if (streamingRef.current) {
        return false;
      }
      // 同一 session 只尝试一次 attach，避免循环重试。
      // 但如果上次 attach 失败（attachAttemptedSessionRef 被重置为 null），
      // 允许重试，最多 ATTACH_MAX_RETRIES 次。
      if (attachAttemptedSessionRef.current === sessionId) {
        return false;
      }
      if (attachRetryCountRef.current >= ATTACH_MAX_RETRIES) {
        return false;
      }
      attachAttemptedSessionRef.current = sessionId;
      attachRetryCountRef.current += 1;

      // 预分配 assistant 流式消息 id，供 useConversationStream 累积 segments。
      currentAssistantStreamMessageIdRef.current = makeOrderedMessageId();
      streamRequestStartedAtRef.current = Date.now();
      // attach 路径下 provider/model 未知（后端使用 session 默认配置），
      // 仅设置 agentId 以便流式消息能显示正确的角色身份。
      requestProviderIdRef.current = activeProviderId || undefined;
      requestModelLabelRef.current = activeModelId || undefined;
      requestAgentIdRef.current = effectiveAgentId || undefined;
      stream.resetRoundAccumulators();
      setStreaming(true);
      streamingRef.current = true;
      setActiveStreamStartedAt(streamRequestStartedAtRef.current);
      setActiveStreamFirstTokenLatencyMs(null);
      setSessionStateStatus('running');

      const attachResult = await gatewayClient.attachToActiveStream(sessionId, {
        onDelta: () => {
          // useConversationStream consumes `text_delta` via onEvent; this
          // legacy hook is unused but required by the StreamCallbacks shape.
        },
        onEvent: (event) => {
          stream.handleEvent(event as RunEvent);
        },
        onDone: () => {
          streamingRef.current = false;
          setStreaming(false);
          setStoppingStream(false);
          setActiveStreamStartedAt(null);
          // Re-enable multi-attach if it's still connected (same as startStream's onDone).
          if (sessionId) {
            const maStatus = useMultiAttachStore.getState().sessions.get(sessionId);
            if (maStatus?.state === 'connected') {
              multiAttachActiveRef.current = true;
              setMultiAttachActive(true);
              currentAssistantStreamMessageIdRef.current = makeOrderedMessageId();
              stream.resetRoundAccumulators();
              setStreaming(true);
              streamingRef.current = true;
              setActiveStreamStartedAt(Date.now());
              setActiveStreamFirstTokenLatencyMs(null);
            }
          }
          // reload 已由 useConversationStream 的 onStreamDone 回调触发，
          // 这里不重复调用，避免冗余请求。
        },
        onError: (code, message, technicalDetail) => {
          streamingRef.current = false;
          setStreaming(false);
          setStoppingStream(false);
          setActiveStreamStartedAt(null);
          // Attach 失败不一定是错误——可能后端 direct 路径已完成或走了
          // orchestrate 路径（无活跃流）。仅在非"无活跃流"错误时提示。
          if (code !== 'NO_ACTIVE_STREAM' && code !== 'ATTACH_NO_ACTIVE_STREAM') {
            setStreamError(formatGatewayStreamErrorMessage(code, message, technicalDetail));
          }
          // Re-enable multi-attach on error too, if still connected.
          if (sessionId) {
            const maStatus = useMultiAttachStore.getState().sessions.get(sessionId);
            if (maStatus?.state === 'connected') {
              multiAttachActiveRef.current = true;
              setMultiAttachActive(true);
              currentAssistantStreamMessageIdRef.current = makeOrderedMessageId();
              stream.resetRoundAccumulators();
              setStreaming(true);
              streamingRef.current = true;
              setActiveStreamStartedAt(Date.now());
              setActiveStreamFirstTokenLatencyMs(null);
            }
          }
        },
      });
      // attach 成功：重置重试计数。
      if (attachResult.status === 'attached') {
        attachRetryCountRef.current = 0;
        streamClientRequestIdRef.current = gatewayClient.getActiveStreamClientRequestId();
      }
      // attach 未成功（无活跃流等）：回滚 streaming 状态，避免 UI 卡在
      // "streaming" 模式。onError 回调已处理错误场景的清理。
      // 不回滚 sessionStateStatus——后端可能在短时间内将状态从 running 切到
      // 其它值，下一次 reload() 会同步真实状态。
      if (attachResult.status !== 'attached') {
        streamingRef.current = false;
        setStreaming(false);
        setActiveStreamStartedAt(null);
        // 重置 attach 标记：attach 失败可能是时序问题（后端流尚未注册），
        // 允许自动 attach effect 在下一次 reload 检测到 running 时重试。
        attachAttemptedSessionRef.current = null;
        // 触发 reload 同步真实 session 状态，避免 attach 失败后状态不一致。
        void reload();
      }
      return attachResult.status === 'attached';
    }, [
      sessionId,
      token,
      gatewayClient,
      stream,
      streamingRef,
      currentAssistantStreamMessageIdRef,
      reload,
      activeProviderId,
      activeModelId,
      effectiveAgentId,
    ]);

  // 当 sessionId 变化时重置 attach 尝试标记，允许新 session 重新 attach。
  useEffect(() => {
    if (
      attachAttemptedSessionRef.current !== null &&
      attachAttemptedSessionRef.current !== sessionId
    ) {
      attachAttemptedSessionRef.current = null;
      attachRetryCountRef.current = 0;
    }
  }, [sessionId]);

  // 自动 attach：当 session 处于 running 状态、未在本地流式中、且尚未尝试过 attach 时，
  // 自动发起 attach。覆盖 reception inbound 提交后后端启动后台流的场景。
  // **多路 SSE 活跃时跳过**：multi-attach 已提供实时流式，不需要单路 attach。
  useEffect(() => {
    if (!sessionId || !enabled || !enableWriters) return;
    if (sessionStateStatus !== 'running') return;
    if (streamingRef.current) return;
    if (attachAttemptedSessionRef.current === sessionId) return;
    if (multiAttachActive) return; // 多路 SSE 已接管，跳过单路 attach
    // 延迟 500ms 再尝试 attach——后端 runSessionInBackground 是 fire-and-forget，
    // 需要一点时间让活跃流注册到 session_run_events 总线。
    const timer = setTimeout(() => {
      void attachToSessionStream();
    }, 500);
    return () => clearTimeout(timer);
  }, [
    sessionId,
    enabled,
    enableWriters,
    sessionStateStatus,
    attachToSessionStream,
    multiAttachActive,
  ]);

  // ─── 多路 SSE 注册：把 stream.handleEvent 注册到 multi-attach store ──
  // 当 useMultiSessionAttach 为此 session 建立了 SSE 连接时，收到的
  // RunEvent 会通过 dispatchEvent 转发到这里注册的 handleEvent，实现
  // 非聚焦 session 的逐 token 流式渲染。
  // 只在 session 处于 running 状态、且没有本地 stream / 单路 attach 活跃时
  // 注册——避免与 startStream / attachToSessionStream 产生重复事件。
  useEffect(() => {
    if (!sessionId || !enabled) return undefined;

    // Check if multi-attach is connected for this session
    const checkAndRegister = () => {
      const status = useMultiAttachStore.getState().sessions.get(sessionId);
      const isAttached = status?.state === 'connected';

      if (isAttached && !streamingRef.current && !multiAttachActiveRef.current) {
        // Multi-attach is active and we're not locally streaming — register
        multiAttachActiveRef.current = true;
        setMultiAttachActive(true);
        // Pre-allocate assistant stream message id for accumulation
        if (!currentAssistantStreamMessageIdRef.current) {
          currentAssistantStreamMessageIdRef.current = makeOrderedMessageId();
        }
        stream.resetRoundAccumulators();
        if (!streamingRef.current) {
          setStreaming(true);
          streamingRef.current = true;
          setActiveStreamStartedAt(Date.now());
          setActiveStreamFirstTokenLatencyMs(null);
        }
      } else if (!isAttached && multiAttachActiveRef.current) {
        // Multi-attach disconnected — unregister
        multiAttachActiveRef.current = false;
        setMultiAttachActive(false);
        if (streamingRef.current) {
          streamingRef.current = false;
          setStreaming(false);
          setActiveStreamStartedAt(null);
        }
      }
    };

    checkAndRegister();

    // Subscribe to multi-attach store changes
    const unsubMultiAttach = useMultiAttachStore.subscribe(checkAndRegister);

    // Register handleEvent callback
    const handleMultiAttachEvent = (
      event: RunEvent,
      meta: { rowId: number; clientRequestId?: string },
    ) => {
      // Skip if we're locally streaming via startStream (user-initiated)
      // but NOT if we're streaming via multi-attach itself.
      if (streamingRef.current && !multiAttachActiveRef.current) return;
      const multiAttachRid = meta.clientRequestId?.trim();
      if (multiAttachRid) {
        streamClientRequestIdRef.current = multiAttachRid;
      }
      stream.handleEvent(event);
    };

    const unregisterHandler = useMultiAttachStore
      .getState()
      .registerHandler(sessionId, handleMultiAttachEvent);

    return () => {
      unsubMultiAttach();
      unregisterHandler();
      multiAttachActiveRef.current = false;
      setMultiAttachActive(false);
    };
  }, [
    sessionId,
    enabled,
    stream,
    streamingRef,
    currentAssistantStreamMessageIdRef,
    setStreaming,
    setActiveStreamStartedAt,
    setActiveStreamFirstTokenLatencyMs,
  ]);

  // ─── 子 session 流式：为 childSessions 中 running 的子 session 注册 handler ──
  // multi-attach SSE 会为所有 running session 建立连接并接收 RunEvent，
  // 但默认只有当前聚焦 session 注册了 handler。子 session (executor/reviewer)
  // 的流式 token 事件会被 multi-attach-store 接收但无 handler 消费，被丢弃。
  // 这里为每个 running 子 session 注册一个简化的 handler，将 text_delta
  // 累积到 childSessions 对应项的流式消息中，实现子 session 的实时流式展示。
  const childStreamBuffersRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    // 找出所有可能是 running 的子 session（executor/reviewer/pm1/pm2 层级）
    const runningChildren = childSessions.filter(
      (child) =>
        child.role_layer === 'executor' ||
        child.role_layer === 'reviewer' ||
        child.role_layer === 'pm1' ||
        child.role_layer === 'pm2',
    );
    if (runningChildren.length === 0) return undefined;

    const unregisters: Array<() => void> = [];

    for (const child of runningChildren) {
      const childSessionId = child.id;
      const streamingMsgId = `streaming:${childSessionId}`;

      const handleChildEvent = (
        event: RunEvent,
        _meta: { rowId: number; clientRequestId?: string },
      ) => {
        if (event.type === 'text_delta' && typeof event.delta === 'string') {
          // 累积流式文本到 per-child buffer
          const buffers = childStreamBuffersRef.current;
          const current = buffers.get(childSessionId) ?? '';
          buffers.set(childSessionId, current + event.delta);
          const buffer = buffers.get(childSessionId) ?? '';

          // 更新 childSessions：在对应子 session 的 messages 末尾
          // 追加或更新一条流式 assistant 消息
          setChildSessions((prev) =>
            prev.map((cs) => {
              if (cs.id !== childSessionId) return cs;
              const existingMessages = cs.messages ?? [];
              // 检查最后一条消息是否是我们的流式消息
              const lastMsg = existingMessages[existingMessages.length - 1];
              if (lastMsg && lastMsg.id === streamingMsgId) {
                // 更新已有的流式消息
                const updatedMessages = [...existingMessages];
                updatedMessages[updatedMessages.length - 1] = {
                  ...lastMsg,
                  content: buffer,
                };
                return { ...cs, messages: updatedMessages };
              }
              // 追加新的流式消息
              return {
                ...cs,
                messages: [
                  ...existingMessages,
                  {
                    id: streamingMsgId,
                    role: 'assistant' as const,
                    content: buffer,
                    createdAt: Date.now(),
                  } as ChatMessage,
                ],
              };
            }),
          );
        }
      };

      const unregister = useMultiAttachStore
        .getState()
        .registerHandler(childSessionId, handleChildEvent);
      unregisters.push(unregister);
    }

    return () => {
      for (const unregister of unregisters) {
        unregister();
      }
    };
  }, [childSessions.length, childSessions.map((c) => c.id).join(',')]);

  const replyPermission: TeamConversationState['replyPermission'] = useCallback(
    async (requestId, decision, options) => {
      if (!sessionId || !token) {
        throw new Error('当前团队会话或登录状态无效，无法处理权限请求。');
      }
      const targetSessionId = options?.targetSessionId ?? sessionId;
      await replyPermissionRequest({
        gatewayUrl,
        requestId,
        decision,
        ...(options?.alwaysOverride ? { alwaysOverride: options.alwaysOverride } : {}),
        ...(options?.feedback ? { feedback: options.feedback } : {}),
        sessionId: targetSessionId,
        token,
      });
      if (decision !== 'reject' && targetSessionId === sessionId) {
        attachAttemptedSessionRef.current = null;
        attachRetryCountRef.current = 0;
        setSessionStateStatus('running');
        void reload();
      } else if (decision !== 'reject') {
        const layerStore = useLayerStore.getState();
        const existingNode = layerStore.nodes.get(targetSessionId);
        if (existingNode) {
          layerStore.updateNodeState(targetSessionId, 'running');
        } else {
          const childSession = childSessions.find((child) => child.id === targetSessionId);
          const childRoleLayer = toTeamRoleLayer(childSession?.role_layer);
          if (childRoleLayer) {
            layerStore.addNode({
              sessionId: targetSessionId,
              roleLayer: childRoleLayer,
              parentSessionId: sessionId,
              state: 'running',
            });
          }
        }
        void reload();
      }
      // Optimistically remove from pending list; the permission_replied event
      // will also clear on receipt.
      setPendingPermissions((prev) => prev.filter((p) => p.requestId !== requestId));
    },
    [sessionId, token, gatewayUrl, reload, childSessions],
  );

  const replyQuestion: TeamConversationState['replyQuestion'] = useCallback(
    async (requestId, status, answers, options) => {
      if (!sessionId || !token) {
        throw new Error('当前团队会话或登录状态无效，无法处理提问请求。');
      }
      await createQuestionsClient(gatewayUrl).reply(token, options?.targetSessionId ?? sessionId, {
        requestId,
        status,
        ...(answers ? { answers } : {}),
      });
      setPendingQuestions((prev) => prev.filter((q) => q.requestId !== requestId));
    },
    [enableWriters, sessionId, token, gatewayUrl],
  );

  return {
    startStream,
    stopStream,
    attachToSessionStream,
    submitInbound,
    replyPermission,
    replyQuestion,
  };
}
