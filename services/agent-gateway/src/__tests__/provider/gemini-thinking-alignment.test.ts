/**
 * Regression coverage for the Gemini thinking-control alignment.
 *
 * Mirrors opencode #26279. The cases below lock in:
 *   - gemini-3 sub-model thinking_level subsets
 *   - gemini-2.5-pro 32_768 budget cap (vs. 24_576 elsewhere)
 *   - "thinking disabled" path: gemini-3 emits thinking_level (no
 *     thinking_budget=0), gemini-2.5-pro emits a non-zero floor (128)
 *     because the model rejects budget=0
 *   - GPT-5 effort clamp keeps existing OpenAI / OpenRouter cases working
 */

import { describe, expect, it } from 'vitest';
import {
  buildProviderOptions,
  type ThinkingConfig,
  type ReasoningEffort,
} from '../../v2-runtime/upstream/provider-options.js';

const baseThinking: ThinkingConfig = {
  enabled: true,
  effort: 'medium',
  providerType: 'gemini',
  supportsThinking: true,
};

function geminiCfg(model: string, effort: ReasoningEffort, enabled = true) {
  const options = buildProviderOptions({
    thinking: { ...baseThinking, effort, enabled },
    model,
  });
  return options?.['gemini'] as
    { google?: { thinking_config?: Record<string, unknown> } } | undefined;
}

describe('buildProviderOptions — gemini-3 thinking_level subsets', () => {
  it('gemini-3-pro accepts low/medium/high; effort xhigh clamps to high', () => {
    expect(geminiCfg('gemini-3-pro', 'xhigh')?.google?.thinking_config).toMatchObject({
      include_thoughts: true,
      thinking_level: 'high',
    });
  });

  it('gemini-3-pro upgrades minimal to low (minimal not in subset)', () => {
    expect(geminiCfg('gemini-3-pro', 'minimal')?.google?.thinking_config).toMatchObject({
      thinking_level: 'low',
    });
  });

  it('gemini-3-flash supports the full minimal/low/medium/high subset', () => {
    expect(geminiCfg('gemini-3-flash', 'minimal')?.google?.thinking_config).toMatchObject({
      thinking_level: 'minimal',
    });
    expect(geminiCfg('gemini-3-flash', 'medium')?.google?.thinking_config).toMatchObject({
      thinking_level: 'medium',
    });
    // xhigh → high (Gemini level scale tops out at 'high')
    expect(geminiCfg('gemini-3-flash', 'xhigh')?.google?.thinking_config).toMatchObject({
      thinking_level: 'high',
    });
  });

  it('gemini-3-flash-image only accepts minimal / high', () => {
    // medium → minimal (largest supported ≤ medium is 'minimal')
    expect(geminiCfg('gemini-3-flash-image', 'medium')?.google?.thinking_config).toMatchObject({
      thinking_level: 'minimal',
    });
    expect(geminiCfg('gemini-3-flash-image', 'high')?.google?.thinking_config).toMatchObject({
      thinking_level: 'high',
    });
  });

  it('gemini-3-pro-image only accepts high', () => {
    expect(geminiCfg('gemini-3-pro-image', 'minimal')?.google?.thinking_config).toMatchObject({
      thinking_level: 'high',
    });
    expect(geminiCfg('gemini-3-pro-image', 'medium')?.google?.thinking_config).toMatchObject({
      thinking_level: 'high',
    });
  });
});

describe('buildProviderOptions — gemini-2.5 thinking_budget caps', () => {
  it('gemini-2.5-pro caps xhigh at 32_768 (the higher pro-only ceiling)', () => {
    expect(geminiCfg('gemini-2.5-pro', 'xhigh')?.google?.thinking_config).toMatchObject({
      include_thoughts: true,
      thinking_budget: 32_768,
    });
  });

  it('gemini-2.5-flash xhigh caps at 24_576 (default ceiling)', () => {
    expect(geminiCfg('gemini-2.5-flash', 'xhigh')?.google?.thinking_config).toMatchObject({
      thinking_budget: 24_576,
    });
  });

  it('gemini-2.5-pro lower-tier budgets pass through unchanged', () => {
    expect(geminiCfg('gemini-2.5-pro', 'medium')?.google?.thinking_config).toMatchObject({
      thinking_budget: 8192,
    });
  });
});

describe('buildProviderOptions — gemini disabled path', () => {
  it('gemini-3 emits thinking_level (lowest supported) — never thinking_budget=0', () => {
    const cfg = geminiCfg('gemini-3-pro', 'medium', /* enabled */ false)?.google?.thinking_config;
    expect(cfg).toEqual({ thinking_level: 'low' });
    expect(cfg).not.toHaveProperty('thinking_budget');
  });

  it('gemini-3-flash-image disabled drops to minimal (its lowest)', () => {
    expect(geminiCfg('gemini-3-flash-image', 'medium', false)?.google?.thinking_config).toEqual({
      thinking_level: 'minimal',
    });
  });

  it('gemini-3-pro-image disabled stays at high (no lower option)', () => {
    expect(geminiCfg('gemini-3-pro-image', 'medium', false)?.google?.thinking_config).toEqual({
      thinking_level: 'high',
    });
  });

  it('gemini-2.5-pro disabled uses non-zero floor 128 (model rejects budget=0)', () => {
    expect(geminiCfg('gemini-2.5-pro', 'medium', false)?.google?.thinking_config).toEqual({
      thinking_budget: 128,
    });
  });

  it('gemini-2.5-flash disabled uses budget 0 (full off)', () => {
    expect(geminiCfg('gemini-2.5-flash', 'medium', false)?.google?.thinking_config).toEqual({
      thinking_budget: 0,
    });
  });
});

describe('buildProviderOptions — openai reasoningEffort clamp', () => {
  it('gpt-5.1 with effort xhigh downgrades to high', () => {
    const opts = buildProviderOptions({
      thinking: { ...baseThinking, providerType: 'openai', effort: 'xhigh' },
      model: 'gpt-5.1',
    });
    expect(opts?.['openai']).toMatchObject({ reasoningEffort: 'high' });
  });

  it('gpt-5-pro forces every effort to high', () => {
    const opts = buildProviderOptions({
      thinking: { ...baseThinking, providerType: 'openai', effort: 'minimal' },
      model: 'gpt-5-pro',
    });
    expect(opts?.['openai']).toMatchObject({ reasoningEffort: 'high' });
  });

  it('gpt-5-chat clamps high → medium (only medium is supported)', () => {
    const opts = buildProviderOptions({
      thinking: { ...baseThinking, providerType: 'openai', effort: 'high' },
      model: 'gpt-5-chat',
    });
    expect(opts?.['openai']).toMatchObject({ reasoningEffort: 'medium' });
  });

  it('non-GPT-5 OpenAI models are not clamped', () => {
    const opts = buildProviderOptions({
      thinking: { ...baseThinking, providerType: 'openai', effort: 'high' },
      model: 'gpt-4o',
    });
    expect(opts?.['openai']).toMatchObject({ reasoningEffort: 'high' });
  });
});

describe('buildProviderOptions — openrouter GPT-5 effort clamp', () => {
  it('openai/gpt-5.1 via OpenRouter downgrades xhigh to high', () => {
    const opts = buildProviderOptions({
      thinking: { ...baseThinking, providerType: 'openrouter', effort: 'xhigh' },
      model: 'openai/gpt-5.1',
    });
    const reasoning = (opts?.['openrouter'] as { reasoning?: { effort?: string } } | undefined)
      ?.reasoning;
    expect(reasoning?.effort).toBe('high');
  });

  it('claude via OpenRouter is not clamped (non-GPT-5)', () => {
    const opts = buildProviderOptions({
      thinking: { ...baseThinking, providerType: 'openrouter', effort: 'xhigh' },
      model: 'anthropic/claude-sonnet-4-5',
    });
    const reasoning = (opts?.['openrouter'] as { reasoning?: { effort?: string } } | undefined)
      ?.reasoning;
    expect(reasoning?.effort).toBe('xhigh');
  });
});
