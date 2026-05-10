import { describe, expect, it } from 'vitest';

import {
  THINKING_LANGUAGE_HINT_MARKERS,
  detectThinkingLanguageHintFromText,
} from '../routes/stream-system-prompts.js';

describe('detectThinkingLanguageHintFromText', () => {
  it('returns null for empty / pure-ASCII messages', () => {
    expect(detectThinkingLanguageHintFromText('')).toBeNull();
    expect(detectThinkingLanguageHintFromText('hello world')).toBeNull();
    expect(detectThinkingLanguageHintFromText('How do I use React 19?')).toBeNull();
  });

  it('returns the Chinese hint for CJK-Han-dominant text', () => {
    const hint = detectThinkingLanguageHintFromText('帮我搜索一下 React 19 的新特性');
    expect(hint).toContain('请用中文进行思考');
  });

  it('returns the Japanese hint when hiragana / katakana dominate', () => {
    const hint = detectThinkingLanguageHintFromText('Reactのコンポーネントについて教えてください');
    expect(hint).toContain('日本語で思考してください');
  });

  it('returns the Korean hint when hangul dominates', () => {
    const hint = detectThinkingLanguageHintFromText('리액트 컴포넌트에 대해 알려주세요');
    expect(hint).toContain('한국어로 생각하세요');
  });

  // Regression: every emitted hint variant must be detectable by the
  // legacy in-memory fallback (`applyThinkingLanguageHintToUnifiedMessages`)
  // via `THINKING_LANGUAGE_HINT_MARKERS.includes(content)` substring match,
  // otherwise old sessions would double-inject the hint each round and we
  // would re-introduce the byte-instability the persist-time fix is
  // supposed to eliminate.
  it.each([
    ['帮我搜索一下', '请用中文进行思考'],
    ['コンポーネントについて教えて', '日本語で思考してください'],
    ['리액트 컴포넌트', '한국어로 생각하세요'],
  ])('hint emitted for %j is recognised by THINKING_LANGUAGE_HINT_MARKERS', (input, marker) => {
    const hint = detectThinkingLanguageHintFromText(input);
    expect(hint).not.toBeNull();
    expect(hint).toContain(marker);
    // Simulate the persisted user-message envelope (`\n[hint]`) and check
    // the runtime fallback's `content.includes(marker)` guard.
    const persistedEnvelope = `用户文本\n[${hint}]`;
    expect(THINKING_LANGUAGE_HINT_MARKERS.some((m) => persistedEnvelope.includes(m))).toBe(true);
  });
});
