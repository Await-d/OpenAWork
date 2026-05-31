/**
 * 260530-team-page · Wave 4 · WorkspaceKnowledgeGraphView（F1 知识图谱视图）
 *
 * 把 buildKnowledgeGraph 派生的节点/边用 SVG 渲染成分层图：
 *   - 按层级（reception→…→reviewer）分列布局 session 节点
 *   - artifact 节点挂在其 produces session 右侧
 *   - 边按类型着色（parent 灰 / handoff 状态色 / produces 虚线）
 *   - 支持缩放（滚轮/按钮）+ 拖拽平移 + 点击节点联动选中 session
 *
 * 纯前端 SVG 自绘，无第三方图库依赖（避免体积膨胀）。
 * 节点上限护栏：超过 MAX_NODES 时提示用户图过大。
 */

import { useCallback, useMemo, useRef, useState, type CSSProperties, type WheelEvent } from 'react';
import {
  useHandoffStore,
  useLayerStore,
  type TeamRoleLayer,
} from '../../../../../stores/team/team-events.js';
import {
  buildKnowledgeGraph,
  KNOWLEDGE_GRAPH_LAYER_LABELS,
  type GraphEdge,
  type GraphNode,
} from '../../data/build-knowledge-graph.js';
import { useTeamWorkspaceArtifacts } from '../../hooks/use-team-workspace-artifacts.js';
import { TabContainer } from '../TabContainer.js';
import { EmptyState } from '../../shared/content-kit/index.js';
import { RolePromptPreviewPanel } from '../../shared/RolePromptPreviewPanel.js';

const MAX_NODES = 200;

const LAYER_COLUMN: Record<TeamRoleLayer, number> = {
  user: 0,
  reception: 1,
  pm1: 2,
  pm2: 3,
  executor: 4,
  tester: 5,
  reviewer: 6,
};

const STATE_COLORS: Record<string, string> = {
  idle: 'var(--fg-muted)',
  pending: 'var(--warning)',
  claimed: 'var(--aux)',
  running: 'var(--success)',
  completed: 'var(--fg-muted)',
  failed: 'var(--danger)',
  cancelled: 'var(--fg-muted)',
};

const NODE_W = 132;
const NODE_H = 44;
const COL_GAP = 80;
const ROW_GAP = 22;
const COL_WIDTH = NODE_W + COL_GAP;
const MARGIN = 32;

interface PositionedNode {
  node: GraphNode;
  x: number;
  y: number;
}

export interface WorkspaceKnowledgeGraphViewProps {
  selectedSessionId?: string | null;
  teamWorkspaceId?: string | null;
  onSelectSession?: (sessionId: string) => void;
}

export function WorkspaceKnowledgeGraphView({
  selectedSessionId,
  teamWorkspaceId,
  onSelectSession,
}: WorkspaceKnowledgeGraphViewProps) {
  const layerNodes = useLayerStore((s) => s.nodes);
  const handoffs = useHandoffStore((s) => s.handoffs);

  // workspace 级产物（spec/plan/tasks/review，跨所有 session）。
  const { artifacts: workspaceArtifacts } = useTeamWorkspaceArtifacts(teamWorkspaceId ?? null);

  const graph = useMemo(() => {
    return buildKnowledgeGraph({
      layerNodes: layerNodes.values(),
      handoffs: handoffs.values(),
      artifacts: workspaceArtifacts.map((a) => ({
        id: a.id,
        sessionId: a.sessionId,
        phase: a.phase,
        title: a.title,
      })),
    });
  }, [layerNodes, handoffs, workspaceArtifacts]);

  const layout = useMemo(() => computeLayout(graph.nodes), [graph.nodes]);
  const positionById = useMemo(() => {
    const map = new Map<string, PositionedNode>();
    for (const p of layout.positioned) map.set(p.node.id, p);
    return map;
  }, [layout.positioned]);

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [promptPreviewLayer, setPromptPreviewLayer] = useState<TeamRoleLayer | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(
    null,
  );

  const handleWheel = useCallback((e: WheelEvent<HTMLDivElement>) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    setZoom((z) => Math.min(2.5, Math.max(0.4, z - e.deltaY * 0.001)));
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      dragRef.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y };
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    },
    [pan],
  );
  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    setPan({ x: drag.panX + (e.clientX - drag.startX), y: drag.panY + (e.clientY - drag.startY) });
  }, []);
  const onPointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const sessionNodeCount = graph.nodes.filter((n) => n.kind === 'session').length;

  const selectedSessionLayer: TeamRoleLayer | null = selectedSessionId
    ? (layerNodes.get(selectedSessionId)?.roleLayer ?? null)
    : null;

  if (graph.nodes.length === 0) {
    return (
      <TabContainer
        title="知识图谱"
        subtitle="工作区会话 / 产物 / handoff 的关系图，点击节点联动选中会话。"
      >
        <EmptyState
          emoji="🕸️"
          title="暂无图谱数据"
          description="团队启动后，会话树、层间 handoff 与工作区产物会在这里组成知识图谱。"
        />
      </TabContainer>
    );
  }

  if (graph.nodes.length > MAX_NODES) {
    return (
      <TabContainer title="知识图谱" subtitle="工作区会话 / 产物 / handoff 的关系图。">
        <EmptyState
          emoji="🗺️"
          title="图谱过大"
          description={`当前共有 ${graph.nodes.length} 个节点，超过 ${MAX_NODES} 的渲染上限。请缩小工作区范围或选中具体会话后再查看。`}
        />
      </TabContainer>
    );
  }

  return (
    <TabContainer
      title="知识图谱"
      subtitle="工作区会话 / 产物 / handoff 的关系图，点击节点联动选中会话。"
      actions={
        <div style={{ display: 'flex', gap: 4 }}>
          {selectedSessionLayer ? (
            <GraphBtn
              label="🧬 角色提示词"
              title={`查看选中会话所在层的角色提示词`}
              onClick={() => setPromptPreviewLayer(selectedSessionLayer)}
            />
          ) : null}
          <GraphBtn label="−" title="缩小" onClick={() => setZoom((z) => Math.max(0.4, z - 0.2))} />
          <GraphBtn label="+" title="放大" onClick={() => setZoom((z) => Math.min(2.5, z + 0.2))} />
          <GraphBtn label="复位" onClick={resetView} />
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1, minHeight: 0 }}>
        <GraphLegend />
        <div
          onWheel={handleWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          style={{
            flex: 1,
            minHeight: 360,
            overflow: 'hidden',
            position: 'relative',
            borderRadius: 12,
            border: '1px solid color-mix(in srgb, var(--border-default) 45%, transparent)',
            background:
              'linear-gradient(135deg, color-mix(in srgb, var(--accent) 4%, var(--bg-overlay)) 0%, var(--bg-base) 100%)',
            cursor: dragRef.current ? 'grabbing' : 'grab',
            touchAction: 'none',
          }}
        >
          <svg
            width={layout.width}
            height={layout.height}
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: '0 0',
              display: 'block',
            }}
          >
            {graph.edges.map((edge) => (
              <EdgeLine
                key={edge.id}
                edge={edge}
                from={positionById.get(edge.from)}
                to={positionById.get(edge.to)}
              />
            ))}
            {layout.positioned.map((p) => (
              <NodeBox
                key={p.node.id}
                positioned={p}
                selected={Boolean(
                  p.node.sessionId && selectedSessionId && p.node.sessionId === selectedSessionId,
                )}
                onClick={() => {
                  if (p.node.sessionId && onSelectSession) onSelectSession(p.node.sessionId);
                }}
              />
            ))}
          </svg>
        </div>
        <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
          {sessionNodeCount} 个会话节点 · {graph.edges.length} 条关系 · Ctrl/⌘ + 滚轮缩放，拖拽平移
        </span>
      </div>
      <RolePromptPreviewPanel
        layer={promptPreviewLayer}
        teamWorkspaceId={teamWorkspaceId}
        onClose={() => setPromptPreviewLayer(null)}
      />
    </TabContainer>
  );
}

function computeLayout(nodes: GraphNode[]): {
  positioned: PositionedNode[];
  width: number;
  height: number;
} {
  // session 节点按 layer 列分布；artifact 节点放在最右侧额外一列。
  const columnRows = new Map<number, number>(); // column → next row index
  const artifactColumn = 7;
  const positioned: PositionedNode[] = [];

  const nextRow = (col: number): number => {
    const row = columnRows.get(col) ?? 0;
    columnRows.set(col, row + 1);
    return row;
  };

  for (const node of nodes) {
    let col: number;
    if (node.kind === 'artifact') {
      col = artifactColumn;
    } else {
      col = node.layer ? (LAYER_COLUMN[node.layer] ?? 1) : 1;
    }
    const row = nextRow(col);
    positioned.push({
      node,
      x: MARGIN + col * COL_WIDTH,
      y: MARGIN + row * (NODE_H + ROW_GAP),
    });
  }

  let maxRow = 0;
  for (const count of columnRows.values()) maxRow = Math.max(maxRow, count);
  const maxCol = Math.max(artifactColumn, ...Array.from(columnRows.keys()));
  const width = MARGIN * 2 + (maxCol + 1) * COL_WIDTH;
  const height = MARGIN * 2 + maxRow * (NODE_H + ROW_GAP);
  return { positioned, width, height };
}

function EdgeLine({
  edge,
  from,
  to,
}: {
  edge: GraphEdge;
  from: PositionedNode | undefined;
  to: PositionedNode | undefined;
}) {
  if (!from || !to) return null;
  const x1 = from.x + NODE_W;
  const y1 = from.y + NODE_H / 2;
  const x2 = to.x;
  const y2 = to.y + NODE_H / 2;
  const midX = (x1 + x2) / 2;
  const color =
    edge.kind === 'handoff'
      ? (STATE_COLORS[edge.state ?? 'idle'] ?? 'var(--fg-muted)')
      : edge.kind === 'produces'
        ? 'var(--accent)'
        : 'color-mix(in srgb, var(--border-default) 80%, transparent)';
  return (
    <path
      d={`M${x1},${y1} C${midX},${y1} ${midX},${y2} ${x2},${y2}`}
      fill="none"
      stroke={color}
      strokeWidth={1.5}
      strokeDasharray={edge.kind === 'produces' ? '4 4' : undefined}
      opacity={0.8}
    />
  );
}

function NodeBox({
  positioned,
  selected,
  onClick,
}: {
  positioned: PositionedNode;
  selected: boolean;
  onClick: () => void;
}) {
  const { node, x, y } = positioned;
  const isArtifact = node.kind === 'artifact';
  const accent = isArtifact
    ? 'var(--accent)'
    : node.state
      ? (STATE_COLORS[node.state] ?? 'var(--fg-muted)')
      : 'var(--fg-muted)';
  const clickable = Boolean(node.sessionId);
  return (
    <g
      transform={`translate(${x},${y})`}
      style={{ cursor: clickable ? 'pointer' : 'default' }}
      onClick={onClick}
    >
      <rect
        width={NODE_W}
        height={NODE_H}
        rx={isArtifact ? 6 : 10}
        fill="var(--bg-overlay)"
        stroke={selected ? 'var(--accent)' : accent}
        strokeWidth={selected ? 2.5 : 1.5}
        strokeDasharray={isArtifact ? '5 3' : undefined}
      />
      <circle cx={12} cy={NODE_H / 2} r={4} fill={accent} />
      <text
        x={24}
        y={NODE_H / 2 - 3}
        fontSize={11}
        fontWeight={700}
        fill="var(--fg-strong)"
        style={{ userSelect: 'none' }}
      >
        {truncate(node.label, 14)}
      </text>
      <text
        x={24}
        y={NODE_H / 2 + 12}
        fontSize={9}
        fill="var(--fg-muted)"
        style={{ userSelect: 'none' }}
      >
        {isArtifact
          ? `产物 · ${node.state ?? ''}`
          : node.layer
            ? KNOWLEDGE_GRAPH_LAYER_LABELS[node.layer]
            : '会话'}
      </text>
    </g>
  );
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function GraphLegend() {
  const items: Array<{ color: string; label: string; dashed?: boolean }> = [
    { color: 'var(--success)', label: '运行中' },
    { color: 'var(--danger)', label: '失败' },
    { color: 'color-mix(in srgb, var(--border-default) 80%, transparent)', label: '父子' },
    { color: 'var(--accent)', label: '产物', dashed: true },
  ];
  return (
    <div
      style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 10, color: 'var(--fg-muted)' }}
    >
      {items.map((item) => (
        <span key={item.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span
            style={{
              width: 16,
              height: 0,
              borderTop: `2px ${item.dashed ? 'dashed' : 'solid'} ${item.color}`,
            }}
          />
          {item.label}
        </span>
      ))}
    </div>
  );
}

function GraphBtn({
  label,
  title,
  onClick,
}: {
  label: string;
  title?: string;
  onClick: () => void;
}) {
  const style: CSSProperties = {
    padding: '3px 8px',
    borderRadius: 6,
    border: '1px solid color-mix(in srgb, var(--border-default) 55%, transparent)',
    background: 'transparent',
    color: 'var(--fg-default)',
    fontSize: 11,
    fontWeight: 700,
    cursor: 'pointer',
    minWidth: 28,
  };
  return (
    <button type="button" onClick={onClick} title={title} style={style}>
      {label}
    </button>
  );
}
