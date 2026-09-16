/**
 * DOM-free 的拖拽命中判定与分隔比例换算。
 *
 * 这一层刻意不碰 DOM：调用方（拖拽 hook）负责把真实几何量成 `PaneRect` / `Rect`
 * 传进来，本模块只做纯计算，因此可以直接单测「命中矩阵」而不需要 jsdom + getBoundingClientRect。
 */

import { MIN_RATIO, type TerminalDropTarget, type TerminalPaneEdge } from './types.js';

export interface PaneRect {
  paneId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ResolveDropTargetInput {
  paneRects: readonly PaneRect[];
  tabStripRect: Rect;
  pointer: { x: number; y: number };
  /** 边带宽度占短边的比例阈值，默认 0.25（钳制到 [0, 0.5]）。 */
  edgeRatio?: number;
  /** 该方向是否被允许（手机端禁用横向拆分时传 false 给 row 对应的边缘）。 */
  isDirectionAllowed?: (direction: 'row' | 'column') => boolean;
  /**
   * tab 条上的槽位总数：本层没有 tab 几何，只能把指针横向比例换算成插入索引。
   * 缺省（或非法）时返回 0，插入位仍由调用方按真实 tab rect 细化。
   */
  tabCount?: number;
}

const DEFAULT_EDGE_RATIO = 0.25;
const FALLBACK_RATIO = 0.5;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 零尺寸矩形不可是命中目标（隐藏 / 未布局的 pane 会算出 0 或负数）。 */
function isPositiveRect(rect: Rect): boolean {
  return (
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.width > 0 &&
    rect.height > 0
  );
}

/** 半开区间 [x, x+width) × [y, y+height)：右/下边界不属于该矩形。 */
function containsPoint(rect: Rect, pointer: { x: number; y: number }): boolean {
  return (
    pointer.x >= rect.x &&
    pointer.x < rect.x + rect.width &&
    pointer.y >= rect.y &&
    pointer.y < rect.y + rect.height
  );
}

function resolveMinRatio(minRatio: number | undefined): number {
  if (typeof minRatio !== 'number' || !Number.isFinite(minRatio)) return MIN_RATIO;
  return clamp(minRatio, 0, 0.5);
}

function resolveEdgeRatio(edgeRatio: number | undefined): number {
  if (typeof edgeRatio !== 'number' || !Number.isFinite(edgeRatio)) return DEFAULT_EDGE_RATIO;
  return clamp(edgeRatio, 0, 0.5);
}

/**
 * 由指针位置换算出分隔条比例（`children[0]` 的主轴占比）。
 * 零尺寸盒子无法换算 → 0.5；结果钳制到 [minRatio, 1 - minRatio]。
 */
export function resolveRatioFromPointer(
  box: Rect,
  direction: 'row' | 'column',
  pointer: { x: number; y: number },
  minRatio?: number,
): number {
  if (!isPositiveRect(box)) return FALLBACK_RATIO;
  const resolvedMin = resolveMinRatio(minRatio);
  const raw =
    direction === 'row'
      ? (pointer.x - box.x) / box.width
      : (pointer.y - box.y) / box.height;
  if (!Number.isFinite(raw)) return FALLBACK_RATIO;
  return clamp(raw, resolvedMin, 1 - resolvedMin);
}

/** 边带宽度按短边计（`edgeRatio * min(width, height)`），因此在极端长宽比下也不会互相吞没。 */
function resolveEdge(rect: Rect, pointer: { x: number; y: number }, edgeRatio: number): TerminalPaneEdge | null {
  const band = edgeRatio * Math.min(rect.width, rect.height);
  const candidates: readonly { edge: TerminalPaneEdge; distance: number }[] = [
    { edge: 'left', distance: pointer.x - rect.x },
    { edge: 'right', distance: rect.x + rect.width - pointer.x },
    { edge: 'top', distance: pointer.y - rect.y },
    { edge: 'bottom', distance: rect.y + rect.height - pointer.y },
  ];

  let best: { edge: TerminalPaneEdge; distance: number } | null = null;
  for (const candidate of candidates) {
    if (candidate.distance > band) continue;
    // 严格小于 → 角上等距时按 left → right → top → bottom 的固定顺序确定性取边。
    if (best === null || candidate.distance < best.distance) best = candidate;
  }
  return best === null ? null : best.edge;
}

function resolveTabIndex(rect: Rect, pointer: { x: number; y: number }, tabCount: number | undefined): number {
  if (typeof tabCount !== 'number' || !Number.isFinite(tabCount) || tabCount <= 0) return 0;
  const ratio = clamp((pointer.x - rect.x) / rect.width, 0, 1);
  return Math.min(Math.floor(tabCount), Math.floor(ratio * tabCount));
}

/**
 * DOM-free 命中判定。
 *
 * 判定顺序：tab 条 → 包含指针的 pane（**数组靠后者优先**，由调用方按渲染顺序传入，
 * 即最后绘制的那个在最上层）→ 都没命中则 `detach`（移出树成独立 tab）。
 */
export function resolveDropTarget(input: ResolveDropTargetInput): TerminalDropTarget {
  const { paneRects, tabStripRect, pointer, isDirectionAllowed } = input;
  const edgeRatio = resolveEdgeRatio(input.edgeRatio);

  if (isPositiveRect(tabStripRect) && containsPoint(tabStripRect, pointer)) {
    return { kind: 'tab-strip', index: resolveTabIndex(tabStripRect, pointer, input.tabCount) };
  }

  for (let index = paneRects.length - 1; index >= 0; index -= 1) {
    const rect = paneRects[index];
    if (rect === undefined) continue;
    if (!isPositiveRect(rect)) continue;
    if (!containsPoint(rect, pointer)) continue;

    const edge = resolveEdge(rect, pointer, edgeRatio);
    if (edge === null) return { kind: 'pane-center', paneId: rect.paneId };

    const direction: 'row' | 'column' = edge === 'left' || edge === 'right' ? 'row' : 'column';
    // 方向被禁（如手机端横向拆分）→ 回退为合并，而不是无意义地拆分。
    if (isDirectionAllowed !== undefined && !isDirectionAllowed(direction)) {
      return { kind: 'pane-center', paneId: rect.paneId };
    }
    return { kind: 'pane-edge', paneId: rect.paneId, edge };
  }

  return { kind: 'detach' };
}
