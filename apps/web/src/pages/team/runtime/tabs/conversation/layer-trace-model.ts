/**
 * 260916-层级可视化重构 · T-04 · 追踪瀑布模型（纯函数）
 *
 * 把「历史层级」会话行投影成分布式追踪（Trace）视角的瀑布：
 *   - 每个角色层一条轨道（lane）；
 *   - 每个层级会话一条时间条（bar），区间由该会话关联 handoffs 的
 *     startedAt / endedAt / updatedAt 聚合而来（无 handoff 时退化为瞬时点）；
 *   - 会话之间的交接（row.parentSessionId → row.sessionId）连成跨轨道边，
 *     打回 / 重试在图中表现为回折；
 *   - 全局时间范围做比例轴；范围退化（span ≤ 0 或有效时间点不足）时切换等宽轴，
 *     保证任何数据形态都能渲染出可点的条。
 *
 * 本文件不依赖 React，全部为可测纯函数。
 */

import type {
  HandoffEntry,
  LayerNode,
  TeamRoleLayer,
} from '../../../../../stores/team/team-events.js';
import {
  TEAM_LAYER_ORDER,
  type LayerConversationRow,
  type LayerConversationState,
} from './layered-conversation-model.js';
import { resolveFlowHandoffSessionId } from './layer-flow-state.js';

/** 时间条最小宽度占比（保证零时长交接仍可点击）。 */
export const TRACE_MIN_BAR_RATIO = 0.014;
/** 判定时间范围是否退化所需的最小有效时间点数。 */
const MIN_VALID_TIMESTAMPS = 2;

const ACTIVE_TRACE_STATES = new Set<LayerConversationState>([
  'pending',
  'claimed',
  'running',
  'paused',
]);

export interface TraceBar {
  active: boolean;
  childCount: number;
  detail: string;
  durationMs: number;
  endMs: number;
  handoffCount: number;
  layer: TeamRoleLayer;
  row: LayerConversationRow;
  sessionId: string;
  startMs: number;
  state: LayerConversationState;
  substate: string | null;
  title: string;
}

export interface TraceLane {
  bars: TraceBar[];
  layer: TeamRoleLayer;
  sessionCount: number;
  totalDurationMs: number;
}

export interface TraceEdge {
  active: boolean;
  fromSessionId: string;
  state: LayerConversationState;
  toSessionId: string;
}

export interface TraceTick {
  label: string;
  ratio: number;
}

export interface TraceModel {
  bars: TraceBar[];
  edges: TraceEdge[];
  lanes: TraceLane[];
  /** 无法按真实时间比例布局时（时间缺失或跨度过小）为 true。 */
  sequential: boolean;
  spanMs: number;
  rangeEndMs: number;
  rangeStartMs: number;
  ticks: TraceTick[];
  totalDurationMs: number;
}

export interface BuildLayerTraceModelInput {
  handoffs: Iterable<HandoffEntry>;
  nodes: Iterable<LayerNode>;
  rows: readonly LayerConversationRow[];
}

export function buildLayerTraceModel({
  handoffs,
  nodes,
  rows,
}: BuildLayerTraceModelInput): TraceModel {
  const nodeList = Array.from(nodes);
  const nodeBySession = new Map(nodeList.map((node) => [node.sessionId, node]));
  const handoffList = Array.from(handoffs);
  const handoffsByTargetSession = collectHandoffsByTargetSession(handoffList, nodeBySession);

  const bars: TraceBar[] = rows.map((row) => {
    const related = handoffsByTargetSession.get(row.sessionId) ?? [];
    const range = resolveBarRange(row, related);
    return {
      active: ACTIVE_TRACE_STATES.has(row.state),
      childCount: row.childCount,
      detail: row.detail,
      durationMs: Math.max(0, range.endMs - range.startMs),
      endMs: range.endMs,
      handoffCount: row.handoffCount,
      layer: row.roleLayer,
      row,
      sessionId: row.sessionId,
      startMs: range.startMs,
      state: row.state,
      substate: nodeBySession.get(row.sessionId)?.substate ?? null,
      title: row.title,
    };
  });

  bars.sort(compareBars);

  const lanes = buildLanes(bars);
  const edges = buildEdges(bars);
  const { rangeEndMs, rangeStartMs, sequential } = resolveRange(bars);
  const spanMs = rangeEndMs - rangeStartMs;
  const totalDurationMs = bars.reduce((sum, bar) => sum + bar.durationMs, 0);

  return {
    bars,
    edges,
    lanes,
    rangeEndMs,
    rangeStartMs,
    sequential,
    spanMs,
    ticks: buildTicks(rangeStartMs, rangeEndMs, sequential),
    totalDurationMs,
  };
}

export interface TraceBarPlacement {
  leftRatio: number;
  widthRatio: number;
}

/** 时间条在轨道内的水平位置（比例坐标 0..1）。 */
export function resolveTraceBarPlacement(bar: TraceBar, model: TraceModel): TraceBarPlacement {
  if (model.sequential) {
    const index = model.bars.indexOf(bar);
    const count = Math.max(model.bars.length, 1);
    const slot = 1 / count;
    const widthRatio = Math.max(slot * 0.8, TRACE_MIN_BAR_RATIO);
    const center = slot * index + slot / 2;
    return {
      leftRatio: clampRatio(center - widthRatio / 2),
      widthRatio,
    };
  }

  const ratio = (timeMs: number): number =>
    model.spanMs > 0 ? (timeMs - model.rangeStartMs) / model.spanMs : 0;
  const leftRatio = clampRatio(ratio(bar.startMs));
  const rawWidth = ratio(bar.endMs) - leftRatio;
  const widthRatio = Math.max(clampRatio(rawWidth), TRACE_MIN_BAR_RATIO);
  return {
    leftRatio: Math.min(leftRatio, 1 - widthRatio),
    widthRatio,
  };
}

/** 跨轨道连线路径：从源条右端到目标条左端；回折时形成 S 形弯。 */
export function buildTraceEdgePath(input: {
  fromLaneIndex: number;
  fromRatio: number;
  laneHeight: number;
  toLaneIndex: number;
  toRatio: number;
  trackWidth: number;
}): string {
  const { fromLaneIndex, fromRatio, laneHeight, toLaneIndex, toRatio, trackWidth } = input;
  const x1 = fromRatio * trackWidth;
  const y1 = fromLaneIndex * laneHeight + laneHeight / 2;
  const x2 = toRatio * trackWidth;
  const y2 = toLaneIndex * laneHeight + laneHeight / 2;
  const controlOffset = Math.max(24, Math.abs(x2 - x1) * 0.4);

  return [
    `M ${round(x1)} ${round(y1)}`,
    `C ${round(x1 + controlOffset)} ${round(y1)},`,
    `${round(x2 - controlOffset)} ${round(y2)},`,
    `${round(x2)} ${round(y2)}`,
  ].join(' ');
}

export function resolveTraceLaneIndex(model: TraceModel, layer: TeamRoleLayer): number {
  const index = model.lanes.findIndex((lane) => lane.layer === layer);
  return index >= 0 ? index : 0;
}

/** 时长展示：45s / 2m 30s / 1h 5m。 */
export function formatTraceDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) {
    return '0s';
  }
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const restSeconds = seconds % 60;
  if (minutes < 60) {
    return restSeconds > 0 ? `${minutes}m ${restSeconds}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes > 0 ? `${hours}h ${restMinutes}m` : `${hours}h`;
}

/** 时钟标签：HH:MM；无效时间为 '—'。 */
export function formatTraceClock(timeMs: number): string {
  if (!Number.isFinite(timeMs) || timeMs <= 0) {
    return '—';
  }
  const date = new Date(timeMs);
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function collectHandoffsByTargetSession(
  handoffs: readonly HandoffEntry[],
  nodeBySession: ReadonlyMap<string, LayerNode>,
): Map<string, HandoffEntry[]> {
  const result = new Map<string, HandoffEntry[]>();
  for (const handoff of handoffs) {
    const targetSessionId =
      handoff.toSessionId ?? resolveFlowHandoffSessionId(handoff, nodeBySession) ?? null;
    if (!targetSessionId) {
      continue;
    }
    const existing = result.get(targetSessionId);
    if (existing) {
      existing.push(handoff);
    } else {
      result.set(targetSessionId, [handoff]);
    }
  }
  return result;
}

function resolveBarRange(
  row: LayerConversationRow,
  related: readonly HandoffEntry[],
): { endMs: number; startMs: number } {
  if (related.length === 0) {
    return { endMs: row.timestampMs, startMs: row.timestampMs };
  }

  let startMs = Number.POSITIVE_INFINITY;
  let endMs = 0;
  for (const handoff of related) {
    const start = handoff.startedAt ?? handoff.updatedAt;
    if (start > 0 && start < startMs) {
      startMs = start;
    }
    const end = handoff.endedAt ?? handoff.updatedAt;
    if (end > endMs) {
      endMs = end;
    }
  }
  if (!Number.isFinite(startMs) || startMs === Number.POSITIVE_INFINITY) {
    startMs = endMs;
  }
  return { endMs, startMs: Math.min(startMs, endMs) };
}

function buildLanes(bars: readonly TraceBar[]): TraceLane[] {
  const lanes: TraceLane[] = [];
  for (const layer of TEAM_LAYER_ORDER) {
    const laneBars = bars.filter((bar) => bar.layer === layer);
    if (laneBars.length === 0) {
      continue;
    }
    lanes.push({
      bars: laneBars,
      layer,
      sessionCount: laneBars.length,
      totalDurationMs: laneBars.reduce((sum, bar) => sum + bar.durationMs, 0),
    });
  }
  return lanes;
}

function buildEdges(bars: readonly TraceBar[]): TraceEdge[] {
  const sessionIds = new Set(bars.map((bar) => bar.sessionId));
  const edges: TraceEdge[] = [];
  for (const bar of bars) {
    const parentSessionId = bar.row.parentSessionId;
    if (!parentSessionId || parentSessionId === bar.sessionId) {
      continue;
    }
    if (!sessionIds.has(parentSessionId)) {
      continue;
    }
    edges.push({
      active: bar.active,
      fromSessionId: parentSessionId,
      state: bar.state,
      toSessionId: bar.sessionId,
    });
  }
  return edges;
}

function resolveRange(bars: readonly TraceBar[]): {
  rangeEndMs: number;
  rangeStartMs: number;
  sequential: boolean;
} {
  const validStarts = bars.map((bar) => bar.startMs).filter((value) => value > 0);
  const validEnds = bars.map((bar) => bar.endMs).filter((value) => value > 0);
  if (validStarts.length < MIN_VALID_TIMESTAMPS || validEnds.length < MIN_VALID_TIMESTAMPS) {
    return { rangeEndMs: 0, rangeStartMs: 0, sequential: true };
  }

  const rangeStartMs = Math.min(...validStarts);
  const rangeEndMs = Math.max(...validEnds);
  if (rangeEndMs - rangeStartMs <= 0) {
    return { rangeEndMs: 0, rangeStartMs: 0, sequential: true };
  }
  return { rangeEndMs, rangeStartMs, sequential: false };
}

function buildTicks(rangeStartMs: number, rangeEndMs: number, sequential: boolean): TraceTick[] {
  if (sequential) {
    return [
      { label: '最早', ratio: 0 },
      { label: '→', ratio: 0.5 },
      { label: '最新', ratio: 1 },
    ];
  }
  const midMs = rangeStartMs + (rangeEndMs - rangeStartMs) / 2;
  return [
    { label: formatTraceClock(rangeStartMs), ratio: 0 },
    { label: formatTraceClock(midMs), ratio: 0.5 },
    { label: formatTraceClock(rangeEndMs), ratio: 1 },
  ];
}

function compareBars(left: TraceBar, right: TraceBar): number {
  if (left.startMs !== right.startMs) {
    return left.startMs - right.startMs;
  }
  if (left.endMs !== right.endMs) {
    return left.endMs - right.endMs;
  }
  return left.title.localeCompare(right.title, 'zh-CN');
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(Math.max(value, 0), 1);
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
