/**
 * 知识图谱 · 极端拥挤时的**兜底环带规划**（纯函数，无 DOM / G6 / React）。
 *
 * 从 `knowledge-graph-radius.ts` 抽出：主规划器在径向预算被挤爆时会退回这里。兜底布局必须做到
 * 「节点永不丢失、盘间中心距不小于两半径之和」，否则就是 D2 的圆盘重叠。策略见
 * `buildFallbackGeometry` 的文档。
 */

import type {
  BandGeometry,
  PlanRingBandsInput,
  RingBandEntry,
  RingNodeInput,
} from './knowledge-graph-radius.js';
import { RING_ARC_GAP_RATIO as ARC_GAP_RATIO } from './knowledge-graph-radius.js';

/** 与 `ringArcSpacing` 同一契约的本地副本，避免与 `knowledge-graph-radius.ts` 形成取值循环。 */
function arcSpacing(maxNodeRadius: number): number {
  if (!Number.isFinite(maxNodeRadius) || maxNodeRadius <= 0) {
    return 0;
  }
  return 2 * maxNodeRadius * (1 + ARC_GAP_RATIO);
}

function clampBetween(value: number, min: number, max: number): number {
  if (max < min) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}

/** 兜底布局的半径收缩档：从 1 起逐档收缩，地板见 `FALLBACK_RADIUS_SCALE_MIN`。 */
const FALLBACK_RADIUS_SCALE_MIN = 0.2;
const FALLBACK_RADIUS_SCALE_STEP = 0.94;
/** 半径收缩的最大档数（配合地板构成有界循环）。 */
const FALLBACK_MAX_SCALE_STEPS = 24;
/** 兜底布局允许的子环条数上限（有界，避免极端输入把环拆成无数细线）。 */
export const MAX_FALLBACK_BANDS = 24;

/** 角度顺序下的连续同父分组（含父扇区与节点序列）。 */
interface AngleGroup {
  readonly parentId: string | null;
  readonly spanStart: number;
  readonly spanEnd: number;
  readonly nodes: RingNodeInput[];
}

function angleOrderedGroups(nodes: readonly RingNodeInput[]): AngleGroup[] {
  const groups: AngleGroup[] = [];
  for (const node of nodes) {
    const last = groups[groups.length - 1];
    if (last && last.parentId === node.parentId) {
      last.nodes.push(node);
    } else {
      groups.push({
        parentId: node.parentId,
        spanStart: node.parentSpanStart,
        spanEnd: node.parentSpanEnd,
        nodes: [node],
      });
    }
  }
  return groups;
}

/** 单条子环对某个父扇区的容量：弧长 ÷ 弧间距，向下取整。 */
function bandCapacityForGroup(radius: number, spacing: number, span: number): number {
  if (!Number.isFinite(radius) || radius <= 0 || spacing <= 0 || span <= 0) {
    return 0;
  }
  return Math.floor((radius * span) / spacing);
}

/**
 * 把某个父分组的节点分配到各条子环：按**容量比例**（容量 ∝ 子环半径）分配，余量按小数部分
 * 确定性顺延给仍有容量的子环。`overflow` 报告**超出总容量**的节点数——调用方据此决定继续
 * 收缩半径，还是（已在半径地板）牺牲局部间距把余量塞进最外环。
 * 早期实现直接把余量追加到最外环，导致收缩循环误判「已经装得下」，仍是重叠的元凶。
 */
function distributeGroupAcrossBands(input: {
  readonly count: number;
  readonly capacities: readonly number[];
}): { readonly counts: readonly number[]; readonly overflow: number } {
  const { count, capacities } = input;
  const allocation = capacities.map((capacity) => Math.floor(Math.max(0, capacity)));
  if (count <= 0) {
    return { counts: capacities.map(() => 0), overflow: 0 };
  }
  const totalCapacity = allocation.reduce((sum, value) => sum + value, 0);
  if (totalCapacity === 0) {
    return {
      counts: capacities.map(() => 0),
      overflow: count,
    };
  }
  const shares = allocation.map((capacity) => (count * capacity) / totalCapacity);
  const counts = allocation.map((capacity, index) =>
    Math.min(Math.floor(shares[index] ?? 0), capacity),
  );
  let assigned = counts.reduce((sum, value) => sum + value, 0);
  const order = shares
    .map((share, index) => ({ index, remainder: share - Math.floor(share) }))
    .sort((left, right) => right.remainder - left.remainder || left.index - right.index);
  let cursor = 0;
  while (assigned < count && cursor < order.length * 2) {
    const entry = order[cursor % order.length];
    cursor += 1;
    if (!entry) {
      continue;
    }
    const capacity = allocation[entry.index] ?? 0;
    if ((counts[entry.index] ?? 0) < capacity) {
      counts[entry.index] = (counts[entry.index] ?? 0) + 1;
      assigned += 1;
    }
  }
  return { counts, overflow: count - assigned };
}

/** 把某条子环的分组分配结果铺成条目：每个分组在自己的父扇区内等距排布，组间顺序不变。 */
function buildBandEntries(
  groups: readonly AngleGroup[],
  allocationByGroup: readonly (readonly number[])[],
  bandIndex: number,
  cursors: number[],
): RingBandEntry[] {
  const entries: RingBandEntry[] = [];
  for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    const group = groups[groupIndex];
    const take = allocationByGroup[groupIndex]?.[bandIndex] ?? 0;
    if (!group || take <= 0) {
      continue;
    }
    const start = cursors[groupIndex] ?? 0;
    const span = group.spanEnd - group.spanStart;
    for (let offset = 0; offset < take; offset += 1) {
      const node = group.nodes[start + offset];
      if (!node) {
        continue;
      }
      entries.push({
        id: node.id,
        angle: group.spanStart + ((offset + 0.5) / take) * span,
      });
    }
    cursors[groupIndex] = start + take;
  }
  return entries;
}

/**
 * 全局模式：把**整层**按角度排序的节点连续切片铺到各条子环上，每条子环铺满整圈。
 * 用于父扇区与节点数严重失衡的层（如四个等宽扇区里有一个装了上千节点而其余只有几十个）：
 * 此时「每组守着自己的扇区」物理上放不下，而整圈容量足够。切片的组内顺序不变，
 * 因此同一父分组的节点仍然连续成段。
 */
function buildGlobalBandEntries(
  nodes: readonly RingNodeInput[],
  counts: readonly number[],
  bandIndex: number,
  cursorRef: { value: number },
): RingBandEntry[] {
  const take = counts[bandIndex] ?? 0;
  const start = cursorRef.value;
  const entries: RingBandEntry[] = [];
  for (let offset = 0; offset < take; offset += 1) {
    const node = nodes[start + offset];
    if (!node) {
      continue;
    }
    entries.push({ id: node.id, angle: ((offset + 0.5) / take) * Math.PI * 2 });
  }
  cursorRef.value = start + take;
  return entries;
}

/** 扇区模式：每条子环按分组分配结果铺开（保持每组留在自己的父扇区内）。 */
function buildWedgeEntries(
  groups: readonly AngleGroup[],
  allocations: readonly { readonly counts: readonly number[] }[],
  bandCount: number,
): RingBandEntry[][] {
  const cursors = groups.map(() => 0);
  return Array.from({ length: bandCount }, (_, bandIndex) =>
    buildBandEntries(
      groups,
      allocations.map((allocation) => allocation.counts),
      bandIndex,
      cursors,
    ),
  );
}

/** 全局模式：每条子环拿一段连续切片，铺满整圈。 */
function buildGlobalEntries(
  nodes: readonly RingNodeInput[],
  counts: readonly number[],
  bandCount: number,
): RingBandEntry[][] {
  const cursorRef = { value: 0 };
  return Array.from({ length: bandCount }, (_, bandIndex) =>
    buildGlobalBandEntries(nodes, counts, bandIndex, cursorRef),
  );
}

/**
 * 容量总和不足（画布物理上放不下这么多盘）时的最后手段：把没被任何子环接纳的节点铺到**最外环**，
 * 角度沿整圈均分。节点因此永不丢失，也不会落回圆心（旧实现的余量节点拿不到环半径，会堆在
 * 工作区根节点上，正是「根盘与内容盘相交」的直接来源）；它们与邻居的间距交给分离器兜底。
 */
function placeOverflowNodes(nodes: readonly RingNodeInput[], entryGroups: RingBandEntry[][]): void {
  const outermost = entryGroups[entryGroups.length - 1];
  if (!outermost || entryGroups.length === 0) {
    return;
  }
  const placed = new Set<string>();
  for (const entries of entryGroups) {
    for (const entry of entries) {
      placed.add(entry.id);
    }
  }
  const leftovers = nodes.filter((node) => !placed.has(node.id));
  const total = leftovers.length;
  for (let index = 0; index < total; index += 1) {
    const node = leftovers[index];
    if (!node) {
      continue;
    }
    outermost.push({ id: node.id, angle: ((index + 0.5) / total) * Math.PI * 2 });
  }
}

/**
 * 极端拥挤（即使收缩到聚合地板也放不下）时的兜底布局：**容量感知**地把每个父分组的节点铺到
 * 由外向内的多条同心子环上。
 *
 * 旧实现把「按角度切出来的连续片段」整段塞进一条子环、且不问该子环能不能容纳，于是单条子环上
 * 相邻两盘的中心距可以远小于两半径之和（D2 的两块大圆盘相交、金弧上圆盘串成一串）。这里改为：
 *   1. 子环数由径向空间决定（最多 `MAX_FALLBACK_BANDS` 条），半径自 `outerLimit` 每 `spacing` 一条；
 *   2. 每个父分组的节点按各子环**容量比例**分配，容量 = 父扇区弧长 ÷ 弧间距（因此每条子环上
 *      同一分组的相邻盘间距天然 ≥ 弧间距）；
 *   3. 容量总和不足时整体收缩全部半径（档位有界、确定性），直到放下为止；
 *   4. 收缩后仍放不下（画布物理上容不下这么多盘）才把余量追加到最外环，交由分离器兜底。
 */
export function buildFallbackGeometry(input: PlanRingBandsInput): BandGeometry {
  const { nodes, innerBound, outerLimit } = input;
  const groups = angleOrderedGroups(nodes);
  let scale = 1;
  for (let step = 0; step < FALLBACK_MAX_SCALE_STEPS; step += 1) {
    const scaledMax = Math.max(...nodes.map((node) => node.radius * scale), 0);
    const spacing = Math.max(1e-6, arcSpacing(scaledMax));
    const bandCount = clampBetween(
      Math.floor((outerLimit - innerBound) / spacing) + 1,
      1,
      Math.min(MAX_FALLBACK_BANDS, Math.max(1, nodes.length)),
    );
    const bandRadii = Array.from(
      { length: bandCount },
      (_, index) => outerLimit - (bandCount - 1 - index) * spacing,
    );
    const allocations = groups.map((group) =>
      distributeGroupAcrossBands({
        count: group.nodes.length,
        capacities: bandRadii.map((radius) =>
          bandCapacityForGroup(radius, spacing, group.spanEnd - group.spanStart),
        ),
      }),
    );
    const wedgeOverflow = allocations.reduce((sum, allocation) => sum + allocation.overflow, 0);
    // 扇区守不住时改用整圈容量：把整层节点连续切片铺到各环，容量按整圈计算。
    const globalCapacities = bandRadii.map((radius) =>
      bandCapacityForGroup(radius, spacing, Math.PI * 2),
    );
    const globalAllocation = distributeGroupAcrossBands({
      count: nodes.length,
      capacities: globalCapacities,
    });
    const useGlobal = wedgeOverflow > 0 && globalAllocation.overflow === 0;
    const overflow = useGlobal ? 0 : wedgeOverflow;
    if (overflow === 0 || scale <= FALLBACK_RADIUS_SCALE_MIN) {
      const entryGroups = useGlobal
        ? buildGlobalEntries(nodes, globalAllocation.counts, bandRadii.length)
        : buildWedgeEntries(groups, allocations, bandRadii.length);
      placeOverflowNodes(nodes, entryGroups);
      const bands = bandRadii.map((radius, bandIndex) => ({
        radius,
        entries: entryGroups[bandIndex] ?? [],
      }));
      return { bands, requiredById: new Map(), maxRadius: scaledMax, radiusScale: scale };
    }
    scale = Math.max(FALLBACK_RADIUS_SCALE_MIN, scale * FALLBACK_RADIUS_SCALE_STEP);
  }
  return {
    bands: [
      {
        radius: clampBetween(outerLimit, innerBound, Math.max(innerBound, outerLimit)),
        entries: nodes.map((node) => ({ id: node.id, angle: node.angle })),
      },
    ],
    requiredById: new Map(),
    maxRadius: Math.max(...nodes.map((node) => node.radius), 0),
    radiusScale: FALLBACK_RADIUS_SCALE_MIN,
  };
}
