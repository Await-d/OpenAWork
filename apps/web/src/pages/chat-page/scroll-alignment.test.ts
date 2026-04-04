import { describe, expect, it } from 'vitest';
import { isScrollTopNearLatest, resolveLatestScrollTop } from './scroll-alignment.js';

describe('scroll-alignment', () => {
  it('centers compact latest assistant content when there is enough viewport space', () => {
    expect(
      resolveLatestScrollTop({
        align: 'center',
        anchorHeight: 240,
        anchorTop: 1_260,
        centerMarginPx: 32,
        clientHeight: 720,
        maxScrollTop: 1_800,
      }),
    ).toBe(1_020);
  });

  it('falls back to latest-edge alignment when the latest assistant block is taller than the focus window', () => {
    expect(
      resolveLatestScrollTop({
        align: 'center',
        anchorHeight: 700,
        anchorTop: 1_260,
        centerMarginPx: 32,
        clientHeight: 720,
        maxScrollTop: 1_800,
      }),
    ).toBe(1_800);
  });

  it('uses the absolute bottom target for latest-edge alignment', () => {
    expect(
      resolveLatestScrollTop({
        align: 'latest-edge',
        anchorHeight: 240,
        anchorTop: 1_260,
        centerMarginPx: 32,
        clientHeight: 720,
        maxScrollTop: 1_800,
      }),
    ).toBe(1_800);
  });

  it('treats scroll positions near the resolved target as following the latest content', () => {
    expect(
      isScrollTopNearLatest({
        align: 'center',
        anchorHeight: 240,
        anchorTop: 1_260,
        centerMarginPx: 32,
        clientHeight: 720,
        maxScrollTop: 1_800,
        scrollTop: 1_036,
        tolerancePx: 20,
      }),
    ).toBe(true);

    expect(
      isScrollTopNearLatest({
        align: 'center',
        anchorHeight: 240,
        anchorTop: 1_260,
        centerMarginPx: 32,
        clientHeight: 720,
        maxScrollTop: 1_800,
        scrollTop: 1_070,
        tolerancePx: 20,
      }),
    ).toBe(false);
  });
});
