import { describe, expect, it } from 'vitest';

import {
  GALLERY_COLLAPSED_VISIBLE,
  GALLERY_FULL_GRID_MAX,
  resolveGalleryLayout,
} from './gallery-layout.js';

describe('resolveGalleryLayout', () => {
  it('0 张不渲染任何格子', () => {
    const layout = resolveGalleryLayout(0);
    expect(layout.columns).toBe(1);
    expect(layout.visibleCount).toBe(0);
    expect(layout.overflowCount).toBe(0);
  });

  it('1 张走单栏、只显示 1 格（宽高比与裁切由 CSS 决定，不在此断言）', () => {
    const layout = resolveGalleryLayout(1);
    expect(layout).toEqual({
      columns: 1,
      visibleCount: 1,
      overflowCount: 0,
      leadSpansRows: false,
    });
  });

  it('2 张等宽并排', () => {
    const layout = resolveGalleryLayout(2);
    expect(layout).toMatchObject({ columns: 2, visibleCount: 2, leadSpansRows: false });
  });

  it('3 张用两列且首格跨两行作主图', () => {
    const layout = resolveGalleryLayout(3);
    expect(layout).toMatchObject({ columns: 2, visibleCount: 3, leadSpansRows: true });
  });

  it('4 张走 2×2，且没有主图跨行', () => {
    const layout = resolveGalleryLayout(4);
    expect(layout).toMatchObject({ columns: 2, visibleCount: 4, leadSpansRows: false });
  });

  it('5–9 张走 3 列满格且不折叠', () => {
    for (let count = 5; count <= GALLERY_FULL_GRID_MAX; count += 1) {
      const layout = resolveGalleryLayout(count);
      expect(layout.columns).toBe(3);
      expect(layout.visibleCount).toBe(count);
      expect(layout.overflowCount).toBe(0);
    }
  });

  it('超过 9 张折叠为前 8 张 + 溢出数量', () => {
    const layout = resolveGalleryLayout(10);
    expect(layout.columns).toBe(3);
    expect(layout.visibleCount).toBe(GALLERY_COLLAPSED_VISIBLE);
    expect(layout.overflowCount).toBe(2);

    const large = resolveGalleryLayout(30);
    expect(large.visibleCount).toBe(GALLERY_COLLAPSED_VISIBLE);
    expect(large.overflowCount).toBe(22);
  });

  it('非法输入归一到 0 张且不抛错', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, -3, 2.7]) {
      const layout = resolveGalleryLayout(value);
      if (value === 2.7) {
        // 小数向下取整后按 2 张处理
        expect(layout.visibleCount).toBe(2);
        continue;
      }
      expect(layout.visibleCount).toBe(0);
    }
  });
});
