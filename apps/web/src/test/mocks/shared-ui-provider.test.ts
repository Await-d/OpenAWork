import { describe, expect, it } from 'vitest';
import {
  canConfigureThinkingForModel,
  getSupportedReasoningEffortsForModel,
  inferSupportsThinking,
} from './shared-ui-provider.js';

describe('shared-ui provider OpenAI reasoning mock', () => {
  it('matches the official GPT-5 effort matrix', () => {
    expect(getSupportedReasoningEffortsForModel('openai', 'gpt-5.1')).toEqual([
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
    expect(getSupportedReasoningEffortsForModel('openai', 'gpt-5.6-sol')).toEqual([
      'none',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ]);
    expect(getSupportedReasoningEffortsForModel('openai', 'gpt-5.7')).toEqual([
      'none',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ]);
  });

  it('keeps fixed and versioned Pro behavior distinct', () => {
    expect(canConfigureThinkingForModel('openai', 'gpt-5-pro')).toBe(false);
    expect(getSupportedReasoningEffortsForModel('openai', 'gpt-5-pro')).toEqual([]);
    expect(canConfigureThinkingForModel('openai', 'gpt-5.4-pro')).toBe(true);
    expect(getSupportedReasoningEffortsForModel('openai', 'gpt-5.4-pro')).toEqual([
      'medium',
      'high',
      'xhigh',
    ]);
  });

  it('recognizes future OpenAI o-series reasoning models', () => {
    expect(inferSupportsThinking('openai', 'o5', false)).toBe(true);
  });

  it('does not classify non-reasoning OpenRouter GPT models as thinking-capable', () => {
    expect(inferSupportsThinking('openrouter', 'openai/gpt-4.1', false)).toBe(false);
  });
});
