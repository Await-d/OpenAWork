import type { ModifiedFilesSummaryContent } from '@openAwork/shared';
import type { ChatMessagePart } from '../../../../components/conversation-runtime/messages/support.js';
import {
  partsFromAssistantTrace,
  type AssistantTraceToolCall,
} from '../../../../components/conversation-runtime/messages/support.js';
import type { StreamingThinkingBlock } from '../../../../components/conversation-runtime/stream/streaming-thinking.js';
import {
  extractStreamingThinkingDurations,
  extractStreamingThinkingEndedFlags,
  extractStreamingThinkingTexts,
} from '../../../../components/conversation-runtime/stream/streaming-thinking.js';
import {
  hasActivePendingPermissionRequest,
  parseToolCallInputText,
} from '../../../../components/conversation-runtime/messages/support.js';
import type { LiveToolCallState } from './chat-page-utils.js';

export interface BuildStreamAssistantTraceOptions {
  accumulatedThinkingBlocks: StreamingThinkingBlock[];
  finalStatus?: 'completed' | 'error' | 'cancelled' | 'paused';
  messageId: string;
  modifiedFilesSummary?: ModifiedFilesSummaryContent;
  resolveAssistantCapabilityKind: (toolName: string) => AssistantTraceToolCall['kind'];
  textContent: string;
  toolCalls: Map<string, LiveToolCallState>;
}

export interface BuiltStreamAssistantTrace {
  content: string;
  parts: ChatMessagePart[];
  reasoningBlocksEndedFlags?: boolean[];
  reasoningBlocksDurationsMs?: number[];
}

export function buildStreamAssistantTrace(
  options: BuildStreamAssistantTraceOptions,
): BuiltStreamAssistantTrace {
  const {
    accumulatedThinkingBlocks,
    finalStatus,
    messageId,
    modifiedFilesSummary,
    resolveAssistantCapabilityKind,
    textContent,
    toolCalls,
  } = options;

  const normalizedToolCalls = Array.from(toolCalls.values()).map((toolCallState) => {
    const nextToolState =
      finalStatus === 'error' && toolCallState.status === 'streaming'
        ? { ...toolCallState, isError: true, status: 'error' as const }
        : finalStatus === 'completed' && toolCallState.status === 'streaming'
          ? { ...toolCallState, status: 'completed' as const }
          : (finalStatus === 'cancelled' || finalStatus === 'paused') &&
              toolCallState.status === 'streaming'
            ? { ...toolCallState, status: 'paused' as const }
            : toolCallState;

    const hasPendingPermission = hasActivePendingPermissionRequest({
      isError: nextToolState.isError,
      pendingPermissionRequestId: nextToolState.pendingPermissionRequestId,
      resumedAfterApproval: nextToolState.resumedAfterApproval,
      status: nextToolState.status,
    });

    const status: 'running' | 'paused' | 'completed' | 'failed' =
      nextToolState.status === 'error'
        ? 'failed'
        : nextToolState.status === 'paused'
          ? 'paused'
          : nextToolState.status === 'completed'
            ? 'completed'
            : 'running';

    const durationMs =
      nextToolState.completedAt && nextToolState.createdAt
        ? nextToolState.completedAt - nextToolState.createdAt
        : undefined;

    return {
      kind: resolveAssistantCapabilityKind(nextToolState.toolName),
      toolCallId: nextToolState.toolCallId,
      toolName: nextToolState.toolName,
      input: {
        ...parseToolCallInputText(nextToolState.inputText),
        ...(nextToolState.batchProgress ? { _batchProgress: nextToolState.batchProgress } : {}),
      },
      output: nextToolState.output,
      isError: nextToolState.isError,
      ...(hasPendingPermission
        ? {
            pendingPermissionRequestId: nextToolState.pendingPermissionRequestId,
          }
        : {}),
      resumedAfterApproval: nextToolState.resumedAfterApproval,
      status,
      ...(durationMs !== undefined ? { durationMs } : {}),
    } satisfies AssistantTraceToolCall;
  });

  const reasoningBlocks = extractStreamingThinkingTexts(accumulatedThinkingBlocks);
  const reasoningBlocksEndedFlags =
    reasoningBlocks.length > 0
      ? extractStreamingThinkingEndedFlags(accumulatedThinkingBlocks)
      : undefined;
  const reasoningBlocksDurationsMs =
    reasoningBlocks.length > 0
      ? extractStreamingThinkingDurations(accumulatedThinkingBlocks)
      : undefined;
  const reasoningBlocksTimings =
    reasoningBlocks.length > 0
      ? accumulatedThinkingBlocks
          .filter((block) => block.text.trim().length > 0)
          .map((block) => ({
            ...(typeof block.startedAt === 'number' ? { startedAt: block.startedAt } : {}),
            ...(typeof block.endedAt === 'number' ? { endedAt: block.endedAt } : {}),
          }))
      : undefined;
  const hasPersistableTiming =
    reasoningBlocksTimings?.some(
      (entry) => typeof entry.startedAt === 'number' || typeof entry.endedAt === 'number',
    ) ?? false;

  const tracePayload = {
    ...(modifiedFilesSummary ? { modifiedFilesSummary } : {}),
    ...(reasoningBlocks.length > 0 ? { reasoningBlocks } : {}),
    ...(hasPersistableTiming && reasoningBlocksTimings ? { reasoningBlocksTimings } : {}),
    text: textContent,
    toolCalls: normalizedToolCalls,
  };

  return {
    content: textContent,
    parts: partsFromAssistantTrace(messageId, tracePayload),
    ...(reasoningBlocksEndedFlags ? { reasoningBlocksEndedFlags } : {}),
    ...(reasoningBlocksDurationsMs ? { reasoningBlocksDurationsMs } : {}),
  };
}
