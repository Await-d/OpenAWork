import { describe, expect, it } from 'vitest';
import { EMPTY_GUI_USAGE, accumulateGuiUsage, hasBillableGuiUsage } from './gui-usage.js';

describe('accumulateGuiUsage', () => {
  it('从空状态累加一步', () => {
    const result = accumulateGuiUsage(EMPTY_GUI_USAGE, {
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 5,
      cacheWriteTokens: 1,
    });

    expect(result).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 5,
      cacheWriteTokens: 1,
      steps: 1,
    });
  });

  it('多步累加且步数递增', () => {
    let usage = EMPTY_GUI_USAGE;
    usage = accumulateGuiUsage(usage, {
      inputTokens: 100,
      outputTokens: 10,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
    usage = accumulateGuiUsage(usage, {
      inputTokens: 200,
      outputTokens: 30,
      cacheReadTokens: 7,
      cacheWriteTokens: 2,
    });

    expect(usage.inputTokens).toBe(300);
    expect(usage.outputTokens).toBe(40);
    expect(usage.cacheReadTokens).toBe(7);
    expect(usage.cacheWriteTokens).toBe(2);
    expect(usage.steps).toBe(2);
  });

  it('不修改入参（不可变）', () => {
    const current = { ...EMPTY_GUI_USAGE, inputTokens: 10, steps: 1 };
    const next = accumulateGuiUsage(current, {
      inputTokens: 5,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });

    expect(current.inputTokens).toBe(10);
    expect(current.steps).toBe(1);
    expect(next).not.toBe(current);
  });

  it('非有限值与负数计为 0，不污染累计', () => {
    const result = accumulateGuiUsage(EMPTY_GUI_USAGE, {
      inputTokens: Number.NaN,
      outputTokens: -5,
      cacheReadTokens: Number.POSITIVE_INFINITY,
      cacheWriteTokens: 3,
    });

    expect(result.inputTokens).toBe(0);
    expect(result.outputTokens).toBe(0);
    expect(result.cacheReadTokens).toBe(0);
    expect(result.cacheWriteTokens).toBe(3);
    expect(result.steps).toBe(1);
  });
});

describe('hasBillableGuiUsage', () => {
  it('全 0 时返回 false', () => {
    expect(hasBillableGuiUsage(EMPTY_GUI_USAGE)).toBe(false);
  });

  it('任一字段为正时返回 true', () => {
    expect(hasBillableGuiUsage({ ...EMPTY_GUI_USAGE, inputTokens: 1 })).toBe(true);
    expect(hasBillableGuiUsage({ ...EMPTY_GUI_USAGE, cacheWriteTokens: 1 })).toBe(true);
  });

  it('只有 steps 时仍返回 false（无 token 不该入账）', () => {
    expect(hasBillableGuiUsage({ ...EMPTY_GUI_USAGE, steps: 3 })).toBe(false);
  });
});
