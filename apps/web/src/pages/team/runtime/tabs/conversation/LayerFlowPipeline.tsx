/**
 * LayerFlowPipeline · 层级流水线可视化
 *
 * 5 个节点（接待 → 规划 → 管控 → 执行 → 评审）+ 4 条连线，
 * 用 CSS Grid 交替排列节点和连线，保证节点等宽、连线自适应。
 *
 * 优化要点（v2）：
 *   - 节点卡片精简信息层级：图标 + 层名 + 状态徽章为核心，其余降为次级
 *   - 连线增加粗度、状态色填充、箭头方向感
 *   - 窄屏下自动收起次要信息，保持核心可读
 *   - 所有色彩引用 CSS 变量 token，间距遵循 4/8 间距阶梯
 */

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { getRoleLayerIdentity } from '../../data/role-layer-identity.js';
import type {
  HandoffEntry,
  HandoffState,
  TeamRoleLayer,
} from '../../../../../stores/team/team-events.js';

export interface LayerNodeView {
  active: boolean;
  inboundCount: number;
  layer: TeamRoleLayer;
  /** 该层所有角色实例的 session 列表（含 displayName / personaKey） */
  roleInstances: Array<{
    sessionId: string;
    displayName: string | null;
    personaKey: string | null;
    state: HandoffState | 'idle';
  }>;
  sessionId: string | null;
  state: HandoffState | 'idle';
}

export interface EdgeView {
  active: boolean;
  fromIndex: number;
  latest: HandoffEntry | null;
  state: HandoffState | 'idle';
  toIndex: number;
}

const STATE_LABELS: Record<string, string> = {
  idle: '空闲',
  pending: '等待中',
  claimed: '已认领',
  running: '运行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

const STATE_COLOR: Record<string, string> = {
  idle: 'var(--fg-muted)',
  pending: 'var(--warning)',
  claimed: 'var(--aux)',
  running: 'var(--success)',
  completed: 'var(--accent)',
  failed: 'var(--danger)',
  cancelled: 'var(--fg-muted)',
};

/**
 * Grid: node[0] edge[0] node[1] edge[1] ... node[4]
 * 节点用 minmax 保证最小宽度，连线固定 56px。
 */
const PIPELINE_GRID_STYLE: CSSProperties = {
  display: 'grid',
  gridTemplateColumns:
    'minmax(0, 1fr) 56px minmax(0, 1fr) 56px minmax(0, 1fr) 56px minmax(0, 1fr) 56px minmax(0, 1fr)',
  alignItems: 'stretch',
  gap: '0',
  flex: 1,
  minWidth: 0,
};

function FlowNode({
  onSelect,
  selected,
  view,
}: {
  onSelect: () => void;
  selected: boolean;
  view: LayerNodeView;
}) {
  const id = getRoleLayerIdentity(view.layer);
  const color = view.state === 'idle' ? id.color : (STATE_COLOR[view.state] ?? id.color);
  const clickable = Boolean(view.sessionId);
  const arriveKey = view.active ? 'on' : 'off';
  const prevActiveRef = useRef(arriveKey);
  const [arrive, setArrive] = useState(false);

  useEffect(() => {
    if (prevActiveRef.current !== arriveKey && arriveKey === 'on') {
      setArrive(true);
      const t = setTimeout(() => setArrive(false), 460);
      prevActiveRef.current = arriveKey;
      return () => clearTimeout(t);
    }
    prevActiveRef.current = arriveKey;
    return undefined;
  }, [arriveKey]);

  const nodeStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    width: '100%',
    minWidth: 0,
    padding: '12px 6px',
    borderRadius: 'var(--radius-md, 8px)',
    border: selected
      ? `1.5px solid ${color}`
      : `1px solid color-mix(in srgb, ${color} 30%, transparent)`,
    background: selected
      ? `color-mix(in srgb, ${color} 14%, var(--bg-overlay))`
      : `color-mix(in srgb, ${color} 5%, var(--bg-overlay))`,
    cursor: clickable ? 'pointer' : 'default',
    opacity: clickable || view.active ? 1 : 0.65,
    transition: 'background 160ms ease, border-color 160ms ease, box-shadow 160ms ease',
    ['--team-flow-glow' as string]: `color-mix(in srgb, ${color} 45%, transparent)`,
    ['--team-flow-glow-mid' as string]: color,
    boxShadow: selected
      ? `0 0 0 1px color-mix(in srgb, ${color} 18%, transparent), 0 8px 20px -14px color-mix(in srgb, ${color} 40%, transparent)`
      : view.active
        ? `0 6px 16px -14px color-mix(in srgb, ${color} 30%, transparent)`
        : 'none',
  };

  const circleStyle: CSSProperties = {
    display: 'grid',
    placeItems: 'center',
    width: 32,
    height: 32,
    borderRadius: '50%',
    fontSize: 15,
    background: `color-mix(in srgb, ${color} 16%, var(--bg-overlay))`,
    border: `1.5px solid ${color}`,
    flexShrink: 0,
    animation: [
      view.active ? 'team-flow-node-pulse 1.8s ease-in-out infinite' : null,
      arrive ? 'team-flow-node-arrive 0.46s ease-out' : null,
    ]
      .filter(Boolean)
      .join(', '),
  };

  /* 构建角色实例 tooltip 文本 */
  const roleTooltip =
    view.roleInstances.length > 0
      ? view.roleInstances
          .map((r) => r.displayName ?? r.personaKey ?? r.sessionId.slice(-8))
          .join(', ')
      : undefined;

  return (
    <button
      type="button"
      onClick={clickable ? onSelect : undefined}
      disabled={!clickable}
      aria-pressed={selected}
      title={clickable ? `查看${id.label}对话` : `${id.label}（暂无会话）`}
      style={nodeStyle}
    >
      {/* 图标圆 */}
      <span aria-hidden style={circleStyle}>
        {id.icon}
      </span>

      {/* 层名 */}
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: 'var(--fg-strong)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          maxWidth: '100%',
        }}
      >
        {id.short}
      </span>

      {/* 状态徽章 */}
      <span
        style={{
          fontSize: 9,
          fontWeight: 700,
          padding: '1px 7px',
          borderRadius: 'var(--radius-pill, 9999px)',
          background: `color-mix(in srgb, ${color} 14%, transparent)`,
          border: `1px solid color-mix(in srgb, ${color} 28%, transparent)`,
          color,
          whiteSpace: 'nowrap',
        }}
      >
        {view.active ? '● ' : ''}
        {STATE_LABELS[view.state] ?? view.state}
      </span>

      {/* 次级信息：角色实例数 + 交接次数，紧凑横排 */}
      {(view.roleInstances.length > 1 || view.inboundCount > 0) && (
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 9,
            color: 'var(--fg-muted)',
            fontVariantNumeric: 'tabular-nums',
            whiteSpace: 'nowrap',
          }}
        >
          {view.roleInstances.length > 1 ? (
            <span style={{ color: 'var(--accent)', fontWeight: 700 }}>
              {view.roleInstances.length}角色
            </span>
          ) : null}
          {view.roleInstances.length > 1 && view.inboundCount > 0 ? (
            <span aria-hidden style={{ color: 'var(--border-default)' }}>
              ·
            </span>
          ) : null}
          {view.inboundCount > 0 ? <span>{view.inboundCount}次</span> : null}
        </span>
      )}

      {/* 首个角色实例名（仅单个实例时显示） */}
      {view.roleInstances.length === 1 && view.roleInstances[0]?.displayName ? (
        <span
          style={{
            fontSize: 8.5,
            color: 'var(--fg-subtle)',
            maxWidth: 90,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={roleTooltip}
        >
          {view.roleInstances[0]!.displayName}
        </span>
      ) : null}
    </button>
  );
}

function FlowEdge({ edge, onSelect }: { edge: EdgeView; onSelect?: () => void }) {
  const color =
    edge.state === 'idle'
      ? 'var(--border-default)'
      : (STATE_COLOR[edge.state] ?? 'var(--fg-muted)');
  const clickable = Boolean(onSelect);

  /* 连线轨道：活跃时有流光动画，非活跃时静态 */
  const trackStyle: CSSProperties = edge.active
    ? {
        height: 3,
        width: '100%',
        borderRadius: 'var(--radius-pill, 9999px)',
        backgroundImage: `linear-gradient(90deg, color-mix(in srgb, ${color} 20%, transparent) 0%, ${color} 50%, color-mix(in srgb, ${color} 20%, transparent) 100%)`,
        backgroundSize: '200% 100%',
        animation: 'team-flow-dash 1.1s linear infinite',
      }
    : {
        height: 2,
        width: '100%',
        borderRadius: 'var(--radius-pill, 9999px)',
        background:
          edge.latest && edge.state !== 'idle'
            ? `color-mix(in srgb, ${color} 50%, transparent)`
            : 'color-mix(in srgb, var(--border-default) 45%, transparent)',
      };

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={!clickable}
      aria-label={edge.latest ? '查看该层间消息详情' : '该相邻层暂无消息传递'}
      title={edge.latest ? '查看层间消息详情' : '暂无传递'}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        padding: '8px 2px',
        background: 'transparent',
        border: 'none',
        cursor: clickable ? 'pointer' : 'default',
        transition: 'opacity 160ms ease',
        opacity: edge.state === 'idle' && !edge.latest ? 0.5 : 1,
      }}
    >
      {/* 箭头 */}
      <span
        aria-hidden
        style={{
          fontSize: 12,
          color,
          lineHeight: 1,
          fontWeight: 700,
        }}
      >
        ▸
      </span>
      {/* 连线 */}
      <span style={trackStyle} aria-hidden />
      {/* 状态标签 */}
      {edge.latest ? (
        <span
          style={{
            fontSize: 8.5,
            fontWeight: 600,
            color: 'var(--fg-muted)',
            whiteSpace: 'nowrap',
          }}
        >
          {STATE_LABELS[edge.state] ?? edge.state}
        </span>
      ) : (
        <span style={{ fontSize: 8.5, color: 'var(--fg-subtle)' }}>—</span>
      )}
    </button>
  );
}

export interface LayerFlowPipelineProps {
  edges: EdgeView[];
  layerViews: LayerNodeView[];
  selectedSessionId: string | null;
  onSelectHandoff: (entry: HandoffEntry) => void;
  onSelectLayer: (view: LayerNodeView) => void;
}

export function LayerFlowPipeline({
  edges,
  layerViews,
  onSelectHandoff,
  onSelectLayer,
  selectedSessionId,
}: LayerFlowPipelineProps) {
  // Interleave: node[0], edge[0], node[1], edge[1], ..., node[n-1]
  const items: Array<
    | { kind: 'node'; view: LayerNodeView; idx: number }
    | { kind: 'edge'; edge: EdgeView; idx: number }
  > = [];

  for (let i = 0; i < layerViews.length; i++) {
    items.push({ kind: 'node', view: layerViews[i]!, idx: i });
    if (i < edges.length) {
      items.push({ kind: 'edge', edge: edges[i]!, idx: i });
    }
  }

  return (
    <div style={PIPELINE_GRID_STYLE}>
      {items.map((item) =>
        item.kind === 'node' ? (
          <FlowNode
            key={`node-${item.view.layer}`}
            view={item.view}
            selected={Boolean(item.view.sessionId && selectedSessionId === item.view.sessionId)}
            onSelect={() => onSelectLayer(item.view)}
          />
        ) : (
          <FlowEdge
            key={`edge-${item.idx}`}
            edge={item.edge}
            onSelect={item.edge.latest ? () => onSelectHandoff(item.edge.latest!) : undefined}
          />
        ),
      )}
    </div>
  );
}
