import { describe, expect, it } from 'vitest';
import type { GraphNode } from '../../../data/build-knowledge-graph.js';
import type { PositionedNode } from './knowledge-graph-layout.js';
import type { GraphNodeModel } from './knowledge-graph-model.js';
import type { GraphPinMap } from './knowledge-graph-pins.js';
import { relaxGraphPositions } from './knowledge-graph-relax.js';

function positionedAt(id: string, x: number, y: number, radius = 14): PositionedNode {
  const node: GraphNode = {
    id,
    kind: 'knowledge',
    label: id,
    group: 'knowledge',
    content: null,
    detail: null,
    memoryType: null,
    persistedMemoryId: null,
    roleLayers: null,
    searchText: null,
    sourceRef: null,
    state: null,
  };
  const model: GraphNodeModel = {
    id,
    kind: 'knowledge',
    group: 'knowledge',
    label: id,
    detail: null,
    phase: null,
    depth: 2,
    persisted: false,
    roleLayers: null,
    node,
  };
  return { model, x, y, radius };
}

function pinsOf(entries: ReadonlyArray<readonly [string, number, number]>): GraphPinMap {
  return new Map(entries.map(([id, x, y]) => [id, { x, y }]));
}

function coordinateOf(result: Map<string, { x: number; y: number }>, id: string) {
  const position = result.get(id);
  if (!position) {
    throw new Error(`missing relaxed position ${id}`);
  }
  return position;
}

const CHAIN: PositionedNode[] = [
  positionedAt('a', 0, 0),
  positionedAt('b', 30, 0),
  positionedAt('c', 1000, 1000),
];

describe('relaxGraphPositions', () => {
  it('没有固定点时逐位返回基准坐标（回到设计好的径向形态）', () => {
    const result = relaxGraphPositions(CHAIN, new Map());
    for (const node of CHAIN) {
      expect(coordinateOf(result, node.model.id)).toEqual({ x: node.x, y: node.y });
    }
  });

  it('固定点永不移动，即使邻域被推动', () => {
    const pins = pinsOf([['a', 10, 4]]);
    const result = relaxGraphPositions(CHAIN, pins);
    expect(coordinateOf(result, 'a')).toEqual({ x: 10, y: 4 });
    expect(coordinateOf(result, 'b')).not.toEqual({ x: 30, y: 0 });
  });

  it('相同输入两次调用产生完全一致的输出', () => {
    const pins = pinsOf([['a', 10, 4]]);
    expect(relaxGraphPositions(CHAIN, pins)).toEqual(relaxGraphPositions(CHAIN, pins));
  });

  it('迭代收敛：加倍迭代次数后结果几乎不变', () => {
    const pins = pinsOf([['a', 10, 4]]);
    const settled = relaxGraphPositions(CHAIN, pins, { iterations: 48 });
    const more = relaxGraphPositions(CHAIN, pins, { iterations: 200 });
    for (const node of CHAIN) {
      const left = coordinateOf(settled, node.model.id);
      const right = coordinateOf(more, node.model.id);
      expect(Math.hypot(left.x - right.x, left.y - right.y)).toBeLessThan(0.05);
    }
  });

  it('被拖拽的固定点把相邻节点推开，影响范围外的节点保持原位', () => {
    const pins = pinsOf([['a', 12, 0]]);
    const result = relaxGraphPositions(CHAIN, pins);
    const neighbour = coordinateOf(result, 'b');
    expect(neighbour.x).toBeGreaterThan(30);
    expect(Math.hypot(neighbour.x - 0, neighbour.y)).toBeGreaterThan(0);
    expect(coordinateOf(result, 'c')).toEqual({ x: 1000, y: 1000 });
  });

  it('返回所有节点的坐标映射', () => {
    const result = relaxGraphPositions(CHAIN, pinsOf([['a', 10, 4]]));
    expect(result.size).toBe(CHAIN.length);
    expect([...result.keys()].sort()).toEqual(['a', 'b', 'c']);
  });
});
