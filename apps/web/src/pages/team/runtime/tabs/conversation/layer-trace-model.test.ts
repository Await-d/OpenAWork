import { describe, expect, it } from 'vitest';
import type { HandoffEntry, LayerNode } from '../../../../../stores/team/team-events.js';
import type { LayerConversationRow } from './layered-conversation-model.js';
import {
  buildLayerTraceModel,
  buildTraceEdgePath,
  formatTraceClock,
  formatTraceDuration,
  resolveTraceBarPlacement,
  resolveTraceLaneIndex,
} from './layer-trace-model.js';

function makeRow(
  overrides: Partial<LayerConversationRow> & { sessionId: string },
): LayerConversationRow {
  return {
    childCount: 0,
    depth: 0,
    detail: '详情',
    displayName: null,
    fromRoleLayer: null,
    handoffCount: 0,
    id: `session-${overrides.sessionId}`,
    parentSessionId: null,
    personaKey: null,
    roleLayer: 'reception',
    source: 'session',
    state: 'completed',
    timestampMs: 10_000,
    title: overrides.sessionId,
    toRoleLayer: 'reception',
    ...overrides,
  };
}

function makeHandoff(overrides: Partial<HandoffEntry> & { id: string }): HandoffEntry {
  return {
    fromRoleLayer: 'reception',
    state: 'completed',
    toRoleLayer: 'pm1',
    updatedAt: 10_000,
    ...overrides,
  };
}

function makeNode(sessionId: string, roleLayer: LayerNode['roleLayer']): LayerNode {
  return {
    parentSessionId: null,
    roleLayer,
    sessionId,
    state: 'completed',
  };
}

describe('buildLayerTraceModel', () => {
  it('按 handoff 的 startedAt/endedAt 聚合 bar 区间并生成跨轨边', () => {
    const model = buildLayerTraceModel({
      handoffs: [
        makeHandoff({
          endedAt: 20_000,
          id: 'h1',
          startedAt: 5_000,
          toRoleLayer: 'pm1',
          toSessionId: 's-pm1',
          updatedAt: 20_000,
        }),
      ],
      nodes: [makeNode('s-reception', 'reception'), makeNode('s-pm1', 'pm1')],
      rows: [
        makeRow({ roleLayer: 'reception', sessionId: 's-reception', timestampMs: 4_000 }),
        makeRow({
          fromRoleLayer: 'reception',
          parentSessionId: 's-reception',
          roleLayer: 'pm1',
          sessionId: 's-pm1',
          timestampMs: 20_000,
        }),
      ],
    });

    const bar = model.bars.find((item) => item.sessionId === 's-pm1');
    expect(bar).toMatchObject({ startMs: 5_000, endMs: 20_000, durationMs: 15_000 });
    expect(model.lanes.map((lane) => lane.layer)).toEqual(['reception', 'pm1']);
    expect(model.edges).toEqual([
      {
        active: false,
        fromSessionId: 's-reception',
        state: 'completed',
        toSessionId: 's-pm1',
      },
    ]);
    expect(model.sequential).toBe(false);
    expect(model.spanMs).toBeGreaterThan(0);
    expect(model.ticks).toHaveLength(3);
  });

  it('无 handoff 的会话退化为瞬时点；无有效时间时切换等宽轴', () => {
    const model = buildLayerTraceModel({
      handoffs: [],
      nodes: [],
      rows: [
        makeRow({ sessionId: 's-a', timestampMs: 0 }),
        makeRow({ roleLayer: 'pm1', sessionId: 's-b', timestampMs: 0 }),
      ],
    });

    expect(model.sequential).toBe(true);
    expect(model.bars.every((bar) => bar.durationMs === 0)).toBe(true);
    expect(model.lanes).toHaveLength(2);
  });

  it('聚合 substate 与活跃态', () => {
    const model = buildLayerTraceModel({
      handoffs: [],
      nodes: [
        {
          parentSessionId: null,
          roleLayer: 'pm1',
          sessionId: 's-running',
          state: 'running',
          substate: 'drafting_spec',
        },
      ],
      rows: [makeRow({ roleLayer: 'pm1', sessionId: 's-running', state: 'running' })],
    });

    expect(model.bars[0]).toMatchObject({ active: true, substate: 'drafting_spec' });
  });
});

describe('resolveTraceBarPlacement', () => {
  it('时间模式下按比例布局，且保证最小宽度', () => {
    const model = buildLayerTraceModel({
      handoffs: [
        makeHandoff({
          endedAt: 10_000,
          id: 'h1',
          startedAt: 0,
          toSessionId: 's-pm1',
          updatedAt: 10_000,
        }),
        makeHandoff({
          endedAt: 60_000,
          id: 'h2',
          startedAt: 50_000,
          toRoleLayer: 'pm2',
          toSessionId: 's-pm2',
          updatedAt: 60_000,
        }),
      ],
      nodes: [],
      rows: [
        makeRow({ roleLayer: 'pm1', sessionId: 's-pm1', timestampMs: 10_000 }),
        makeRow({ roleLayer: 'pm2', sessionId: 's-pm2', timestampMs: 60_000 }),
      ],
    });

    const first = model.bars[0];
    const second = model.bars[1];
    expect(first && second).toBeTruthy();
    const firstPlacement = resolveTraceBarPlacement(first!, model);
    const secondPlacement = resolveTraceBarPlacement(second!, model);
    expect(firstPlacement.leftRatio).toBeLessThanOrEqual(secondPlacement.leftRatio);
    expect(secondPlacement.leftRatio + secondPlacement.widthRatio).toBeLessThanOrEqual(1.0001);
  });

  it('等宽模式下按序号铺开', () => {
    const rows = Array.from({ length: 4 }, (_, index) =>
      makeRow({ roleLayer: 'pm1', sessionId: `s-${index}`, timestampMs: 0 }),
    );
    const model = buildLayerTraceModel({ handoffs: [], nodes: [], rows });

    const placements = model.bars.map((bar) => resolveTraceBarPlacement(bar, model));
    for (let index = 1; index < placements.length; index += 1) {
      const previous = placements[index - 1];
      const current = placements[index];
      expect(previous && current).toBeTruthy();
      expect(current!.leftRatio).toBeGreaterThan(previous!.leftRatio);
    }
  });
});

describe('trace helpers', () => {
  it('连线路径形态稳定：正向为 S 形，回折也闭合', () => {
    const forward = buildTraceEdgePath({
      fromLaneIndex: 0,
      fromRatio: 0.2,
      laneHeight: 44,
      toLaneIndex: 2,
      toRatio: 0.5,
      trackWidth: 600,
    });
    const backward = buildTraceEdgePath({
      fromLaneIndex: 3,
      fromRatio: 0.8,
      laneHeight: 44,
      toLaneIndex: 1,
      toRatio: 0.3,
      trackWidth: 600,
    });

    expect(forward.startsWith('M ')).toBe(true);
    expect(forward).toContain('C ');
    expect(backward).not.toBe(forward);
  });

  it('时长与时钟格式化', () => {
    expect(formatTraceDuration(0)).toBe('0s');
    expect(formatTraceDuration(45_000)).toBe('45s');
    expect(formatTraceDuration(150_000)).toBe('2m 30s');
    expect(formatTraceDuration(3_900_000)).toBe('1h 5m');
    expect(formatTraceClock(0)).toBe('—');
    expect(formatTraceClock(new Date(2026, 8, 16, 9, 5).getTime())).toBe('09:05');
  });

  it('轨道序号解析：未命中回落 0', () => {
    const model = buildLayerTraceModel({
      handoffs: [],
      nodes: [],
      rows: [makeRow({ roleLayer: 'executor', sessionId: 's-exec' })],
    });

    expect(resolveTraceLaneIndex(model, 'executor')).toBe(0);
    expect(resolveTraceLaneIndex(model, 'reviewer')).toBe(0);
  });
});
