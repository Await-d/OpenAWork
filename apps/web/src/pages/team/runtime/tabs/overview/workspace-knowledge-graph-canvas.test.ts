import { describe, expect, it } from 'vitest';
import type { GraphNode } from '../../data/build-knowledge-graph.js';
import {
  artifactPhaseTrackDistance,
  computeLocalGraphDistances,
  forceAnchorForNode,
  graphNodeHitRadius,
  nodeLabelVisibility,
  nodeDragExceededThreshold,
  resolveForceNodePosition,
  shouldShowNodeLabel,
  shouldPinGraphNodeToAnchor,
} from './workspace-knowledge-graph-canvas.js';
import { GRAPH_HEIGHT, GRAPH_WIDTH } from './workspace-knowledge-graph-layout.js';

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

describe('workspace knowledge graph canvas helpers', () => {
  it('节点命中半径会按当前缩放补偿，避免小节点难以点中', () => {
    expect(graphNodeHitRadius(13, 0.5)).toBe(56);
    expect(graphNodeHitRadius(13, 2)).toBe(23);
  });

  it('仅焦点视觉标签模式未聚焦时保留骨架标签并隐藏内容标签', () => {
    const contentNode = createGraphNode({});
    const categoryNode = createGraphNode({
      detail: '知识产物',
      id: 'category:knowledge',
      kind: 'category',
      label: '知识产物',
      memoryType: null,
      sourceRef: null,
      state: 'knowledge',
    });

    expect(
      shouldShowNodeLabel({
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

  it('自动标签密度会先显示标题，再在更高缩放下显示补充说明', () => {
    const contentNode = createGraphNode({});

    expect(
      nodeLabelVisibility({
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
    const workspaceNode = createGraphNode({
      group: 'workspace',
      id: 'workspace:current',
      kind: 'workspace',
      label: '工作区',
      memoryType: null,
      sourceRef: null,
      state: 'workspace',
    });
    const categoryNode = createGraphNode({
      detail: '知识产物',
      id: 'category:knowledge',
      kind: 'category',
      label: '知识产物',
      memoryType: null,
      sourceRef: null,
      state: 'knowledge',
    });

    expect(
      nodeLabelVisibility({
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

  it('artifact 节点按产物阶段落到稳定轨道，减少知识产物混堆', () => {
    const specNode = createGraphNode({ id: 'artifact:spec', state: 'spec' });
    const reviewNode = createGraphNode({ id: 'artifact:review', state: 'review_report' });
    const specAnchor = forceAnchorForNode(specNode, 0, 2);
    const reviewAnchor = forceAnchorForNode(reviewNode, 0, 2);
    const tangent = {
      x: -Math.sin(2.34),
      y: Math.cos(2.34),
    };
    const specProjection =
      (specAnchor.x - GRAPH_WIDTH / 2) * tangent.x + (specAnchor.y - GRAPH_HEIGHT / 2) * tangent.y;
    const reviewProjection =
      (reviewAnchor.x - GRAPH_WIDTH / 2) * tangent.x +
      (reviewAnchor.y - GRAPH_HEIGHT / 2) * tangent.y;

    expect(artifactPhaseTrackDistance('spec')).toBeLessThan(artifactPhaseTrackDistance('plan'));
    expect(artifactPhaseTrackDistance('review_report')).toBeGreaterThan(
      artifactPhaseTrackDistance('review'),
    );
    expect(reviewProjection - specProjection).toBeGreaterThan(180);
  });

  it('局部图会把选中节点锚定到中心，并把邻居放到稳定环上', () => {
    const selectedNode = createGraphNode({ id: 'artifact:spec' });
    const neighborNode = createGraphNode({ id: 'artifact:plan', state: 'plan' });
    const workspaceNode = createGraphNode({
      detail: '工作区知识资产根节点',
      group: 'workspace',
      id: 'workspace:current',
      kind: 'workspace',
      label: '工作区',
      memoryType: null,
      sourceRef: null,
      state: 'workspace',
    });
    const graph = {
      nodes: [workspaceNode, selectedNode, neighborNode],
      edges: [
        {
          from: 'workspace:current',
          id: 'edge:workspace:current->artifact:spec',
          kind: 'contains' as const,
          state: 'workspace',
          to: 'artifact:spec',
        },
        {
          from: 'artifact:spec',
          id: 'edge:artifact:spec->artifact:plan',
          kind: 'derives' as const,
          state: 'plan',
          to: 'artifact:plan',
        },
      ],
    };
    const distances = computeLocalGraphDistances(graph, 'artifact:spec');
    const selectedAnchor = forceAnchorForNode(selectedNode, 0, 2, {
      localFocusDistance: distances.get(selectedNode.id),
      localGraphActive: true,
    });
    const neighborAnchor = forceAnchorForNode(neighborNode, 1, 2, {
      localFocusDistance: distances.get(neighborNode.id),
      localGraphActive: true,
    });

    expect(distances.get('workspace:current')).toBe(1);
    expect(distances.get('artifact:plan')).toBe(1);
    expect(selectedAnchor).toEqual({ x: GRAPH_WIDTH / 2, y: GRAPH_HEIGHT / 2 });
    expect(
      Math.hypot(neighborAnchor.x - GRAPH_WIDTH / 2, neighborAnchor.y - GRAPH_HEIGHT / 2),
    ).toBeGreaterThan(150);
  });

  it('全图固定工作区和分类枢纽，局部图只固定焦点节点', () => {
    const workspaceNode = createGraphNode({
      detail: '工作区知识资产根节点',
      group: 'workspace',
      id: 'workspace:current',
      kind: 'workspace',
      label: '工作区',
      memoryType: null,
      sourceRef: null,
      state: 'workspace',
    });
    const categoryNode = createGraphNode({
      detail: '知识产物',
      id: 'category:knowledge',
      kind: 'category',
      label: '知识产物',
      memoryType: null,
      sourceRef: null,
      state: 'knowledge',
    });
    const contentNode = createGraphNode({ id: 'artifact:spec' });

    expect(shouldPinGraphNodeToAnchor(workspaceNode, false, null)).toBe(true);
    expect(shouldPinGraphNodeToAnchor(categoryNode, false, null)).toBe(true);
    expect(shouldPinGraphNodeToAnchor(contentNode, false, null)).toBe(false);
    expect(shouldPinGraphNodeToAnchor(categoryNode, true, 1)).toBe(false);
    expect(shouldPinGraphNodeToAnchor(contentNode, true, 0)).toBe(true);
  });

  it('局部图同组节点超过一圈时会外扩半径，避免节点回绕重叠', () => {
    const firstNode = createGraphNode({ id: 'artifact:first' });
    const wrappedNode = createGraphNode({ id: 'artifact:wrapped' });
    const firstAnchor = forceAnchorForNode(firstNode, 0, 12, {
      localFocusDistance: 1,
      localGraphActive: true,
    });
    const wrappedAnchor = forceAnchorForNode(wrappedNode, 8, 12, {
      localFocusDistance: 1,
      localGraphActive: true,
    });
    const firstRadius = Math.hypot(
      firstAnchor.x - GRAPH_WIDTH / 2,
      firstAnchor.y - GRAPH_HEIGHT / 2,
    );
    const wrappedRadius = Math.hypot(
      wrappedAnchor.x - GRAPH_WIDTH / 2,
      wrappedAnchor.y - GRAPH_HEIGHT / 2,
    );

    expect(wrappedRadius - firstRadius).toBeGreaterThan(32);
  });

  it('局部图只保留用户拖拽固定，不继承全图自动固定位置', () => {
    const anchor = { x: 266, y: GRAPH_HEIGHT / 2 };
    const previousAutoPinned = {
      fx: GRAPH_WIDTH / 2,
      fy: GRAPH_HEIGHT / 2,
      x: GRAPH_WIDTH / 2,
      y: GRAPH_HEIGHT / 2,
    };

    expect(
      resolveForceNodePosition({
        anchor,
        localGraphActive: true,
        nodeId: 'workspace:current',
        pinAnchor: false,
        previous: previousAutoPinned,
        seedX: 0.5,
        seedY: 0.5,
        userFixedNodeIds: new Set(),
      }),
    ).toEqual({
      fx: null,
      fy: null,
      x: GRAPH_WIDTH / 2,
      y: anchor.y,
    });

    expect(
      resolveForceNodePosition({
        anchor,
        localGraphActive: true,
        nodeId: 'workspace:current',
        pinAnchor: false,
        previous: previousAutoPinned,
        seedX: 0.5,
        seedY: 0.5,
        userFixedNodeIds: new Set(['workspace:current']),
      }),
    ).toEqual(previousAutoPinned);
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
