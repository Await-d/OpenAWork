/**
 * DOM-free 拖拽命中判定：四边带、方向许可、零尺寸矩形、最上层优先、都不命中的兜底。
 */

import { describe, expect, it } from 'vitest';
import {
  resolveDropTarget,
  resolveRatioFromPointer,
  type PaneRect,
  type Rect,
} from './drop-target.js';

const PANE: PaneRect = { paneId: 'p1', x: 0, y: 30, width: 800, height: 500 };
const TAB_STRIP: Rect = { x: 0, y: 0, width: 800, height: 30 };

function dropFrom(
  pointer: { x: number; y: number },
  overrides: Partial<Parameters<typeof resolveDropTarget>[0]> = {},
) {
  return resolveDropTarget({
    paneRects: [PANE],
    tabStripRect: TAB_STRIP,
    pointer,
    ...overrides,
  });
}

describe('resolveRatioFromPointer', () => {
  const box: Rect = { x: 0, y: 0, width: 1000, height: 500 };

  it('row 按 x 比例、column 按 y 比例', () => {
    expect(resolveRatioFromPointer(box, 'row', { x: 250, y: 0 })).toBeCloseTo(0.25);
    expect(resolveRatioFromPointer(box, 'column', { x: 0, y: 400 })).toBeCloseTo(0.8);
  });

  it('钳制到 [MIN_RATIO, 1 - MIN_RATIO]', () => {
    expect(resolveRatioFromPointer(box, 'row', { x: -500, y: 0 })).toBe(0.1);
    expect(resolveRatioFromPointer(box, 'row', { x: 5000, y: 0 })).toBe(0.9);
  });

  it('自定义 minRatio 生效并钳制到 [0, 0.5]', () => {
    expect(resolveRatioFromPointer(box, 'row', { x: 0, y: 0 }, 0.3)).toBe(0.3);
    expect(resolveRatioFromPointer(box, 'row', { x: 0, y: 0 }, 0.9)).toBe(0.5);
    expect(resolveRatioFromPointer(box, 'row', { x: 0, y: 0 }, Number.NaN)).toBe(0.1);
  });

  it('零尺寸盒子 / 非有限指针 → 0.5', () => {
    expect(resolveRatioFromPointer({ x: 0, y: 0, width: 0, height: 500 }, 'row', { x: 0, y: 0 })).toBe(0.5);
    expect(resolveRatioFromPointer(box, 'row', { x: Number.NaN, y: 0 })).toBe(0.5);
    expect(resolveRatioFromPointer(box, 'column', { x: 0, y: Number.POSITIVE_INFINITY })).toBe(0.5);
  });
});

describe('resolveDropTarget —— tab 条优先', () => {
  it('命中 tab 条返回 tab-strip', () => {
    expect(dropFrom({ x: 100, y: 10 })).toEqual({ kind: 'tab-strip', index: 0 });
  });

  it('tab 条压过覆盖同一坐标的 pane', () => {
    const covering: PaneRect = { paneId: 'p2', x: 0, y: 0, width: 800, height: 600 };
    const result = resolveDropTarget({
      paneRects: [covering],
      tabStripRect: TAB_STRIP,
      pointer: { x: 100, y: 10 },
    });
    expect(result).toEqual({ kind: 'tab-strip', index: 0 });
  });

  it('tabCount 提供时按横向比例换算插入索引，且不超过 tabCount - 1', () => {
    const tabStripRect: Rect = { x: 0, y: 0, width: 100, height: 20 };
    const at = (x: number) =>
      resolveDropTarget({ paneRects: [], tabStripRect, pointer: { x, y: 10 }, tabCount: 4 });
    expect(at(10)).toEqual({ kind: 'tab-strip', index: 0 });
    expect(at(30)).toEqual({ kind: 'tab-strip', index: 1 });
    expect(at(99)).toEqual({ kind: 'tab-strip', index: 3 });
  });

  it('tabCount 非法时插入索引回落 0', () => {
    expect(dropFrom({ x: 100, y: 10 }, { tabCount: 0 })).toEqual({ kind: 'tab-strip', index: 0 });
    expect(dropFrom({ x: 100, y: 10 }, { tabCount: Number.NaN })).toEqual({
      kind: 'tab-strip',
      index: 0,
    });
  });

  it('零尺寸 tab 条不参与命中', () => {
    const result = resolveDropTarget({
      paneRects: [PANE],
      tabStripRect: { x: 0, y: 0, width: 800, height: 0 },
      pointer: { x: 400, y: 300 },
    });
    expect(result).toEqual({ kind: 'pane-center', paneId: 'p1' });
  });
});

describe('resolveDropTarget —— pane 四边带', () => {
  it('中心区域 → pane-center', () => {
    expect(dropFrom({ x: 400, y: 300 })).toEqual({ kind: 'pane-center', paneId: 'p1' });
  });

  it('左右边 → row 拆分，上下边 → column 拆分', () => {
    // 边带 = 0.25 * min(800, 500) = 125
    expect(dropFrom({ x: 100, y: 300 })).toEqual({
      kind: 'pane-edge',
      paneId: 'p1',
      edge: 'left',
    });
    expect(dropFrom({ x: 750, y: 300 })).toEqual({
      kind: 'pane-edge',
      paneId: 'p1',
      edge: 'right',
    });
    expect(dropFrom({ x: 400, y: 100 })).toEqual({
      kind: 'pane-edge',
      paneId: 'p1',
      edge: 'top',
    });
    expect(dropFrom({ x: 400, y: 500 })).toEqual({
      kind: 'pane-edge',
      paneId: 'p1',
      edge: 'bottom',
    });
  });

  it('角落取最近的边（等距时按 left → right → top → bottom 确定性取边）', () => {
    // 左上角：left 与 top 距离都是 0 → 取 left
    expect(dropFrom({ x: 0, y: 30 })).toEqual({ kind: 'pane-edge', paneId: 'p1', edge: 'left' });
    // 左下角：left 距离 60，bottom 距离 30 → 取更近的 bottom
    expect(dropFrom({ x: 60, y: 500 })).toEqual({
      kind: 'pane-edge',
      paneId: 'p1',
      edge: 'bottom',
    });
  });

  it('方向被禁时回退 pane-center', () => {
    expect(dropFrom({ x: 100, y: 300 }, { isDirectionAllowed: () => false })).toEqual({
      kind: 'pane-center',
      paneId: 'p1',
    });
    // 只禁 column：左右边（row）仍然是拆分
    expect(dropFrom({ x: 100, y: 300 }, { isDirectionAllowed: (d) => d === 'row' })).toEqual({
      kind: 'pane-edge',
      paneId: 'p1',
      edge: 'left',
    });
    expect(dropFrom({ x: 400, y: 100 }, { isDirectionAllowed: (d) => d === 'row' })).toEqual({
      kind: 'pane-center',
      paneId: 'p1',
    });
  });

  it('edgeRatio 钳制到 [0, 0.5]：0 时只在贴边命中，超上限等价于 0.5', () => {
    expect(dropFrom({ x: 400, y: 300 }, { edgeRatio: 0 })).toEqual({
      kind: 'pane-center',
      paneId: 'p1',
    });
    expect(dropFrom({ x: 0, y: 300 }, { edgeRatio: 0 })).toEqual({
      kind: 'pane-edge',
      paneId: 'p1',
      edge: 'left',
    });
    const square = { paneId: 'p1', x: 0, y: 30, width: 100, height: 100 };
    const centerOfSquare = { x: 50, y: 80 };
    const clamped = resolveDropTarget({
      paneRects: [square],
      tabStripRect: TAB_STRIP,
      pointer: centerOfSquare,
      edgeRatio: 0.9,
    });
    const half = resolveDropTarget({
      paneRects: [square],
      tabStripRect: TAB_STRIP,
      pointer: centerOfSquare,
      edgeRatio: 0.5,
    });
    expect(clamped).toEqual(half);
    expect(clamped.kind).toBe('pane-edge');
  });

  it('非法 edgeRatio 回落 0.25', () => {
    expect(dropFrom({ x: 100, y: 300 }, { edgeRatio: Number.NaN })).toEqual({
      kind: 'pane-edge',
      paneId: 'p1',
      edge: 'left',
    });
  });
});

describe('resolveDropTarget —— 矩形集合语义', () => {
  it('零尺寸矩形被跳过（即使它在数组末尾）', () => {
    const hidden: PaneRect = { paneId: 'hidden', x: 0, y: 30, width: 0, height: 500 };
    expect(dropFrom({ x: 400, y: 300 }, { paneRects: [PANE, hidden] })).toEqual({
      kind: 'pane-center',
      paneId: 'p1',
    });
  });

  it('数组靠后者优先（调用方按渲染顺序传入 → 最上层）', () => {
    const lower: PaneRect = { paneId: 'lower', x: 0, y: 30, width: 800, height: 500 };
    const upper: PaneRect = { paneId: 'upper', x: 200, y: 130, width: 200, height: 200 };
    expect(dropFrom({ x: 300, y: 200 }, { paneRects: [lower, upper] })).toEqual({
      kind: 'pane-center',
      paneId: 'upper',
    });
    // 落在上层的边带里 → 拆的是上层
    expect(dropFrom({ x: 210, y: 200 }, { paneRects: [lower, upper] })).toEqual({
      kind: 'pane-edge',
      paneId: 'upper',
      edge: 'left',
    });
  });

  it('都不命中 → detach', () => {
    expect(dropFrom({ x: 5000, y: 5000 })).toEqual({ kind: 'detach' });
    expect(dropFrom({ x: 400, y: 300 }, { paneRects: [] })).toEqual({ kind: 'detach' });
  });
});
