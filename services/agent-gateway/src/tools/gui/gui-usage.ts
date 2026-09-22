/**
 * T-15：GUI 内循环的 token 用量聚合与入账。
 *
 * 背景：`computer_use` 的内层 VLM 调用走 `requestLookAtText`，每一步都会消耗
 * 上游 token（含多张截图的上行）。若不聚合入账，这部分消耗对用户完全不可见。
 *
 * 设计：把「跨步累加」与「入账」拆成纯函数 + 一次副作用调用，便于单测，
 * 且保证调用方在 GUI 任务失败时也能把已发生的消耗记上。
 */

/** 单步上游调用回传的用量。 */
export interface GuiStepUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
}

/** 跨步累加后的用量（字段与 `persistMonthlyUsageRecord` 的 `usage` 入参对齐）。 */
export interface GuiAggregatedUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  /** 累计的模型调用步数，便于观测与测试。 */
  readonly steps: number;
}

export const EMPTY_GUI_USAGE: GuiAggregatedUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  steps: 0,
};

/** 把非有限/负数计为 0，避免上游异常值污染累计账目。 */
function safeCount(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * 累加一步用量，返回**新对象**（不可变，避免调用方持有的引用被悄悄改写）。
 */
export function accumulateGuiUsage(
  current: GuiAggregatedUsage,
  step: GuiStepUsage,
): GuiAggregatedUsage {
  return {
    inputTokens: current.inputTokens + safeCount(step.inputTokens),
    outputTokens: current.outputTokens + safeCount(step.outputTokens),
    cacheReadTokens: current.cacheReadTokens + safeCount(step.cacheReadTokens),
    cacheWriteTokens: current.cacheWriteTokens + safeCount(step.cacheWriteTokens),
    steps: current.steps + 1,
  };
}

/** 是否值得写入用量表（全 0 时写入无意义，且 `persistMonthlyUsageRecord` 会直接返回）。 */
export function hasBillableGuiUsage(usage: GuiAggregatedUsage): boolean {
  return (
    usage.inputTokens > 0 ||
    usage.outputTokens > 0 ||
    usage.cacheReadTokens > 0 ||
    usage.cacheWriteTokens > 0
  );
}
