import type { KnowledgeGraph } from '../../../data/build-knowledge-graph.js';

export interface GraphFocusState {
  active: boolean;
  edgeIds: Set<string>;
  nodeIds: Set<string>;
}

export function computeGraphFocusState(
  graph: KnowledgeGraph,
  selectedNodeId: string | null,
  depth = 2,
): GraphFocusState {
  if (!selectedNodeId) {
    return { active: false, edgeIds: new Set(), nodeIds: new Set() };
  }
  const selected = graph.nodes.find((node) => node.id === selectedNodeId);
  if (!selected || selected.kind === 'workspace') {
    return { active: false, edgeIds: new Set(), nodeIds: new Set() };
  }

  const nodeIds = new Set<string>([selectedNodeId]);
  const edgeIds = new Set<string>();
  const queue: Array<{ currentDepth: number; nodeId: string }> = [
    { currentDepth: 0, nodeId: selectedNodeId },
  ];
  const visited = new Set<string>([selectedNodeId]);

  for (let index = 0; index < queue.length; index += 1) {
    const item = queue[index];
    if (!item || item.currentDepth >= depth) {
      continue;
    }
    for (const edge of graph.edges) {
      const neighbor =
        edge.from === item.nodeId ? edge.to : edge.to === item.nodeId ? edge.from : null;
      if (!neighbor) {
        continue;
      }
      edgeIds.add(edge.id);
      nodeIds.add(neighbor);
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push({ currentDepth: item.currentDepth + 1, nodeId: neighbor });
      }
    }
  }

  return { active: true, edgeIds, nodeIds };
}

export function computeLocalGraphDistances(
  graph: KnowledgeGraph,
  selectedNodeId: string | null,
): Map<string, number> {
  const distances = new Map<string, number>();
  if (!selectedNodeId || !graph.nodes.some((node) => node.id === selectedNodeId)) {
    return distances;
  }

  const queue: Array<{ distance: number; nodeId: string }> = [
    { distance: 0, nodeId: selectedNodeId },
  ];
  distances.set(selectedNodeId, 0);

  for (let index = 0; index < queue.length; index += 1) {
    const item = queue[index];
    if (!item) {
      continue;
    }
    for (const edge of graph.edges) {
      const neighbor =
        edge.from === item.nodeId ? edge.to : edge.to === item.nodeId ? edge.from : null;
      if (!neighbor || distances.has(neighbor)) {
        continue;
      }
      const distance = item.distance + 1;
      distances.set(neighbor, distance);
      queue.push({ distance, nodeId: neighbor });
    }
  }

  return distances;
}
