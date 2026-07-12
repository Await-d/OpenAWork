/**
 * provider-options — translate OpenAWork's "thinking" /
 * reasoning-effort configuration into the AI SDK
 * `providerOptions` payload that `streamText` / `generateText` accept.
 *
 * The legacy upstream-request.ts hand-builds vendor-specific JSON
 * fields (`reasoning_effort`, `thinking: { type: 'enabled' }`,
 * `enable_thinking`, etc.) and merges them into the request body.
 * AI SDK already understands a subset of these via
 * `providerOptions.<vendor>.<field>`; for the long tail of
 * vendor-specific fields we still need to spill into
 * `providerOptions.<provider>.body` (extra body fields). This
 * module is the single mapping table.
 *
 * Coverage today (stay aligned with upstream-request.ts):
 *   - anthropic   → providerOptions.anthropic.thinking + sendReasoning
 *   - openai      → providerOptions.openai.reasoningEffort
 *                   (works for both OpenAI-compatible chat completions and
 *                   @ai-sdk/openai Responses models.)
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
 *   - OpenAI Responses API `previous_response_id` continuation
 *     (requires `@ai-sdk/openai`; tracked in PROGRESS.md as Phase D
 *     follow-up).
 */

import type { JSONValue, SharedV2ProviderOptions } from '@ai-sdk/provider';
import { resolveThinkingStyle, catalogModelSupportsThinking } from '@openAwork/agent-core';

export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type ProviderReasoningEffort = ReasoningEffort;

export interface ThinkingConfig {
  enabled: boolean;
  effort: ProviderReasoningEffort;
  /** Provider type (e.g. 'anthropic', 'openai', 'qwen', 'moonshot'). */
  providerType: string;
  /** Whether the upstream model is known to support thinking. */
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
//   gpt-5.1 / gpt-5-1                 → ['low', 'medium', 'high']
//   gpt-5.{2+} (incl. nano/mini)      → ['low', 'medium', 'high', 'xhigh']
//   gpt-5-{x}-codex (v ≥ 3)           → ['low', 'medium', 'high', 'xhigh']
//   gpt-5-{x}-codex-max / v ≥ 2       → ['low', 'medium', 'high', 'xhigh']
//   gpt-5-{x}-codex (default)         → ['low', 'medium', 'high']
//   any other GPT-5 (e.g. plain 'gpt-5') → full ['low', 'medium', 'high', 'xhigh']
//
// OpenAWork's `ReasoningEffort` does not include `'none'`, so the lower bound
// is `'low'`. The clamp picks the largest supported effort ≤ the requested
// effort, falling back to the smallest supported effort when the request is
// below the model's floor.
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
const GPT5_1_EFFORTS: readonly ReasoningEffort[] = ['low', 'medium', 'high'];
const GPT5_2_PLUS_EFFORTS: readonly ReasoningEffort[] = ['low', 'medium', 'high', 'xhigh'];
const GPT5_5_EFFORTS: readonly ReasoningEffort[] = ['none', 'low', 'medium', 'high', 'xhigh'];
const GPT5_6_EFFORTS: readonly ReasoningEffort[] = ['none', 'low', 'medium', 'high', 'max'];
const GPT5_CODEX_3_PLUS_EFFORTS: readonly ReasoningEffort[] = ['low', 'medium', 'high', 'xhigh'];
const GPT5_CODEX_XHIGH_EFFORTS: readonly ReasoningEffort[] = ['low', 'medium', 'high', 'xhigh'];
const GPT5_CODEX_DEFAULT_EFFORTS: readonly ReasoningEffort[] = ['low', 'medium', 'high'];
const GPT5_DEFAULT_EFFORTS: readonly ReasoningEffort[] = ['low', 'medium', 'high', 'xhigh'];

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

function supportsOpenRouterReasoning(model: string): boolean {
  return model.includes('gpt') || model.includes('claude') || model.includes('gemini-3');
}

const SLUG_OVERRIDES: Record<string, string> = {
  amazon: 'bedrock',
};

function sdkKey(npm: string): string | undefined {
  switch (npm) {
    case '@ai-sdk/github-copilot':
      return 'copilot';
    case '@ai-sdk/azure':
      return 'azure';
    case '@ai-sdk/openai':
      return 'openai';
    case '@ai-sdk/amazon-bedrock':
      return 'bedrock';
    case '@ai-sdk/anthropic':
    case '@ai-sdk/google-vertex/anthropic':
      return 'anthropic';
    case '@ai-sdk/google-vertex':
      return 'vertex';
    case '@ai-sdk/google':
      return 'google';
    case '@ai-sdk/gateway':
      return 'gateway';
    default:
      return undefined;
  }
}

function sdkNpmForProviderType(providerType: string): string {
  if (providerType === 'anthropic' || providerType === 'claude') {
    return '@ai-sdk/anthropic';
  }
  if (providerType === 'azure') {
    return '@ai-sdk/azure';
  }
  if (providerType === 'copilot' || providerType === 'github-copilot') {
    return '@ai-sdk/github-copilot';
  }
  if (providerType.includes('bedrock')) {
    return '@ai-sdk/amazon-bedrock';
  }
  if (providerType === 'gateway') {
    return '@ai-sdk/gateway';
  }
  return '@ai-sdk/openai-compatible';
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
      npm: input.sdkNpmOverride ?? sdkNpmForProviderType(providerID),
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

function isJsonRecord(value: unknown): value is Record<string, JSONValue> {
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
  ...items: Array<SharedV2ProviderOptions | undefined>
): SharedV2ProviderOptions | undefined {
  const merged = items.reduce<ProviderOptionsRecord>((acc, item) => {
    if (!item) return acc;
    return mergeDeep(acc, item);
  }, {});
  return Object.keys(merged).length > 0 ? (merged as SharedV2ProviderOptions) : undefined;
}

export function providerOptions(
  model: ProviderOptionsModelInfo,
  options: Record<string, JSONValue>,
): SharedV2ProviderOptions {
  if (model.api.npm === '@ai-sdk/gateway') {
    const i = model.api.id.indexOf('/');
    const rawSlug = i > 0 ? model.api.id.slice(0, i) : undefined;
    const slug = rawSlug ? (SLUG_OVERRIDES[rawSlug] ?? rawSlug) : undefined;
    const gateway = options['gateway'];
    const rest = Object.fromEntries(
      Object.entries(options).filter(([key]) => key !== 'gateway'),
    ) as Record<string, JSONValue>;
    const has = Object.keys(rest).length > 0;

    const result: Record<string, unknown> = {};
    if (gateway !== undefined) result['gateway'] = gateway;

    if (has) {
      if (slug) {
        result[slug] = rest;
      } else if (isJsonRecord(gateway)) {
        result['gateway'] = { ...gateway, ...rest };
      } else {
        result['gateway'] = rest;
      }
    }

    return result as SharedV2ProviderOptions;
  }

  const usesDotSplitOptions =
    model.api.npm === '@ai-sdk/openai-compatible' ||
    model.api.npm === '@ai-sdk/openai' ||
    model.api.npm === '@ai-sdk/anthropic';
  const key =
    sdkKey(model.api.npm) ??
    (usesDotSplitOptions ? (model.providerID.split('.')[0] ?? model.providerID) : model.providerID);

  if (model.api.npm === '@ai-sdk/azure') {
    return { openai: options, azure: options };
  }

  // @ai-sdk/openai-compatible 会把 providerOptions[name] 下的所有 key 直接
  // 作为顶层字段插入请求体。它不会展开 `body` 字段——如果传入
  // `{ body: { thinking: ... } }`，请求体顶层会出现 `body: { thinking: ... }`
  // 而不是 `thinking: ...`。因此对 openai-compatible，展开 `body` 字段。
  if (model.api.npm === '@ai-sdk/openai-compatible' && 'body' in options) {
    const { body, ...rest } = options;
    const merged = { ...(body as Record<string, JSONValue>), ...rest };
    return { [key]: merged };
  }

  return { [key]: options };
}

/**
 * Build the AI SDK `providerOptions` payload for a given thinking
 * config + model. Returns `undefined` when no provider-specific tuning
 * is required (most callers will then omit the field entirely).
 */
export function buildProviderOptions(input: {
  thinking?: ThinkingConfig;
  model: string;
}): SharedV2ProviderOptions | undefined {
  const { thinking } = input;
  if (!thinking) {
    return undefined;
  }

  // 当 supportsThinking 为 false 时，检查是否是因为用户通过 OpenAI 兼容代理
  // 使用非 OpenAI 模型（如 MiMo/Qwen/DeepSeek），此时 providerType 是 'openai'
  // 或 'custom'，modelConfig 找不到导致 supportsThinking=false。通过 modelId
  // 推断出真实厂商后，应视为支持思考。
  let effectiveSupportsThinking = thinking.supportsThinking;
  const normalizedProviderType = thinking.providerType.toLowerCase();
  if (
    !effectiveSupportsThinking &&
    (normalizedProviderType === 'openai' || normalizedProviderType === 'custom')
  ) {
    const inferredStyle = resolveThinkingStyle(thinking.providerType, input.model);
    if (
      inferredStyle !== 'none' &&
      catalogModelSupportsThinking(thinking.providerType, input.model)
    ) {
      // 仅在 openai/custom 代理场景下，且根据 modelId 能推断出真实支持 thinking
      // 的厂商模型时，才恢复 supportsThinking。
      effectiveSupportsThinking = true;
    }
  }
  if (!effectiveSupportsThinking) {
    return undefined;
  }

  const model = input.model.toLowerCase();
  const effort = normalizeProviderReasoningEffort(thinking.effort);
  const style = resolveThinkingStyle(thinking.providerType, input.model);
  const modelInfo = buildProviderOptionsModelInfo({
    providerType: thinking.providerType,
    model: input.model,
    ...(shouldUseOpenAICompatibleBodyFlatten(normalizedProviderType, style)
      ? { sdkNpmOverride: '@ai-sdk/openai-compatible' }
      : {}),
  });

  switch (style) {
    case 'anthropic_budget': {
      const anthropic: Record<string, JSONValue> = {
        // We always send reasoning back to upstream so multi-turn
        // tool flows preserve thinking continuity (matches the
        // legacy renderer's behaviour for Anthropic/Claude routes).
        sendReasoning: true,
      };
      if (thinking.enabled) {
        anthropic['thinking'] = {
          type: 'enabled',
          budgetTokens: ANTHROPIC_THINKING_BUDGETS[effort],
        };
      } else {
        anthropic['thinking'] = { type: 'disabled' };
      }
      return providerOptions(modelInfo, anthropic);
    }

    case 'openai_effort': {
      if (!thinking.enabled) {
        return undefined;
      }
      // GPT-5 sub-models accept different reasoning_effort subsets;
      // clamp before send to avoid 400s on e.g. gpt-5.1 (no `minimal`),
      // gpt-5-pro (only `high`), gpt-5-chat (only `medium`).
      // GPT-5.5/5.6 use `none`/`max` as native effort values.
      return providerOptions(modelInfo, {
        reasoningEffort: clampReasoningEffortForModel(input.model, effort),
      });
    }

    case 'openrouter_reasoning': {
      if (!supportsOpenRouterReasoning(model)) {
        return undefined;
      }
      // OpenRouter routes GPT-5 traffic to OpenAI; the same per-model
      // effort subset rules apply when the upstream is GPT-5.
      const openRouterEffort = clampReasoningEffortForModel(input.model, effort);
      return providerOptions(modelInfo, {
        body: {
          reasoning: thinking.enabled ? { effort: openRouterEffort } : { enabled: false },
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
      if (!thinking.enabled) {
        return providerOptions(modelInfo, {
          body: { thinking: { type: 'disabled' } },
        });
      }
      // DeepSeek API 支持 thinking + reasoning_effort 两个参数：
      //   - thinking: { type: 'enabled' } 开启思维链
      //   - reasoning_effort: 'high' | 'max' 控制推理力度
      // minimal/low 不发送 reasoning_effort（让上游用默认行为）。
      const effortParam = deepseekReasoningEffort(effort);
      return providerOptions(modelInfo, {
        body: {
          thinking: { type: 'enabled' },
          ...(effortParam ? { reasoning_effort: effortParam } : {}),
        },
      });
    }

    case 'gemini_thinking': {
      if (!thinking.enabled) {
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
      if (!thinking.enabled) {
        return providerOptions(modelInfo, {
          body: { enable_thinking: false },
        });
      }
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
      if (!catalogModelSupportsThinking(thinking.providerType, model)) {
        return undefined;
      }
      // MiMo V2.5+ 支持 reasoning_effort 参数（low/medium/high），
      // 在 thinking 开启时一并下发，与 DeepSeek "deepseek" 格式一致。
      if (thinking.providerType === 'mimo' && thinking.enabled) {
        const mimoSupported: ReasoningEffort[] = ['low', 'medium', 'high'];
        const requested = normalizeProviderReasoningEffort(thinking.effort ?? 'medium');
        const mimoEffort = mimoSupported.includes(requested)
          ? requested
          : (() => {
              const rank = EFFORT_RANK[requested];
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
        body: { thinking: { type: thinking.enabled ? 'enabled' : 'disabled' } },
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
}): SharedV2ProviderOptions | undefined {
  const providerType = (input.providerType ?? '').toLowerCase();
  if (!providerType) return undefined;
  const modelInfo = buildProviderOptionsModelInfo({
    providerType,
    model: input.model,
  });
  const model = input.model.toLowerCase();

  if (providerType === 'openai') {
    // OpenAI's prompt cache hits are keyed by `prompt_cache_key`. Without
    // it, concurrent sessions in the same org evict each other's prefix
    // cache entries (matches opencode `transform.ts` `options()`).
    return providerOptions(modelInfo, {
      store: false,
      ...(input.sessionId ? { promptCacheKey: input.sessionId } : {}),
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
