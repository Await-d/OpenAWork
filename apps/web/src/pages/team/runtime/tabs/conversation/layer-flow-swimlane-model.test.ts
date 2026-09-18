import { describe, expect, it } from 'vitest';
import type {
  HandoffEntry,
  LayerNode,
  TeamRoleLayer,
} from '../../../../../stores/team/team-events.js';
import {
  SWIMLANE_ACTIVE_CONTEXT_LIMIT,
  SWIMLANE_COLUMN_WIDTH,
  SWIMLANE_COMPACT_LANE_HEIGHT,
  SWIMLANE_LANE_HEIGHT,
  SWIMLANE_MAX_COLUMN_WIDTH,
  SWIMLANE_MAX_LANE_HEIGHT,
  SWIMLANE_MIN_COLUMN_WIDTH,
  SWIMLANE_MIN_LANE_HEIGHT,
  SWIMLANE_NODE_HEIGHT,
  buildLayerSwimlaneModel,
  buildSwimlaneLinkPath,
  formatSwimlaneTimeLabel,
  measureSwimlane,
  resolveSwimlaneColumnWidth,
  resolveSwimlaneFocusHandoffIds,
  resolveSwimlaneLaneIndex,
  resolveSwimlaneLaneMetrics,
  swimlaneColumnCenterX,
  swimlaneLaneCenterY,
  swimlaneLaneTotalHeight,
  swimlaneNodeLeft,
  type SwimlaneLane,
} from './layer-flow-swimlane-model.js';
import { FLOW_LAYERS } from './layer-flow-state.js';

function makeHandoff(overrides: Partial<HandoffEntry> & { id: string }): HandoffEntry {
  return {
    state: 'completed',
    fromRoleLayer: 'reception',
    toRoleLayer: 'pm1',
    updatedAt: 1_000,
    ...overrides,
  };
}

function makeNode(sessionId: string, roleLayer: TeamRoleLayer): LayerNode {
  return {
    sessionId,
    roleLayer,
    parentSessionId: null,
    state: 'completed',
  };
}

/** reception → pm1 → pm2 的线性链。 */
function buildLinearChain(): HandoffEntry[] {
  return [
    makeHandoff({
      fromRoleLayer: 'reception',
      fromSessionId: 'S0',
      id: 'h1',
      toRoleLayer: 'pm1',
      toSessionId: 'S1',
      updatedAt: 1_000,
    }),
    makeHandoff({
      fromRoleLayer: 'pm1',
      fromSessionId: 'S1',
      id: 'h2',
      toRoleLayer: 'pm2',
      toSessionId: 'S2',
      updatedAt: 2_000,
    }),
    makeHandoff({
      fromRoleLayer: 'pm2',
      fromSessionId: 'S2',
      id: 'h3',
      toRoleLayer: 'reviewer',
      toSessionId: 'S3',
      updatedAt: 3_000,
    }),
  ];
}

describe('buildLayerSwimlaneModel', () => {
  it('按 updatedAt 升序切列，节点落在 toRoleLayer 泳道', () => {
    const model = buildLayerSwimlaneModel({
      densityMode: 'all',
      handoffs: [
        makeHandoff({
          id: 'h2',
          fromRoleLayer: 'pm1',
          toRoleLayer: 'pm2',
          updatedAt: 2_000,
        }),
        makeHandoff({
          id: 'h1',
          fromRoleLayer: 'reception',
          toRoleLayer: 'pm1',
          updatedAt: 1_000,
        }),
      ],
      nodes: [],
    });

    expect(model.columns.map((column) => column.index)).toEqual([0, 1]);
    expect(model.nodes.map((node) => [node.handoffId, node.columnIndex, node.layer])).toEqual([
      ['h1', 0, 'pm1'],
      ['h2', 1, 'pm2'],
    ]);
  });

  it('连线溯源到真实源节点列：链式交接逐跳相接，缺失源会话回退左侧引入', () => {
    const model = buildLayerSwimlaneModel({
      densityMode: 'all',
      handoffs: [
        ...buildLinearChain(),
        makeHandoff({
          fromRoleLayer: 'reviewer',
          fromSessionId: 'S-unknown',
          id: 'h-orphan',
          toRoleLayer: 'executor',
          toSessionId: 'S4',
          updatedAt: 4_000,
        }),
      ],
      nodes: [],
    });

    expect(
      model.links.map((link) => [link.handoffId, link.fromColumnIndex, link.toColumnIndex]),
    ).toEqual([
      ['h1', -1, 0],
      ['h2', 0, 1],
      ['h3', 1, 2],
      ['h-orphan', -1, 3],
    ]);
  });

  it('打回（评审 → 执行）连线从前序源节点回折，保留 fromLayer', () => {
    const model = buildLayerSwimlaneModel({
      densityMode: 'all',
      handoffs: [
        ...buildLinearChain(),
        makeHandoff({
          fromRoleLayer: 'reviewer',
          fromSessionId: 'S3',
          id: 'h-rework',
          state: 'running',
          toRoleLayer: 'executor',
          toSessionId: 'S2',
          updatedAt: 4_000,
        }),
      ],
      nodes: [],
    });

    const rework = model.links.find((link) => link.handoffId === 'h-rework');
    expect(rework).toMatchObject({
      active: true,
      fromColumnIndex: 2,
      fromLayer: 'reviewer',
      toColumnIndex: 3,
      toLayer: 'executor',
    });
  });

  it('复用会话取更早的那次节点作为连线源', () => {
    const model = buildLayerSwimlaneModel({
      densityMode: 'all',
      handoffs: [
        makeHandoff({
          fromSessionId: 'S0',
          id: 'round-1',
          toSessionId: 'S1',
          updatedAt: 1_000,
        }),
        makeHandoff({
          fromRoleLayer: 'pm1',
          fromSessionId: 'S1',
          id: 'round-2',
          toRoleLayer: 'pm2',
          toSessionId: 'S2',
          updatedAt: 2_000,
        }),
        makeHandoff({
          fromRoleLayer: 'pm2',
          fromSessionId: 'S2',
          id: 'round-3',
          toRoleLayer: 'pm1',
          toSessionId: 'S1',
          updatedAt: 3_000,
        }),
      ],
      nodes: [],
    });

    const reuse = model.links.find((link) => link.handoffId === 'round-3');
    expect(reuse?.fromColumnIndex).toBe(1);
    expect(reuse?.toColumnIndex).toBe(2);
  });

  it('active 密度保留活跃项 + 最近上下文 + 选中项', () => {
    const finished = Array.from({ length: 12 }, (_, index) =>
      makeHandoff({
        id: `done-${index}`,
        toRoleLayer: 'pm1',
        updatedAt: 1_000 + index * 100,
      }),
    );
    const running = makeHandoff({
      id: 'running-entry',
      toRoleLayer: 'pm2',
      fromRoleLayer: 'pm1',
      state: 'running',
      updatedAt: 900,
    });
    const pinned = makeHandoff({
      id: 'pinned-entry',
      toRoleLayer: 'reception',
      updatedAt: 1,
    });

    const model = buildLayerSwimlaneModel({
      densityMode: 'active',
      handoffs: [...finished, running, pinned],
      nodes: [],
      selectedHandoffId: 'pinned-entry',
    });

    const ids = model.nodes.map((node) => node.handoffId);
    expect(ids).toContain('running-entry');
    expect(ids).toContain('pinned-entry');
    expect(ids).toContain('done-11');
    expect(ids).toContain(`done-${12 - SWIMLANE_ACTIVE_CONTEXT_LIMIT}`);
    expect(ids).not.toContain('done-0');
  });

  it('tester / user 目标层不再被丢弃，而是归入最近泳道（计数与画布口径一致）', () => {
    const model = buildLayerSwimlaneModel({
      densityMode: 'all',
      handoffs: [
        makeHandoff({ id: 'to-tester', toRoleLayer: 'tester', updatedAt: 1_000 }),
        makeHandoff({ id: 'to-user', toRoleLayer: 'user', updatedAt: 2_000 }),
        makeHandoff({ id: 'ok', toRoleLayer: 'executor', updatedAt: 3_000 }),
      ],
      nodes: [],
    });

    expect(model.nodes.map((node) => [node.handoffId, node.laneIndex])).toEqual([
      ['to-tester', FLOW_LAYERS.length - 1],
      ['to-user', 0],
      ['ok', FLOW_LAYERS.indexOf('executor')],
    ]);
    // 泳道计数按泳道序号汇总：reviewer 泳道包含 tester 的交接，reception 泳道包含 user 的交接
    expect(model.lanes.find((lane) => lane.layer === 'reviewer')?.inboundCount).toBe(1);
    expect(model.lanes.find((lane) => lane.layer === 'reception')?.inboundCount).toBe(1);
  });

  it('泳道聚合：计数、会话数、最新状态优先', () => {
    const model = buildLayerSwimlaneModel({
      densityMode: 'all',
      handoffs: [
        makeHandoff({ id: 'a', toRoleLayer: 'pm1', state: 'completed', updatedAt: 1_000 }),
        makeHandoff({ id: 'b', toRoleLayer: 'pm1', state: 'failed', updatedAt: 3_000 }),
      ],
      nodes: [makeNode('s-pm1', 'pm1'), makeNode('s-pm1-b', 'pm1')],
    });

    const pm1Lane = model.lanes.find((lane) => lane.layer === 'pm1');
    expect(pm1Lane).toMatchObject({
      inboundCount: 2,
      sessionCount: 2,
      state: 'failed',
      active: false,
      lastTimeMs: 3_000,
    });
    expect(model.lanes).toHaveLength(FLOW_LAYERS.length);
  });
});

describe('resolveSwimlaneFocusHandoffIds', () => {
  it('沿交接链双向展开：选中中游节点时上下游都命中，无关链不命中', () => {
    const model = buildLayerSwimlaneModel({
      densityMode: 'all',
      handoffs: [
        ...buildLinearChain(),
        makeHandoff({
          fromRoleLayer: 'reception',
          fromSessionId: 'X0',
          id: 'other-1',
          toRoleLayer: 'pm1',
          toSessionId: 'X1',
          updatedAt: 4_000,
        }),
        makeHandoff({
          fromRoleLayer: 'pm1',
          fromSessionId: 'X1',
          id: 'other-2',
          toRoleLayer: 'pm2',
          toSessionId: 'X2',
          updatedAt: 5_000,
        }),
      ],
      nodes: [],
    });

    const focus = resolveSwimlaneFocusHandoffIds(model, 'h2');
    expect(focus).not.toBeNull();
    expect([...(focus ?? [])].sort()).toEqual(['h1', 'h2', 'h3']);
  });

  it('未选中或选中节点无会话时返回 null（不做淡化）', () => {
    const model = buildLayerSwimlaneModel({
      densityMode: 'all',
      handoffs: [makeHandoff({ id: 'h1', toSessionId: 'S1' })],
      nodes: [],
    });

    expect(resolveSwimlaneFocusHandoffIds(model, null)).toBeNull();

    const orphanModel = buildLayerSwimlaneModel({
      densityMode: 'all',
      handoffs: [makeHandoff({ id: 'orphan' })],
      nodes: [],
    });
    expect(resolveSwimlaneFocusHandoffIds(orphanModel, 'orphan')).toBeNull();
  });
});

describe('swimlane geometry', () => {
  it('列宽 / 泳道高 / 节点高与内容需求一致', () => {
    expect(measureSwimlane(3)).toEqual({
      laneCount: FLOW_LAYERS.length,
      width: 3 * SWIMLANE_COLUMN_WIDTH,
      height: FLOW_LAYERS.length * SWIMLANE_LANE_HEIGHT,
    });
    expect(measureSwimlane(0).width).toBe(SWIMLANE_COLUMN_WIDTH);
    // 节点高度必须容得下「路由行 + 两行摘要 + 状态脚 + 内边距」，否则摘要被裁切
    expect(SWIMLANE_NODE_HEIGHT).toBeGreaterThanOrEqual(70);
    expect(SWIMLANE_NODE_HEIGHT).toBeLessThan(SWIMLANE_LANE_HEIGHT);
    expect(swimlaneColumnCenterX(1)).toBe(SWIMLANE_COLUMN_WIDTH * 1.5);
    expect(swimlaneLaneCenterY(0)).toBe(SWIMLANE_LANE_HEIGHT / 2);
    expect(swimlaneNodeLeft(0)).toBeLessThan(swimlaneColumnCenterX(0));
  });

  it('连线路径：有源节点时从源列中心到目标列中心，无源时左侧引入', () => {
    const linked = buildSwimlaneLinkPath({
      active: false,
      fromColumnIndex: 1,
      fromLayer: 'pm1',
      handoffId: 'h2',
      state: 'completed',
      toColumnIndex: 2,
      toLayer: 'pm2',
    });
    const external = buildSwimlaneLinkPath({
      active: false,
      fromColumnIndex: -1,
      fromLayer: 'reception',
      handoffId: 'h1',
      state: 'completed',
      toColumnIndex: 0,
      toLayer: 'pm1',
    });

    expect(linked.startsWith(`M ${swimlaneColumnCenterX(1)}`)).toBe(true);
    expect(linked).toContain('C ');
    expect(external.startsWith('M ')).toBe(true);
    expect(linked).not.toBe(external);
  });

  it('层索引映射：user → 接待泳道，tester → 末位泳道', () => {
    expect(resolveSwimlaneLaneIndex('reception')).toBe(0);
    expect(resolveSwimlaneLaneIndex('user')).toBe(0);
    expect(resolveSwimlaneLaneIndex('tester')).toBe(FLOW_LAYERS.length - 1);
    expect(resolveSwimlaneLaneIndex('executor')).toBe(FLOW_LAYERS.indexOf('executor'));
  });
});

describe('resolveSwimlaneLaneMetrics', () => {
  function makeLane(layer: TeamRoleLayer, overrides: Partial<SwimlaneLane> = {}): SwimlaneLane {
    return {
      active: false,
      empty: true,
      inboundCount: 0,
      label: layer,
      layer,
      lastTimeMs: null,
      sessionCount: 0,
      state: 'idle',
      ...overrides,
    };
  }

  it('空泳道折叠为窄条，剩余高度平摊给有内容的泳道', () => {
    const lanes: SwimlaneLane[] = [
      makeLane('reception'),
      makeLane('pm1', { empty: false }),
      makeLane('pm2', { empty: false }),
      makeLane('executor'),
      makeLane('reviewer', { empty: false }),
    ];

    const metrics = resolveSwimlaneLaneMetrics(lanes, 800);

    // 2 条空泳道 × 56；3 条有内容可分 (800 - 30 - 112) = 658 → 219 → 收束到上限 200
    expect(metrics[0]?.height).toBe(SWIMLANE_COMPACT_LANE_HEIGHT);
    expect(metrics[1]?.height).toBe(SWIMLANE_MAX_LANE_HEIGHT);
    expect(metrics.map((item) => item.top)).toEqual([0, 56, 256, 456, 512]);
    expect(swimlaneLaneTotalHeight(metrics)).toBe(56 + 200 + 200 + 56 + 200);
  });

  it('全部为空时保持窄条布局，不因无内容而塌陷', () => {
    const metrics = resolveSwimlaneLaneMetrics(
      FLOW_LAYERS.map((layer) => makeLane(layer)),
      800,
    );

    expect(metrics).toHaveLength(FLOW_LAYERS.length);
    expect(metrics.every((item) => item.height === SWIMLANE_COMPACT_LANE_HEIGHT)).toBe(true);
  });

  it('可用高度不足时保持下限，交由外层滚动', () => {
    const metrics = resolveSwimlaneLaneMetrics(
      FLOW_LAYERS.map((layer) => makeLane(layer, { empty: false })),
      400,
    );

    expect(metrics.every((item) => item.height === SWIMLANE_MIN_LANE_HEIGHT)).toBe(true);
  });

  it('无泳道时返回空布局', () => {
    expect(resolveSwimlaneLaneMetrics([], 800)).toEqual([]);
  });
});

describe('resolveSwimlaneColumnWidth', () => {
  it('列少时平摊铺满，列多时保持下限，极端多列不压缩', () => {
    // 12 列 / 1800px → 150px（在上下限之间，直接铺满）
    expect(resolveSwimlaneColumnWidth(12, 1800)).toBe(150);
    // 18 列 / 2000px → 111px < 下限 → 保持下限，交由横向滚动
    expect(resolveSwimlaneColumnWidth(18, 2000)).toBe(SWIMLANE_MIN_COLUMN_WIDTH);
    // 4 列 / 1800px → 450px > 上限 → 收束到上限，避免节点在超宽列里漂得过远
    expect(resolveSwimlaneColumnWidth(4, 1800)).toBe(SWIMLANE_MAX_COLUMN_WIDTH);
    // 6 列 / 1800px → 300px 在上限内 → 直接铺满
    expect(resolveSwimlaneColumnWidth(6, 1800)).toBe(300);
    // 未测量到宽度 / 无列时回退下限
    expect(resolveSwimlaneColumnWidth(8, 0)).toBe(SWIMLANE_MIN_COLUMN_WIDTH);
    expect(resolveSwimlaneColumnWidth(0, 1200)).toBe(SWIMLANE_MIN_COLUMN_WIDTH);
  });
});

describe('formatSwimlaneTimeLabel', () => {
  it('同日显示 HH:MM，跨日补 MM-DD，无效时间为 —', () => {
    const morning = new Date(2026, 8, 16, 9, 5, 0).getTime();
    const evening = new Date(2026, 8, 16, 21, 30, 0).getTime();
    const nextDay = new Date(2026, 8, 17, 1, 2, 0).getTime();

    expect(formatSwimlaneTimeLabel(morning, morning)).toBe('09:05');
    expect(formatSwimlaneTimeLabel(evening, morning)).toBe('21:30');
    expect(formatSwimlaneTimeLabel(nextDay, morning)).toBe('09-17 01:02');
    expect(formatSwimlaneTimeLabel(0, morning)).toBe('—');
  });

  it('与前一列同一分钟内显示相对增量，超过一小时回落到绝对时间', () => {
    const base = new Date(2026, 8, 16, 8, 41, 0).getTime();

    expect(formatSwimlaneTimeLabel(base + 12_000, base, base)).toBe('+12s');
    expect(formatSwimlaneTimeLabel(base + 180_000, base, base)).toBe('+3m');
    expect(formatSwimlaneTimeLabel(base + 2 * 60 * 60 * 1000, base, base)).toBe('10:41');
  });
});
