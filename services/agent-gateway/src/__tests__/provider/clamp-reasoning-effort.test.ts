/**
 * Regression coverage for {@link clampReasoningEffortForModel}.
 *
 * OpenAI rejects `reasoning_effort` values that fall outside a model's
 * documented subset with HTTP 400. Mirrors opencode #26268.
 *
 * The clamp must:
 *   - leave non-GPT-5 models untouched
 *   - leave already-supported requests untouched
 *   - downgrade unsupported high requests to the largest supported tier
 *     ≤ the request (conservative, never raises effort)
 *   - upgrade requests below the model's floor to the smallest supported
 *     tier (we cannot send below the floor, and we cannot omit the field
 *     either since it is part of the request signature)
 */

import { describe, expect, it } from 'vitest';

import { clampReasoningEffortForModel } from '../../v2-runtime/upstream/provider-options.js';

describe('clampReasoningEffortForModel', () => {
  describe('non-GPT-5 models', () => {
    it('leaves Claude unchanged', () => {
      expect(clampReasoningEffortForModel('claude-sonnet-4-5', 'minimal')).toBe('minimal');
      expect(clampReasoningEffortForModel('claude-opus-4-5', 'xhigh')).toBe('xhigh');
    });

    it('leaves Gemini unchanged', () => {
      expect(clampReasoningEffortForModel('gemini-3-pro', 'minimal')).toBe('minimal');
      expect(clampReasoningEffortForModel('gemini-2.5-flash', 'high')).toBe('high');
    });

    it('leaves GPT-4 family unchanged', () => {
      expect(clampReasoningEffortForModel('gpt-4o', 'low')).toBe('low');
      expect(clampReasoningEffortForModel('gpt-4-turbo', 'high')).toBe('high');
    });

    it('leaves unrelated names that contain "gpt-5" suffix unchanged', () => {
      // Anchor regex must not false-match these.
      expect(clampReasoningEffortForModel('gpt-50', 'minimal')).toBe('minimal');
      expect(clampReasoningEffortForModel('gpt-5o', 'xhigh')).toBe('xhigh');
    });
  });

  describe('gpt-5-pro (only high)', () => {
    it('forces every request to high', () => {
      expect(clampReasoningEffortForModel('gpt-5-pro', 'minimal')).toBe('high');
      expect(clampReasoningEffortForModel('gpt-5-pro', 'low')).toBe('high');
      expect(clampReasoningEffortForModel('gpt-5-pro', 'medium')).toBe('high');
      expect(clampReasoningEffortForModel('gpt-5-pro', 'high')).toBe('high');
      expect(clampReasoningEffortForModel('gpt-5-pro', 'xhigh')).toBe('high');
    });

    it('matches openai/-prefixed pro alias', () => {
      expect(clampReasoningEffortForModel('openai/gpt-5-pro', 'low')).toBe('high');
    });
  });

  describe('versioned gpt-5-{n}-pro (medium / high / xhigh)', () => {
    it('clamps below-floor requests up to medium', () => {
      expect(clampReasoningEffortForModel('gpt-5-2-pro', 'minimal')).toBe('medium');
      expect(clampReasoningEffortForModel('gpt-5-2-pro', 'low')).toBe('medium');
    });

    it('passes through medium / high / xhigh unchanged', () => {
      expect(clampReasoningEffortForModel('gpt-5-2-pro', 'medium')).toBe('medium');
      expect(clampReasoningEffortForModel('gpt-5-2-pro', 'high')).toBe('high');
      expect(clampReasoningEffortForModel('gpt-5-2-pro', 'xhigh')).toBe('xhigh');
    });
  });

  describe('gpt-5-chat (only medium)', () => {
    it('forces every request to medium', () => {
      expect(clampReasoningEffortForModel('gpt-5-chat', 'minimal')).toBe('medium');
      expect(clampReasoningEffortForModel('gpt-5-chat', 'low')).toBe('medium');
      expect(clampReasoningEffortForModel('gpt-5-chat', 'medium')).toBe('medium');
      expect(clampReasoningEffortForModel('gpt-5-chat', 'high')).toBe('medium');
      expect(clampReasoningEffortForModel('gpt-5-chat', 'xhigh')).toBe('medium');
    });

    it('matches versioned chat aliases', () => {
      expect(clampReasoningEffortForModel('gpt-5-2-chat', 'high')).toBe('medium');
    });
  });

  describe('gpt-5.1 / gpt-5-1 (no xhigh)', () => {
    it('downgrades xhigh to high', () => {
      expect(clampReasoningEffortForModel('gpt-5.1', 'xhigh')).toBe('high');
      expect(clampReasoningEffortForModel('gpt-5-1', 'xhigh')).toBe('high');
    });

    it('upgrades minimal to low (no `none` available in OpenAWork)', () => {
      expect(clampReasoningEffortForModel('gpt-5.1', 'minimal')).toBe('low');
    });

    it('passes through low / medium / high unchanged', () => {
      expect(clampReasoningEffortForModel('gpt-5.1', 'low')).toBe('low');
      expect(clampReasoningEffortForModel('gpt-5.1', 'medium')).toBe('medium');
      expect(clampReasoningEffortForModel('gpt-5.1', 'high')).toBe('high');
    });
  });

  describe('gpt-5.{2+} family (full set)', () => {
    it('passes every effort tier through unchanged', () => {
      expect(clampReasoningEffortForModel('gpt-5.2', 'minimal')).toBe('low');
      expect(clampReasoningEffortForModel('gpt-5.2', 'low')).toBe('low');
      expect(clampReasoningEffortForModel('gpt-5.2', 'high')).toBe('high');
      expect(clampReasoningEffortForModel('gpt-5.2', 'xhigh')).toBe('xhigh');
      expect(clampReasoningEffortForModel('gpt-5-3-mini', 'xhigh')).toBe('xhigh');
    });
  });

  describe('gpt-5-{x}-codex variants', () => {
    it('codex v3+ accepts xhigh', () => {
      expect(clampReasoningEffortForModel('gpt-5-3-codex', 'xhigh')).toBe('xhigh');
    });

    it('codex-max accepts xhigh', () => {
      expect(clampReasoningEffortForModel('gpt-5-2-codex-max', 'xhigh')).toBe('xhigh');
    });

    it('codex v2 accepts xhigh', () => {
      expect(clampReasoningEffortForModel('gpt-5-2-codex', 'xhigh')).toBe('xhigh');
    });

    it('default codex (no version / v1-ish) caps at high', () => {
      expect(clampReasoningEffortForModel('gpt-5-codex', 'xhigh')).toBe('high');
    });
  });

  describe('future gpt-5.x minor versions inherit the highest known tier', () => {
    it('gpt-5.7 (未来次版本) behaves like gpt-5.6, not the default tier', () => {
      expect(clampReasoningEffortForModel('gpt-5.7', 'minimal')).toBe('none');
      expect(clampReasoningEffortForModel('gpt-5.7', 'xhigh')).toBe('high');
      expect(clampReasoningEffortForModel('gpt-5.7', 'max')).toBe('max');
      expect(clampReasoningEffortForModel('gpt-5.7', 'high')).toBe('high');
    });
  });

  describe('OpenRouter-style aliases', () => {
    it('matches openai/gpt-5.1 alias correctly', () => {
      expect(clampReasoningEffortForModel('openai/gpt-5.1', 'xhigh')).toBe('high');
    });

    it('matches openai/gpt-5-pro alias correctly', () => {
      expect(clampReasoningEffortForModel('openai/gpt-5-pro', 'minimal')).toBe('high');
    });
  });
});
