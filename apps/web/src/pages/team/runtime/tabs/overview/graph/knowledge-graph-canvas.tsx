/**
 * 知识图谱 · G6 v5 画布宿主组件。
 *
 * 只负责三件事：持有 G6 实例、把 React props 同步进 G6、把 G6 交互回写为回调。
 * 全部非 React 逻辑（数据编译、实例创建、视口读写、播报文案）都在
 * `knowledge-graph-runtime.ts`，本文件保持精简（< 500 行）。
 *
 * 交互契约与旧 d3-force 画布保持功能对齐：
 *   - 悬停与选中共享同一条焦点管线（hovered ?? selected）；
 *   - 点击节点 → `onSelectNode`；拖拽超过 3px 阈值则不触发选中，并把位置固定为用户 pin；
 *   - 悬停节点由 G6 tooltip 插件展示标签 / 类型 / 详情；
 *   - 滚轮缩放锚定光标并钳制在 0.35–2.8；
 *   - 视口变化回写 `onPanChange` / `onZoomChange`；容器尺寸变化时重算径向布局；
 *   - `resetVersion` 自增把视口复位为 zoom 1 / pan 0，并清空全部 pin；
 *   - 非焦点元素只降透明度，不改色相；只有聚焦的 derives 边流动。
 */

import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import type { Graph, IElementDragEvent, IElementEvent } from '@antv/g6';
import type { KnowledgeGraph } from '../../../data/build-knowledge-graph.js';
import { logger } from '../../../../../../utils/log/logger.js';
import type { KnowledgeGraphCanvasProps } from './knowledge-graph-canvas-types.js';
import { KnowledgeGraphCanvasOverlays } from './knowledge-graph-canvas-overlays.js';
import { createDragFollow, type DragFollowController } from './knowledge-graph-drag-follow.js';
import { computeGraphFocusState } from './knowledge-graph-focus.js';
import {
  applyCanvasA11y,
  CANVAS_ARIA_LABEL,
  createGraphResizeObserver,
  safeDestroyGraph,
} from './knowledge-graph-instance.js';
import { nodeDragExceededThreshold } from './knowledge-graph-interaction.js';
import type { GraphViewportSize } from './knowledge-graph-layout.js';
import { buildGraphModel, type GraphModel } from './knowledge-graph-model.js';
import {
  EMPTY_GRAPH_PINS,
  clearGraphPins,
  recordGraphPins,
  type GraphPinMap,
} from './knowledge-graph-pins.js';
import {
  GRAPH_AFTER_TRANSFORM_EVENT,
  GRAPH_CANVAS_POINTER_LEAVE_EVENT,
  GRAPH_NODE_CLICK_EVENT,
  GRAPH_NODE_DRAG_EVENT,
  GRAPH_NODE_POINTER_DOWN_EVENT,
  GRAPH_NODE_POINTER_ENTER_EVENT,
  GRAPH_NODE_POINTER_LEAVE_EVENT,
  GRAPH_VIEWPORT_EPSILON,
  applyViewport,
  buildFocusAnnouncement,
  buildKnowledgeGraphData,
  createKnowledgeGraph,
  elementIdFromEvent,
  readViewport,
  type GraphViewport,
} from './knowledge-graph-runtime.js';
import { resolveGraphPalette, type GraphPalette } from './knowledge-graph-style.js';
import { buildGraphTooltipElement } from './knowledge-graph-tooltip.js';
import { prefersReducedMotion } from './knowledge-graph-theme.js';
import './knowledge-graph-tooltip.css';

export type {
  KnowledgeGraphColorMode,
  KnowledgeGraphLabelDensity,
} from './knowledge-graph-runtime.js';

type CanvasAvailability = 'initializing' | 'ready' | 'unavailable';

const RESET_VIEWPORT: GraphViewport = { zoom: 1, pan: { x: 0, y: 0 } };

export function KnowledgeGraphCanvas({
  capacityBlockedIds,
  collapsedIds,
  colorMode,
  counts,
  graph,
  labelDensity,
  onLayoutMetrics,
  onPanChange,
  onSelectNode,
  onToggleExpand,
  onViewportSizeChange,
  onZoomChange,
  pan,
  resetVersion,
  selectedNodeId,
  zoom,
}: KnowledgeGraphCanvasProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const readyRef = useRef<Promise<void> | null>(null);
  const paletteRef = useRef<GraphPalette | null>(null);
  const dataGraphRef = useRef<KnowledgeGraph | null>(null);
  const suppressViewportRef = useRef(false);
  const viewportReadyRef = useRef(false);
  const lastViewportRef = useRef<GraphViewport>(RESET_VIEWPORT);
  const lastResetRef = useRef(resetVersion);
  const callbacksRef = useRef({
    onLayoutMetrics,
    onPanChange,
    onSelectNode,
    onToggleExpand,
    onViewportSizeChange,
    onZoomChange,
  });
  const viewportSizeRef = useRef<GraphViewportSize | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const dragExceededRef = useRef(false);
  const modelRef = useRef<GraphModel | null>(null);
  const dragFollowRef = useRef<DragFollowController | null>(null);
  const pinsRef = useRef<GraphPinMap>(EMPTY_GRAPH_PINS);
  const [availability, setAvailability] = useState<CanvasAvailability>('initializing');
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [viewportSize, setViewportSize] = useState<GraphViewportSize | null>(null);
  const [pins, setPins] = useState<GraphPinMap>(EMPTY_GRAPH_PINS);

  useEffect(() => {
    callbacksRef.current = {
      onLayoutMetrics,
      onPanChange,
      onSelectNode,
      onToggleExpand,
      onViewportSizeChange,
      onZoomChange,
    };
  }, [
    onLayoutMetrics,
    onPanChange,
    onSelectNode,
    onToggleExpand,
    onViewportSizeChange,
    onZoomChange,
  ]);

  const model = useMemo(
    () => buildGraphModel(graph, { collapsedIds, counts }),
    [collapsedIds, counts, graph],
  );
  const focusNodeId = hoveredNodeId ?? selectedNodeId;
  const focusState = useMemo(
    () => computeGraphFocusState(graph, focusNodeId),
    [graph, focusNodeId],
  );
  const focusAnnouncement = useMemo(
    () => buildFocusAnnouncement(model, focusNodeId),
    [model, focusNodeId],
  );
  const layoutViewport = useMemo<GraphViewportSize>(
    () => ({ width: viewportSize?.width ?? 0, height: viewportSize?.height ?? 0 }),
    [viewportSize],
  );

  useEffect(() => {
    modelRef.current = model;
  }, [model]);

  useEffect(() => {
    pinsRef.current = pins;
  }, [pins]);

  useEffect(() => {
    if (hoveredNodeId !== null && !model.byId.has(hoveredNodeId)) {
      setHoveredNodeId(null);
    }
  }, [hoveredNodeId, model]);

  // 创建 G6 实例：WebGL 优先，失败则回退默认 canvas 渲染器，再失败进入不可用面板。
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const palette = resolveGraphPalette();
    paletteRef.current = palette;
    let disposed = false;
    let observer: ResizeObserver | null = null;

    // 只在尺寸真正变化时更新，避免 ResizeObserver 与 React 之间来回触发。
    const applyViewportSize = (size: GraphViewportSize) => {
      const previous = viewportSizeRef.current;
      if (previous && previous.width === size.width && previous.height === size.height) {
        return;
      }
      viewportSizeRef.current = size;
      setViewportSize(size);
      callbacksRef.current.onViewportSizeChange?.(size);
    };

    const emitViewport = () => {
      const instance = graphRef.current;
      if (
        !instance ||
        !viewportReadyRef.current ||
        instance.destroyed ||
        suppressViewportRef.current
      ) {
        return;
      }
      const viewport = readViewport(instance);
      const previous = lastViewportRef.current;
      const zoomChanged = Math.abs(previous.zoom - viewport.zoom) > GRAPH_VIEWPORT_EPSILON;
      const panChanged =
        Math.abs(previous.pan.x - viewport.pan.x) > GRAPH_VIEWPORT_EPSILON ||
        Math.abs(previous.pan.y - viewport.pan.y) > GRAPH_VIEWPORT_EPSILON;
      lastViewportRef.current = viewport;
      if (zoomChanged) {
        callbacksRef.current.onZoomChange(viewport.zoom);
      }
      if (panChanged) {
        callbacksRef.current.onPanChange({ x: viewport.pan.x, y: viewport.pan.y });
      }
    };

    const attach = (instance: Graph) => {
      instance.on<IElementEvent>(GRAPH_NODE_POINTER_DOWN_EVENT, (event) => {
        dragStartRef.current = { x: event.canvas.x, y: event.canvas.y };
        dragExceededRef.current = false;
      });
      instance.on<IElementDragEvent>(GRAPH_NODE_DRAG_EVENT, (event) => {
        const start = dragStartRef.current;
        if (!start) {
          return;
        }
        if (
          nodeDragExceededThreshold({
            currentX: event.canvas.x,
            currentY: event.canvas.y,
            startX: start.x,
            startY: start.y,
          })
        ) {
          dragExceededRef.current = true;
        }
        if (dragExceededRef.current) {
          const draggedId = elementIdFromEvent(event);
          if (draggedId) {
            dragFollowRef.current?.move(draggedId);
          }
        }
      });
      instance.on<IElementEvent>(GRAPH_NODE_CLICK_EVENT, (event) => {
        const nodeId = elementIdFromEvent(event);
        if (!nodeId) {
          return;
        }
        // 超过阈值说明这是一次拖拽；吞掉随之而来的 click，避免拖完顺手改选中。
        if (dragExceededRef.current) {
          dragExceededRef.current = false;
          return;
        }
        // 非叶节点用点击切换展开/收起（与「选中叶子」是两种手势）；叶子才喂给检查器。
        const currentModel = modelRef.current;
        const entry = currentModel?.byId.get(nodeId);
        const hasVisibleChildren = (currentModel?.childrenOf.get(nodeId)?.length ?? 0) > 0;
        if (entry?.collapsed === true || hasVisibleChildren) {
          callbacksRef.current.onToggleExpand?.(nodeId);
          return;
        }
        callbacksRef.current.onSelectNode(nodeId);
      });
      instance.on<IElementEvent>(GRAPH_NODE_POINTER_ENTER_EVENT, (event) => {
        const nodeId = elementIdFromEvent(event);
        if (nodeId) {
          setHoveredNodeId(nodeId);
        }
      });
      instance.on<IElementEvent>(GRAPH_NODE_POINTER_LEAVE_EVENT, () => {
        setHoveredNodeId(null);
      });
      instance.on(GRAPH_CANVAS_POINTER_LEAVE_EVENT, () => {
        setHoveredNodeId(null);
      });
      instance.on(GRAPH_AFTER_TRANSFORM_EVENT, emitViewport);
    };

    /**
     * G6 只有在 `render()` 完成后才建立 `context.viewport`，而在此之前
     * `getZoom()` / `getPosition()` 会抛错。因此实例必须先渲染成功再对外发布：
     * 先 `render()`，成功后才写入 `graphRef`、置就绪标记并注册事件监听。
     * 监听器绝不能提前注册，否则初始化期间触发的事件回调会打断渲染。
     */
    const boot = async (useWebGL: boolean, rendererLabel: string): Promise<void> => {
      const instance = createKnowledgeGraph({
        container,
        palette,
        useWebGL,
        onNodeDragEnd: (updates) => {
          dragFollowRef.current?.stop();
          // 未越过拖拽阈值（例如长按单击）不固定节点，保持「点选」语义。
          if (!dragExceededRef.current) {
            return;
          }
          setPins((current) => recordGraphPins(current, updates));
        },
        onNodeTooltip: (nodeId) => {
          const node = modelRef.current?.byId.get(nodeId);
          return node ? buildGraphTooltipElement(node) : null;
        },
      });
      try {
        await instance.render();
      } catch (error) {
        safeDestroyGraph(instance);
        throw error;
      }
      if (disposed) {
        safeDestroyGraph(instance);
        return;
      }
      graphRef.current = instance;
      viewportReadyRef.current = true;
      attach(instance);
      applyCanvasA11y(container, rendererLabel);
      dragFollowRef.current = createDragFollow({
        graph: instance,
        getModel: () => modelRef.current,
        getPins: () => pinsRef.current,
        getViewport: () => viewportSizeRef.current,
        reducedMotion: prefersReducedMotion(),
      });
      observer = createGraphResizeObserver(container, instance, applyViewportSize);
      if (container.clientWidth > 0 && container.clientHeight > 0) {
        applyViewportSize({ width: container.clientWidth, height: container.clientHeight });
      }
      setAvailability('ready');
    };

    const initialize = async () => {
      try {
        await boot(true, 'g6-webgl');
        return;
      } catch (error) {
        logger.warn('知识图谱 WebGL 渲染器初始化失败，回退默认画布渲染器', error);
      }
      try {
        await boot(false, 'g6-canvas');
      } catch (error) {
        logger.warn('知识图谱画布渲染器初始化失败', error);
        if (!disposed) {
          setAvailability('unavailable');
        }
      }
    };

    readyRef.current = initialize();

    return () => {
      disposed = true;
      viewportReadyRef.current = false;
      dragFollowRef.current?.dispose();
      dragFollowRef.current = null;
      observer?.disconnect();
      observer = null;
      safeDestroyGraph(graphRef.current);
      graphRef.current = null;
      readyRef.current = null;
      dataGraphRef.current = null;
      container.replaceChildren();
    };
  }, []);

  // 数据 / 样式 / 状态同步：结构变化走 setData，仅样式变化走 update*，随后统一绘制。
  useEffect(() => {
    const palette = paletteRef.current;
    if (!palette) {
      return;
    }
    let cancelled = false;

    const run = async () => {
      await readyRef.current;
      if (cancelled) {
        return;
      }
      const instance = graphRef.current;
      if (!instance || instance.destroyed) {
        return;
      }
      const bundle = buildKnowledgeGraphData({
        colorMode,
        focusNodeId,
        focusState,
        graph,
        labelDensity,
        model,
        palette,
        pins,
        selectedNodeId,
        viewport: layoutViewport,
        zoom,
      });
      if (dataGraphRef.current !== graph) {
        instance.setData(bundle.data);
        dataGraphRef.current = graph;
      } else {
        instance.updateNodeData(bundle.data.nodes ?? []);
        instance.updateEdgeData(bundle.data.edges ?? []);
      }
      callbacksRef.current.onLayoutMetrics?.(bundle.metrics);
      await instance.setElementState(bundle.states);
      await instance.draw();
    };

    void run().catch((error: unknown) => {
      logger.warn('knowledge graph data sync failed', error);
    });
    return () => {
      cancelled = true;
    };
  }, [
    colorMode,
    focusNodeId,
    focusState,
    graph,
    labelDensity,
    layoutViewport,
    model,
    pins,
    selectedNodeId,
    zoom,
  ]);

  // props → G6 视口。回写期间抑制 aftertransform，避免自激循环。
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      await readyRef.current;
      if (cancelled) {
        return;
      }
      const instance = graphRef.current;
      if (!instance || instance.destroyed) {
        return;
      }
      suppressViewportRef.current = true;
      try {
        await applyViewport(instance, { pan, zoom });
        lastViewportRef.current = { pan: { x: pan.x, y: pan.y }, zoom };
      } finally {
        suppressViewportRef.current = false;
      }
    };
    void run().catch((error: unknown) => {
      logger.warn('knowledge graph viewport sync failed', error);
    });
    return () => {
      cancelled = true;
    };
  }, [pan, zoom]);

  // resetVersion 自增：强制复位视口（即使 props zoom/pan 恰好已是默认值），并清空全部用户固定点。
  useEffect(() => {
    if (resetVersion === lastResetRef.current) {
      return;
    }
    lastResetRef.current = resetVersion;
    dragFollowRef.current?.stop();
    setPins(clearGraphPins());
    let cancelled = false;
    const run = async () => {
      await readyRef.current;
      if (cancelled) {
        return;
      }
      const instance = graphRef.current;
      if (!instance || instance.destroyed) {
        return;
      }
      suppressViewportRef.current = true;
      try {
        await applyViewport(instance, RESET_VIEWPORT);
        lastViewportRef.current = RESET_VIEWPORT;
      } finally {
        suppressViewportRef.current = false;
      }
    };
    void run().catch((error: unknown) => {
      logger.warn('knowledge graph viewport reset failed', error);
    });
    return () => {
      cancelled = true;
    };
  }, [resetVersion]);

  const canvasUnavailable = availability === 'unavailable';

  return (
    <div className="workspace-knowledge-graph-canvas-frame">
      <div
        ref={containerRef}
        aria-label={CANVAS_ARIA_LABEL}
        className="workspace-knowledge-graph-canvas"
      />
      <KnowledgeGraphCanvasOverlays
        nodes={model.nodes}
        selectedNodeId={selectedNodeId}
        focusAnnouncement={focusAnnouncement}
        focusCount={focusState.active ? Math.max(0, focusState.nodeIds.size - 1) : null}
        capacityBlockedIds={capacityBlockedIds}
        unavailable={canvasUnavailable}
        onSelectNode={onSelectNode}
      />
    </div>
  );
}
