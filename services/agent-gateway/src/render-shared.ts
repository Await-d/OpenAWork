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
export function buildPromptCacheKeyFields(
  cache?: PromptCacheConfig,
): Record<string, unknown> {
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
