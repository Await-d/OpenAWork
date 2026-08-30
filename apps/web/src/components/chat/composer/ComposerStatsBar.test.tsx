// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ComposerStatsBar } from './ComposerStatsBar.js';
import type { ComposerStatsData } from './ComposerStatsBar.js';

function makeStats(contextMaxTokens: number): ComposerStatsData {
  return {
    totalCostUsd: 0,
    currentRoundCostUsd: 0,
    totalInputTokens: 200_000,
    totalOutputTokens: 0,
    contextUsedTokens: 200_000,
    contextMaxTokens,
    contextIsEstimated: true,
    messageTurns: 1,
    hiddenMessageCount: 0,
    serverTotalTurnCount: 1,
    compactionCount: 0,
    childSessionCount: 0,
    sessionTaskCount: 0,
    totalDurationMs: 0,
    streaming: false,
  };
}

describe('ComposerStatsBar', () => {
  it('上下文挡位变化后同步刷新窗口、百分比和 tooltip', () => {
    const { rerender } = render(<ComposerStatsBar data={makeStats(1_000_000)} />);

    expect(screen.getByTitle('模型上下文窗口：1,000,000 tokens')).toBeTruthy();
    expect(screen.getByTitle('估算上下文：200,000 / 1,000,000 (20%)')).toBeTruthy();

    rerender(<ComposerStatsBar data={makeStats(400_000)} />);

    expect(screen.getByTitle('模型上下文窗口：400,000 tokens')).toBeTruthy();
    expect(screen.getByTitle('估算上下文：200,000 / 400,000 (50%)')).toBeTruthy();
    expect(screen.queryByTitle('模型上下文窗口：1,000,000 tokens')).toBeNull();
  });
});
