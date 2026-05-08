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

function mapGeminiThinkingLevel(effort: ReasoningEffort): 'low' | 'medium' | 'high' {
  if (effort === 'minimal' || effort === 'low') return 'low';
  if (effort === 'high' || effort === 'xhigh') return 'high';
  return effort;
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
      return providerOptions(modelInfo, {
        reasoningEffort: thinking.effort,
      });
    }

    case 'openrouter': {
      if (!supportsOpenRouterReasoning(model)) {
        return undefined;
      }
      return providerOptions(modelInfo, {
        body: {
          reasoning: thinking.enabled ? { effort: thinking.effort } : { enabled: false },
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
        return providerOptions(modelInfo, {
          body: { google: { thinking_config: { thinking_budget: 0 } } },
        });
      }
      if (model.includes('gemini-3')) {
        return providerOptions(modelInfo, {
          body: {
            google: {
              thinking_config: {
                include_thoughts: true,
                thinking_level: mapGeminiThinkingLevel(thinking.effort),
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
              thinking_budget: GEMINI_THINKING_BUDGETS[thinking.effort],
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
