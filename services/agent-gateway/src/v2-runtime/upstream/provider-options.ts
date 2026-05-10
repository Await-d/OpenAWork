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
 *                   (only for chat-completions; Responses API needs
 *                   `@ai-sdk/openai`, not yet installed.)
 *   - openrouter  → providerOptions.openrouter.body.reasoning
 *   - deepseek    → providerOptions.deepseek.body.thinking
 *   - gemini      → providerOptions.gemini.body.google.thinking_config
 *   - qwen        → providerOptions.qwen.body.enable_thinking
 *   - moonshot    → providerOptions.moonshot.body.thinking
 *
 * NOT covered yet:
 *   - OpenAI Responses API `previous_response_id` continuation
 *     (requires `@ai-sdk/openai`; tracked in PROGRESS.md as Phase D
 *     follow-up).
 */

import type { JSONValue, SharedV2ProviderOptions } from '@ai-sdk/provider';

export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export interface ThinkingConfig {
  enabled: boolean;
  effort: ReasoningEffort;
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
  minimal: 1024,
  low: 4096,
  medium: 8192,
  high: 16384,
  xhigh: 31999,
};

const GEMINI_THINKING_BUDGETS: Record<ReasoningEffort, number> = {
  minimal: 1024,
  low: 4096,
  medium: 8192,
  high: 16384,
  xhigh: 24576,
};

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
  minimal: 0,
  low: 1,
  medium: 2,
  high: 3,
  xhigh: 4,
};

const GPT5_FAMILY_RE = /(?:^|\/)gpt-5(?:[.-]|$)/;
const GPT5_VERSION_RE = /(?:^|\/)gpt-5[.-](\d+)(?:[.-]|$)/;
const GPT5_PRO_RE = /(?:^|\/)gpt-5[.-]?pro(?:[.-]|$)/;
const GPT5_VERSIONED_PRO_RE = /(?:^|\/)gpt-5[.-]\d+[.-]pro(?:[.-]|$)/;

const GPT5_PRO_EFFORTS: readonly ReasoningEffort[] = ['high'];
const GPT5_VERSIONED_PRO_EFFORTS: readonly ReasoningEffort[] = ['medium', 'high', 'xhigh'];
const GPT5_CHAT_EFFORTS: readonly ReasoningEffort[] = ['medium'];
const GPT5_1_EFFORTS: readonly ReasoningEffort[] = ['low', 'medium', 'high'];
const GPT5_2_PLUS_EFFORTS: readonly ReasoningEffort[] = ['low', 'medium', 'high', 'xhigh'];
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
  requested: ReasoningEffort,
): ReasoningEffort {
  const id = modelId.toLowerCase();
  const supported = gpt5SupportedEfforts(id);
  if (!supported || supported.length === 0) return requested;
  if (supported.includes(requested)) return requested;
  const targetRank = EFFORT_RANK[requested];
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

function isMoonshotThinkingModel(model: string): boolean {
  return (
    model.includes('kimi-k2.5') ||
    model.includes('kimi-k2-thinking') ||
    model.includes('kimi-k2p5') ||
    model.includes('kimi-k2-5')
  );
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
}): ProviderOptionsModelInfo {
  const providerID = input.providerType.toLowerCase();
  return {
    providerID,
    id: input.model,
    api: {
      id: input.model,
      npm: sdkNpmForProviderType(providerID),
    },
  };
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
    return mergeDeep(acc, item as ProviderOptionsRecord);
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
  if (!thinking || !thinking.supportsThinking) {
    return undefined;
  }

  const model = input.model.toLowerCase();
  const modelInfo = buildProviderOptionsModelInfo({
    providerType: thinking.providerType,
    model: input.model,
  });

  switch (thinking.providerType) {
    case 'anthropic':
    case 'claude': {
      const anthropic: Record<string, JSONValue> = {
        // We always send reasoning back to upstream so multi-turn
        // tool flows preserve thinking continuity (matches the
        // legacy renderer's behaviour for Anthropic/Claude routes).
        sendReasoning: true,
      };
      if (thinking.enabled) {
        anthropic['thinking'] = {
          type: 'enabled',
          budgetTokens: ANTHROPIC_THINKING_BUDGETS[thinking.effort],
        };
      } else {
        anthropic['thinking'] = { type: 'disabled' };
      }
      return providerOptions(modelInfo, anthropic);
    }

    case 'openai': {
      // Chat-completions path only. The Responses API (`reasoning:
      // { effort, summary }`) needs `@ai-sdk/openai`, which is not
      // wired in yet — see PROGRESS.md.
      if (!thinking.enabled) {
        return undefined;
      }
      // GPT-5 sub-models accept different reasoning_effort subsets;
      // clamp before send to avoid 400s on e.g. gpt-5.1 (no `minimal`),
      // gpt-5-pro (only `high`), gpt-5-chat (only `medium`).
      return providerOptions(modelInfo, {
        reasoningEffort: clampReasoningEffortForModel(input.model, thinking.effort),
      });
    }

    case 'openrouter': {
      if (!supportsOpenRouterReasoning(model)) {
        return undefined;
      }
      // OpenRouter routes GPT-5 traffic to OpenAI; the same per-model
      // effort subset rules apply when the upstream is GPT-5.
      const effort = clampReasoningEffortForModel(input.model, thinking.effort);
      return providerOptions(modelInfo, {
        body: {
          reasoning: thinking.enabled ? { effort } : { enabled: false },
        },
      });
    }

    case 'deepseek': {
      if (!thinking.enabled) {
        return undefined;
      }
      // DeepSeek-Reasoner exposes thinking via the model id; only
      // non-reasoner deepseek models need the explicit toggle.
      if (model.includes('reasoner')) {
        return undefined;
      }
      return providerOptions(modelInfo, {
        body: { thinking: { type: 'enabled' } },
      });
    }

    case 'gemini': {
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
                thinking_level: googleThinkingLevelForEffort(model, thinking.effort),
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
              thinking_budget: googleThinkingBudgetForEffort(model, thinking.effort),
            },
          },
        },
      });
    }

    case 'qwen': {
      return providerOptions(modelInfo, {
        body: { enable_thinking: thinking.enabled },
      });
    }

    case 'moonshot': {
      if (!isMoonshotThinkingModel(model)) {
        return undefined;
      }
      return providerOptions(modelInfo, {
        body: { thinking: { type: thinking.enabled ? 'enabled' : 'disabled' } },
      });
    }

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
