import { describe, expect, it } from 'vitest';
import {
  advanceStreamingReveal,
  calculateStreamingRevealDelay,
  calculateStreamingRevealStep,
} from './streaming-reveal.js';

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const nextCodeUnit = value.charCodeAt(index + 1);
      if (!(nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff)) {
        return true;
      }
      index += 1;
      continue;
    }
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return true;
    }
  }

  return false;
}

describe('streaming reveal pacing', () => {
  it('uses larger reveal steps when the backlog grows', () => {
    expect(calculateStreamingRevealStep(4)).toBe(2);
    expect(calculateStreamingRevealStep(12)).toBe(3);
    expect(calculateStreamingRevealStep(36)).toBe(5);
    expect(calculateStreamingRevealStep(96)).toBe(8);
    expect(calculateStreamingRevealStep(240)).toBe(14);
    expect(calculateStreamingRevealStep(500)).toBe(22);
  });

  it('adds a longer pause after punctuation and line breaks when backlog is small', () => {
    expect(calculateStreamingRevealDelay('，', 24)).toBeGreaterThan(
      calculateStreamingRevealDelay('字', 24),
    );
    expect(calculateStreamingRevealDelay('。', 24)).toBeGreaterThan(
      calculateStreamingRevealDelay('，', 24),
    );
    expect(calculateStreamingRevealDelay('\n', 24)).toBeGreaterThan(
      calculateStreamingRevealDelay('。', 24),
    );
  });

  it('skips punctuation pauses while the backlog is still large', () => {
    expect(calculateStreamingRevealDelay('。', 400)).toBeLessThan(
      calculateStreamingRevealDelay('。', 24),
    );
  });

  it('advances the visible content in paced slices', () => {
    const target = '第一段流式文本，应该逐步出现。';

    const first = advanceStreamingReveal('', target);
    const second = advanceStreamingReveal(first, target);

    expect(first.length).toBeGreaterThan(0);
    expect(first.length).toBeLessThan(target.length);
    expect(second.length).toBeGreaterThan(first.length);
    expect(second.length).toBeLessThanOrEqual(target.length);
  });

  it('snaps to the target when the visible content no longer matches the prefix', () => {
    const target = '完整目标内容';
    expect(advanceStreamingReveal('错误前缀', target)).toBe(target);
  });

  it('does not split emoji surrogate pairs while advancing', () => {
    const target = 'A😀B';

    const first = advanceStreamingReveal('', target);
    const second = advanceStreamingReveal(first, target);

    expect(Array.from(first).length).toBeGreaterThan(0);
    expect(hasUnpairedSurrogate(first)).toBe(false);
    expect(hasUnpairedSurrogate(second)).toBe(false);
    expect(advanceStreamingReveal(second, target)).toBe(target);
  });
});
