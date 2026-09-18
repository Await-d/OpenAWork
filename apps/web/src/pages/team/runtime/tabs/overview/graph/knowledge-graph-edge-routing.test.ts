import { describe, expect, it } from 'vitest';
import {
  HIGH_DEGREE_CONTAINS_THRESHOLD,
  containsEdgeCurveOffset,
  isHighDegreeContainsFan,
  shouldSuppressContainsEdge,
} from './knowledge-graph-edges.js';

describe('containsEdgeCurveOffset 兄弟边成束路由', () => {
  it('小扇保持原有的温和拱形（折叠概览观感不回归）', () => {
    expect(containsEdgeCurveOffset(1, 600)).toBe(8);
    expect(containsEdgeCurveOffset(4, 600)).toBe(8);
  });

  it('扇越大弯曲越明显，随弦长增长但有硬上限', () => {
    const calm = containsEdgeCurveOffset(8, 200);
    const dense = containsEdgeCurveOffset(60, 200);

    expect(dense).toBeGreaterThan(calm);
    expect(containsEdgeCurveOffset(60, 2000)).toBe(dense);
    expect(containsEdgeCurveOffset(60, 20)).toBe(8);
    expect(containsEdgeCurveOffset(60, 1)).toBeLessThan(dense);
    expect(dense).toBeLessThanOrEqual(72);
  });
});

describe('高扇 contains 子边抑制（星芒形态修复）', () => {
  it('阈值以内的小扇不抑制：3 子节点的折叠概览保持原有边', () => {
    expect(isHighDegreeContainsFan(3)).toBe(false);
    expect(isHighDegreeContainsFan(HIGH_DEGREE_CONTAINS_THRESHOLD)).toBe(false);
    expect(shouldSuppressContainsEdge({ kind: 'contains', fan: 3, focused: false })).toBe(false);
  });

  it('超过阈值的非聚焦高扇 contains 边被抑制', () => {
    expect(isHighDegreeContainsFan(HIGH_DEGREE_CONTAINS_THRESHOLD + 1)).toBe(true);
    expect(shouldSuppressContainsEdge({ kind: 'contains', fan: 60, focused: false })).toBe(true);
  });

  it('聚焦时高扇 contains 边重新显示，derives 永远不抑制', () => {
    expect(shouldSuppressContainsEdge({ kind: 'contains', fan: 60, focused: true })).toBe(false);
    expect(shouldSuppressContainsEdge({ kind: 'derives', fan: 600, focused: false })).toBe(false);
    expect(shouldSuppressContainsEdge({ kind: 'derives', fan: 600, focused: true })).toBe(false);
  });

  it('非有限扇值安全（不抑制）', () => {
    expect(isHighDegreeContainsFan(Number.NaN)).toBe(false);
    expect(isHighDegreeContainsFan(Number.POSITIVE_INFINITY)).toBe(false);
  });
});
