import { describe, expect, it } from 'vitest';
import {
  buildReasoningOptions,
  formatReasoningLevels,
  readDeclaredReasoningLevels,
} from './reasoning-level-picker.js';

describe('readDeclaredReasoningLevels', () => {
  it('从 reasoningOptions 读取 effort 档位,过滤非法值', () => {
    expect(
      readDeclaredReasoningLevels([{ type: 'effort', values: ['low', 'xhigh', 'bogus'] }]),
    ).toEqual(['low', 'xhigh']);
  });

  it('未声明 / 非 effort 类型返回空数组', () => {
    expect(readDeclaredReasoningLevels(undefined)).toEqual([]);
    expect(readDeclaredReasoningLevels([{ type: 'temperature' }])).toEqual([]);
  });
});

describe('buildReasoningOptions', () => {
  it('空数组 = 清除声明,返回 undefined', () => {
    expect(buildReasoningOptions([])).toBeUndefined();
  });

  it('非空档位写回 { type: effort, values }', () => {
    expect(buildReasoningOptions(['low', 'high'])).toEqual([
      { type: 'effort', values: ['low', 'high'] },
    ]);
  });
});

describe('formatReasoningLevels', () => {
  it('空 = 自动,全部 = 全部,否则按短标签', () => {
    expect(formatReasoningLevels([])).toBe('自动');
    expect(formatReasoningLevels(['low', 'medium', 'high'])).toBe('low / med / high');
  });
});
