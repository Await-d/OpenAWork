import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { UsageDashboard } from './UsageDashboard.js';

describe('UsageDashboard', () => {
  it('展示月度缓存读取与写入 token', () => {
    const markup = renderToStaticMarkup(
      createElement(UsageDashboard, {
        records: [
          {
            month: '2026-08',
            totalCostUsd: 0.0087,
            totalInputTokens: 0,
            totalOutputTokens: 0,
            totalCacheReadTokens: 4_000,
            totalCacheWriteTokens: 2_000,
            byProvider: {},
          },
        ],
      }),
    );

    expect(markup).toContain('4,000 缓存读取');
    expect(markup).toContain('2,000 缓存写入');
  });
});
