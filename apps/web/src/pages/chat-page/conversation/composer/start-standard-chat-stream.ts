import type { InputImageContent } from '@openAwork/shared';
import type { ChatMessage } from '../../../../components/conversation-runtime/messages/support.js';
import { estimateTokenCount } from '../../../../components/conversation-runtime/messages/support.js';
import { makeOrderedMessageId } from '../../../../components/conversation-runtime/messages/ordered-id.js';
import type { ChatBackendUsageSnapshot } from '../../../../components/conversation-runtime/stream/stream-usage.js';
import type { StreamingThinkingBlock } from '../../../../components/conversation-runtime/stream/streaming-thinking.js';

export interface StartStandardChatStreamOptions {
  currentAssistantStreamMessageIdRef: React.MutableRefObject<string | null>;
  isNearBottomRef: React.MutableRefObject<boolean>;
  localRequestInputParts?: InputImageContent[];
  onQueuedMessageConsumed: () => void;
  requestInputParts?: InputImageContent[];
  setActiveStreamFirstTokenLatencyMs: React.Dispatch<React.SetStateAction<number | null>>;
  setActiveStreamStartedAt: React.Dispatch<React.SetStateAction<number | null>>;
  setHasPendingFollowContent: React.Dispatch<React.SetStateAction<boolean>>;
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  setReportedStreamUsage: React.Dispatch<React.SetStateAction<ChatBackendUsageSnapshot | null>>;
  setSessionStateStatus: React.Dispatch<
    React.SetStateAction<'running' | 'paused' | 'idle' | null | undefined>
  >;
  setShowScrollToBottom: React.Dispatch<React.SetStateAction<boolean>>;
  setStoppingStream: React.Dispatch<React.SetStateAction<boolean>>;
  setStreamBuffer: React.Dispatch<React.SetStateAction<string>>;
  setStreamThinkingBlocks: React.Dispatch<React.SetStateAction<StreamingThinkingBlock[]>>;
  setStreamThinkingBuffer: React.Dispatch<React.SetStateAction<string>>;
  setStreaming: React.Dispatch<React.SetStateAction<boolean>>;
  stoppingStreamRef: React.MutableRefObject<boolean>;
  streamRevealNextAllowedAtRef: React.MutableRefObject<number>;
  streamRevealTargetCodePointsRef: React.MutableRefObject<string[]>;
  streamRevealTargetRef: React.MutableRefObject<string>;
  streamRevealVisibleCodePointCountRef: React.MutableRefObject<number>;
  streamRevealVisibleRef: React.MutableRefObject<string>;
  streamingRef: React.MutableRefObject<boolean>;
  text: string;
}

export interface StartedStandardChatStream {
  displayMessageForStream: string;
  requestStartedAt: number;
  requestText: string;
}

export function startStandardChatStream(
  options: StartStandardChatStreamOptions,
): StartedStandardChatStream {
  const {
    currentAssistantStreamMessageIdRef,
    isNearBottomRef,
    localRequestInputParts,
    onQueuedMessageConsumed,
    requestInputParts,
    setActiveStreamFirstTokenLatencyMs,
    setActiveStreamStartedAt,
    setHasPendingFollowContent,
    setMessages,
    setReportedStreamUsage,
    setSessionStateStatus,
    setShowScrollToBottom,
    setStoppingStream,
    setStreamBuffer,
    setStreamThinkingBlocks,
    setStreamThinkingBuffer,
    setStreaming,
    stoppingStreamRef,
    streamRevealNextAllowedAtRef,
    streamRevealTargetCodePointsRef,
    streamRevealTargetRef,
    streamRevealVisibleCodePointCountRef,
    streamRevealVisibleRef,
    streamingRef,
    text,
  } = options;

  currentAssistantStreamMessageIdRef.current = makeOrderedMessageId();
  streamingRef.current = true;
  stoppingStreamRef.current = false;
  streamRevealTargetRef.current = '';
  streamRevealVisibleRef.current = '';
  streamRevealTargetCodePointsRef.current = [];
  streamRevealVisibleCodePointCountRef.current = 0;
  streamRevealNextAllowedAtRef.current = 0;
  isNearBottomRef.current = true;

  const requestStartedAt = Date.now();
  setStreaming(true);
  setStoppingStream(false);
  setSessionStateStatus('running');
  setReportedStreamUsage(null);
  setStreamBuffer('');
  setStreamThinkingBuffer('');
  setStreamThinkingBlocks([]);
  setHasPendingFollowContent(false);
  setShowScrollToBottom(false);
  setActiveStreamStartedAt(requestStartedAt);
  setActiveStreamFirstTokenLatencyMs(null);

  const userRawContent: Array<{ type: 'text'; text: string } | InputImageContent> = [
    ...(text.length > 0 ? [{ type: 'text' as const, text }] : []),
    ...(localRequestInputParts ?? requestInputParts ?? []),
  ];
  const displayMessageForStream =
    text.length > 0
      ? text
      : requestInputParts && requestInputParts.length > 0
        ? `上传了 ${requestInputParts.length} 张图片`
        : text;

  setMessages((prev) => [
    ...prev,
    {
      id: makeOrderedMessageId(),
      role: 'user',
      content: text,
      rawContent: userRawContent,
      createdAt: requestStartedAt,
      tokenEstimate: estimateTokenCount(text),
      status: 'completed',
    },
  ]);

  onQueuedMessageConsumed();

  return {
    displayMessageForStream,
    requestStartedAt,
    requestText: text,
  };
}
