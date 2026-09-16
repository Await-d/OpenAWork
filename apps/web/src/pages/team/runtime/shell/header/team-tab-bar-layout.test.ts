/**
 * team-tab-bar-layout · 子 tab 合并判定单测
 */

import { describe, expect, it } from 'vitest';
import { NAV_MERGE_RESERVED_WIDTH, shouldMergeSubTabs } from './team-tab-bar-layout.js';

describe('shouldMergeSubTabs', () => {
  it('宽度充足时合并', () => {
    expect(
      shouldMergeSubTabs({
        navWidth: 1200,
        mainWidth: 320,
        subWidth: 240,
        actionsWidth: 120,
      }),
    ).toBe(true);
  });

  it('恰好等于需求加余量时合并（含边界）', () => {
    const need = 320 + 240 + 120 + NAV_MERGE_RESERVED_WIDTH;
    expect(
      shouldMergeSubTabs({
        navWidth: need,
        mainWidth: 320,
        subWidth: 240,
        actionsWidth: 120,
      }),
    ).toBe(true);
  });

  it('差 1px 不合并', () => {
    const need = 320 + 240 + 120 + NAV_MERGE_RESERVED_WIDTH;
    expect(
      shouldMergeSubTabs({
        navWidth: need - 1,
        mainWidth: 320,
        subWidth: 240,
        actionsWidth: 120,
      }),
    ).toBe(false);
  });

  it('未布局（navWidth 为 0）时不合并，保持现状', () => {
    expect(shouldMergeSubTabs({ navWidth: 0, mainWidth: 0, subWidth: 0, actionsWidth: 0 })).toBe(
      false,
    );
  });

  it('子 tab 很多（自然宽大）时回退独立行', () => {
    expect(
      shouldMergeSubTabs({
        navWidth: 720,
        mainWidth: 320,
        subWidth: 420,
        actionsWidth: 120,
      }),
    ).toBe(false);
  });
});
