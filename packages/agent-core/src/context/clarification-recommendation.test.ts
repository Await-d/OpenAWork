import { describe, expect, it } from 'vitest';
import {
  findRecommendedOption,
  normalizeRecommendedOptions,
} from './clarification-recommendation.js';
import type { ClarificationNodeOption } from './clarification-tree.js';

describe('normalizeRecommendedOptions', () => {
  it('无推荐项时原样返回（不臆造推荐）', () => {
    const options: ClarificationNodeOption[] = [{ label: 'a' }, { label: 'b' }];
    expect(normalizeRecommendedOptions(options)).toEqual([{ label: 'a' }, { label: 'b' }]);
  });

  it('已有唯一推荐项时保持不变', () => {
    const options: ClarificationNodeOption[] = [
      { label: 'a' },
      { label: 'b', recommended: true },
    ];
    expect(normalizeRecommendedOptions(options).map((o) => o.recommended)).toEqual([
      undefined,
      true,
    ]);
  });

  it('多个推荐项时只保留第一个，其余降为 false', () => {
    const options: ClarificationNodeOption[] = [
      { label: 'a', recommended: true },
      { label: 'b', recommended: true },
      { label: 'c', recommended: true },
    ];
    const normalized = normalizeRecommendedOptions(options);
    expect(normalized.map((o) => o.recommended)).toEqual([true, false, false]);
  });

  it('不可变：不修改入参数组及其元素', () => {
    const options: ClarificationNodeOption[] = [
      { label: 'a', recommended: true },
      { label: 'b', recommended: true },
    ];
    normalizeRecommendedOptions(options);
    expect(options.map((o) => o.recommended)).toEqual([true, true]);
  });

  it('返回新对象（非引用共享）', () => {
    const options: ClarificationNodeOption[] = [{ label: 'a' }];
    const normalized = normalizeRecommendedOptions(options);
    expect(normalized[0]).not.toBe(options[0]);
  });
});

describe('findRecommendedOption', () => {
  it('返回推荐项', () => {
    const options: ClarificationNodeOption[] = [
      { label: 'a' },
      { label: 'b', recommended: true },
    ];
    expect(findRecommendedOption(options)?.label).toBe('b');
  });

  it('无推荐项时返回 undefined', () => {
    expect(findRecommendedOption([{ label: 'a' }])).toBeUndefined();
  });
});
