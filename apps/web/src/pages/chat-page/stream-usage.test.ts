import { describe, expect, it } from 'vitest';
import {
  hasUsableReportedUsageSnapshot,
  mergeChatBackendUsageSnapshot,
  toChatBackendUsageSnapshot,
} from './stream-usage.js';

describe('stream-usage', () => {
  it('normalizes a raw usage event into a stable snapshot', () => {
    expect(
      toChatBackendUsageSnapshot({
        type: 'usage',
        inputTokens: 48_100.3,
        outputTokens: 1_234.6,
        totalTokens: 49_334.9,
        round: 2,
      }),
    ).toEqual({
      inputTokens: 48_100,
      outputTokens: 1_235,
      totalTokens: 49_335,
      round: 2,
    });
  });

  it('prefers a later round over an older round snapshot', () => {
    expect(
      mergeChatBackendUsageSnapshot(
        {
          inputTokens: 10_000,
          outputTokens: 500,
          totalTokens: 10_500,
          round: 1,
        },
        {
          type: 'usage',
          inputTokens: 12_000,
          outputTokens: 900,
          totalTokens: 12_900,
          round: 2,
        },
      ),
    ).toEqual({
      inputTokens: 12_000,
      outputTokens: 900,
      totalTokens: 12_900,
      round: 2,
    });
  });

  it('keeps the larger total within the same round', () => {
    expect(
      mergeChatBackendUsageSnapshot(
        {
          inputTokens: 10_000,
          outputTokens: 500,
          totalTokens: 10_500,
          round: 2,
        },
        {
          type: 'usage',
          inputTokens: 10_000,
          outputTokens: 450,
          totalTokens: 10_450,
          round: 2,
        },
      ),
    ).toEqual({
      inputTokens: 10_000,
      outputTokens: 500,
      totalTokens: 10_500,
      round: 2,
    });
  });

  it('treats zero-total backend usage as unusable for exact-mode display', () => {
    expect(
      hasUsableReportedUsageSnapshot({
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        round: 1,
      }),
    ).toBe(false);
  });
});
