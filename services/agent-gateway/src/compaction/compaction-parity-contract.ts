const DEFAULT_CONTEXT_WINDOW_TOKENS = 128_000;
const MAX_SUMMARY_OUTPUT_TOKENS = 20_000;
const AUTO_COMPACTION_BUFFER_TOKENS = 13_000;

export interface CompactionTokenUsage {
  readonly inputTokens: number;
  readonly outputTokens?: number;
  readonly reasoningTokens?: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
  readonly cacheTokensAreSeparate?: boolean;
}

export interface CompactionThresholdInput {
  readonly modelContextWindow?: number;
  readonly discoveredContextWindow?: number;
  readonly contextWindowOverride?: number;
  readonly modelMaxOutputTokens?: number;
  readonly autoCompactPercentOverride?: number;
  readonly autoCompactThresholdRatio?: number;
}

export interface CompactionThresholdContract {
  readonly contextWindow: number;
  readonly effectiveContextWindow: number;
  readonly autoCompactThreshold: number;
}

export interface NormalizedCompactionUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
}

function positiveInteger(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.trunc(value);
}

function nonNegativeInteger(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.trunc(value);
}

export function parsePositiveOverride(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') {
    return undefined;
  }
  return positiveInteger(Number(value));
}

export function parsePercentageOverride(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 100 ? parsed : undefined;
}

export function resolveCompactionThreshold(
  input: CompactionThresholdInput,
): CompactionThresholdContract {
  const modelContextWindow =
    positiveInteger(input.modelContextWindow) ?? DEFAULT_CONTEXT_WINDOW_TOKENS;
  const contextWindow = Math.min(
    modelContextWindow,
    positiveInteger(input.discoveredContextWindow) ?? modelContextWindow,
    positiveInteger(input.contextWindowOverride) ?? modelContextWindow,
  );
  const summaryOutputTokens = Math.min(
    positiveInteger(input.modelMaxOutputTokens) ?? MAX_SUMMARY_OUTPUT_TOKENS,
    MAX_SUMMARY_OUTPUT_TOKENS,
  );
  const effectiveContextWindow = Math.max(0, contextWindow - summaryOutputTokens);
  const referenceThreshold = Math.max(0, effectiveContextWindow - AUTO_COMPACTION_BUFFER_TOKENS);
  const percentOverride = input.autoCompactPercentOverride;
  const percentageThreshold =
    percentOverride !== undefined &&
    Number.isFinite(percentOverride) &&
    percentOverride > 0 &&
    percentOverride <= 100
      ? Math.floor(effectiveContextWindow * (percentOverride / 100))
      : referenceThreshold;
  const ratioThreshold =
    input.autoCompactThresholdRatio !== undefined &&
    Number.isFinite(input.autoCompactThresholdRatio) &&
    input.autoCompactThresholdRatio > 0 &&
    input.autoCompactThresholdRatio < 1
      ? Math.floor(effectiveContextWindow * input.autoCompactThresholdRatio)
      : referenceThreshold;

  return {
    contextWindow,
    effectiveContextWindow,
    autoCompactThreshold: Math.min(referenceThreshold, percentageThreshold, ratioThreshold),
  };
}

export function normalizeCompactionUsage(usage: CompactionTokenUsage): NormalizedCompactionUsage {
  const cacheTokens =
    nonNegativeInteger(usage.cacheReadTokens) + nonNegativeInteger(usage.cacheWriteTokens);
  const inputTokens =
    nonNegativeInteger(usage.inputTokens) +
    (usage.cacheTokensAreSeparate === false ? 0 : cacheTokens);
  const outputTokens =
    nonNegativeInteger(usage.outputTokens) + nonNegativeInteger(usage.reasoningTokens);

  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
  };
}

export function hasReachedAutoCompactionThreshold(
  usage: CompactionTokenUsage,
  threshold: CompactionThresholdContract,
): boolean {
  return normalizeCompactionUsage(usage).totalTokens >= threshold.autoCompactThreshold;
}

export function isCompactionThresholdReached(
  usage: CompactionTokenUsage,
  input: CompactionThresholdInput,
): boolean {
  return hasReachedAutoCompactionThreshold(usage, resolveCompactionThreshold(input));
}
