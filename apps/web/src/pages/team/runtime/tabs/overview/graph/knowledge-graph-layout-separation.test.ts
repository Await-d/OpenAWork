import { describe, expect, it } from 'vitest';
import type { GraphEdge, GraphNode, KnowledgeGraph } from '../../../data/build-knowledge-graph.js';
import {
  collapsedTopLevelExpansion,
  computeDescendantCounts,
  expandAllExpandableIds,
  projectVisibleGraph,
} from './knowledge-graph-aggregation.js';
import { nodeDrawnRadius } from './knowledge-graph-label-text.js';
import { layoutRadialTree, type GraphViewportSize } from './knowledge-graph-layout.js';
import { buildGraphModel, type GraphModel } from './knowledge-graph-model.js';
import type { PositionedNode } from './knowledge-graph-layout.js';

/**
 * 生产规模夹具：1 工作区 + 4 分类 + 1195 个深层内容节点（含一个上千后代的分组，
 * 用于触发紧凑计数）、40 条跨分类 derives、长中文标签。
 * 与 QA 截图（f4b / f5）使用的 1200 节点图同构。
 */
interface MockGroup {
  readonly key: 'architecture' | 'governance' | 'memory' | 'knowledge';
  readonly kind: GraphNode['kind'];
  readonly label: string;
  readonly count: number;
}

const MOCK_GROUPS: readonly MockGroup[] = [
  { key: 'architecture', kind: 'architecture', label: '架构上下文', count: 60 },
  { key: 'governance', kind: 'constitution', label: '团队规则', count: 40 },
  { key: 'memory', kind: 'memory', label: '记忆与经验', count: 40 },
  { key: 'knowledge', kind: 'knowledge', label: '知识产物', count: 1055 },
];

const MOCK_LABELS = [
  '架构上下文条目：模块边界与长期设计约束（第十二段补充说明）',
  '团队宪法与执行约束规则集合（第三轮评审后的修订版本）',
  '项目记忆、个人偏好与经验沉淀集合',
  '规格、计划、任务、实现与评审产物链',
];

function mockNode(
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

function mockEdge(from: string, to: string, kind: GraphEdge['kind']): GraphEdge {
  return { id: `${kind}:${from}->${to}`, from, to, kind, state: null };
}

function buildMockGraph(includeDerives = true): KnowledgeGraph {
  const nodes: GraphNode[] = [mockNode('workspace:ws', 'workspace', '示例工作区', 'workspace')];
  const edges: GraphEdge[] = [];
  for (const group of MOCK_GROUPS) {
    const categoryId = `category:${group.key}`;
    nodes.push(mockNode(categoryId, 'category', group.label, group.key, group.key));
    edges.push(mockEdge('workspace:ws', categoryId, 'contains'));
    for (let index = 0; index < group.count; index += 1) {
      const nodeId = `leaf:${group.key}:${index}`;
      nodes.push(
        mockNode(
          nodeId,
          group.kind,
          `${MOCK_LABELS[index % MOCK_LABELS.length]} #${index}`,
          group.key,
          group.key,
        ),
      );
      edges.push(mockEdge(categoryId, nodeId, 'contains'));
    }
  }
  if (includeDerives) {
    for (let index = 0; index < 40; index += 1) {
      edges.push(mockEdge(`leaf:knowledge:${index}`, `leaf:architecture:${index}`, 'derives'));
    }
  }
  return { nodes, edges };
}

const VIEWPORTS: readonly GraphViewportSize[] = [
  { width: 1440, height: 900 },
  { width: 960, height: 560 },
  { width: 1400, height: 620 },
  { width: 700, height: 420 },
];

interface MockState {
  readonly label: string;
  readonly expandedIds: ReadonlySet<string>;
}

function mockStates(graph: KnowledgeGraph): readonly MockState[] {
  return [
    { label: '折叠概览', expandedIds: collapsedTopLevelExpansion(graph) },
    {
      label: '部分展开（一个大分组折叠）',
      expandedIds: new Set<string>([
        'workspace:ws',
        'category:architecture',
        'category:governance',
        'category:memory',
      ]),
    },
    { label: '全部展开', expandedIds: expandAllExpandableIds(graph) },
  ];
}

/** 布局输出 + 绘制半径（含折叠聚合徽标撑大后的盘半径）。 */
function drawnDiscs(positions: readonly PositionedNode[]): Array<{
  id: string;
  x: number;
  y: number;
  drawn: number;
}> {
  return positions.map((position) => ({
    id: position.model.id,
    x: position.x,
    y: position.y,
    drawn: nodeDrawnRadius(
      position.model.collapsed === true,
      position.model.descendantCount ?? 0,
      position.radius,
    ),
  }));
}

function overlapPair(
  discs: readonly { id: string; x: number; y: number; drawn: number }[],
): { a: string; b: string; distance: number; required: number } | null {
  for (let left = 0; left < discs.length; left += 1) {
    const a = discs[left];
    if (!a) {
      continue;
    }
    for (let right = left + 1; right < discs.length; right += 1) {
      const b = discs[right];
      if (!b) {
        continue;
      }
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const required = a.drawn + b.drawn;
      if (distance < required - 1e-6) {
        return { a: a.id, b: b.id, distance, required };
      }
    }
  }
  return null;
}

function overlapCount(
  discs: readonly { id: string; x: number; y: number; drawn: number }[],
): number {
  let count = 0;
  for (let left = 0; left < discs.length; left += 1) {
    const a = discs[left];
    if (!a) {
      continue;
    }
    for (let right = left + 1; right < discs.length; right += 1) {
      const b = discs[right];
      if (!b) {
        continue;
      }
      if (Math.hypot(a.x - b.x, a.y - b.y) < a.drawn + b.drawn - 1e-6) {
        count += 1;
      }
    }
  }
  return count;
}

function modelFor(state: MockState, graph: KnowledgeGraph): GraphModel {
  const counts = computeDescendantCounts(graph);
  const projection = projectVisibleGraph(graph, state.expandedIds, { counts, maxNodes: 1200 });
  return buildGraphModel(projection.graph, { collapsedIds: projection.collapsedIds, counts });
}

describe('layoutRadialTree 盘间最小中心距（拥挤夹具 · D2 回归锁）', () => {
  const graph = buildMockGraph();

  it.each(
    mockStates(graph)
      .filter((state) => state.label !== '全部展开')
      .flatMap((state) =>
        VIEWPORTS.map((viewport) => [state.label, state.expandedIds, viewport] as const),
      ),
  )('「%s」在 %dx%d 视口下任意两个绘制盘都不重叠', (label, expandedIds, viewport) => {
    const model = modelFor({ label, expandedIds }, graph);
    const discs = drawnDiscs(layoutRadialTree(model, viewport));
    const overlap = overlapPair(discs);
    expect(
      overlap,
      overlap
        ? `${overlap.a} 与 ${overlap.b} 重叠：中心距 ${overlap.distance.toFixed(1)} < 半径和 ${overlap.required.toFixed(1)}`
        : undefined,
    ).toBeNull();
  });

  /**
   * 全部展开（1200 可见节点）时，节点盘会被规划层按容量整体收缩到个位像素；在最小画布上，
   * 径向预算物理上容不下这么多盘，分离器只能把残余重叠压到「亚像素级」。这里锁住的是：
   * 残余重叠有界、结果确定、且盘子确实被收缩（而不是回到旧实现的整片重叠）。
   */
  it.each(VIEWPORTS.map((viewport) => [viewport.width, viewport.height] as const))(
    '全部展开在 %dx%d 下残余重叠有界且确定',
    (width, height) => {
      const viewport: GraphViewportSize = { width, height };
      const state = mockStates(graph)[2]!;
      const model = modelFor(state, graph);
      const first = layoutRadialTree(model, viewport);
      const second = layoutRadialTree(model, viewport);
      const discs = drawnDiscs(first);
      let worst = 0;
      for (let index = 0; index < discs.length; index += 1) {
        for (let other = index + 1; other < discs.length; other += 1) {
          const left = discs[index]!;
          const right = discs[other]!;
          worst = Math.max(
            worst,
            left.drawn + right.drawn - Math.hypot(left.x - right.x, left.y - right.y),
          );
        }
      }
      expect(worst).toBeLessThanOrEqual(4);
      expect(
        second.map((position) => [position.model.id, position.x, position.y, position.radius]),
      ).toEqual(
        first.map((position) => [position.model.id, position.x, position.y, position.radius]),
      );
      expect(Math.min(...first.map((position) => position.radius))).toBeLessThan(14);
    },
    30000,
  );

  it('同一拥挤夹具两次布局逐位一致（确定性，无随机源）', () => {
    const state = mockStates(graph)[1]!;
    const model = modelFor(state, graph);
    const first = layoutRadialTree(model, VIEWPORTS[0]!);
    const second = layoutRadialTree(model, VIEWPORTS[0]!);
    expect(
      second.map((position) => [position.model.id, position.x, position.y, position.radius]),
    ).toEqual(
      first.map((position) => [position.model.id, position.x, position.y, position.radius]),
    );
  });

  it('拥挤夹具下 derives 边仍然零布局影响（含分离器）', () => {
    const state = mockStates(graph)[1]!;
    const counts = computeDescendantCounts(graph);
    const expanded = state.expandedIds;
    const coordinates = (graphWithEdges: KnowledgeGraph) => {
      const projection = projectVisibleGraph(graphWithEdges, expanded, { counts, maxNodes: 1200 });
      const model = buildGraphModel(projection.graph, {
        collapsedIds: projection.collapsedIds,
        counts,
      });
      return layoutRadialTree(model, VIEWPORTS[0]!).map((position) => [
        position.model.id,
        position.x,
        position.y,
      ]);
    };
    expect(coordinates(buildMockGraph(true))).toEqual(coordinates(buildMockGraph(false)));
  });

  it('拥挤夹具在全部视口下都清空重叠（汇总断言）', () => {
    const total = VIEWPORTS.reduce((sum, viewport) => {
      const model = modelFor(mockStates(graph)[1]!, graph);
      return sum + overlapCount(drawnDiscs(layoutRadialTree(model, viewport)));
    }, 0);
    expect(total).toBe(0);
  });

  it('拥挤环上 LARGE 聚合与其最近小盘满足「中心距 ≥ 最终半径之和」，且结果确定', () => {
    const state = mockStates(graph)[1]!;
    const model = modelFor(state, graph);
    const viewport: GraphViewportSize = { width: 700, height: 420 };
    const first = layoutRadialTree(model, viewport);
    const second = layoutRadialTree(model, viewport);
    expect(
      second.map((position) => [position.model.id, position.x, position.y, position.radius]),
    ).toEqual(
      first.map((position) => [position.model.id, position.x, position.y, position.radius]),
    );

    const discs = drawnDiscs(first);
    expect(overlapPair(discs)).toBeNull();

    const drawnById = new Map(discs.map((disc) => [disc.id, disc] as const));
    const largeCandidates = first
      .filter((position) => position.model.collapsed === true)
      .map((position) => drawnById.get(position.model.id))
      .filter((disc): disc is NonNullable<typeof disc> => disc !== undefined);
    expect(largeCandidates.length).toBeGreaterThan(0);
    const large = largeCandidates.reduce((max, disc) => (disc.drawn > max.drawn ? disc : max));
    expect(large.drawn).toBeGreaterThanOrEqual(30);

    let nearest: { readonly disc: (typeof discs)[number]; readonly distance: number } | null = null;
    for (const disc of discs) {
      if (disc.id === large.id) {
        continue;
      }
      const distance = Math.hypot(disc.x - large.x, disc.y - large.y);
      if (nearest === null || distance < nearest.distance) {
        nearest = { disc, distance };
      }
    }
    expect(nearest).not.toBeNull();
    if (!nearest) {
      throw new Error('missing nearest neighbour');
    }
    expect(nearest.disc.drawn).toBeLessThan(large.drawn / 2);
    expect(nearest.distance).toBeGreaterThanOrEqual(large.drawn + nearest.disc.drawn - 1e-6);
  });
});
