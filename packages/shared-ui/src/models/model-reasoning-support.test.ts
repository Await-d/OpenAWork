import { describe, expect, it } from 'vitest';
import {
  canConfigureThinkingForModel,
  getSupportedReasoningEffortsForModel,
  inferSupportsThinking,
} from './model-reasoning-support.js';
import { inferProviderLabelFromModelId } from './provider-catalog-ui.js';

describe('model reasoning support', () => {
  it('supports vendor-qualified proxy model ids for reasoning-capable vendors', () => {
    expect(inferSupportsThinking('custom', 'anthropic/claude-sonnet-4-0', false)).toBe(true);
    expect(inferSupportsThinking('custom', 'google/gemini-2.5-pro', false)).toBe(true);
    expect(inferSupportsThinking('custom', 'openai/gpt-5', false)).toBe(true);
  });

  it('recognizes OpenRouter reasoning-capable models even when catalog does not declare support', () => {
    expect(inferSupportsThinking('openrouter', 'anthropic/claude-sonnet-4-0', false)).toBe(true);
    expect(inferSupportsThinking('openrouter', 'openai/gpt-5', false)).toBe(true);
    expect(inferSupportsThinking('openrouter', 'google/gemini-3.0-pro', false)).toBe(true);
    expect(inferSupportsThinking('openrouter', 'meta/llama-3.3-70b', false)).toBe(false);
  });

  it('keeps vendor-qualified proxy models without reasoning support disabled', () => {
    expect(inferSupportsThinking('custom', 'anthropic/claude-haiku-4-5', false)).toBe(false);
    expect(inferSupportsThinking('custom', 'openai/gpt-4o', false)).toBe(false);
  });

  it('only exposes configurable openai reasoning for supported models', () => {
    expect(canConfigureThinkingForModel('custom', 'openai/gpt-5')).toBe(true);
    expect(canConfigureThinkingForModel('custom', 'openai/gpt-5-pro')).toBe(false);
    expect(canConfigureThinkingForModel('custom', 'openai/gpt-4o')).toBe(false);
  });

  it('derives supported efforts for vendor-qualified openai reasoning models', () => {
    expect(getSupportedReasoningEffortsForModel('custom', 'openai/gpt-5')).toEqual([
      'minimal',
      'low',
      'medium',
      'high',
    ]);
    expect(getSupportedReasoningEffortsForModel('custom', 'openai/gpt-4o')).toEqual([
      'low',
      'medium',
      'high',
    ]);
  });

  it('exposes 5 effort levels for GPT-5.5 (none/low/medium/high/xhigh)', () => {
    expect(getSupportedReasoningEffortsForModel('openai', 'gpt-5.5')).toEqual([
      'none',
      'low',
      'medium',
      'high',
      'xhigh',
    ]);
  });

  it('exposes all official effort levels for GPT-5.6 variants', () => {
    expect(getSupportedReasoningEffortsForModel('openai', 'gpt-5.6')).toEqual([
      'none',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ]);
    expect(getSupportedReasoningEffortsForModel('openai', 'gpt-5.6-sol')).toEqual([
      'none',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ]);
  });

  it('exposes none plus tunable effort levels for GPT-5.1 through GPT-5.5', () => {
    expect(getSupportedReasoningEffortsForModel('openai', 'gpt-5.1')).toEqual([
      'none',
      'low',
      'medium',
      'high',
    ]);
    expect(getSupportedReasoningEffortsForModel('openai', 'gpt-5-1')).toEqual([
      'none',
      'low',
      'medium',
      'high',
    ]);
    expect(getSupportedReasoningEffortsForModel('openai', 'gpt-5.2')).toEqual([
      'none',
      'low',
      'medium',
      'high',
      'xhigh',
    ]);
    expect(getSupportedReasoningEffortsForModel('openai', 'gpt-5.4')).toEqual([
      'none',
      'low',
      'medium',
      'high',
      'xhigh',
    ]);
  });

  it('keeps gpt-5 fixed while exposing versioned Pro effort controls', () => {
    expect(canConfigureThinkingForModel('openai', 'gpt-5-pro')).toBe(false);
    expect(canConfigureThinkingForModel('openai', 'gpt-5.4-pro')).toBe(true);
    expect(getSupportedReasoningEffortsForModel('openai', 'gpt-5.4-pro')).toEqual([
      'medium',
      'high',
      'xhigh',
    ]);
    expect(getSupportedReasoningEffortsForModel('openai', 'gpt-5.5-pro')).toEqual([
      'medium',
      'high',
      'xhigh',
    ]);
  });

  it('infers provider labels from vendor-qualified model ids', () => {
    expect(inferProviderLabelFromModelId('anthropic/claude-sonnet-4-0')).toBe('Anthropic');
    expect(inferProviderLabelFromModelId('google/gemini-2.5-pro')).toBe('Google Gemini');
    expect(inferProviderLabelFromModelId('openai/gpt-5')).toBe('OpenAI');
  });

  it('exposes 4 effort levels for Anthropic (low/medium/high/xhigh, no minimal)', () => {
    expect(getSupportedReasoningEffortsForModel('anthropic', 'claude-opus-4-0')).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
    ]);
  });

  it('exposes 3 effort levels for MiMo (low/medium/high)', () => {
    expect(getSupportedReasoningEffortsForModel('mimo', 'mimo-v2.5-pro')).toEqual([
      'low',
      'medium',
      'high',
    ]);
  });

  it('keeps Moonshot as binary toggle (single medium effort)', () => {
    expect(getSupportedReasoningEffortsForModel('moonshot', 'kimi-k2.5')).toEqual(['medium']);
  });

  it('enables thinking controls for Azure / xAI / 智谱 / 豆包 reasoning models', () => {
    expect(inferSupportsThinking('azure', 'gpt-5', false)).toBe(true);
    expect(canConfigureThinkingForModel('azure', 'gpt-5')).toBe(true);
    expect(inferSupportsThinking('azure', 'gpt-4o', false)).toBe(false);
    expect(canConfigureThinkingForModel('azure', 'gpt-4o')).toBe(false);

    expect(inferSupportsThinking('xai', 'grok-3', false)).toBe(true);
    expect(canConfigureThinkingForModel('xai', 'grok-3')).toBe(true);
    expect(getSupportedReasoningEffortsForModel('xai', 'grok-3')).toEqual([
      'low',
      'medium',
      'high',
    ]);

    expect(inferSupportsThinking('zhipu', 'glm-4.5', false)).toBe(true);
    expect(canConfigureThinkingForModel('zhipu', 'glm-4.5')).toBe(true);
    expect(canConfigureThinkingForModel('zhipu', 'glm-4-flash')).toBe(false);
    expect(getSupportedReasoningEffortsForModel('zhipu', 'glm-4.5')).toEqual(['medium']);

    expect(inferSupportsThinking('doubao', 'doubao-seed-1.6', false)).toBe(true);
    expect(canConfigureThinkingForModel('doubao', 'doubao-seed-1.6')).toBe(true);
    expect(getSupportedReasoningEffortsForModel('doubao', 'doubao-seed-1.6')).toEqual(['medium']);
  });

  it('infers siliconflow hosted DeepSeek / Qwen thinking models', () => {
    expect(inferSupportsThinking('siliconflow', 'deepseek-ai/DeepSeek-V3', false)).toBe(true);
    expect(canConfigureThinkingForModel('siliconflow', 'deepseek-ai/DeepSeek-V3')).toBe(true);
    expect(inferSupportsThinking('siliconflow', 'Qwen/Qwen3-32B', false)).toBe(true);
    expect(canConfigureThinkingForModel('siliconflow', 'Qwen/Qwen2.5-7B-Instruct')).toBe(false);
  });

  it('honors declared supportsThinking for custom arbitrary model ids', () => {
    expect(inferSupportsThinking('custom', 'my-local-reasoner', true)).toBe(true);
    expect(canConfigureThinkingForModel('custom', 'my-local-reasoner', true)).toBe(true);
    expect(canConfigureThinkingForModel('custom', 'my-local-reasoner', false)).toBe(false);
    expect(getSupportedReasoningEffortsForModel('custom', 'my-local-reasoner')).toEqual([
      'low',
      'medium',
      'high',
    ]);
  });

  it('does not treat non-reasoning OpenRouter gpt-4 models as thinking-capable', () => {
    expect(inferSupportsThinking('openrouter', 'openai/gpt-4.1', false)).toBe(false);
    expect(canConfigureThinkingForModel('openrouter', 'openai/gpt-4.1')).toBe(false);
    expect(inferSupportsThinking('openrouter', 'openai/gpt-5', false)).toBe(true);
  });

  it('recognizes future vendor versions above the highest hardcoded example', () => {
    // Anthropic: major >= 4（未来的 opus-5/sonnet-5 系列）。
    expect(inferSupportsThinking('anthropic', 'claude-opus-5-0', false)).toBe(true);
    expect(inferSupportsThinking('anthropic', 'claude-sonnet-5-0', false)).toBe(true);
    // xAI: grok major >= 2（未来 grok-5）。
    expect(inferSupportsThinking('xai', 'grok-5', false)).toBe(true);
    // Gemini: major.minor >= 2.5（未来 gemini-4）。
    expect(inferSupportsThinking('gemini', 'gemini-4-pro', false)).toBe(true);
    // Qwen: major >= 3（未来 qwen4）。
    expect(inferSupportsThinking('qwen', 'qwen4-max', false)).toBe(true);
    // 智谱: major.minor >= 4.5（未来 glm-5.0）。
    expect(inferSupportsThinking('zhipu', 'glm-5.0', false)).toBe(true);
    // 豆包: seed major.minor >= 1.6（未来 seed-2.0）。
    expect(inferSupportsThinking('doubao', 'doubao-seed-2.0', false)).toBe(true);
    // Moonshot: k-major.minor >= 2.5（未来 kimi-k3）。
    expect(inferSupportsThinking('moonshot', 'kimi-k3', false)).toBe(true);
    // OpenAI o 系列：未来的 o5 不应因为硬编码枚举漏配。
    expect(inferSupportsThinking('openai', 'o5', false)).toBe(true);
    // GPT-5.x 未来次版本继承已知最高档位，而不是掉回默认三档。
    expect(getSupportedReasoningEffortsForModel('openai', 'gpt-5.7')).toEqual([
      'none',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ]);
  });
});
