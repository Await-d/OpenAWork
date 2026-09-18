import { describe, expect, it } from 'vitest';
import {
  AGGREGATE_RADIUS_FLOOR,
  AGGREGATE_RADIUS_MAX,
  aggregateRadiusFor,
  aggregateRadiusForArc,
  planRingBands,
  ringArcSpacing,
  type RingBandPlan,
  type RingNodeInput,
} from './knowledge-graph-radius.js';

const FULL_TURN = Math.PI * 2;

function ringNodes(input: {
  count: number;
  radius?: number;
  parent?: string;
  spanStart?: number;
  spanEnd?: number;
}): RingNodeInput[] {
  const { count, radius = 14, parent = 'root' } = input;
  const spanStart = input.spanStart ?? 0;
  const spanEnd = input.spanEnd ?? FULL_TURN;
  return Array.from({ length: count }, (_, index) => ({
    id: `${parent}-${index}`,
    parentId: parent,
    radius,
    aggregate: false,
    count: 0,
    angle: spanStart + ((index + 0.5) / count) * (spanEnd - spanStart),
    parentSpanStart: spanStart,
    parentSpanEnd: spanEnd,
  }));
}

function placedNodes(plan: RingBandPlan): { id: string; x: number; y: number; radius: number }[] {
  const placed: { id: string; x: number; y: number; radius: number }[] = [];
  for (const band of plan.bands) {
    for (const entry of band.entries) {
      placed.push({
        id: entry.id,
        x: band.radius * Math.cos(entry.angle),
        y: band.radius * Math.sin(entry.angle),
        radius: plan.nodeRadiusById.get(entry.id) ?? 0,
      });
    }
  }
  return placed;
}

function overlappingPair(plan: RingBandPlan): { a: string; b: string } | null {
  const placed = placedNodes(plan);
  for (let left = 0; left < placed.length; left += 1) {
    const a = placed[left];
    if (!a) {
      continue;
    }
    for (let right = left + 1; right < placed.length; right += 1) {
      const b = placed[right];
      if (!b) {
        continue;
      }
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (distance < a.radius + b.radius - 1e-6) {
        return { a: a.id, b: b.id };
      }
    }
  }
  return null;
}

describe('aggregateRadiusForArc', () => {
  it('计数半径封顶，拥挤时只缩不放且不低于地板', () => {
    const nominal = aggregateRadiusFor(900);
    expect(nominal).toBeLessThanOrEqual(AGGREGATE_RADIUS_MAX);

    const loose = aggregateRadiusForArc({
      descendantCount: 900,
      ringNodeCount: 8,
      ringRadius: 320,
    });
    const tight = aggregateRadiusForArc({
      descendantCount: 900,
      ringNodeCount: 48,
      ringRadius: 320,
    });

    expect(loose).toBeLessThanOrEqual(nominal);
    expect(tight).toBeLessThan(loose);
    expect(tight).toBeGreaterThanOrEqual(AGGREGATE_RADIUS_FLOOR);
  });

  it('随环节点数增加单调不增，且始终不超过计数半径', () => {
    let previous = Number.POSITIVE_INFINITY;
    for (const ringNodeCount of [4, 8, 16, 32, 64]) {
      const radius = aggregateRadiusForArc({
        descendantCount: 420,
        ringNodeCount,
        ringRadius: 300,
      });
      expect(radius).toBeLessThanOrEqual(previous);
      expect(radius).toBeLessThanOrEqual(aggregateRadiusFor(420));
      previous = radius;
    }
  });
});

describe('planRingBands 环占用', () => {
  it('单环半径随占用增长，且等于「节点数 × MIN_ARC_SPACING / 2π」', () => {
    const small = planRingBands({
      nodes: ringNodes({ count: 8 }),
      innerBound: 0,
      outerLimit: 600,
      designRadius: 0,
    });
    const large = planRingBands({
      nodes: ringNodes({ count: 24 }),
      innerBound: 0,
      outerLimit: 600,
      designRadius: 0,
    });

    expect(small.bands).toHaveLength(1);
    expect(large.bands).toHaveLength(1);
    const spacing = ringArcSpacing(14);
    expect(small.bands[0]?.radius).toBeCloseTo((8 * spacing) / FULL_TURN, 4);
    expect(large.bands[0]?.radius).toBeCloseTo((24 * spacing) / FULL_TURN, 4);
    expect(large.bands[0]?.radius).toBeGreaterThan(small.bands[0]?.radius ?? 0);
  });

  it('60 节点的合成环超出预算时拆成多条子环，且没有任何一对圆盘重叠', () => {
    const plan = planRingBands({
      nodes: ringNodes({ count: 60 }),
      innerBound: 60,
      outerLimit: 324,
      designRadius: 324,
    });

    expect(plan.bands.length).toBeGreaterThan(1);
    expect(overlappingPair(plan)).toBeNull();
  });

  it('子环保持角度相邻性：每个子环内同一父节点的条目连续成段', () => {
    const parents = ['p0', 'p1', 'p2', 'p3'];
    const sector = FULL_TURN / parents.length;
    const nodes: RingNodeInput[] = parents.flatMap((parent, parentIndex) =>
      Array.from({ length: 15 }, (_, index) => ({
        id: `${parent}-${index}`,
        parentId: parent,
        radius: 14,
        aggregate: false,
        count: 0,
        angle: parentIndex * sector + ((index + 0.5) / 15) * sector,
        parentSpanStart: parentIndex * sector,
        parentSpanEnd: (parentIndex + 1) * sector,
      })),
    );

    const plan = planRingBands({
      nodes,
      innerBound: 60,
      outerLimit: 324,
      designRadius: 324,
    });

    expect(plan.bands.length).toBeGreaterThan(1);
    const ownerOf = new Map(nodes.map((node) => [node.id, node.parentId]));
    for (const band of plan.bands) {
      const runs: string[] = [];
      for (const entry of band.entries) {
        const parent = ownerOf.get(entry.id) ?? '';
        if (runs[runs.length - 1] !== parent) {
          runs.push(parent);
        }
      }
      expect(new Set(runs).size).toBe(runs.length);
    }
  });

  it('规划结果确定：同一输入两次得到逐位相同的环带', () => {
    const nodes = ringNodes({ count: 60 });
    const input = { nodes, innerBound: 60, outerLimit: 324, designRadius: 324 };
    const first = planRingBands(input);
    const second = planRingBands(input);
    expect(second.bands).toEqual(first.bands);
    expect([...second.nodeRadiusById.entries()]).toEqual([...first.nodeRadiusById.entries()]);
    expect([...second.angleById.entries()]).toEqual([...first.angleById.entries()]);
  });

  it('拥挤环上的聚合半径只缩不放，且不低于地板', () => {
    const nominal = aggregateRadiusFor(400);
    const aggregates = (count: number): RingNodeInput[] =>
      ringNodes({ count }).map((node) => ({
        ...node,
        aggregate: true,
        count: 400,
        radius: nominal,
      }));

    const loose = planRingBands({
      nodes: aggregates(6),
      innerBound: 0,
      outerLimit: 324,
      designRadius: 120,
    });
    const crowded = planRingBands({
      nodes: aggregates(48),
      innerBound: 0,
      outerLimit: 324,
      designRadius: 324,
    });

    const looseRadius = Math.max(...loose.nodeRadiusById.values());
    const crowdedRadii = [...crowded.nodeRadiusById.values()];
    expect(looseRadius).toBeLessThanOrEqual(nominal);
    expect(Math.max(...crowdedRadii)).toBeLessThanOrEqual(nominal);
    expect(Math.max(...crowdedRadii)).toBeLessThanOrEqual(looseRadius);
    expect(Math.min(...crowdedRadii)).toBeGreaterThanOrEqual(AGGREGATE_RADIUS_FLOOR);
  });
});
