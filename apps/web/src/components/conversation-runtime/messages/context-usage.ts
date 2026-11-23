export interface ChatContextUsageSnapshot {
  estimated: boolean;
  maxTokens: number;
  usedTokens: number;
  autoCompactThresholdTokens?: number | null;
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

/**
 * 把**会话级**上下文挡位叠加到模型选项上，供「上下文占用条 / 模型弹层」使用。
 *
 * 优先级与会话运行时（网关 `resolveStreamModelRoute`）一致：
 * 会话级 > 模型级（`user_settings.providers` 里该模型的 `contextWindowOverride`）> 模型 preset。
 * 会话未覆盖时**原样返回同一引用**，避免让下游 memo 因新对象而失效。
 */
export function applyContextWindowOverride<T extends { contextWindowOverride?: number }>(
  option: T | null | undefined,
  sessionOverride: number | undefined,
): T | null | undefined {
  if (!option || sessionOverride === undefined) return option;
  return { ...option, contextWindowOverride: sessionOverride };
}

export function buildChatContextUsageSnapshot({
  contextWindow,
  autoCompactThresholdTokens,
  historicalTokens,
  preferHistoricalEstimate = false,
  reportedTotalTokens,
  streamingTotalTokens,
}: {
  contextWindow?: number;
  autoCompactThresholdTokens?: number | null;
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
  const budget = autoCompactThresholdTokens === undefined ? {} : { autoCompactThresholdTokens };

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
      ...budget,
    };
  }

  return {
    estimated: true,
    maxTokens: contextWindow,
    usedTokens: estimatedUsedTokens,
    ...budget,
  };
}
