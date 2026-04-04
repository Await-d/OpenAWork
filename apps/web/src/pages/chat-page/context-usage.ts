export interface ChatContextUsageSnapshot {
  estimated: boolean;
  maxTokens: number;
  usedTokens: number;
}

export function buildChatContextUsageSnapshot({
  contextWindow,
  historicalTokens,
  reportedTotalTokens,
  streamingTotalTokens,
}: {
  contextWindow?: number;
  historicalTokens: number;
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
    safeReportedTotalTokens !== undefined &&
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
