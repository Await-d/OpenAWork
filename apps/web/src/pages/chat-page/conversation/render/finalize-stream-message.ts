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
  status: 'completed' | 'error' | 'cancelled';
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
  const alignedReasoningMetadata = alignReasoningMetadata(
    parts,
    reasoningBlocksEndedFlags,
    reasoningBlocksDurationsMs,
  );
  const shouldAttachFirstTokenLatency = firstTokenObservedAt !== null && !firstTokenLatencyAttached;

  setMessages((prev) =>
    replaceOrAppendStreamedAssistantMessage(
      prev,
      {
        id: messageId,
        role: 'assistant',
        content,
        parts,
        ...(alignedReasoningMetadata.endedFlags
          ? { reasoningBlocksEndedFlags: alignedReasoningMetadata.endedFlags }
          : {}),
        ...(alignedReasoningMetadata.durationsMs
          ? { reasoningBlocksDurationsMs: alignedReasoningMetadata.durationsMs }
          : {}),
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

function alignReasoningMetadata(
  parts: ChatMessagePart[],
  endedFlags: boolean[] | undefined,
  durationsMs: number[] | undefined,
): { endedFlags?: boolean[]; durationsMs?: number[] } {
  const reasoningParts = parts.filter((part) => part.type === 'reasoning');
  if (reasoningParts.length === 0) return {};
  if (
    reasoningParts.length === (endedFlags?.length ?? 0) &&
    reasoningParts.length === (durationsMs?.length ?? 0)
  ) {
    return { endedFlags, durationsMs };
  }
  const hasPartTiming = reasoningParts.some(
    (part) => typeof part.startedAt === 'number' || typeof part.endedAt === 'number',
  );
  if (!hasPartTiming) return {};
  return {
    endedFlags: reasoningParts.map((part) => part.endedAt !== undefined),
    durationsMs: reasoningParts.map((part) =>
      typeof part.startedAt === 'number' &&
      typeof part.endedAt === 'number' &&
      part.endedAt >= part.startedAt
        ? part.endedAt - part.startedAt
        : -1,
    ),
  };
}
