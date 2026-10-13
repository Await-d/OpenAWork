export interface ChatContextUsageSnapshot {
  estimated: boolean;
  maxTokens: number;
  usedTokens: number;
}

export function resolveEffectiveContextWindow(
  contextWindow?: number,
  contextWindowOverride?: number,
): number | undefined {
  // 挡位是权威值：配置后直接作为有效窗口（可高于模型预设，与网关解析口径一致），
  // 未配置时回落模型预设。
  if (
    contextWindowOverride !== undefined &&
    Number.isFinite(contextWindowOverride) &&
    contextWindowOverride > 0
  ) {
    return contextWindowOverride;
  }
  return contextWindow !== undefined && Number.isFinite(contextWindow) && contextWindow > 0
    ? contextWindow
    : undefined;
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
