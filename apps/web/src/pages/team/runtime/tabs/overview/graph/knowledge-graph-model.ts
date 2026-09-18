import type {
  GraphEdge,
  GraphEdgeKind,
  GraphNode,
  GraphNodeGroup,
  GraphNodeKind,
  GraphRoleLayer,
  KnowledgeGraph,
} from '../../../data/build-knowledge-graph.js';

export interface GraphNodeModel {
  readonly id: string;
  readonly kind: GraphNodeKind;
  readonly group: GraphNodeGroup;
  readonly label: string;
  readonly detail: string | null;
  readonly phase: string | null;
  readonly depth: number;
  readonly persisted: boolean;
  readonly roleLayers: GraphRoleLayer[] | null;
  readonly node: GraphNode;
  /** 聚合视图：该节点当前是折叠态（自身可见、后代被收起）。默认 false。 */
  readonly collapsed?: boolean;
  /** 聚合视图：该节点在当前（可能已被过滤的）图中的 `contains` 后代数量。 */
  readonly descendantCount?: number;
}

/** 聚合视图注入项：折叠集合与后代计数，由投影结果提供。 */
export interface GraphModelAggregation {
  readonly collapsedIds?: ReadonlySet<string>;
  readonly counts?: ReadonlyMap<string, number>;
}

export interface GraphEdgeModel {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly kind: GraphEdgeKind;
  readonly edge: GraphEdge;
}

export interface GraphModel {
  readonly nodes: readonly GraphNodeModel[];
  readonly edges: readonly GraphEdgeModel[];
  readonly rootId: string | null;
  readonly byId: ReadonlyMap<string, GraphNodeModel>;
  readonly childrenOf: ReadonlyMap<string, readonly string[]>;
  readonly maxDepth: number;
  /** 是否处于聚合视图（当前图里存在折叠节点）。布局据此把扇形按可见规模分配。 */
  readonly aggregated: boolean;
}

const KIND_ORDER: readonly GraphNodeKind[] = [
  'category',
  'architecture',
  'constitution',
  'memory',
  'knowledge',
  'artifact',
];

const KIND_RANK = new Map<GraphNodeKind, number>(KIND_ORDER.map((kind, index) => [kind, index]));

/** Kind rank used to order siblings deterministically (`workspace`/unknown fall last). */
function kindRank(kind: GraphNodeKind): number {
  return KIND_RANK.get(kind) ?? KIND_ORDER.length;
}

function compareChildModels(left: GraphNodeModel, right: GraphNodeModel): number {
  const rankDiff = kindRank(left.kind) - kindRank(right.kind);
  if (rankDiff !== 0) {
    return rankDiff;
  }
  const phaseDiff = (left.phase ?? '').localeCompare(right.phase ?? '', 'zh-CN');
  if (phaseDiff !== 0) {
    return phaseDiff;
  }
  const labelDiff = left.label.localeCompare(right.label, 'zh-CN');
  if (labelDiff !== 0) {
    return labelDiff;
  }
  return left.id.localeCompare(right.id, 'zh-CN');
}

export function buildGraphModel(
  graph: KnowledgeGraph,
  aggregation: GraphModelAggregation = {},
): GraphModel {
  const nodeById = new Map<string, GraphNode>();
  for (const node of graph.nodes) {
    nodeById.set(node.id, node);
  }

  let rootId: string | null = null;
  for (const node of graph.nodes) {
    if (node.kind === 'workspace') {
      rootId = node.id;
      break;
    }
  }

  // Spanning tree over `contains` edges only: first parent wins, no child is duplicated.
  const rawChildren = new Map<string, string[]>();
  const assignedParent = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.kind !== 'contains') {
      continue;
    }
    if (edge.from === edge.to) {
      continue;
    }
    if (!nodeById.has(edge.from) || !nodeById.has(edge.to)) {
      continue;
    }
    if (assignedParent.has(edge.to)) {
      continue;
    }
    assignedParent.add(edge.to);
    const siblings = rawChildren.get(edge.from);
    if (siblings) {
      siblings.push(edge.to);
    } else {
      rawChildren.set(edge.from, [edge.to]);
    }
  }

  const depths = new Map<string, number>();
  if (rootId !== null) {
    depths.set(rootId, 0);
    const queue: string[] = [rootId];
    for (let index = 0; index < queue.length; index += 1) {
      const currentId = queue[index];
      if (currentId === undefined) {
        continue;
      }
      const currentDepth = depths.get(currentId) ?? 0;
      for (const childId of rawChildren.get(currentId) ?? []) {
        if (depths.has(childId)) {
          continue;
        }
        depths.set(childId, currentDepth + 1);
        queue.push(childId);
      }
    }
  }

  let maxDepth = 0;
  for (const depth of depths.values()) {
    if (depth > maxDepth) {
      maxDepth = depth;
    }
  }

  const nodes: GraphNodeModel[] = graph.nodes.map((node) => ({
    id: node.id,
    kind: node.kind,
    group: node.group,
    label: node.label,
    detail: node.detail,
    phase: node.kind === 'artifact' ? node.state : null,
    depth: depths.get(node.id) ?? maxDepth + 1,
    persisted: node.persistedMemoryId !== null,
    roleLayers: node.roleLayers,
    node,
    collapsed: aggregation.collapsedIds?.has(node.id) ?? false,
    descendantCount: aggregation.counts?.get(node.id) ?? 0,
  }));

  const byId = new Map<string, GraphNodeModel>();
  for (const model of nodes) {
    byId.set(model.id, model);
  }

  const childrenOf = new Map<string, readonly string[]>();
  for (const [parentId, childIds] of rawChildren) {
    const sorted = [...childIds].sort((leftId, rightId) => {
      const left = byId.get(leftId);
      const right = byId.get(rightId);
      if (!left || !right) {
        return leftId.localeCompare(rightId, 'zh-CN');
      }
      return compareChildModels(left, right);
    });
    childrenOf.set(parentId, sorted);
  }

  const edges: GraphEdgeModel[] = graph.edges.map((edge) => ({
    id: edge.id,
    from: edge.from,
    to: edge.to,
    kind: edge.kind,
    edge,
  }));

  return {
    nodes,
    edges,
    rootId,
    byId,
    childrenOf,
    maxDepth,
    aggregated: (aggregation.collapsedIds?.size ?? 0) > 0,
  };
}
