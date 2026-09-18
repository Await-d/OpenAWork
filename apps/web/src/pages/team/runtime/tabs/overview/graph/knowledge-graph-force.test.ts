import { describe, expect, it } from 'vitest';
import type { GraphEdge, GraphNode, KnowledgeGraph } from '../../../data/build-knowledge-graph.js';
import {
  buildSpatialHash,
  layoutForceDirected,
  queryNeighbours,
  reheatForceNeighbourhood,
  worstDrawnOverlap,
} from './knowledge-graph-force.js';
import {
  COLLISION_DISTANCE_RATIO,
  layoutRadialTree,
  type GraphViewportSize,
  type PositionedNode,
} from './knowledge-graph-layout.js';
import { buildGraphModel, type GraphModel } from './knowledge-graph-model.js';
import { EMPTY_GRAPH_PINS, recordGraphPins, type GraphPinMap } from './knowledge-graph-pins.js';

const VIEWPORT: GraphViewportSize = { width: 1200, height: 760 };
/** 规模化夹具（244 节点）需要更宽裕的画布，否则触底的是视口面积而非求解器。 */
const WIDE_VIEWPORT: GraphViewportSize = { width: 1800, height: 1100 };
/** 碰撞是软力而非硬投影，稳态容许亚像素级残差（px）。 */
const SETTLED_DISTANCE_EPSILON = 0.25;

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

/** 两个分组、各 15 个叶子的夹具：用于验证「同组更近」的分组内聚。 */
function createTwoGroupFixture(): KnowledgeGraph {
  const nodes: GraphNode[] = [
    node('workspace:ws', 'workspace', '示例工作区', 'workspace'),
    node('category:architecture', 'category', '架构上下文', 'architecture', 'architecture'),
    node('category:memory', 'category', '记忆与经验', 'memory', 'memory'),
  ];
  const edges: GraphEdge[] = [
    edge('workspace:ws', 'category:architecture', 'contains'),
    edge('workspace:ws', 'category:memory', 'contains'),
  ];
  for (let index = 0; index < 15; index += 1) {
    const archId = `leaf:architecture:${index}`;
    nodes.push(node(archId, 'architecture', `架构条目 ${index}`, 'architecture', 'architecture'));
    edges.push(edge('category:architecture', archId, 'contains'));
    const memId = `leaf:memory:${index}`;
    nodes.push(node(memId, 'memory', `记忆条目 ${index}`, 'memory', 'memory'));
    edges.push(edge('category:memory', memId, 'contains'));
  }
  return { nodes, edges };
}

/** 1 工作区 + 4 分类 + 240 叶子的规模化夹具。 */
function createWideFixture(): KnowledgeGraph {
  const groups: ReadonlyArray<{ key: GraphNode['group']; count: number }> = [
    { key: 'architecture', count: 60 },
    { key: 'governance', count: 60 },
    { key: 'memory', count: 60 },
    { key: 'knowledge', count: 60 },
  ];
  const nodes: GraphNode[] = [node('workspace:ws', 'workspace', '示例工作区', 'workspace')];
  const edges: GraphEdge[] = [];
  for (const group of groups) {
    const categoryId = `category:${group.key}`;
    nodes.push(node(categoryId, 'category', `${group.key} 分类`, group.key, group.key));
    edges.push(edge('workspace:ws', categoryId, 'contains'));
    for (let index = 0; index < group.count; index += 1) {
      const id = `leaf:${group.key}:${index}`;
      nodes.push(node(id, 'artifact', `产物 ${index}`, group.key, 'spec'));
      edges.push(edge(categoryId, id, 'contains'));
    }
  }
  for (let index = 0; index < 30; index += 1) {
    edges.push(edge(`leaf:knowledge:${index}`, `leaf:architecture:${index}`, 'derives'));
  }
  return { nodes, edges };
}

/**
 * 展开架构分类后的可见子图（125 节点：1 工作区 + 4 分类 + 120 个同层后代），
 * 与生产投影路径同形（3 个未展开分类带隐藏计数徽标）：用于复现「展开后的密集簇」。
 */
function createExpandedClusterFixture(): KnowledgeGraph {
  const nodes: GraphNode[] = [node('workspace:ws', 'workspace', '示例工作区', 'workspace')];
  const edges: GraphEdge[] = [];
  const groups: ReadonlyArray<GraphNode['group']> = [
    'architecture',
    'governance',
    'memory',
    'knowledge',
  ];
  for (const group of groups) {
    const categoryId = `category:${group}`;
    nodes.push(node(categoryId, 'category', `${group} 分类`, group, group));
    edges.push(edge('workspace:ws', categoryId, 'contains'));
  }
  const architectureId = 'category:architecture';
  for (let index = 0; index < 106; index += 1) {
    const id = `content:architecture:${index}`;
    nodes.push(node(id, 'architecture', `架构条目 ${index}`, 'architecture', 'architecture'));
    edges.push(edge(architectureId, id, 'contains'));
  }
  for (let phase = 0; phase < 7; phase += 1) {
    const phaseId = `phase:architecture:${phase}`;
    nodes.push(node(phaseId, 'artifact', `阶段产物 ${phase}`, 'architecture', `phase-${phase}`));
    edges.push(edge(architectureId, phaseId, 'contains'));
    const artifactId = `artifact:architecture:${phase}`;
    nodes.push(node(artifactId, 'artifact', `产物 ${phase}`, 'architecture', `phase-${phase}`));
    edges.push(edge(phaseId, artifactId, 'contains'));
  }
  return { nodes, edges };
}

const EXPANDED_CLUSTER_VIEWPORT: GraphViewportSize = { width: 1600, height: 1000 };

function expandedClusterModel(): GraphModel {
  const graph = createExpandedClusterFixture();
  return buildGraphModel(graph, {
    collapsedIds: new Set(['category:governance', 'category:memory', 'category:knowledge']),
    counts: new Map([
      ['workspace:ws', 1095],
      ['category:governance', 365],
      ['category:memory', 365],
      ['category:knowledge', 365],
    ]),
  });
}

function seedFor(
  graph: KnowledgeGraph,
  viewport: GraphViewportSize = VIEWPORT,
): { model: GraphModel; seed: readonly PositionedNode[] } {
  const model = buildGraphModel(graph);
  return { model, seed: layoutRadialTree(model, viewport) };
}

function coordinates(positions: readonly PositionedNode[]): Array<[string, number, number]> {
  return positions.map((entry) => [entry.model.id, entry.x, entry.y]);
}

function distance(left: PositionedNode, right: PositionedNode): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function meanPairwise(entries: readonly PositionedNode[]): number {
  let total = 0;
  let count = 0;
  for (let left = 0; left < entries.length; left += 1) {
    for (let right = left + 1; right < entries.length; right += 1) {
      total += distance(entries[left]!, entries[right]!);
      count += 1;
    }
  }
  return count > 0 ? total / count : 0;
}

describe('layoutForceDirected · 确定性', () => {
  it('相同输入两次解算得到逐位相同的坐标', () => {
    const { model, seed } = seedFor(createTwoGroupFixture());
    const first = layoutForceDirected(seed, model, VIEWPORT, EMPTY_GRAPH_PINS);
    const second = layoutForceDirected(seed, model, VIEWPORT, EMPTY_GRAPH_PINS);
    expect(coordinates(second)).toEqual(coordinates(first));
  });

  it('规模化夹具同样逐位一致', () => {
    const { model, seed } = seedFor(createWideFixture(), WIDE_VIEWPORT);
    const first = layoutForceDirected(seed, model, WIDE_VIEWPORT, EMPTY_GRAPH_PINS);
    const second = layoutForceDirected(seed, model, WIDE_VIEWPORT, EMPTY_GRAPH_PINS);
    expect(coordinates(second)).toEqual(coordinates(first));
  });
});

describe('layoutForceDirected · 收敛与重叠', () => {
  it('从 settle 态再解算几乎不动（已到不动点附近）', () => {
    const { model, seed } = seedFor(createTwoGroupFixture());
    const settled = layoutForceDirected(seed, model, VIEWPORT, EMPTY_GRAPH_PINS);
    const again = layoutForceDirected(settled, model, VIEWPORT, EMPTY_GRAPH_PINS);
    const byId = new Map(again.map((entry) => [entry.model.id, entry]));
    let worst = 0;
    for (const entry of settled) {
      const next = byId.get(entry.model.id);
      if (!next) {
        throw new Error(`missing settled position ${entry.model.id}`);
      }
      worst = Math.max(worst, Math.hypot(next.x - entry.x, next.y - entry.y));
    }
    expect(worst).toBeLessThan(2);
  });

  it('可见盘不重叠（规模化夹具）', () => {
    const { model, seed } = seedFor(createWideFixture(), WIDE_VIEWPORT);
    const positions = layoutForceDirected(seed, model, WIDE_VIEWPORT, EMPTY_GRAPH_PINS);
    expect(worstDrawnOverlap(positions)).toBeLessThanOrEqual(1.5);
  });

  it('全部坐标落在视口内', () => {
    const { model, seed } = seedFor(createTwoGroupFixture());
    const positions = layoutForceDirected(seed, model, VIEWPORT, EMPTY_GRAPH_PINS);
    for (const entry of positions) {
      expect(entry.x).toBeGreaterThanOrEqual(0);
      expect(entry.x).toBeLessThanOrEqual(VIEWPORT.width);
      expect(entry.y).toBeGreaterThanOrEqual(0);
      expect(entry.y).toBeLessThanOrEqual(VIEWPORT.height);
    }
  });
});

describe('layoutForceDirected · 碰撞最小中心距', () => {
  it('系数落在 (0, 1]：0 等于放弃分离，>1 会把旧轮盘的刚性拉回来', () => {
    expect(COLLISION_DISTANCE_RATIO).toBeGreaterThan(0);
    expect(COLLISION_DISTANCE_RATIO).toBeLessThanOrEqual(1);
  });

  it('密集簇：每对已 settle 盘的圆心距都不低于 ratio × (r1 + r2)', () => {
    const model = expandedClusterModel();
    const seed = layoutRadialTree(model, EXPANDED_CLUSTER_VIEWPORT, EMPTY_GRAPH_PINS);
    const positions = layoutForceDirected(seed, model, EXPANDED_CLUSTER_VIEWPORT, EMPTY_GRAPH_PINS);
    expect(positions.length).toBe(125);
    for (let left = 0; left < positions.length; left += 1) {
      for (let right = left + 1; right < positions.length; right += 1) {
        const a = positions[left]!;
        const b = positions[right]!;
        const floor = COLLISION_DISTANCE_RATIO * (a.radius + b.radius);
        expect(Math.hypot(a.x - b.x, a.y - b.y) + SETTLED_DISTANCE_EPSILON).toBeGreaterThanOrEqual(
          floor,
        );
      }
    }
  });

  it('密集簇：逐位确定，且结果始终被钳在视口内（拥挤时以有界极限环冻结，不漂出画布）', () => {
    const model = expandedClusterModel();
    const seed = layoutRadialTree(model, EXPANDED_CLUSTER_VIEWPORT, EMPTY_GRAPH_PINS);
    const first = layoutForceDirected(seed, model, EXPANDED_CLUSTER_VIEWPORT, EMPTY_GRAPH_PINS);
    const second = layoutForceDirected(seed, model, EXPANDED_CLUSTER_VIEWPORT, EMPTY_GRAPH_PINS);
    expect(coordinates(second)).toEqual(coordinates(first));

    const again = layoutForceDirected(first, model, EXPANDED_CLUSTER_VIEWPORT, EMPTY_GRAPH_PINS);
    const byId = new Map(again.map((entry) => [entry.model.id, entry]));
    for (const entry of first) {
      expect(byId.get(entry.model.id)).toBeDefined();
    }
    for (const entry of again) {
      expect(entry.x).toBeGreaterThanOrEqual(0);
      expect(entry.x).toBeLessThanOrEqual(EXPANDED_CLUSTER_VIEWPORT.width);
      expect(entry.y).toBeGreaterThanOrEqual(0);
      expect(entry.y).toBeLessThanOrEqual(EXPANDED_CLUSTER_VIEWPORT.height);
    }
  });
});

describe('layoutForceDirected · 分组内聚', () => {
  it('同组节点的平均间距显著小于跨组平均间距', () => {
    const { model, seed } = seedFor(createTwoGroupFixture());
    const positions = layoutForceDirected(seed, model, VIEWPORT, EMPTY_GRAPH_PINS);
    const architectural = positions.filter((entry) => entry.model.group === 'architecture');
    const memory = positions.filter((entry) => entry.model.group === 'memory');
    expect(architectural.length).toBeGreaterThan(1);
    expect(memory.length).toBeGreaterThan(1);

    const withinArchitectural = meanPairwise(architectural);
    const withinMemory = meanPairwise(memory);
    let crossTotal = 0;
    let crossCount = 0;
    for (const left of architectural) {
      for (const right of memory) {
        crossTotal += distance(left, right);
        crossCount += 1;
      }
    }
    const cross = crossTotal / crossCount;
    expect(withinArchitectural).toBeLessThan(cross);
    expect(withinMemory).toBeLessThan(cross);
  });
});

describe('layoutForceDirected · 固定点', () => {
  it('被 pin 的节点坐标逐位等于 pin，且不被分离器移动', () => {
    const { model, seed } = seedFor(createTwoGroupFixture());
    const pinnedId = 'leaf:architecture:0';
    const pins: GraphPinMap = recordGraphPins(EMPTY_GRAPH_PINS, [{ id: pinnedId, x: 111, y: 222 }]);
    const positions = layoutForceDirected(seed, model, VIEWPORT, pins);
    const pinned = positions.find((entry) => entry.model.id === pinnedId);
    expect(pinned).toBeDefined();
    expect(pinned?.x).toBe(111);
    expect(pinned?.y).toBe(222);
  });

  it('reheat 不返回被拖节点本身，但会移动其邻域', () => {
    const { model, seed } = seedFor(createTwoGroupFixture());
    const settled = layoutForceDirected(seed, model, VIEWPORT, EMPTY_GRAPH_PINS);
    const live = new Map(settled.map((entry) => [entry.model.id, { x: entry.x, y: entry.y }]));
    const draggedId = 'leaf:architecture:0';
    const dragged = live.get(draggedId);
    if (!dragged) {
      throw new Error('missing dragged position');
    }
    live.set(draggedId, { x: dragged.x + 60, y: dragged.y + 40 });

    const moved = reheatForceNeighbourhood({
      model,
      viewport: VIEWPORT,
      pins: EMPTY_GRAPH_PINS,
      positions: live,
      dragId: draggedId,
    });

    expect(moved.has(draggedId)).toBe(false);
    expect(moved.size).toBeGreaterThan(0);
    let changed = 0;
    for (const [id, target] of moved) {
      const current = live.get(id);
      if (current && Math.hypot(target.x - current.x, target.y - current.y) > 0.1) {
        changed += 1;
      }
    }
    expect(changed).toBeGreaterThan(0);
  });
});

describe('空间哈希 · 邻居查询', () => {
  it('查询结果与小规模暴力枚举完全一致', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 40, y: 0 },
      { x: 41, y: 2 },
      { x: 200, y: 200 },
      { x: -30, y: 30 },
    ];
    const hash = buildSpatialHash(points, 20);
    const radius = 32;
    for (let index = 0; index < points.length; index += 1) {
      const origin = points[index]!;
      const brute = points
        .map((point, other) => ({ point, other }))
        .filter(
          ({ point, other }) =>
            other !== index && Math.hypot(point.x - origin.x, point.y - origin.y) <= radius,
        )
        .map(({ other }) => other)
        .sort((left, right) => left - right);
      const viaHash = queryNeighbours(hash, points, index, radius).sort(
        (left, right) => left - right,
      );
      expect(viaHash).toEqual(brute);
    }
  });

  it('半径 0 不返回任何邻居；远距离节点不入桶邻域', () => {
    const points = Array.from({ length: 12 }, (_, index) => ({ x: index * 50, y: 0 }));
    const hash = buildSpatialHash(points, 60);
    const neighbours = queryNeighbours(hash, points, 0, 50);
    expect(neighbours).toEqual([1]);
    expect(queryNeighbours(hash, points, 0, 0)).toEqual([]);
  });
});
