import type { PendingPermissionRequest } from '@openAwork/web-client';
import { useMemo } from 'react';
import {
  renderChatMessageContentWithOptions,
  renderStreamingChatMessageContentWithOptions,
} from '../../chat/ChatPageSections.js';
import type {
  ChatRenderAction,
  ChatRenderEntry,
  ChatRenderGroup,
} from '../../chat/chat-message-group-list.js';
import type { ToolCallCardModel } from '../../../pages/chat-stream-state.js';
import type { ModelPriceEntry } from './chat-page-utils.js';
import {
  decorateAssistantGroupActions,
  groupChatRenderEntries,
  resolveModelPriceEntry,
} from './chat-page-utils.js';
import { mergeStreamingEntryIntoHistoricalEntries } from './chat-render-merge.js';
import { buildChatContextUsageSnapshot, type ChatContextUsageSnapshot } from './context-usage.js';
import type { ChatBackendUsageSnapshot } from './stream-usage.js';
import { hasUsableReportedUsageSnapshot } from './stream-usage.js';
import type { ChatMessage, ChatMessagePart, ChatUsageDetails } from './support.js';
import {
  clearResolvedPendingPermissionFromMessage,
  createAssistantTraceContent,
  estimateTokenCount,
  partsFromAssistantTrace,
  readAssistantTracePayload,
} from './support.js';
import type { TaskToolRuntimeLookup } from './task-tool-runtime.js';
import { shouldShowMessageInTranscript } from './transcript-visibility.js';

export interface ChatRenderDataInput {
  messages: ChatMessage[];
  pendingPermissions: PendingPermissionRequest[];
  modelPrices: ModelPriceEntry[];
  activeProviderId: string;
  activeModelId: string;
  activeModelOption: { id: string; label: string; contextWindow?: number } | undefined;
  visibleStreaming: boolean;
  visibleStreamBuffer: string;
  visibleStreamThinkingBuffer: string;
  visibleStreamThinkingBlocks: string[];
  visibleStreamStartedAt: number | null;
  visibleReportedStreamUsage: ChatBackendUsageSnapshot | null;
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
        const totalTokens = providerUsage?.totalTokens ?? inputTokens + outputTokens;
        const matchedPrice = resolveModelPriceEntry(modelPrices, [
          message.model,
          activeModelId,
          activeModelOption?.label,
        ]);
        const estimatedCostUsd = matchedPrice
          ? (inputTokens * matchedPrice.inputPer1m + outputTokens * matchedPrice.outputPer1m) /
            1_000_000
          : undefined;

        usageByMessageId.set(message.id, {
          requestIndex,
          inputTokens,
          outputTokens,
          totalTokens,
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
    return messages.reduce((sum, message) => {
      return sum + (message.tokenEstimate ?? estimateTokenCount(message.content));
    }, 0);
  }, [messages]);

  const latestHistoricalProviderTokens = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message?.role === 'assistant' && message.providerUsage) {
        return message.providerUsage.totalTokens;
      }
    }

    return undefined;
  }, [messages]);

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

  const streamingUsageDetails = useMemo<ChatUsageDetails | undefined>(() => {
    if (!visibleStreaming || (visibleStreamBuffer.length === 0 && !effectiveReportedStreamUsage)) {
      return undefined;
    }

    const inputTokens = effectiveReportedStreamUsage?.inputTokens ?? messageInputTokens;
    const outputTokens = effectiveReportedStreamUsage?.outputTokens ?? streamingOutputTokens;
    const totalTokens = effectiveReportedStreamUsage?.totalTokens ?? inputTokens + outputTokens;
    const matchedPrice = resolveModelPriceEntry(modelPrices, [
      activeModelId,
      activeModelOption?.label,
    ]);
    const estimatedCostUsd = matchedPrice
      ? (inputTokens * matchedPrice.inputPer1m + outputTokens * matchedPrice.outputPer1m) /
        1_000_000
      : undefined;
    const activeDurationMs = visibleStreamStartedAt
      ? Date.now() - visibleStreamStartedAt
      : undefined;

    return {
      requestIndex: assistantUsageDetails.size + 1,
      inputTokens,
      outputTokens,
      totalTokens,
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
        contextWindow: activeModelOption?.contextWindow,
        historicalTokens: latestHistoricalProviderTokens ?? messageInputTokens,
        reportedTotalTokens: effectiveReportedStreamUsage?.totalTokens,
        streamingTotalTokens: streamingUsageDetails?.totalTokens,
      }),
    [
      activeModelOption?.contextWindow,
      effectiveReportedStreamUsage?.totalTokens,
      latestHistoricalProviderTokens,
      messageInputTokens,
      streamingUsageDetails?.totalTokens,
    ],
  );

  const sanitizedHistoricalMessages = useMemo(() => {
    const activePendingPermissionIds = new Set(
      pendingPermissions
        .filter((permission) => permission.status === 'pending')
        .map((permission) => permission.requestId),
    );

    return messages.flatMap((message) => {
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
    return visibleMessages.map((message) => ({
      message,
      actions: buildMessageActions(message),
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
        content:
          toolCallCards.length > 0 || visibleStreamThinkingBuffer.trim().length > 0
            ? createAssistantTraceContent({
                ...(visibleStreamThinkingBlocks.length > 0
                  ? { reasoningBlocks: visibleStreamThinkingBlocks }
                  : {}),
                text: visibleStreamBuffer,
                toolCalls: toolCallCards.map((toolCall) => ({
                  kind: resolveAssistantCapabilityKind(toolCall.toolName) as
                    | 'tool'
                    | 'agent'
                    | 'skill'
                    | 'mcp'
                    | undefined,
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
                      | 'tool'
                      | 'agent'
                      | 'skill'
                      | 'mcp'
                      | undefined,
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
    );

    if (mergedEntries === historicalRenderedMessageEntries) {
      return historicalGroupedMessageEntries;
    }

    return groupChatRenderEntries(mergedEntries).map((group) =>
      decorateAssistantGroupActions(group, handleCopyMessageGroup),
    );
  }, [
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
    sanitizedHistoricalMessages,
    hiddenMessageCount,
    historicalRenderedMessageEntries,
    streamingRenderedMessageEntry,
    historicalGroupedMessageEntries,
    groupedMessageEntries,
  };
}
