/**
 * 知识图谱 · G6 v5 运行时辅助（非 React）。
 *
 * 该模块只做三件事，便于宿主组件保持精简并可独立推理：
 *   1. 把 `KnowledgeGraph` + 力导向布局 + 焦点态编译成 G6 `GraphData`（含样式、状态、标签密度）；
 *   2. 创建 / 销毁 G6 实例（WebGL 优先，回退默认 canvas 渲染器）；
 *   3. 读写视口（pan / zoom）与焦点播报文案。
 *
 * 全部逻辑为纯函数或对 G6 实例的显式封装，不持有 React 状态。
 */

import {
  Graph,
  GraphEvent,
  CanvasEvent,
  NodeEvent,
  type CustomBehaviorOption,
  type CustomPluginOption,
  type EdgeData,
  type GraphData,
  type GraphOptions,
  type ID,
  type IElementEvent,
  type NodeData,
  type Point,
  type State,
} from '@antv/g6';
import { Renderer as CanvasRenderer } from '@antv/g-canvas';
import { Renderer as WebGLRenderer } from '@antv/g-webgl';
import type { GraphNode, KnowledgeGraph } from '../../../data/build-knowledge-graph.js';
import {
  CONTAINS_EDGE_TYPE,
  DERIVES_EDGE_TYPE,
  registerGraphEdgeExtensions,
  shouldSuppressContainsEdge,
} from './knowledge-graph-edges.js';
import type { GraphFocusState } from './knowledge-graph-focus.js';
import {
  computeForceLayout,
  reheatForceNeighbourhood,
  type ForceLayoutResult,
} from './knowledge-graph-force.js';
import {
  selectVisibleLabels,
  shouldShowNodeLabel,
  type LabelCandidate,
} from './knowledge-graph-labels.js';
import { layoutRadialTree, type GraphViewportSize } from './knowledge-graph-layout.js';
import type { GraphModel } from './knowledge-graph-model.js';
import type { GraphPinMap, GraphPinUpdate } from './knowledge-graph-pins.js';
import { GRAPH_NODE_TYPE, registerGraphNodeExtensions } from './knowledge-graph-nodes.js';
import {
  buildEdgeStyle,
  buildNodeStyle,
  nodeFootprintRadius,
  type GraphColorMode,
  type GraphPalette,
} from './knowledge-graph-style.js';
import { NEBULA_THEME_NAME, registerNebulaTheme } from './knowledge-graph-theme.js';

/** 标签密度三态：自动（当前行为）/ 全部 / 只显示焦点与选中。 */
export type KnowledgeGraphLabelDensity = 'auto' | 'all' | 'focus';

/** 兼容旧画布导出的命名；新渲染层的单一事实来源是 `GraphColorMode`。 */
export type KnowledgeGraphColorMode = GraphColorMode;

export const GRAPH_ZOOM_MIN = 0.35;
export const GRAPH_ZOOM_MAX = 2.8;
export const GRAPH_ZOOM_RANGE: [number, number] = [GRAPH_ZOOM_MIN, GRAPH_ZOOM_MAX];
export const GRAPH_VIEWPORT_EPSILON = 0.0001;

/** G6 事件名：集中导出，避免宿主散落字符串字面量。 */
export const GRAPH_NODE_CLICK_EVENT = NodeEvent.CLICK;
export const GRAPH_NODE_POINTER_ENTER_EVENT = NodeEvent.POINTER_ENTER;
export const GRAPH_NODE_POINTER_LEAVE_EVENT = NodeEvent.POINTER_LEAVE;
export const GRAPH_NODE_POINTER_DOWN_EVENT = NodeEvent.POINTER_DOWN;
export const GRAPH_NODE_DRAG_EVENT = NodeEvent.DRAG;
export const GRAPH_CANVAS_POINTER_LEAVE_EVENT = CanvasEvent.POINTER_LEAVE;
export const GRAPH_AFTER_TRANSFORM_EVENT = GraphEvent.AFTER_TRANSFORM;

/** 节点拖拽行为 / hover 提示框插件标识（G6 内置扩展，按 type 解析）。 */
export const GRAPH_NODE_DRAG_BEHAVIOR_TYPE = 'drag-element';
export const GRAPH_NODE_DRAG_BEHAVIOR_KEY = 'openawork-node-drag';
export const GRAPH_TOOLTIP_PLUGIN_TYPE = 'tooltip';
export const GRAPH_TOOLTIP_PLUGIN_KEY = 'openawork-node-tooltip';

export interface GraphPan {
  readonly x: number;
  readonly y: number;
}

export interface GraphViewport {
  readonly zoom: number;
  readonly pan: GraphPan;
}

export interface BuildGraphDataInput {
  readonly graph: KnowledgeGraph;
  readonly model: GraphModel;
  readonly focusState: GraphFocusState;
  readonly colorMode: GraphColorMode;
  readonly labelDensity: KnowledgeGraphLabelDensity;
  readonly viewport: GraphViewportSize;
  readonly pins: GraphPinMap;
  readonly zoom: number;
  readonly selectedNodeId: string | null;
  readonly focusNodeId: string | null;
  readonly palette: GraphPalette;
}

/** 一次布局解算的度量：状态条 / QA 用于报告 settle 时间与重叠。 */
export interface GraphLayoutMetrics {
  readonly visibleNodeCount: number;
  readonly visibleEdgeCount: number;
  /** 力布局从种子解算到 settle 的耗时（ms）；缓存命中时为 0。 */
  readonly settleMs: number;
  /** 最终任意两绘制盘的最大重叠量（px，≥0）。 */
  readonly worstOverlap: number;
}

export interface GraphDataBundle {
  readonly data: GraphData;
  readonly states: Record<string, State[]>;
  readonly metrics: GraphLayoutMetrics;
}

/**
 * `lineDashOffset` 是自定义 derives 边的流动开关：只有它是**数值**时才播放动画。
 *
 * G6 的 `updateEdgeData` 对 `style` 做浅合并，旧的 `lineDashOffset` 不会被自动删除，
 * 因此非动画边必须显式写入 `undefined`——G6 属性更新会用 `Object.assign` 覆盖该键，
 * `typeof undefined !== 'number'` 于是可靠地停掉旧动画。缺省该键会导致
 * 「切换焦点后上一条 derives 边仍在流动」的脏动画。
 */
function withAnimationSwitch(
  style: Record<string, unknown>,
  animating: boolean,
): Record<string, unknown> {
  return { ...style, lineDashOffset: animating ? 0 : undefined };
}

/**
 * 最终几何：径向环只作为**弱种子**，力导向解算产出自组织、不均匀的有机形态。
 * 同一 `model` / 视口 / pins 只解算一次（缓存），焦点 / 配色变化不触发重算。
 */
function resolveForceLayout(
  model: GraphModel,
  viewport: GraphViewportSize,
  pins: GraphPinMap,
): ForceLayoutResult {
  return computeForceLayout(model, viewport, pins, () => layoutRadialTree(model, viewport, pins));
}

/**
 * 拖拽 reheating：从当前实时坐标出发，只重解被拖节点的有界邻域，邻居弹性让位。
 * 被拖节点与已固定点作为硬约束不动；返回邻域内节点的新坐标。
 */
export function computeReheatedPositions(input: {
  readonly model: GraphModel;
  readonly viewport: GraphViewportSize;
  readonly pins: GraphPinMap;
  readonly positions: ReadonlyMap<string, { readonly x: number; readonly y: number }>;
  readonly dragId: string;
}): Map<string, { readonly x: number; readonly y: number }> {
  return reheatForceNeighbourhood(input);
}

/**
 * 每个节点入射的 `contains` 度数。展开某个大分类后，其父节点会一次性挂出几十条 contains，
 * 样式层据此把非聚焦的边扇整体压暗、变细（度数取边两端较大者）。
 */
function computeContainsFanByNode(model: GraphModel): Map<string, number> {
  const fan = new Map<string, number>();
  for (const edge of model.edges) {
    if (edge.kind !== 'contains') {
      continue;
    }
    fan.set(edge.from, (fan.get(edge.from) ?? 0) + 1);
    fan.set(edge.to, (fan.get(edge.to) ?? 0) + 1);
  }
  return fan;
}

/** 编译一次完整的 G6 图数据（节点 + 边）与元素状态表。 */
export function buildKnowledgeGraphData(input: BuildGraphDataInput): GraphDataBundle {
  const {
    graph,
    model,
    focusState,
    colorMode,
    labelDensity,
    viewport,
    pins,
    zoom,
    selectedNodeId,
    focusNodeId,
    palette,
  } = input;
  const layout = resolveForceLayout(model, viewport, pins);
  const positioned = layout.positions;
  const states: Record<string, State[]> = {};
  const nodes: NodeData[] = [];
  const labelCandidates: LabelCandidate[] = [];

  // 第一遍只收集「有资格显示标签」的候选；标签是否真正绘制取决于跨节点的碰撞消歧，
  // 而单个 `shouldShowNodeLabel` 是无跨节点状态的，因此这里先收集、后裁决。
  positioned.forEach((positionedNode, index) => {
    const node = positionedNode.model;
    const focused = focusState.nodeIds.has(node.id);
    const eligible = shouldShowNodeLabel({
      collapsed: node.collapsed === true,
      depth: node.depth,
      focusActive: focusState.active,
      focused,
      hasHiddenCount: (node.descendantCount ?? 0) > 0,
      labelDensity,
      node: node.node,
      selected: node.id === focusNodeId,
      visibleIndex: index,
      zoom,
    });
    if (!eligible) {
      return;
    }
    labelCandidates.push({
      id: node.id,
      kind: node.kind,
      depth: node.depth,
      persisted: node.persisted,
      // 只有选中 / 聚焦是「绝不丢弃」；折叠聚合在消歧里单独提权（`aggregate` 排序键 +
      // 预算豁免），但仍要避让节点圆，否则长聚合标签会覆盖同环邻居的圆盘。
      highlighted: node.id === focusNodeId || node.id === selectedNodeId,
      aggregate: node.collapsed === true,
      descendantCount: node.descendantCount ?? 0,
      x: positionedNode.x,
      y: positionedNode.y,
      radius: positionedNode.radius,
      label: node.label,
      index,
    });
  });

  // `all` 是用户显式要求「全部显示」的模式：不做碰撞消歧，保留全部候选标签；
  // `auto` / `focus` 才走贪心消歧，避免密集区标签叠在一起无法阅读。
  const visibleLabels =
    labelDensity === 'all'
      ? new Set(labelCandidates.map((candidate) => candidate.id))
      : selectVisibleLabels(labelCandidates, {
          // 占用集合登记节点的**完整渲染足迹**（关键圆 + 主层柔光盘），而不是关键圆半径：
          // 标签层绘制在节点主层之下，落进任一节点足迹的标签都会被主层切断。
          obstacles: positioned.map((positionedNode) => ({
            id: positionedNode.model.id,
            x: positionedNode.x,
            y: positionedNode.y,
            radius: nodeFootprintRadius(
              positionedNode.model.collapsed === true,
              positionedNode.model.descendantCount ?? 0,
              positionedNode.radius,
            ),
          })),
        });

  for (const positionedNode of positioned) {
    const node = positionedNode.model;
    const selected = node.id === selectedNodeId;
    const focused = focusState.nodeIds.has(node.id);
    const dimmed = focusState.active && !focused;
    const showLabel = visibleLabels.has(node.id);

    const nodeStyle = buildNodeStyle(node, {
      breathing: node.id === focusNodeId,
      colorMode,
      palette,
      focused,
      selected,
      dimmed,
      showLabel,
      radius: positionedNode.radius,
    });
    const nodeStates: State[] = [];
    if (selected) {
      nodeStates.push('selected');
    }
    if (node.persisted) {
      nodeStates.push('persisted');
    }
    if (dimmed) {
      nodeStates.push('inactive');
    }
    states[node.id] = nodeStates;

    nodes.push({
      id: node.id,
      type: GRAPH_NODE_TYPE,
      data: { kind: node.kind },
      style: { ...nodeStyle, x: positionedNode.x, y: positionedNode.y },
      states: nodeStates,
    });
  }

  const containsFanByNode = computeContainsFanByNode(model);
  const positionedById = new Map<string, { readonly x: number; readonly y: number }>();
  for (const positionedNode of positioned) {
    positionedById.set(positionedNode.model.id, { x: positionedNode.x, y: positionedNode.y });
  }
  const edges: EdgeData[] = [];
  for (const edge of model.edges) {
    const focused = focusState.edgeIds.has(edge.id);
    const dimmed = focusState.active && !focused;
    const animating = edge.kind === 'derives' && focused;
    const fan = Math.max(
      containsFanByNode.get(edge.from) ?? 0,
      containsFanByNode.get(edge.to) ?? 0,
    );
    // 非聚焦的高扇 contains 子边不绘制：同心环已表达层级，星芒只会淹没结构（DEFECT A）。
    const suppressed = shouldSuppressContainsEdge({ kind: edge.kind, fan, focused });
    const from = positionedById.get(edge.from);
    const to = positionedById.get(edge.to);
    const chordLength = from && to ? Math.hypot(to.x - from.x, to.y - from.y) : 0;
    const edgeStyle = buildEdgeStyle(edge, {
      palette,
      focused,
      dimmed,
      animating,
      fan,
      chordLength,
      suppressed,
    });
    const edgeStates: State[] = dimmed ? ['inactive'] : [];
    states[edge.id] = edgeStates;

    edges.push({
      id: edge.id,
      source: edge.from,
      target: edge.to,
      type: edge.kind === 'derives' ? DERIVES_EDGE_TYPE : CONTAINS_EDGE_TYPE,
      data: { kind: edge.kind },
      style: withAnimationSwitch(edgeStyle, animating),
      states: edgeStates,
    });
  }

  return {
    data: { nodes, edges },
    states,
    metrics: {
      visibleNodeCount: positioned.length,
      visibleEdgeCount: edges.length,
      settleMs: layout.settleMs,
      worstOverlap: layout.worstOverlap,
    },
  };
}

export interface CreateKnowledgeGraphInput {
  readonly container: HTMLElement;
  readonly palette: GraphPalette;
  readonly useWebGL: boolean;
  readonly onNodeDragEnd?: (updates: readonly GraphPinUpdate[]) => void;
  readonly onNodeTooltip?: (nodeId: string) => HTMLElement | null;
}

/**
 * 创建 G6 实例（不渲染）。
 *
 * `renderer` 是**按图层**调用的回调，G6 默认启用四层（background / main / label /
 * transient）。这里只让 `main` 层走 WebGL——节点与边的几何都在该层，是真正吃性能的
 * 部分；其余图层使用内置 Canvas 渲染器。原因有二：
 *   1. WebGL 渲染器画不出文字（antvis/G6#5334），`label` 层的标签一旦走 WebGL 就只剩
 *      背景框而没有文本；
 *   2. 每层都建 WebGLRenderer 会产生 4 个 WebGL 上下文，只保留 main 层可降到 1 个。
 * G6 会把视口变换同步到所有图层的相机，因此分层混用渲染器不会造成对位错位。
 */
export function createKnowledgeGraph(input: CreateKnowledgeGraphInput): Graph {
  const { container, palette, useWebGL, onNodeDragEnd, onNodeTooltip } = input;
  registerNebulaTheme(palette);
  registerGraphNodeExtensions();
  registerGraphEdgeExtensions();

  // `parseExtensions` 以 `graph` 为 `this` 调用该工厂，因此 onFinish 里可读到移动后的真实坐标。
  const dragElementBehavior = function (this: Graph): CustomBehaviorOption {
    return {
      type: GRAPH_NODE_DRAG_BEHAVIOR_TYPE,
      key: GRAPH_NODE_DRAG_BEHAVIOR_KEY,
      dropEffect: 'none',
      hideEdge: 'none',
      onFinish: (ids: ID[]) => {
        if (!onNodeDragEnd) {
          return;
        }
        const updates: GraphPinUpdate[] = [];
        for (const id of ids) {
          const position = this.getElementPosition(id);
          updates.push({
            id: String(id),
            x: Number(position[0] ?? 0),
            y: Number(position[1] ?? 0),
          });
        }
        onNodeDragEnd(updates);
      },
    };
  };

  // `container` 由 G6 在展示时按画布位置推导，这里不传，避免覆盖默认定位。
  const tooltipOptions: CustomPluginOption = {
    type: GRAPH_TOOLTIP_PLUGIN_TYPE,
    key: GRAPH_TOOLTIP_PLUGIN_KEY,
    trigger: 'hover',
    enterable: false,
    onOpenChange: (open: boolean) => {
      container.dataset.graphTooltipVisible = open ? 'true' : 'false';
    },
    getContent: async (event: IElementEvent) => {
      const nodeId = elementIdFromEvent(event);
      if (!nodeId || !onNodeTooltip) {
        return '';
      }
      return onNodeTooltip(nodeId) ?? '';
    },
  };

  const options: GraphOptions = {
    container,
    autoResize: true,
    background: palette.bgBase,
    zoomRange: GRAPH_ZOOM_RANGE,
    theme: NEBULA_THEME_NAME,
    behaviors: ['drag-canvas', 'zoom-canvas', dragElementBehavior],
    plugins: [tooltipOptions],
    ...(useWebGL
      ? {
          renderer: (layer) => (layer === 'main' ? new WebGLRenderer() : new CanvasRenderer()),
        }
      : {}),
  };

  return new Graph(options);
}

function toPoint(point: Point): GraphPan {
  return { x: Number(point[0] ?? 0), y: Number(point[1] ?? 0) };
}

/** 读取当前视口（zoom 与 pan）。`getPosition()` 与 `translateTo()` 互逆，默认值为 0。 */
export function readViewport(graph: Graph): GraphViewport {
  return { zoom: graph.getZoom(), pan: toPoint(graph.getPosition()) };
}

function differs(left: number, right: number): boolean {
  return Math.abs(left - right) > GRAPH_VIEWPORT_EPSILON;
}

/** 按目标视口应用 zoom / 平移；与当前值相等时跳过，避免无意义的重排。 */
export async function applyViewport(graph: Graph, viewport: GraphViewport): Promise<void> {
  if (graph.destroyed) {
    return;
  }
  const current = readViewport(graph);
  if (differs(current.zoom, viewport.zoom)) {
    await graph.zoomTo(viewport.zoom, false);
  }
  if (differs(current.pan.x, viewport.pan.x) || differs(current.pan.y, viewport.pan.y)) {
    await graph.translateTo([viewport.pan.x, viewport.pan.y], false);
  }
}

/** 节点副标题（与旧画布 `nodeCaption` 保持一致）。 */
export function nodeCaption(node: GraphNode): string {
  if (node.kind === 'artifact') {
    return node.state ? `产物 · ${node.state}` : '产物';
  }
  if (node.kind === 'category') {
    return node.detail ?? '分类';
  }
  return node.detail ?? node.state ?? '知识';
}

/** 无障碍焦点播报文案；无焦点时返回 null（live region 随之清空）。 */
export function buildFocusAnnouncement(
  model: GraphModel,
  focusNodeId: string | null,
): string | null {
  if (!focusNodeId) {
    return null;
  }
  const node = model.byId.get(focusNodeId);
  if (!node) {
    return null;
  }
  return `焦点：${node.label} · ${nodeCaption(node.node)}`;
}

/** 提取事件目标节点 id；仅当目标确实是图元素时返回字符串。 */
export function elementIdFromEvent(event: IElementEvent): string | null {
  const id = event.target?.id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}
