/**
 * 260530-team-page · Wave 4 · build-knowledge-graph（F1 知识图谱 · 纯派生）
 *
 * 把现有运行时真相源派生为一张工作区知识图谱（前端内存模型，无新后端）：
 *
 *   节点（node）：
 *     - session：每个层级 session（来自 useLayerStore.nodes）
 *     - artifact：spec / plan / tasks / review 产物（来自调用方传入的 artifact 列表）
 *
 *   边（edge）：
 *     - parent：父 session → 子 session（会话树）
 *     - handoff：from session → to session（层间交接，带状态）
 *     - produces：session → 它产出的 artifact
 *
 * 该函数是纯函数（输入 → 输出），便于单测与在 WorkspaceKnowledgeGraphView 内消费。
 */

import type { HandoffEntry, LayerNode, TeamRoleLayer } from '../../../../stores/team/team-events.js';

export type GraphNodeKind = 'session' | 'artifact';

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  label: string;
  /** session 节点的层级（artifact 节点为 null）。 */
  layer: TeamRoleLayer | null;
  /** session 节点的运行状态（artifact 节点为 null）。 */
  state: string | null;
  /** 该节点关联的 session id（用于点击联动选中）。 */
  sessionId: string | null;
}

export type GraphEdgeKind = 'parent' | 'handoff' | 'produces';

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  kind: GraphEdgeKind;
  /** handoff 边的状态（其他边为 null）。 */
  state: string | null;
}

export interface KnowledgeGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface KnowledgeGraphArtifactInput {
  id: string;
  /** 产出该 artifact 的 session id。 */
  sessionId: string;
  /** spec / plan / tasks / review 等。 */
  phase: string | null;
  title: string;
}

const LAYER_LABELS: Record<TeamRoleLayer, string> = {
  user: '用户',
  reception: '接待',
  pm1: 'PM1',
  pm2: 'PM2',
  executor: '执行',
  tester: '测试',
  reviewer: '评审',
};

function sessionNodeId(sessionId: string): string {
  return `session:${sessionId}`;
}

function artifactNodeId(artifactId: string): string {
  return `artifact:${artifactId}`;
}

export function buildKnowledgeGraph(input: {
  layerNodes: Iterable<LayerNode>;
  handoffs: Iterable<HandoffEntry>;
  artifacts?: KnowledgeGraphArtifactInput[];
}): KnowledgeGraph {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const edgeKeys = new Set<string>();

  const addEdge = (edge: GraphEdge) => {
    const key = `${edge.kind}:${edge.from}->${edge.to}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push(edge);
  };

  // 1) session 节点 + parent 边
  for (const node of input.layerNodes) {
    const id = sessionNodeId(node.sessionId);
    nodes.set(id, {
      id,
      kind: 'session',
      label: node.title?.trim()
        ? node.title
        : `${LAYER_LABELS[node.roleLayer]} · ${node.sessionId.slice(0, 6)}`,
      layer: node.roleLayer,
      state: node.state,
      sessionId: node.sessionId,
    });
  }
  for (const node of input.layerNodes) {
    if (!node.parentSessionId) continue;
    const fromId = sessionNodeId(node.parentSessionId);
    const toId = sessionNodeId(node.sessionId);
    // 父节点可能尚未在 layerNodes 中（孤儿）——补一个占位 session 节点。
    if (!nodes.has(fromId)) {
      nodes.set(fromId, {
        id: fromId,
        kind: 'session',
        label: node.parentSessionId.slice(0, 6),
        layer: null,
        state: null,
        sessionId: node.parentSessionId,
      });
    }
    if (nodes.has(toId)) {
      addEdge({ id: `parent:${fromId}->${toId}`, from: fromId, to: toId, kind: 'parent', state: null });
    }
  }

  // 2) handoff 边（from session → to session）
  for (const entry of input.handoffs) {
    if (!entry.sessionId) continue;
    // handoff 的 to 是 entry.sessionId；from 需要从 layer tree 的 parent 推断，
    // 但 HandoffEntry 不直接带 fromSessionId，这里用 to-session 的 parent 作为近似。
    const toId = sessionNodeId(entry.sessionId);
    if (!nodes.has(toId)) continue;
    const toNode = nodes.get(toId)!;
    // 找一个 from 候选：layerNodes 中该 session 的 parent。
    let fromSessionId: string | null = null;
    for (const node of input.layerNodes) {
      if (node.sessionId === entry.sessionId) {
        fromSessionId = node.parentSessionId;
        break;
      }
    }
    if (!fromSessionId) continue;
    const fromId = sessionNodeId(fromSessionId);
    if (!nodes.has(fromId)) continue;
    addEdge({
      id: `handoff:${entry.id}`,
      from: fromId,
      to: toId,
      kind: 'handoff',
      state: entry.state,
    });
    // 标注 to 节点的状态以 handoff 为准（更实时）
    toNode.state = entry.state;
  }

  // 3) artifact 节点 + produces 边
  for (const artifact of input.artifacts ?? []) {
    const aId = artifactNodeId(artifact.id);
    nodes.set(aId, {
      id: aId,
      kind: 'artifact',
      label: artifact.title || artifact.phase || artifact.id.slice(0, 8),
      layer: null,
      state: artifact.phase,
      sessionId: artifact.sessionId,
    });
    const sId = sessionNodeId(artifact.sessionId);
    if (nodes.has(sId)) {
      addEdge({ id: `produces:${sId}->${aId}`, from: sId, to: aId, kind: 'produces', state: null });
    }
  }

  return { nodes: Array.from(nodes.values()), edges };
}

export { LAYER_LABELS as KNOWLEDGE_GRAPH_LAYER_LABELS };
