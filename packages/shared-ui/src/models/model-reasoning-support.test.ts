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

  it('infers provider labels from vendor-qualified model ids', () => {
    expect(inferProviderLabelFromModelId('anthropic/claude-sonnet-4-0')).toBe('Anthropic');
    expect(inferProviderLabelFromModelId('google/gemini-2.5-pro')).toBe('Google Gemini');
    expect(inferProviderLabelFromModelId('openai/gpt-5')).toBe('OpenAI');
  });
});
