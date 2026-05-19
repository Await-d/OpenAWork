/**
 * 260516-team-page-v2 · T-13 · TopologyView
 *
 * 「拓扑」tab 内容：
 *   - 5 层运行时拓扑（reception → pm1 → pm2 → executor → reviewer）
 *   - 节点上挂当前 session 数 + 状态徽章
 *   - 边的颜色按 handoff.state 变化
 *
 * 数据来源：useLayerStore + useHandoffStore
 */

import { Fragment, useMemo, type CSSProperties } from 'react';
import {
  useHandoffStore,
  useLayerStore,
  type HandoffState,
  type TeamRoleLayer,
} from '../../../../../stores/team/team-events.js';
import { TabContainer } from '../TabContainer.js';

const LAYER_ORDER: TeamRoleLayer[] = ['reception', 'pm1', 'pm2', 'executor', 'reviewer'];

const LAYER_META: Record<TeamRoleLayer, { name: string; sub: string; icon: string }> = {
  user: { name: '用户', sub: 'USER', icon: '👤' },
  reception: { name: '接待', sub: 'RECEPTION', icon: '🛎️' },
  pm1: { name: '规划', sub: 'PM1', icon: '🗺️' },
  pm2: { name: '管控', sub: 'PM2', icon: '🎛️' },
  executor: { name: '执行', sub: 'EXECUTOR', icon: '⚡' },
  reviewer: { name: '评审', sub: 'REVIEWER', icon: '🔍' },
};

const STATE_COLORS: Record<HandoffState | 'idle', string> = {
  idle: 'var(--fg-muted)',
  pending: 'var(--warning))',
  claimed: 'var(--aux))',
  running: 'var(--success))',
  completed: 'var(--fg-muted)',
  failed: 'var(--danger))',
  cancelled: 'var(--fg-muted)',
};

const CONTAINER_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};

const SECTION_TITLE_STYLE: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: 'var(--fg-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
};

const FLOW_GRID_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'stretch',
  justifyContent: 'space-between',
  gap: 8,
  padding: '20px 12px',
  borderRadius: 14,
  background:
    'linear-gradient(135deg, color-mix(in srgb, var(--accent) 4%, var(--bg-overlay) 0%, color-mix(in srgb, var(--bg-overlay) 90%, var(--bg-base) 100%)',
  border: '1px solid color-mix(in srgb, var(--border-default) 40%, transparent)',
  overflow: 'auto',
};

const NODE_STYLE: CSSProperties = {
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 4,
  width: 'clamp(110px, 14vw, 150px)',
  minHeight: 120,
  padding: '12px 8px',
  borderRadius: 14,
  background: 'color-mix(in srgb, var(--bg-overlay) 95%, var(--bg-base))',
  border: '2px solid color-mix(in srgb, var(--border-default) 60%, transparent)',
  flexShrink: 0,
  transition: 'all 200ms ease',
};

const NODE_ACTIVE_STYLE: CSSProperties = {
  ...NODE_STYLE,
  borderColor: 'var(--success))',
  boxShadow: '0 0 0 4px color-mix(in srgb, var(--success) 18%, transparent)',
};

const NODE_FAILED_STYLE: CSSProperties = {
  ...NODE_STYLE,
  borderColor: 'var(--danger))',
  boxShadow: '0 0 0 4px color-mix(in srgb, var(--danger) 18%, transparent)',
};

const EDGE_STYLE: CSSProperties = {
  flex: 1,
  minWidth: 30,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  position: 'relative',
};

interface NodeData {
  layer: TeamRoleLayer;
  sessionCount: number;
  runningCount: number;
  failedCount: number;
  visualState: 'active' | 'failed' | 'completed' | 'idle';
}

interface EdgeData {
  fromLayer: TeamRoleLayer;
  toLayer: TeamRoleLayer;
  pendingCount: number;
  runningCount: number;
  completedCount: number;
  failedCount: number;
  totalCount: number;
}

export function TopologyView() {
  const nodes = useLayerStore((s) => s.nodes);
  const handoffs = useHandoffStore((s) => s.handoffs);

  const nodeData = useMemo<NodeData[]>(() => {
    return LAYER_ORDER.map((layer) => {
      let sessionCount = 0;
      let runningCount = 0;
      let failedCount = 0;
      for (const node of nodes.values()) {
        if (node.roleLayer === layer) {
          sessionCount++;
          if (node.state === 'running' || node.state === 'claimed' || node.state === 'pending')
            runningCount++;
          else if (node.state === 'failed') failedCount++;
        }
      }
      const visualState: NodeData['visualState'] =
        failedCount > 0
          ? 'failed'
          : runningCount > 0
            ? 'active'
            : sessionCount > 0
              ? 'completed'
              : 'idle';
      return { layer, sessionCount, runningCount, failedCount, visualState };
    });
  }, [nodes]);

  const edgeData = useMemo<EdgeData[]>(() => {
    const edges: EdgeData[] = [];
    for (let i = 0; i < LAYER_ORDER.length - 1; i++) {
      const fromLayer = LAYER_ORDER[i]!;
      const toLayer = LAYER_ORDER[i + 1]!;
      let pendingCount = 0;
      let runningCount = 0;
      let completedCount = 0;
      let failedCount = 0;
      let totalCount = 0;
      for (const h of handoffs.values()) {
        if (h.fromRoleLayer === fromLayer && h.toRoleLayer === toLayer) {
          totalCount++;
          if (h.state === 'pending' || h.state === 'claimed') pendingCount++;
          else if (h.state === 'running') runningCount++;
          else if (h.state === 'completed') completedCount++;
          else if (h.state === 'failed') failedCount++;
        }
      }
      edges.push({
        fromLayer,
        toLayer,
        pendingCount,
        runningCount,
        completedCount,
        failedCount,
        totalCount,
      });
    }
    return edges;
  }, [handoffs]);

  const hasData = nodes.size > 0 || handoffs.size > 0;

  return (
    <TabContainer
      title="5 层运行时拓扑"
      subtitle="reception → pm1 → pm2 → executor → reviewer，按 handoff 状态实时联动。"
    >
      <div style={CONTAINER_STYLE}>
        <div style={FLOW_GRID_STYLE}>
          {nodeData.map((node, idx) => (
            <Fragment key={node.layer}>
              <Node data={node} />
              {idx < edgeData.length ? <Edge data={edgeData[idx]!} /> : null}
            </Fragment>
          ))}
        </div>

        {!hasData ? (
          <div
            style={{
              display: 'grid',
              placeItems: 'center',
              padding: 24,
              borderRadius: 12,
              border: '1px dashed color-mix(in srgb, var(--border-default) 60%, transparent)',
              color: 'var(--fg-muted)',
              fontSize: 12,
              gap: 6,
            }}
          >
            <span style={{ fontSize: 22 }} aria-hidden>
              🕸️
            </span>
            <span>暂无运行时拓扑数据。团队启动后，每层 session 与 handoff 会出现在这里。</span>
          </div>
        ) : null}

        {/* 边（handoff）明细列表 */}
        <div style={{ display: 'grid', gap: 8 }}>
          <span style={SECTION_TITLE_STYLE}>层间 handoff 明细</span>
          <div style={{ display: 'grid', gap: 6 }}>
            {edgeData.map((edge) => (
              <EdgeRow key={`${edge.fromLayer}->${edge.toLayer}`} data={edge} />
            ))}
          </div>
        </div>
      </div>
    </TabContainer>
  );
}

function Node({ data }: { data: NodeData }) {
  const meta = LAYER_META[data.layer];
  const style =
    data.visualState === 'failed'
      ? NODE_FAILED_STYLE
      : data.visualState === 'active'
        ? NODE_ACTIVE_STYLE
        : NODE_STYLE;
  return (
    <div style={style} title={`${meta.name}（${meta.sub}）`}>
      <span style={{ fontSize: 22 }} aria-hidden>
        {meta.icon}
      </span>
      <strong style={{ fontSize: 13, color: 'var(--fg-strong)' }}>{meta.name}</strong>
      <span
        style={{
          fontSize: 9,
          color: 'var(--fg-muted)',
          fontWeight: 700,
          letterSpacing: '0.06em',
        }}
      >
        {meta.sub}
      </span>
      <div
        style={{
          display: 'flex',
          gap: 4,
          alignItems: 'center',
          fontSize: 10,
          color: 'var(--fg-default)',
          fontWeight: 700,
        }}
      >
        <span>会话 {data.sessionCount}</span>
      </div>
      {data.runningCount > 0 ? (
        <span
          style={{
            position: 'absolute',
            top: -8,
            right: -8,
            padding: '1px 7px',
            borderRadius: 999,
            background: 'var(--success))',
            color: 'var(--fg-on-accent)',
            fontSize: 10,
            fontWeight: 800,
          }}
        >
          ▶ {data.runningCount}
        </span>
      ) : null}
      {data.failedCount > 0 ? (
        <span
          style={{
            position: 'absolute',
            bottom: -8,
            right: -8,
            padding: '1px 7px',
            borderRadius: 999,
            background: 'var(--danger))',
            color: 'var(--fg-on-accent)',
            fontSize: 10,
            fontWeight: 800,
          }}
        >
          ✕ {data.failedCount}
        </span>
      ) : null}
    </div>
  );
}

function Edge({ data }: { data: EdgeData }) {
  const active = data.runningCount > 0 || data.pendingCount > 0;
  const failed = data.failedCount > 0;
  const color = failed
    ? 'var(--danger))'
    : active
      ? 'var(--success))'
      : 'color-mix(in srgb, var(--border-default) 70%, transparent)';
  return (
    <div style={EDGE_STYLE}>
      <svg width="100%" height={24} viewBox="0 0 100 24" preserveAspectRatio="none">
        <line
          x1={0}
          y1={12}
          x2={88}
          y2={12}
          stroke={color}
          strokeWidth={2}
          strokeDasharray={active ? '0' : '4 4'}
        />
        <polygon points="88,6 100,12 88,18" fill={color} />
      </svg>
      {data.totalCount > 0 ? (
        <span
          style={{
            position: 'absolute',
            top: -16,
            padding: '0 6px',
            borderRadius: 999,
            background: 'color-mix(in srgb, var(--bg-overlay) 95%, var(--bg-base))',
            border: `1px solid ${color}`,
            color: 'var(--fg-default)',
            fontSize: 9,
            fontWeight: 700,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {data.totalCount}
        </span>
      ) : null}
    </div>
  );
}

function EdgeRow({ data }: { data: EdgeData }) {
  if (data.totalCount === 0) {
    return (
      <div
        style={{
          display: 'flex',
          gap: 10,
          padding: '6px 12px',
          borderRadius: 8,
          border: '1px solid color-mix(in srgb, var(--border-default) 40%, transparent)',
          fontSize: 12,
          color: 'var(--fg-muted)',
        }}
      >
        <span style={{ minWidth: 130, fontWeight: 600 }}>
          {LAYER_META[data.fromLayer].name} → {LAYER_META[data.toLayer].name}
        </span>
        <span>暂无</span>
      </div>
    );
  }
  return (
    <div
      style={{
        display: 'flex',
        gap: 10,
        padding: '8px 12px',
        borderRadius: 8,
        border: '1px solid color-mix(in srgb, var(--border-default) 50%, transparent)',
        background: 'color-mix(in srgb, var(--bg-overlay) 80%, var(--bg-base))',
        fontSize: 12,
      }}
    >
      <span style={{ minWidth: 130, color: 'var(--fg-strong)', fontWeight: 700 }}>
        {LAYER_META[data.fromLayer].name} → {LAYER_META[data.toLayer].name}
      </span>
      <PillStat label="待领取" value={data.pendingCount} color={STATE_COLORS.pending} />
      <PillStat label="运行" value={data.runningCount} color={STATE_COLORS.running} />
      <PillStat label="完成" value={data.completedCount} color={STATE_COLORS.completed} />
      <PillStat label="失败" value={data.failedCount} color={STATE_COLORS.failed} />
      <span style={{ flex: 1 }} />
      <span style={{ color: 'var(--fg-muted)' }}>合计 {data.totalCount}</span>
    </div>
  );
}

function PillStat({ label, value, color }: { label: string; value: number; color: string }) {
  if (value === 0) return null;
  return (
    <span
      style={{
        display: 'inline-flex',
        gap: 4,
        padding: '1px 8px',
        borderRadius: 999,
        background: 'color-mix(in srgb, var(--bg-overlay) 60%, transparent)',
        border: `1px solid ${color}`,
        color: 'var(--fg-default)',
        fontSize: 10,
        fontWeight: 700,
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      <span style={{ color: 'var(--fg-muted)' }}>{label}</span>
      <strong style={{ color }}>{value}</strong>
    </span>
  );
}
