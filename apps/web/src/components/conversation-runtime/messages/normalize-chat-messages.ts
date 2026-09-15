import type { AssistantTracePayload, AssistantTraceToolCall, Message } from '@openAwork/shared';
import type { ChatMessage, ChatToolPart } from './message-model.js';
import {
  estimateTokenCount,
  hasActivePendingPermissionRequest,
  normalizeCreatedAt,
  normalizeOptionalString,
  normalizeProviderUsage,
} from './message-coercion.js';
import {
  extractDisplayText,
  extractInputImages,
  extractModifiedFilesSummary,
  extractTextFragments,
  extractToolCalls,
  extractToolResults,
} from './message-content.js';
import {
  appendToolCallToAssistantMessage,
  parseLegacyToolCallContent,
} from './copied-tool-card.js';
import {
  buildReadableAssistantText,
  extractReasoningBlocksWithTimings,
} from './reasoning-content.js';
import {
  createAssistantTraceContent,
  parseAssistantTraceContent,
  partsFromAssistantTrace,
  partsFromOrderedAssistantContent,
  readAssistantTracePayload,
} from './trace-codec.js';

function resolveNormalizedChatMessageStatus(
  record: Record<string, unknown>,
  stopReason: string | undefined,
): ChatMessage['status'] | undefined {
  if (
    record['status'] === 'streaming' ||
    record['status'] === 'completed' ||
    record['status'] === 'error' ||
    record['status'] === 'cancelled'
  ) {
    return record['status'];
  }

  // Backend message rows often only carry stopReason (or legacy "final")
  // without a UI-facing status. Infer abnormal terminals so a recovery
  // reload does not silently rewrite cancelled/error turns as completed.
  if (stopReason === 'error') return 'error';
  if (stopReason === 'cancelled') return 'cancelled';
  if (record['status'] === 'final' || record['status'] === undefined) return 'completed';
  return undefined;
}

export function normalizeChatMessages(rawMessages: unknown): ChatMessage[] {
  if (!Array.isArray(rawMessages)) return [];

  const toolCallMap = new Map<string, { input: Record<string, unknown>; toolName: string }>();
  const assistantMessageIndexByToolCallId = new Map<string, number>();
  const normalizedMessages: ChatMessage[] = [];

  for (const rawMessage of rawMessages) {
    if (!rawMessage || typeof rawMessage !== 'object') continue;
    const record = rawMessage as Record<string, unknown>;
    const role = record['role'];
    if (role !== 'user' && role !== 'assistant' && role !== 'tool') continue;
    const id = typeof record['id'] === 'string' ? record['id'] : crypto.randomUUID();
    const createdAt =
      typeof record['createdAt'] === 'number' || typeof record['createdAt'] === 'string'
        ? record['createdAt']
        : undefined;
    const model = normalizeOptionalString(record['model']);
    const providerId = normalizeOptionalString(record['providerId']);
    const agentId = normalizeOptionalString(record['agentId']);
    const durationMs =
      typeof record['durationMs'] === 'number' && Number.isFinite(record['durationMs'])
        ? record['durationMs']
        : undefined;
    const firstTokenLatencyMs =
      typeof record['firstTokenLatencyMs'] === 'number' &&
      Number.isFinite(record['firstTokenLatencyMs'])
        ? record['firstTokenLatencyMs']
        : undefined;
    const stopReason = typeof record['stopReason'] === 'string' ? record['stopReason'] : undefined;
    const tokenEstimate =
      typeof record['tokenEstimate'] === 'number' && Number.isFinite(record['tokenEstimate'])
        ? record['tokenEstimate']
        : undefined;
    const providerUsage = normalizeProviderUsage(record['providerUsage']);

    if (typeof record['content'] === 'string') {
      if (role !== 'tool') {
        const nextMessage: ChatMessage = {
          id,
          role,
          content: record['content'],
          clientRequestId: normalizeOptionalString(record['clientRequestId']),
          createdAt: normalizeCreatedAt(createdAt),
          model,
          providerId,
          agentId,
          durationMs,
          firstTokenLatencyMs,
          stopReason,
          tokenEstimate,
          providerUsage,
          status: resolveNormalizedChatMessageStatus(record, stopReason),
        };

        if (role === 'assistant') {
          const legacyToolCall = parseLegacyToolCallContent(record['content']);
          const assistantTrace = parseAssistantTraceContent(record['content']);
          const previousMessage = normalizedMessages[normalizedMessages.length - 1];

          if (legacyToolCall && previousMessage?.role === 'assistant') {
            normalizedMessages[normalizedMessages.length - 1] = appendToolCallToAssistantMessage(
              previousMessage,
              legacyToolCall,
            );
            continue;
          }

          if (legacyToolCall) {
            normalizedMessages.push({
              ...nextMessage,
              content: createAssistantTraceContent({ text: '', toolCalls: [legacyToolCall] }),
              toolCallCount: 1,
              tokenEstimate: nextMessage.tokenEstimate ?? 0,
            });
            continue;
          }

          if (assistantTrace) {
            const messageIndex = normalizedMessages.length;
            normalizedMessages.push({
              ...nextMessage,
              parts: partsFromAssistantTrace(nextMessage.id, assistantTrace),
              modifiedFilesSummary: assistantTrace.modifiedFilesSummary ?? undefined,
              toolCallCount:
                assistantTrace.toolCalls.length > 0 ? assistantTrace.toolCalls.length : undefined,
            });

            assistantTrace.toolCalls.forEach((toolCall) => {
              if (!toolCall.toolCallId) {
                return;
              }

              toolCallMap.set(toolCall.toolCallId, {
                input: toolCall.input,
                toolName: toolCall.toolName,
              });
              assistantMessageIndexByToolCallId.set(toolCall.toolCallId, messageIndex);
            });
            continue;
          }
        }

        normalizedMessages.push(nextMessage);
      }
      continue;
    }

    if (!Array.isArray(record['content'])) continue;

    const content = record['content'];
    const createdAtValue = normalizeCreatedAt(createdAt);

    if (role === 'user') {
      const text = extractDisplayText(content);
      const inputImages = extractInputImages(content);
      if (text.length > 0 || inputImages.length > 0) {
        normalizedMessages.push({
          id,
          role: 'user',
          content: text,
          clientRequestId: normalizeOptionalString(record['clientRequestId']),
          rawContent: content as Message['content'],
          createdAt: createdAtValue,
          model,
          providerId,
          agentId,
          durationMs,
          firstTokenLatencyMs,
          stopReason,
          tokenEstimate,
          providerUsage,
          status: 'completed',
        });
      }
      continue;
    }

    if (role === 'assistant') {
      const text = extractDisplayText(content);
      const reasoningEntries = extractReasoningBlocksWithTimings(content, extractTextFragments);
      const reasoningBlocks = reasoningEntries.map((entry) => entry.text);
      const reasoningBlocksTimings = reasoningEntries.map((entry) => ({
        ...(typeof entry.startedAt === 'number' ? { startedAt: entry.startedAt } : {}),
        ...(typeof entry.endedAt === 'number' ? { endedAt: entry.endedAt } : {}),
      }));
      const hasReasoningTimings = reasoningBlocksTimings.some(
        (entry) => typeof entry.startedAt === 'number' || typeof entry.endedAt === 'number',
      );
      const toolCalls = extractToolCalls(content);
      const modifiedFilesSummary = extractModifiedFilesSummary(content);
      toolCalls.forEach((toolCall) => {
        toolCallMap.set(toolCall.toolCallId, {
          input: toolCall.input,
          toolName: toolCall.toolName,
        });
      });

      // Merge tool_result into tool_call — mirrors opencode's Part.state pattern
      // where each tool part carries its own complete status/output/error.
      const toolResults = extractToolResults(content);
      const toolResultMap = new Map(toolResults.map((r) => [r.toolCallId, r]));

      const assistantToolCalls: AssistantTraceToolCall[] = toolCalls.map((toolCall) => {
        const result = toolResultMap.get(toolCall.toolCallId);
        const hasPendingPermission =
          result?.pendingPermissionRequestId && !result.resumedAfterApproval;
        const inferredStatus: 'running' | 'paused' | 'completed' | 'failed' = hasPendingPermission
          ? 'paused'
          : result?.isError
            ? 'failed'
            : result
              ? 'completed'
              : 'completed';
        return {
          toolCallId: toolCall.toolCallId,
          toolName: toolCall.toolName,
          input: toolCall.input,
          ...(result?.output !== undefined ? { output: result.output } : {}),
          ...(result?.isError ? { isError: true } : {}),
          ...(result?.pendingPermissionRequestId
            ? { pendingPermissionRequestId: result.pendingPermissionRequestId }
            : {}),
          ...(result?.resumedAfterApproval ? { resumedAfterApproval: true } : {}),
          ...(result?.clientRequestId ? { clientRequestId: result.clientRequestId } : {}),
          ...(result?.fileDiffs && result.fileDiffs.length > 0
            ? { fileDiffs: result.fileDiffs }
            : {}),
          ...(result?.observability ? { observability: result.observability } : {}),
          status: inferredStatus,
        };
      });

      if (text.length > 0 || assistantToolCalls.length > 0 || reasoningBlocks.length > 0) {
        const messageIndex = normalizedMessages.length;
        const tracePayload: AssistantTracePayload = {
          text,
          toolCalls: assistantToolCalls,
          ...(reasoningBlocks.length > 0 ? { reasoningBlocks } : {}),
          ...(reasoningBlocks.length > 0 && hasReasoningTimings ? { reasoningBlocksTimings } : {}),
          ...(modifiedFilesSummary ? { modifiedFilesSummary } : {}),
        };
        const traceContent =
          assistantToolCalls.length > 0 || reasoningBlocks.length > 0
            ? createAssistantTraceContent(tracePayload)
            : text;
        // Build parts directly from the structured `content` array so the
        // restored transcript reflects the on-wire ordering of reasoning /
        // text / tool_call segments. The legacy `partsFromAssistantTrace`
        // path is kept as a fallback for messages that for whatever reason
        // arrive without a well-formed content array (e.g. stringified
        // legacy traces).
        const orderedParts = partsFromOrderedAssistantContent(id, content);
        // Reconcile tool part statuses: `partsFromOrderedAssistantContent`
        // defaults tool parts to `running` when no paired `tool_result` is
        // found in the content array. However, for finalized messages loaded
        // from history, the `assistantToolCalls` array (built from
        // `extractToolCalls` + `extractToolResults`) has the correct
        // `inferredStatus` which defaults to `completed`. Align the parts
        // with the authoritative status so the UI doesn't show a perpetual
        // spinner after page refresh when the tool has actually completed.
        if (orderedParts.length > 0 && assistantToolCalls.length > 0) {
          const statusByCallId = new Map(
            assistantToolCalls
              .filter((tc) => tc.toolCallId)
              .map((tc) => [tc.toolCallId, tc] as const),
          );
          for (let i = 0; i < orderedParts.length; i += 1) {
            const part = orderedParts[i];
            if (part && part.type === 'tool' && part.status === 'running') {
              const authoritative = statusByCallId.get(part.toolCallId);
              if (authoritative && authoritative.status && authoritative.status !== 'running') {
                orderedParts[i] = {
                  ...part,
                  ...(authoritative.output !== undefined ? { output: authoritative.output } : {}),
                  ...(authoritative.isError ? { isError: true } : {}),
                  ...(authoritative.fileDiffs ? { fileDiffs: authoritative.fileDiffs } : {}),
                  ...(authoritative.observability
                    ? { observability: authoritative.observability }
                    : {}),
                  ...(authoritative.pendingPermissionRequestId
                    ? { pendingPermissionRequestId: authoritative.pendingPermissionRequestId }
                    : {}),
                  ...(authoritative.resumedAfterApproval ? { resumedAfterApproval: true } : {}),
                  status: authoritative.status,
                };
              }
            }
          }
        }
        const partsForMessage =
          orderedParts.length > 0
            ? orderedParts
            : partsFromAssistantTrace(id, {
                text,
                toolCalls: assistantToolCalls,
                ...(reasoningBlocks.length > 0 ? { reasoningBlocks } : {}),
                ...(reasoningBlocks.length > 0 && hasReasoningTimings
                  ? { reasoningBlocksTimings }
                  : {}),
              });
        normalizedMessages.push({
          id,
          role: 'assistant',
          content: traceContent,
          clientRequestId: normalizeOptionalString(record['clientRequestId']),
          parts: partsForMessage,
          rawContent: content as Message['content'],
          createdAt: createdAtValue,
          model,
          providerId,
          agentId,
          durationMs,
          firstTokenLatencyMs,
          stopReason,
          tokenEstimate:
            tokenEstimate ?? estimateTokenCount(buildReadableAssistantText(text, reasoningBlocks)),
          providerUsage,
          toolCallCount: assistantToolCalls.length > 0 ? assistantToolCalls.length : undefined,
          modifiedFilesSummary: modifiedFilesSummary ?? undefined,
          status: resolveNormalizedChatMessageStatus(record, stopReason) ?? 'completed',
        });

        toolCalls.forEach((toolCall) => {
          assistantMessageIndexByToolCallId.set(toolCall.toolCallId, messageIndex);
        });
      }

      continue;
    }

    const toolResults = extractToolResults(content);
    for (const toolResult of toolResults) {
      const toolCall = toolCallMap.get(toolResult.toolCallId);
      const assistantMessageIndex = assistantMessageIndexByToolCallId.get(toolResult.toolCallId);
      const hasPendingPermission = hasActivePendingPermissionRequest(toolResult);

      if (assistantMessageIndex !== undefined) {
        const targetMessage = normalizedMessages[assistantMessageIndex];
        const parsedTrace = targetMessage ? readAssistantTracePayload(targetMessage) : null;

        if (targetMessage && parsedTrace) {
          const nextToolCalls = parsedTrace.toolCalls.map((item) => {
            const matchesToolResult =
              item.toolName === (toolCall?.toolName ?? item.toolName) &&
              (item.toolCallId
                ? item.toolCallId === toolResult.toolCallId
                : JSON.stringify(item.input) === JSON.stringify(toolCall?.input ?? item.input));

            if (!matchesToolResult) {
              return item;
            }

            const {
              pendingPermissionRequestId: _stalePendingPermissionRequestId,
              resumedAfterApproval: _staleResumedAfterApproval,
              ...baseItem
            } = item;
            const nextStatus: AssistantTraceToolCall['status'] = hasPendingPermission
              ? 'paused'
              : toolResult.isError
                ? 'failed'
                : 'completed';

            return {
              ...baseItem,
              ...(toolResult.clientRequestId
                ? { clientRequestId: toolResult.clientRequestId }
                : {}),
              ...(toolResult.fileDiffs ? { fileDiffs: toolResult.fileDiffs } : {}),
              output: toolResult.output,
              isError: hasPendingPermission ? false : toolResult.isError,
              ...(toolResult.observability ? { observability: toolResult.observability } : {}),
              ...(hasPendingPermission
                ? { pendingPermissionRequestId: toolResult.pendingPermissionRequestId }
                : {}),
              ...(toolResult.resumedAfterApproval ? { resumedAfterApproval: true } : {}),
              status: nextStatus,
            } satisfies AssistantTraceToolCall;
          });
          const nextTracePayload = {
            ...(parsedTrace.modifiedFilesSummary
              ? { modifiedFilesSummary: parsedTrace.modifiedFilesSummary }
              : {}),
            ...(parsedTrace.reasoningBlocks && parsedTrace.reasoningBlocks.length > 0
              ? { reasoningBlocks: parsedTrace.reasoningBlocks }
              : {}),
            text: parsedTrace.text,
            toolCalls: nextToolCalls,
          } satisfies AssistantTracePayload;
          targetMessage.content = createAssistantTraceContent(nextTracePayload);
          // Update parts in place rather than rebuilding via
          // `partsFromAssistantTrace`. The latter would re-flatten parts to
          // the legacy reasoning → text → tool ordering, undoing the
          // wire-faithful interleaving that `partsFromOrderedAssistantContent`
          // (or the live-stream segment accumulator) produced. We only need
          // to mirror the new tool-result payload onto the existing
          // ChatToolPart so the renderer (which consumes parts) shows the
          // updated output / status alongside the right tool segment.
          const existingParts = targetMessage.parts;
          if (existingParts && existingParts.length > 0) {
            targetMessage.parts = existingParts.map((part) => {
              if (part.type !== 'tool' || part.toolCallId !== toolResult.toolCallId) {
                return part;
              }
              const nextStatus: ChatToolPart['status'] = hasPendingPermission
                ? 'paused'
                : toolResult.isError
                  ? 'failed'
                  : 'completed';
              return {
                ...part,
                ...(toolResult.clientRequestId
                  ? { clientRequestId: toolResult.clientRequestId }
                  : {}),
                ...(toolResult.fileDiffs ? { fileDiffs: toolResult.fileDiffs } : {}),
                output: toolResult.output,
                isError: hasPendingPermission ? false : toolResult.isError,
                ...(toolResult.observability ? { observability: toolResult.observability } : {}),
                pendingPermissionRequestId: hasPendingPermission
                  ? toolResult.pendingPermissionRequestId
                  : undefined,
                resumedAfterApproval: toolResult.resumedAfterApproval
                  ? true
                  : part.resumedAfterApproval,
                status: nextStatus,
              };
            });
          } else {
            targetMessage.parts = partsFromAssistantTrace(targetMessage.id, nextTracePayload);
          }
        }
        continue;
      }

      const fallbackMessageId = `${id}:tool-fallback`;
      const fallbackStatus: AssistantTraceToolCall['status'] = hasPendingPermission
        ? 'paused'
        : toolResult.isError
          ? 'failed'
          : 'completed';
      const fallbackTracePayload = {
        text: '',
        toolCalls: [
          {
            ...(toolResult.clientRequestId ? { clientRequestId: toolResult.clientRequestId } : {}),
            ...(toolResult.fileDiffs ? { fileDiffs: toolResult.fileDiffs } : {}),
            toolCallId: toolResult.toolCallId,
            toolName: toolResult.toolName ?? toolCall?.toolName ?? 'tool',
            input: toolCall?.input ?? {},
            output: toolResult.output,
            isError: hasPendingPermission ? false : toolResult.isError,
            ...(toolResult.observability ? { observability: toolResult.observability } : {}),
            ...(hasPendingPermission
              ? { pendingPermissionRequestId: toolResult.pendingPermissionRequestId }
              : {}),
            ...(toolResult.resumedAfterApproval ? { resumedAfterApproval: true } : {}),
            status: fallbackStatus,
          } satisfies AssistantTraceToolCall,
        ],
      } satisfies AssistantTracePayload;

      normalizedMessages.push({
        id: fallbackMessageId,
        role: 'assistant',
        content: createAssistantTraceContent(fallbackTracePayload),
        parts: partsFromAssistantTrace(fallbackMessageId, fallbackTracePayload),
        rawContent: content as Message['content'],
        createdAt: createdAtValue,
        model,
        providerId,
        agentId,
        durationMs,
        firstTokenLatencyMs,
        stopReason,
        tokenEstimate: tokenEstimate ?? 0,
        toolCallCount: 1,
        status: hasPendingPermission ? 'completed' : toolResult.isError ? 'error' : 'completed',
      });
      assistantMessageIndexByToolCallId.set(toolResult.toolCallId, normalizedMessages.length - 1);
      if (!toolCall) {
        toolCallMap.set(toolResult.toolCallId, {
          input: {},
          toolName: toolResult.toolName ?? 'tool',
        });
      }
    }
  }

  return normalizedMessages;
}

