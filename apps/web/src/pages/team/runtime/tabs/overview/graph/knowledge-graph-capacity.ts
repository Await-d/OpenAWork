/**
 * 知识图谱 · 环带容量（纯函数，无 DOM / G6 / React）。
 *
 * 外环半径被契约钉死在 `min(width, height) / 2 - margin`（`knowledge-graph-layout.ts`），
 * 因此每个深度带的容量由**容器尺寸**决定、不随节点数增长：深度超出带宽后，布局只能靠兜底
 * 收缩 / 分离器压制残余重叠，盘间必然相交。修复因此落在**展开策略**上——展开前先问本模块
 * 「这个可见集在当前视口下装得下吗」，装不下就拒绝展开，而不是让画布去渲染一个注定重叠的状态。
 *
 * 间距口径**全部复用布局的真实规则**（`ringArcSpacing` / `radialClearance`，
 * 以及 `graphMaxRadiusForViewport` 的半径预算），并镜像 `planRings` 的逐深度链式下界与子环
 * 拆分上限，因此容量声明与布局实际能放下的数量不会各说各话。
 */

import type { KnowledgeGraph } from '../../../data/build-knowledge-graph.js';
import {
  DEFAULT_MAX_VISIBLE_NODES,
  projectVisibleGraph,
  toggleExpandedId,
} from './knowledge-graph-aggregation.js';
import { MAX_FALLBACK_BANDS } from './knowledge-graph-band-fallback.js';
import {
  graphMaxRadiusForViewport,
  isShallowOverview,
  nodeRadiusForModel,
  resolveRootRadius,
  type GraphViewportSize,
} from './knowledge-graph-layout.js';
import { buildGraphModel, type GraphModel } from './knowledge-graph-model.js';
import { radialClearance, ringArcSpacing } from './knowledge-graph-radius.js';
import {
  buildContainsChildrenMap,
  computeContainsDepths,
  collectContainsAncestors,
} from './knowledge-graph-structure.js';

/** 参与容量推导的候选节点：深度 + 布局层的**最终**半径（已含折叠计数 / 徽标托底）。 */
export interface CapacityCandidate {
  readonly id: string;
  readonly depth: number;
  readonly radius: number;
}

export interface GraphBandCapacity {
  /** 与布局同源的径向预算（`min(width, height) / 2 - margin`）。 */
  readonly maxRadius: number;
  /** 每个深度带在不重叠前提下能容纳的最大节点数。 */
  readonly maxByDepth: ReadonlyMap<number, number>;
  /** 全深度合计容量。 */
  readonly maxNodes: number;
}

export interface BandCapacityInput {
  readonly viewport: GraphViewportSize;
  readonly candidates: readonly CapacityCandidate[];
  readonly rootRadius: number;
  readonly maxDepth: number;
  readonly shallowOverview: boolean;
}

/** 子环容量：把一条子环铺满整圈时能放下的盘数。 */
function bandCapacity(radius: number, spacing: number): number {
  if (!Number.isFinite(radius) || radius <= 0 || !Number.isFinite(spacing) || spacing <= 0) {
    return 0;
  }
  return Math.floor((Math.PI * 2 * radius) / spacing);
}

/**
 * 单个深度带的容量：在 `[innerBound, outerLimit]` 内按 `spacing` 由外向内排子环，
 * 每条子环铺满整圈，容量即 `Σ floor(2πR / spacing)`。`spacing = ringArcSpacing(该带最大半径)`
 * 与布局同源；整圈口径是布局兜底「全局模式」的上界，因此容量不会高估布局的能力。
 */
function capacityForWindow(
  innerBound: number,
  outerLimit: number,
  spacing: number,
): { readonly capacity: number; readonly innermost: number } {
  if (!Number.isFinite(outerLimit) || !Number.isFinite(innerBound) || outerLimit <= 0) {
    return { capacity: 0, innermost: outerLimit };
  }
  const count = Math.max(1, Math.floor((outerLimit - innerBound) / spacing) + 1);
  const bandCount = Math.min(MAX_FALLBACK_BANDS, count);
  let total = 0;
  let innermost = outerLimit;
  for (let index = 0; index < bandCount; index += 1) {
    const radius = outerLimit - index * spacing;
    if (radius <= 0) {
      break;
    }
    innermost = radius;
    total += bandCapacity(radius, spacing);
  }
  return { capacity: total, innermost };
}

/** 每个深度的最大最终半径；深度 < 1（圆心）不参与环带。 */
function maxRadiusByDepth(
  candidates: readonly CapacityCandidate[],
  maxDepth: number,
): Map<number, number> {
  const result = new Map<number, number>();
  for (const candidate of candidates) {
    if (candidate.depth < 1) {
      continue;
    }
    const depth = Math.min(candidate.depth, maxDepth);
    result.set(depth, Math.max(result.get(depth) ?? 0, candidate.radius));
  }
  return result;
}

/**
 * 逐深度容量。镜像 `planRings`：先按各深度最大半径推出链式径向下界，再从最深（最外）层向内
 * 分配窗口，每层的窗口厚度由该层子环拆分与更浅层的净空共同约束。
 */
export function graphBandCapacity(input: BandCapacityInput): GraphBandCapacity {
  const { viewport, candidates, rootRadius, maxDepth, shallowOverview } = input;
  const maxRadius = graphMaxRadiusForViewport(viewport, { shallowOverview });
  const empty: GraphBandCapacity = { maxRadius, maxByDepth: new Map(), maxNodes: 0 };
  if (maxRadius <= 0 || maxDepth < 1) {
    return empty;
  }

  const radiusByDepth = maxRadiusByDepth(candidates, maxDepth);
  const innerBoundByDepth = new Map<number, number>();
  let reservedInner = 0;
  for (let depth = 1; depth <= maxDepth; depth += 1) {
    const currentMax = radiusByDepth.get(depth) ?? 0;
    if (depth === 1) {
      reservedInner = radialClearance(rootRadius, currentMax);
    } else {
      reservedInner += radialClearance(radiusByDepth.get(depth - 1) ?? 0, currentMax);
    }
    innerBoundByDepth.set(depth, reservedInner);
  }

  const maxByDepth = new Map<number, number>();
  let deeperInnerRadius: number | null = null;
  let deeperMaxRadius = 0;
  for (let depth = maxDepth; depth >= 1; depth -= 1) {
    const currentMax = radiusByDepth.get(depth);
    if (currentMax === undefined || currentMax <= 0) {
      continue;
    }
    const innerBound = Math.min(
      maxRadius,
      Math.max(radialClearance(rootRadius, currentMax), innerBoundByDepth.get(depth) ?? 0),
    );
    const outerLimit =
      deeperInnerRadius === null
        ? maxRadius
        : Math.min(maxRadius, deeperInnerRadius - radialClearance(currentMax, deeperMaxRadius));
    const spacing = ringArcSpacing(currentMax);
    const window = capacityForWindow(innerBound, outerLimit, spacing);
    maxByDepth.set(depth, window.capacity);
    if (window.capacity > 0) {
      deeperInnerRadius = window.innermost;
      deeperMaxRadius = currentMax;
    }
  }

  let maxNodes = 0;
  for (const capacity of maxByDepth.values()) {
    maxNodes += capacity;
  }
  return { maxRadius, maxByDepth, maxNodes };
}

export interface CapacityOffense {
  readonly depth: number;
  readonly count: number;
  readonly capacity: number;
}

export interface ExpansionCapacityVerdict {
  /** 视口未测量 / 极小（`maxRadius ≤ 0`）时为 false：此时不做容量判断，沿用既有渲染。 */
  readonly checked: boolean;
  readonly legal: boolean;
  readonly totalCount: number;
  readonly maxNodes: number;
  readonly offense: CapacityOffense | null;
}

const UNCHECKED_LEGAL: ExpansionCapacityVerdict = {
  checked: false,
  legal: true,
  totalCount: 0,
  maxNodes: 0,
  offense: null,
};

/** 对一份已构建的模型做逐深度容量校验（布局与容量共用同一份深度 / 半径 / 视口口径）。 */
export function capacityVerdictForModel(
  model: GraphModel,
  viewport: GraphViewportSize | null,
): ExpansionCapacityVerdict {
  if (!viewport || viewport.width <= 0 || viewport.height <= 0 || model.nodes.length === 0) {
    return UNCHECKED_LEGAL;
  }
  const maxDepth = Math.max(1, model.maxDepth);
  const shallowOverview = isShallowOverview(model.rootId !== null, model.maxDepth);
  if (graphMaxRadiusForViewport(viewport, { shallowOverview }) <= 0) {
    return UNCHECKED_LEGAL;
  }
  const candidates: CapacityCandidate[] = [];
  const countByDepth = new Map<number, number>();
  for (const node of model.nodes) {
    const radius = nodeRadiusForModel(node);
    const depth = Math.min(Math.max(node.depth, 1), maxDepth);
    candidates.push({ id: node.id, depth, radius });
    countByDepth.set(depth, (countByDepth.get(depth) ?? 0) + 1);
  }
  const capacity = graphBandCapacity({
    viewport,
    candidates,
    rootRadius: resolveRootRadius(model),
    maxDepth,
    shallowOverview,
  });

  let offense: CapacityOffense | null = null;
  for (const [depth, count] of countByDepth) {
    const bound = capacity.maxByDepth.get(depth) ?? 0;
    if (count > bound && (offense === null || depth < offense.depth)) {
      offense = { depth, count, capacity: bound };
    }
  }

  return {
    checked: true,
    legal: offense === null,
    totalCount: model.nodes.length,
    maxNodes: capacity.maxNodes,
    offense,
  };
}

export interface ExpansionCapacityInput {
  readonly graph: KnowledgeGraph;
  readonly expandedIds: ReadonlySet<string>;
  readonly counts: ReadonlyMap<string, number>;
  readonly viewport: GraphViewportSize | null;
  readonly forceVisibleIds?: ReadonlySet<string>;
  readonly expandAll?: boolean;
  readonly maxNodes?: number;
}

/** 展开动作的容量校验入口：先投影出该动作的可见集，再逐深度比对容量。 */
export function evaluateExpansionCapacity(input: ExpansionCapacityInput): ExpansionCapacityVerdict {
  const projection = projectVisibleGraph(input.graph, input.expandedIds, {
    counts: input.counts,
    expandAll: input.expandAll,
    forceVisibleIds: input.forceVisibleIds,
    maxNodes: input.maxNodes ?? DEFAULT_MAX_VISIBLE_NODES,
  });
  const model = buildGraphModel(projection.graph, {
    collapsedIds: projection.collapsedIds,
    counts: input.counts,
  });
  return capacityVerdictForModel(model, input.viewport);
}

export interface FitExpansionInput extends ExpansionCapacityInput {
  readonly viewport: GraphViewportSize | null;
}

/**
 * 单个节点「此刻展开是否会被容量拒绝」的纯谓词。展开语义与 `useKnowledgeGraphExpansion.toggleExpand`
 * 完全一致（同一个 `toggleExpandedId` + 同一个 `evaluateExpansionCapacity`），因此控件禁用态与真正的
 * 拒绝结果不可能分叉；视口 / 展开集变化时重新求值即自动从禁用恢复。
 */
export function nodeExpansionBlocked(
  input: ExpansionCapacityInput & { readonly nodeId: string },
): boolean {
  const { nodeId, ...rest } = input;
  const expandedIds = toggleExpandedId(rest.expandedIds, nodeId);
  const expanding = expandedIds.has(nodeId) && !rest.expandedIds.has(nodeId);
  if (!expanding) {
    return false;
  }
  const verdict = evaluateExpansionCapacity({ ...rest, expandedIds });
  return verdict.checked && !verdict.legal;
}

/**
 * 把展开集收缩到容量以内：从**用户展开的最深层**开始逐层收起非强制节点，直到合法或无可再收。
 * 搜索命中的节点与其祖先链由 `forceVisibleIds` 保护，永不因容量而隐藏（搜索必须仍能定位）。
 * 返回收缩后的集合；已合法 / 未测量时返回 `null` 表示无需改动。
 */
export function fitExpansionToCapacity(input: FitExpansionInput): ReadonlySet<string> | null {
  const verdict = evaluateExpansionCapacity(input);
  if (!verdict.checked || verdict.legal) {
    return null;
  }
  const forced = new Set(input.forceVisibleIds ?? []);
  for (const ancestor of collectContainsAncestors(input.graph, forced)) {
    forced.add(ancestor);
  }
  const depths = computeContainsDepths(input.graph);
  const children = buildContainsChildrenMap(input.graph);
  const next = new Set(input.expandedIds);
  const ordered = [...next]
    .filter((id) => !forced.has(id) && (children.get(id)?.length ?? 0) > 0)
    .sort((left, right) => (depths.get(right) ?? 0) - (depths.get(left) ?? 0));

  let cursor = 0;
  while (cursor < ordered.length) {
    const current = evaluateExpansionCapacity({ ...input, expandedIds: next });
    if (!current.checked || current.legal) {
      break;
    }
    const level = depths.get(ordered[cursor] ?? '') ?? 0;
    while (cursor < ordered.length && (depths.get(ordered[cursor] ?? '') ?? 0) === level) {
      const id = ordered[cursor];
      if (id !== undefined) {
        next.delete(id);
      }
      cursor += 1;
    }
  }
  return setsEqual(next, input.expandedIds) ? null : next;
}

function setsEqual(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) {
    return false;
  }
  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }
  return true;
}
