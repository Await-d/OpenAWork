import { describe, expect, it } from 'vitest';
import type { GraphEdge, GraphNode, KnowledgeGraph } from '../../../data/build-knowledge-graph.js';
import {
  DEFAULT_MAX_VISIBLE_NODES,
  DEFAULT_SMALL_GRAPH_THRESHOLD,
  EXPAND_ALL_MAX_NODES,
  autoExpansionForSearch,
  collapsedTopLevelExpansion,
  computeDescendantCounts,
  expandAllExpandableIds,
  isExpandAllAvailable,
  mergeExpandedIds,
  projectVisibleGraph,
  resolveDefaultExpansion,
  toggleExpandedId,
} from './knowledge-graph-aggregation.js';

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

/**
 * 嵌套夹具（含三层深的 buried 节点、一个无父孤点、跨折叠边界的 derives 边）：
 * workspace:current
 *  ├─ category:knowledge
 *  │   └─ artifact:a
 *  │       └─ artifact:b
 *  │           └─ artifact:buried
 *  ├─ category:memory
 *  │   └─ knowledge:mem1
 *  └─ artifact:orphan（无 contains 父节点）
 */
function createNestedFixture(): KnowledgeGraph {
  const nodes: GraphNode[] = [
    createNode({
      id: 'workspace:current',
      kind: 'workspace',
      label: '当前工作区',
      group: 'workspace',
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
      id: 'artifact:a',
      kind: 'artifact',
      label: '规格一',
      group: 'knowledge',
      state: 'spec',
    }),
    createNode({
      id: 'artifact:b',
      kind: 'artifact',
      label: '计划一',
      group: 'knowledge',
      state: 'plan',
    }),
    createNode({
      id: 'artifact:buried',
      kind: 'artifact',
      label: '深层埋藏节点',
      group: 'knowledge',
      state: 'review',
      searchText: '深层埋藏节点的搜索正文',
    }),
    createNode({
      id: 'knowledge:mem1',
      kind: 'memory',
      label: '项目记忆',
      group: 'memory',
      state: 'project-memory',
    }),
    createNode({
      id: 'artifact:orphan',
      kind: 'artifact',
      label: '游离产物',
      group: 'knowledge',
      state: 'spec',
    }),
  ];

  const edges: GraphEdge[] = [
    createEdge('workspace:current', 'category:knowledge', 'contains'),
    createEdge('workspace:current', 'category:memory', 'contains'),
    createEdge('category:knowledge', 'artifact:a', 'contains'),
    createEdge('artifact:a', 'artifact:b', 'contains'),
    createEdge('artifact:b', 'artifact:buried', 'contains'),
    createEdge('category:memory', 'knowledge:mem1', 'contains'),
    createEdge('artifact:a', 'artifact:b', 'derives', 'plan'),
    createEdge('category:knowledge', 'artifact:orphan', 'derives', 'spec'),
  ];

  return { nodes, edges };
}

function ids(graph: KnowledgeGraph): string[] {
  return graph.nodes.map((node) => node.id).sort();
}

function edgeIds(graph: KnowledgeGraph): string[] {
  return graph.edges.map((edge) => edge.id).sort();
}

describe('computeDescendantCounts', () => {
  it('统计每个节点的 contains 子树规模（不含自身）', () => {
    const counts = computeDescendantCounts(createNestedFixture());
    expect(counts.get('workspace:current')).toBe(6);
    expect(counts.get('category:knowledge')).toBe(3);
    expect(counts.get('artifact:a')).toBe(2);
    expect(counts.get('artifact:b')).toBe(1);
    expect(counts.get('artifact:buried')).toBe(0);
    expect(counts.get('category:memory')).toBe(1);
    expect(counts.get('knowledge:mem1')).toBe(0);
    // 无父孤点不属于任何子树
    expect(counts.get('artifact:orphan')).toBe(0);
  });
});

describe('projectVisibleGraph', () => {
  it('折叠态只丢弃其后代，节点自身仍可见', () => {
    const graph = createNestedFixture();
    const projection = projectVisibleGraph(graph, new Set(['workspace:current']));
    expect(ids(projection.graph)).toEqual(
      ['artifact:orphan', 'category:knowledge', 'category:memory', 'workspace:current'].sort(),
    );
    expect([...projection.collapsedIds].sort()).toEqual(
      ['category:knowledge', 'category:memory'].sort(),
    );
  });

  it('contains / derives 边只在两端都存活时保留', () => {
    const graph = createNestedFixture();
    const projection = projectVisibleGraph(graph, new Set(['workspace:current']));
    // artifact:a -> artifact:b 的 derives 与 contains 都因 a、b 被隐藏而丢弃；
    // category:knowledge -> artifact:orphan 因 orphan 存活但 category 未展开（category 自身存活）→ 保留。
    expect(edgeIds(projection.graph)).toEqual(
      [
        'contains:workspace:current->category:knowledge',
        'contains:workspace:current->category:memory',
        'derives:category:knowledge->artifact:orphan',
      ].sort(),
    );
  });

  it('逐层展开会依次露出更深节点', () => {
    const graph = createNestedFixture();
    const first = projectVisibleGraph(graph, new Set(['workspace:current', 'category:knowledge']));
    expect(first.graph.nodes.some((node) => node.id === 'artifact:a')).toBe(true);
    expect(first.graph.nodes.some((node) => node.id === 'artifact:b')).toBe(false);
    expect([...first.collapsedIds].sort()).toEqual(['artifact:a', 'category:memory'].sort());

    const deep = projectVisibleGraph(
      graph,
      new Set(['workspace:current', 'category:knowledge', 'artifact:a', 'artifact:b']),
    );
    expect(deep.graph.nodes.some((node) => node.id === 'artifact:buried')).toBe(true);
    expect(deep.graph.edges.some((edge) => edge.id === 'derives:artifact:a->artifact:b')).toBe(
      true,
    );
    expect([...deep.collapsedIds]).toEqual(['category:memory']);
  });

  it('无 contains 父节点的节点永远不会消失', () => {
    const graph = createNestedFixture();
    const empty = projectVisibleGraph(graph, new Set());
    expect(empty.graph.nodes.some((node) => node.id === 'artifact:orphan')).toBe(true);
    expect(empty.graph.nodes.some((node) => node.id === 'workspace:current')).toBe(true);

    const withCap = projectVisibleGraph(graph, expandAllExpandableIds(graph), { maxNodes: 0 });
    expect(withCap.graph.nodes.some((node) => node.id === 'artifact:orphan')).toBe(true);
  });

  it('expandAll 把整个（已裁剪）子图视为展开', () => {
    const graph = createNestedFixture();
    const projection = projectVisibleGraph(graph, new Set(), { expandAll: true });
    expect(ids(projection.graph)).toEqual(ids(graph));
    expect(projection.collapsedIds.size).toBe(0);
  });

  it('超过渲染上限时强制收起更深层，最终保留顶层聚合而不拒绝渲染', () => {
    const graph = createNestedFixture();
    const projection = projectVisibleGraph(graph, expandAllExpandableIds(graph), { maxNodes: 4 });
    expect(ids(projection.graph)).toEqual(
      ['artifact:orphan', 'category:knowledge', 'category:memory', 'workspace:current'].sort(),
    );
    expect(projection.graph.nodes.length).toBeLessThanOrEqual(4);
  });

  it('即使顶层本身超过上限也照常渲染（不返回空图）', () => {
    const graph = createNestedFixture();
    const projection = projectVisibleGraph(graph, expandAllExpandableIds(graph), { maxNodes: 1 });
    expect(projection.graph.nodes.length).toBeGreaterThan(0);
    expect(projection.graph.nodes.some((node) => node.id === 'workspace:current')).toBe(true);
  });

  it('forceVisibleIds 会连同其祖先一起展开，搜索命中不会被折叠吞掉', () => {
    const graph = createNestedFixture();
    const projection = projectVisibleGraph(graph, new Set(['workspace:current']), {
      forceVisibleIds: new Set(['artifact:buried']),
    });
    expect(projection.graph.nodes.some((node) => node.id === 'artifact:buried')).toBe(true);
    expect(projection.graph.nodes.some((node) => node.id === 'artifact:a')).toBe(true);
  });

  it('可复用预计算的 counts（数据变化一次、投影多次）', () => {
    const graph = createNestedFixture();
    const counts = computeDescendantCounts(graph);
    const projection = projectVisibleGraph(graph, new Set(['workspace:current']), { counts });
    expect(projection.counts).toBe(counts);
    expect(projection.counts.get('category:knowledge')).toBe(3);
  });
});

describe('autoExpansionForSearch', () => {
  it('展开三层深命中的全部祖先，使命中节点可见', () => {
    const graph = createNestedFixture();
    const expansion = autoExpansionForSearch(graph, '深层埋藏节点');
    expect([...expansion].sort()).toEqual(
      ['artifact:a', 'artifact:b', 'category:knowledge', 'workspace:current'].sort(),
    );
    const projection = projectVisibleGraph(graph, expansion, {
      forceVisibleIds: new Set(['artifact:buried']),
    });
    expect(projection.graph.nodes.some((node) => node.id === 'artifact:buried')).toBe(true);
  });

  it('整工作区语义 / 空查询无需额外展开', () => {
    const graph = createNestedFixture();
    expect(autoExpansionForSearch(graph, '').size).toBe(0);
    expect(autoExpansionForSearch(graph, '整个工作区').size).toBe(0);
  });

  it('无命中时不展开任何节点', () => {
    const graph = createNestedFixture();
    expect(autoExpansionForSearch(graph, '不存在的关键词zzz').size).toBe(0);
  });
});

describe('resolveDefaultExpansion', () => {
  it('小图（≤ 阈值）默认全展开', () => {
    const graph = createNestedFixture();
    const expansion = resolveDefaultExpansion(graph);
    expect(expansion.size).toBe(graph.nodes.length);
    expect(graph.nodes.length).toBeLessThanOrEqual(DEFAULT_SMALL_GRAPH_THRESHOLD);
  });

  it('大图默认收起为顶层（仅根节点展开）', () => {
    const nodes: GraphNode[] = [
      createNode({
        id: 'workspace:current',
        kind: 'workspace',
        label: '工作区',
        group: 'workspace',
      }),
    ];
    const edges: GraphEdge[] = [];
    for (let index = 0; index < DEFAULT_SMALL_GRAPH_THRESHOLD + 5; index += 1) {
      const categoryId = `category:c${index}`;
      const leafId = `artifact:leaf-${index}`;
      nodes.push(
        createNode({ id: categoryId, kind: 'category', label: '分类', group: 'knowledge' }),
        createNode({ id: leafId, kind: 'artifact', label: '产物', group: 'knowledge' }),
      );
      edges.push(createEdge('workspace:current', categoryId, 'contains'));
      edges.push(createEdge(categoryId, leafId, 'contains'));
    }
    const graph = { nodes, edges };
    const expansion = resolveDefaultExpansion(graph);
    expect([...expansion]).toEqual(['workspace:current']);
    expect(collapsedTopLevelExpansion(graph)).toEqual(expansion);
  });

  it('阈值可覆盖，用于强制切换分支', () => {
    const graph = createNestedFixture();
    expect(resolveDefaultExpansion(graph, { smallGraphThreshold: 0 }).size).toBe(2);
    expect(resolveDefaultExpansion(graph, { smallGraphThreshold: 0 })).toEqual(
      collapsedTopLevelExpansion(graph),
    );
  });
});

describe('展开切换', () => {
  it('切换是幂等的：切换两次回到原集合', () => {
    const base = new Set(['workspace:current', 'category:knowledge']);
    const toggled = toggleExpandedId(base, 'artifact:a');
    expect(toggled.has('artifact:a')).toBe(true);
    expect(base.has('artifact:a')).toBe(false);
    const restored = toggleExpandedId(toggled, 'artifact:a');
    expect([...restored].sort()).toEqual([...base].sort());
  });

  it('收起已展开节点后再展开得到稳定顺序结果', () => {
    const base = new Set(['a', 'b']);
    const collapsed = toggleExpandedId(base, 'a');
    expect([...collapsed]).toEqual(['b']);
    expect([...toggleExpandedId(collapsed, 'a')].sort()).toEqual(['a', 'b']);
  });

  it('mergeExpandedIds 在无新增时保持引用不变', () => {
    const base = new Set(['a']);
    expect(mergeExpandedIds(base, new Set())).toBe(base);
    const merged = mergeExpandedIds(base, new Set(['b']));
    expect([...merged].sort()).toEqual(['a', 'b']);
  });
});

describe('展开全部的规模感知（DEFECT C）', () => {
  it('小图允许「展开全部」', () => {
    const graph = createNestedFixture();
    expect(graph.nodes.length).toBeLessThanOrEqual(EXPAND_ALL_MAX_NODES);
    expect(isExpandAllAvailable(graph)).toBe(true);
  });

  it('超过上限的图禁用「展开全部」', () => {
    const nodes: GraphNode[] = [
      createNode({
        id: 'workspace:current',
        kind: 'workspace',
        label: '工作区',
        group: 'workspace',
      }),
    ];
    const edges: GraphEdge[] = [];
    for (let index = 0; index <= EXPAND_ALL_MAX_NODES; index += 1) {
      const id = `artifact:${index}`;
      nodes.push(createNode({ id, kind: 'artifact', label: `产物 ${index}`, group: 'knowledge' }));
      edges.push(createEdge('workspace:current', id, 'contains'));
    }
    const graph: KnowledgeGraph = { nodes, edges };
    expect(graph.nodes.length).toBeGreaterThan(EXPAND_ALL_MAX_NODES);
    expect(isExpandAllAvailable(graph)).toBe(false);
  });

  it('禁用「展开全部」不影响逐层钻取：单节点展开仍可让子节点可见', () => {
    const graph = createNestedFixture();
    const projection = projectVisibleGraph(
      graph,
      new Set(['workspace:current', 'category:knowledge', 'artifact:a']),
      {
        counts: computeDescendantCounts(graph),
        maxNodes: DEFAULT_MAX_VISIBLE_NODES,
      },
    );
    expect(projection.graph.nodes.some((node) => node.id === 'artifact:b')).toBe(true);
  });
});
