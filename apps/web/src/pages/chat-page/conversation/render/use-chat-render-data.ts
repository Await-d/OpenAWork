import type { PendingPermissionRequest } from '@openAwork/web-client';
import { useMemo } from 'react';
import {
  renderChatMessageContentWithOptions,
  renderStreamingChatMessageContentWithOptions,
} from '../../../../components/chat/session/ChatPageSections.js';
import type {
  ChatRenderAction,
  ChatRenderEntry,
  ChatRenderGroup,
} from '../../../../components/chat/message/chat-message-group-list.js';
import type { ToolCallCardModel } from '../../state/chat-stream-state.js';
import type { ModelPriceEntry } from './chat-page-utils.js';
import {
  decorateAssistantGroupActions,
  estimateModelUsageCost,
  groupChatRenderEntries,
  resolveModelPriceEntry,
} from './chat-page-utils.js';
import { mergeStreamingEntryIntoHistoricalEntries } from './chat-render-merge.js';
import {
  buildChatContextUsageSnapshot,
  resolveEffectiveContextWindow,
  type ChatContextUsageSnapshot,
} from '../../../../components/conversation-runtime/messages/context-usage.js';
import type { ChatBackendUsageSnapshot } from '../../../../components/conversation-runtime/stream/stream-usage.js';
import { hasUsableReportedUsageSnapshot } from '../../../../components/conversation-runtime/stream/stream-usage.js';
import type {
  ChatMessage,
  ChatMessagePart,
  ChatUsageDetails,
} from '../../../../components/conversation-runtime/messages/support.js';
import {
  clearResolvedPendingPermissionFromMessage,
  createAssistantTraceContent,
  deduplicateCompactionMessages,
  estimateContextMessageTokens,
  estimateTokenCount,
  filterChatMessagesForContext,
  partsFromAssistantTrace,
  readCompactionTranscriptState,
  readAssistantTracePayload,
} from '../../../../components/conversation-runtime/messages/support.js';
import type { TaskToolRuntimeLookup } from './task-tool-runtime.js';
import {
  isTranscriptCompactionMessage,
  shouldShowMessageInTranscript,
} from '../../../../components/conversation-runtime/messages/transcript-visibility.js';

export interface ChatRenderDataInput {
  messages: ChatMessage[];
  pendingPermissions: PendingPermissionRequest[];
  modelPrices: ModelPriceEntry[];
  activeProviderId: string;
  activeModelId: string;
  activeModelOption:
    | { id: string; label: string; contextWindow?: number; contextWindowOverride?: number }
    | undefined;
  visibleStreaming: boolean;
  visibleStreamBuffer: string;
  visibleStreamThinkingBuffer: string;
  visibleStreamThinkingBlocks: string[];
  visibleStreamStartedAt: number | null;
  visibleReportedStreamUsage: ChatBackendUsageSnapshot | null;
  activeStreamClientRequestId: string | null;
  activeStreamFirstTokenLatencyMs: number | null;
  activeStreamMessageId: string | null;
  toolCallCards: ToolCallCardModel[];
  /**
   * Ordered live-stream parts in wire-arrival order. When present and
   * non-empty, the streaming virtual message uses this as its `parts` so
   * the live render mirrors the gateway's true event sequence (rather than
   * the legacy reasoning → text → tool flattening).
   */
  streamingOrderedParts?: ChatMessagePart[];
  resolveAssistantCapabilityKind: (text: string | undefined) => string | undefined;
  resolveInlinePermissionActions?: (requestId: string) =>
    | {
        errorMessage?: string;
        helperMessage?: string;
        items: Array<{
          danger?: boolean;
          disabled?: boolean;
          hint?: string;
          id: string;
          label: string;
          onClick: () => void;
          primary?: boolean;
        }>;
        pendingLabel?: string;
      }
    | undefined;
  buildMessageActions: (message: ChatMessage) => ChatRenderAction[];
  handleCopyMessageGroup: (messages: ChatMessage[]) => void;
  openChildSessionInspector: (sessionId: string) => void;
  selectedChildSessionId: string | null;
  taskToolRuntimeLookup: TaskToolRuntimeLookup | undefined;
  visibleMessageCount?: number;
  serverTotalTurnCount?: number | null;
  /**
   * Inline stop control surfaced on the live-streaming assistant
   * message. The button label / wiring live alongside the existing
   * composer-level stop affordance — duplicating it next to the
   * streaming bubble dramatically improves discoverability for users
   * who don't know about the Esc shortcut.
   */
  stopCapability?: 'none' | 'precise' | 'best_effort' | 'observe_only';
  stoppingStream?: boolean;
  onStopActiveMessage?: () => void;
}

export interface ChatRenderDataReturn {
  assistantUsageDetails: Map<string, ChatUsageDetails>;
  messageInputTokens: number;
  streamingOutputTokens: number;
  effectiveReportedStreamUsage: ChatBackendUsageSnapshot | undefined;
  streamingUsageDetails: ChatUsageDetails | undefined;
  contextUsageSnapshot: ChatContextUsageSnapshot | null;
  effectiveContextMessageCount: number;
  sanitizedHistoricalMessages: ChatMessage[];
  hiddenMessageCount: number;
  historicalRenderedMessageEntries: ChatRenderEntry[];
  streamingRenderedMessageEntry: ChatRenderEntry | null;
  historicalGroupedMessageEntries: ChatRenderGroup[];
  groupedMessageEntries: ChatRenderGroup[];
}

export function useChatRenderData(input: ChatRenderDataInput): ChatRenderDataReturn {
  const {
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
    activeStreamClientRequestId,
    activeStreamFirstTokenLatencyMs,
    activeStreamMessageId,
    toolCallCards,
    stopCapability,
    stoppingStream = false,
    onStopActiveMessage,
    streamingOrderedParts,
    resolveAssistantCapabilityKind,
    resolveInlinePermissionActions,
    buildMessageActions,
    handleCopyMessageGroup,
    openChildSessionInspector,
    selectedChildSessionId,
    taskToolRuntimeLookup,
    visibleMessageCount,
    serverTotalTurnCount,
  } = input;

  const effectiveContextMessages = useMemo(
    () => filterChatMessagesForContext(messages),
    [messages],
  );

  const assistantUsageDetails = useMemo(() => {
    const usageByMessageId = new Map<string, ChatUsageDetails>();
    let contextTokens = 0;
    let requestIndex = 0;

    for (const message of messages) {
      const providerUsage = message.role === 'assistant' ? message.providerUsage : undefined;
      const messageTokens =
        providerUsage?.outputTokens ?? message.tokenEstimate ?? estimateTokenCount(message.content);

      if (message.role === 'assistant') {
        requestIndex += 1;
        const inputTokens = providerUsage?.inputTokens ?? contextTokens;
        const outputTokens = providerUsage?.outputTokens ?? messageTokens;
        const cacheReadTokens = providerUsage?.cacheReadTokens ?? 0;
        const cacheWriteTokens = providerUsage?.cacheWriteTokens ?? 0;
        const totalTokens = providerUsage?.totalTokens ?? inputTokens + outputTokens;
        const matchedPrice = resolveModelPriceEntry(modelPrices, [
          message.providerId ? `${message.providerId}/${message.model ?? ''}` : undefined,
          activeProviderId ? `${activeProviderId}/${activeModelId}` : undefined,
          message.model,
          activeModelId,
          activeModelOption?.label,
        ]);
        const estimatedCostUsd = matchedPrice
          ? estimateModelUsageCost({
              inputTokens,
              outputTokens,
              cacheReadTokens,
              cacheWriteTokens,
              price: matchedPrice,
            })
          : undefined;

        usageByMessageId.set(message.id, {
          requestIndex,
          inputTokens,
          outputTokens,
          totalTokens,
          cacheReadTokens,
          cacheWriteTokens,
          estimatedCostUsd,
          durationMs: message.durationMs,
          firstTokenLatencyMs: message.firstTokenLatencyMs,
          tokensPerSecond:
            message.durationMs && message.durationMs > 0
              ? outputTokens / (message.durationMs / 1000)
              : undefined,
        });
      }

      contextTokens += messageTokens;
    }

    return usageByMessageId;
  }, [activeModelId, activeModelOption?.label, messages, modelPrices]);

  const messageInputTokens = useMemo(() => {
    return effectiveContextMessages.reduce((sum, message) => {
      return sum + estimateContextMessageTokens(message);
    }, 0);
  }, [effectiveContextMessages]);

  const streamingOutputTokens = useMemo(() => {
    return visibleStreamBuffer.length > 0 ? estimateTokenCount(visibleStreamBuffer) : 0;
  }, [visibleStreamBuffer]);

  const effectiveReportedStreamUsage = useMemo(
    () =>
      hasUsableReportedUsageSnapshot(visibleReportedStreamUsage)
        ? visibleReportedStreamUsage
        : undefined,
    [visibleReportedStreamUsage],
  );

  const shouldPreferHistoricalContextEstimate = useMemo(() => {
    if (visibleStreaming) {
      return false;
    }

    let latestCompactionAt = -1;
    let latestUsageAssistantAt = -1;
    for (const message of messages) {
      const createdAt =
        typeof message.createdAt === 'number'
          ? message.createdAt
          : typeof message.createdAt === 'string'
            ? Date.parse(message.createdAt)
            : NaN;
      if (!Number.isFinite(createdAt)) {
        continue;
      }

      const compaction = readCompactionTranscriptState(message);
      if (compaction?.phase === 'completed') {
        latestCompactionAt = Math.max(latestCompactionAt, createdAt);
      }
      if (
        message.role === 'assistant' &&
        message.providerUsage &&
        message.providerUsage.totalTokens > 0
      ) {
        latestUsageAssistantAt = Math.max(latestUsageAssistantAt, createdAt);
      }
    }

    return latestCompactionAt >= 0 && latestCompactionAt >= latestUsageAssistantAt;
  }, [messages, visibleStreaming]);

  const streamingUsageDetails = useMemo<ChatUsageDetails | undefined>(() => {
    if (!visibleStreaming || (visibleStreamBuffer.length === 0 && !effectiveReportedStreamUsage)) {
      return undefined;
    }

    const inputTokens = effectiveReportedStreamUsage?.inputTokens ?? messageInputTokens;
    const outputTokens = effectiveReportedStreamUsage?.outputTokens ?? streamingOutputTokens;
    const cacheReadTokens = effectiveReportedStreamUsage?.cacheReadTokens ?? 0;
    const cacheWriteTokens = effectiveReportedStreamUsage?.cacheWriteTokens ?? 0;
    const totalTokens = effectiveReportedStreamUsage?.totalTokens ?? inputTokens + outputTokens;
    const matchedPrice = resolveModelPriceEntry(modelPrices, [
      activeProviderId ? `${activeProviderId}/${activeModelId}` : undefined,
      activeModelId,
      activeModelOption?.label,
    ]);
    const estimatedCostUsd = matchedPrice
      ? estimateModelUsageCost({
          inputTokens,
          outputTokens,
          cacheReadTokens,
          cacheWriteTokens,
          price: matchedPrice,
        })
      : undefined;
    const activeDurationMs = visibleStreamStartedAt
      ? Date.now() - visibleStreamStartedAt
      : undefined;

    return {
      requestIndex: assistantUsageDetails.size + 1,
      inputTokens,
      outputTokens,
      totalTokens,
      cacheReadTokens,
      cacheWriteTokens,
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
    assistantUsageDetails.size,
    effectiveReportedStreamUsage,
    messageInputTokens,
    modelPrices,
    streamingOutputTokens,
    visibleStreamBuffer.length,
    visibleStreamStartedAt,
    visibleStreaming,
  ]);

  const contextUsageSnapshot = useMemo(
    () =>
      buildChatContextUsageSnapshot({
        contextWindow: resolveEffectiveContextWindow(
          activeModelOption?.contextWindow,
          activeModelOption?.contextWindowOverride,
        ),
        historicalTokens: messageInputTokens,
        preferHistoricalEstimate: shouldPreferHistoricalContextEstimate,
        reportedTotalTokens: effectiveReportedStreamUsage?.totalTokens,
        streamingTotalTokens: streamingUsageDetails?.totalTokens,
      }),
    [
      activeModelOption?.contextWindow,
      activeModelOption?.contextWindowOverride,
      effectiveReportedStreamUsage?.totalTokens,
      messageInputTokens,
      shouldPreferHistoricalContextEstimate,
      streamingUsageDetails?.totalTokens,
    ],
  );

  const sanitizedHistoricalMessages = useMemo(() => {
    const activePendingPermissionIds = new Set(
      pendingPermissions
        .filter((permission) => permission.status === 'pending')
        .map((permission) => permission.requestId),
    );

    const visible = messages.flatMap((message) => {
      if (message.role !== 'assistant') {
        return [message];
      }

      let nextMessage: ChatMessage | null = message;
      const assistantTrace = readAssistantTracePayload(message);
      if (!assistantTrace) {
        return shouldShowMessageInTranscript(message) ? [message] : [];
      }

      const stalePendingPermissionIds = assistantTrace.toolCalls.flatMap((toolCall) =>
        toolCall.pendingPermissionRequestId &&
        !activePendingPermissionIds.has(toolCall.pendingPermissionRequestId)
          ? [toolCall.pendingPermissionRequestId]
          : [],
      );

      for (const requestId of stalePendingPermissionIds) {
        if (!nextMessage) {
          break;
        }
        nextMessage = clearResolvedPendingPermissionFromMessage(nextMessage, requestId);
      }

      if (!nextMessage || !shouldShowMessageInTranscript(nextMessage)) {
        return [];
      }

      return [nextMessage];
    });
    return deduplicateCompactionMessages(visible);
  }, [messages, pendingPermissions]);

  const visibleMessages = useMemo(() => {
    if (
      visibleMessageCount === undefined ||
      visibleMessageCount >= sanitizedHistoricalMessages.length
    ) {
      return sanitizedHistoricalMessages;
    }
    return sanitizedHistoricalMessages.slice(-visibleMessageCount);
  }, [sanitizedHistoricalMessages, visibleMessageCount]);

  const localHiddenCount = sanitizedHistoricalMessages.length - visibleMessages.length;
  const localUserMessageCount = useMemo(
    () => sanitizedHistoricalMessages.filter((m) => m.role === 'user').length,
    [sanitizedHistoricalMessages],
  );
  const serverUnloadedTurns =
    typeof serverTotalTurnCount === 'number' && serverTotalTurnCount > localUserMessageCount
      ? serverTotalTurnCount - localUserMessageCount
      : 0;
  const hiddenMessageCount = localHiddenCount + serverUnloadedTurns;

  const historicalRenderedMessageEntries = useMemo<ChatRenderEntry[]>(() => {
    // 先检测并移除重复消息
    const seenIds = new Set<string>();
    const deduplicatedMessages = visibleMessages.filter((message) => {
      if (seenIds.has(message.id)) {
        console.warn(
          `[ChatRender] 检测到重复消息 ID: ${message.id}, role: ${message.role}, 已自动过滤`,
        );
        return false;
      }
      seenIds.add(message.id);
      return true;
    });

    return deduplicatedMessages.map((message) => ({
      message,
      actions: buildMessageActions(message),
      // Keep compaction markers as their own visual group so they don't
      // collapse into the surrounding assistant turn bubbles.
      ...(isTranscriptCompactionMessage(message)
        ? { groupIdentityKey: `compaction:${message.id}` }
        : {}),
      renderContent: (currentMessage: ChatMessage) =>
        renderChatMessageContentWithOptions(currentMessage, {
          onOpenChildSession: openChildSessionInspector,
          resolveInlinePermissionActions,
          selectedChildSessionId,
          taskRuntimeLookup: taskToolRuntimeLookup,
        }),
      usageDetails: assistantUsageDetails.get(message.id),
    }));
  }, [
    assistantUsageDetails,
    buildMessageActions,
    openChildSessionInspector,
    resolveInlinePermissionActions,
    selectedChildSessionId,
    visibleMessages,
    taskToolRuntimeLookup,
  ]);

  const streamingRenderedMessageEntry = useMemo<ChatRenderEntry | null>(() => {
    if (!visibleStreaming) {
      return null;
    }

    return {
      message: {
        id: activeStreamMessageId ?? '__streaming__',
        role: 'assistant',
        ...(activeStreamClientRequestId ? { clientRequestId: activeStreamClientRequestId } : {}),
        content:
          toolCallCards.length > 0 || visibleStreamThinkingBuffer.trim().length > 0
            ? createAssistantTraceContent({
                ...(visibleStreamThinkingBlocks.length > 0
                  ? { reasoningBlocks: visibleStreamThinkingBlocks }
                  : {}),
                text: visibleStreamBuffer,
                toolCalls: toolCallCards.map((toolCall) => ({
                  kind: resolveAssistantCapabilityKind(toolCall.toolName) as
                    'tool' | 'agent' | 'skill' | 'mcp' | undefined,
                  toolCallId: toolCall.toolCallId,
                  toolName: toolCall.toolName,
                  input: toolCall.input as Record<string, unknown>,
                  output: toolCall.output,
                  isError: toolCall.isError,
                  pendingPermissionRequestId: toolCall.pendingPermissionRequestId,
                  resumedAfterApproval: toolCall.resumedAfterApproval,
                  status: toolCall.status,
                })),
              })
            : visibleStreamBuffer,
        model: (activeModelOption?.label ?? activeModelId) || undefined,
        providerId: activeProviderId || undefined,
        createdAt: visibleStreamStartedAt ?? Date.now(),
        tokenEstimate: estimateTokenCount(
          [visibleStreamThinkingBuffer, visibleStreamBuffer]
            .filter((item) => item.trim().length > 0)
            .join('\n\n'),
        ),
        toolCallCount: toolCallCards.length > 0 ? toolCallCards.length : undefined,
        // Prefer the wire-faithful ordered segments when ChatPage has been
        // accumulating them. This makes the live render preserve the true
        // event order (tool → text → tool, reasoning interleaved with tool
        // output, etc.) instead of the legacy reasoning → text → tool
        // flattening produced by `partsFromAssistantTrace`. The legacy
        // reorder is kept as a fallback so attach paths that haven't yet
        // populated segments still render something.
        parts:
          streamingOrderedParts && streamingOrderedParts.length > 0
            ? streamingOrderedParts
            : toolCallCards.length > 0 || visibleStreamThinkingBuffer.trim().length > 0
              ? partsFromAssistantTrace(activeStreamMessageId ?? '__streaming__', {
                  ...(visibleStreamThinkingBlocks.length > 0
                    ? { reasoningBlocks: visibleStreamThinkingBlocks }
                    : {}),
                  text: visibleStreamBuffer,
                  toolCalls: toolCallCards.map((toolCall) => ({
                    kind: resolveAssistantCapabilityKind(toolCall.toolName) as
                      'tool' | 'agent' | 'skill' | 'mcp' | undefined,
                    toolCallId: toolCall.toolCallId,
                    toolName: toolCall.toolName,
                    input: toolCall.input as Record<string, unknown>,
                    output: toolCall.output,
                    isError: toolCall.isError,
                    pendingPermissionRequestId: toolCall.pendingPermissionRequestId,
                    resumedAfterApproval: toolCall.resumedAfterApproval,
                    status: toolCall.status,
                  })),
                })
              : undefined,
        status: 'streaming',
      },
      renderContent: (message: ChatMessage) =>
        renderStreamingChatMessageContentWithOptions(message, {
          onOpenChildSession: openChildSessionInspector,
          resolveInlinePermissionActions,
          selectedChildSessionId,
          taskRuntimeLookup: taskToolRuntimeLookup,
        }),
      usageDetails: streamingUsageDetails,
      // Inline "stop" pill on the active streaming bubble. We only
      // expose it when the page actually owns a stoppable handle —
      // `precise` (current page is the originating client) and
      // `best_effort` (page joined an active session and can ask
      // the gateway to interrupt). `observe_only` and `none` would
      // surface a non-functional button so they're filtered out.
      ...(onStopActiveMessage && (stopCapability === 'precise' || stopCapability === 'best_effort')
        ? {
            actions: [
              {
                id: 'stop',
                label: stoppingStream ? '⏹ 正在停止…' : '⏹ 停止生成',
                title: stoppingStream
                  ? '正在向 Gateway 发送停止请求'
                  : '停止当前的助手响应（快捷键 Esc）',
                onClick: () => {
                  if (!stoppingStream) onStopActiveMessage();
                },
              },
            ],
          }
        : {}),
    };
  }, [
    activeStreamClientRequestId,
    activeModelId,
    activeModelOption?.label,
    activeProviderId,
    openChildSessionInspector,
    onStopActiveMessage,
    resolveInlinePermissionActions,
    resolveAssistantCapabilityKind,
    selectedChildSessionId,
    stopCapability,
    stoppingStream,
    streamingUsageDetails,
    streamingOrderedParts,
    taskToolRuntimeLookup,
    toolCallCards,
    visibleStreamBuffer,
    visibleStreamStartedAt,
    visibleStreamThinkingBuffer,
    visibleStreamThinkingBlocks,
    visibleStreaming,
    activeStreamMessageId,
  ]);

  const historicalGroupedMessageEntries = useMemo<ChatRenderGroup[]>(() => {
    return groupChatRenderEntries(historicalRenderedMessageEntries).map((group) =>
      decorateAssistantGroupActions(group, handleCopyMessageGroup),
    );
  }, [handleCopyMessageGroup, historicalRenderedMessageEntries]);

  const groupedMessageEntries = useMemo<ChatRenderGroup[]>(() => {
    const mergedEntries = mergeStreamingEntryIntoHistoricalEntries(
      historicalRenderedMessageEntries,
      streamingRenderedMessageEntry,
      activeStreamMessageId,
      activeStreamClientRequestId,
    );

    if (mergedEntries === historicalRenderedMessageEntries) {
      return historicalGroupedMessageEntries;
    }

    return groupChatRenderEntries(mergedEntries).map((group) =>
      decorateAssistantGroupActions(group, handleCopyMessageGroup),
    );
  }, [
    activeStreamClientRequestId,
    activeStreamMessageId,
    handleCopyMessageGroup,
    historicalGroupedMessageEntries,
    historicalRenderedMessageEntries,
    streamingRenderedMessageEntry,
  ]);

  return {
    assistantUsageDetails,
    messageInputTokens,
    streamingOutputTokens,
    effectiveReportedStreamUsage,
    streamingUsageDetails,
    contextUsageSnapshot,
    effectiveContextMessageCount: effectiveContextMessages.length,
    sanitizedHistoricalMessages,
    hiddenMessageCount,
    historicalRenderedMessageEntries,
    streamingRenderedMessageEntry,
    historicalGroupedMessageEntries,
    groupedMessageEntries,
  };
}
