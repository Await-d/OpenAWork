import { describe, expect, it } from 'vitest';
import {
  applyAnthropicCacheBreakpoints,
  buildProviderOptions,
  type ThinkingConfig,
} from '../v2-runtime/upstream/index.js';
import type { ModelMessage } from 'ai';

const baseThinking: ThinkingConfig = {
  enabled: true,
  effort: 'medium',
  providerType: 'anthropic',
  supportsThinking: true,
};

describe('buildProviderOptions', () => {
  it('emits anthropic.thinking with the matching budgetTokens', () => {
    const options = buildProviderOptions({
      thinking: baseThinking,
      model: 'claude-sonnet-4-5',
    });
    expect(options).toBeDefined();
    expect(options?.['anthropic']).toMatchObject({
      sendReasoning: true,
      thinking: { type: 'enabled', budgetTokens: 8192 },
    });
  });

  it('reports thinking disabled but still keeps sendReasoning', () => {
    const options = buildProviderOptions({
      thinking: { ...baseThinking, enabled: false },
      model: 'claude-sonnet-4-5',
    });
    expect(options?.['anthropic']).toMatchObject({
      sendReasoning: true,
      thinking: { type: 'disabled' },
    });
  });

  it('returns undefined when thinking is unsupported', () => {
    const options = buildProviderOptions({
      thinking: { ...baseThinking, supportsThinking: false },
      model: 'claude-sonnet-4-5',
    });
    expect(options).toBeUndefined();
  });

  it('maps openai providerType to openai-compatible.reasoningEffort', () => {
    const options = buildProviderOptions({
      thinking: { ...baseThinking, providerType: 'openai' },
      model: 'gpt-5',
    });
    expect(options?.['openai-compatible']).toMatchObject({ reasoningEffort: 'medium' });
  });

  it('emits openai-compatible.body.enable_thinking for qwen', () => {
    const options = buildProviderOptions({
      thinking: { ...baseThinking, providerType: 'qwen', enabled: true },
      model: 'qwen-max',
    });
    const oc = options?.['openai-compatible'] as { body?: Record<string, unknown> } | undefined;
    expect(oc?.body).toEqual({ enable_thinking: true });
  });

  it('opts into gemini-3 thinking_level rather than thinking_budget for gemini-3 models', () => {
    const options = buildProviderOptions({
      thinking: { ...baseThinking, providerType: 'gemini' },
      model: 'gemini-3-pro',
    });
    const oc = options?.['openai-compatible'] as
      | {
          body?: { google?: { thinking_config?: Record<string, unknown> } };
        }
      | undefined;
    expect(oc?.body?.google?.thinking_config).toMatchObject({
      include_thoughts: true,
      thinking_level: 'medium',
    });
  });

  it('skips moonshot non-thinking model variants', () => {
    const options = buildProviderOptions({
      thinking: { ...baseThinking, providerType: 'moonshot' },
      model: 'moonshot-v1-32k',
    });
    expect(options).toBeUndefined();
  });

  it('returns undefined for unrecognised providerType', () => {
    const options = buildProviderOptions({
      thinking: { ...baseThinking, providerType: 'unknown-vendor' },
      model: 'whatever',
    });
    expect(options).toBeUndefined();
  });
});

describe('applyAnthropicCacheBreakpoints', () => {
  function buildMessages(): ModelMessage[] {
    return [
      { role: 'system', content: 'sys-1' },
      { role: 'user', content: 'turn-1' },
      { role: 'assistant', content: 'reply-1' },
      { role: 'user', content: 'turn-2' },
      { role: 'assistant', content: 'reply-2' },
    ];
  }

  it('marks the system message and last 2 non-system messages on anthropic providers', () => {
    const result = applyAnthropicCacheBreakpoints(buildMessages(), 'anthropic');
    const cacheMarked = result.map(
      (m) =>
        ((m.providerOptions?.['anthropic'] ?? {}) as { cacheControl?: unknown })
          .cacheControl,
    );
    // system → marked; turn-1 → unchanged; reply-1 → unchanged;
    // turn-2 → marked; reply-2 → marked
    expect(cacheMarked[0]).toEqual({ type: 'ephemeral' });
    expect(cacheMarked[1]).toBeUndefined();
    expect(cacheMarked[2]).toBeUndefined();
    expect(cacheMarked[3]).toEqual({ type: 'ephemeral' });
    expect(cacheMarked[4]).toEqual({ type: 'ephemeral' });
  });

  it('also applies on openrouter (which proxies to anthropic-backed models)', () => {
    const result = applyAnthropicCacheBreakpoints(buildMessages(), 'openrouter');
    const lastAnthropic = (result[4]!.providerOptions?.['anthropic'] ?? {}) as {
      cacheControl?: unknown;
    };
    expect(lastAnthropic.cacheControl).toEqual({ type: 'ephemeral' });
  });

  it('is a noop on non-anthropic providers', () => {
    const original = buildMessages();
    const result = applyAnthropicCacheBreakpoints(original, 'openai');
    expect(result).toBe(original);
  });

  it('preserves caller-provided providerOptions when adding cacheControl', () => {
    const messages: ModelMessage[] = [
      {
        role: 'system',
        content: 'sys',
        providerOptions: { anthropic: { sendReasoning: true } },
      },
      { role: 'user', content: 'q' },
    ];
    const [system] = applyAnthropicCacheBreakpoints(messages, 'anthropic');
    const anthropic = (system!.providerOptions?.['anthropic'] ?? {}) as {
      sendReasoning?: boolean;
      cacheControl?: unknown;
    };
    expect(anthropic.sendReasoning).toBe(true);
    expect(anthropic.cacheControl).toEqual({ type: 'ephemeral' });
  });
});
