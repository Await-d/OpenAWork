/**
 * 260916-层级可视化重构 · 泳道轨迹模型（纯函数）
 *
 * 把 handoff 流投影成「泳道 × 时间槽」的二维轨迹：
 *   - 纵轴：角色层泳道（FLOW_LAYERS 全量保留，空层不下沉，避免连线断裂）；
 *   - 横轴：按 updatedAt 升序切出的等宽时间槽（列）；
 *   - 节点：每条 handoff 落在其 toRoleLayer 泳道、对应时间槽上；
 *   - 连线：从**源会话在前序时间槽中的真实节点**指向目标节点（找不到源节点时
 *     退化为左侧引入），因此打回 / 重试 / 多轮复用会画成真实的回折链。
 *
 * 之所以用等宽时间槽而不是真实时间比例轴：handoff 的时间分布极不均匀
 * （可能一次任务里 90% 的交接挤在几秒内、另一次跨了几小时），比例轴会让
 * 小样本不可读。时间语义由列头标签承担。
 *
 * 本文件不依赖 React，全部为可测纯函数。
 */

import type {
  HandoffEntry,
  HandoffState,
  LayerNode,
  TeamRoleLayer,
} from '../../../../../stores/team/team-events.js';
import { getRoleLayerIdentity } from '../../data/role-layer-identity.js';
import { FLOW_LAYERS, isActiveHandoffState } from './layer-flow-state.js';
import type { LayerFlowDensityMode } from './layer-flow-view-model.js';

/** 列宽下限：低于该值节点文字将不可读（列多时横向滚动，而不是压窄）。 */
export const SWIMLANE_MIN_COLUMN_WIDTH = 144;
/**
 * 列宽上限：列极少（≤6）时才生效，避免节点在超宽列里漂得过远；
 * 7 列以上基本由可视宽度平摊（铺满）。
 */
export const SWIMLANE_MAX_COLUMN_WIDTH = 320;
/** 兼容旧默认：几何函数未显式传列宽时使用下限。 */
export const SWIMLANE_COLUMN_WIDTH = SWIMLANE_MIN_COLUMN_WIDTH;
export const SWIMLANE_NODE_WIDTH = 120;
/**
 * 节点基准高度（渲染为 min-height）：需容纳「路由行 + 两行摘要 + 状态脚」+ 内边距，
 * 低于该值摘要会被裁切；同时用于节点在泳道内的垂直居中定位。
 */
export const SWIMLANE_NODE_HEIGHT = 76;
/** 泳道高度下限（节点 76 + 呼吸空间）；实际高度按可用高度自适应，见 resolveSwimlaneLaneMetrics。 */
export const SWIMLANE_MIN_LANE_HEIGHT = 96;
/** 泳道高度上限：再高节点就会在泳道里显得孤立。 */
export const SWIMLANE_MAX_LANE_HEIGHT = 200;
/** 空泳道（无会话且无交接）折叠后的高度：只容纳层名，不占用整条泳道空间。 */
export const SWIMLANE_COMPACT_LANE_HEIGHT = 56;
/** 兼容旧默认：几何函数未显式传泳道高时使用下限。 */
export const SWIMLANE_LANE_HEIGHT = SWIMLANE_MIN_LANE_HEIGHT;
export const SWIMLANE_AXIS_HEIGHT = 30;
/** 无源节点时的水平引入长度（首个时间槽左侧的过渡段）。 */
export const SWIMLANE_LINK_LEAD = 52;
/** 活跃密度下额外携带的最近历史条数（保证视图不为空、有上下文）。 */
export const SWIMLANE_ACTIVE_CONTEXT_LIMIT = 8;

export interface SwimlaneColumn {
  index: number;
  label: string;
  timeMs: number;
}

export interface SwimlaneNode {
  active: boolean;
  columnIndex: number;
  fromLayer: TeamRoleLayer;
  /** 交接来源会话；用于连线溯源与聚焦链计算。 */
  fromSessionId: string | null;
  handoffId: string;
  /** 原始目标层（可能为 tester / user，界面上仍显示真实层名）。 */
  layer: TeamRoleLayer;
  /** 归属泳道序号（tester → 评审泳道、user → 接待泳道），决定节点 y 坐标。 */
  laneIndex: number;
  retryCount: number;
  sessionId: string | null;
  state: HandoffState;
  summary: string | null;
  timeMs: number;
}

export interface SwimlaneLink {
  active: boolean;
  /** 源节点所在时间槽；-1 表示找不到源节点（如用户直接发起），改走左侧引入。 */
  fromColumnIndex: number;
  fromLayer: TeamRoleLayer;
  handoffId: string;
  state: HandoffState;
  /** 目标节点所在时间槽（= 本条 handoff 的列）。 */
  toColumnIndex: number;
  toLayer: TeamRoleLayer;
}

export interface SwimlaneLane {
  active: boolean;
  /** 无会话且无交接：渲染为折叠窄条，不占用整条泳道高度。 */
  empty: boolean;
  inboundCount: number;
  label: string;
  layer: TeamRoleLayer;
  lastTimeMs: number | null;
  sessionCount: number;
  state: HandoffState | 'idle';
}

export interface SwimlaneModel {
  columns: SwimlaneColumn[];
  lanes: SwimlaneLane[];
  links: SwimlaneLink[];
  nodes: SwimlaneNode[];
}

export interface BuildLayerSwimlaneModelInput {
  densityMode: LayerFlowDensityMode;
  handoffs: Iterable<HandoffEntry>;
  nodes: Iterable<LayerNode>;
  selectedHandoffId?: string | null;
}

/**
 * 自适应列宽：列少时把可用宽度平摊铺满（消除右侧大片空白），
 * 列多时保持下限宽度并交由横向滚动。
 */
export function resolveSwimlaneColumnWidth(columnCount: number, viewportWidth: number): number {
  if (columnCount <= 0 || viewportWidth <= 0) {
    return SWIMLANE_MIN_COLUMN_WIDTH;
  }
  const fittingWidth = viewportWidth / columnCount;
  return Math.min(Math.max(fittingWidth, SWIMLANE_MIN_COLUMN_WIDTH), SWIMLANE_MAX_COLUMN_WIDTH);
}

/** 时间槽 → 画布 x（列左边缘）。 */
export function swimlaneColumnLeft(index: number, columnWidth = SWIMLANE_COLUMN_WIDTH): number {
  return index * columnWidth;
}

/** 时间槽 → 画布 x（列中心，也是节点中心）。 */
export function swimlaneColumnCenterX(index: number, columnWidth = SWIMLANE_COLUMN_WIDTH): number {
  return swimlaneColumnLeft(index, columnWidth) + columnWidth / 2;
}

/** 节点 → 画布 x（节点左边缘，列内居中）。 */
export function swimlaneNodeLeft(index: number, columnWidth = SWIMLANE_COLUMN_WIDTH): number {
  return swimlaneColumnLeft(index, columnWidth) + (columnWidth - SWIMLANE_NODE_WIDTH) / 2;
}

/** 泳道 → 画布 y（泳道中心线）。 */
export function swimlaneLaneCenterY(index: number, laneHeight = SWIMLANE_LANE_HEIGHT): number {
  return index * laneHeight + laneHeight / 2;
}

/**
 * 泳道布局：空泳道（无会话且无交接）折叠为窄条，把高度让给有内容的泳道；
 * 有内容的泳道按剩余可用高度平摊，并夹在 [下限, 上限] 之间。
 *
 * 固定等分高度会带来两个问题：高屏上留白、内容少时空泳道占用等量高度。
 */
export function resolveSwimlaneLaneMetrics(
  lanes: readonly SwimlaneLane[],
  availableHeight: number,
): SwimlaneLaneMetrics[] {
  if (lanes.length === 0) {
    return [];
  }
  const emptyCount = lanes.filter((lane) => lane.empty).length;
  const activeCount = lanes.length - emptyCount;
  const budget = Math.max(
    availableHeight - SWIMLANE_AXIS_HEIGHT - emptyCount * SWIMLANE_COMPACT_LANE_HEIGHT,
    0,
  );
  const activeHeight =
    activeCount > 0
      ? Math.min(Math.max(budget / activeCount, SWIMLANE_MIN_LANE_HEIGHT), SWIMLANE_MAX_LANE_HEIGHT)
      : SWIMLANE_MIN_LANE_HEIGHT;

  let top = 0;
  return lanes.map((lane) => {
    const height = lane.empty ? SWIMLANE_COMPACT_LANE_HEIGHT : activeHeight;
    const metrics: SwimlaneLaneMetrics = { centerY: top + height / 2, height, top };
    top += height;
    return metrics;
  });
}

/** 各泳道中心 y（按泳道序号），供连线路径与节点定位使用。 */
export function resolveSwimlaneLaneCenters(metrics: readonly SwimlaneLaneMetrics[]): number[] {
  return metrics.map((item) => item.centerY);
}

export function swimlaneLaneTotalHeight(metrics: readonly SwimlaneLaneMetrics[]): number {
  return metrics.reduce((sum, item) => sum + item.height, 0);
}

/**
 * 把任意 TeamRoleLayer 映射到泳道序号；非 flow 层（user / tester）折叠到最近的
 * 权威层，未知层回落到接待泳道。
 */
export function resolveSwimlaneLaneIndex(layer: TeamRoleLayer): number {
  const direct = FLOW_LAYERS.indexOf(layer);
  if (direct >= 0) {
    return direct;
  }
  if (layer === 'user') {
    return 0;
  }
  if (layer === 'tester') {
    return FLOW_LAYERS.length - 1;
  }
  return 0;
}

export interface SwimlaneGeometry {
  height: number;
  laneCount: number;
  width: number;
}

/** 单条泳道的布局结果（空泳道会被折叠）。 */
export interface SwimlaneLaneMetrics {
  centerY: number;
  height: number;
  top: number;
}

export function measureSwimlane(
  columnCount: number,
  columnWidth = SWIMLANE_COLUMN_WIDTH,
  laneHeight = SWIMLANE_LANE_HEIGHT,
): SwimlaneGeometry {
  const safeColumnCount = Math.max(columnCount, 1);
  return {
    height: FLOW_LAYERS.length * laneHeight,
    laneCount: FLOW_LAYERS.length,
    width: safeColumnCount * columnWidth,
  };
}

/**
 * 连线路径：从源节点中心到目标节点中心（两端被节点卡片覆盖，视觉上即"节点相接"）。
 * 找不到源节点时从左侧引入；回折（目标在源左边）自然形成 S 形弯。
 */
export function buildSwimlaneLinkPath(
  link: SwimlaneLink,
  columnWidth = SWIMLANE_COLUMN_WIDTH,
  laneCenters: readonly number[] = [],
): string {
  const targetX = swimlaneColumnCenterX(link.toColumnIndex, columnWidth);
  const targetY = laneCenters[resolveSwimlaneLaneIndex(link.toLayer)] ?? 0;
  const sourceY = laneCenters[resolveSwimlaneLaneIndex(link.fromLayer)] ?? 0;

  if (link.fromColumnIndex >= 0) {
    const sourceX = swimlaneColumnCenterX(link.fromColumnIndex, columnWidth);
    const controlOffset = Math.max(18, Math.abs(targetX - sourceX) * 0.5);
    return [
      `M ${round(sourceX)} ${round(sourceY)}`,
      `C ${round(sourceX + controlOffset)} ${round(sourceY)},`,
      `${round(targetX - controlOffset)} ${round(targetY)},`,
      `${round(targetX)} ${round(targetY)}`,
    ].join(' ');
  }

  const startX = Math.max(0, targetX - SWIMLANE_LINK_LEAD);
  const controlOffset = Math.max(18, (targetX - startX) * 0.55);
  return [
    `M ${round(startX)} ${round(sourceY)}`,
    `C ${round(startX + controlOffset)} ${round(sourceY)},`,
    `${round(targetX - controlOffset)} ${round(targetY)},`,
    `${round(targetX)} ${round(targetY)}`,
  ].join(' ');
}

/**
 * 聚焦集合：选中某条 handoff 时，沿会话交接链（父 → 子）双向展开，
 * 返回链上全部 handoff 的 id；返回 null 表示无聚焦（全部正常显示）。
 */
export function resolveSwimlaneFocusHandoffIds(
  model: SwimlaneModel,
  selectedHandoffId: string | null,
): Set<string> | null {
  if (!selectedHandoffId) {
    return null;
  }
  const selected = model.nodes.find((node) => node.handoffId === selectedHandoffId);
  if (!selected?.sessionId) {
    return null;
  }

  const childrenBySession = new Map<string, Set<string>>();
  const parentBySession = new Map<string, string>();
  for (const node of model.nodes) {
    const sessionId = node.sessionId;
    const parentSessionId = node.fromSessionId;
    if (!sessionId || !parentSessionId || parentSessionId === sessionId) {
      continue;
    }
    const children = childrenBySession.get(parentSessionId);
    if (children) {
      children.add(sessionId);
    } else {
      childrenBySession.set(parentSessionId, new Set([sessionId]));
    }
    if (!parentBySession.has(sessionId)) {
      parentBySession.set(sessionId, parentSessionId);
    }
  }

  const chain = new Set<string>([selected.sessionId]);

  const ascended = new Set<string>([selected.sessionId]);
  let cursor = parentBySession.get(selected.sessionId);
  while (cursor && !ascended.has(cursor)) {
    ascended.add(cursor);
    chain.add(cursor);
    cursor = parentBySession.get(cursor);
  }

  const visited = new Set<string>([selected.sessionId]);
  const queue: string[] = [selected.sessionId];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) {
      break;
    }
    const children = childrenBySession.get(current);
    if (!children) {
      continue;
    }
    for (const child of children) {
      if (visited.has(child)) {
        continue;
      }
      visited.add(child);
      chain.add(child);
      queue.push(child);
    }
  }

  return new Set(
    model.nodes
      .filter((node) => node.sessionId !== null && chain.has(node.sessionId))
      .map((node) => node.handoffId),
  );
}

/**
 * 时间槽标签：与前一列同一分钟内（密集交接）显示相对增量「+12s / +2m」，
 * 否则显示绝对时间（同日 HH:MM，跨日补 MM-DD）；无效时间为 '—'。
 *
 * 之所以要做相对增量：一次任务链的交接常集中在几分钟内，逐列重复同一个 HH:MM
 * 会让时间轴失去节奏信息（用户无法判断"哪一跳拖了很久"）。
 */
export function formatSwimlaneTimeLabel(
  timeMs: number,
  firstTimeMs: number,
  previousTimeMs = 0,
): string {
  if (!Number.isFinite(timeMs) || timeMs <= 0) {
    return '—';
  }
  if (Number.isFinite(previousTimeMs) && previousTimeMs > 0 && previousTimeMs <= timeMs) {
    const deltaMs = timeMs - previousTimeMs;
    if (deltaMs > 0 && deltaMs < 60 * 60 * 1000) {
      return `+${formatSwimlaneDelta(deltaMs)}`;
    }
  }

  const date = new Date(timeMs);
  const reference = Number.isFinite(firstTimeMs) && firstTimeMs > 0 ? new Date(firstTimeMs) : null;
  const sameDay =
    reference !== null &&
    date.getFullYear() === reference.getFullYear() &&
    date.getMonth() === reference.getMonth() &&
    date.getDate() === reference.getDate();
  const time = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  return sameDay ? time : `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${time}`;
}

/** 紧凑增量：45s / 12m / 3h。 */
function formatSwimlaneDelta(deltaMs: number): string {
  const seconds = Math.max(1, Math.round(deltaMs / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  return `${Math.floor(minutes / 60)}h`;
}

export function buildLayerSwimlaneModel({
  densityMode,
  handoffs,
  nodes,
  selectedHandoffId = null,
}: BuildLayerSwimlaneModelInput): SwimlaneModel {
  const nodeList = Array.from(nodes);
  // 不再丢弃 tester / user：它们按 resolveSwimlaneLaneIndex 归入最近的权威泳道，
  // 否则会出现「泳道计数显示有交接、画布却说没有交接」的自相矛盾。
  const allEntries = Array.from(handoffs).filter((entry) => isKnownLayer(entry.toRoleLayer));
  allEntries.sort(compareByTime);
  const visibleEntries = selectVisibleEntries(allEntries, densityMode, selectedHandoffId);

  const columns: SwimlaneColumn[] = [];
  const swimlaneNodes: SwimlaneNode[] = [];
  const firstTimeMs = visibleEntries[0]?.updatedAt ?? 0;

  visibleEntries.forEach((entry, index) => {
    const active = isActiveHandoffState(entry.state);
    const previousTimeMs = index > 0 ? (visibleEntries[index - 1]?.updatedAt ?? 0) : 0;
    columns.push({
      index,
      label: formatSwimlaneTimeLabel(entry.updatedAt, firstTimeMs, previousTimeMs),
      timeMs: entry.updatedAt,
    });
    swimlaneNodes.push({
      active,
      columnIndex: index,
      fromLayer: entry.fromRoleLayer,
      fromSessionId: entry.fromSessionId ?? null,
      handoffId: entry.id,
      laneIndex: resolveSwimlaneLaneIndex(entry.toRoleLayer),
      layer: entry.toRoleLayer,
      retryCount: entry.retryCount ?? 0,
      sessionId: entry.toSessionId ?? entry.sessionId ?? null,
      state: entry.state,
      summary: entry.summary ?? null,
      timeMs: entry.updatedAt,
    });
  });

  // 源列解析需要先拿到全部节点（源会话的节点可能出现在任意更早的列）
  const nodeColumnsBySession = new Map<string, number[]>();
  for (const node of swimlaneNodes) {
    if (!node.sessionId) {
      continue;
    }
    const columns = nodeColumnsBySession.get(node.sessionId);
    if (columns) {
      columns.push(node.columnIndex);
    } else {
      nodeColumnsBySession.set(node.sessionId, [node.columnIndex]);
    }
  }

  const links: SwimlaneLink[] = swimlaneNodes.map((node) => ({
    active: node.active,
    fromColumnIndex: resolveSourceColumnIndex(
      node.fromSessionId,
      node.columnIndex,
      nodeColumnsBySession,
    ),
    fromLayer: node.fromLayer,
    handoffId: node.handoffId,
    state: node.state,
    toColumnIndex: node.columnIndex,
    toLayer: node.layer,
  }));

  return {
    columns,
    lanes: buildLanes(allEntries, nodeList),
    links,
    nodes: swimlaneNodes,
  };
}

/**
 * 源节点所在列：取源会话在目标列**之前**最近出现的一次；
 * 找不到（用户发起 / 源会话不在当前视图 / 只有更晚记录）返回 -1。
 */
function resolveSourceColumnIndex(
  fromSessionId: string | null,
  toColumnIndex: number,
  nodeColumnsBySession: ReadonlyMap<string, number[]>,
): number {
  if (!fromSessionId) {
    return -1;
  }
  const columns = nodeColumnsBySession.get(fromSessionId);
  if (!columns) {
    return -1;
  }
  let best = -1;
  for (const column of columns) {
    if (column < toColumnIndex && column > best) {
      best = column;
    }
  }
  return best;
}

function buildLanes(
  allEntries: readonly HandoffEntry[],
  nodeList: readonly LayerNode[],
): SwimlaneLane[] {
  return FLOW_LAYERS.map((layer, laneIndex) => {
    // 按泳道序号聚合（而非精确层名），tester / user 的会话与交接才能计入对应泳道
    const inbound = allEntries.filter(
      (entry) => resolveSwimlaneLaneIndex(entry.toRoleLayer) === laneIndex,
    );
    const latest = inbound[inbound.length - 1] ?? null;
    const layerNodes = nodeList.filter(
      (node) => resolveSwimlaneLaneIndex(node.roleLayer) === laneIndex,
    );
    const state: HandoffState | 'idle' =
      latest?.state ?? layerNodes.find((node) => node.state !== 'idle')?.state ?? 'idle';
    return {
      active: latest ? isActiveHandoffState(latest.state) : false,
      empty: inbound.length === 0 && layerNodes.length === 0,
      inboundCount: inbound.length,
      label: getRoleLayerIdentity(layer).label,
      layer,
      lastTimeMs: latest?.updatedAt ?? null,
      sessionCount: layerNodes.length,
      state,
    };
  });
}

/**
 * 密度模式：
 *   - all：全部交接；
 *   - active：活跃交接 ∪ 最近 SWIMLANE_ACTIVE_CONTEXT_LIMIT 条历史（保留上下文，
 *     避免"没有活跃流动时整页空白"），并始终保留当前选中项。
 */
function selectVisibleEntries(
  entries: readonly HandoffEntry[],
  densityMode: LayerFlowDensityMode,
  selectedHandoffId: string | null,
): HandoffEntry[] {
  if (densityMode === 'all') {
    return [...entries];
  }

  const selected = new Set<string>();
  for (const entry of entries) {
    if (isActiveHandoffState(entry.state) || entry.id === selectedHandoffId) {
      selected.add(entry.id);
    }
  }
  for (const entry of entries.slice(-SWIMLANE_ACTIVE_CONTEXT_LIMIT)) {
    selected.add(entry.id);
  }

  return entries.filter((entry) => selected.has(entry.id));
}

/** 已知层：权威 5 层 + 前端事件层的 tester / user（后者归入最近泳道而不是被丢弃）。 */
const KNOWN_LAYERS = new Set<TeamRoleLayer>([...FLOW_LAYERS, 'tester', 'user']);

function isKnownLayer(layer: TeamRoleLayer): boolean {
  return KNOWN_LAYERS.has(layer);
}

function compareByTime(left: HandoffEntry, right: HandoffEntry): number {
  if (left.updatedAt !== right.updatedAt) {
    return left.updatedAt - right.updatedAt;
  }
  return left.id.localeCompare(right.id, 'zh-CN');
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
