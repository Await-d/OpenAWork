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
 * `providerOptions.openai-compatible.body` (extra body fields). This
 * module is the single mapping table.
 *
 * Coverage today (stay aligned with upstream-request.ts):
 *   - anthropic   → providerOptions.anthropic.thinking + sendReasoning
 *   - openai      → providerOptions.openai-compatible.reasoningEffort
 *                   (only for chat-completions; Responses API needs
 *                   `@ai-sdk/openai`, not yet installed.)
 *   - openrouter  → providerOptions.openai-compatible.body.reasoning
 *   - deepseek    → providerOptions.openai-compatible.body.thinking
 *   - gemini      → providerOptions.openai-compatible.body.google.thinking_config
 *   - qwen        → providerOptions.openai-compatible.body.enable_thinking
 *   - moonshot    → providerOptions.openai-compatible.body.thinking
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
      return { anthropic };
    }

    case 'openai': {
      // Chat-completions path only. The Responses API (`reasoning:
      // { effort, summary }`) needs `@ai-sdk/openai`, which is not
      // wired in yet — see PROGRESS.md.
      if (!thinking.enabled) {
        return undefined;
      }
      return {
        'openai-compatible': {
          reasoningEffort: thinking.effort,
        },
      };
    }

    case 'openrouter': {
      if (!supportsOpenRouterReasoning(model)) {
        return undefined;
      }
      return {
        'openai-compatible': {
          body: {
            reasoning: thinking.enabled ? { effort: thinking.effort } : { enabled: false },
          },
        },
      };
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
      return {
        'openai-compatible': {
          body: { thinking: { type: 'enabled' } },
        },
      };
    }

    case 'gemini': {
      if (!thinking.enabled) {
        return {
          'openai-compatible': {
            body: { google: { thinking_config: { thinking_budget: 0 } } },
          },
        };
      }
      if (model.includes('gemini-3')) {
        return {
          'openai-compatible': {
            body: {
              google: {
                thinking_config: {
                  include_thoughts: true,
                  thinking_level: mapGeminiThinkingLevel(thinking.effort),
                },
              },
            },
          },
        };
      }
      return {
        'openai-compatible': {
          body: {
            google: {
              thinking_config: {
                include_thoughts: true,
                thinking_budget: GEMINI_THINKING_BUDGETS[thinking.effort],
              },
            },
          },
        },
      };
    }

    case 'qwen': {
      return {
        'openai-compatible': {
          body: { enable_thinking: thinking.enabled },
        },
      };
    }

    case 'moonshot': {
      if (!isMoonshotThinkingModel(model)) {
        return undefined;
      }
      return {
        'openai-compatible': {
          body: { thinking: { type: thinking.enabled ? 'enabled' : 'disabled' } },
        },
      };
    }

    default:
      return undefined;
  }
}
