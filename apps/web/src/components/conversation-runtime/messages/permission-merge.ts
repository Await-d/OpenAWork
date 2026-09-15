import type { AssistantTraceToolCall, RunEvent } from '@openAwork/shared';
import type { ChatMessage, ChatToolPart } from './message-model.js';
import { hasActivePendingPermissionRequest } from './message-coercion.js';
import { parseAssistantEventContent } from './card-codec.js';
import { createAssistantEventContent } from './event-card-builder.js';
import { createAssistantTraceContent, readAssistantTracePayload } from './trace-codec.js';

export function clearResolvedPendingPermissionFromMessage(
  message: ChatMessage,
  requestId: string,
): ChatMessage | null {
  if (message.role !== 'assistant') {
    return message;
  }

  const assistantTrace = readAssistantTracePayload(message);
  if (!assistantTrace) {
    return message;
  }

  const remainingToolCalls = assistantTrace.toolCalls.filter(
    (toolCall) => toolCall.pendingPermissionRequestId !== requestId,
  );
  if (remainingToolCalls.length === assistantTrace.toolCalls.length) {
    return message;
  }

  const hasReasoningBlocks = (assistantTrace.reasoningBlocks?.length ?? 0) > 0;
  const hasModifiedFilesSummary = Boolean(assistantTrace.modifiedFilesSummary);
  const hasText = assistantTrace.text.trim().length > 0;

  if (
    !hasText &&
    !hasReasoningBlocks &&
    !hasModifiedFilesSummary &&
    remainingToolCalls.length === 0
  ) {
    return null;
  }

  const nextContent =
    remainingToolCalls.length === 0 && !hasReasoningBlocks && !hasModifiedFilesSummary
      ? assistantTrace.text
      : createAssistantTraceContent({
          ...(hasModifiedFilesSummary
            ? { modifiedFilesSummary: assistantTrace.modifiedFilesSummary }
            : {}),
          ...(hasReasoningBlocks ? { reasoningBlocks: assistantTrace.reasoningBlocks } : {}),
          text: assistantTrace.text,
          toolCalls: remainingToolCalls,
        });

  // Also update parts: remove the tool part whose pendingPermissionRequestId matched.
  const nextParts = message.parts?.filter((part) => {
    if (part.type !== 'tool') return true;
    return part.pendingPermissionRequestId !== requestId;
  });

  return {
    ...message,
    content: nextContent,
    ...(nextParts ? { parts: nextParts } : {}),
    modifiedFilesSummary: hasModifiedFilesSummary ? assistantTrace.modifiedFilesSummary : undefined,
    toolCallCount: remainingToolCalls.length > 0 ? remainingToolCalls.length : undefined,
  };
}

export function applyPermissionDecisionToLocalAssistantMessages(
  messages: ChatMessage[],
  requestId: string,
  decision: Extract<RunEvent, { type: 'permission_replied' }>['decision'],
  feedback?: string,
): ChatMessage[] {
  return messages.map((message) => {
    if (message.role !== 'assistant') {
      return message;
    }

    const assistantTrace = readAssistantTracePayload(message);
    if (!assistantTrace) {
      return message;
    }

    let updated = false;
    const nextToolCalls = assistantTrace.toolCalls.map((toolCall) => {
      if (toolCall.pendingPermissionRequestId !== requestId) {
        return toolCall;
      }

      updated = true;
      const {
        pendingPermissionRequestId: _resolvedPendingPermissionRequestId,
        output: _waitingOutput,
        ...baseToolCall
      } = toolCall;

      return {
        ...baseToolCall,
        isError: decision === 'reject',
        ...(decision === 'reject'
          ? {
              output: feedback ? `权限已拒绝。用户反馈: ${feedback}` : '权限已拒绝，工具未执行。',
            }
          : {}),
        ...(decision !== 'reject' ? { resumedAfterApproval: true } : {}),
        status: decision === 'reject' ? ('failed' as const) : ('running' as const),
      } satisfies AssistantTraceToolCall;
    });

    if (!updated) {
      return message;
    }

    // Also update the parts array to reflect the permission decision.
    const nextParts = message.parts?.map((part) => {
      if (part.type !== 'tool' || part.pendingPermissionRequestId !== requestId) {
        return part;
      }
      const { pendingPermissionRequestId: _resolved, output: _waitingOutput, ...basePart } = part;
      return {
        ...basePart,
        isError: decision === 'reject',
        ...(decision === 'reject'
          ? {
              output: feedback ? `权限已拒绝。用户反馈: ${feedback}` : '权限已拒绝，工具未执行。',
            }
          : {}),
        ...(decision !== 'reject' ? { resumedAfterApproval: true } : {}),
        status: (decision === 'reject' ? 'failed' : 'running') as ChatToolPart['status'],
      } satisfies ChatToolPart;
    });

    return {
      ...message,
      content: createAssistantTraceContent({
        ...(assistantTrace.modifiedFilesSummary
          ? { modifiedFilesSummary: assistantTrace.modifiedFilesSummary }
          : {}),
        ...(assistantTrace.reasoningBlocks && assistantTrace.reasoningBlocks.length > 0
          ? { reasoningBlocks: assistantTrace.reasoningBlocks }
          : {}),
        text: assistantTrace.text,
        toolCalls: nextToolCalls,
      }),
      ...(nextParts ? { parts: nextParts } : {}),
      modifiedFilesSummary: assistantTrace.modifiedFilesSummary ?? undefined,
      toolCallCount: nextToolCalls.length > 0 ? nextToolCalls.length : undefined,
    };
  });
}

export function dismissPermissionEventMessage(
  messages: ChatMessage[],
  requestId: string,
): ChatMessage[] {
  return messages.filter((message) => {
    if (message.role !== 'assistant') {
      return true;
    }

    const assistantEvent = parseAssistantEventContent(message.content);
    return !(assistantEvent?.kind === 'permission' && assistantEvent.requestId === requestId);
  });
}

export function applyToolResultToLocalAssistantMessages(
  messages: ChatMessage[],
  event: Extract<RunEvent, { type: 'tool_result' }>,
): ChatMessage[] {
  const hasPendingPermission = hasActivePendingPermissionRequest(event);
  let matched = false;

  const nextMessages = messages.map((message) => {
    if (message.role !== 'assistant') {
      return message;
    }

    const assistantTrace = readAssistantTracePayload(message);
    if (!assistantTrace) {
      return message;
    }

    let updatedInMessage = false;
    const nextToolCalls = assistantTrace.toolCalls.map((toolCall) => {
      if (toolCall.toolCallId !== event.toolCallId) {
        return toolCall;
      }

      updatedInMessage = true;
      matched = true;

      const {
        pendingPermissionRequestId: _stalePendingPermissionRequestId,
        resumedAfterApproval: _staleResumedAfterApproval,
        ...baseToolCall
      } = toolCall;

      return {
        ...baseToolCall,
        output: event.output,
        isError: hasPendingPermission ? false : event.isError,
        ...(hasPendingPermission
          ? { pendingPermissionRequestId: event.pendingPermissionRequestId }
          : {}),
        ...(event.resumedAfterApproval ? { resumedAfterApproval: true } : {}),
        status: hasPendingPermission ? 'paused' : event.isError ? 'failed' : 'completed',
      } satisfies AssistantTraceToolCall;
    });

    if (!updatedInMessage) {
      return message;
    }

    const nextContent = createAssistantTraceContent({
      ...(assistantTrace.modifiedFilesSummary
        ? { modifiedFilesSummary: assistantTrace.modifiedFilesSummary }
        : {}),
      ...(assistantTrace.reasoningBlocks && assistantTrace.reasoningBlocks.length > 0
        ? { reasoningBlocks: assistantTrace.reasoningBlocks }
        : {}),
      text: assistantTrace.text,
      toolCalls: nextToolCalls,
    });

    // Also update the parts array by replacing the matching tool part by ID.
    const nextParts = message.parts?.map((part) => {
      if (part.type !== 'tool' || part.toolCallId !== event.toolCallId) return part;
      return {
        ...part,
        output: event.output,
        isError: hasPendingPermission ? false : event.isError,
        ...(hasPendingPermission
          ? { pendingPermissionRequestId: event.pendingPermissionRequestId }
          : { pendingPermissionRequestId: undefined }),
        ...(event.resumedAfterApproval ? { resumedAfterApproval: true } : {}),
        status: (hasPendingPermission
          ? 'paused'
          : event.isError
            ? 'failed'
            : 'completed') as ChatToolPart['status'],
      } satisfies ChatToolPart;
    });

    return {
      ...message,
      content: nextContent,
      ...(nextParts ? { parts: nextParts } : {}),
      modifiedFilesSummary: assistantTrace.modifiedFilesSummary ?? undefined,
      toolCallCount: nextToolCalls.length > 0 ? nextToolCalls.length : undefined,
    };
  });

  return matched ? nextMessages : messages;
}

export function upsertPermissionEventMessage(
  messages: ChatMessage[],
  event: Extract<RunEvent, { type: 'permission_asked' | 'permission_replied' }>,
): ChatMessage[] {
  const content = createAssistantEventContent(event);
  if (!content) {
    return messages;
  }

  const nextMessages: ChatMessage[] = [];
  let matched = false;

  for (const message of messages) {
    if (message.role !== 'assistant') {
      nextMessages.push(message);
      continue;
    }

    const assistantEvent = parseAssistantEventContent(message.content);
    if (assistantEvent?.kind !== 'permission' || assistantEvent.requestId !== event.requestId) {
      nextMessages.push(message);
      continue;
    }

    if (!matched) {
      nextMessages.push({
        ...message,
        content,
        createdAt: message.createdAt ?? event.occurredAt ?? Date.now(),
        status: 'completed',
      });
      matched = true;
    }
  }

  if (matched) {
    return nextMessages;
  }

  return [
    ...nextMessages,
    {
      id: crypto.randomUUID(),
      role: 'assistant',
      content,
      createdAt: event.occurredAt ?? Date.now(),
      status: 'completed',
    },
  ];
}
