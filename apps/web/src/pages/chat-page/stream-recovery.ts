import type { ModifiedFilesSummaryContent, RunEvent } from '@openAwork/shared';
import type { SessionStateStatus } from './session-runtime.js';
import {
  readAssistantTracePayload,
  type AssistantTraceToolCall,
  type ChatMessage,
} from './support.js';
import { mergeChatBackendUsageSnapshot, type ChatBackendUsageSnapshot } from './stream-usage.js';
import {
  appendStreamingThinkingChunk,
  markStreamingThinkingChunkEnded,
  type StreamingThinkingBlock,
} from './streaming-thinking.js';

export interface RecoveredActiveAssistantStream {
  messageId: string | null;
  modifiedFilesSummary?: ModifiedFilesSummaryContent;
  startedAt: number | null;
  text: string;
  thinkingBlocks: StreamingThinkingBlock[];
  toolCalls: AssistantTraceToolCall[];
  usage: ChatBackendUsageSnapshot | null;
}

interface RecoverActiveAssistantStreamInput {
  activeStreamStartedAt?: number | null;
  hasActiveStream?: boolean;
  messages: ChatMessage[];
  runEvents: RunEvent[];
  sessionStateStatus: SessionStateStatus | null;
}

function isRecoverableSessionStatus(
  status: SessionStateStatus | null,
): status is Extract<SessionStateStatus, 'paused' | 'running'> {
  return status === 'running' || status === 'paused';
}

function isTerminalRunEvent(event: RunEvent): boolean {
  return event.type === 'done' || event.type === 'error';
}

function hasTextOverlap(left: string, right: string): boolean {
  const normalizedLeft = left.trim();
  const normalizedRight = right.trim();
  if (normalizedLeft.length === 0 || normalizedRight.length === 0) {
    return false;
  }

  return (
    normalizedLeft === normalizedRight ||
    normalizedLeft.startsWith(normalizedRight) ||
    normalizedRight.startsWith(normalizedLeft)
  );
}

function findRecoveredAssistantAnchor(input: {
  activeToolCallIds: ReadonlySet<string>;
  messages: ChatMessage[];
  text: string;
  thinkingBlocks: StreamingThinkingBlock[];
}): {
  messageId: string;
  modifiedFilesSummary?: ModifiedFilesSummaryContent;
  toolCalls: AssistantTraceToolCall[];
} | null {
  const activeReasoningText = input.thinkingBlocks
    .map((block) => block.text)
    .join('\n')
    .trim();

  for (let index = input.messages.length - 1; index >= 0; index -= 1) {
    const message = input.messages[index];
    if (message?.role !== 'assistant') {
      continue;
    }

    const assistantTrace = readAssistantTracePayload(message);
    if (!assistantTrace) {
      continue;
    }

    const traceToolCallIds = new Set(
      assistantTrace.toolCalls.map((toolCall) => toolCall.toolCallId).filter(Boolean),
    );
    const hasToolOverlap =
      input.activeToolCallIds.size > 0 &&
      [...input.activeToolCallIds].some((toolCallId) => traceToolCallIds.has(toolCallId));
    const hasReasoningOverlap = hasTextOverlap(
      activeReasoningText,
      (assistantTrace.reasoningBlocks ?? []).join('\n'),
    );
    const matchesAnchor =
      hasToolOverlap || hasTextOverlap(input.text, assistantTrace.text) || hasReasoningOverlap;

    if (!matchesAnchor) {
      continue;
    }

    return {
      messageId: message.id,
      ...(assistantTrace.modifiedFilesSummary
        ? { modifiedFilesSummary: assistantTrace.modifiedFilesSummary }
        : {}),
      toolCalls: assistantTrace.toolCalls,
    };
  }

  return null;
}

export function recoverActiveAssistantStream(
  input: RecoverActiveAssistantStreamInput,
): RecoveredActiveAssistantStream | null {
  const hasActiveStream = input.hasActiveStream === true;
  if (input.runEvents.length === 0) {
    return null;
  }

  if (!hasActiveStream && !isRecoverableSessionStatus(input.sessionStateStatus)) {
    return null;
  }

  if (input.sessionStateStatus === 'paused' && !hasActiveStream) {
    return null;
  }

  const activeStreamStartedAt = hasActiveStream ? (input.activeStreamStartedAt ?? null) : null;

  const activeRunId = [...input.runEvents].reverse().find((event) => {
    if (typeof event.runId !== 'string' || event.runId.length === 0) {
      return false;
    }

    return (
      typeof event.occurredAt !== 'number' ||
      activeStreamStartedAt === null ||
      event.occurredAt >= activeStreamStartedAt
    );
  })?.runId;
  if (!activeRunId) {
    return null;
  }

  const activeRunEvents = input.runEvents.filter((event) => {
    if (event.runId !== activeRunId) {
      return false;
    }

    return (
      typeof event.occurredAt !== 'number' ||
      activeStreamStartedAt === null ||
      event.occurredAt >= activeStreamStartedAt
    );
  });
  const latestActiveRunEvent = activeRunEvents.at(-1);
  if (!latestActiveRunEvent || isTerminalRunEvent(latestActiveRunEvent)) {
    return null;
  }

  let text = '';
  let thinkingBlocks: StreamingThinkingBlock[] = [];
  let usage: ChatBackendUsageSnapshot | null = null;
  let startedAt: number | null = null;
  let hasRenderableContent = false;
  const activeToolCallIds = new Set<string>();

  for (const event of activeRunEvents) {
    if (startedAt === null && typeof event.occurredAt === 'number') {
      startedAt = event.occurredAt;
    }

    if (event.type === 'text_delta') {
      text += event.delta;
      hasRenderableContent = true;
      continue;
    }

    if (event.type === 'thinking_delta') {
      thinkingBlocks = appendStreamingThinkingChunk(thinkingBlocks, event);
      hasRenderableContent = true;
      continue;
    }

    if (event.type === 'thinking_end') {
      thinkingBlocks = markStreamingThinkingChunkEnded(thinkingBlocks, event);
      continue;
    }

    if (event.type === 'usage') {
      usage = mergeChatBackendUsageSnapshot(usage, event);
      continue;
    }

    if (event.type === 'tool_call_delta' || event.type === 'tool_result') {
      activeToolCallIds.add(event.toolCallId);
      hasRenderableContent = true;
    }
  }

  if (!hasRenderableContent) {
    return null;
  }

  const recoveredAssistantAnchor = findRecoveredAssistantAnchor({
    activeToolCallIds,
    messages: input.messages,
    text,
    thinkingBlocks,
  });

  return {
    messageId: recoveredAssistantAnchor?.messageId ?? null,
    ...(recoveredAssistantAnchor?.modifiedFilesSummary
      ? { modifiedFilesSummary: recoveredAssistantAnchor.modifiedFilesSummary }
      : {}),
    startedAt,
    text,
    thinkingBlocks,
    toolCalls: recoveredAssistantAnchor?.toolCalls ?? [],
    usage,
  };
}
