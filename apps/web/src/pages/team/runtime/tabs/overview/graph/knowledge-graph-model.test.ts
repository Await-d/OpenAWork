import { describe, expect, it } from 'vitest';
import type { GraphEdge, GraphNode, KnowledgeGraph } from '../../../data/build-knowledge-graph.js';
import type { GraphModel, GraphNodeModel } from './knowledge-graph-model.js';
import { buildGraphModel } from './knowledge-graph-model.js';

interface NodeOverrides {
  id: string;
  kind: GraphNode['kind'];
  label: string;
  group: GraphNode['group'];
  content?: string | null;
  detail?: string | null;
  memoryType?: GraphNode['memoryType'];
  persistedMemoryId?: string | null;
  roleLayers?: GraphNode['roleLayers'];
  searchText?: string | null;
  sourceRef?: string | null;
  state?: string | null;
}

function createNode(overrides: NodeOverrides): GraphNode {
  return {
    id: overrides.id,
    kind: overrides.kind,
    label: overrides.label,
    group: overrides.group,
    content: overrides.content ?? null,
    detail: overrides.detail ?? null,
    memoryType: overrides.memoryType ?? null,
    persistedMemoryId: overrides.persistedMemoryId ?? null,
    roleLayers: overrides.roleLayers ?? null,
    searchText: overrides.searchText ?? null,
    sourceRef: overrides.sourceRef ?? null,
    state: overrides.state ?? null,
  };
}

function createEdge(
  from: string,
  to: string,
  kind: GraphEdge['kind'],
  state: string | null = null,
): GraphEdge {
  return { id: `${kind}:${from}->${to}`, from, to, kind, state };
}

function createNestedFixture(includeDerives: boolean): KnowledgeGraph {
  const nodes: GraphNode[] = [
    createNode({
      id: 'workspace:current',
      kind: 'workspace',
      label: '当前工作区',
      group: 'workspace',
    }),
    createNode({
      id: 'category:architecture',
      kind: 'category',
      label: '架构上下文',
      group: 'architecture',
      state: 'architecture',
    }),
    createNode({
      id: 'category:knowledge',
      kind: 'category',
      label: '知识产物',
      group: 'knowledge',
      state: 'knowledge',
    }),
    createNode({
      id: 'category:memory',
      kind: 'category',
      label: '记忆与经验',
      group: 'memory',
      state: 'memory',
    }),
    createNode({
      id: 'knowledge:architecture-md:stable:0',
      kind: 'architecture',
      label: '架构说明',
      group: 'architecture',
      detail: '架构',
      state: 'architecture-md',
    }),
    createNode({
      id: 'knowledge:project-memory:stable:0',
      kind: 'memory',
      label: '项目记忆',
      group: 'memory',
      detail: '记忆',
      persistedMemoryId: 'mem-1',
      state: 'project-memory',
    }),
    createNode({
      id: 'artifact:spec-1',
      kind: 'artifact',
      label: '规格一',
      group: 'knowledge',
      detail: '规格',
      state: 'spec',
    }),
    createNode({
      id: 'artifact:plan-1',
      kind: 'artifact',
      label: '计划一',
      group: 'knowledge',
      detail: '计划',
      state: 'plan',
    }),
    createNode({
      id: 'artifact:review-1',
      kind: 'artifact',
      label: '评审一',
      group: 'knowledge',
      detail: '评审',
      state: 'review',
    }),
  ];

  const edges: GraphEdge[] = [
    createEdge('workspace:current', 'category:architecture', 'contains'),
    createEdge('workspace:current', 'category:knowledge', 'contains'),
    createEdge('workspace:current', 'category:memory', 'contains'),
    createEdge('category:architecture', 'knowledge:architecture-md:stable:0', 'contains'),
    createEdge('category:memory', 'knowledge:project-memory:stable:0', 'contains'),
    createEdge('category:knowledge', 'artifact:spec-1', 'contains'),
    createEdge('category:knowledge', 'artifact:plan-1', 'contains'),
    createEdge('artifact:plan-1', 'artifact:review-1', 'contains'),
  ];

  if (includeDerives) {
    edges.push(createEdge('artifact:spec-1', 'artifact:plan-1', 'derives', 'plan'));
    edges.push(createEdge('artifact:plan-1', 'artifact:review-1', 'derives', 'review'));
  }

  return { nodes, edges };
}

function requireNode(model: GraphModel, id: string): GraphNodeModel {
  const node = model.byId.get(id);
  if (!node) {
    throw new Error(`missing node ${id}`);
  }
  return node;
}

function depthMap(model: GraphModel): Record<string, number> {
  const entries: Record<string, number> = {};
  for (const node of model.nodes) {
    entries[node.id] = node.depth;
  }
  return entries;
}

describe('buildGraphModel', () => {
  it('识别 workspace 根节点并计算最大深度', () => {
    const model = buildGraphModel(createNestedFixture(false));
    expect(model.rootId).toBe('workspace:current');
    expect(model.maxDepth).toBe(3);
  });

  it('按 contains 边为嵌套结构分配层级', () => {
    const model = buildGraphModel(createNestedFixture(false));
    expect(depthMap(model)).toEqual({
      'workspace:current': 0,
      'category:architecture': 1,
      'category:knowledge': 1,
      'category:memory': 1,
      'knowledge:architecture-md:stable:0': 2,
      'knowledge:project-memory:stable:0': 2,
      'artifact:spec-1': 2,
      'artifact:plan-1': 2,
      'artifact:review-1': 3,
    });
  });

  it('不可达节点落在最深可达层级之后', () => {
    const graph = createNestedFixture(false);
    const model = buildGraphModel({
      nodes: [
        ...graph.nodes,
        createNode({ id: 'orphan:1', kind: 'knowledge', label: '游离', group: 'knowledge' }),
      ],
      edges: graph.edges,
    });
    expect(requireNode(model, 'orphan:1').depth).toBe(model.maxDepth + 1);
  });

  it('按 kind / phase / label 确定性排序子节点', () => {
    const model = buildGraphModel(createNestedFixture(false));
    // category 节点 phase 恒为 null（phase 仅用于 artifact），故三者按 label 的 zh-CN 排序。
    expect(model.childrenOf.get('workspace:current')).toEqual([
      'category:memory',
      'category:architecture',
      'category:knowledge',
    ]);
    expect(model.childrenOf.get('category:knowledge')).toEqual([
      'artifact:plan-1',
      'artifact:spec-1',
    ]);
  });

  it('多个父节点时保留首次出现并只出现一次（生成树）', () => {
    const nodes: GraphNode[] = [
      createNode({
        id: 'workspace:current',
        kind: 'workspace',
        label: '工作区',
        group: 'workspace',
      }),
      createNode({
        id: 'category:a',
        kind: 'category',
        label: 'A',
        group: 'knowledge',
        state: 'knowledge',
      }),
      createNode({
        id: 'category:b',
        kind: 'category',
        label: 'B',
        group: 'memory',
        state: 'memory',
      }),
      createNode({
        id: 'artifact:shared',
        kind: 'artifact',
        label: '共享',
        group: 'knowledge',
        state: 'spec',
      }),
    ];
    const edges: GraphEdge[] = [
      createEdge('workspace:current', 'category:a', 'contains'),
      createEdge('workspace:current', 'category:b', 'contains'),
      createEdge('category:b', 'artifact:shared', 'contains'),
      createEdge('category:a', 'artifact:shared', 'contains'),
    ];
    const model = buildGraphModel({ nodes, edges });
    expect(model.childrenOf.get('category:b')).toEqual(['artifact:shared']);
    expect(model.childrenOf.get('category:a')).toBeUndefined();
    expect(requireNode(model, 'artifact:shared').depth).toBe(2);
  });

  it('derives 边不影响 depth 与 childrenOf（验收测试）', () => {
    const withDerives = buildGraphModel(createNestedFixture(true));
    const withoutDerives = buildGraphModel(createNestedFixture(false));
    expect(depthMap(withDerives)).toEqual(depthMap(withoutDerives));
    expect(withDerives.maxDepth).toBe(withoutDerives.maxDepth);
    expect(withDerives.rootId).toBe(withoutDerives.rootId);
    for (const id of withoutDerives.childrenOf.keys()) {
      expect(withDerives.childrenOf.get(id)).toEqual(withoutDerives.childrenOf.get(id));
    }
    expect(withDerives.childrenOf.size).toBe(withoutDerives.childrenOf.size);
  });

  it('映射 phase / persisted / roleLayers / detail', () => {
    const model = buildGraphModel(createNestedFixture(false));
    const spec = requireNode(model, 'artifact:spec-1');
    expect(spec.phase).toBe('spec');
    expect(spec.persisted).toBe(false);
    expect(spec.detail).toBe('规格');
    expect(spec.node.kind).toBe('artifact');

    const memory = requireNode(model, 'knowledge:project-memory:stable:0');
    expect(memory.phase).toBeNull();
    expect(memory.persisted).toBe(true);
    expect(memory.roleLayers).toBeNull();

    const workspace = requireNode(model, 'workspace:current');
    expect(workspace.phase).toBeNull();
  });

  it('保留 edges 原始数据并暴露 byId / nodes 完整性', () => {
    const graph = createNestedFixture(true);
    const model = buildGraphModel(graph);
    expect(model.edges).toHaveLength(graph.edges.length);
    expect(model.nodes).toHaveLength(graph.nodes.length);
    expect(model.byId.size).toBe(graph.nodes.length);
    const derives = model.edges.filter((edge) => edge.kind === 'derives');
    expect(derives).toHaveLength(2);
  });
});
