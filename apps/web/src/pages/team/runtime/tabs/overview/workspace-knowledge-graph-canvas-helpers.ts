import type {
  GraphNode,
  GraphNodeGroup,
  KnowledgeGraph,
} from '../../data/build-knowledge-graph.js';
import { GRAPH_HEIGHT, GRAPH_WIDTH, clampGraphPoint } from './workspace-knowledge-graph-layout.js';

type KnowledgeGraphLabelDensity = 'auto' | 'all' | 'focus';

export interface GraphFocusState {
  active: boolean;
  edgeIds: Set<string>;
  nodeIds: Set<string>;
}

export interface ForceAnchorOptions {
  localFocusDistance?: number | null;
  localGraphActive?: boolean;
}

export interface ForceNodePositionSnapshot {
  fx: number | null;
  fy: number | null;
  x: number;
  y: number;
}

export interface ResolveForceNodePositionInput {
  anchor: { x: number; y: number };
  localGraphActive: boolean;
  nodeId: string;
  pinAnchor: boolean;
  previous?: ForceNodePositionSnapshot;
  seedX: number;
  seedY: number;
  userFixedNodeIds: ReadonlySet<string>;
}

export interface NodeLabelVisibility {
  meta: boolean;
  title: boolean;
}

const GROUP_ANCHOR_ANGLES: Record<GraphNodeGroup, number> = {
  workspace: 0,
  architecture: -2.18,
  governance: -0.74,
  memory: 0.76,
  knowledge: 2.34,
};

const LABEL_BUDGET = 80;
const MIN_NODE_HIT_RADIUS_PX = 28;
const NODE_DRAG_THRESHOLD_PX = 3;
const CONTENT_ANCHOR_ROW_SIZE = 10;
const LOCAL_GRAPH_RING_SIZE = 8;
const ARTIFACT_PHASE_TRACK_ORDER = [
  'spec',
  'plan',
  'tasks',
  'implementation',
  'patch',
  'review',
  'review_report',
] as const;
const ARTIFACT_PHASE_TRACK_SPACING = 40;

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

export function shouldShowNodeLabel({
  focusActive,
  focused,
  labelDensity,
  node,
  selected,
  visibleIndex,
  zoom,
}: {
  focusActive: boolean;
  focused: boolean;
  labelDensity: KnowledgeGraphLabelDensity;
  node: GraphNode;
  selected: boolean;
  visibleIndex: number;
  zoom: number;
}): boolean {
  if (labelDensity === 'all') {
    return true;
  }
  if (labelDensity === 'focus') {
    if (!focusActive) {
      return node.kind === 'workspace' || node.kind === 'category';
    }
    return selected || focused || node.kind === 'workspace' || node.kind === 'category';
  }
  if (selected || node.kind === 'workspace' || node.kind === 'category') {
    return true;
  }
  if (!focused) {
    return false;
  }
  return visibleIndex < LABEL_BUDGET && zoom >= 0.85;
}

export function nodeLabelVisibility({
  focusActive,
  focused,
  labelDensity,
  node,
  selected,
  visibleIndex,
  zoom,
}: {
  focusActive: boolean;
  focused: boolean;
  labelDensity: KnowledgeGraphLabelDensity;
  node: GraphNode;
  selected: boolean;
  visibleIndex: number;
  zoom: number;
}): NodeLabelVisibility {
  const title = shouldShowNodeLabel({
    focusActive,
    focused,
    labelDensity,
    node,
    selected,
    visibleIndex,
    zoom,
  });
  if (!title) {
    return { meta: false, title: false };
  }
  if (node.kind === 'workspace' || node.kind === 'category' || selected) {
    return { meta: true, title: true };
  }
  if (labelDensity === 'all') {
    return { meta: zoom >= 0.72, title: true };
  }
  if (labelDensity === 'focus') {
    return { meta: focusActive ? zoom >= 0.92 : false, title: true };
  }
  return { meta: zoom >= 1.05 && visibleIndex < Math.floor(LABEL_BUDGET * 0.72), title: true };
}

export function graphNodeHitRadius(radius: number, screenScale: number): number {
  const safeScreenScale = Math.max(0.01, screenScale);
  return Math.max(radius + 10, MIN_NODE_HIT_RADIUS_PX / safeScreenScale);
}

export function nodeDragExceededThreshold({
  currentX,
  currentY,
  startX,
  startY,
}: {
  currentX: number;
  currentY: number;
  startX: number;
  startY: number;
}): boolean {
  return Math.hypot(currentX - startX, currentY - startY) >= NODE_DRAG_THRESHOLD_PX;
}

export function countContentNodesByGroup(nodes: GraphNode[]): Map<GraphNodeGroup, number> {
  const totals = new Map<GraphNodeGroup, number>();
  for (const node of nodes) {
    if (node.kind === 'workspace' || node.kind === 'category') {
      continue;
    }
    totals.set(node.group, (totals.get(node.group) ?? 0) + 1);
  }
  return totals;
}

export function shouldPinGraphNodeToAnchor(
  node: GraphNode,
  localGraphActive: boolean,
  localFocusDistance: number | null | undefined,
): boolean {
  if (localGraphActive) {
    return localFocusDistance === 0;
  }
  return node.kind === 'workspace' || node.kind === 'category';
}

export function forceAnchorForNode(
  node: GraphNode,
  indexInGroup = 0,
  groupTotal = 1,
  options: ForceAnchorOptions = {},
): { x: number; y: number } {
  if (
    options.localGraphActive === true &&
    typeof options.localFocusDistance === 'number' &&
    Number.isFinite(options.localFocusDistance)
  ) {
    return localGraphForceAnchorForNode(node, indexInGroup, groupTotal, options.localFocusDistance);
  }
  if (node.kind === 'workspace') {
    return { x: GRAPH_WIDTH / 2, y: GRAPH_HEIGHT / 2 };
  }
  const angle = GROUP_ANCHOR_ANGLES[node.group] ?? 0;
  const radial = { x: Math.cos(angle), y: Math.sin(angle) };
  const tangent = { x: -Math.sin(angle), y: Math.cos(angle) };
  if (node.kind === 'category') {
    return {
      x: GRAPH_WIDTH / 2 + radial.x * 132,
      y: GRAPH_HEIGHT / 2 + radial.y * 132,
    };
  }
  const rowIndex = Math.floor(indexInGroup / CONTENT_ANCHOR_ROW_SIZE);
  const rowOffset = indexInGroup % CONTENT_ANCHOR_ROW_SIZE;
  const rowCount = Math.min(
    CONTENT_ANCHOR_ROW_SIZE,
    groupTotal - rowIndex * CONTENT_ANCHOR_ROW_SIZE,
  );
  const centeredOffset = rowOffset - (Math.max(1, rowCount) - 1) / 2;
  const artifactPhaseDistance =
    node.kind === 'artifact' ? artifactPhaseTrackDistance(node.state) : 0;
  const radius = node.kind === 'artifact' ? 192 + rowIndex * 30 : 214 + rowIndex * 38;
  const tangentDistance =
    node.kind === 'artifact' ? artifactPhaseDistance + centeredOffset * 16 : centeredOffset * 28;
  const radialJitter =
    (seededUnit(`${node.id}:anchor`) - 0.5) * (node.kind === 'artifact' ? 10 : 16);
  return clampGraphPoint({
    x: GRAPH_WIDTH / 2 + radial.x * (radius + radialJitter) + tangent.x * tangentDistance,
    y: GRAPH_HEIGHT / 2 + radial.y * (radius + radialJitter) + tangent.y * tangentDistance,
  });
}

export function resolveForceNodePosition({
  anchor,
  localGraphActive,
  nodeId,
  pinAnchor,
  previous,
  seedX,
  seedY,
  userFixedNodeIds,
}: ResolveForceNodePositionInput): ForceNodePositionSnapshot {
  const previousWasUserFixed =
    userFixedNodeIds.has(nodeId) &&
    typeof previous?.fx === 'number' &&
    typeof previous.fy === 'number';
  const shouldUseAnchorInitialPosition =
    localGraphActive && !previousWasUserFixed && previous === undefined;
  const fx = previousWasUserFixed ? previous.fx : pinAnchor ? anchor.x : null;
  const fy = previousWasUserFixed ? previous.fy : pinAnchor ? anchor.y : null;
  const x = previousWasUserFixed
    ? previous.x
    : pinAnchor || shouldUseAnchorInitialPosition
      ? anchor.x
      : (previous?.x ?? anchor.x + (seedX - 0.5) * 72);
  const y = previousWasUserFixed
    ? previous.y
    : pinAnchor || shouldUseAnchorInitialPosition
      ? anchor.y
      : (previous?.y ?? anchor.y + (seedY - 0.5) * 72);

  return { fx, fy, x, y };
}

function localGraphForceAnchorForNode(
  node: GraphNode,
  indexInGroup: number,
  groupTotal: number,
  focusDistance: number,
): { x: number; y: number } {
  if (focusDistance === 0) {
    return { x: GRAPH_WIDTH / 2, y: GRAPH_HEIGHT / 2 };
  }

  const radius = localGraphAnchorRadius(node, focusDistance, indexInGroup);
  const angle = localGraphAnchorAngle(node, indexInGroup, groupTotal);
  return clampGraphPoint({
    x: GRAPH_WIDTH / 2 + Math.cos(angle) * radius,
    y: GRAPH_HEIGHT / 2 + Math.sin(angle) * radius,
  });
}

function localGraphAnchorRadius(
  node: GraphNode,
  focusDistance: number,
  indexInGroup: number,
): number {
  if (node.kind === 'workspace') {
    return 196;
  }
  if (node.kind === 'category') {
    return 142;
  }
  const ringIndex = Math.floor(indexInGroup / LOCAL_GRAPH_RING_SIZE);
  return Math.min(332, 108 + focusDistance * 68 + ringIndex * 34);
}

function localGraphAnchorAngle(node: GraphNode, indexInGroup: number, groupTotal: number): number {
  if (node.kind === 'workspace') {
    return Math.PI;
  }
  const ringIndex = indexInGroup % LOCAL_GRAPH_RING_SIZE;
  const ringTotal = Math.min(LOCAL_GRAPH_RING_SIZE, Math.max(1, groupTotal));
  const centeredOffset = ringIndex - (ringTotal - 1) / 2;
  const spread = node.kind === 'category' ? 0.3 : 0.22;
  const jitter = (seededUnit(`${node.id}:local-anchor`) - 0.5) * 0.16;
  return (GROUP_ANCHOR_ANGLES[node.group] ?? 0) + centeredOffset * spread + jitter;
}

export function artifactPhaseTrackDistance(phase: string | null): number {
  const index = phase
    ? ARTIFACT_PHASE_TRACK_ORDER.indexOf(phase as (typeof ARTIFACT_PHASE_TRACK_ORDER)[number])
    : -1;
  if (index < 0) {
    return 0;
  }
  const midpoint = (ARTIFACT_PHASE_TRACK_ORDER.length - 1) / 2;
  return (index - midpoint) * ARTIFACT_PHASE_TRACK_SPACING;
}

export function seededUnit(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

export function nodeRenderScale({
  dimmed,
  focusActive,
  focusDistance,
  selected,
}: {
  dimmed: boolean;
  focusActive: boolean;
  focusDistance: number | null;
  selected: boolean;
}): number {
  if (selected) {
    return 1.08;
  }
  if (!focusActive || focusDistance === null) {
    return 1;
  }
  if (focusDistance <= 0) {
    return 1.04;
  }
  if (focusDistance === 1) {
    return 0.98;
  }
  if (focusDistance === 2) {
    return 0.92;
  }
  return dimmed ? 0.82 : 0.88;
}

export function nodeFocusWeight({
  dimmed,
  focusActive,
  focusDistance,
  selected,
}: {
  dimmed: boolean;
  focusActive: boolean;
  focusDistance: number | null;
  selected: boolean;
}): number {
  if (selected) {
    return 1;
  }
  if (!focusActive || focusDistance === null) {
    return 0;
  }
  if (focusDistance <= 0) {
    return 0.92;
  }
  if (focusDistance === 1) {
    return 0.66;
  }
  if (focusDistance === 2) {
    return 0.38;
  }
  return dimmed ? 0.08 : 0.18;
}

export function edgeDepthWeight(
  sourceDistance: number | null,
  targetDistance: number | null,
): number {
  const distances = [sourceDistance, targetDistance].filter(
    (value): value is number => typeof value === 'number',
  );
  if (distances.length === 0) {
    return 0;
  }
  const nearest = Math.min(...distances);
  if (nearest <= 0) {
    return 1;
  }
  if (nearest === 1) {
    return 0.68;
  }
  if (nearest === 2) {
    return 0.38;
  }
  return 0.16;
}

export function edgeNearestDistance(
  sourceDistance: number | null,
  targetDistance: number | null,
): number | null {
  const distances = [sourceDistance, targetDistance].filter(
    (value): value is number => typeof value === 'number',
  );
  if (distances.length === 0) {
    return null;
  }
  return Math.min(...distances);
}

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
