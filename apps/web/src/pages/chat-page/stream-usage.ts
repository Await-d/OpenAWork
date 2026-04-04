import type { StreamUsageChunk } from '@openAwork/shared';

export interface ChatBackendUsageSnapshot {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  round: number;
}

export function hasUsableReportedUsageSnapshot(
  snapshot: ChatBackendUsageSnapshot | null,
): snapshot is ChatBackendUsageSnapshot {
  return snapshot !== null && snapshot.totalTokens > 0;
}

function normalizeTokenCount(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.round(value));
}

export function toChatBackendUsageSnapshot(event: StreamUsageChunk): ChatBackendUsageSnapshot {
  return {
    inputTokens: normalizeTokenCount(event.inputTokens),
    outputTokens: normalizeTokenCount(event.outputTokens),
    totalTokens: normalizeTokenCount(event.totalTokens),
    round: Math.max(1, Math.trunc(event.round)),
  };
}

export function mergeChatBackendUsageSnapshot(
  previous: ChatBackendUsageSnapshot | null,
  event: StreamUsageChunk,
): ChatBackendUsageSnapshot {
  const next = toChatBackendUsageSnapshot(event);
  if (!previous) {
    return next;
  }

  if (next.round !== previous.round) {
    return next.round > previous.round ? next : previous;
  }

  return next.totalTokens >= previous.totalTokens ? next : previous;
}
