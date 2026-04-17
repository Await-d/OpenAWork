import { useMemo } from 'react';
import type { ChatMessage, ChatUsageDetails } from './support.js';
import {
  estimateTokenCount,
  parseAssistantTraceContent,
  clearResolvedPendingPermissionFromMessage,
  createAssistantTraceContent,
} from './support.js';
import { shouldShowMessageInTranscript } from './transcript-visibility.js';
import type {
  ChatRenderEntry,
  ChatRenderGroup,
  ChatRenderAction,
} from '../../components/chat/chat-message-group-list.js';
import type { ModelPriceEntry } from './chat-page-utils.js';
import {
  resolveModelPriceEntry,
  groupChatRenderEntries,
  decorateAssistantGroupActions,
} from './chat-page-utils.js';
import {
  renderChatMessageContentWithOptions,
  renderStreamingChatMessageContentWithOptions,
} from '../../components/chat/ChatPageSections.js';
import type { PendingPermissionRequest } from '@openAwork/web-client';
import type { ChatBackendUsageSnapshot } from './stream-usage.js';
import { hasUsableReportedUsageSnapshot } from './stream-usage.js';
import { buildChatContextUsageSnapshot, type ChatContextUsageSnapshot } from './context-usage.js';
import type { ToolCallCardModel } from '../chat-stream-state.js';
import type { TaskToolRuntimeLookup } from './task-tool-runtime.js';

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
  visibleStreamStartedAt: number | null;
  visibleReportedStreamUsage: ChatBackendUsageSnapshot | null;
  activeStreamFirstTokenLatencyMs: number | null;
  currentAssistantStreamMessageIdRef: React.MutableRefObject<string | null>;
  toolCallCards: ToolCallCardModel[];
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
}

export interface ChatRenderDataReturn {
  assistantUsageDetails: Map<string, ChatUsageDetails>;
  messageInputTokens: number;
  streamingOutputTokens: number;
  effectiveReportedStreamUsage: ChatBackendUsageSnapshot | undefined;
  streamingUsageDetails: ChatUsageDetails | undefined;
  contextUsageSnapshot: ChatContextUsageSnapshot | null;
  sanitizedHistoricalMessages: ChatMessage[];
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
  } = input;

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
        historicalTokens: messageInputTokens,
        reportedTotalTokens: effectiveReportedStreamUsage?.totalTokens,
        streamingTotalTokens: streamingUsageDetails?.totalTokens,
      }),
    [
      activeModelOption?.contextWindow,
      effectiveReportedStreamUsage?.totalTokens,
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
      const assistantTrace = parseAssistantTraceContent(message.content);
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

  const historicalRenderedMessageEntries = useMemo<ChatRenderEntry[]>(() => {
    return sanitizedHistoricalMessages.map((message) => ({
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
    sanitizedHistoricalMessages,
    taskToolRuntimeLookup,
  ]);

  const streamingRenderedMessageEntry = useMemo<ChatRenderEntry | null>(() => {
    if (!visibleStreaming) {
      return null;
    }

    return {
      message: {
        id: currentAssistantStreamMessageIdRef.current ?? '__streaming__',
        role: 'assistant',
        content:
          toolCallCards.length > 0 || visibleStreamThinkingBuffer.trim().length > 0
            ? createAssistantTraceContent({
                ...(visibleStreamThinkingBuffer.trim().length > 0
                  ? { reasoningBlocks: [visibleStreamThinkingBuffer] }
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
        status: 'streaming',
      },
      renderContent: (message: ChatMessage) =>
        renderStreamingChatMessageContentWithOptions(message.content, {
          onOpenChildSession: openChildSessionInspector,
          resolveInlinePermissionActions,
          selectedChildSessionId,
          taskRuntimeLookup: taskToolRuntimeLookup,
        }),
      usageDetails: streamingUsageDetails,
    };
  }, [
    activeModelId,
    activeModelOption?.label,
    activeProviderId,
    openChildSessionInspector,
    resolveInlinePermissionActions,
    resolveAssistantCapabilityKind,
    selectedChildSessionId,
    streamingUsageDetails,
    taskToolRuntimeLookup,
    toolCallCards,
    visibleStreamBuffer,
    visibleStreamStartedAt,
    visibleStreamThinkingBuffer,
    visibleStreaming,
    currentAssistantStreamMessageIdRef,
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

  return {
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
  };
}
