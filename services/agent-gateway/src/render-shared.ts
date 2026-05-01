/**
 * Shared utilities for upstream protocol renderers.
 *
 * Extracted from provider-adapter.ts to avoid duplication across
 * render-anthropic-messages.ts, render-chat-completions.ts, and
 * render-responses-api.ts.
 */

import type { RequestOverrides } from '@openAwork/agent-core';
import type { PromptCacheConfig, UpstreamRequestBody } from './provider-adapter.js';

// ─── Prompt Cache Key Fields ───

/**
 * Build extra top-level body fields for session-level prompt caching.
 * OpenAI/Azure/OpenRouter all use snake_case prompt_cache_key.
 */
export function buildPromptCacheKeyFields(cache?: PromptCacheConfig): Record<string, unknown> {
  if (!cache?.sessionId) return {};

  const providerType = cache.providerType;
  if (providerType === 'openai') {
    return { store: false, prompt_cache_key: cache.sessionId };
  }
  if (providerType === 'openrouter') {
    return { prompt_cache_key: cache.sessionId };
  }

  return {};
}

// ─── Request Overrides ───

export interface OverrideKeyMap {
  maxTokens: 'max_tokens' | 'max_output_tokens';
}

/**
 * Apply request overrides to the body.
 * Each renderer provides its own keyMap for protocol-specific field names.
 */
export function applyRequestOverrides(
  body: UpstreamRequestBody,
  overrides: RequestOverrides,
  keyMap: OverrideKeyMap = { maxTokens: 'max_tokens' },
): UpstreamRequestBody {
  const next: UpstreamRequestBody = { ...body };

  if (overrides.maxTokens !== undefined) {
    next[keyMap.maxTokens] = overrides.maxTokens;
  }
  if (overrides.temperature !== undefined) {
    next['temperature'] = overrides.temperature;
  }
  if (overrides.topP !== undefined) {
    next['top_p'] = overrides.topP;
  }
  if (overrides.frequencyPenalty !== undefined) {
    next['frequency_penalty'] = overrides.frequencyPenalty;
  }
  if (overrides.presencePenalty !== undefined) {
    next['presence_penalty'] = overrides.presencePenalty;
  }
  if (overrides.body) {
    Object.assign(next, overrides.body);
  }
  for (const key of overrides.omitBodyKeys ?? []) {
    delete next[key];
  }

  return next;
}

// ─── Utility helpers ───

export function readObjectRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function isReasoningModel(model: string): boolean {
  return /^(gpt-5|o[134]|codex-?)/i.test(model);
}

// ─── OpenAI gpt-5.x text verbosity default ───

/**
 * Mirror of opencode's `transform.ts` heuristic
 * (`packages/opencode/src/provider/transform.ts` ~lines 950-957): only
 * `gpt-5.x` versioned models (5.1+, NOT bare `gpt-5` / `gpt-5-mini` /
 * `gpt-5-pro`) accept the new `verbosity` knob, and chat-tuned (`-chat`)
 * or codex variants either don't support it or only support `medium`.
 *
 * Returns true when we should default the request to `verbosity: "low"`
 * for terser assistant output. Caller still needs to ensure
 * `providerType === 'openai'`.
 */
export function shouldDefaultGpt5LowVerbosity(model: string): boolean {
  const id = model.toLowerCase();
  return id.includes('gpt-5.') && !id.includes('codex') && !id.includes('-chat');
}

/**
 * Inject `verbosity: "low"` (chat completions, top-level) or
 * `text: { verbosity: "low" }` (responses, nested) when the model
 * matches the gpt-5.x default-verbosity rule. Does NOT overwrite a
 * verbosity value the caller already supplied via requestOverrides.
 */
export function applyOpenAIDefaultTextVerbosity(
  body: UpstreamRequestBody,
  providerType: string | undefined,
  model: string,
  protocol: 'chat_completions' | 'responses' | 'anthropic_messages',
): UpstreamRequestBody {
  if (protocol === 'anthropic_messages') return body;
  if (providerType !== 'openai') return body;
  if (!shouldDefaultGpt5LowVerbosity(model)) return body;

  if (protocol === 'chat_completions') {
    if (body['verbosity'] !== undefined) return body;
    return { ...body, verbosity: 'low' };
  }

  const existingText = readObjectRecord(body['text']);
  if (existingText['verbosity'] !== undefined) return body;
  return {
    ...body,
    text: { ...existingText, verbosity: 'low' },
  };
}
