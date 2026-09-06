export interface ChatContextUsageSnapshot {
  estimated: boolean;
  maxTokens: number;
  usedTokens: number;
}

export function resolveEffectiveContextWindow(
  contextWindow?: number,
  contextWindowOverride?: number,
): number | undefined {
  const candidates = [contextWindow, contextWindowOverride].filter(
    (value): value is number => value !== undefined && Number.isFinite(value) && value > 0,
  );
  return candidates.length > 0 ? Math.min(...candidates) : undefined;
}

export function buildChatContextUsageSnapshot({
  contextWindow,
  historicalTokens,
  preferHistoricalEstimate = false,
  reportedTotalTokens,
  streamingTotalTokens,
}: {
  contextWindow?: number;
  historicalTokens: number;
  preferHistoricalEstimate?: boolean;
  reportedTotalTokens?: number;
  streamingTotalTokens?: number;
}): ChatContextUsageSnapshot | null {
  if (!contextWindow || contextWindow <= 0) {
    return null;
  }

  const safeHistoricalTokens = Math.max(0, historicalTokens);
  const safeReportedTotalTokens =
    reportedTotalTokens !== undefined ? Math.max(0, reportedTotalTokens) : undefined;
  const safeStreamingTotalTokens =
    streamingTotalTokens !== undefined ? Math.max(0, streamingTotalTokens) : undefined;
  const estimatedUsedTokens = Math.max(safeHistoricalTokens, safeStreamingTotalTokens ?? 0);

  if (
    !preferHistoricalEstimate &&
    safeReportedTotalTokens !== undefined &&
    safeReportedTotalTokens >= estimatedUsedTokens &&
    (safeReportedTotalTokens > 0 || estimatedUsedTokens === 0)
  ) {
    return {
      estimated: false,
      maxTokens: contextWindow,
      usedTokens: safeReportedTotalTokens,
    };
  }

  return {
    estimated: true,
    maxTokens: contextWindow,
    usedTokens: estimatedUsedTokens,
  };
}
