import { describe, expect, it } from 'vitest';

import {
  ANALYZE_MODE_MESSAGE,
  KeywordDetectorImpl,
  ULTRAWORK_MODE_MESSAGE,
} from '../hooks/keyword-detector.js';

describe('KeywordDetectorImpl', () => {
  it('returns injected prompt for analyze and ultrawork modes', () => {
    const detector = new KeywordDetectorImpl();
    expect(detector.detect('please analyze this bug')).toMatchObject({
      mode: 'analyze',
      injectedPrompt: ANALYZE_MODE_MESSAGE,
    });
    expect(detector.detect('ultrawork fix everything')).toMatchObject({
      mode: 'ultrawork',
      injectedPrompt: ULTRAWORK_MODE_MESSAGE,
    });
  });

  it('ignores keywords inside fenced code blocks', () => {
    const detector = new KeywordDetectorImpl();
    expect(detector.detect('```\nultrawork\n```')).toMatchObject({ mode: 'normal' });
  });
});
