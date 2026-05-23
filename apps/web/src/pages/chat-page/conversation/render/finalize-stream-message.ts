import type {
  ChatMessage,
  ChatMessagePart,
} from '../../../../components/conversation-runtime/messages/support.js';
import {
  estimateTokenCount,
  replaceOrAppendStreamedAssistantMessage,
} from '../../../../components/conversation-runtime/messages/support.js';

export interface FinalizeStreamMessageOptions {
  accumulatedSegments: ChatMessagePart[];
  accumulatedThinking: string;
  agentId?: string;
  buildTraceMessage: (
    messageId: string,
    textContent: string,
  ) => {
    content: string;
    parts: ChatMessagePart[];
    reasoningBlocksEndedFlags?: boolean[];
    reasoningBlocksDurationsMs?: number[];
  };
  contentText: string;
  createdAt: number;
  currentRoundStartedAt: number;
  firstTokenLatencyAttached: boolean;
  firstTokenObservedAt: number | null;
  messageId: string;
  model?: string;
  providerId?: string;
  requestStartedAt: number;
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  status: 'completed' | 'error';
  stopReason?: string;
  toolCallIds: Set<string>;
  traceFinalStatus?: 'completed' | 'error' | 'cancelled' | 'paused';
}

export interface FinalizeStreamMessageResult {
  firstTokenLatencyAttached: boolean;
}

export function finalizeStreamMessage(
  options: FinalizeStreamMessageOptions,
): FinalizeStreamMessageResult {
  const {
    accumulatedSegments,
    accumulatedThinking,
    agentId,
    buildTraceMessage,
    contentText,
    createdAt,
    currentRoundStartedAt,
    firstTokenLatencyAttached,
    firstTokenObservedAt,
    messageId,
    model,
    providerId,
    requestStartedAt,
    setMessages,
    status,
    stopReason,
    toolCallIds,
    traceFinalStatus,
  } = options;

  const {
    content,
    parts: legacyParts,
    reasoningBlocksEndedFlags,
    reasoningBlocksDurationsMs,
  } = buildTraceMessage(messageId, contentText);
  const parts = accumulatedSegments.length > 0 ? accumulatedSegments : legacyParts;
  const shouldAttachFirstTokenLatency = firstTokenObservedAt !== null && !firstTokenLatencyAttached;

  setMessages((prev) =>
    replaceOrAppendStreamedAssistantMessage(
      prev,
      {
        id: messageId,
        role: 'assistant',
        content,
        parts,
        ...(reasoningBlocksEndedFlags ? { reasoningBlocksEndedFlags } : {}),
        ...(reasoningBlocksDurationsMs ? { reasoningBlocksDurationsMs } : {}),
        createdAt,
        durationMs: createdAt - currentRoundStartedAt,
        ...(stopReason ? { stopReason } : {}),
        tokenEstimate: estimateTokenCount(
          [accumulatedThinking, contentText].filter((item) => item.trim().length > 0).join('\n\n'),
        ),
        toolCallCount: toolCallIds.size,
        providerId,
        model,
        agentId,
        ...(shouldAttachFirstTokenLatency && firstTokenObservedAt !== null
          ? { firstTokenLatencyMs: firstTokenObservedAt - requestStartedAt }
          : {}),
        status,
      },
      toolCallIds,
    ),
  );

  return {
    firstTokenLatencyAttached: shouldAttachFirstTokenLatency ? true : firstTokenLatencyAttached,
  };
}
