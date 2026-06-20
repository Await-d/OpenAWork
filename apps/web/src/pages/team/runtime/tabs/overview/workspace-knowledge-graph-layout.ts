import type { GraphNode } from '../../data/build-knowledge-graph.js';

export const GRAPH_WIDTH = 960;
export const GRAPH_HEIGHT = 560;

const GRAPH_PADDING = 44;

export function nodeRadius(node: GraphNode): number {
  if (node.kind === 'workspace') return 30;
  if (node.kind === 'category') return 19;
  if (node.kind === 'artifact') return node.persistedMemoryId ? 15 : 13;
  return node.persistedMemoryId ? 16 : 14;
}

export function clampGraphPoint(point: { x: number; y: number }): { x: number; y: number } {
  return {
    x: clampGraphCoordinate(point.x, GRAPH_PADDING, GRAPH_WIDTH - GRAPH_PADDING),
    y: clampGraphCoordinate(point.y, GRAPH_PADDING, GRAPH_HEIGHT - GRAPH_PADDING),
  };
}

function clampGraphCoordinate(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
