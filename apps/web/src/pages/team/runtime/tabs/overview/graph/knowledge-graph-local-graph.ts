/**
 * 知识图谱 · 局部深度（邻域）过滤（纯函数）。
 *
 * 从 `WorkspaceKnowledgeGraphView` 拆出，逻辑逐字保留：按选中节点做无向 BFS，
 * 只保留 `depth` 跳以内的邻域，并补齐其 `contains` 祖先。
 *
 * 与聚合的关系：局部深度先裁剪出**有界子图**，聚合投影再作用在该子图上；
 * 局部深度激活时上层会把该子图整体视为已展开，避免「已裁剪到 30 个节点却全是折叠态」。
 */

import type { GraphNode, KnowledgeGraph } from '../../../data/build-knowledge-graph.js';
import { addContainsAncestors, keepGraphNodes } from './knowledge-graph-structure.js';

export function filterGraphByLocalDepth(
  graph: KnowledgeGraph,
  selectedNodeId: string | null,
  depth: number,
): KnowledgeGraph {
  if (depth === 0 || !selectedNodeId || !graph.nodes.some((node) => node.id === selectedNodeId)) {
    return graph;
  }

  const keepNodeIds = new Set<string>([selectedNodeId]);
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const selectedNodeHasDerivesEdge = graph.edges.some(
    (edge) =>
      edge.kind === 'derives' && (edge.from === selectedNodeId || edge.to === selectedNodeId),
  );
  const queue: Array<{ currentDepth: number; nodeId: string }> = [
    { currentDepth: 0, nodeId: selectedNodeId },
  ];
  const visited = new Set<string>([selectedNodeId]);

  for (let index = 0; index < queue.length; index += 1) {
    const item = queue[index];
    if (!item || item.currentDepth >= depth) {
      continue;
    }
    const currentNode = nodeById.get(item.nodeId);
    if (!currentNode) {
      continue;
    }
    for (const edge of graph.edges) {
      if (
        !canTraverseLocalGraphEdge(edge, currentNode, {
          selectedNodeHasDerivesEdge,
          selectedNodeId,
        })
      ) {
        continue;
      }
      const neighbor =
        edge.from === item.nodeId ? edge.to : edge.to === item.nodeId ? edge.from : null;
      if (!neighbor) {
        continue;
      }
      keepNodeIds.add(neighbor);
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push({ currentDepth: item.currentDepth + 1, nodeId: neighbor });
      }
    }
  }

  return keepGraphNodes(graph, addContainsAncestors(graph, keepNodeIds));
}

export function canTraverseLocalGraphEdge(
  edge: KnowledgeGraph['edges'][number],
  currentNode: GraphNode,
  options: { selectedNodeHasDerivesEdge: boolean; selectedNodeId: string },
): boolean {
  if (edge.kind === 'derives') {
    return true;
  }
  if (edge.kind !== 'contains') {
    return false;
  }
  if (edge.to === currentNode.id) {
    return true;
  }
  if (currentNode.kind === 'category' && edge.from === currentNode.id) {
    return !options.selectedNodeHasDerivesEdge;
  }
  return (
    currentNode.kind === 'workspace' &&
    currentNode.id === options.selectedNodeId &&
    edge.from === currentNode.id
  );
}
