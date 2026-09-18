import { buildFallbackGeometry } from './knowledge-graph-band-fallback.js';

/**
 * 知识图谱 · 节点半径与环占用预算（纯函数，无 DOM / G6 / React）。
 *
 * 从 `knowledge-graph-layout.ts` 抽出，因为「半径推导」需要被布局层（放置节点）与样式层
 * （绘制节点）**共用**：两侧必须得到同一个半径，否则标签盒会悬在节点之外、相邻节点看起来
 * 比布局预留的更小。放在独立模块可避免 layout ↔ style 的循环依赖。
 *
 * 解决的核心问题：旧实现里「环半径只是深度的函数」，不关心该环上放了多少节点，于是任何
 * 超过约 30 个节点的环都会重叠成一条链（1200 节点全展开、以及展开某个大分类时再次出现）。
 * 这里把**占用**变成一等公民：
 *   1. `planRingBands` 先数每个深度落了多少节点，用实际角度间距反推所需半径；超出容器预算
 *      时把该深度拆成多条同心子环。每条子环把该深度**实际占用的角度区间**重新铺满，
 *      并按父节点分组，使同一父节点的子树留在同一条子环的同一段弧上。
 *   2. `aggregateRadiusFor` 给折叠聚合一个**封顶**的计数半径；环变挤时
 *      `aggregateRadiusForArc` 让半径**只缩不放**地朝地板靠近，把空间让给更多节点。
 *      计数不会丢失：标签始终保留 `· N`，节点内也有计数徽标。
 */

/** 折叠聚合半径的底数与对数增长系数（数量越大越接近上限）。 */
const AGGREGATE_RADIUS_BASE = 22;
const AGGREGATE_RADIUS_LOG_FACTOR = 6;

/**
 * 折叠聚合半径上限。**硬顶**：无论后代多少，盘面都不超过该值——半径随计数无限增长会与
 * 「环越挤越需要小节点」完全相悖。
 */
export const AGGREGATE_RADIUS_MAX = 46;

/**
 * 拥挤时聚合半径收缩的地板。与最大的叶子半径（已入库 artifact 15 / knowledge 16）同量级，
 * 保证收缩后仍能在盘内放下计数徽标、标签仍可读。
 */
export const AGGREGATE_RADIUS_FLOOR = 16;

/**
 * 相邻节点圆盘之间的可读净空，取值为**该环最大节点半径**的比例。
 *
 * 推导：两个半径 r 的圆盘不重叠要求中心距 ≥ 2r；要读作「分离的圆」还需一段暗缝。取净空
 * `0.35 × 2r = 0.70r`，即两盘之间至少留出约 **1/3 直径**的空隙：60 个同尺寸节点的环不会
 * 首尾相触形成毛虫链，同时不会把环撑到容器之外。因此
 * `MIN_ARC_SPACING = 2r + 0.70r = 2r × (1 + 0.35)`，与角度无关。
 */
export const RING_ARC_GAP_RATIO = 0.35;

/** 拥挤收缩的离散步进：1 → 0（共 11 档），越大越优先「少拆环、多缩节点」。 */
const BAND_SHRINK_STEP = 0.1;
/** 单个深度的子环数量硬上限，防止极端输入把环拆成无数细线。 */
const MAX_BANDS_PER_DEPTH = 8;

/**
 * 折叠聚合的**计数半径**（未考虑环拥挤）：以对数缩放随后代数量增长并钳制在上限内，
 * 叶子仍沿用布局层的按类型尺寸。900 节点的组不会变成巨型圆盘。
 */
export function aggregateRadiusFor(descendantCount: number): number {
  if (!Number.isFinite(descendantCount) || descendantCount <= 0) {
    return 0;
  }
  const scaled =
    AGGREGATE_RADIUS_BASE + AGGREGATE_RADIUS_LOG_FACTOR * Math.log10(1 + descendantCount);
  return Math.min(AGGREGATE_RADIUS_MAX, scaled);
}

/**
 * 环上相邻节点所需的弧长（`MIN_ARC_SPACING`）：以最大节点半径为代表足迹，
 * 加上 `RING_ARC_GAP_RATIO` 定义的可读净空。混尺寸的环因此偏保守，但绝不重叠。
 */
export function ringArcSpacing(maxNodeRadius: number): number {
  if (!Number.isFinite(maxNodeRadius) || maxNodeRadius <= 0) {
    return 0;
  }
  return 2 * maxNodeRadius * (1 + RING_ARC_GAP_RATIO);
}

/** 两个半径对应的最小中心距（两盘相切 + 可读净空）。 */
function centerSpacing(leftRadius: number, rightRadius: number): number {
  const left = Number.isFinite(leftRadius) && leftRadius > 0 ? leftRadius : 0;
  const right = Number.isFinite(rightRadius) && rightRadius > 0 ? rightRadius : 0;
  return (left + right) * (1 + RING_ARC_GAP_RATIO);
}

/** 相邻深度环/子环之间的最小径向间距：两环最大半径之和 + 同一可读净空。 */
export function radialClearance(innerMaxRadius: number, outerMaxRadius: number): number {
  return centerSpacing(innerMaxRadius, outerMaxRadius);
}

/**
 * 拥挤环上的聚合半径：**只缩不放**。
 * 该环单节点可用弧长为 `2πR / n`；要让 `n` 个半径为 r 的圆盘（含净空）放下，需
 * `n × 2r(1+gap) ≤ 2πR`，即 `r ≤ πR / (n(1+gap))`。取此上界与计数半径的较小值，
 * 再钳制在 `[FLOOR, 计数半径]`：环越挤半径越小、永远不超过计数半径，计数交给标签/徽标。
 */
export function aggregateRadiusForArc(input: {
  readonly descendantCount: number;
  readonly ringNodeCount: number;
  readonly ringRadius: number;
}): number {
  const nominal = aggregateRadiusFor(input.descendantCount);
  const { ringNodeCount, ringRadius } = input;
  if (!Number.isFinite(ringNodeCount) || ringNodeCount <= 1) {
    return nominal;
  }
  if (!Number.isFinite(ringRadius) || ringRadius <= 0) {
    return nominal;
  }
  const legible = (Math.PI * ringRadius) / (ringNodeCount * (1 + RING_ARC_GAP_RATIO));
  return Math.max(AGGREGATE_RADIUS_FLOOR, Math.min(nominal, legible));
}

/** 参与子环规划的节点（必须已按角度排序，保证相邻元素在排布上相邻）。 */
export interface RingNodeInput {
  readonly id: string;
  /** `contains` 父节点 id；用于把同一父节点的子树聚在同一条子环的同一段弧上。 */
  readonly parentId: string | null;
  /** 未考虑拥挤时的半径（折叠聚合用 `aggregateRadiusFor`，叶子用按类型尺寸）。 */
  readonly radius: number;
  /** 折叠聚合会在拥挤时朝地板收缩；叶子不变。 */
  readonly aggregate: boolean;
  /** 折叠聚合的后代数量（用于把半径契约交回 `aggregateRadiusForArc`）；叶子为 0。 */
  readonly count: number;
  /** 当前角度（弧度）。 */
  readonly angle: number;
  /** 该节点**父扇区**的起始 / 结束角度；子环在拥挤时会把父扇区重新铺满。 */
  readonly parentSpanStart: number;
  readonly parentSpanEnd: number;
}

export interface RingBandEntry {
  readonly id: string;
  readonly angle: number;
}

export interface RingBand {
  readonly radius: number;
  readonly entries: readonly RingBandEntry[];
}

export interface RingBandPlan {
  readonly bands: readonly RingBand[];
  /** 每个节点的最终半径（已含拥挤收缩）。 */
  readonly nodeRadiusById: ReadonlyMap<string, number>;
  /** 每个节点的最终角度（子环会把父扇区重新铺满）。 */
  readonly angleById: ReadonlyMap<string, number>;
  /** 规划后该深度环上的最大节点半径（供更浅层计算径向净空）。 */
  readonly maxRadius: number;
}

export interface PlanRingBandsInput {
  readonly nodes: readonly RingNodeInput[];
  /** 该深度允许的最小半径（避免压到更浅层/圆心）。 */
  readonly innerBound: number;
  /** 该深度允许的最大半径（最深层的 `MAX_RADIUS`，或更深处内子环让出的边界）。 */
  readonly outerLimit: number;
  /** 该深度的设计半径（优先落点；拥挤时才向外长或拆环）。 */
  readonly designRadius: number;
}

export interface BandGeometry {
  readonly bands: readonly RingBand[];
  readonly requiredById: ReadonlyMap<string, number>;
  readonly maxRadius: number;
  /** 该方案对**全部**节点半径的整体收缩比例（兜底路径才小于 1）。 */
  readonly radiusScale: number;
}

function clampBetween(value: number, min: number, max: number): number {
  if (max < min) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}

/** 拥挤收缩后的有效半径：聚合朝地板插值，叶子不变。 */
function effectiveRadius(node: RingNodeInput, scale: number): number {
  if (!node.aggregate || node.radius <= AGGREGATE_RADIUS_FLOOR) {
    return node.radius;
  }
  return AGGREGATE_RADIUS_FLOOR + (node.radius - AGGREGATE_RADIUS_FLOOR) * scale;
}

/**
 * 父节点边界吸附的搜索半径：最多半个理想子环宽度。
 *
 * 旧实现从理想切割点向两侧一直搜到 `count`，一个远离理想位置的父节点边界会把后面所有切割点
 * 挤成「1 个节点一条子环」的退化分配，而单个父节点组又会整组塞进剩下的那一条子环——这正是
 * 「环/子环排布只按角度与半径、从不校验两盘中心距」时 D2 圆盘重叠的温床（60 节点挤在一条
 * 半径为 143 的子环上）。把搜索半径限制在半个理想宽度内，切割点就始终接近均分，子环容量
 * 由 `requiredRadiusForRemappedGroups` 正常校验，不再产生退化分配。
 */
function boundarySearchRadius(count: number, bandCount: number): number {
  const bandSize = count / Math.max(1, bandCount);
  return Math.max(1, Math.floor(bandSize / 2));
}

/**
 * 把按角度排序的节点切成 `bandCount` 段**连续**区间。切割点优先贴合父节点边界，使同一父节点
 * 的子树尽量落在同一条子环上；边界不在理想位置附近时退化为按数量均分（此时只能切开某个父节点
 * 组，属于「单组本身装不下」的必然情形）。结果只取决于输入顺序与 `bandCount`，可复现。
 */
export function partitionContiguousBands(
  nodes: readonly RingNodeInput[],
  bandCount: number,
): readonly (readonly RingNodeInput[])[] {
  const count = nodes.length;
  const searchRadius = boundarySearchRadius(count, bandCount);
  const bands: RingNodeInput[][] = [];
  let start = 0;
  for (let band = 1; band < bandCount; band += 1) {
    const ideal = Math.round((count * band) / bandCount);
    const minCut = start + 1;
    const maxCut = count - (bandCount - band);
    let cut = clampBetween(ideal, minCut, maxCut);
    const isBoundary = (index: number): boolean =>
      index > start && index < count && nodes[index - 1]?.parentId !== nodes[index]?.parentId;
    if (!isBoundary(cut)) {
      for (let offset = 1; offset <= searchRadius; offset += 1) {
        const higher = cut + offset;
        const lower = cut - offset;
        if (higher <= maxCut && isBoundary(higher)) {
          cut = higher;
          break;
        }
        if (lower >= minCut && isBoundary(lower)) {
          cut = lower;
          break;
        }
      }
    }
    bands.push(nodes.slice(start, cut));
    start = cut;
  }
  bands.push(nodes.slice(start));
  return bands.filter((band) => band.length > 0);
}

/** 连续的同父节点分组（用于把父扇区重新铺满）。 */
function groupByParent(nodes: readonly RingNodeInput[]): RingNodeInput[][] {
  const groups: RingNodeInput[][] = [];
  for (const node of nodes) {
    const last = groups[groups.length - 1];
    if (last && last[0]?.parentId === node.parentId) {
      last.push(node);
    } else {
      groups.push([node]);
    }
  }
  return groups;
}

/** 给定角度间距，反推容纳这些节点所需的最小半径（弦长模型）。 */
function radiusForAngularGap(gap: number, spacing: number): number {
  if (gap <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  return spacing / (2 * Math.sin(gap / 2));
}

/** 该深度实际占用的角度总宽度：各父扇区宽度去重求和（同一父扇区只算一次）。 */
function occupiedSpan(nodes: readonly RingNodeInput[]): number {
  const byParent = new Map<string, number>();
  for (const node of nodes) {
    const key = node.parentId ?? node.id;
    const width = node.parentSpanEnd - node.parentSpanStart;
    byParent.set(key, width);
  }
  let total = 0;
  for (const width of byParent.values()) {
    total += width > 0 ? width : 0;
  }
  return total;
}

/**
 * 单环（不拆子环）所需半径：把该深度节点均匀铺在它实际占用的角度区间上，
 * 于是等效公式 `节点数 × MIN_ARC_SPACING / 占用角宽`（满分一圈时即验收要求的
 * `节点数 × MIN_ARC_SPACING / 2π`）。
 */
function requiredRadiusForOccupiedSpan(nodes: readonly RingNodeInput[], spacing: number): number {
  if (nodes.length <= 1) {
    return 0;
  }
  const span = occupiedSpan(nodes);
  if (!Number.isFinite(span) || span <= 0) {
    return 0;
  }
  return (nodes.length * spacing) / span;
}

/**
 * 子环把父扇区重新铺满后的所需半径：每个同父子组内部等距分布，
 * 间距为 `父扇区宽度 / 子组节点数`。
 */
function requiredRadiusForRemappedGroups(
  groups: readonly (readonly RingNodeInput[])[],
  spacing: number,
): number {
  let required = 0;
  for (const group of groups) {
    if (group.length <= 1) {
      continue;
    }
    const first = group[0];
    if (!first) {
      continue;
    }
    const span = first.parentSpanEnd - first.parentSpanStart;
    required = Math.max(required, radiusForAngularGap(span / group.length, spacing));
  }
  return required;
}

/** 子环条目：同一父节点的子组在其父扇区内等距铺满，保持角度相邻性。 */
function remapBandEntries(nodes: readonly RingNodeInput[]): RingBandEntry[] {
  const entries: RingBandEntry[] = [];
  for (const group of groupByParent(nodes)) {
    const first = group[0];
    if (!first) {
      continue;
    }
    const span = first.parentSpanEnd - first.parentSpanStart;
    for (let index = 0; index < group.length; index += 1) {
      const node = group[index];
      if (!node) {
        continue;
      }
      entries.push({
        id: node.id,
        angle: first.parentSpanStart + ((index + 0.5) / group.length) * span,
      });
    }
  }
  return entries;
}

/** 在给定收缩比例下尝试规划子环；装不下返回 null。 */
function buildBandGeometry(input: PlanRingBandsInput, scale: number): BandGeometry | null {
  const { nodes, innerBound, outerLimit, designRadius } = input;
  const radii = nodes.map((node) => effectiveRadius(node, scale));
  const maxRadius = Math.max(...radii);
  const spacing = ringArcSpacing(maxRadius);
  const requiredById = new Map<string, number>();

  const singleRequired = requiredRadiusForOccupiedSpan(nodes, spacing);
  if (singleRequired <= outerLimit) {
    const radius = clampBetween(Math.max(designRadius, singleRequired), innerBound, outerLimit);
    return {
      bands: [
        {
          radius,
          entries: nodes.map((node) => ({ id: node.id, angle: node.angle })),
        },
      ],
      requiredById,
      maxRadius,
      radiusScale: 1,
    };
  }

  for (
    let bandCount = 2;
    bandCount <= Math.min(nodes.length, MAX_BANDS_PER_DEPTH);
    bandCount += 1
  ) {
    const innermost = outerLimit - (bandCount - 1) * spacing;
    if (innermost < innerBound) {
      continue;
    }
    const partition = partitionContiguousBands(nodes, bandCount);
    if (partition.length !== bandCount) {
      continue;
    }
    const bands: RingBand[] = [];
    let fits = true;
    for (let index = 0; index < partition.length; index += 1) {
      const chunk = partition[index];
      if (!chunk) {
        fits = false;
        break;
      }
      const radius = outerLimit - (bandCount - 1 - index) * spacing;
      const required = requiredRadiusForRemappedGroups(groupByParent(chunk), spacing);
      if (required > radius) {
        fits = false;
        break;
      }
      bands.push({ radius, entries: remapBandEntries(chunk) });
    }
    if (fits) {
      return { bands, requiredById, maxRadius, radiusScale: 1 };
    }
  }
  return null;
}

function finalizePlan(
  geometry: BandGeometry,
  input: PlanRingBandsInput,
  scale: number,
): RingBandPlan {
  const nodeRadiusById = new Map<string, number>();
  const angleById = new Map<string, number>();
  const nodeById = new Map(input.nodes.map((node) => [node.id, node] as const));
  for (const band of geometry.bands) {
    for (const entry of band.entries) {
      const node = nodeById.get(entry.id);
      if (!node) {
        continue;
      }
      angleById.set(entry.id, entry.angle);
      const effectiveNominal = effectiveRadius(node, scale);
      const drawn = node.aggregate
        ? aggregateRadiusForArc({
            descendantCount: node.count,
            ringNodeCount: band.entries.length,
            ringRadius: band.radius,
          })
        : node.radius;
      nodeRadiusById.set(entry.id, Math.min(effectiveNominal, drawn) * geometry.radiusScale);
    }
  }
  return { bands: geometry.bands, nodeRadiusById, angleById, maxRadius: geometry.maxRadius };
}

/**
 * 规划单个深度的所有环带。优先「少拆环 + 少缩节点」：
 * 从 `scale = 1`（不缩）起逐档收缩，取第一个能放下的方案；每档内再从 1 条子环开始尝试，
 * 直到径向空间或单环容量满足。找不到则退回兜底布局。全程确定性。
 */
export function planRingBands(input: PlanRingBandsInput): RingBandPlan {
  const { nodes } = input;
  if (nodes.length === 0) {
    return {
      bands: [],
      nodeRadiusById: new Map(),
      angleById: new Map(),
      maxRadius: 0,
    };
  }
  for (let step = 0; step <= Math.round(1 / BAND_SHRINK_STEP); step += 1) {
    const scale = 1 - step * BAND_SHRINK_STEP;
    const geometry = buildBandGeometry(input, scale);
    if (geometry) {
      return finalizePlan(geometry, input, scale);
    }
  }
  return finalizePlan(buildFallbackGeometry(input), input, 0);
}
