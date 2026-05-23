import type {
  ChatMessage,
  ChatMessagePart,
} from '../../../../components/conversation-runtime/messages/support.js';
import {
  estimateTokenCount,
  replaceOrAppendStreamedAssistantMessage,
} from '../../../../components/conversation-runtime/messages/support.js';
import { makeOrderedMessageId } from '../../../../components/conversation-runtime/messages/ordered-id.js';
import type { StreamingThinkingBlock } from '../../../../components/conversation-runtime/stream/streaming-thinking.js';
import type { LiveToolCallState } from './chat-page-utils.js';

export interface CommitStreamingRoundOptions {
  accumulated: string;
  accumulatedSegments: ChatMessagePart[];
  accumulatedThinking: string;
  accumulatedThinkingBlocks: StreamingThinkingBlock[];
  buildTraceMessage: (
    messageId: string,
    textContent: string,
  ) => {
    content: string;
    parts: ChatMessagePart[];
    reasoningBlocksEndedFlags?: boolean[];
    reasoningBlocksDurationsMs?: number[];
  };
  currentAssistantStreamMessageIdRef: React.MutableRefObject<string | null>;
  currentRoundStartedAt: number;
  firstTokenLatencyAttached: boolean;
  firstTokenObservedAt: number | null;
  liveToolCalls: Map<string, LiveToolCallState>;
  requestAgentId?: string;
  requestModelLabel?: string;
  requestProviderId?: string;
  requestStartedAt: number;
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  setStreamBuffer: React.Dispatch<React.SetStateAction<string>>;
  setStreamThinkingBlocks: React.Dispatch<React.SetStateAction<StreamingThinkingBlock[]>>;
  setStreamThinkingBuffer: React.Dispatch<React.SetStateAction<string>>;
  setStreamingSegments: React.Dispatch<React.SetStateAction<ChatMessagePart[]>>;
  streamRevealNextAllowedAtRef: React.MutableRefObject<number>;
  streamRevealTargetCodePointsRef: React.MutableRefObject<string[]>;
  streamRevealTargetRef: React.MutableRefObject<string>;
  streamRevealVisibleCodePointCountRef: React.MutableRefObject<number>;
  streamRevealVisibleRef: React.MutableRefObject<string>;
  timestamp: number;
}

export interface CommitStreamingRoundResult {
  accumulated: string;
  accumulatedSegments: ChatMessagePart[];
  accumulatedThinking: string;
  accumulatedThinkingBlocks: StreamingThinkingBlock[];
  currentRoundStartedAt: number;
  firstTokenLatencyAttached: boolean;
}

export function commitStreamingRound(
  options: CommitStreamingRoundOptions,
): CommitStreamingRoundResult | null {
  const {
    accumulated,
    accumulatedSegments,
    accumulatedThinking,
    accumulatedThinkingBlocks,
    buildTraceMessage,
    currentAssistantStreamMessageIdRef,
    currentRoundStartedAt,
    firstTokenLatencyAttached,
    firstTokenObservedAt,
    liveToolCalls,
    requestAgentId,
    requestModelLabel,
    requestProviderId,
    requestStartedAt,
    setMessages,
    setStreamBuffer,
    setStreamThinkingBlocks,
    setStreamThinkingBuffer,
    setStreamingSegments,
    streamRevealNextAllowedAtRef,
    streamRevealTargetCodePointsRef,
    streamRevealTargetRef,
    streamRevealVisibleCodePointCountRef,
    streamRevealVisibleRef,
    timestamp,
  } = options;

  const closingMessageId = currentAssistantStreamMessageIdRef.current;
  if (!closingMessageId) return null;
  if (
    liveToolCalls.size === 0 &&
    accumulatedThinking.trim().length === 0 &&
    accumulated.trim().length === 0
  ) {
    return null;
  }

  const {
    content,
    parts: legacyParts,
    reasoningBlocksEndedFlags,
    reasoningBlocksDurationsMs,
  } = buildTraceMessage(closingMessageId, accumulated);
  const parts = accumulatedSegments.length > 0 ? accumulatedSegments : legacyParts;
  const roundToolCallIds = new Set(liveToolCalls.keys());
  const shouldAttachFirstTokenLatency = firstTokenObservedAt !== null && !firstTokenLatencyAttached;

  setMessages((prev) =>
    replaceOrAppendStreamedAssistantMessage(
      prev,
      {
        id: closingMessageId,
        role: 'assistant',
        content,
        parts,
        ...(reasoningBlocksEndedFlags ? { reasoningBlocksEndedFlags } : {}),
        ...(reasoningBlocksDurationsMs ? { reasoningBlocksDurationsMs } : {}),
        createdAt: timestamp,
        durationMs: timestamp - currentRoundStartedAt,
        tokenEstimate: estimateTokenCount(
          [accumulatedThinking, accumulated].filter((item) => item.trim().length > 0).join('\n\n'),
        ),
        toolCallCount: roundToolCallIds.size,
        providerId: requestProviderId,
        model: requestModelLabel,
        agentId: requestAgentId,
        ...(shouldAttachFirstTokenLatency && firstTokenObservedAt !== null
          ? { firstTokenLatencyMs: firstTokenObservedAt - requestStartedAt }
          : {}),
        status: 'completed',
      },
      roundToolCallIds,
    ),
  );

  setStreamBuffer('');
  setStreamThinkingBuffer('');
  setStreamingSegments([]);
  setStreamThinkingBlocks([]);
  streamRevealTargetRef.current = '';
  streamRevealVisibleRef.current = '';
  streamRevealTargetCodePointsRef.current = [];
  streamRevealVisibleCodePointCountRef.current = 0;
  streamRevealNextAllowedAtRef.current = 0;
  currentAssistantStreamMessageIdRef.current = makeOrderedMessageId();

  return {
    accumulated: '',
    accumulatedSegments: [],
    accumulatedThinking: '',
    accumulatedThinkingBlocks: [],
    currentRoundStartedAt: timestamp,
    firstTokenLatencyAttached: shouldAttachFirstTokenLatency ? true : firstTokenLatencyAttached,
  };
}
