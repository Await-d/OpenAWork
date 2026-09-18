import { describe, expect, it } from 'vitest';
import type { GraphNode, KnowledgeGraph } from '../../../data/build-knowledge-graph.js';
import { computeGraphFocusState, computeLocalGraphDistances } from './knowledge-graph-focus.js';
import { graphNodeHitRadius, nodeDragExceededThreshold } from './knowledge-graph-interaction.js';
import { nodeLabelVisibility, shouldShowNodeLabel } from './knowledge-graph-labels.js';

function createGraphNode(overrides: Partial<GraphNode>): GraphNode {
  return {
    content: null,
    detail: '规格',
    group: 'knowledge',
    id: 'artifact:spec',
    kind: 'artifact',
    label: '需求规格',
    memoryType: 'project_context',
    persistedMemoryId: null,
    roleLayers: null,
    searchText: null,
    sourceRef: 'artifact:spec',
    state: 'spec',
    ...overrides,
  };
}

function createWorkspaceNode(): GraphNode {
  return createGraphNode({
    detail: '工作区知识资产根节点',
    group: 'workspace',
    id: 'workspace:current',
    kind: 'workspace',
    label: '工作区',
    memoryType: null,
    sourceRef: null,
    state: 'workspace',
  });
}

function createCategoryNode(): GraphNode {
  return createGraphNode({
    detail: '知识产物',
    id: 'category:knowledge',
    kind: 'category',
    label: '知识产物',
    memoryType: null,
    sourceRef: null,
    state: 'knowledge',
  });
}

function createFixtureGraph(): KnowledgeGraph {
  return {
    nodes: [
      createWorkspaceNode(),
      createCategoryNode(),
      createGraphNode({ id: 'artifact:spec', state: 'spec' }),
      createGraphNode({ detail: '计划', id: 'artifact:plan', label: '实施计划', state: 'plan' }),
      createGraphNode({ detail: '任务', id: 'artifact:tasks', label: '任务清单', state: 'tasks' }),
      createGraphNode({ detail: '评审', id: 'artifact:iso', label: '独立产物', state: 'review' }),
    ],
    edges: [
      {
        from: 'workspace:current',
        id: 'edge:workspace:current->artifact:spec',
        kind: 'contains',
        state: 'workspace',
        to: 'artifact:spec',
      },
      {
        from: 'artifact:spec',
        id: 'edge:artifact:spec->artifact:plan',
        kind: 'derives',
        state: 'plan',
        to: 'artifact:plan',
      },
      {
        from: 'artifact:plan',
        id: 'edge:artifact:plan->artifact:tasks',
        kind: 'derives',
        state: 'tasks',
        to: 'artifact:tasks',
      },
    ],
  };
}

describe('computeGraphFocusState', () => {
  it('未选中节点时不激活焦点、不返回任何高亮集合', () => {
    const state = computeGraphFocusState(createFixtureGraph(), null);
    expect(state.active).toBe(false);
    expect(state.nodeIds.size).toBe(0);
    expect(state.edgeIds.size).toBe(0);
  });

  it('选中工作区节点时不激活焦点，避免整图被压暗', () => {
    const state = computeGraphFocusState(createFixtureGraph(), 'workspace:current');
    expect(state.active).toBe(false);
    expect(state.nodeIds.size).toBe(0);
    expect(state.edgeIds.size).toBe(0);
  });

  it('选中不存在的节点时不激活焦点', () => {
    const state = computeGraphFocusState(createFixtureGraph(), 'artifact:missing');
    expect(state.active).toBe(false);
    expect(state.nodeIds.size).toBe(0);
  });

  it('选中内容节点时收集两跳邻域内的节点与边', () => {
    const state = computeGraphFocusState(createFixtureGraph(), 'artifact:spec');
    expect(state.active).toBe(true);
    expect([...state.nodeIds].sort()).toEqual(
      ['artifact:plan', 'artifact:spec', 'artifact:tasks', 'workspace:current'].sort(),
    );
    expect([...state.edgeIds].sort()).toEqual(
      [
        'edge:artifact:plan->artifact:tasks',
        'edge:artifact:spec->artifact:plan',
        'edge:workspace:current->artifact:spec',
      ].sort(),
    );
  });

  it('邻域外的节点被排除在 nodeIds 之外，因此会被压暗', () => {
    const state = computeGraphFocusState(createFixtureGraph(), 'artifact:spec');
    expect(state.nodeIds.has('artifact:iso')).toBe(false);
  });

  it('不超过 depth 的跳数边界，depth=1 时两跳节点与边不纳入', () => {
    const state = computeGraphFocusState(createFixtureGraph(), 'artifact:spec', 1);
    expect([...state.nodeIds].sort()).toEqual(
      ['artifact:plan', 'artifact:spec', 'workspace:current'].sort(),
    );
    expect(state.nodeIds.has('artifact:tasks')).toBe(false);
    expect(state.edgeIds.has('edge:artifact:plan->artifact:tasks')).toBe(false);
  });

  it('contains 边按无向遍历：从 spec 出发可回到工作区枢纽', () => {
    const state = computeGraphFocusState(createFixtureGraph(), 'artifact:spec');
    expect(state.nodeIds.has('workspace:current')).toBe(true);
    expect(state.edgeIds.has('edge:workspace:current->artifact:spec')).toBe(true);
  });

  it('derives 边按无向遍历：从下游 tasks 出发可回溯 plan 与 spec', () => {
    const state = computeGraphFocusState(createFixtureGraph(), 'artifact:tasks');
    expect([...state.nodeIds].sort()).toEqual(
      ['artifact:plan', 'artifact:spec', 'artifact:tasks'].sort(),
    );
    expect([...state.edgeIds].sort()).toEqual(
      ['edge:artifact:plan->artifact:tasks', 'edge:artifact:spec->artifact:plan'].sort(),
    );
    expect(state.nodeIds.has('workspace:current')).toBe(false);
  });
});

describe('computeLocalGraphDistances', () => {
  it('未选中节点时返回空距离表', () => {
    expect(computeLocalGraphDistances(createFixtureGraph(), null).size).toBe(0);
  });

  it('选中不存在的节点时返回空距离表', () => {
    expect(computeLocalGraphDistances(createFixtureGraph(), 'artifact:missing').size).toBe(0);
  });

  it('按无向邻接计算 BFS 距离并保留不可达节点缺失', () => {
    const distances = computeLocalGraphDistances(createFixtureGraph(), 'artifact:spec');
    expect(distances.get('artifact:spec')).toBe(0);
    expect(distances.get('workspace:current')).toBe(1);
    expect(distances.get('artifact:plan')).toBe(1);
    expect(distances.get('artifact:tasks')).toBe(2);
    expect(distances.has('artifact:iso')).toBe(false);
  });

  it('从工作区枢纽出发通过 contains 边可达内容节点', () => {
    const distances = computeLocalGraphDistances(createFixtureGraph(), 'workspace:current');
    expect(distances.get('workspace:current')).toBe(0);
    expect(distances.get('artifact:spec')).toBe(1);
    expect(distances.get('artifact:plan')).toBe(2);
  });

  it('存在捷径时记录最短距离而非首次遍历距离', () => {
    const graph = createFixtureGraph();
    graph.edges.push({
      from: 'artifact:spec',
      id: 'edge:artifact:spec->artifact:tasks',
      kind: 'derives',
      state: 'tasks',
      to: 'artifact:tasks',
    });
    const distances = computeLocalGraphDistances(graph, 'artifact:spec');
    expect(distances.get('artifact:tasks')).toBe(1);
  });
});

describe('节点命中与拖拽交互', () => {
  it('节点命中半径会按当前缩放补偿，避免小节点难以点中', () => {
    expect(graphNodeHitRadius(13, 0.5)).toBe(56);
    expect(graphNodeHitRadius(13, 2)).toBe(23);
  });

  it('节点拖拽需要超过移动阈值，避免单击选中时误固定节点', () => {
    expect(nodeDragExceededThreshold({ currentX: 2, currentY: 0, startX: 0, startY: 0 })).toBe(
      false,
    );
    expect(nodeDragExceededThreshold({ currentX: 3, currentY: 0, startX: 0, startY: 0 })).toBe(
      true,
    );
  });
});

describe('节点标签可见性', () => {
  it('仅焦点视觉标签模式未聚焦时保留骨架标签并隐藏内容标签', () => {
    const contentNode = createGraphNode({});
    const categoryNode = createCategoryNode();

    expect(
      shouldShowNodeLabel({
        depth: 1,
        focusActive: false,
        focused: true,
        labelDensity: 'focus',
        node: contentNode,
        selected: false,
        visibleIndex: 0,
        zoom: 1,
      }),
    ).toBe(false);
    expect(
      shouldShowNodeLabel({
        depth: 1,
        focusActive: false,
        focused: true,
        labelDensity: 'focus',
        node: categoryNode,
        selected: false,
        visibleIndex: 0,
        zoom: 1,
      }),
    ).toBe(true);
  });

  it('自动标签密度最多显示预算内的内容标签，避免大图文字过载', () => {
    const contentNode = createGraphNode({});

    expect(
      shouldShowNodeLabel({
        depth: 1,
        focusActive: false,
        focused: true,
        labelDensity: 'auto',
        node: contentNode,
        selected: false,
        visibleIndex: 79,
        zoom: 1,
      }),
    ).toBe(true);
    expect(
      shouldShowNodeLabel({
        depth: 1,
        focusActive: false,
        focused: true,
        labelDensity: 'auto',
        node: contentNode,
        selected: false,
        visibleIndex: 80,
        zoom: 1,
      }),
    ).toBe(false);
  });

  it('自动标签密度默认展开到深度 2，更深节点仍需聚焦 + 缩放', () => {
    const contentNode = createGraphNode({});

    expect(
      shouldShowNodeLabel({
        depth: 2,
        focusActive: false,
        focused: false,
        labelDensity: 'auto',
        node: contentNode,
        selected: false,
        visibleIndex: 12,
        zoom: 0.5,
      }),
    ).toBe(true);
    expect(
      shouldShowNodeLabel({
        depth: 3,
        focusActive: false,
        focused: false,
        labelDensity: 'auto',
        node: contentNode,
        selected: false,
        visibleIndex: 12,
        zoom: 0.5,
      }),
    ).toBe(false);
    expect(
      shouldShowNodeLabel({
        depth: 3,
        focusActive: false,
        focused: true,
        labelDensity: 'auto',
        node: contentNode,
        selected: false,
        visibleIndex: 12,
        zoom: 0.9,
      }),
    ).toBe(true);
  });

  it('自动标签密度会先显示标题，再在更高缩放下显示补充说明', () => {
    const contentNode = createGraphNode({});

    expect(
      nodeLabelVisibility({
        depth: 1,
        focusActive: false,
        focused: true,
        labelDensity: 'auto',
        node: contentNode,
        selected: false,
        visibleIndex: 12,
        zoom: 0.9,
      }),
    ).toEqual({ meta: false, title: true });

    expect(
      nodeLabelVisibility({
        depth: 1,
        focusActive: false,
        focused: true,
        labelDensity: 'auto',
        node: contentNode,
        selected: false,
        visibleIndex: 12,
        zoom: 1.12,
      }),
    ).toEqual({ meta: true, title: true });
  });

  it('节点视觉样式会保持标题可见，同时只在高缩放时显示补充说明', () => {
    const contentNode = createGraphNode({});

    expect(
      nodeLabelVisibility({
        depth: 1,
        focusActive: true,
        focused: true,
        labelDensity: 'focus',
        node: contentNode,
        selected: false,
        visibleIndex: 4,
        zoom: 1.05,
      }),
    ).toEqual({ meta: true, title: true });
  });

  it('不同类型节点维持各自的默认局部图和视觉分层前提', () => {
    const workspaceNode = createWorkspaceNode();
    const categoryNode = createCategoryNode();

    expect(
      nodeLabelVisibility({
        depth: 0,
        focusActive: false,
        focused: true,
        labelDensity: 'auto',
        node: workspaceNode,
        selected: false,
        visibleIndex: 1,
        zoom: 0.7,
      }),
    ).toEqual({ meta: true, title: true });
    expect(
      nodeLabelVisibility({
        depth: 1,
        focusActive: false,
        focused: true,
        labelDensity: 'auto',
        node: categoryNode,
        selected: false,
        visibleIndex: 2,
        zoom: 0.7,
      }),
    ).toEqual({ meta: true, title: true });
  });
});
