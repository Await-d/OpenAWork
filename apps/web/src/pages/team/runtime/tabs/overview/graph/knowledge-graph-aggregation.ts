/**
 * 知识图谱 · 聚合 / 折叠投影（纯函数，无 DOM / G6 / React）。
 *
 * 生产图谱常达 1000+ 节点，把每个节点都铺在同心环上必然不可读（外环周长 < 5px/节点）。
 * 因此渲染层永远只画**有界**的可见子集：
 *   - 一个节点 VISIBLE ⟺ 它的每个 `contains` 祖先都处于已展开状态；
 *   - 子树非空但未展开的可见节点是**折叠态**：它自己保留，后代被丢弃；
 *   - `contains` / `derives` 边只在两端都存活时保留；
 *   - 无 `contains` 父节点的节点（根 / 孤点）永远可见，绝不静默丢节点。
 *
 * 另外提供：子树计数、搜索祖先自动展开、默认展开策略、以及「按渲染上限强制收起更深层」。
 * 全部确定性、可单测；`computeDescendantCounts` 与 `autoExpansionForSearch` 昂贵，
 * 调用方应缓存到「数据变化」粒度，而不是每次渲染重算。
 */

import type { KnowledgeGraph } from '../../../data/build-knowledge-graph.js';
import { collectGraphSearchMatches } from './knowledge-graph-search.js';
import {
  buildContainsChildrenMap,
  buildContainsParentMap,
  collectContainsAncestors,
  computeContainsDepths,
  computeSubtreeCounts,
} from './knowledge-graph-structure.js';

/** 投影结果：可见子图 + 折叠节点集合 + 每个节点的隐藏后代计数。 */
export interface GraphProjection {
  readonly graph: KnowledgeGraph;
  readonly collapsedIds: ReadonlySet<string>;
  /** 投影前计算的整图子树计数（原样回传，供调用方复用）。 */
  readonly counts: ReadonlyMap<string, number>;
  /**
   * 每个可见节点**当前被隐藏**的后代数量（整图子树计数 − 可见子树计数）。
   * 折叠节点的隐藏计数就是它的整棵子树；已展开但仍有折叠后代的节点（含工作区根）也会 > 0，
   * 正是「必须始终显示计数」的那一类节点——旧实现只给折叠节点计数，于是根节点与部分展开的
   * 分类没有任何计数可显示。
   */
  readonly hiddenCounts: ReadonlyMap<string, number>;
}

export interface ProjectVisibleGraphOptions {
  /**
   * 渲染上限。可见节点超限时，从**用户已展开的最深层**开始逐层强制收起，
   * 直到落回上限；若连顶层都超限，则按顶层结果照常渲染（不再拒绝渲染）。
   */
  readonly maxNodes?: number;
  /** 必须可见的节点（例如搜索命中）：自动展开其全部祖先，且不受投影隐藏。 */
  readonly forceVisibleIds?: ReadonlySet<string>;
  /** 已裁剪的有界子图（局部深度模式）整体视为已展开。 */
  readonly expandAll?: boolean;
  /** 预计算的子树计数；传入时跳过重复计算。 */
  readonly counts?: ReadonlyMap<string, number>;
}

export interface ResolveDefaultExpansionOptions {
  readonly smallGraphThreshold?: number;
}

/** 整图节点数不超过该阈值时默认全展开（小工作区观感与聚合前一致）。 */
export const DEFAULT_SMALL_GRAPH_THRESHOLD = 60;
/** 可见节点渲染上限：聚合后投影节点数恒有界，超过时强制收起更深层而非拒绝渲染。 */
export const DEFAULT_MAX_VISIBLE_NODES = 1200;

/**
 * 「展开全部」仍可用的最大整图节点数。
 *
 * 超过该规模时把全部分组一次性展开，会把节点压进 4 条环带、彼此重叠并遮住聚合标签，
 * 结果比折叠概览更难读（cap-expand-all 的可见症状）。此时禁用「展开全部」，
 * 改由点击分组逐层钻取（drill-down）。300 是「一次全展开仍可辨认」的经验上限，
 * 明显低于强制收起渲染上限 1200；两者职责不同：前者管可读性，后者管渲染安全。
 */
export const EXPAND_ALL_MAX_NODES = 300;

/** 当前图谱是否仍可安全使用「展开全部」（规模感知）。 */
export function isExpandAllAvailable(graph: KnowledgeGraph): boolean {
  return graph.nodes.length <= EXPAND_ALL_MAX_NODES;
}

const EMPTY_ID_SET: ReadonlySet<string> = new Set();

/** 每个节点的 `contains` 子树规模（不含自身）。 */
export function computeDescendantCounts(graph: KnowledgeGraph): Map<string, number> {
  return computeSubtreeCounts(graph);
}

/** 只有子树的节点（展开/收起会对可见性产生影响）。 */
function expandableIds(
  graph: KnowledgeGraph,
  children: ReadonlyMap<string, readonly string[]>,
): Set<string> {
  const ids = new Set<string>();
  for (const node of graph.nodes) {
    if ((children.get(node.id)?.length ?? 0) > 0) {
      ids.add(node.id);
    }
  }
  return ids;
}

/** 可见性：无父节点可见；有父节点则父节点展开且父节点自身可见。 */
function computeVisibleIds(
  graph: KnowledgeGraph,
  parent: ReadonlyMap<string, string>,
  expanded: ReadonlySet<string>,
  forceVisible: ReadonlySet<string>,
): Set<string> {
  const cache = new Map<string, boolean>();
  const visiting = new Set<string>();
  const isVisible = (id: string): boolean => {
    if (forceVisible.has(id)) {
      return true;
    }
    const cached = cache.get(id);
    if (cached !== undefined) {
      return cached;
    }
    const parentId = parent.get(id);
    if (parentId === undefined) {
      cache.set(id, true);
      return true;
    }
    if (visiting.has(id)) {
      cache.set(id, false);
      return false;
    }
    visiting.add(id);
    const result = expanded.has(parentId) && isVisible(parentId);
    visiting.delete(id);
    cache.set(id, result);
    return result;
  };

  const visible = new Set<string>();
  for (const node of graph.nodes) {
    if (isVisible(node.id)) {
      visible.add(node.id);
    }
  }
  return visible;
}

/** 从用户已展开的最深层开始逐层收起，直到可见节点数回到 `maxNodes` 以内。 */
function reduceExpansionToFit(
  graph: KnowledgeGraph,
  parent: ReadonlyMap<string, string>,
  children: ReadonlyMap<string, readonly string[]>,
  counts: ReadonlyMap<string, number>,
  expanded: Set<string>,
  forceVisible: ReadonlySet<string>,
  maxNodes: number,
): void {
  const depths = computeContainsDepths(graph);
  // 永不收起深度 0 的根展开：根保持展开才能露出「顶层聚合」（工作区 + 分类）。
  const ordered = [...expanded]
    .filter((id) => (children.get(id)?.length ?? 0) > 0 && (depths.get(id) ?? 0) >= 1)
    .sort((left, right) => {
      const depthDiff = (depths.get(right) ?? 0) - (depths.get(left) ?? 0);
      if (depthDiff !== 0) {
        return depthDiff;
      }
      return (counts.get(left) ?? 0) - (counts.get(right) ?? 0);
    });

  let cursor = 0;
  while (cursor < ordered.length) {
    if (computeVisibleIds(graph, parent, expanded, forceVisible).size <= maxNodes) {
      return;
    }
    const level = depths.get(ordered[cursor] ?? '') ?? 0;
    while (cursor < ordered.length && (depths.get(ordered[cursor] ?? '') ?? 0) === level) {
      const id = ordered[cursor];
      if (id !== undefined) {
        expanded.delete(id);
      }
      cursor += 1;
    }
  }
}

/**
 * 投影出可见子图。`expandedIds` 为已展开节点集合；`expandAll` 时忽略它并把整个子图视为展开。
 */
export function projectVisibleGraph(
  graph: KnowledgeGraph,
  expandedIds: ReadonlySet<string>,
  options: ProjectVisibleGraphOptions = {},
): GraphProjection {
  const parent = buildContainsParentMap(graph);
  const children = buildContainsChildrenMap(graph);
  const counts = options.counts ?? computeSubtreeCounts(graph);
  const forceVisible = options.forceVisibleIds ?? EMPTY_ID_SET;

  const expanded = new Set<string>(
    options.expandAll ? expandableIds(graph, children) : expandedIds,
  );
  for (const id of forceVisible) {
    expanded.add(id);
  }
  for (const ancestor of collectContainsAncestors(graph, forceVisible)) {
    expanded.add(ancestor);
  }

  if (options.maxNodes !== undefined) {
    reduceExpansionToFit(graph, parent, children, counts, expanded, forceVisible, options.maxNodes);
  }

  const visibleIds = computeVisibleIds(graph, parent, expanded, forceVisible);
  const nodes = graph.nodes.filter((node) => visibleIds.has(node.id));
  const edges = graph.edges.filter((edge) => visibleIds.has(edge.from) && visibleIds.has(edge.to));
  const collapsedIds = new Set<string>();
  for (const id of visibleIds) {
    if ((children.get(id)?.length ?? 0) > 0 && !expanded.has(id)) {
      collapsedIds.add(id);
    }
  }

  return {
    graph: { nodes, edges },
    collapsedIds,
    counts,
    hiddenCounts: computeHiddenCounts(graph, { nodes, edges }, counts),
  };
}

/**
 * 隐藏后代计数：整图子树计数减去**投影后仍可见**的子树规模。
 * 自深向浅累加（子节点先算完），只依赖投影子图的 `contains` 边，因此对「部分展开」的中间层
 * 也能给出准确值（例如分类自身展开了、但它的某个阶段子树还折叠着）。
 */
export function computeHiddenCounts(
  graph: KnowledgeGraph,
  visibleGraph: KnowledgeGraph,
  counts: ReadonlyMap<string, number>,
): Map<string, number> {
  const visibleChildren = buildContainsChildrenMap(visibleGraph);
  const depths = computeContainsDepths(visibleGraph);
  const ordered = [...visibleGraph.nodes].sort(
    (left, right) => (depths.get(right.id) ?? 0) - (depths.get(left.id) ?? 0),
  );
  const visibleSubtree = new Map<string, number>();
  const hidden = new Map<string, number>();
  for (const node of ordered) {
    let descendants = 0;
    for (const childId of visibleChildren.get(node.id) ?? []) {
      descendants += 1 + (visibleSubtree.get(childId) ?? 0);
    }
    visibleSubtree.set(node.id, descendants);
    const total = counts.get(node.id) ?? 0;
    hidden.set(node.id, Math.max(0, total - descendants));
  }
  for (const node of graph.nodes) {
    if (!hidden.has(node.id)) {
      hidden.set(node.id, 0);
    }
  }
  return hidden;
}

/**
 * 搜索自动展开：返回「让任一命中节点可见」所需的全部 `contains` 祖先。
 * 与视图过滤共用同一套匹配判定，因此搜索结果永远不会藏在折叠分组里。
 * 整工作区语义 / 空查询无需展开，返回空集合。
 */
export function autoExpansionForSearch(graph: KnowledgeGraph, query: string): Set<string> {
  const matches = collectGraphSearchMatches(graph, query);
  if (matches.kind !== 'matches') {
    return new Set();
  }
  return collectContainsAncestors(graph, matches.matchedIds);
}

/** 顶层展开集合：无 `contains` 父节点的节点（工作区根 / 孤点）。收起全部即回落到这里。 */
export function collapsedTopLevelExpansion(graph: KnowledgeGraph): Set<string> {
  const parent = buildContainsParentMap(graph);
  const ids = new Set<string>();
  for (const node of graph.nodes) {
    if (!parent.has(node.id)) {
      ids.add(node.id);
    }
  }
  return ids;
}

/**
 * 默认展开策略：整图节点数 ≤ 阈值（默认 60）时全展开（小工作区观感与聚合前一致）；
 * 否则收起为顶层（仅工作区 + 分类）。
 */
export function resolveDefaultExpansion(
  graph: KnowledgeGraph,
  options: ResolveDefaultExpansionOptions = {},
): Set<string> {
  const threshold = options.smallGraphThreshold ?? DEFAULT_SMALL_GRAPH_THRESHOLD;
  if (graph.nodes.length <= threshold) {
    return new Set(graph.nodes.map((node) => node.id));
  }
  return collapsedTopLevelExpansion(graph);
}

/** 展开全部：仅展开有子树的节点（叶子无需展开）。 */
export function expandAllExpandableIds(graph: KnowledgeGraph): Set<string> {
  return expandableIds(graph, buildContainsChildrenMap(graph));
}

/** 切换单个节点的展开态；幂等且稳定（切换两次回到原集合语义）。 */
export function toggleExpandedId(expandedIds: ReadonlySet<string>, nodeId: string): Set<string> {
  const next = new Set(expandedIds);
  if (next.has(nodeId)) {
    next.delete(nodeId);
  } else {
    next.add(nodeId);
  }
  return next;
}

/** 合并展开集合；`extra` 为空时原样返回（保持引用，避免无意义重渲染）。 */
export function mergeExpandedIds(
  base: ReadonlySet<string>,
  extra: ReadonlySet<string>,
): ReadonlySet<string> {
  if (extra.size === 0) {
    return base;
  }
  const next = new Set(base);
  for (const id of extra) {
    next.add(id);
  }
  return next;
}
