import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type PointerEvent,
  type WheelEvent,
} from 'react';
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import type {
  GraphEdge,
  GraphNode,
  GraphNodeGroup,
  GraphRoleLayer,
  KnowledgeGraph,
} from '../../data/build-knowledge-graph.js';
import {
  GRAPH_HEIGHT,
  GRAPH_WIDTH,
  clampGraphPoint,
  nodeRadius,
} from './workspace-knowledge-graph-layout.js';
import {
  computeLocalGraphDistances,
  computeGraphFocusState,
  countContentNodesByGroup,
  edgeDepthWeight,
  edgeNearestDistance,
  forceAnchorForNode,
  graphNodeHitRadius,
  nodeFocusWeight,
  nodeLabelVisibility,
  nodeDragExceededThreshold,
  nodeRenderScale,
  resolveForceNodePosition,
  seededUnit,
  shouldShowNodeLabel,
  shouldPinGraphNodeToAnchor,
  truncate,
} from './workspace-knowledge-graph-canvas-helpers.js';
import {
  createSafeLinearGradient,
  createSafeRadialGradient,
  drawContainsLinkPulse,
  drawDerivesArrowHead,
  drawDerivesLinkFlowPulse,
  drawGraphNode,
  drawNodeLabelWithBackground,
  drawNodeOrbitParticles,
  pulse,
  type NodeVisualStyle,
} from './workspace-knowledge-graph-canvas-visuals.js';

export {
  artifactPhaseTrackDistance,
  computeLocalGraphDistances,
  computeGraphFocusState,
  forceAnchorForNode,
  graphNodeHitRadius,
  nodeLabelVisibility,
  nodeDragExceededThreshold,
  resolveForceNodePosition,
  shouldShowNodeLabel,
  shouldPinGraphNodeToAnchor,
} from './workspace-knowledge-graph-canvas-helpers.js';
export type { GraphFocusState } from './workspace-knowledge-graph-canvas-helpers.js';

export type KnowledgeGraphLabelDensity = 'auto' | 'all' | 'focus';
export type KnowledgeGraphColorMode = 'group' | 'role' | 'persistence';
type CanvasAvailability = 'available' | 'unknown' | 'unavailable';

export interface KnowledgeGraphForceSettings {
  center: number;
  distance: number;
  link: number;
  repel: number;
}

interface CanvasGraphNode extends SimulationNodeDatum {
  anchorX: number;
  anchorY: number;
  id: string;
  node: GraphNode;
  radius: number;
}

interface CanvasGraphLink extends SimulationLinkDatum<CanvasGraphNode> {
  edge: GraphEdge;
  id: string;
}

interface CanvasPalette {
  accent: string;
  aux: string;
  bgBase: string;
  bgOverlay: string;
  borderDefault: string;
  complement: string;
  contrast: string;
  fgMuted: string;
  fgStrong: string;
  success: string;
  warning: string;
}

interface CanvasTransform {
  fitScale: number;
  height: number;
  offsetX: number;
  offsetY: number;
  width: number;
}

interface CanvasDragState {
  kind: 'pan' | 'node';
  moved?: boolean;
  nodeId?: string;
  nodeOffsetX?: number;
  nodeOffsetY?: number;
  panX: number;
  panY: number;
  pointerX: number;
  pointerY: number;
}

interface AccessibleNodeLabel {
  id: string;
  label: string;
}

interface RenderState {
  animationTick: number;
  colorMode: KnowledgeGraphColorMode;
  labelDensity: KnowledgeGraphLabelDensity;
  pan: { x: number; y: number };
  zoom: number;
}

const DEFAULT_CANVAS_TRANSFORM: CanvasTransform = {
  fitScale: 1,
  height: GRAPH_HEIGHT,
  offsetX: 0,
  offsetY: 0,
  width: GRAPH_WIDTH,
};

const GROUP_COLOR_KEY: Record<GraphNodeGroup, keyof CanvasPalette> = {
  workspace: 'fgMuted',
  architecture: 'aux',
  governance: 'warning',
  memory: 'accent',
  knowledge: 'contrast',
};

const ROLE_COLOR_KEY: Record<GraphRoleLayer, keyof CanvasPalette> = {
  reception: 'aux',
  pm1: 'contrast',
  pm2: 'accent',
  executor: 'warning',
  reviewer: 'complement',
};

const GRAPH_GROUP_ORDER: GraphNodeGroup[] = ['architecture', 'governance', 'memory', 'knowledge'];

const GRAPH_GROUP_LABELS: Record<GraphNodeGroup, string> = {
  workspace: '工作区',
  architecture: '架构上下文',
  governance: '团队规则',
  memory: '记忆与经验',
  knowledge: '知识产物',
};

export function WorkspaceKnowledgeGraphCanvas({
  colorMode,
  forceSettings,
  graph,
  labelDensity,
  localGraphDepth = 0,
  onPanChange,
  onSelectNode,
  onZoomChange,
  pan,
  resetVersion,
  selectedNodeId,
  zoom,
}: {
  colorMode: KnowledgeGraphColorMode;
  forceSettings: KnowledgeGraphForceSettings;
  graph: KnowledgeGraph;
  labelDensity: KnowledgeGraphLabelDensity;
  localGraphDepth?: number;
  onPanChange: (pan: { x: number; y: number }) => void;
  onSelectNode: (nodeId: string) => void;
  onZoomChange: (zoom: number) => void;
  pan: { x: number; y: number };
  resetVersion: number;
  selectedNodeId: string | null;
  zoom: number;
}) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const simulationRef = useRef<Simulation<CanvasGraphNode, CanvasGraphLink> | null>(null);
  const nodesRef = useRef<CanvasGraphNode[]>([]);
  const linksRef = useRef<CanvasGraphLink[]>([]);
  const transformRef = useRef<CanvasTransform>(DEFAULT_CANVAS_TRANSFORM);
  const dragRef = useRef<CanvasDragState | null>(null);
  const hoveredNodeIdRef = useRef<string | null>(null);
  const selectedNodeIdRef = useRef<string | null>(selectedNodeId);
  const drawRef = useRef<(() => void) | null>(null);
  const renderStateRef = useRef<RenderState>({
    animationTick: 0,
    colorMode,
    labelDensity,
    pan,
    zoom,
  });
  const fixedNodeIdsRef = useRef(new Set<string>());
  const fixedNodeCountRef = useRef(0);
  const positionsRef = useRef(
    new Map<string, { fx: number | null; fy: number | null; x: number; y: number }>(),
  );
  const [canvasAvailability, setCanvasAvailability] = useState<CanvasAvailability>('unknown');
  const [fixedNodeCount, setFixedNodeCount] = useState(0);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [accessibleLabels, setAccessibleLabels] = useState<AccessibleNodeLabel[]>([]);
  const localLayoutFocusNodeId = localGraphDepth > 0 ? selectedNodeId : null;

  const focusNodeId = hoveredNodeId ?? selectedNodeId;
  const accessFocusState = useMemo(
    () => computeGraphFocusState(graph, focusNodeId),
    [focusNodeId, graph],
  );
  const focusNode = useMemo(
    () => graph.nodes.find((node) => node.id === focusNodeId) ?? null,
    [focusNodeId, graph.nodes],
  );

  useEffect(() => {
    setAccessibleLabels(
      graph.nodes.map((node) => ({
        id: node.id,
        label: node.label,
      })),
    );
  }, [graph]);

  useEffect(() => {
    selectedNodeIdRef.current = selectedNodeId;
    drawRef.current?.();
  }, [selectedNodeId]);

  useEffect(() => {
    hoveredNodeIdRef.current = hoveredNodeId;
    drawRef.current?.();
  }, [hoveredNodeId]);

  useEffect(() => {
    renderStateRef.current = {
      animationTick: renderStateRef.current.animationTick,
      colorMode,
      labelDensity,
      pan,
      zoom,
    };
    drawRef.current?.();
  }, [colorMode, labelDensity, pan, zoom]);

  const updateFixedNodeCount = useCallback(() => {
    const next = fixedNodeIdsRef.current.size;
    if (fixedNodeCountRef.current === next) {
      return;
    }
    fixedNodeCountRef.current = next;
    setFixedNodeCount(next);
  }, []);

  const setHoveredNode = useCallback((nodeId: string | null) => {
    if (hoveredNodeIdRef.current === nodeId) {
      return;
    }
    hoveredNodeIdRef.current = nodeId;
    setHoveredNodeId(nodeId);
  }, []);

  const hoveredNodeAtPointer = useCallback(
    (canvas: HTMLCanvasElement, clientX: number, clientY: number): string | null => {
      const renderState = renderStateRef.current;
      const point = clientPointToGraphPoint(
        canvas,
        clientX,
        clientY,
        renderState.pan,
        renderState.zoom,
        transformRef,
      );
      const hit = findNodeAtPoint(
        nodesRef.current,
        point,
        transformRef.current.fitScale * renderState.zoom,
      );
      return hit?.id ?? null;
    },
    [],
  );

  const syncHoveredNodeAtPointer = useCallback(
    (event: PointerEvent<HTMLCanvasElement>) => {
      setHoveredNode(hoveredNodeAtPointer(event.currentTarget, event.clientX, event.clientY));
    },
    [hoveredNodeAtPointer, setHoveredNode],
  );

  useEffect(() => {
    positionsRef.current.clear();
    fixedNodeIdsRef.current.clear();
    fixedNodeCountRef.current = 0;
    setFixedNodeCount(0);
  }, [resetVersion]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const localGraphActive = localLayoutFocusNodeId !== null;
    const localGraphDistances = localGraphActive
      ? computeLocalGraphDistances(graph, localLayoutFocusNodeId)
      : null;
    const contentGroupTotals = countContentNodesByGroup(graph.nodes);
    const contentGroupIndexes = new Map<GraphNodeGroup, number>();
    const nodes = graph.nodes.map((node) => {
      const previous = positionsRef.current.get(node.id);
      const indexInGroup =
        node.kind === 'workspace' || node.kind === 'category'
          ? 0
          : (contentGroupIndexes.get(node.group) ?? 0);
      if (node.kind !== 'workspace' && node.kind !== 'category') {
        contentGroupIndexes.set(node.group, indexInGroup + 1);
      }
      const anchor = forceAnchorForNode(
        node,
        indexInGroup,
        contentGroupTotals.get(node.group) ?? 1,
        {
          localFocusDistance: localGraphDistances?.get(node.id) ?? null,
          localGraphActive,
        },
      );
      const seed = seededUnit(node.id);
      const seedY = seededUnit(`${node.id}:y`);
      const radius = nodeRadius(node);
      const localFocusDistance = localGraphDistances?.get(node.id) ?? null;
      const pinAnchor = shouldPinGraphNodeToAnchor(node, localGraphActive, localFocusDistance);
      const position = resolveForceNodePosition({
        anchor,
        localGraphActive,
        nodeId: node.id,
        pinAnchor,
        previous,
        seedX: seed,
        seedY,
        userFixedNodeIds: fixedNodeIdsRef.current,
      });
      return {
        anchorX: anchor.x,
        anchorY: anchor.y,
        fx: position.fx,
        fy: position.fy,
        id: node.id,
        node,
        radius,
        x: position.x,
        y: position.y,
      };
    });
    const graphNodeIds = new Set(graph.nodes.map((node) => node.id));
    for (const fixedNodeId of fixedNodeIdsRef.current) {
      if (!graphNodeIds.has(fixedNodeId)) {
        fixedNodeIdsRef.current.delete(fixedNodeId);
      }
    }
    updateFixedNodeCount();
    const links = graph.edges.map((edge) => ({
      edge,
      id: edge.id,
      source: edge.from,
      target: edge.to,
    }));
    nodesRef.current = nodes;
    linksRef.current = links as CanvasGraphLink[];

    let context: CanvasRenderingContext2D | null = null;
    if (typeof window.CanvasRenderingContext2D !== 'undefined') {
      try {
        context = canvas.getContext('2d');
      } catch (_error) {
        context = null;
      }
    }

    if (!context) {
      drawRef.current = null;
      setCanvasAvailability('unavailable');
      return;
    }
    setCanvasAvailability('available');

    const palette = resolveCanvasPalette(canvas);

    const draw = () => {
      for (const node of nodesRef.current) {
        const clamped = clampGraphPoint({
          x: typeof node.x === 'number' ? node.x : node.anchorX,
          y: typeof node.y === 'number' ? node.y : node.anchorY,
        });
        node.x = clamped.x;
        node.y = clamped.y;
        positionsRef.current.set(node.id, {
          fx: typeof node.fx === 'number' ? node.fx : null,
          fy: typeof node.fy === 'number' ? node.fy : null,
          x: node.x,
          y: node.y,
        });
      }
      transformRef.current = drawCanvasGraph({
        canvas,
        colorMode: renderStateRef.current.colorMode,
        context,
        focusNodeId: hoveredNodeIdRef.current ?? selectedNodeIdRef.current,
        graph,
        labelDensity: renderStateRef.current.labelDensity,
        links: linksRef.current,
        nodes: nodesRef.current,
        palette,
        pan: renderStateRef.current.pan,
        selectedNodeId: selectedNodeIdRef.current,
        tick: renderStateRef.current.animationTick,
        zoom: renderStateRef.current.zoom,
      });
    };
    drawRef.current = draw;

    const simulation = forceSimulation<CanvasGraphNode>(nodes)
      .force(
        'center',
        forceCenter(GRAPH_WIDTH / 2, GRAPH_HEIGHT / 2).strength(forceSettings.center),
      )
      .force(
        'link',
        forceLink<CanvasGraphNode, CanvasGraphLink>(links as CanvasGraphLink[])
          .id((node) => node.id)
          .distance((link) => (link.edge.kind === 'derives' ? 128 : forceSettings.distance))
          .strength(forceSettings.link),
      )
      .force('charge', forceManyBody<CanvasGraphNode>().strength(-forceSettings.repel))
      .force(
        'collide',
        forceCollide<CanvasGraphNode>().radius(
          (node) => node.radius + (localGraphActive ? 18 : 16),
        ),
      )
      .force(
        'x',
        forceX<CanvasGraphNode>((node) => node.anchorX).strength((node) =>
          anchorStrength(node, localGraphActive),
        ),
      )
      .force(
        'y',
        forceY<CanvasGraphNode>((node) => node.anchorY).strength((node) =>
          anchorStrength(node, localGraphActive),
        ),
      )
      .alpha(0.9)
      .velocityDecay(localGraphActive ? 0.34 : 0.4)
      .on('tick', draw);

    simulationRef.current = simulation;
    draw();

    return () => {
      simulation.stop();
      simulationRef.current = null;
    };
  }, [
    forceSettings,
    graph,
    localGraphDepth,
    localLayoutFocusNodeId,
    resetVersion,
    updateFixedNodeCount,
  ]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) {
      return;
    }

    const redraw = () => {
      drawRef.current?.();
    };
    const observer =
      typeof window.ResizeObserver === 'undefined' ? null : new window.ResizeObserver(redraw);
    observer?.observe(frame);
    window.addEventListener('resize', redraw);

    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', redraw);
    };
  }, []);

  useEffect(() => {
    let frameId = 0;
    let mounted = true;

    const animate = () => {
      if (!mounted) {
        return;
      }
      renderStateRef.current = {
        ...renderStateRef.current,
        animationTick: renderStateRef.current.animationTick + 1,
      };
      drawRef.current?.();
      frameId = window.requestAnimationFrame(animate);
    };

    frameId = window.requestAnimationFrame(animate);
    return () => {
      mounted = false;
      window.cancelAnimationFrame(frameId);
    };
  }, []);

  const handleWheel = useCallback(
    (event: WheelEvent<HTMLCanvasElement>) => {
      event.preventDefault();
      const renderState = renderStateRef.current;
      const currentZoom = renderState.zoom;
      const nextZoom = Math.min(2.8, Math.max(0.35, currentZoom - event.deltaY * 0.001));
      if (nextZoom === currentZoom) {
        return;
      }
      const transform = transformRef.current;
      const rect = event.currentTarget.getBoundingClientRect();
      const graphPoint = clientPointToGraphPoint(
        event.currentTarget,
        event.clientX,
        event.clientY,
        renderState.pan,
        currentZoom,
        transformRef,
      );
      const fitScale = Math.max(0.01, transform.fitScale);
      onPanChange({
        x: (event.clientX - rect.left - transform.offsetX) / fitScale - graphPoint.x * nextZoom,
        y: (event.clientY - rect.top - transform.offsetY) / fitScale - graphPoint.y * nextZoom,
      });
      onZoomChange(nextZoom);
    },
    [onPanChange, onZoomChange],
  );

  const handlePointerDown = useCallback((event: PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const renderState = renderStateRef.current;
    const point = clientPointToGraphPoint(
      event.currentTarget,
      event.clientX,
      event.clientY,
      renderState.pan,
      renderState.zoom,
      transformRef,
    );
    const hit = findNodeAtPoint(
      nodesRef.current,
      point,
      transformRef.current.fitScale * renderState.zoom,
    );
    if (hit) {
      const hitX = hit.x ?? hit.anchorX;
      const hitY = hit.y ?? hit.anchorY;
      dragRef.current = {
        kind: 'node',
        moved: false,
        nodeId: hit.id,
        nodeOffsetX: hitX - point.x,
        nodeOffsetY: hitY - point.y,
        panX: renderState.pan.x,
        panY: renderState.pan.y,
        pointerX: event.clientX,
        pointerY: event.clientY,
      };
      return;
    }
    dragRef.current = {
      kind: 'pan',
      panX: renderState.pan.x,
      panY: renderState.pan.y,
      pointerX: event.clientX,
      pointerY: event.clientY,
    };
  }, []);

  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLCanvasElement>) => {
      const drag = dragRef.current;
      const renderState = renderStateRef.current;
      const point = clientPointToGraphPoint(
        event.currentTarget,
        event.clientX,
        event.clientY,
        renderState.pan,
        renderState.zoom,
        transformRef,
      );
      if (drag?.kind === 'node' && drag.nodeId) {
        event.preventDefault();
        const node = nodesRef.current.find((item) => item.id === drag.nodeId);
        if (node) {
          const moved =
            drag.moved ||
            nodeDragExceededThreshold({
              currentX: event.clientX,
              currentY: event.clientY,
              startX: drag.pointerX,
              startY: drag.pointerY,
            });
          if (!moved) {
            return;
          }
          drag.moved = true;
          const next = clampGraphPoint({
            x: point.x + (drag.nodeOffsetX ?? 0),
            y: point.y + (drag.nodeOffsetY ?? 0),
          });
          node.fx = next.x;
          node.fy = next.y;
          node.x = next.x;
          node.y = next.y;
          positionsRef.current.set(node.id, {
            fx: next.x,
            fy: next.y,
            x: next.x,
            y: next.y,
          });
          fixedNodeIdsRef.current.add(node.id);
          updateFixedNodeCount();
          drawRef.current?.();
          simulationRef.current?.alphaTarget(0.22).restart();
        }
        return;
      }
      if (drag?.kind === 'pan') {
        event.preventDefault();
        const fitScale = Math.max(0.01, transformRef.current.fitScale);
        onPanChange({
          x: drag.panX + (event.clientX - drag.pointerX) / fitScale,
          y: drag.panY + (event.clientY - drag.pointerY) / fitScale,
        });
        return;
      }
      const hit = findNodeAtPoint(
        nodesRef.current,
        point,
        transformRef.current.fitScale * renderState.zoom,
      );
      setHoveredNode(hit?.id ?? null);
    },
    [onPanChange, setHoveredNode, updateFixedNodeCount],
  );

  const handlePointerUp = useCallback(
    (event: PointerEvent<HTMLCanvasElement>) => {
      const drag = dragRef.current;
      dragRef.current = null;
      if (drag?.kind === 'node') {
        simulationRef.current?.alphaTarget(0);
        if (!drag.moved && drag.nodeId) {
          onSelectNode(drag.nodeId);
        }
        syncHoveredNodeAtPointer(event);
        return;
      }
      setHoveredNode(null);
    },
    [onSelectNode, setHoveredNode, syncHoveredNodeAtPointer],
  );

  const handlePointerCancel = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag?.kind === 'node') {
      simulationRef.current?.alphaTarget(0);
    }
    setHoveredNode(null);
  }, [setHoveredNode]);

  const handlePointerLeave = useCallback(() => {
    if (dragRef.current) {
      return;
    }
    setHoveredNode(null);
  }, [setHoveredNode]);

  const handleAccessibleSelect = useCallback(
    (nodeId: string) => {
      onSelectNode(nodeId);
    },
    [onSelectNode],
  );

  return (
    <div ref={frameRef} className="workspace-knowledge-graph-canvas-frame">
      <canvas
        ref={canvasRef}
        aria-label="工作区知识图谱画布"
        className="workspace-knowledge-graph-canvas"
        data-renderer="canvas-d3-force"
        onLostPointerCapture={handlePointerCancel}
        onPointerCancel={handlePointerCancel}
        onPointerDown={handlePointerDown}
        onPointerLeave={handlePointerLeave}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onWheel={handleWheel}
      />
      {canvasAvailability !== 'unavailable' ? (
        <div className="workspace-knowledge-graph-access-layer">
          {accessibleLabels.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-label={`选择节点：${item.label}`}
              data-label={item.label}
              onClick={() => handleAccessibleSelect(item.id)}
            />
          ))}
        </div>
      ) : null}
      {canvasAvailability === 'unavailable' ? (
        <div className="workspace-knowledge-graph-fallback" role="note">
          <span className="workspace-knowledge-graph-fallback-title">图谱画布暂不可用</span>
          <span className="workspace-knowledge-graph-fallback-description">
            可直接从节点列表查看知识详情。
          </span>
          <div className="workspace-knowledge-graph-fallback-list">
            {accessibleLabels.map((item) => (
              <button
                key={item.id}
                type="button"
                className="workspace-knowledge-graph-fallback-node"
                onClick={() => handleAccessibleSelect(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {accessFocusState.active ? (
        <span className="workspace-knowledge-graph-focus-count">
          邻域 {Math.max(0, accessFocusState.nodeIds.size - 1)}
        </span>
      ) : null}
      {fixedNodeCount > 0 ? (
        <span className="workspace-knowledge-graph-fixed-count">
          固定 {fixedNodeCount} · 复位恢复自动布局
        </span>
      ) : null}
      {focusNode ? (
        <span className="workspace-knowledge-graph-node-hint" aria-live="polite">
          焦点：{focusNode.label} · {nodeCaption(focusNode)}
        </span>
      ) : null}
    </div>
  );
}

function drawCanvasGraph({
  canvas,
  colorMode,
  context,
  focusNodeId,
  graph,
  labelDensity,
  links,
  nodes,
  palette,
  pan,
  selectedNodeId,
  tick,
  zoom,
}: {
  canvas: HTMLCanvasElement;
  colorMode: KnowledgeGraphColorMode;
  context: CanvasRenderingContext2D;
  focusNodeId: string | null;
  graph: KnowledgeGraph;
  labelDensity: KnowledgeGraphLabelDensity;
  links: CanvasGraphLink[];
  nodes: CanvasGraphNode[];
  palette: CanvasPalette;
  pan: { x: number; y: number };
  selectedNodeId: string | null;
  tick: number;
  zoom: number;
}): CanvasTransform {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, rect.width || GRAPH_WIDTH);
  const height = Math.max(1, rect.height || GRAPH_HEIGHT);
  const pixelRatio = Math.max(1, window.devicePixelRatio || 1);
  if (canvas.width !== Math.round(width * pixelRatio)) {
    canvas.width = Math.round(width * pixelRatio);
  }
  if (canvas.height !== Math.round(height * pixelRatio)) {
    canvas.height = Math.round(height * pixelRatio);
  }
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, width, height);

  const transform = computeCanvasTransform(width, height);
  const focusState = computeGraphFocusState(graph, focusNodeId);
  const focusDistances =
    focusState.active && focusNodeId ? computeLocalGraphDistances(graph, focusNodeId) : null;
  const visibleNodes = nodes.filter((node) => isNodeInViewport(node, pan, transform, zoom));
  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));

  context.save();
  context.translate(
    transform.offsetX + pan.x * transform.fitScale,
    transform.offsetY + pan.y * transform.fitScale,
  );
  context.scale(transform.fitScale * zoom, transform.fitScale * zoom);

  drawGraphGroupBackdrops({ context, nodes: visibleNodes, palette, tick, zoom });

  for (const link of links) {
    const source = link.source;
    const target = link.target;
    if (!isCanvasNode(source) || !isCanvasNode(target)) {
      continue;
    }
    if (!visibleNodeIds.has(source.id) && !visibleNodeIds.has(target.id)) {
      continue;
    }
    const highlighted = focusState.edgeIds.has(link.id);
    const dimmed = focusState.active && !highlighted;
    const sourceDistance = focusDistances?.get(source.id) ?? null;
    const targetDistance = focusDistances?.get(target.id) ?? null;
    const linkDistance = edgeNearestDistance(sourceDistance, targetDistance);
    const linkDepthWeight = edgeDepthWeight(sourceDistance, targetDistance);
    const sourceColor = nodeVisualStyle(source.node, colorMode, palette).baseColor;
    const targetColor = nodeVisualStyle(target.node, colorMode, palette).baseColor;
    const sourceX = source.x ?? source.anchorX;
    const sourceY = source.y ?? source.anchorY;
    const targetX = target.x ?? target.anchorX;
    const targetY = target.y ?? target.anchorY;
    const gradient = createSafeLinearGradient(
      context,
      sourceX,
      sourceY,
      targetX,
      targetY,
      sourceColor,
      targetColor,
    );
    context.globalAlpha = dimmed
      ? 0.08
      : highlighted
        ? 0.76 + linkDepthWeight * 0.14 + pulse(tick, link.id, 0.14, 0.04)
        : link.edge.kind === 'derives'
          ? 0.48 + pulse(tick, link.id, 0.08, 0.03)
          : 0.24;
    context.strokeStyle =
      link.edge.kind === 'derives'
        ? gradient
        : createSafeLinearGradient(
            context,
            sourceX,
            sourceY,
            targetX,
            targetY,
            palette.borderDefault,
            sourceColor,
            [
              [0, palette.borderDefault],
              [1, sourceColor],
            ],
          );
    context.lineWidth =
      (highlighted
        ? 1.52 + pulse(tick, `${link.id}:width`, 0.22, 0.08)
        : link.edge.kind === 'contains'
          ? 0.92 + pulse(tick, `${link.id}:contains-width`, 0.08, 0.02)
          : 0.85) / zoom;
    if (link.edge.kind === 'derives') {
      context.setLineDash([4 / zoom, 5 / zoom]);
      context.lineDashOffset = (-tick * 0.22) / zoom;
    } else {
      context.setLineDash([1.2 / zoom, 5.2 / zoom]);
      context.lineDashOffset = (tick * 0.08) / zoom;
    }
    context.beginPath();
    context.moveTo(sourceX, sourceY);
    context.lineTo(targetX, targetY);
    context.stroke();
    if (link.edge.kind === 'derives') {
      context.setLineDash([]);
      context.lineDashOffset = 0;
      drawDerivesLinkFlowPulse({
        accentColor: targetColor,
        context,
        distance: linkDistance,
        edgeId: link.id,
        fgStrong: palette.fgStrong,
        highlighted,
        intensity: linkDepthWeight,
        sourceX,
        sourceY,
        targetX,
        targetY,
        tick,
        zoom,
      });
      drawDerivesArrowHead({
        accentColor: targetColor,
        context,
        sourceX,
        sourceY,
        targetRadius: target.radius,
        targetX,
        targetY,
        zoom,
      });
    } else {
      context.setLineDash([]);
      context.lineDashOffset = 0;
      drawContainsLinkPulse({
        context,
        distance: linkDistance,
        edgeId: link.id,
        fgStrong: palette.fgStrong,
        highlighted,
        intensity: linkDepthWeight,
        sourceX,
        sourceY,
        targetX,
        targetY,
        tick,
        zoom,
      });
    }
  }
  context.setLineDash([]);
  context.lineDashOffset = 0;

  let visibleIndex = 0;
  for (const node of visibleNodes) {
    const selected = node.id === selectedNodeId;
    const focused = !focusState.active || focusState.nodeIds.has(node.id);
    const dimmed = focusState.active && !focusState.nodeIds.has(node.id);
    const focusDistance = focusDistances?.get(node.id) ?? null;
    const renderScale = nodeRenderScale({
      dimmed,
      focusActive: focusState.active,
      focusDistance,
      selected,
    });
    const focusWeight = nodeFocusWeight({
      dimmed,
      focusActive: focusState.active,
      focusDistance,
      selected,
    });
    const renderRadius = node.radius * renderScale;
    const x = node.x ?? node.anchorX;
    const y = node.y ?? node.anchorY;
    const style = nodeVisualStyle(node.node, colorMode, palette);
    drawGraphNode({
      accentColor: palette.accent,
      bgOverlay: palette.bgOverlay,
      context,
      dimmed,
      fgStrong: palette.fgStrong,
      focusDistance,
      focusWeight,
      focused,
      nodeId: node.id,
      nodeKind: node.node.kind,
      nodeRadius: node.radius,
      renderScale,
      selected,
      style,
      tick,
      x,
      y,
      zoom,
    });
    if (node.node.persistedMemoryId) {
      context.fillStyle = palette.success;
      context.strokeStyle = palette.bgBase;
      context.lineWidth = 1.3 / zoom;
      context.beginPath();
      context.arc(x + renderRadius * 0.62, y - renderRadius * 0.62, 4.5, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    }
  }

  context.globalAlpha = 1;
  const titleFontSize = 9.5;
  const metaFontSize = 8;
  context.font = `${titleFontSize / zoom}px system-ui, sans-serif`;
  context.textBaseline = 'middle';
  // 预计算所有可见节点的标签位置，用于简单的 Y 轴碰撞避免
  type LabelSlot = { x: number; y: number; w: number; h: number };
  const labelSlots: LabelSlot[] = [];
  for (const node of visibleNodes) {
    const selected = node.id === focusNodeId;
    const focused = !focusState.active || focusState.nodeIds.has(node.id);
    const labelVisibility = nodeLabelVisibility({
      focusActive: focusState.active,
      focused,
      labelDensity,
      node: node.node,
      selected,
      visibleIndex,
      zoom,
    });
    visibleIndex += 1;
    if (!labelVisibility.title) {
      continue;
    }
    const x = node.x ?? node.anchorX;
    const y = node.y ?? node.anchorY;
    const focusDistance = focusDistances?.get(node.id) ?? null;
    const renderScale = nodeRenderScale({
      dimmed: focusState.active && !focused,
      focusActive: focusState.active,
      focusDistance,
      selected,
    });
    const renderRadius = node.radius * renderScale;
    const isWorkspace = node.node.kind === 'workspace';
    const labelX = isWorkspace ? x : x + renderRadius + 7;
    const labelY = isWorkspace ? y - renderRadius - 8 : y + 2;
    const maxTitleLen = isWorkspace ? 14 : 12;
    const titleText = truncate(node.node.label, maxTitleLen);
    // 测量标题宽度用于碰撞检测
    context.font = `${titleFontSize / zoom}px system-ui, sans-serif`;
    const titleW = context.measureText(titleText).width;
    const titleH = (titleFontSize / zoom) * 1.0;
    // 简单的 Y 轴碰撞下推：如果和已有标签在 Y 方向重叠且 X 接近，则向下偏移
    let offsetY = 0;
    for (const slot of labelSlots) {
      const xOverlap = Math.abs(labelX - slot.x) < (titleW + slot.w) * 0.5 + 6;
      const yOverlap = Math.abs(labelY - slot.y) < (titleH + slot.h) * 0.6 + 3;
      if (xOverlap && yOverlap) {
        offsetY = Math.max(offsetY, slot.y + slot.h * 0.5 - labelY + titleH * 0.55);
      }
    }
    const finalLabelY = labelY + offsetY;
    labelSlots.push({ x: labelX, y: finalLabelY, w: titleW, h: titleH });

    context.globalAlpha = focusState.active && !focused ? 0.42 : selected ? 1 : 0.92;
    drawNodeLabelWithBackground({
      context,
      text: titleText,
      x: labelX,
      y: finalLabelY,
      bgColor: palette.bgOverlay,
      textColor: palette.fgStrong,
      fontSizePx: titleFontSize,
      zoom,
      textAlign: isWorkspace ? 'center' : 'left',
    });
    if (!labelVisibility.meta) {
      context.font = `${titleFontSize / zoom}px system-ui, sans-serif`;
      continue;
    }
    const metaText = truncate(nodeCaption(node.node), 16);
    context.font = `${metaFontSize / zoom}px system-ui, sans-serif`;
    const metaW = context.measureText(metaText).width;
    const metaH = (metaFontSize / zoom) * 1.0;
    context.globalAlpha = focusState.active && !focused ? 0.32 : 0.78;
    drawNodeLabelWithBackground({
      context,
      text: metaText,
      x: labelX,
      y: finalLabelY + 12 / zoom,
      bgColor: palette.bgOverlay,
      textColor: palette.fgMuted,
      fontSizePx: metaFontSize,
      zoom,
      textAlign: isWorkspace ? 'center' : 'left',
      paddingBottom: 0,
    });
    // 更新 slot 高度以包含 meta 行
    const lastSlot = labelSlots[labelSlots.length - 1];
    if (lastSlot) {
      lastSlot.h += 11 / zoom;
    }
    context.font = `${titleFontSize / zoom}px system-ui, sans-serif`;
  }

  context.restore();
  context.globalAlpha = 1;
  return transform;
}

function computeCanvasTransform(width: number, height: number): CanvasTransform {
  const fitScale = Math.min(width / GRAPH_WIDTH, height / GRAPH_HEIGHT);
  const renderedWidth = GRAPH_WIDTH * fitScale;
  const renderedHeight = GRAPH_HEIGHT * fitScale;
  const transform = {
    fitScale,
    height,
    offsetX: (width - renderedWidth) / 2,
    offsetY: (height - renderedHeight) / 2,
    width,
  };
  return transform;
}

function drawGraphGroupBackdrops({
  context,
  nodes,
  palette,
  tick,
  zoom,
}: {
  context: CanvasRenderingContext2D;
  nodes: CanvasGraphNode[];
  palette: CanvasPalette;
  tick: number;
  zoom: number;
}) {
  for (const group of GRAPH_GROUP_ORDER) {
    const groupNodes = nodes.filter(
      (node) => node.node.group === group && node.node.kind !== 'workspace',
    );
    if (groupNodes.length === 0) {
      continue;
    }
    const bounds = graphGroupBounds(groupNodes);
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;
    const radius = Math.max(
      64,
      Math.hypot(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) / 2 + 20,
    );
    const color = nodeGroupColor(group, palette);

    context.globalAlpha = 0.08 + pulse(tick, `${group}:ring`, 0.04, 0.02);
    context.strokeStyle = color;
    context.lineWidth = 1 / zoom;
    context.setLineDash([8 / zoom, 14 / zoom]);
    context.beginPath();
    context.arc(centerX, centerY, radius, 0, Math.PI * 2);
    context.stroke();
    context.setLineDash([]);

    context.globalAlpha = 0.46 + pulse(tick, `${group}:label`, 0.06, 0.02);
    context.fillStyle = color;
    context.font = `${9 / zoom}px system-ui, sans-serif`;
    context.textAlign = 'left';
    context.textBaseline = 'middle';
    context.fillText(
      GRAPH_GROUP_LABELS[group],
      centerX - radius + 12 / zoom,
      centerY - radius + 16 / zoom,
    );
  }
  context.globalAlpha = 1;
}

function graphGroupBounds(nodes: CanvasGraphNode[]): {
  maxX: number;
  maxY: number;
  minX: number;
  minY: number;
} {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const node of nodes) {
    const x = node.x ?? node.anchorX;
    const y = node.y ?? node.anchorY;
    const radius = node.radius + 18;
    minX = Math.min(minX, x - radius);
    minY = Math.min(minY, y - radius);
    maxX = Math.max(maxX, x + radius);
    maxY = Math.max(maxY, y + radius);
  }
  return { maxX, maxY, minX, minY };
}

function clientPointToGraphPoint(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
  pan: { x: number; y: number },
  zoom: number,
  transformRef: MutableRefObject<CanvasTransform>,
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  const transform = transformRef.current;
  return {
    x:
      (clientX - rect.left - transform.offsetX - pan.x * transform.fitScale) /
      (transform.fitScale * zoom),
    y:
      (clientY - rect.top - transform.offsetY - pan.y * transform.fitScale) /
      (transform.fitScale * zoom),
  };
}

function findNodeAtPoint(
  nodes: CanvasGraphNode[],
  point: { x: number; y: number },
  screenScale: number,
) {
  let best: CanvasGraphNode | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const node of nodes) {
    const x = node.x ?? node.anchorX;
    const y = node.y ?? node.anchorY;
    const distance = Math.hypot(point.x - x, point.y - y);
    if (distance <= graphNodeHitRadius(node.radius, screenScale) && distance < bestDistance) {
      best = node;
      bestDistance = distance;
    }
  }
  return best;
}

function anchorStrength(node: CanvasGraphNode, localGraphActive: boolean): number {
  if (node.node.kind === 'workspace') return localGraphActive ? 0.86 : 0.92;
  if (node.node.kind === 'category') return localGraphActive ? 0.11 : 0.055;
  if (node.node.kind === 'artifact') return localGraphActive ? 0.08 : 0.018;
  return localGraphActive ? 0.064 : 0.015;
}

function isCanvasNode(value: CanvasGraphNode | string | number): value is CanvasGraphNode {
  return typeof value === 'object' && value !== null && 'node' in value;
}

function isNodeInViewport(
  node: CanvasGraphNode,
  pan: { x: number; y: number },
  transform: CanvasTransform,
  zoom: number,
): boolean {
  const x = (node.x ?? node.anchorX) * zoom + pan.x;
  const y = (node.y ?? node.anchorY) * zoom + pan.y;
  const screenX = transform.offsetX + x * transform.fitScale;
  const screenY = transform.offsetY + y * transform.fitScale;
  const margin = 80;
  return (
    screenX > -margin &&
    screenX < transform.width + margin &&
    screenY > -margin &&
    screenY < transform.height + margin
  );
}

function nodeColor(
  node: GraphNode,
  colorMode: KnowledgeGraphColorMode,
  palette: CanvasPalette,
): string {
  if (colorMode === 'persistence' && node.kind !== 'workspace' && node.kind !== 'category') {
    return node.persistedMemoryId ? palette.success : palette.fgMuted;
  }
  if (colorMode === 'role' && node.roleLayers && node.roleLayers.length > 0) {
    const roleLayer = node.roleLayers[0];
    return roleLayer ? palette[ROLE_COLOR_KEY[roleLayer]] : palette.accent;
  }
  if (colorMode === 'role' && node.roleLayers === null && node.kind !== 'category') {
    return palette.accent;
  }
  return palette[GROUP_COLOR_KEY[node.group]];
}

function nodeVisualStyle(
  node: GraphNode,
  colorMode: KnowledgeGraphColorMode,
  palette: CanvasPalette,
): NodeVisualStyle {
  const baseColor = nodeColor(node, colorMode, palette);
  const secondaryColor = nodeSecondaryColor(node, palette);
  return {
    baseColor,
    glowColor: baseColor,
    haloColor: baseColor,
    ringColor: node.persistedMemoryId ? palette.success : baseColor,
    secondaryColor,
    sweepColor: node.persistedMemoryId ? palette.success : secondaryColor,
  };
}

function nodeSecondaryColor(node: GraphNode, palette: CanvasPalette): string {
  switch (node.kind) {
    case 'workspace':
      return palette.contrast;
    case 'category':
      return palette.fgStrong;
    case 'architecture':
      return palette.accent;
    case 'constitution':
      return palette.complement;
    case 'memory':
      return palette.aux;
    case 'knowledge':
      return palette.accent;
    case 'artifact':
      return palette.contrast;
  }
}

function nodeGroupColor(group: GraphNodeGroup, palette: CanvasPalette): string {
  return palette[GROUP_COLOR_KEY[group]];
}

function resolveCanvasPalette(canvas: HTMLCanvasElement): CanvasPalette {
  const styles = getComputedStyle(canvas);
  const rootStyles = getComputedStyle(document.documentElement);
  const read = (name: string): string => {
    const local = styles.getPropertyValue(name).trim();
    if (local.length > 0) return local;
    const root = rootStyles.getPropertyValue(name).trim();
    return root.length > 0 ? root : name;
  };
  return {
    accent: read('--accent'),
    aux: read('--aux'),
    bgBase: read('--bg-base'),
    bgOverlay: read('--bg-overlay'),
    borderDefault: read('--border-default'),
    complement: read('--complement'),
    contrast: read('--contrast'),
    fgMuted: read('--fg-muted'),
    fgStrong: read('--fg-strong'),
    success: read('--success'),
    warning: read('--warning'),
  };
}

function nodeCaption(node: GraphNode): string {
  if (node.kind === 'artifact') {
    return node.state ? `产物 · ${node.state}` : '产物';
  }
  if (node.kind === 'category') {
    return node.detail ?? '分类';
  }
  return node.detail ?? node.state ?? '知识';
}
