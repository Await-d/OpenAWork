/**
 * thinking-config — OpenAWork 思考等级配置类型定义
 *
 * 对齐参考实现（claude-code）的 ThinkingConfig 设计，同时保留跨 Provider 兼容能力。
 *
 * 设计理念：
 *   - 支持 Anthropic 的 adaptive thinking（Claude 4.6+ 核心特性）
 *   - 通过 effort 抽象统一各家厂商的思考控制参数
 *   - 向后兼容现有的 enabled + effort 组合方式
 */

/**
 * 思考等级配置 — 联合类型，支持三种模式：
 *
 * 1. `{ type: 'adaptive' }` — Anthropic 自适应思考（Claude 4.6+）
 *    模型根据任务复杂度自动调整思考深度，无需指定 budgetTokens。
 *
 * 2. `{ type: 'enabled'; budgetTokens: number }` — 显式思考预算
 *    为模型分配固定的思考 token 预算，适用于所有支持思考的模型。
 *
 * 3. `{ type: 'disabled' }` — 禁用思考
 *    模型直接生成回复，不进行显式推理。
 */
export type ThinkingConfig =
  | { type: 'adaptive' }
  | { type: 'enabled'; budgetTokens: number }
  | { type: 'disabled' };

/**
 * 推理力度枚举 — 7 档统一抽象，映射到各家厂商的实际参数
 */
export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/**
 * 扩展的思考配置（内部使用） — 在基础 ThinkingConfig 之上增加 Provider 元信息
 */
export interface ExtendedThinkingConfig {
  /** 基础思考配置 */
  config: ThinkingConfig;
  /** 可选的 effort 建议（当 type='enabled' 时，用于从 effort 推断 budgetTokens） */
  effort?: ReasoningEffort;
  /** Provider 类型（用于选择正确的思考风格） */
  providerType: string;
  /** 模型是否支持思考（catalog 推断或显式配置） */
  supportsThinking: boolean;
}

/**
 * 从 effort 推断 Anthropic 思考预算的映射表
 */
export const ANTHROPIC_THINKING_BUDGETS: Record<ReasoningEffort, number> = {
  none: 0,
  minimal: 1024,
  low: 4096,
  medium: 8192,
  high: 16384,
  xhigh: 31999,
  max: 31999,
};

/**
 * 从 effort 推断 Gemini 思考预算的映射表
 */
export const GEMINI_THINKING_BUDGETS: Record<ReasoningEffort, number> = {
  none: 0,
  minimal: 1024,
  low: 4096,
  medium: 8192,
  high: 16384,
  xhigh: 24576,
  max: 24576,
};

/**
 * 从 effort 推断 Qwen 思考预算的映射表
 */
export const QWEN_THINKING_BUDGETS: Record<ReasoningEffort, number> = {
  none: 0,
  minimal: 512,
  low: 2048,
  medium: 8192,
  high: 16384,
  xhigh: 32768,
  max: 32768,
};

/**
 * 从旧版 API（thinkingEnabled + reasoningEffort）构建 ThinkingConfig
 *
 * 用于向后兼容现有的请求参数格式。
 */
export function buildThinkingConfigFromLegacyParams(input: {
  thinkingEnabled?: boolean;
  reasoningEffort?: ReasoningEffort;
  providerType: string;
  modelId: string;
}): ThinkingConfig {
  // 如果显式禁用思考
  if (input.thinkingEnabled === false) {
    return { type: 'disabled' };
  }

  // 如果未指定 thinkingEnabled，默认启用
  const effort = input.reasoningEffort ?? 'medium';

  // 根据 Provider 类型选择预算映射表
  const budgetMap = input.providerType.toLowerCase().includes('gemini')
    ? GEMINI_THINKING_BUDGETS
    : input.providerType.toLowerCase().includes('qwen')
      ? QWEN_THINKING_BUDGETS
      : ANTHROPIC_THINKING_BUDGETS;

  const budgetTokens = budgetMap[effort];

  return {
    type: 'enabled',
    budgetTokens,
  };
}

/**
 * 从新版 API（thinking 对象）解析 ThinkingConfig
 *
 * 支持参考实现的三种模式：adaptive / enabled+budgetTokens / disabled
 */
export function parseThinkingConfigFromRequest(thinking: unknown): ThinkingConfig | undefined {
  if (!thinking || typeof thinking !== 'object') {
    return undefined;
  }

  const obj = thinking as Record<string, unknown>;

  // adaptive 模式
  if (obj.type === 'adaptive') {
    return { type: 'adaptive' };
  }

  // enabled 模式
  if (obj.type === 'enabled') {
    const budgetTokens =
      typeof obj.budgetTokens === 'number' && obj.budgetTokens > 0 ? obj.budgetTokens : 8192;
    return { type: 'enabled', budgetTokens };
  }

  // disabled 模式
  if (obj.type === 'disabled') {
    return { type: 'disabled' };
  }

  return undefined;
}

/**
 * 检查模型是否支持 adaptive thinking
 *
 * 对齐参考实现的判定逻辑：
 *   - Claude 4.6+ (opus-4-6, sonnet-4-6)
 *   - 未来新模型在 1P/Foundry 上默认支持
 */
export function modelSupportsAdaptiveThinking(modelId: string, providerType: string): boolean {
  const canonical = modelId.toLowerCase();

  // Claude 4.6+ 系列
  if (canonical.includes('opus-4-6') || canonical.includes('sonnet-4-6')) {
    return true;
  }

  // 排除已知的旧模型
  if (canonical.includes('opus') || canonical.includes('sonnet') || canonical.includes('haiku')) {
    return false;
  }

  // 1P 和 Foundry 上的未知模型默认支持（与参考实现对齐）
  const provider = providerType.toLowerCase();
  return provider === 'anthropic' || provider === 'claude' || provider === 'foundry';
}
