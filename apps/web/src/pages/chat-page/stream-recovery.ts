import type { RunEvent } from '@openAwork/shared';
import type { SessionStateStatus } from './session-runtime.js';
import { mergeChatBackendUsageSnapshot, type ChatBackendUsageSnapshot } from './stream-usage.js';

export interface RecoveredActiveAssistantStream {
  startedAt: number | null;
  text: string;
  thinking: string;
  usage: ChatBackendUsageSnapshot | null;
}

function isRecoverableSessionStatus(
  status: SessionStateStatus | null,
): status is Extract<SessionStateStatus, 'paused' | 'running'> {
  return status === 'running' || status === 'paused';
}

function isTerminalRunEvent(event: RunEvent): boolean {
  return event.type === 'done' || event.type === 'error';
}

export function recoverActiveAssistantStream(input: {
  runEvents: RunEvent[];
  sessionStateStatus: SessionStateStatus | null;
}): RecoveredActiveAssistantStream | null {
  if (!isRecoverableSessionStatus(input.sessionStateStatus) || input.runEvents.length === 0) {
    return null;
  }

  const activeRunId = [...input.runEvents]
    .reverse()
    .find((event) => typeof event.runId === 'string' && event.runId.length > 0)?.runId;
  if (!activeRunId) {
    return null;
  }

  const activeRunEvents = input.runEvents.filter((event) => event.runId === activeRunId);
  const latestActiveRunEvent = activeRunEvents.at(-1);
  if (!latestActiveRunEvent || isTerminalRunEvent(latestActiveRunEvent)) {
    return null;
  }

  let text = '';
  let thinking = '';
  let usage: ChatBackendUsageSnapshot | null = null;
  let startedAt: number | null = null;
  let hasRenderableContent = false;

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
      thinking += event.delta;
      hasRenderableContent = true;
      continue;
    }

    if (event.type === 'usage') {
      usage = mergeChatBackendUsageSnapshot(usage, event);
      continue;
    }

    if (event.type === 'tool_call_delta' || event.type === 'tool_result') {
      hasRenderableContent = true;
    }
  }

  if (!hasRenderableContent) {
    return null;
  }

  return {
    startedAt,
    text,
    thinking,
    usage,
  };
}
