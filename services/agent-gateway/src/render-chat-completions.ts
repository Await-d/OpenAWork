/**
 * OpenAI-compatible Chat Completions API renderer.
 *
 * Converts UnifiedMessage[] to the /v1/chat/completions request format.
 * Used for non-OpenAI providers that expose an OpenAI-compatible endpoint
 * (Gemini, DeepSeek, Qwen, Moonshot, custom proxies, etc.).
 */

import type { UnifiedMessage } from './message-to-model-messages.js';
import type {
  UpstreamRequestBody,
  ReasoningEffort,
  ThinkingConfig,
  RenderOptions,
} from './provider-adapter.js';
import {
  buildPromptCacheKeyFields,
  applyRequestOverrides,
  readObjectRecord,
  applyOpenAIDefaultTextVerbosity,
} from './render-shared.js';

// ─── Cache Annotations ───

interface CacheControlAnnotation {
  cache_control: { type: 'ephemeral' };
}

type AnnotatedChatMessage = Record<string, unknown> & Partial<CacheControlAnnotation>;

function shouldApplyCacheAnnotations(providerType?: string): boolean {
  return providerType === 'anthropic' || providerType === 'openrouter';
}

/**
 * Apply cache_control breakpoints to rendered chat messages.
 *
 * Strategy (mirrors opencode applyCaching):
 *   - First 2 system messages  → cache breakpoint (stable prefix, high hit rate)
 *   - Last 2 non-system messages → cache breakpoint (conversation edge)
 */
function applyCacheControlAnnotations(
  messages: AnnotatedChatMessage[],
  providerType?: string,
): AnnotatedChatMessage[] {
  if (!shouldApplyCacheAnnotations(providerType)) {
    return messages;
  }

  const cacheControl = { type: 'ephemeral' as const };

  // Mark first 2 system messages
  let systemCount = 0;
  for (const msg of messages) {
    if (msg['role'] === 'system' && systemCount < 2) {
      msg['cache_control'] = cacheControl;
      systemCount++;
    }
  }

  // Mark last 2 non-system messages
  const nonSystemIndices: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i]!['role'] !== 'system') {
      nonSystemIndices.push(i);
    }
  }
  const tailIndices = nonSystemIndices.slice(-2);
  for (const idx of tailIndices) {
    messages[idx]!['cache_control'] = cacheControl;
  }

  return messages;
}

// ─── Thinking Budgets ───

const ANTHROPIC_THINKING_BUDGETS_FALLBACK: Record<ReasoningEffort, number> = {
  minimal: 1024,
  low: 4096,
  medium: 8192,
  high: 16000,
  xhigh: 31999,
};

const GEMINI_THINKING_BUDGETS: Record<ReasoningEffort, number> = {
  minimal: 1024,
  low: 4096,
  medium: 8192,
  high: 16000,
  xhigh: 24576,
};

// ─── Chat Completions Renderer ───

export function renderChatCompletions(
  messages: UnifiedMessage[],
  options: RenderOptions,
): UpstreamRequestBody {
  const rendered: AnnotatedChatMessage[] = messages.map((msg) => {
    if (msg.role === 'system') {
      return { role: 'system' as const, content: msg.content };
    }
    if (msg.role === 'user') {
      if ((msg.images ?? []).length === 0) {
        return { role: 'user' as const, content: msg.content };
      }

      return {
        role: 'user' as const,
        content: [
          ...(msg.content ? [{ type: 'text' as const, text: msg.content }] : []),
          ...(msg.images ?? []).flatMap((image) =>
            image.imageUrl
              ? [
                  {
                    type: 'image_url' as const,
                    image_url: {
                      url: image.imageUrl,
                      ...(image.detail ? { detail: image.detail } : {}),
                    },
                  },
                ]
              : [],
          ),
        ],
      };
    }
    if (msg.role === 'tool') {
      return { role: 'tool' as const, tool_call_id: msg.toolCallId, content: msg.content };
    }
    // assistant
    const { reasoning: _reasoning, toolCalls: _toolCalls, ...rest } = msg;
    return {
      ...rest,
      ...(msg.toolCalls
        ? {
            tool_calls: msg.toolCalls.map((tc) => ({
              id: tc.id,
              type: 'function' as const,
              function: { name: tc.name, arguments: tc.arguments },
            })),
          }
        : {}),
    };
  });

  // Apply cache_control breakpoints for Anthropic/OpenRouter
  applyCacheControlAnnotations(rendered, options.cache?.providerType);

  const body: UpstreamRequestBody = {
    model: options.model,
    ...(options.variant ? { variant: options.variant } : {}),
    messages: rendered,
    max_tokens: options.maxTokens,
    temperature: options.temperature,
    stream: true,
    stream_options: { include_usage: true },
    ...(options.tools.length > 0 ? { tools: options.tools, tool_choice: 'auto' as const } : {}),
    ...buildPromptCacheKeyFields(options.cache),
  };

  return applyOverridesAndThinking(body, options);
}

// ─── Overrides & Thinking (Chat Completions) ───

function applyOverridesAndThinking(
  body: UpstreamRequestBody,
  options: RenderOptions,
): UpstreamRequestBody {
  let result = applyRequestOverrides(body, options.requestOverrides);
  result = applyThinkingConfig(result, options.thinking);
  // Default `verbosity: "low"` on gpt-5.x non-codex non-chat models.
  // Independent of thinking enabled/disabled — this is OpenAI's separate
  // text-output-length knob, not a reasoning param. Mirrors opencode.
  result = applyOpenAIDefaultTextVerbosity(
    result,
    options.thinking?.providerType ?? options.cache?.providerType,
    options.model,
    'chat_completions',
  );
  return result;
}

function applyThinkingConfig(
  body: UpstreamRequestBody,
  thinking: ThinkingConfig | undefined,
): UpstreamRequestBody {
  if (!thinking || !thinking.supportsThinking) return body;

  const next: UpstreamRequestBody = { ...body };
  const modelValue = typeof next['model'] === 'string' ? next['model'] : '';
  const model = modelValue.toLowerCase();

  switch (thinking.providerType) {
    case 'openai':
      if (thinking.enabled) {
        next['reasoning_effort'] = thinking.effort;
      } else {
        delete next['reasoning_effort'];
      }
      return next;

    case 'deepseek':
      if (thinking.enabled && !model.includes('reasoner')) {
        next['thinking'] = { type: 'enabled' };
      } else {
        delete next['thinking'];
      }
      return next;

    case 'anthropic':
      if (thinking.enabled) {
        next['thinking'] = {
          type: 'enabled',
          budget_tokens: ANTHROPIC_THINKING_BUDGETS_FALLBACK[thinking.effort],
        };
      } else {
        delete next['thinking'];
      }
      return next;

    case 'gemini':
      return applyGeminiThinking(next, model, thinking);

    case 'openrouter':
      if (!supportsOpenRouterReasoning(model)) return next;
      next['reasoning'] = thinking.enabled ? { effort: thinking.effort } : { enabled: false };
      return next;

    case 'qwen':
      next['enable_thinking'] = thinking.enabled;
      return next;

    case 'moonshot':
      if (isMoonshotThinkingModel(model)) {
        next['thinking'] = { type: thinking.enabled ? 'enabled' : 'disabled' };
      }
      return next;

    default:
      return next;
  }
}

// ─── Gemini-specific helpers ───

function applyGeminiThinking(
  body: UpstreamRequestBody,
  model: string,
  thinking: ThinkingConfig,
): UpstreamRequestBody {
  if (!thinking.enabled) {
    mergeGeminiConfig(body, { thinking_budget: 0 });
    return body;
  }

  if (model.includes('gemini-3')) {
    mergeGeminiConfig(body, {
      include_thoughts: true,
      thinking_level: mapGeminiThinkingLevel(thinking.effort),
    });
    return body;
  }

  mergeGeminiConfig(body, {
    include_thoughts: true,
    thinking_budget: GEMINI_THINKING_BUDGETS[thinking.effort],
  });
  return body;
}

function mergeGeminiConfig(body: UpstreamRequestBody, value: Record<string, unknown>): void {
  const extraBody = readObjectRecord(body['extra_body']);
  const googleBody = readObjectRecord(extraBody['google']);
  body['extra_body'] = {
    ...extraBody,
    google: {
      ...googleBody,
      thinking_config: {
        ...readObjectRecord(googleBody['thinking_config']),
        ...value,
      },
    },
  };
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

function mapGeminiThinkingLevel(effort: ReasoningEffort): 'low' | 'medium' | 'high' {
  if (effort === 'minimal' || effort === 'low') return 'low';
  if (effort === 'xhigh') return 'high';
  return effort;
}
