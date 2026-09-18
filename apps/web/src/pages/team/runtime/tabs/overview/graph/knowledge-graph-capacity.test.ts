// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { GraphEdge, GraphNode, KnowledgeGraph } from '../../../data/build-knowledge-graph.js';
import {
  autoExpansionForSearch,
  computeDescendantCounts,
  collapsedTopLevelExpansion,
  mergeExpandedIds,
  projectVisibleGraph,
} from './knowledge-graph-aggregation.js';
import {
  evaluateExpansionCapacity,
  graphBandCapacity,
  nodeExpansionBlocked,
  type CapacityCandidate,
} from './knowledge-graph-capacity.js';
import { nodeDrawnRadius } from './knowledge-graph-label-text.js';
import { layoutRadialTree, type GraphViewportSize } from './knowledge-graph-layout.js';
import { buildGraphModel } from './knowledge-graph-model.js';
import { collectGraphSearchMatches } from './knowledge-graph-search.js';
import { useKnowledgeGraphExpansion } from '../use-workspace-knowledge-graph-expansion.js';

afterEach(() => {
  cleanup();
});

function node(
  id: string,
  kind: GraphNode['kind'],
  label: string,
  group: GraphNode['group'],
  state: string | null = null,
): GraphNode {
  return {
    id,
    kind,
    label,
    group,
    content: null,
    detail: null,
    memoryType: null,
    persistedMemoryId: null,
    roleLayers: null,
    searchText: null,
    sourceRef: null,
    state,
  };
}

function edge(from: string, to: string, kind: GraphEdge['kind']): GraphEdge {
  return { id: `${kind}:${from}->${to}`, from, to, kind, state: null };
}

/** 独立复算容量模型（不引用生产常量），用于交叉校验函数确实用了文档化的间距规则。 */
function expectedBandCapacity(input: {
  readonly maxRadius: number;
  readonly innerBound: number;
  readonly radius: number;
}): number {
  const spacing = 2 * input.radius * (1 + 0.35);
  let total = 0;
  let bands = 0;
  for (let R = input.maxRadius; R > 0 && bands < 24; R -= spacing) {
    if (R < input.innerBound - 1e-9) {
      break;
    }
    total += Math.floor((Math.PI * 2 * R) / spacing);
    bands += 1;
  }
  return total;
}

describe('graphBandCapacity · 纯容量函数', () => {
  it('单条子环的容量等于 floor(2πR / spacing)', () => {
    const candidates: CapacityCandidate[] = [{ id: 'a', depth: 1, radius: 40 }];
    const capacity = graphBandCapacity({
      viewport: { width: 400, height: 400 },
      candidates,
      rootRadius: 0,
      maxDepth: 1,
      shallowOverview: false,
    });
    // maxRadius = 200 - 40 = 160；spacing = 2*40*1.35 = 108；下界 = 40*1.35 = 54。
    expect(capacity.maxRadius).toBe(160);
    expect(capacity.maxByDepth.get(1)).toBe(9);
    expect(capacity.maxNodes).toBe(9);
  });

  it('径向空间变大时拆出更多子环、容量随之增长，且与独立复算一致', () => {
    const candidates: CapacityCandidate[] = [{ id: 'a', depth: 1, radius: 40 }];
    const capacity = graphBandCapacity({
      viewport: { width: 520, height: 520 },
      candidates,
      rootRadius: 0,
      maxDepth: 1,
      shallowOverview: false,
    });
    // maxRadius = 260 - 40 = 220；两条子环（220 / 112）。
    expect(capacity.maxRadius).toBe(220);
    expect(capacity.maxByDepth.get(1)).toBe(18);
    expect(capacity.maxByDepth.get(1)).toBe(
      expectedBandCapacity({ maxRadius: 220, innerBound: 54, radius: 40 }),
    );
  });

  it('确定：同一输入两次得到逐深度完全相同的容量', () => {
    const candidates: CapacityCandidate[] = Array.from({ length: 30 }, (_, index) => ({
      id: `n${index}`,
      depth: (index % 3) + 1,
      radius: 10 + (index % 4),
    }));
    const input = {
      viewport: { width: 1440, height: 900 },
      candidates,
      rootRadius: 30,
      maxDepth: 3,
      shallowOverview: false,
    } as const;
    const first = graphBandCapacity(input);
    const second = graphBandCapacity(input);
    expect([...first.maxByDepth.entries()]).toEqual([...second.maxByDepth.entries()]);
    expect(first.maxNodes).toBe(second.maxNodes);
  });

  it('容器越小容量越小（容量由视口而非节点数决定）', () => {
    const candidates: CapacityCandidate[] = [{ id: 'a', depth: 1, radius: 14 }];
    const big = graphBandCapacity({
      viewport: { width: 1440, height: 900 },
      candidates,
      rootRadius: 30,
      maxDepth: 1,
      shallowOverview: false,
    });
    const small = graphBandCapacity({
      viewport: { width: 700, height: 420 },
      candidates,
      rootRadius: 30,
      maxDepth: 1,
      shallowOverview: false,
    });
    expect(big.maxNodes).toBeGreaterThan(small.maxNodes);
  });
});

/**
 * 展开夹具：工作区 + 一个超大分组（80 个直接子节点，含一条三层深链）+ 一个小分组。
 * 小视口下展开大分组必然超过深度 2 的环带容量；展开小分组则仍合法。
 */
function createExpansionFixture(): KnowledgeGraph {
  const nodes: GraphNode[] = [
    node('workspace:ws', 'workspace', '示例工作区', 'workspace'),
    node('category:big', 'category', '知识产物', 'knowledge', 'knowledge'),
    node('category:small', 'category', '团队规则', 'governance', 'governance'),
  ];
  const edges: GraphEdge[] = [
    edge('workspace:ws', 'category:big', 'contains'),
    edge('workspace:ws', 'category:small', 'contains'),
  ];
  for (let index = 0; index < 79; index += 1) {
    const id = `artifact:big-${index}`;
    nodes.push(node(id, 'artifact', `规格产物 ${index}`, 'knowledge', 'spec'));
    edges.push(edge('category:big', id, 'contains'));
  }
  nodes.push(node('artifact:a', 'artifact', '规格一', 'knowledge', 'spec'));
  nodes.push(node('artifact:b', 'artifact', '计划一', 'knowledge', 'plan'));
  nodes.push(node('artifact:buried', 'artifact', '深层埋藏节点', 'knowledge', 'review'));
  edges.push(edge('category:big', 'artifact:a', 'contains'));
  edges.push(edge('artifact:a', 'artifact:b', 'contains'));
  edges.push(edge('artifact:b', 'artifact:buried', 'contains'));
  for (let index = 0; index < 3; index += 1) {
    const id = `leaf:small-${index}`;
    nodes.push(node(id, 'constitution', `规则 ${index}`, 'governance', 'governance'));
    edges.push(edge('category:small', id, 'contains'));
  }
  return { nodes, edges };
}

const SMALL_VIEWPORT: GraphViewportSize = { width: 700, height: 420 };
const LARGE_VIEWPORT: GraphViewportSize = { width: 2000, height: 2000 };

function baseExpansion(graph: KnowledgeGraph): ReadonlySet<string> {
  return collapsedTopLevelExpansion(graph);
}

describe('展开不再被容量拒绝（力导向）', () => {
  const graph = createExpansionFixture();

  it('超大分组在小视口下也照常展开，且不给出阻塞解释', () => {
    const { result } = renderHook(() =>
      useKnowledgeGraphExpansion(graph, '', null, { viewportSize: SMALL_VIEWPORT }),
    );

    act(() => {
      result.current.toggleExpand('category:big');
    });

    expect(result.current.expandedIds.has('category:big')).toBe(true);
    expect(result.current.capacityNotice).toBeNull();
    expect(result.current.capacityBlockedIds.size).toBe(0);

    act(() => {
      result.current.toggleExpand('category:small');
    });

    expect(result.current.expandedIds.has('category:small')).toBe(true);
  });

  it('「展开全部」总是生效（不再按容量禁用）', () => {
    const { result } = renderHook(() =>
      useKnowledgeGraphExpansion(graph, '', null, { viewportSize: SMALL_VIEWPORT }),
    );
    expect(result.current.expandAllBlocked).toBe(false);
    act(() => {
      result.current.expandAll();
    });
    expect(result.current.expandedIds.has('category:big')).toBe(true);
    expect(result.current.capacityNotice).toBeNull();
  });

  it('视口变小不再自动收起已展开层级（展开动作持久）', () => {
    const { result, rerender } = renderHook(
      ({ viewport }: { viewport: GraphViewportSize }) =>
        useKnowledgeGraphExpansion(graph, '', null, { viewportSize: viewport }),
      { initialProps: { viewport: LARGE_VIEWPORT } },
    );

    act(() => {
      result.current.toggleExpand('category:big');
    });
    expect(result.current.expandedIds.has('category:big')).toBe(true);

    act(() => {
      rerender({ viewport: SMALL_VIEWPORT });
    });

    expect(result.current.expandedIds.has('category:big')).toBe(true);
    expect(result.current.capacityNotice).toBeNull();
  });
});

describe('容量门控 · 纯谓词仍可独立评估（hook 不再消费）', () => {
  const graph = createExpansionFixture();
  const counts = computeDescendantCounts(graph);

  it('nodeExpansionBlocked 纯谓词仍按容量给出结论（供其它场景复用）', () => {
    const expandedIds = baseExpansion(graph);
    expect(
      nodeExpansionBlocked({
        counts,
        expandedIds,
        graph,
        nodeId: 'category:big',
        viewport: SMALL_VIEWPORT,
      }),
    ).toBe(true);
    expect(
      nodeExpansionBlocked({
        counts,
        expandedIds,
        graph,
        nodeId: 'category:small',
        viewport: SMALL_VIEWPORT,
      }),
    ).toBe(false);
    expect(
      nodeExpansionBlocked({
        counts,
        expandedIds,
        graph,
        nodeId: 'category:big',
        viewport: LARGE_VIEWPORT,
      }),
    ).toBe(false);
    expect(
      nodeExpansionBlocked({
        counts,
        expandedIds: mergeExpandedIds(expandedIds, new Set(['category:big'])),
        graph,
        nodeId: 'category:big',
        viewport: SMALL_VIEWPORT,
      }),
    ).toBe(false);
  });

  it('hook 级禁用谓词与拒绝集合恒为空（展开不再被阻塞）', () => {
    const { result, rerender } = renderHook(
      ({ viewport }: { viewport: GraphViewportSize }) =>
        useKnowledgeGraphExpansion(graph, '', null, { viewportSize: viewport }),
      { initialProps: { viewport: SMALL_VIEWPORT } },
    );

    act(() => {
      result.current.toggleExpand('category:big');
    });
    expect(result.current.isExpandBlocked('category:big')).toBe(false);
    expect(result.current.capacityBlockedIds.size).toBe(0);

    act(() => {
      rerender({ viewport: LARGE_VIEWPORT });
    });
    expect(result.current.isExpandBlocked('category:big')).toBe(false);
    expect(result.current.capacityBlockedIds.size).toBe(0);
    expect(result.current.capacityNotice).toBeNull();
  });
});

describe('容量门控 · 搜索调和', () => {
  const graph = createExpansionFixture();
  const counts = computeDescendantCounts(graph);

  it('手动展开大分组后，搜索仍能露出深层命中（命中链受保护）', () => {
    const matches = collectGraphSearchMatches(graph, '深层埋藏节点');
    expect(matches.kind).toBe('matches');
    const forceVisibleIds = matches.kind === 'matches' ? matches.matchedIds : undefined;

    const { result, rerender } = renderHook(
      ({ query }: { query: string }) =>
        useKnowledgeGraphExpansion(graph, query, null, { viewportSize: SMALL_VIEWPORT }),
      { initialProps: { query: '' } },
    );

    act(() => {
      result.current.toggleExpand('category:big');
    });
    expect(result.current.expandedIds.has('category:big')).toBe(true);

    act(() => {
      rerender({ query: '深层埋藏节点' });
    });

    const projection = projectVisibleGraph(graph, result.current.expandedIds, {
      counts,
      forceVisibleIds,
    });
    expect(projection.graph.nodes.some((entry) => entry.id === 'artifact:buried')).toBe(true);
    expect(autoExpansionForSearch(graph, '深层埋藏节点').has('category:big')).toBe(true);
  });
});

describe('容量与布局一致 · 声明合法即无盘重叠', () => {
  const graph = createExpansionFixture();
  const counts = computeDescendantCounts(graph);

  it('容量判定合法的展开态，布局输出的任意两盘都不相交', () => {
    const expandedIds = mergeExpandedIds(baseExpansion(graph), new Set(['category:small']));
    const verdict = evaluateExpansionCapacity({
      counts,
      expandedIds,
      graph,
      viewport: SMALL_VIEWPORT,
    });
    expect(verdict.checked).toBe(true);
    expect(verdict.legal).toBe(true);

    const projection = projectVisibleGraph(graph, expandedIds, { counts });
    const model = buildGraphModel(projection.graph, {
      collapsedIds: projection.collapsedIds,
      counts,
    });
    const positioned = layoutRadialTree(model, SMALL_VIEWPORT).map((entry) => ({
      drawn: nodeDrawnRadius(
        entry.model.collapsed === true,
        entry.model.descendantCount ?? 0,
        entry.radius,
      ),
      x: entry.x,
      y: entry.y,
    }));

    let worstOverlap = 0;
    for (let left = 0; left < positioned.length; left += 1) {
      for (let right = left + 1; right < positioned.length; right += 1) {
        const a = positioned[left];
        const b = positioned[right];
        if (!a || !b) {
          continue;
        }
        worstOverlap = Math.max(worstOverlap, a.drawn + b.drawn - Math.hypot(a.x - b.x, a.y - b.y));
      }
    }
    expect(worstOverlap).toBeLessThanOrEqual(1e-6);
  });
});
