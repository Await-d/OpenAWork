import type { StreamUsageChunk } from '@openAwork/shared';

export interface ChatBackendUsageSnapshot {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
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

function normalizeOptionalTokenCount(value: number | undefined): number | undefined {
  return typeof value === 'number' ? normalizeTokenCount(value) : undefined;
}

export function toChatBackendUsageSnapshot(event: StreamUsageChunk): ChatBackendUsageSnapshot {
  const reasoningTokens = normalizeOptionalTokenCount(event.reasoningTokens);
  const cacheReadTokens = normalizeOptionalTokenCount(event.cacheReadTokens);
  const cacheWriteTokens = normalizeOptionalTokenCount(event.cacheWriteTokens);
  return {
    inputTokens: normalizeTokenCount(event.inputTokens),
    outputTokens: normalizeTokenCount(event.outputTokens),
    totalTokens: normalizeTokenCount(event.totalTokens),
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
    ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
    ...(cacheWriteTokens !== undefined ? { cacheWriteTokens } : {}),
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

  const primary = next.totalTokens >= previous.totalTokens ? next : previous;
  const fallback = primary === next ? previous : next;
  const reasoningTokens = primary.reasoningTokens ?? fallback.reasoningTokens;
  const cacheReadTokens = primary.cacheReadTokens ?? fallback.cacheReadTokens;
  const cacheWriteTokens = primary.cacheWriteTokens ?? fallback.cacheWriteTokens;
  return {
    ...primary,
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
    ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
    ...(cacheWriteTokens !== undefined ? { cacheWriteTokens } : {}),
  };
}
