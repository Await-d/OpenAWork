import type { RunEvent } from '@openAwork/shared';
import { redactText } from '@openAwork/agent-core';
import {
  getSessionMessageByRequestId,
  listSessionMessagesByRequestScope,
} from '../message/message-v2-adapter.js';
import {
  listSessionRunEventsByRequestAfterSeq,
  listSessionRunEventsByRequest,
} from '../session/session-run-events.js';
import { deriveRunEventBookend } from '../session/run-event-envelope.js';
import { clearRequestArtifacts } from './stream-persistence.js';
import {
  buildToolResultRunEvent,
  normalizeToolArgumentsForStorage,
} from '../tools/tool-result-contract.js';
import { toStreamStopReason } from './stream-types.js';
import type { HandleStreamResult } from './stream-types.js';

export function replayPersistedAssistantResponse(input: {
  clientRequestId: string;
  runId: string;
  sessionId: string;
  userId: string;
  writeChunk: (chunk: RunEvent) => void;
  afterSeq?: number;
}): NonNullable<HandleStreamResult['stopReason']> | false {
  const durableEvents =
    typeof input.afterSeq === 'number' && input.afterSeq > 0
      ? listSessionRunEventsByRequestAfterSeq({
          sessionId: input.sessionId,
          clientRequestId: input.clientRequestId,
          afterSeq: input.afterSeq,
        }).map(({ event }) => event)
      : listSessionRunEventsByRequest({
          sessionId: input.sessionId,
          clientRequestId: input.clientRequestId,
        });
  if (durableEvents.length > 0) {
    const latestBookend = deriveRunEventBookend(durableEvents.at(-1)!);
    if (latestBookend?.kind === 'run_failed') {
      return false;
    }

    if (latestBookend?.replayable === true) {
      durableEvents.forEach((event) => {
        input.writeChunk(event);
      });
      return latestBookend.kind === 'interaction_wait'
        ? 'tool_permission'
        : (toStreamStopReason(latestBookend.stopReason) ?? 'error');
    }

    if (latestBookend?.replayable === false) {
      return false;
    }
  }

  const stored = getSessionMessageByRequestId({
    sessionId: input.sessionId,
    userId: input.userId,
    clientRequestId: input.clientRequestId,
    role: 'assistant',
  });
  if (!stored) return false;

  const scopedMessages = listSessionMessagesByRequestScope({
    sessionId: input.sessionId,
    userId: input.userId,
    clientRequestId: input.clientRequestId,
  });
  const toolNames = new Map<string, string>();
  const replayedToolResultIds = new Set<string>();
  scopedMessages.forEach((message) => {
    message.content.forEach((content) => {
      if (content.type === 'tool_call') {
        toolNames.set(content.toolCallId, content.toolName);
      }
    });
  });
  let sequence = 1;
  scopedMessages.forEach((message) => {
    message.content.forEach((content) => {
      const meta = {
        eventId: `${input.runId}:replay:${sequence++}`,
        runId: input.runId,
        occurredAt: Date.now(),
      };

      if (message.role === 'assistant' && content.type === 'text' && content.text.length > 0) {
        input.writeChunk({ type: 'text_delta', delta: redactText(content.text), ...meta });
        return;
      }

      if (message.role === 'assistant' && content.type === 'tool_call') {
        input.writeChunk({
          type: 'tool_call_delta',
          toolCallId: content.toolCallId,
          toolName: content.toolName,
          inputDelta: normalizeToolArgumentsForStorage(content.rawArguments ?? content.input),
          ...meta,
        });
        return;
      }

      if (content.type === 'tool_result' && !replayedToolResultIds.has(content.toolCallId)) {
        replayedToolResultIds.add(content.toolCallId);
        input.writeChunk(
          buildToolResultRunEvent({
            toolCallId: content.toolCallId,
            toolName: content.toolName ?? toolNames.get(content.toolCallId) ?? 'tool',
            clientRequestId: content.clientRequestId ?? input.clientRequestId,
            output: content.output,
            isError: content.isError,
            fileDiffs: content.fileDiffs,
            pendingPermissionRequestId: content.pendingPermissionRequestId,
            observability: content.observability,
            ...(content.resumedAfterApproval ? { resumedAfterApproval: true } : {}),
            eventMeta: meta,
          }),
        );
      }
    });
  });

  if (stored.status === 'error') {
    return false;
  }

  input.writeChunk({
    type: 'done',
    stopReason: 'end_turn',
    eventId: `${input.runId}:replay:${sequence}`,
    runId: input.runId,
    occurredAt: Date.now(),
  });
  return 'end_turn';
}

export function clearStaleReplayRequestArtifacts(input: {
  clientRequestId: string;
  sessionId: string;
  userId: string;
}): boolean {
  const durableEvents = listSessionRunEventsByRequest({
    sessionId: input.sessionId,
    clientRequestId: input.clientRequestId,
  });
  const latestEvent = durableEvents.at(-1);
  const latestBookend = latestEvent ? deriveRunEventBookend(latestEvent) : undefined;
  const stored = getSessionMessageByRequestId({
    sessionId: input.sessionId,
    userId: input.userId,
    clientRequestId: input.clientRequestId,
    role: 'assistant',
  });

  const shouldClearRequestScope =
    latestBookend?.kind === 'run_failed' ||
    latestBookend?.replayable === false ||
    stored?.status === 'error' ||
    (durableEvents.length > 0 && latestBookend === undefined && !stored);

  if (!shouldClearRequestScope) {
    return false;
  }

  clearRequestArtifacts(input);
  return true;
}

export function parseToolInput(raw: string): Record<string, unknown> {
  const normalized = raw.trim();
  if (normalized.length === 0) {
    return {};
  }

  try {
    const parsed = JSON.parse(normalized) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return { raw: normalized };
  }

  return { raw: normalized };
}

// 与 `stream-error-handler.ts` 的实现逐字相同（同一份 `[错误: CODE] 摘要` 契约），
// 以 error-handler 为唯一真相源，此处仅保留原导出名做转发，避免两份实现各自漂移。
export { buildErrorContent } from './stream-error-handler.js';
