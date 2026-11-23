import { describe, expect, it } from 'vitest';

import {
  formatResultCount,
  formatShortDate,
  formatShortDateTime,
  formatUsdPrice,
  pickBoolean,
  pickNumber,
  pickText,
  resultAvatarText,
  resultToneIndex,
} from './result-view.js';

describe('pickText / pickNumber / pickBoolean', () => {
  it('按顺序取第一个非空值（空字符串不算命中）', () => {
    expect(pickText({ a: '', b: '  x  ' }, ['a', 'b'])).toBe('x');
    expect(pickNumber({ a: 'x', b: 7 }, ['a', 'b'])).toBe(7);
    expect(pickBoolean({ a: 1, b: false }, ['a', 'b'])).toBe(false);
  });

  it('都没有时返回 undefined（不抛错、不返回 null）', () => {
    expect(pickText({}, ['a'])).toBeUndefined();
    expect(pickNumber({ a: 'x' }, ['a'])).toBeUndefined();
    expect(pickBoolean({ a: 1 }, ['a'])).toBeUndefined();
  });
});

describe('formatShortDateTime / formatShortDate', () => {
  it('0 表示「未知」而不是 1970（网关的 released 就是这么用的）', () => {
    expect(formatShortDate(0)).toBeUndefined();
    expect(formatShortDateTime(0)).toBeUndefined();
  });

  it('负数 / NaN / 非法字符串一律返回 undefined', () => {
    expect(formatShortDate(-1)).toBeUndefined();
    expect(formatShortDate(Number.NaN)).toBeUndefined();
    expect(formatShortDate('not-a-date')).toBeUndefined();
    expect(formatShortDateTime('')).toBeUndefined();
    expect(formatShortDateTime(null)).toBeUndefined();
  });

  it('合法时间戳给出 MM-DD 形态', () => {
    expect(formatShortDate('2026-01-08T00:00:00.000Z')).toMatch(/^\d{2}-\d{2}$/);
  });
});

describe('formatUsdPrice', () => {
  it('去掉无意义的尾随零', () => {
    expect(formatUsdPrice(3)).toBe('$3');
    expect(formatUsdPrice(0.275)).toBe('$0.275');
    expect(formatUsdPrice(0.5)).toBe('$0.5');
  });

  it('0 与非法值各有明确输出', () => {
    expect(formatUsdPrice(0)).toBe('$0');
    expect(formatUsdPrice(Number.POSITIVE_INFINITY)).toBe('—');
  });
});

describe('formatResultCount', () => {
  it('大数压缩成 k', () => {
    expect(formatResultCount(999)).toBe('999');
    expect(formatResultCount(1284)).toBe('1.3k');
    expect(formatResultCount(12840)).toBe('13k');
  });
});

describe('resultToneIndex', () => {
  it('同名同色、跨调用稳定，且落在 6 档内', () => {
    expect(resultToneIndex('workbuddy')).toBe(resultToneIndex('workbuddy'));
    for (const seed of ['a', 'workbuddy', '项目群', '']) {
      const tone = resultToneIndex(seed);
      expect(tone).toBeGreaterThanOrEqual(0);
      expect(tone).toBeLessThan(6);
    }
  });

  it('不同名字会分散到不同档位（不是恒定返回同一个值）', () => {
    const tones = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(resultToneIndex));
    expect(tones.size).toBeGreaterThan(1);
  });
});

describe('resultAvatarText', () => {
  it('中文取 1 个字，拉丁取前 2 个字母并大写', () => {
    expect(resultAvatarText('项目群')).toBe('项');
    expect(resultAvatarText('workbuddy')).toBe('WO');
    expect(resultAvatarText('GPT-5 mini')).toBe('GP');
  });

  it('空字符串给出占位而不是空白方块', () => {
    expect(resultAvatarText('   ')).toBe('?');
  });
});
