import type { GraphNodeKind } from '../../../data/build-knowledge-graph.js';
import type { GraphModel, GraphNodeModel } from './knowledge-graph-model.js';
import { EMPTY_GRAPH_PINS, type GraphPinMap } from './knowledge-graph-pins.js';
import { countDiscRadius } from './knowledge-graph-label-text.js';
import { aggregateRadiusFor } from './knowledge-graph-radius.js';
import { planRings, radialGapForNode } from './knowledge-graph-ring-plan.js';
import { separateDiscs } from './knowledge-graph-separation.js';

export { aggregateRadiusFor } from './knowledge-graph-radius.js';

export interface PositionedNode {
  readonly model: GraphNodeModel;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

/** 布局使用的实时视口尺寸（容器测量值）。 */
export interface GraphViewportSize {
  readonly width: number;
  readonly height: number;
}

/**
 * 逻辑基准视口：仅作为 `viewport` 缺失 / 未测量（0×0）时的回退，
 * 真实布局一律以调用方传入的实时容器尺寸为准。
 */
export const GRAPH_VIEW_WIDTH = 960;
export const GRAPH_VIEW_HEIGHT = 560;

/**
 * 画布边缘预留（px）。节点标签渲染在节点**下方**且带阴影，外环贴边会裁断底部/两侧的标签。
 * 非概览视图的外环放的是普通内容节点（半径 ≤ 16），标签下沿约
 * `16 + LABEL_OFFSET_Y(4) + 行高(≈18)` ≈ 38，取 40 即够；旧值 56 比实际需要大，
 * 白白吃掉 16px 径向预算——展开多层分类时会因此把内层挤到重叠。
 */
export const GRAPH_EDGE_MARGIN = 40;
/**
 * 折叠概览（树深 ≤ 该值）启用横向填充。此时可见节点只有工作区 + 分类，圆形预算被容器
 * **短边**限制，在宽而矮的画布里会缩成正中一小团；按容器宽高比把环横向拉伸即可铺满画布。
 */
export const SHALLOW_OVERVIEW_MAX_DEPTH = 2;
/**
 * 概览横向填充时的画布边距：比叶子更宽，因为概览最外环放的是折叠聚合节点——
 * 半径可达 `AGGREGATE_RADIUS_MAX`，标签字号 / 行高也更大。
 */
const SHALLOW_OVERVIEW_EDGE_MARGIN = 80;
/** 概览判定的唯一入口：浅视图（树深 ≤ `SHALLOW_OVERVIEW_MAX_DEPTH` 且有根）才启用横向填充与更宽边距。 */
export function isShallowOverview(hasRoot: boolean, maxDepth: number): boolean {
  return hasRoot && maxDepth <= SHALLOW_OVERVIEW_MAX_DEPTH;
}
/**
 * 视口边距：浅视图用更宽的概览边距，其余用叶子边距。布局与容量检查共用，
 * 保证「容量声明的半径预算」与「布局实际使用的半径预算」不可能分叉。
 */
export function graphLayoutMargin(shallowOverview: boolean): number {
  return shallowOverview ? SHALLOW_OVERVIEW_EDGE_MARGIN : GRAPH_EDGE_MARGIN;
}
/**
 * 径向半径预算：`min(width, height) / 2 - margin`。外环半径契约（居中 / 不裁切）依赖该不变量，
 * 容量函数复用同一函数推导，避免出现第二套半径口径。
 */
export function graphMaxRadiusForViewport(
  viewport: GraphViewportSize,
  options: { readonly shallowOverview: boolean },
): number {
  const width = resolveDimension(viewport.width, GRAPH_VIEW_WIDTH);
  const height = resolveDimension(viewport.height, GRAPH_VIEW_HEIGHT);
  return Math.max(0, Math.min(width, height) / 2 - graphLayoutMargin(options.shallowOverview));
}
/** 概览横向拉伸上限：再宽也不把环压成扁平椭圆，环仍应读作一个整体。 */
export const SHALLOW_OVERVIEW_MAX_ASPECT = 1.75;
const RADIAL_EXPONENT = 0.75;
/** Share of a parent span reserved for the adaptive gaps between siblings. */
const SIBLING_GAP_SHARE = 0.12;
const ROOT_START_ANGLE = -Math.PI / 2;
const FULL_TURN = Math.PI * 2;
/** Minimum angular slot per orphan node on the outer ring (15°). */
const ORPHAN_SLOT_ANGLE = Math.PI / 12;

/**
 * 有机化偏移全部来自确定性哈希（严禁 `Math.random()`），且全部有界：
 * 角度偏移保证分组扇区仍近似均分，半径偏移不会让相邻环带互相穿越。
 */
/** 每节点最大角度偏移（弧度，约 ±2.6°）。 */
export const ORGANIC_ANGLE_JITTER = 0.045;
/** 半径偏移占「相邻环最小间距」的比例；两侧各 16%，环带不会互相穿越。 */
export const ORGANIC_RADIAL_JITTER_SHARE = 0.16;
/** 环半径自身的轻微非均匀（±5%），打破纯幂曲线的等距感；最外环保持基准半径以维持居中契约。 */
export const RING_RADIUS_VARIATION = 0.05;

/**
 * 碰撞最小中心距系数：`minCentreDistance = COLLISION_DISTANCE_RATIO × (rA + rB)`。
 *
 * 这是「有机 vs 可读」故意留出的折衷旋钮：自组织力导向要自由聚类，强制 `1.0`（严格分离）会让
 * 连杆吸引与接触排斥持续对拉、簇内节点反复拉锯；低于 ~0.6 则密集簇重新糊成实心团。
 * 调高 ⇒ 更规整；调低 ⇒ 更有机、更紧。由 `knowledge-graph-force-field.ts` 的碰撞斥力消费。
 */
export const COLLISION_DISTANCE_RATIO = 0.7;

/** 可选的布局开关。`organic` 缺省为 `true`：生产渲染默认带有机偏移。 */
export interface GraphLayoutOptions {
  readonly organic?: boolean;
}

/**
 * 纯哈希 → [0, 1) 的确定性单位值（FNV-1a 32 位）。
 * 相同 `seed` 永远得到相同结果，不依赖时间 / 随机源。
 */
export function seededUnit(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash / 0x100000000;
}

/** 哈希映射到 [-1, 1)，用于对称的偏移分布。 */
function seededSigned(seed: string): number {
  return seededUnit(seed) * 2 - 1;
}

export function nodeRadiusFor(kind: GraphNodeKind, persisted: boolean): number {
  if (kind === 'workspace') {
    return 30;
  }
  if (kind === 'category') {
    return 19;
  }
  if (kind === 'artifact') {
    return persisted ? 15 : 13;
  }
  return persisted ? 16 : 14;
}

/**
 * 折叠聚合节点的半径数学（计数上限 + 环拥挤收缩）统一在 `knowledge-graph-radius.ts`，
 * 布局层与样式层共用同一份半径契约；这里保留 `aggregateRadiusFor` 的 re-export 以兼容
 * 既有导入路径。
 */

/**
 * 模型节点的**最终**半径：承载计数的节点在这里一次算定——折叠聚合取计数半径，工作区枢纽取
 * 「盘内计数徽标的最小可读下界」——**先于任何摆放 / 环间距 / 分离推导**。
 *
 * 这是 D2 的顺序要求：环带规划与分离都按这份半径推导中心距，若它们按「叶子基础半径」估算、
 * 而实际绘制盘因计数而更大，间距与真实盘面就会脱节，大盘会溢到邻盘上。
 */
export function nodeRadiusForModel(model: GraphNodeModel): number {
  const base = nodeRadiusFor(model.kind, model.persisted);
  const count = model.descendantCount ?? 0;
  if (count <= 0) {
    return base;
  }
  if (model.collapsed === true) {
    return Math.max(base, aggregateRadiusFor(count));
  }
  if (model.kind === 'workspace') {
    // 工作区枢纽与其它计数节点一致地在盘内显示计数，并共用同一条腿脚（计数半径 + 徽标可读托底），
    // 盘内数字因此与折叠聚合一样落在盘心而不是贴着 rim。
    return countDiscRadius(count, base);
  }
  return base;
}

/**
 * 圆心节点的最终半径：直接复用 `nodeRadiusForModel`，让最内层净空按**实际盘面**（含工作区枢纽
 * 的计数徽标托底）推导，而不是先按基础半径预留、再在绘制时撑大。
 */
export function resolveRootRadius(model: GraphModel): number {
  const root = model.rootId === null ? undefined : model.byId.get(model.rootId);
  return root ? nodeRadiusForModel(root) : nodeRadiusFor('workspace', true);
}

/**
 * Leaves in each reachable subtree (a leaf counts as 1). Reachable nodes are processed
 * deepest-first so every child is counted before its parent (BFS guarantees child depth = parent depth + 1).
 */
function computeLeafCounts(model: GraphModel): Map<string, number> {
  const leafCounts = new Map<string, number>();
  const reachable = model.nodes
    .filter((node) => node.depth <= model.maxDepth)
    .sort((left, right) => right.depth - left.depth);

  for (const node of reachable) {
    const children = model.childrenOf.get(node.id) ?? [];
    if (children.length === 0) {
      leafCounts.set(node.id, 1);
      continue;
    }
    let total = 0;
    for (const childId of children) {
      total += leafCounts.get(childId) ?? 1;
    }
    leafCounts.set(node.id, total);
  }

  return leafCounts;
}

/**
 * 节点角度取自身区间的中点。
 * - 根的直接子节点（分组）**均分**树跨度，形成对称象限；若按叶子数比例分配，叶子多的分组会独占大半圈，
 *   整个图退化为月牙形。
 * - 更深层级仍按叶子数比例分配，让密集子树获得更大扇区，内部不互相挤压。
 */
function assignSubtreeAngles(
  model: GraphModel,
  nodeId: string,
  start: number,
  end: number,
  leafCounts: ReadonlyMap<string, number>,
  angles: Map<string, number>,
  spans: Map<string, { readonly start: number; readonly end: number }>,
  evenSplit: boolean,
): void {
  angles.set(nodeId, (start + end) / 2);
  spans.set(nodeId, { start, end });

  const children = model.childrenOf.get(nodeId) ?? [];
  if (children.length === 0) {
    return;
  }

  const span = end - start;
  const gapCount = children.length - 1;
  const reserve = gapCount > 0 ? span * SIBLING_GAP_SHARE : 0;
  const gap = gapCount > 0 ? reserve / gapCount : 0;
  const usable = span - reserve;

  let totalLeaves = 0;
  for (const childId of children) {
    totalLeaves += leafCounts.get(childId) ?? 1;
  }

  let cursor = start;
  for (const childId of children) {
    const share = evenSplit
      ? 1 / children.length
      : totalLeaves > 0
        ? (leafCounts.get(childId) ?? 1) / totalLeaves
        : 1 / children.length;
    const width = usable * share;
    assignSubtreeAngles(model, childId, cursor, cursor + width, leafCounts, angles, spans, false);
    cursor += width + gap;
  }
}

function baseRingRadius(depth: number, maxDepth: number, maxRadius: number): number {
  if (depth <= 0) {
    return 0;
  }
  const denominator = Math.max(1, maxDepth);
  return maxRadius * Math.pow(depth / denominator, RADIAL_EXPONENT);
}

/**
 * 环半径：内环带 ±`RING_RADIUS_VARIATION` 的确定性扰动，最外环锁定基准半径，
 * 这样外环依旧精确落在 `maxRadius` 上（居中 / 不裁切契约依赖该不变量）。
 */
function ringRadiusForDepth(
  depth: number,
  maxDepth: number,
  maxRadius: number,
  organic: boolean,
): number {
  const base = baseRingRadius(depth, maxDepth, maxRadius);
  if (!organic || depth <= 0 || depth >= maxDepth) {
    return base;
  }
  return base * (1 + seededSigned(`ring:${depth}`) * RING_RADIUS_VARIATION);
}

/**
 * 单节点有机偏移：角度 ±`ORGANIC_ANGLE_JITTER`，半径 ±`ORGANIC_RADIAL_JITTER_SHARE`
 * 乘以该节点到相邻环带的最小径向间距（`radialGap`），保证偏移不会穿越邻带。
 * `radialGap` 为 null（最外环 / 游离节点）时不做半径偏移，维持外边界稳定。
 */
function applyOrganicOffset(input: {
  readonly id: string;
  readonly angle: number;
  readonly radius: number;
  readonly radialGap: number | null;
  readonly organic: boolean;
}): { readonly angle: number; readonly radius: number } {
  const { id, angle, radius, radialGap, organic } = input;
  if (!organic) {
    return { angle, radius };
  }
  const jitteredAngle = angle + seededSigned(`angle:${id}`) * ORGANIC_ANGLE_JITTER;
  if (radialGap === null || radialGap <= 0) {
    return { angle: jitteredAngle, radius };
  }
  const radialJitter = seededSigned(`radius:${id}`) * ORGANIC_RADIAL_JITTER_SHARE * radialGap;
  return { angle: jitteredAngle, radius: radius + radialJitter };
}

function positionOnRing(
  centerX: number,
  centerY: number,
  angle: number,
  radius: number,
  radiusX: number = radius,
): { x: number; y: number } {
  return {
    x: centerX + Math.cos(angle) * radiusX,
    y: centerY + Math.sin(angle) * radius,
  };
}

/** 视口边长合法值；未测量（0 / 负数 / NaN）时回退逻辑基准，保证不产生 NaN 坐标。 */
function resolveDimension(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * 径向树布局。圆心与半径预算由实时 `viewport` 推导，因此同一份模型在任意容器尺寸下都会
 * 居中且完整可见；`pins` 中的节点保留用户拖拽位置，不参与环半径计算。
 */
export function layoutRadialTree(
  model: GraphModel,
  viewport: GraphViewportSize,
  pins: GraphPinMap = EMPTY_GRAPH_PINS,
  options: GraphLayoutOptions = {},
): readonly PositionedNode[] {
  const organic = options.organic !== false;
  const width = resolveDimension(viewport.width, GRAPH_VIEW_WIDTH);
  const height = resolveDimension(viewport.height, GRAPH_VIEW_HEIGHT);
  const centerX = width / 2;
  const centerY = height / 2;
  const shallowOverview = isShallowOverview(model.rootId !== null, model.maxDepth);
  const margin = graphLayoutMargin(shallowOverview);
  const maxRadius = graphMaxRadiusForViewport({ width, height }, { shallowOverview });
  const maxRadiusX = Math.max(0, width / 2 - margin);
  const ringAspect =
    shallowOverview && height > 0
      ? Math.min(SHALLOW_OVERVIEW_MAX_ASPECT, Math.max(1, width / height))
      : 1;

  const leafCounts = computeLeafCounts(model);
  const angles = new Map<string, number>();
  const spans = new Map<string, { readonly start: number; readonly end: number }>();
  const orphanRadii = new Map<string, number>();

  const orphanIds: string[] = [];
  for (const node of model.nodes) {
    if (node.depth > model.maxDepth) {
      orphanIds.push(node.id);
    }
  }

  const hasRoot = model.rootId !== null;
  const orphanCount = orphanIds.length;
  // Orphans occupy a trailing arc so they never overlap the tree. Without a root the arc is the whole ring.
  let orphanArc = 0;
  if (orphanCount > 0) {
    orphanArc = hasRoot ? Math.min(Math.PI, orphanCount * ORPHAN_SLOT_ANGLE) : FULL_TURN;
  }
  const treeSpan = FULL_TURN - orphanArc;

  if (model.rootId !== null) {
    // 聚合视图下，根的直接子节点按**可见子树规模**分配扇区：展开的大分类获得更多角度，
    // 折叠的分类只占一个点。非聚合（小图全展开）仍均分，保持既有对称观感。
    assignSubtreeAngles(
      model,
      model.rootId,
      ROOT_START_ANGLE,
      ROOT_START_ANGLE + treeSpan,
      leafCounts,
      angles,
      spans,
      !model.aggregated,
    );
  }

  const planInput = {
    model,
    angles,
    spans,
    maxRadius,
    rootRadius: resolveRootRadius(model),
    nominalRadiusOf: nodeRadiusForModel,
    designRadiusOf: (depth: number) =>
      ringRadiusForDepth(depth, model.maxDepth, maxRadius, organic),
  };
  const firstPass = planRings(planInput);
  const rings =
    firstPass.effectiveMaxByDepth.size > 0
      ? planRings({ ...planInput, effectiveMaxByDepth: firstPass.effectiveMaxByDepth })
      : firstPass;

  if (orphanCount > 0) {
    const orphanStart = ROOT_START_ANGLE + treeSpan;
    for (let index = 0; index < orphanIds.length; index += 1) {
      const id = orphanIds[index];
      if (id === undefined) {
        continue;
      }
      angles.set(id, orphanStart + ((index + 0.5) / orphanCount) * orphanArc);
      orphanRadii.set(id, maxRadius);
    }
  }

  const pinnedIds = new Set(pins.keys());
  const positioned = model.nodes.map((node) => {
    const radius = rings.resolvedRadiusById.get(node.id) ?? nodeRadiusForModel(node);
    const pin = pins.get(node.id);
    if (pin) {
      return { model: node, x: pin.x, y: pin.y, radius };
    }
    const baseAngle = rings.angleById.get(node.id) ?? angles.get(node.id) ?? ROOT_START_ANGLE;
    const baseRadius = rings.bandRadiusById.get(node.id) ?? orphanRadii.get(node.id) ?? 0;
    const { angle, radius: jitteredRadius } = applyOrganicOffset({
      id: node.id,
      angle: baseAngle,
      radius: baseRadius,
      radialGap: radialGapForNode(node, rings, model.maxDepth, maxRadius),
      organic,
    });
    const { x, y } = positionOnRing(
      centerX,
      centerY,
      angle,
      jitteredRadius,
      Math.min(maxRadiusX, jitteredRadius * ringAspect),
    );
    return { model: node, x, y, radius };
  });

  return separateOverlappingDiscs(positioned, {
    centerX,
    centerY,
    maxRadius,
    maxRadiusX,
    pinnedIds,
  });
}

/**
 * 有界 + 确定性的盘间分离（D2）：环带规划只按「角度 + 半径」摆放节点，径向预算被挤爆时会退化
 * 成「把节点塞进子环」，相邻两盘的中心距因此可能小于两半径之和。分离在**确实存在重叠**时才
 * 移动节点，且位移后仍钳制在同一份视口预算内；常规布局（折叠概览、小图、正常子环）逐位不变。
 * 预算为 0（容器未测量 / 极小）时不做分离，保持既有退化行为而不是把节点全推到圆心。
 */
function separateOverlappingDiscs(
  positioned: readonly PositionedNode[],
  options: {
    readonly centerX: number;
    readonly centerY: number;
    readonly maxRadius: number;
    readonly maxRadiusX: number;
    readonly pinnedIds: ReadonlySet<string>;
  },
): readonly PositionedNode[] {
  if (options.maxRadius <= 0 || options.maxRadiusX <= 0) {
    return positioned;
  }
  const separated = separateDiscs(
    positioned.map((entry) => ({
      id: entry.model.id,
      x: entry.x,
      y: entry.y,
      radius: entry.radius,
      collapsed: entry.model.collapsed === true,
      descendantCount: entry.model.descendantCount ?? 0,
      pinned: options.pinnedIds.has(entry.model.id),
    })),
    {
      centerX: options.centerX,
      centerY: options.centerY,
      maxRadius: options.maxRadius,
      maxRadiusX: options.maxRadiusX,
    },
  );
  return positioned.map((entry, index) => {
    const next = separated[index];
    return next ? { model: entry.model, x: next.x, y: next.y, radius: next.radius } : entry;
  });
}
