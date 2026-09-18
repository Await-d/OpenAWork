import { describe, expect, it } from 'vitest';
import type { GraphEdge, GraphNode, KnowledgeGraph } from '../../../data/build-knowledge-graph.js';
import {
  GRAPH_EDGE_MARGIN,
  GRAPH_VIEW_HEIGHT,
  GRAPH_VIEW_WIDTH,
  ORGANIC_ANGLE_JITTER,
  ORGANIC_RADIAL_JITTER_SHARE,
  RING_RADIUS_VARIATION,
  layoutRadialTree,
  nodeRadiusFor,
  seededUnit,
  type GraphViewportSize,
  type PositionedNode,
} from './knowledge-graph-layout.js';
import { buildGraphModel } from './knowledge-graph-model.js';
import { EMPTY_GRAPH_PINS, clearGraphPins, recordGraphPins } from './knowledge-graph-pins.js';

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

function coordinates(positions: readonly PositionedNode[]): Array<{
  id: string;
  radius: number;
  x: number;
  y: number;
}> {
  return positions.map((position) => ({
    id: position.model.id,
    radius: position.radius,
    x: position.x,
    y: position.y,
  }));
}

function positionById(positions: readonly PositionedNode[]): Map<string, PositionedNode> {
  const map = new Map<string, PositionedNode>();
  for (const position of positions) {
    map.set(position.model.id, position);
  }
  return map;
}

const VIEWPORT: GraphViewportSize = { width: GRAPH_VIEW_WIDTH, height: GRAPH_VIEW_HEIGHT };
const MAX_RADIUS = Math.min(VIEWPORT.width, VIEWPORT.height) / 2 - GRAPH_EDGE_MARGIN;

describe('nodeRadiusFor', () => {
  it('按节点类型与持久化状态返回文档化半径', () => {
    expect(nodeRadiusFor('workspace', false)).toBe(30);
    expect(nodeRadiusFor('workspace', true)).toBe(30);
    expect(nodeRadiusFor('category', false)).toBe(19);
    expect(nodeRadiusFor('artifact', false)).toBe(13);
    expect(nodeRadiusFor('artifact', true)).toBe(15);
    expect(nodeRadiusFor('memory', false)).toBe(14);
    expect(nodeRadiusFor('memory', true)).toBe(16);
    expect(nodeRadiusFor('knowledge', false)).toBe(14);
    expect(nodeRadiusFor('architecture', true)).toBe(16);
    expect(nodeRadiusFor('constitution', false)).toBe(14);
  });
});

describe('layoutRadialTree', () => {
  it('derives 边不改变任何输出坐标（验收测试）', () => {
    const withDerives = buildGraphModel(createNestedFixture(true));
    const withoutDerives = buildGraphModel(createNestedFixture(false));
    expect(coordinates(layoutRadialTree(withDerives, VIEWPORT))).toEqual(
      coordinates(layoutRadialTree(withoutDerives, VIEWPORT)),
    );
  });

  it('根的直接子节点均分角度扇区，叶子多的分组不再独占', () => {
    const model = buildGraphModel(createNestedFixture(false));
    const byId = positionById(layoutRadialTree(model, VIEWPORT));
    const angleOf = (id: string): number => {
      const position = byId.get(id);
      if (!position) {
        throw new Error(`missing position ${id}`);
      }
      return Math.atan2(position.y - VIEWPORT.height / 2, position.x - VIEWPORT.width / 2);
    };
    // 该夹具中 knowledge 的叶子远多于 architecture / memory；均分后三个分组扇区应大致等宽。
    const sorted = ['category:architecture', 'category:knowledge', 'category:memory']
      .map(angleOf)
      .sort((left, right) => left - right);
    const gaps = [
      (sorted[1] ?? 0) - (sorted[0] ?? 0),
      (sorted[2] ?? 0) - (sorted[1] ?? 0),
      (sorted[0] ?? 0) + Math.PI * 2 - (sorted[2] ?? 0),
    ];
    const minGap = Math.min(...gaps);
    const maxGap = Math.max(...gaps);
    expect(minGap).toBeGreaterThan(0);
    expect(maxGap - minGap).toBeLessThan(0.5);
  });

  it('每个节点恰好出现一次且不存在重复坐标', () => {
    const model = buildGraphModel(createNestedFixture(true));
    const positions = layoutRadialTree(model, VIEWPORT);
    expect(positions).toHaveLength(model.nodes.length);
    expect(new Set(positions.map((position) => position.model.id)).size).toBe(model.nodes.length);
    expect(new Set(positions.map((position) => `${position.x},${position.y}`)).size).toBe(
      model.nodes.length,
    );
  });

  it('两次调用产生完全一致的输出（确定性）', () => {
    const model = buildGraphModel(createNestedFixture(true));
    expect(coordinates(layoutRadialTree(model, VIEWPORT))).toEqual(
      coordinates(layoutRadialTree(model, VIEWPORT)),
    );
  });

  it('层级越深环半径越大，根节点位于圆心', () => {
    const model = buildGraphModel(createNestedFixture(false));
    const byId = positionById(layoutRadialTree(model, VIEWPORT));
    const center = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
    const root = byId.get('workspace:current');
    if (!root) {
      throw new Error('missing workspace position');
    }
    expect(root.x).toBeCloseTo(center.x, 6);
    expect(root.y).toBeCloseTo(center.y, 6);

    const depthRadius = (id: string): number => {
      const position = byId.get(id);
      if (!position) {
        throw new Error(`missing position ${id}`);
      }
      return Math.hypot(position.x - center.x, position.y - center.y);
    };
    expect(depthRadius('category:knowledge')).toBeLessThan(depthRadius('artifact:spec-1'));
    expect(depthRadius('artifact:spec-1')).toBeLessThan(depthRadius('artifact:review-1'));
    expect(depthRadius('artifact:review-1')).toBeCloseTo(MAX_RADIUS, 6);
  });

  it('游离节点落在最外环且不与树重叠', () => {
    const graph = createNestedFixture(false);
    const model = buildGraphModel({
      nodes: [
        ...graph.nodes,
        createNode({ id: 'orphan:1', kind: 'knowledge', label: '游离', group: 'knowledge' }),
      ],
      edges: graph.edges,
    });
    const positions = layoutRadialTree(model, VIEWPORT);
    const byId = positionById(positions);
    const orphan = byId.get('orphan:1');
    if (!orphan) {
      throw new Error('missing orphan position');
    }
    const distance = Math.hypot(orphan.x - VIEWPORT.width / 2, orphan.y - VIEWPORT.height / 2);
    expect(distance).toBeCloseTo(MAX_RADIUS, 6);
    expect(new Set(positions.map((position) => `${position.x},${position.y}`)).size).toBe(
      model.nodes.length,
    );
  });

  it('仅 workspace 单节点时位于圆心', () => {
    const model = buildGraphModel({
      nodes: [
        createNode({
          id: 'workspace:current',
          kind: 'workspace',
          label: '工作区',
          group: 'workspace',
        }),
      ],
      edges: [],
    });
    const positions = layoutRadialTree(model, VIEWPORT);
    expect(positions).toHaveLength(1);
    const only = positions[0];
    if (!only) {
      throw new Error('missing position');
    }
    expect(only.x).toBe(VIEWPORT.width / 2);
    expect(only.y).toBe(VIEWPORT.height / 2);
  });

  it('圆心与半径预算随视口尺寸变化，大容器不再坍缩到左上角', () => {
    const model = buildGraphModel(createNestedFixture(false));
    const viewport: GraphViewportSize = { width: 1400, height: 620 };
    const expectedMaxRadius = Math.min(viewport.width, viewport.height) / 2 - GRAPH_EDGE_MARGIN;
    const byId = positionById(layoutRadialTree(model, viewport));
    const root = byId.get('workspace:current');
    const outer = byId.get('artifact:review-1');
    if (!root || !outer) {
      throw new Error('missing position');
    }
    expect(root.x).toBeCloseTo(700, 6);
    expect(root.y).toBeCloseTo(310, 6);
    expect(Math.hypot(outer.x - 700, outer.y - 310)).toBeCloseTo(expectedMaxRadius, 6);
  });

  it('视口小于布局基准时外环仍完整落在容器内（不被裁切）', () => {
    const model = buildGraphModel(createNestedFixture(false));
    const viewport: GraphViewportSize = { width: 420, height: 360 };
    const expectedMaxRadius = Math.min(viewport.width, viewport.height) / 2 - GRAPH_EDGE_MARGIN;
    for (const position of layoutRadialTree(model, viewport)) {
      expect(position.x).toBeGreaterThanOrEqual(0);
      expect(position.x).toBeLessThanOrEqual(viewport.width);
      expect(position.y).toBeGreaterThanOrEqual(0);
      expect(position.y).toBeLessThanOrEqual(viewport.height);
    }
    const byId = positionById(layoutRadialTree(model, viewport));
    const outer = byId.get('artifact:review-1');
    if (!outer) {
      throw new Error('missing position');
    }
    expect(Math.hypot(outer.x - viewport.width / 2, outer.y - viewport.height / 2)).toBeCloseTo(
      expectedMaxRadius,
      6,
    );
  });

  it('未测量视口（0×0）回退逻辑基准，不产生 NaN', () => {
    const model = buildGraphModel(createNestedFixture(false));
    const byId = positionById(layoutRadialTree(model, { width: 0, height: 0 }));
    const root = byId.get('workspace:current');
    if (!root) {
      throw new Error('missing position');
    }
    expect(root.x).toBe(GRAPH_VIEW_WIDTH / 2);
    expect(root.y).toBe(GRAPH_VIEW_HEIGHT / 2);
  });
});

describe('seededUnit', () => {
  it('相同输入得到相同结果，且始终落在 [0, 1)', () => {
    const samples = ['workspace:current', 'artifact:spec-1', 'ring:2', 'angle:知识'];
    for (const seed of samples) {
      const first = seededUnit(seed);
      expect(first).toBe(seededUnit(seed));
      expect(first).toBeGreaterThanOrEqual(0);
      expect(first).toBeLessThan(1);
    }
    expect(new Set(samples.map((seed) => seededUnit(seed))).size).toBe(samples.length);
  });
});

describe('layoutRadialTree 有机偏移', () => {
  it('两次调用完全一致（确定性），且与 organic:false 的机械基线不同', () => {
    const model = buildGraphModel(createNestedFixture(true));
    const organic = coordinates(layoutRadialTree(model, VIEWPORT));
    expect(coordinates(layoutRadialTree(model, VIEWPORT))).toEqual(organic);
    expect(organic).not.toEqual(
      coordinates(layoutRadialTree(model, VIEWPORT, EMPTY_GRAPH_PINS, { organic: false })),
    );
  });

  it('角度偏移不超过文档上限，半径偏移不超过相邻环间距的文档比例', () => {
    const model = buildGraphModel(createNestedFixture(true));
    const center = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
    const pure = positionById(
      layoutRadialTree(model, VIEWPORT, EMPTY_GRAPH_PINS, { organic: false }),
    );
    const organic = positionById(layoutRadialTree(model, VIEWPORT));

    const ringRadiusByDepth = new Map<number, number>();
    ringRadiusByDepth.set(0, 0);
    for (const node of model.nodes) {
      if (node.depth <= 0 || node.depth > model.maxDepth) {
        continue;
      }
      const position = pure.get(node.id);
      if (!position) {
        throw new Error(`missing pure position ${node.id}`);
      }
      ringRadiusByDepth.set(node.depth, Math.hypot(position.x - center.x, position.y - center.y));
    }

    for (const node of model.nodes) {
      const basePosition = pure.get(node.id);
      const organicPosition = organic.get(node.id);
      if (!basePosition || !organicPosition) {
        throw new Error(`missing position ${node.id}`);
      }
      const baseRadius = Math.hypot(basePosition.x - center.x, basePosition.y - center.y);
      const organicRadius = Math.hypot(organicPosition.x - center.x, organicPosition.y - center.y);

      if (baseRadius > 1e-6) {
        const baseAngle = Math.atan2(basePosition.y - center.y, basePosition.x - center.x);
        const organicAngle = Math.atan2(organicPosition.y - center.y, organicPosition.x - center.x);
        const delta = Math.atan2(
          Math.sin(organicAngle - baseAngle),
          Math.cos(organicAngle - baseAngle),
        );
        expect(Math.abs(delta)).toBeLessThanOrEqual(ORGANIC_ANGLE_JITTER + 1e-9);
      }

      if (node.depth > 0 && node.depth < model.maxDepth) {
        const ring = ringRadiusByDepth.get(node.depth);
        const outer = ringRadiusByDepth.get(node.depth + 1);
        const inner = ringRadiusByDepth.get(node.depth - 1);
        if (ring === undefined || outer === undefined || inner === undefined) {
          throw new Error(`missing ring radius for depth ${node.depth}`);
        }
        const gap = Math.min(outer - ring, ring - inner);
        const ringVariation = RING_RADIUS_VARIATION * baseRadius;
        const jitterLimit =
          ORGANIC_RADIAL_JITTER_SHARE * gap * (1 + 2 * RING_RADIUS_VARIATION) +
          ringVariation +
          1e-6;
        expect(Math.abs(organicRadius - baseRadius)).toBeLessThanOrEqual(jitterLimit);
      } else {
        expect(organicRadius).toBeCloseTo(baseRadius, 9);
      }
    }
  });

  it('环半径仅在内环轻微非均匀，最外环锁定基准半径', () => {
    const model = buildGraphModel(createNestedFixture(true));
    const center = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
    const pure = positionById(
      layoutRadialTree(model, VIEWPORT, EMPTY_GRAPH_PINS, { organic: false }),
    );
    const radiusAtDepth = (depth: number): number => {
      for (const node of model.nodes) {
        if (node.depth !== depth) {
          continue;
        }
        const position = pure.get(node.id);
        if (position) {
          return Math.hypot(position.x - center.x, position.y - center.y);
        }
      }
      throw new Error(`no node at depth ${depth}`);
    };
    for (let depth = 1; depth < model.maxDepth; depth += 1) {
      const base = MAX_RADIUS * Math.pow(depth / model.maxDepth, 0.75);
      expect(radiusAtDepth(depth)).toBeLessThanOrEqual(base * (1 + RING_RADIUS_VARIATION));
      expect(radiusAtDepth(depth)).toBeGreaterThanOrEqual(base * (1 - RING_RADIUS_VARIATION));
    }
    expect(radiusAtDepth(model.maxDepth)).toBeCloseTo(MAX_RADIUS, 6);
  });

  it('organic 模式下 derives 边仍不改变任何输出坐标', () => {
    const withDerives = buildGraphModel(createNestedFixture(true));
    const withoutDerives = buildGraphModel(createNestedFixture(false));
    expect(coordinates(layoutRadialTree(withDerives, VIEWPORT))).toEqual(
      coordinates(layoutRadialTree(withoutDerives, VIEWPORT)),
    );
  });
});

describe('layoutRadialTree 与用户固定点', () => {
  it('固定点覆盖径向布局坐标，未固定节点保持环上位置', () => {
    const model = buildGraphModel(createNestedFixture(false));
    const baseline = positionById(layoutRadialTree(model, VIEWPORT, EMPTY_GRAPH_PINS));
    const pinnedId = 'artifact:spec-1';
    const baselinePin = baseline.get(pinnedId);
    if (!baselinePin) {
      throw new Error('missing baseline position');
    }
    const pins = recordGraphPins(EMPTY_GRAPH_PINS, [{ id: pinnedId, x: 12, y: 34 }]);
    const byId = positionById(layoutRadialTree(model, VIEWPORT, pins));

    const pinned = byId.get(pinnedId);
    if (!pinned) {
      throw new Error('missing pinned position');
    }
    expect(pinned.x).toBe(12);
    expect(pinned.y).toBe(34);

    for (const position of layoutRadialTree(model, VIEWPORT, pins)) {
      if (position.model.id === pinnedId) {
        continue;
      }
      const expected = baseline.get(position.model.id);
      expect({ x: position.x, y: position.y }).toEqual({ x: expected?.x, y: expected?.y });
    }
  });

  it('复位清空固定点后回到纯径向布局', () => {
    const model = buildGraphModel(createNestedFixture(false));
    const baseline = coordinates(layoutRadialTree(model, VIEWPORT, EMPTY_GRAPH_PINS));
    const pins = recordGraphPins(EMPTY_GRAPH_PINS, [{ id: 'artifact:spec-1', x: 5, y: 6 }]);
    const pinnedLayout = coordinates(layoutRadialTree(model, VIEWPORT, pins));
    expect(pinnedLayout).not.toEqual(baseline);

    expect(coordinates(layoutRadialTree(model, VIEWPORT, clearGraphPins()))).toEqual(baseline);
  });

  it('忽略非有限坐标，避免污染布局', () => {
    const current = recordGraphPins(EMPTY_GRAPH_PINS, [{ id: 'artifact:spec-1', x: 1, y: 2 }]);
    const next = recordGraphPins(current, [
      { id: 'artifact:plan-1', x: Number.NaN, y: 9 },
      { id: 'artifact:review-1', x: 7, y: Number.POSITIVE_INFINITY },
    ]);
    expect(next.size).toBe(1);
    expect(next.get('artifact:spec-1')).toEqual({ x: 1, y: 2 });
  });
});

/** 单元工作区 + 一个大分类 + 60 个叶子：复现「一条环装不下」的展开场景。 */
function createWideFixture(includeDerives: boolean): KnowledgeGraph {
  const nodes: GraphNode[] = [
    createNode({ id: 'workspace:current', kind: 'workspace', label: '工作区', group: 'workspace' }),
    createNode({
      id: 'category:big',
      kind: 'category',
      label: '大分类：规格、计划、任务、实现与评审产物',
      group: 'knowledge',
      state: 'knowledge',
    }),
  ];
  const edges: GraphEdge[] = [createEdge('workspace:current', 'category:big', 'contains')];
  for (let index = 0; index < 60; index += 1) {
    nodes.push(
      createNode({
        id: `artifact:leaf-${index}`,
        kind: 'artifact',
        label: `实现产物 ${index}`,
        group: 'knowledge',
        state: 'spec',
      }),
    );
    edges.push(createEdge('category:big', `artifact:leaf-${index}`, 'contains'));
  }
  if (includeDerives) {
    for (let index = 0; index < 20; index += 1) {
      edges.push(
        createEdge(`artifact:leaf-${index}`, `artifact:leaf-${index + 20}`, 'derives', 'review'),
      );
    }
  }
  return { nodes, edges };
}

describe('layoutRadialTree 占用驱动的子环', () => {
  const WIDE_VIEWPORT: GraphViewportSize = { width: 1200, height: 760 };

  it('60 节点环超出预算时自动拆成多条子环，且任意两个圆盘不重叠', () => {
    const model = buildGraphModel(createWideFixture(false));
    const positions = layoutRadialTree(model, WIDE_VIEWPORT, EMPTY_GRAPH_PINS, {
      organic: false,
    });
    const leaves = positions.filter((position) => position.model.depth === 2);
    expect(leaves).toHaveLength(60);

    for (let left = 0; left < positions.length; left += 1) {
      const a = positions[left];
      if (!a) {
        continue;
      }
      for (let right = left + 1; right < positions.length; right += 1) {
        const b = positions[right];
        if (!b) {
          continue;
        }
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        expect(distance).toBeGreaterThanOrEqual(a.radius + b.radius - 1e-6);
      }
    }
  });

  it('derives 边仍然不改变任何输出坐标（含拆环场景）', () => {
    const withDerives = buildGraphModel(createWideFixture(true));
    const withoutDerives = buildGraphModel(createWideFixture(false));
    expect(coordinates(layoutRadialTree(withDerives, WIDE_VIEWPORT))).toEqual(
      coordinates(layoutRadialTree(withoutDerives, WIDE_VIEWPORT)),
    );
  });
});
