/**
 * provider-options — translate OpenAWork's thinking /
 * reasoning-effort configuration into native OpenCode LLM provider options.
 *
 * The legacy upstream-request.ts hand-builds vendor-specific JSON
 * fields (`reasoning_effort`, `thinking: { type: 'enabled' }`,
 * `enable_thinking`, etc.) and merges them into the request body.
 * Native protocol adapters understand a subset of these via
 * `providerOptions.<vendor>.<field>`; for the long tail of
 * vendor-specific fields we retain a provider-scoped body record.
 * This module is the single mapping table.
 *
 * Coverage today (stay aligned with upstream-request.ts):
 *   - anthropic   → providerOptions.anthropic.thinking + sendReasoning
 *   - openai      → providerOptions.openai.reasoningEffort
 *                   (works for both OpenAI-compatible chat completions and
 *                   native OpenAI Responses models.)
 *   - openrouter  → providerOptions.openrouter.body.reasoning
 *   - deepseek    → providerOptions.deepseek.body.thinking + reasoning_effort
 *   - gemini      → providerOptions.gemini.body.google.thinking_config
 *   - qwen        → providerOptions.qwen.body.enable_thinking + thinking_budget
 *   - moonshot    → providerOptions.moonshot.body.thinking
 *   - mimo        → providerOptions.mimo.body.thinking
 *
 * 注：自 catalog 化后，这些分支由 `resolveThinkingStyle(providerType)` 派生的
 * 「风格」驱动(见 `agent-core/provider/catalog.ts`)，新增平台复用已有风格时
 * 不必在本文件新增分支。
 *
 * NOT covered yet:
 *   - OpenAI Responses API `previous_response_id` continuation.
 */

import type { ProviderOptions as NativeProviderOptions } from '@openAwork/opencode-llm';
import { resolveThinkingStyle, catalogModelSupportsThinking } from '@openAwork/agent-core';
import type { UpstreamProtocolKind } from './native-model.js';

export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type ProviderReasoningEffort = ReasoningEffort;

/**
 * 思考等级配置 — 对齐参考实现（claude-code）的设计
 *
 * 支持三种模式：
 *   1. `{ type: 'adaptive' }` — Anthropic 自适应思考（Claude 4.6+）
 *   2. `{ type: 'enabled'; budgetTokens: number }` — 显式思考预算
 *   3. `{ type: 'disabled' }` — 禁用思考
 */
export type ThinkingConfig =
  { type: 'adaptive' } | { type: 'enabled'; budgetTokens: number } | { type: 'disabled' };

/**
 * 扩展的思考配置（内部使用）— 在基础 ThinkingConfig 之上增加 Provider 元信息
 */
export interface ExtendedThinkingConfig {
  config: ThinkingConfig;
  effort?: ReasoningEffort;
  providerType: string;
  supportsThinking: boolean;
}

export interface ProviderOptionsModelInfo {
  providerID: string;
  id: string;
  api: {
    id: string;
    npm: string;
  };
}

const ANTHROPIC_THINKING_BUDGETS: Record<ReasoningEffort, number> = {
  none: 0,
  minimal: 1024,
  low: 4096,
  medium: 8192,
  high: 16384,
  xhigh: 31999,
  max: 31999,
};

const GEMINI_THINKING_BUDGETS: Record<ReasoningEffort, number> = {
  none: 0,
  minimal: 1024,
  low: 4096,
  medium: 8192,
  high: 16384,
  xhigh: 24576,
  max: 24576,
};

// Qwen DashScope thinking_budget 映射。Qwen3 系列支持 enable_thinking +
// thinking_budget（整数 Token 数）。QwQ 系列不响应这两个参数但也不会报错。
// 参考 https://help.aliyun.com/zh/model-studio/deep-thinking
const QWEN_THINKING_BUDGETS: Record<ReasoningEffort, number> = {
  none: 0,
  minimal: 512,
  low: 2048,
  medium: 8192,
  high: 16384,
  xhigh: 32768,
  max: 32768,
};

// DeepSeek reasoning_effort 映射。DeepSeek API 支持 reasoning_effort 参数，
// 取值为 "high" 或 "max"（以及省略）。我们将 5 档 effort 映射到这两个取值
// 加上省略（不发送 reasoning_effort，让上游用默认行为）。
// 参考 https://api-docs.deepseek.com/guides/thinking_mode
function deepseekReasoningEffort(effort: ReasoningEffort): string | undefined {
  switch (effort) {
    case 'none':
    case 'minimal':
    case 'low':
      // 不发送 reasoning_effort，让 DeepSeek 使用默认（较低）行为
      return undefined;
    case 'medium':
      return 'high';
    case 'high':
    case 'xhigh':
    case 'max':
      return 'max';
  }
}

// ---------------------------------------------------------------------------
// Gemini thinking-control alignment (mirrors opencode #26279).
//
// Gemini exposes two different thinking knobs depending on the model family:
//
//   gemini-2.5  → numeric `thinking_budget` token cap. Max 32_768 for the
//                 `pro` (non-flash) variant, 24_576 elsewhere. The flash and
//                 lite variants accept `thinking_budget: 0` to fully disable
//                 thinking; gemini-2.5-pro requires a non-zero budget so we
//                 send a tiny 128 to keep thinking nominally enabled.
//
//   gemini-3    → string `thinking_level`. Each sub-model exposes a different
//                 subset:
//                   gemini-3-flash-image → ['minimal', 'high']
//                   gemini-3-pro-image   → ['high']
//                   gemini-3-flash       → ['minimal', 'low', 'medium', 'high']
//                   gemini-3 (other)     → ['low', 'medium', 'high']
//
// Sending a level outside the supported subset (e.g. `low` to pro-image, or
// `medium` to flash-image) produces a 400 from the upstream. The helpers
// below clamp the requested effort into the model's supported subset.
// ---------------------------------------------------------------------------

type GeminiThinkingLevel = 'minimal' | 'low' | 'medium' | 'high';

const GEMINI_LEVEL_RANK: Record<GeminiThinkingLevel, number> = {
  minimal: 0,
  low: 1,
  medium: 2,
  high: 3,
};

function googleThinkingLevels(apiId: string): readonly GeminiThinkingLevel[] {
  if (!apiId.includes('gemini-3')) {
    // gemini-2.5 and below — fallback when callers ask "what level subset?"
    return ['low', 'high'];
  }
  if (apiId.includes('flash-image')) return ['minimal', 'high'];
  if (apiId.includes('pro-image')) return ['high'];
  if (apiId.includes('flash')) return ['minimal', 'low', 'medium', 'high'];
  return ['low', 'medium', 'high'];
}

function googleThinkingBudgetMax(apiId: string): number {
  // gemini-2.5-pro (non-flash) accepts up to 32_768; everything else 24_576.
  if (apiId.includes('2.5') && apiId.includes('pro') && !apiId.includes('flash')) {
    return 32_768;
  }
  return 24_576;
}

function googleThinkingLevelForEffort(apiId: string, effort: ReasoningEffort): GeminiThinkingLevel {
  const supported = googleThinkingLevels(apiId);
  // Map our 5-tier effort onto the 4-tier Gemini level scale.
  const requestedLevel: GeminiThinkingLevel =
    effort === 'minimal'
      ? 'minimal'
      : effort === 'low'
        ? 'low'
        : effort === 'medium'
          ? 'medium'
          : 'high'; // both 'high' and 'xhigh' map to 'high'
  if (supported.includes(requestedLevel)) return requestedLevel;
  const targetRank = GEMINI_LEVEL_RANK[requestedLevel];
  const sortedDesc = [...supported].sort((a, b) => GEMINI_LEVEL_RANK[b] - GEMINI_LEVEL_RANK[a]);
  for (const lv of sortedDesc) {
    if (GEMINI_LEVEL_RANK[lv] <= targetRank) return lv;
  }
  return sortedDesc[sortedDesc.length - 1] as GeminiThinkingLevel;
}

function googleThinkingBudgetForEffort(apiId: string, effort: ReasoningEffort): number {
  const max = googleThinkingBudgetMax(apiId);
  if (effort === 'xhigh') return max;
  return Math.min(GEMINI_THINKING_BUDGETS[effort], max);
}

function googleThinkingLowestLevel(apiId: string): GeminiThinkingLevel {
  const supported = googleThinkingLevels(apiId);
  if (supported.includes('minimal')) return 'minimal';
  if (supported.includes('low')) return 'low';
  return 'high';
}

function googleSmallThinkingBudget(apiId: string): number {
  // gemini-2.5-pro doesn't support thinking_budget=0 — drop to the smallest
  // legal non-zero budget. Other 2.5 variants accept 0 as "off".
  return googleThinkingBudgetMax(apiId) === 32_768 ? 128 : 0;
}

// ---------------------------------------------------------------------------
// GPT-5 family reasoning_effort tier alignment (mirrors opencode #26268).
//
// OpenAI does not expose every effort tier on every GPT-5 sub-model; sending
// an effort outside the supported subset produces a 400 from the upstream.
// The mapping below tracks the subsets observed in OpenAI's model docs:
//
//   gpt-5-pro                         → ['high']  (no tunable knob)
//   gpt-5-{2+}-pro                    → ['medium', 'high', 'xhigh']
//   gpt-5-{x}-chat                    → ['medium']
//   gpt-5                              → ['minimal', 'low', 'medium', 'high']
//   gpt-5.1 / gpt-5-1                 → ['none', 'low', 'medium', 'high']
//   gpt-5.{2+} (incl. nano/mini)      → ['none', 'low', 'medium', 'high', 'xhigh']
//   gpt-5-{x}-codex (v ≥ 3)           → ['low', 'medium', 'high', 'xhigh']
//   gpt-5-{x}-codex-max / v ≥ 2       → ['low', 'medium', 'high', 'xhigh']
//   gpt-5-{x}-codex (default)         → ['low', 'medium', 'high']
//   any other GPT-5 (e.g. plain 'gpt-5') → ['minimal', 'low', 'medium', 'high']
//
// The clamp picks the largest supported effort ≤ the requested effort, falling
// back to the smallest supported effort when the request is below the model's
// floor.
// ---------------------------------------------------------------------------

const EFFORT_RANK: Record<ReasoningEffort, number> = {
  none: -1,
  minimal: 0,
  low: 1,
  medium: 2,
  high: 3,
  xhigh: 4,
  max: 5,
};

function normalizeProviderReasoningEffort(effort: ProviderReasoningEffort): ReasoningEffort {
  return effort;
}

// GPT-5.5 / 5.6 use `none` and `max` directly as reasoning_effort values.
// No mapping needed — the effort values are passed through as-is.

const GPT5_FAMILY_RE = /(?:^|\/)gpt-5(?:[.-]|$)/;
const GPT5_VERSION_RE = /(?:^|\/)gpt-5[.-](\d+)(?:[.-]|$)/;
const GPT5_PRO_RE = /(?:^|\/)gpt-5[.-]?pro(?:[.-]|$)/;
const GPT5_VERSIONED_PRO_RE = /(?:^|\/)gpt-5[.-]\d+[.-]pro(?:[.-]|$)/;

const GPT5_PRO_EFFORTS: readonly ReasoningEffort[] = ['high'];
const GPT5_VERSIONED_PRO_EFFORTS: readonly ReasoningEffort[] = ['medium', 'high', 'xhigh'];
const GPT5_CHAT_EFFORTS: readonly ReasoningEffort[] = ['medium'];
const GPT5_1_EFFORTS: readonly ReasoningEffort[] = ['none', 'low', 'medium', 'high'];
const GPT5_2_PLUS_EFFORTS: readonly ReasoningEffort[] = ['none', 'low', 'medium', 'high', 'xhigh'];
const GPT5_5_EFFORTS: readonly ReasoningEffort[] = ['none', 'low', 'medium', 'high', 'xhigh'];
const GPT5_6_EFFORTS: readonly ReasoningEffort[] = [
  'none',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
];
const GPT5_CODEX_3_PLUS_EFFORTS: readonly ReasoningEffort[] = ['low', 'medium', 'high', 'xhigh'];
const GPT5_CODEX_XHIGH_EFFORTS: readonly ReasoningEffort[] = ['low', 'medium', 'high', 'xhigh'];
const GPT5_CODEX_DEFAULT_EFFORTS: readonly ReasoningEffort[] = ['low', 'medium', 'high'];
const GPT5_DEFAULT_EFFORTS: readonly ReasoningEffort[] = ['minimal', 'low', 'medium', 'high'];

function gpt5Version(apiId: string): number | undefined {
  const match = GPT5_VERSION_RE.exec(apiId);
  if (!match) return undefined;
  const v = Number(match[1]);
  return Number.isFinite(v) ? v : undefined;
}

function gpt5SupportedEfforts(apiId: string): readonly ReasoningEffort[] | undefined {
  if (!GPT5_FAMILY_RE.test(apiId)) return undefined;
  if (apiId.includes('-chat')) {
    // chat models only expose `medium`
    return GPT5_CHAT_EFFORTS;
  }
  if (GPT5_VERSIONED_PRO_RE.test(apiId)) return GPT5_VERSIONED_PRO_EFFORTS;
  if (GPT5_PRO_RE.test(apiId)) return GPT5_PRO_EFFORTS;
  if (apiId.includes('codex')) {
    const version = gpt5Version(apiId);
    if (version !== undefined && version >= 3) return GPT5_CODEX_3_PLUS_EFFORTS;
    if (apiId.includes('codex-max') || (version !== undefined && version >= 2)) {
      return GPT5_CODEX_XHIGH_EFFORTS;
    }
    return GPT5_CODEX_DEFAULT_EFFORTS;
  }
  const version = gpt5Version(apiId);
  if (version === 5) return GPT5_5_EFFORTS;
  if (version === 6) return GPT5_6_EFFORTS;
  // 未来次版本（5.7、5.8...）继承已知最高档位（5.6），而不是掉回更窄的默认集合。
  if (version !== undefined && version > 6) return GPT5_6_EFFORTS;
  if (version === 1) return GPT5_1_EFFORTS;
  if (version !== undefined && version >= 2) return GPT5_2_PLUS_EFFORTS;
  return GPT5_DEFAULT_EFFORTS;
}

/**
 * Clamp a requested {@link ReasoningEffort} to the subset supported by
 * `modelId`. Returns the requested effort unchanged when:
 *   - the model is not part of the GPT-5 family, or
 *   - the requested effort is already in the supported subset.
 *
 * Otherwise picks the largest supported effort that does not exceed the
 * requested effort (conservative downgrade), or the smallest supported
 * effort when the request is below the model's floor.
 *
 * Mirrors opencode #26268.
 */
export function clampReasoningEffortForModel(
  modelId: string,
  requested: ProviderReasoningEffort,
): ReasoningEffort {
  const id = modelId.toLowerCase();
  const normalized = normalizeProviderReasoningEffort(requested);
  const supported = gpt5SupportedEfforts(id);
  if (!supported || supported.length === 0) return normalized;
  if (supported.includes(normalized)) return normalized;
  const targetRank = EFFORT_RANK[normalized];
  const sortedDesc = [...supported].sort((a, b) => EFFORT_RANK[b] - EFFORT_RANK[a]);
  for (const eff of sortedDesc) {
    if (EFFORT_RANK[eff] <= targetRank) return eff;
  }
  // Requested is below every supported tier — return the smallest supported.
  return sortedDesc[sortedDesc.length - 1] as ReasoningEffort;
}

// Anthropic opus/sonnet major >= 4 视为思考模型；3.7 是数值区间之外的显式例外。
function isAnthropicReasoningModel(id: string): boolean {
  if (id.includes('claude-3-7-sonnet')) return true;
  const match = /claude-(?:opus|sonnet)-(\d+)/.exec(id);
  if (!match) return false;
  const major = Number(match[1]);
  return Number.isFinite(major) && major >= 4;
}

// Gemini major.minor >= 2.5 视为思考模型（2.5 / 3.x / 未来 4.x...）。
function isGeminiReasoningModel(id: string): boolean {
  const match = /gemini-(\d+)(?:\.(\d+))?/.exec(id);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = match[2] !== undefined ? Number(match[2]) : 0;
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return false;
  return major > 2 || (major === 2 && minor >= 5);
}

function supportsOpenRouterReasoning(model: string): boolean {
  // 与 catalog / 前端 isOpenRouterReasoningModel 对齐：不要用裸 `gpt` 匹配。
  // o 系列用 `o\d+` 泛化匹配未来代号（o1/o3/o4/o5...）。
  const id = model.toLowerCase();
  return (
    /(?:^|\/)(?:gpt-5(?:[.-]|$)|o\d+(?:[.-]|$))/.test(id) ||
    isAnthropicReasoningModel(id) ||
    isGeminiReasoningModel(id) ||
    id.includes('deepseek-r') ||
    id.includes('reasoner') ||
    id.includes('thinking')
  );
}

const SLUG_OVERRIDES: Record<string, string> = {
  amazon: 'bedrock',
};

function nativeProviderKey(npm: string): string | undefined {
  switch (npm) {
    case 'copilot':
      return 'copilot';
    case 'azure':
      return 'azure';
    case 'openai':
      return 'openai';
    case 'bedrock':
      return 'bedrock';
    case 'anthropic':
    case 'vertex-anthropic':
      return 'anthropic';
    case 'vertex':
      return 'vertex';
    case 'google':
      return 'google';
    case 'gateway':
      return 'gateway';
    default:
      return undefined;
  }
}

function nativeProviderKeyForType(providerType: string): string {
  if (providerType === 'anthropic' || providerType === 'claude') {
    return 'anthropic';
  }
  if (providerType === 'azure') {
    return 'azure';
  }
  if (providerType === 'copilot' || providerType === 'github-copilot') {
    return 'copilot';
  }
  if (providerType.includes('bedrock')) {
    return 'bedrock';
  }
  if (providerType === 'gateway') {
    return 'gateway';
  }
  if (providerType === 'openai') return 'openai';
  return 'openai-compatible';
}

export function buildProviderOptionsModelInfo(input: {
  providerType: string;
  model: string;
  sdkNpmOverride?: string;
}): ProviderOptionsModelInfo {
  const providerID = input.providerType.toLowerCase();
  return {
    providerID,
    id: input.model,
    api: {
      id: input.model,
      npm: input.sdkNpmOverride ?? nativeProviderKeyForType(providerID),
    },
  };
}

function shouldUseOpenAICompatibleBodyFlatten(
  providerType: string,
  style: ReturnType<typeof resolveThinkingStyle>,
): boolean {
  if (providerType !== 'openai') {
    return false;
  }
  return (
    style === 'openrouter_reasoning' ||
    style === 'deepseek_thinking' ||
    style === 'gemini_thinking' ||
    style === 'qwen_enable_thinking' ||
    style === 'body_thinking_type'
  );
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type ProviderOptionsRecord = Record<string, unknown>;

function isRecord(value: unknown): value is ProviderOptionsRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mergeDeep(
  target: ProviderOptionsRecord,
  source: ProviderOptionsRecord,
): ProviderOptionsRecord {
  const result: ProviderOptionsRecord = { ...target };
  for (const [key, value] of Object.entries(source)) {
    const current = result[key];
    result[key] = isRecord(current) && isRecord(value) ? mergeDeep(current, value) : value;
  }
  return result;
}

export function mergeProviderOptions(
  ...items: Array<NativeProviderOptions | undefined>
): NativeProviderOptions | undefined {
  const merged = items.reduce<ProviderOptionsRecord>((acc, item) => {
    if (!item) return acc;
    return mergeDeep(acc, item);
  }, {});
  const native = Object.fromEntries(
    Object.entries(merged).filter((entry): entry is [string, ProviderOptionsRecord] =>
      isRecord(entry[1]),
    ),
  );
  return Object.keys(native).length > 0 ? native : undefined;
}

export function providerOptions(
  model: ProviderOptionsModelInfo,
  options: Record<string, unknown>,
): NativeProviderOptions {
  if (model.api.npm === 'gateway') {
    const i = model.api.id.indexOf('/');
    const rawSlug = i > 0 ? model.api.id.slice(0, i) : undefined;
    const slug = rawSlug ? (SLUG_OVERRIDES[rawSlug] ?? rawSlug) : undefined;
    const gateway = options['gateway'];
    const rest: Record<string, unknown> = Object.fromEntries(
      Object.entries(options).filter(([key]) => key !== 'gateway'),
    );
    const has = Object.keys(rest).length > 0;

    const result: Record<string, Record<string, unknown>> = {};
    if (isRecord(gateway)) result['gateway'] = gateway;

    if (has) {
      if (slug) {
        result[slug] = rest;
      } else if (isJsonRecord(gateway)) {
        result['gateway'] = { ...gateway, ...rest };
      } else {
        result['gateway'] = rest;
      }
    }

    return result;
  }

  const usesDotSplitOptions =
    model.api.npm === 'openai-compatible' ||
    model.api.npm === 'openai' ||
    model.api.npm === 'anthropic';
  const key =
    nativeProviderKey(model.api.npm) ??
    (usesDotSplitOptions ? (model.providerID.split('.')[0] ?? model.providerID) : model.providerID);

  if (model.api.npm === 'azure') {
    return { openai: options, azure: options };
  }

  // Native OpenAI-compatible routes expect provider-scoped fields directly,
  // so flatten the legacy body envelope before returning them.
  if (model.api.npm === 'openai-compatible' && 'body' in options) {
    const { body, ...rest } = options;
    const merged = { ...(isRecord(body) ? body : {}), ...rest };
    return { [key]: merged };
  }

  return { [key]: options };
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

/**
 * Build the native `providerOptions` payload for a given thinking
 * config + model. Returns `undefined` when no provider-specific tuning
 * is required (most callers will then omit the field entirely).
 */
export function buildProviderOptions(input: {
  thinking?: ThinkingConfig | ExtendedThinkingConfig;
  model: string;
  providerType?: string;
  upstreamProtocol?: UpstreamProtocolKind;
}): NativeProviderOptions | undefined {
  const { thinking } = input;
  if (!thinking) {
    return undefined;
  }

  // 判断是新版 ThinkingConfig 还是旧版 ExtendedThinkingConfig
  const isExtendedConfig = 'config' in thinking;
  const thinkingConfig: ThinkingConfig = isExtendedConfig ? thinking.config : thinking;
  const configuredProviderType = isExtendedConfig
    ? thinking.providerType
    : (input.providerType ?? 'anthropic');
  const providerType =
    input.upstreamProtocol === 'anthropic_messages'
      ? 'anthropic'
      : input.upstreamProtocol === 'responses'
        ? 'openai'
        : configuredProviderType;
  const supportsThinking = isExtendedConfig ? thinking.supportsThinking : true;

  // 调试日志
  console.log('[DEBUG buildProviderOptions] 输入参数:', {
    model: input.model,
    isExtendedConfig,
    thinkingConfig,
    providerType,
    supportsThinking,
  });

  // 对于新版 ThinkingConfig，通过 catalog 推断支持情况
  const inferredStyle = resolveThinkingStyle(providerType, input.model);
  const catalogSupports = catalogModelSupportsThinking(providerType, input.model);

  const effectiveSupportsThinking =
    supportsThinking === true || (inferredStyle !== 'none' && catalogSupports);

  if (!effectiveSupportsThinking) {
    return undefined;
  }

  const model = input.model.toLowerCase();
  const style = inferredStyle;
  const normalizedProviderType = providerType.toLowerCase();
  const modelInfo = buildProviderOptionsModelInfo({
    providerType,
    model: input.model,
    ...(shouldUseOpenAICompatibleBodyFlatten(normalizedProviderType, style)
      ? { sdkNpmOverride: 'openai-compatible' }
      : {}),
  });

  switch (style) {
    case 'anthropic_budget': {
      const anthropic: Record<string, unknown> = {
        // We always send reasoning back to upstream so multi-turn
        // tool flows preserve thinking continuity (matches the
        // legacy renderer's behaviour for Anthropic/Claude routes).
        sendReasoning: true,
      };

      // 处理三种思考模式
      if (thinkingConfig.type === 'adaptive') {
        // Adaptive thinking — Claude 4.6+
        const supportsAdaptive = modelSupportsAdaptiveThinking(input.model, providerType);
        console.log('[DEBUG anthropic_budget] adaptive 模式检测:', {
          model: input.model,
          providerType,
          supportsAdaptive,
        });

        if (supportsAdaptive) {
          anthropic['thinking'] = { type: 'adaptive' };
          console.log('[DEBUG anthropic_budget] 使用 adaptive thinking');
        } else {
          // 模型不支持 adaptive，降级为 enabled + 默认预算
          anthropic['thinking'] = {
            type: 'enabled',
            budgetTokens: ANTHROPIC_THINKING_BUDGETS['medium'],
          };
          console.log('[DEBUG anthropic_budget] adaptive 降级为 enabled，budgetTokens=8192');
        }
      } else if (thinkingConfig.type === 'enabled') {
        anthropic['thinking'] = {
          type: 'enabled',
          budgetTokens: thinkingConfig.budgetTokens,
        };
        console.log(
          '[DEBUG anthropic_budget] 使用 enabled，budgetTokens=',
          thinkingConfig.budgetTokens,
        );
      } else {
        // type === 'disabled'
        anthropic['thinking'] = { type: 'disabled' };
        console.log('[DEBUG anthropic_budget] thinking 已禁用');
      }

      const result = providerOptions(modelInfo, anthropic);
      console.log(
        '[DEBUG anthropic_budget] 最终 providerOptions:',
        JSON.stringify(result, null, 2),
      );
      return result;
    }

    case 'openai_effort': {
      if (thinkingConfig.type === 'disabled') {
        return undefined;
      }
      // 从 ThinkingConfig 推断 effort（adaptive 模式使用 medium 作为默认）
      const effort: ReasoningEffort =
        thinkingConfig.type === 'adaptive'
          ? 'medium'
          : isExtendedConfig && thinking.effort
            ? thinking.effort
            : 'medium';
      // GPT-5 sub-models accept different reasoning_effort subsets;
      // clamp before send to avoid 400s on e.g. gpt-5.1 (no `minimal`),
      // gpt-5-pro (only `high`), gpt-5-chat (only `medium`).
      // GPT-5.5/5.6 use `none`/`max` as native effort values.

      const clampedEffort = clampReasoningEffortForModel(input.model, effort);

      // Chat Completions API 和 Responses API 需要不同的参数传递方式：
      //
      // 1. Chat Completions (native OpenAI-compatible route):
      //    providerOptions[name] 下的字段直接作为请求体顶层字段。
      //    例如：{ openai: { reasoning_effort: 'high' } } → body 中 reasoning_effort='high'
      //
      // 2. Responses API uses the native OpenAI provider key.
      if (modelInfo.api.npm === 'openai') {
        return providerOptions(modelInfo, { reasoningEffort: clampedEffort });
      }

      // Chat Completions API: pass the native reasoning field directly.
      return providerOptions(modelInfo, {
        reasoning_effort: clampedEffort,
      });
    }

    case 'openrouter_reasoning': {
      if (!supportsOpenRouterReasoning(model)) {
        return undefined;
      }
      if (thinkingConfig.type === 'disabled') {
        return providerOptions(modelInfo, {
          body: { reasoning: { enabled: false } },
        });
      }
      // OpenRouter routes GPT-5 traffic to OpenAI; the same per-model
      // effort subset rules apply when the upstream is GPT-5.
      const effort: ReasoningEffort =
        thinkingConfig.type === 'adaptive'
          ? 'medium'
          : isExtendedConfig && thinking.effort
            ? thinking.effort
            : 'medium';
      const openRouterEffort = clampReasoningEffortForModel(input.model, effort);
      return providerOptions(modelInfo, {
        body: {
          reasoning: { effort: openRouterEffort },
        },
      });
    }

    case 'deepseek_thinking': {
      // DeepSeek-Reasoner exposes thinking via the model id; only
      // non-reasoner deepseek models need the explicit toggle.
      if (model.includes('reasoner')) {
        return undefined;
      }
      // DeepSeek API 默认 thinking=enabled。用户关闭时需要显式下发
      // thinking: { type: 'disabled' } 才能真正关闭思考。
      if (thinkingConfig.type === 'disabled') {
        return providerOptions(modelInfo, {
          body: { thinking: { type: 'disabled' } },
        });
      }
      // DeepSeek API 支持 thinking + reasoning_effort 两个参数：
      //   - thinking: { type: 'enabled' } 开启思维链
      //   - reasoning_effort: 'high' | 'max' 控制推理力度
      // minimal/low 不发送 reasoning_effort（让上游用默认行为）。
      const effort: ReasoningEffort =
        thinkingConfig.type === 'adaptive'
          ? 'medium'
          : isExtendedConfig && thinking.effort
            ? thinking.effort
            : 'medium';
      const effortParam = deepseekReasoningEffort(effort);
      return providerOptions(modelInfo, {
        body: {
          thinking: { type: 'enabled' },
          ...(effortParam ? { reasoning_effort: effortParam } : {}),
        },
      });
    }

    case 'gemini_thinking': {
      // Gemini 通过 OpenAI 兼容端点接入时，thinking_config 直接作为请求体
      // 顶层字段 google.thinking_config 传递。注意：extra_body 是旧 OpenAI 客户端库
      // 客户端库的概念，原生 HTTP 请求不应包含 extra_body 包裹层。
      if (thinkingConfig.type === 'disabled') {
        if (model.includes('gemini-3')) {
          // gemini-3 only accepts thinking_level (string), not numeric
          // thinking_budget. Use the lowest supported level for "off".
          return providerOptions(modelInfo, {
            body: {
              google: {
                thinking_config: { thinking_level: googleThinkingLowestLevel(model) },
              },
            },
          });
        }
        return providerOptions(modelInfo, {
          body: {
            google: { thinking_config: { thinking_budget: googleSmallThinkingBudget(model) } },
          },
        });
      }
      const effort: ReasoningEffort =
        thinkingConfig.type === 'adaptive'
          ? 'medium'
          : isExtendedConfig && thinking.effort
            ? thinking.effort
            : 'medium';
      if (model.includes('gemini-3')) {
        return providerOptions(modelInfo, {
          body: {
            google: {
              thinking_config: {
                include_thoughts: true,
                thinking_level: googleThinkingLevelForEffort(model, effort),
              },
            },
          },
        });
      }
      return providerOptions(modelInfo, {
        body: {
          google: {
            thinking_config: {
              include_thoughts: true,
              thinking_budget: googleThinkingBudgetForEffort(model, effort),
            },
          },
        },
      });
    }

    case 'qwen_enable_thinking': {
      // Qwen3 系列：enable_thinking 开关 + thinking_budget 力度控制。
      // QwQ 系列不响应这两个参数但也不会报错，所以统一下发即可。
      if (thinkingConfig.type === 'disabled') {
        return providerOptions(modelInfo, {
          body: { enable_thinking: false },
        });
      }
      const effort: ReasoningEffort =
        thinkingConfig.type === 'adaptive'
          ? 'medium'
          : isExtendedConfig && thinking.effort
            ? thinking.effort
            : 'medium';
      return providerOptions(modelInfo, {
        body: {
          enable_thinking: true,
          thinking_budget: QWEN_THINKING_BUDGETS[effort],
        },
      });
    }

    case 'body_thinking_type': {
      // body.thinking = { type: 'enabled' | 'disabled' } —— Moonshot / 小米 MiMo
      // 等使用这种 chat-completions body 字段。部分平台仅特定模型支持(如
      // Moonshot 仅 kimi-k2.5 系列)，由 catalog 的 thinkingModelMatcher 决定。
      if (!catalogModelSupportsThinking(providerType, model)) {
        return undefined;
      }
      // MiMo V2.5+ 支持 reasoning_effort 参数（low/medium/high），
      // 在 thinking 开启时一并下发，与 DeepSeek "deepseek" 格式一致。
      if (providerType === 'mimo' && thinkingConfig.type !== 'disabled') {
        const effort: ReasoningEffort =
          thinkingConfig.type === 'adaptive'
            ? 'medium'
            : isExtendedConfig && thinking.effort
              ? thinking.effort
              : 'medium';
        const mimoSupported: ReasoningEffort[] = ['low', 'medium', 'high'];
        const mimoEffort = mimoSupported.includes(effort)
          ? effort
          : (() => {
              const rank = EFFORT_RANK[effort];
              const sorted = [...mimoSupported].sort((a, b) => EFFORT_RANK[a] - EFFORT_RANK[b]);
              for (const eff of [...sorted].reverse()) {
                if (EFFORT_RANK[eff] <= rank) return eff;
              }
              return sorted[0] as ReasoningEffort;
            })();
        return providerOptions(modelInfo, {
          body: {
            thinking: { type: 'enabled' },
            reasoning_effort: mimoEffort,
          },
        });
      }
      return providerOptions(modelInfo, {
        body: {
          thinking: { type: thinkingConfig.type === 'disabled' ? 'disabled' : 'enabled' },
        },
      });
    }

    case 'none':
    default:
      return undefined;
  }
}

export function buildBaseProviderOptions(input: {
  providerType?: string;
  model: string;
  sessionId?: string;
  openaiFastMode?: boolean;
}): NativeProviderOptions | undefined {
  const providerType = (input.providerType ?? '').toLowerCase();
  if (!providerType) return undefined;
  const modelInfo = buildProviderOptionsModelInfo({
    providerType,
    model: input.model,
  });
  const model = input.model.toLowerCase();

  if (input.openaiFastMode === true && providerType !== 'openai') {
    return providerOptions(
      buildProviderOptionsModelInfo({ providerType: 'openai', model: input.model }),
      { serviceTier: 'priority' },
    );
  }

  if (providerType === 'openai') {
    // OpenAI's prompt cache hits are keyed by `prompt_cache_key`. Without
    // it, concurrent sessions in the same org evict each other's prefix
    // cache entries (matches opencode `transform.ts` `options()`).
    return providerOptions(modelInfo, {
      store: false,
      ...(input.sessionId ? { promptCacheKey: input.sessionId } : {}),
      ...(input.openaiFastMode === true ? { serviceTier: 'priority' } : {}),
    });
  }

  if (providerType === 'azure') {
    return providerOptions(modelInfo, {
      store: false,
      ...(input.sessionId ? { promptCacheKey: input.sessionId } : {}),
    });
  }

  if (providerType === 'copilot' || providerType === 'github-copilot') {
    return providerOptions(modelInfo, { store: false });
  }

  if (providerType === 'openrouter' || providerType === 'llmgateway') {
    return providerOptions(modelInfo, {
      usage: { include: true },
      // OpenRouter expects snake_case `prompt_cache_key`.
      ...(input.sessionId ? { prompt_cache_key: input.sessionId } : {}),
      ...(model.includes('gemini-3') ? { reasoning: { effort: 'high' } } : {}),
    });
  }

  if (providerType === 'venice') {
    return providerOptions(modelInfo, {
      ...(input.sessionId ? { promptCacheKey: input.sessionId } : {}),
    });
  }

  if (providerType === 'gateway') {
    // Vercel AI Gateway exposes its own caching toggle.
    return providerOptions(modelInfo, { gateway: { caching: 'auto' } });
  }

  return undefined;
}
