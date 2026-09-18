/**
 * 知识图谱 · `contains` 结构遍历（纯函数）。
 *
 * 聚合视图（折叠/展开）与各类过滤器（搜索、孤点、局部邻域）都要回答同一类结构问题：
 * 「谁是父节点」「谁是子节点」「一个节点的祖先链」「某个 id 集合保留后还剩哪些节点/边」。
 * 这些逻辑集中在结构模块里，避免每个消费方各写一份 first-parent-wins 规则而产生分歧。
 *
 * `contains` 父子关系采用 **first-parent-wins**（与 `buildGraphModel` 的生成树完全一致）：
 * 同一条边序下，只有第一个把某节点当作 `to` 的 `contains` 边会建立父子关系。
 * 这样「折叠后展开能看到的子树」与渲染出的生成树保持同一个事实来源。
 */

import type { KnowledgeGraph } from '../../../data/build-knowledge-graph.js';

/** `contains` 子节点 → 父节点。只包含两端都存在的合法边，first-parent-wins。 */
export function buildContainsParentMap(graph: KnowledgeGraph): Map<string, string> {
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const parent = new Map<string, string>();
  for (const edge of graph.edges) {
    if (edge.kind !== 'contains' || edge.from === edge.to) {
      continue;
    }
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      continue;
    }
    if (parent.has(edge.to)) {
      continue;
    }
    parent.set(edge.to, edge.from);
  }
  return parent;
}

/** `contains` 父节点 → 子节点列表，顺序即父边首次出现的顺序。 */
export function buildContainsChildrenMap(graph: KnowledgeGraph): Map<string, string[]> {
  const parent = buildContainsParentMap(graph);
  const children = new Map<string, string[]>();
  for (const [childId, parentId] of parent) {
    const siblings = children.get(parentId);
    if (siblings) {
      siblings.push(childId);
    } else {
      children.set(parentId, [childId]);
    }
  }
  return children;
}

/** 一个节点集合向上收集全部 `contains` 祖先（不含自身）；有环时会安全终止。 */
export function collectContainsAncestors(
  graph: KnowledgeGraph,
  nodeIds: Iterable<string>,
): Set<string> {
  const parent = buildContainsParentMap(graph);
  const ancestors = new Set<string>();
  for (const nodeId of nodeIds) {
    const seen = new Set<string>();
    let current = parent.get(nodeId);
    while (current !== undefined && !seen.has(current)) {
      seen.add(current);
      ancestors.add(current);
      current = parent.get(current);
    }
  }
  return ancestors;
}

/** `initialNodeIds` 并上其全部 `contains` 祖先。与旧视图的 `addContainsAncestors` 语义一致。 */
export function addContainsAncestors(
  graph: KnowledgeGraph,
  initialNodeIds: ReadonlySet<string>,
): Set<string> {
  const keep = new Set(initialNodeIds);
  for (const ancestor of collectContainsAncestors(graph, initialNodeIds)) {
    keep.add(ancestor);
  }
  return keep;
}

/**
 * 每个节点的 `contains` 深度（根 = 0）。孤点（无父）也是 0 层；
 * 若有环导致无法 BFS 覆盖，则剩余节点落在 `maxDepth + 1`。
 */
export function computeContainsDepths(graph: KnowledgeGraph): Map<string, number> {
  const parent = buildContainsParentMap(graph);
  const children = buildContainsChildrenMap(graph);
  const depths = new Map<string, number>();
  const queue: string[] = [];
  for (const node of graph.nodes) {
    if (!parent.has(node.id)) {
      depths.set(node.id, 0);
      queue.push(node.id);
    }
  }
  let maxDepth = 0;
  for (let index = 0; index < queue.length; index += 1) {
    const currentId = queue[index];
    if (currentId === undefined) {
      continue;
    }
    const currentDepth = depths.get(currentId) ?? 0;
    if (currentDepth > maxDepth) {
      maxDepth = currentDepth;
    }
    for (const childId of children.get(currentId) ?? []) {
      if (depths.has(childId)) {
        continue;
      }
      depths.set(childId, currentDepth + 1);
      queue.push(childId);
    }
  }
  for (const node of graph.nodes) {
    if (!depths.has(node.id)) {
      depths.set(node.id, maxDepth + 1);
    }
  }
  return depths;
}

/**
 * 每个节点的子树规模（`contains` 后代数量，不含自身）。后序 DFS + 记忆化，
 * 环上有保护，整体 O(n)。
 */
export function computeSubtreeCounts(graph: KnowledgeGraph): Map<string, number> {
  const children = buildContainsChildrenMap(graph);
  const counts = new Map<string, number>();
  const visiting = new Set<string>();
  const countOf = (id: string): number => {
    const cached = counts.get(id);
    if (cached !== undefined) {
      return cached;
    }
    if (visiting.has(id)) {
      return 0;
    }
    visiting.add(id);
    let total = 0;
    for (const childId of children.get(id) ?? []) {
      total += 1 + countOf(childId);
    }
    visiting.delete(id);
    counts.set(id, total);
    return total;
  };
  for (const node of graph.nodes) {
    countOf(node.id);
  }
  return counts;
}

/**
 * 只保留 `keepNodeIds` 中的节点与「两端都保留」的边。
 * `workspace` 永远保留；`category` 只有在仍有边相连时才保留（避免留下悬空分类）。
 */
export function keepGraphNodes(
  graph: KnowledgeGraph,
  keepNodeIds: ReadonlySet<string>,
): KnowledgeGraph {
  const keptEdges = graph.edges.filter(
    (edge) => keepNodeIds.has(edge.from) && keepNodeIds.has(edge.to),
  );
  const connectedIds = new Set<string>();
  for (const edge of keptEdges) {
    connectedIds.add(edge.from);
    connectedIds.add(edge.to);
  }
  const nodes = graph.nodes.filter((node) => {
    if (!keepNodeIds.has(node.id)) {
      return false;
    }
    if (node.kind === 'workspace') {
      return true;
    }
    if (node.kind === 'category') {
      return connectedIds.has(node.id);
    }
    return true;
  });
  const finalNodeIds = new Set(nodes.map((node) => node.id));
  return {
    nodes,
    edges: keptEdges.filter((edge) => finalNodeIds.has(edge.from) && finalNodeIds.has(edge.to)),
  };
}
