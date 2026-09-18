/**
 * 知识图谱 · 自组织力导向布局（确定性、有界、必然 settle）。
 *
 * 取代径向环作为**最终几何**：径向只保留为弱种子（`layoutRadialTree` 给出初始形态），
 * 最终坐标由力模拟解算。四类力的定义与迭代在 `knowledge-graph-force-field.ts`，
 * 邻居查询的 O(n) 空间哈希在 `knowledge-graph-spatial-hash.ts`；本模块是公开入口：
 * 布局、拖拽 reheating、重叠度量、按 model/视口/pins 缓存。
 *
 * 有界 + 确定性：固定迭代次数 + alpha 衰减 + 力平衡判据 ⇒ 必然收敛、必然终止、算完即冻结；
 * 初始坐标来自确定性径向种子，重合点分离方向由 id 哈希派生（无 `Math.random()` / `Date.now()`）。
 */

import { nodeDrawnRadius } from './knowledge-graph-label-text.js';
import {
  nodeRadiusForModel,
  type GraphViewportSize,
  type PositionedNode,
} from './knowledge-graph-layout.js';
import {
  buildForceState,
  resolveBounds,
  resolveIterationCount,
  resolveOptions,
  runForceIterations,
  type ForceLayoutOptions,
  type ForceState,
} from './knowledge-graph-force-field.js';
import type { GraphModel } from './knowledge-graph-model.js';
import type { GraphPinMap } from './knowledge-graph-pins.js';
import { buildSpatialHash, queryNeighbours } from './knowledge-graph-spatial-hash.js';

export type { ForceLayoutOptions } from './knowledge-graph-force-field.js';
export { buildSpatialHash, queryNeighbours } from './knowledge-graph-spatial-hash.js';
export type { SpatialHash } from './knowledge-graph-spatial-hash.js';

type ViewportSize = GraphViewportSize;

export interface ForceLayoutResult {
  readonly positions: readonly PositionedNode[];
  /** 解算耗时（ms）。仅缓存未命中时有意义。 */
  readonly settleMs: number;
  /** 最终任意两盘的最大重叠量（px，≥0）。 */
  readonly worstOverlap: number;
}

/**
 * 力导向布局主入口：`seed` 来自径向布局（弱种子），`pins` 为硬约束。
 * 返回与 `seed` 同序的最终坐标；`radius` 沿用 seed 的布局半径。
 */
export function layoutForceDirected(
  seed: readonly PositionedNode[],
  model: GraphModel,
  viewport: ViewportSize,
  pins: GraphPinMap,
  options: ForceLayoutOptions = {},
): readonly PositionedNode[] {
  if (seed.length === 0) {
    return seed;
  }
  const state = buildForceState(seed, model, pins);
  const bounds = resolveBounds(viewport, model.maxDepth, model.rootId !== null);
  const resolved = resolveOptions(options);
  const iterations = resolveIterationCount(seed.length, options.iterations);
  runForceIterations(state, bounds, resolved, iterations, null);

  return seed.map((entry, index) => ({
    model: entry.model,
    x: state.xs[index]!,
    y: state.ys[index]!,
    radius: entry.radius,
  }));
}

/**
 * 拖拽 reheating：从**当前实时坐标**出发，只让被拖节点的有界邻域参与，迭代有界。
 * 返回邻域内节点的新坐标（不含被拖节点自身）。
 */
export function reheatForceNeighbourhood(input: {
  readonly model: GraphModel;
  readonly viewport: ViewportSize;
  readonly pins: GraphPinMap;
  readonly positions: ReadonlyMap<string, { readonly x: number; readonly y: number }>;
  readonly dragId: string;
  readonly depth?: number;
  readonly iterations?: number;
}): Map<string, { readonly x: number; readonly y: number }> {
  const { model, viewport, pins, positions, dragId } = input;
  const seed: PositionedNode[] = [];
  for (const node of model.nodes) {
    const position = positions.get(node.id);
    if (!position) {
      continue;
    }
    seed.push({
      model: node,
      x: position.x,
      y: position.y,
      radius: Math.max(1, nodeRadiusForModel(node)),
    });
  }
  if (seed.length === 0) {
    return new Map();
  }
  const state = buildForceState(seed, model, pins);
  const bounds = resolveBounds(viewport, model.maxDepth, model.rootId !== null);
  const active = collectNeighbourhood(state, model, dragId, input.depth ?? 2);
  const resolved = resolveOptions({});
  runForceIterations(state, bounds, resolved, input.iterations ?? 26, active);

  const result = new Map<string, { readonly x: number; readonly y: number }>();
  for (let index = 0; index < state.ids.length; index += 1) {
    const id = state.ids[index]!;
    if (id === dragId || active[index] !== 1) {
      continue;
    }
    result.set(id, { x: state.xs[index]!, y: state.ys[index]! });
  }
  return result;
}

/** 有界邻域：从被拖节点沿全部边 BFS 到 `depth` 跳。 */
function collectNeighbourhood(
  state: ForceState,
  model: GraphModel,
  dragId: string,
  depth: number,
): Uint8Array {
  const active = new Uint8Array(state.ids.length);
  const start = state.indexById.get(dragId);
  if (start === undefined) {
    return active;
  }
  const adjacency = new Map<string, string[]>();
  for (const edge of model.edges) {
    const forward = adjacency.get(edge.from);
    if (forward) {
      forward.push(edge.to);
    } else {
      adjacency.set(edge.from, [edge.to]);
    }
    const backward = adjacency.get(edge.to);
    if (backward) {
      backward.push(edge.from);
    } else {
      adjacency.set(edge.to, [edge.from]);
    }
  }
  const visited = new Set<string>([dragId]);
  let frontier: string[] = [dragId];
  for (let hop = 0; hop < depth; hop += 1) {
    const next: string[] = [];
    for (const current of frontier) {
      for (const neighbour of adjacency.get(current) ?? []) {
        if (visited.has(neighbour)) {
          continue;
        }
        visited.add(neighbour);
        next.push(neighbour);
      }
    }
    frontier = next;
  }
  visited.delete(dragId);
  for (const id of visited) {
    const index = state.indexById.get(id);
    if (index !== undefined) {
      active[index] = 1;
    }
  }
  return active;
}

/** 任意两盘的最大重叠量（px，≥0）。`radius` 应为**绘制半径**。 */
export function measureWorstOverlap(
  discs: readonly { readonly x: number; readonly y: number; readonly radius: number }[],
): number {
  if (discs.length < 2) {
    return 0;
  }
  const points = discs.map((disc) => ({ x: disc.x, y: disc.y }));
  let maxRadius = 0;
  for (const disc of discs) {
    maxRadius = Math.max(maxRadius, disc.radius);
  }
  const hash = buildSpatialHash(points, Math.max(16, 2 * maxRadius));
  let worst = 0;
  for (let index = 0; index < discs.length; index += 1) {
    const neighbours = queryNeighbours(hash, points, index, 2 * maxRadius);
    for (const other of neighbours) {
      const overlap =
        discs[index]!.radius +
        discs[other]!.radius -
        Math.hypot(points[index]!.x - points[other]!.x, points[index]!.y - points[other]!.y);
      if (overlap > worst) {
        worst = overlap;
      }
    }
  }
  return worst;
}

/** 计算某次布局结果的 drawn 半径重叠上界（供状态条与测试复用）。 */
export function worstDrawnOverlap(positions: readonly PositionedNode[]): number {
  return measureWorstOverlap(
    positions.map((entry) => ({
      x: entry.x,
      y: entry.y,
      radius: nodeDrawnRadius(
        entry.model.collapsed === true,
        entry.model.descendantCount ?? 0,
        entry.radius,
      ),
    })),
  );
}

interface CachedLayout {
  readonly viewport: string;
  readonly pins: GraphPinMap;
  readonly result: ForceLayoutResult;
}

const layoutCache = new WeakMap<GraphModel, CachedLayout>();

function viewportKey(viewport: ViewportSize): string {
  return `${Math.round(viewport.width)}x${Math.round(viewport.height)}`;
}

/**
 * 带缓存的布局入口：同一 `model` / 视口 / pins 只解算一次。
 * 焦点、配色、标签密度变化不会触发重算（它们不参与几何）。
 */
export function computeForceLayout(
  model: GraphModel,
  viewport: ViewportSize,
  pins: GraphPinMap,
  seedFactory: () => readonly PositionedNode[],
): ForceLayoutResult {
  const key = viewportKey(viewport);
  const cached = layoutCache.get(model);
  if (cached && cached.pins === pins && cached.viewport === key) {
    return cached.result;
  }
  const start = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const seed = seedFactory();
  const positions = layoutForceDirected(seed, model, viewport, pins);
  const settleMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - start;
  const result: ForceLayoutResult = {
    positions,
    settleMs,
    worstOverlap: worstDrawnOverlap(positions),
  };
  layoutCache.set(model, { viewport: key, pins, result });
  return result;
}
