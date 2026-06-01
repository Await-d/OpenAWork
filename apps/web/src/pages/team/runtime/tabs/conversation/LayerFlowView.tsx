/**
 * LayerFlowView · 层级消息流动图（带动画）
 *
 * 解决三件事：
 *   ① 各层级对话「看得到」——把 reception → pm1 → pm2 → executor → reviewer 画成一条
 *      横向流水线，每层一个节点，节点状态/活跃度一目了然。
 *   ② 层级间「消息触发 + 详情」——节点之间的连线代表 handoff（消息传递）。点击连线看
 *      handoff 详情（from→to / 状态 / 摘要 / 时间），点击节点展开该层 session 的对话。
 *   ③ 「动画效果」——活跃层节点呼吸脉冲；正在传递的连线有流光；新事件到达时节点弹跳。
 *
 * 数据来源：useHandoffStore（层间 handoff 边）+ useLayerStore（各层 session 节点），
 * 由 team-events WS 实时填充。无新后端依赖。
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  useHandoffStore,
  useLayerStore,
  type HandoffEntry,
  type HandoffState,
  type TeamRoleLayer,
} from '../../../../../stores/team/team-events.js';
import { getRoleLayerIdentity } from '../../data/role-layer-identity.js';
import { TeamConversationView } from '../../../conversation/TeamConversationView.js';
import { TabContainer } from '../TabContainer.js';
import { EmptyState } from '../../shared/content-kit/index.js';

/** 流水线展示的层级顺序（不含 user / tester，聚焦核心 5 层）。 */
const FLOW_LAYERS: TeamRoleLayer[] = ['reception', 'pm1', 'pm2', 'executor', 'reviewer'];

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

const ACTIVE_STATES = new Set<HandoffState>(['pending', 'claimed', 'running']);

interface LayerNodeView {
  layer: TeamRoleLayer;
  /** 该层是否有已知 session（可点开对话）。 */
  sessionId: string | null;
  /** 该层当前聚合状态：取该层 to 的最近 handoff 状态，或 session 节点状态。 */
  state: HandoffState | 'idle';
  /** 是否活跃（脉冲动画）。 */
  active: boolean;
  /** 流入该层的 handoff 数（作为 to）。 */
  inboundCount: number;
}

interface EdgeView {
  fromIndex: number;
  toIndex: number;
  /** 该相邻层之间最近一条 handoff。 */
  latest: HandoffEntry | null;
  active: boolean;
  state: HandoffState | 'idle';
}

const CONTAINER_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
  minHeight: 0,
  flex: 1,
};

const FLOW_ROW_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'stretch',
  gap: 0,
  padding: '18px 8px',
  borderRadius: 14,
  border: '1px solid color-mix(in srgb, var(--border-default) 45%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 60%, var(--bg-base))',
  overflowX: 'auto',
  flexShrink: 0,
};

const SPLIT_STYLE: CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'grid',
  gridTemplateColumns: 'minmax(260px, 340px) minmax(0, 1fr)',
  gap: 12,
};

const TIMELINE_PANEL_STYLE: CSSProperties = {
  minHeight: 0,
  overflow: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  paddingRight: 10,
  borderRight: '1px solid color-mix(in srgb, var(--border-default) 30%, transparent)',
};

const DETAIL_PANE_STYLE: CSSProperties = {
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  borderRadius: 12,
  border: '1px solid color-mix(in srgb, var(--border-default) 40%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 60%, var(--bg-base))',
  overflow: 'hidden',
};

export function LayerFlowView() {
  const handoffs = useHandoffStore((s) => s.handoffs);
  const nodes = useLayerStore((s) => s.nodes);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedHandoffId, setSelectedHandoffId] = useState<string | null>(null);

  // 派生每层节点视图：聚合该层作为 to 的 handoff，以及 layer store 里的 session。
  const layerViews = useMemo<LayerNodeView[]>(() => {
    const entries = Array.from(handoffs.values());
    return FLOW_LAYERS.map((layer) => {
      const inbound = entries.filter((h) => h.toRoleLayer === layer);
      inbound.sort((a, b) => b.updatedAt - a.updatedAt);
      const latest = inbound[0] ?? null;
      // 优先用该层最近 handoff 的 session；否则从 layer store 找该层任意 session。
      let sessionId = latest?.sessionId ?? null;
      if (!sessionId) {
        for (const node of nodes.values()) {
          if (node.roleLayer === layer) {
            sessionId = node.sessionId;
            break;
          }
        }
      }
      const state: HandoffState | 'idle' = latest?.state ?? 'idle';
      return {
        layer,
        sessionId,
        state,
        active: latest ? ACTIVE_STATES.has(latest.state) : false,
        inboundCount: inbound.length,
      };
    });
  }, [handoffs, nodes]);

  // 派生相邻层之间的边。
  const edges = useMemo<EdgeView[]>(() => {
    const entries = Array.from(handoffs.values());
    const result: EdgeView[] = [];
    for (let i = 0; i < FLOW_LAYERS.length - 1; i++) {
      const from = FLOW_LAYERS[i]!;
      const to = FLOW_LAYERS[i + 1]!;
      const matching = entries
        .filter((h) => h.fromRoleLayer === from && h.toRoleLayer === to)
        .sort((a, b) => b.updatedAt - a.updatedAt);
      const latest = matching[0] ?? null;
      result.push({
        fromIndex: i,
        toIndex: i + 1,
        latest,
        active: latest ? ACTIVE_STATES.has(latest.state) : false,
        state: latest?.state ?? 'idle',
      });
    }
    return result;
  }, [handoffs]);

  // 时间线（全部 handoff，时间倒序），点击查看详情 + 打开会话。
  const timeline = useMemo<HandoffEntry[]>(() => {
    const list = Array.from(handoffs.values());
    list.sort((a, b) => b.updatedAt - a.updatedAt);
    return list;
  }, [handoffs]);

  const selectedHandoff = selectedHandoffId ? (handoffs.get(selectedHandoffId) ?? null) : null;

  const handleSelectLayer = (view: LayerNodeView) => {
    if (!view.sessionId) return;
    setSelectedSessionId((prev) => (prev === view.sessionId ? null : view.sessionId));
    setSelectedHandoffId(null);
  };

  const handleSelectHandoff = (entry: HandoffEntry) => {
    setSelectedHandoffId(entry.id);
    if (entry.sessionId) setSelectedSessionId(entry.sessionId);
  };

  if (handoffs.size === 0 && nodes.size === 0) {
    return (
      <TabContainer
        title="层级流动"
        subtitle="把消息在 接待 → 规划 → 管控 → 执行 → 评审 各层之间的传递实时画成流水线。"
      >
        <EmptyState
          emoji="🪜"
          title="还没有跨层流动"
          description="当前会话还停留在接待层直接对话。一旦你提出需要规划/执行的任务，团队会展开 接待 → 规划 → 管控 → 执行 → 评审 的层级协作，过程会在这里实时画成流水线。"
        />
      </TabContainer>
    );
  }

  return (
    <TabContainer
      title="层级流动"
      subtitle="把消息在 接待 → 规划 → 管控 → 执行 → 评审 各层之间的传递实时画成流水线。点节点看对话，点连线看消息详情。"
    >
      <div style={CONTAINER_STYLE}>
        {/* 流水线：节点 + 动画连线 */}
        <div style={FLOW_ROW_STYLE} role="group" aria-label="层级流水线">
          {layerViews.map((view, idx) => (
            <FlowSegment
              key={view.layer}
              view={view}
              edge={idx < edges.length ? edges[idx]! : null}
              selected={Boolean(view.sessionId && selectedSessionId === view.sessionId)}
              onSelectLayer={() => handleSelectLayer(view)}
              onSelectEdge={
                idx < edges.length && edges[idx]!.latest
                  ? () => handleSelectHandoff(edges[idx]!.latest!)
                  : undefined
              }
            />
          ))}
        </div>

        {/* 详情区：左 timeline + 右会话/详情 */}
        <div style={SPLIT_STYLE}>
          <div style={TIMELINE_PANEL_STYLE}>
            {timeline.length === 0 ? (
              <EmptyState emoji="📭" title="暂无层间消息" compact style={{ flex: 1 }} />
            ) : (
              timeline.map((entry) => (
                <HandoffTimelineRow
                  key={entry.id}
                  entry={entry}
                  selected={selectedHandoffId === entry.id}
                  onSelect={() => handleSelectHandoff(entry)}
                />
              ))
            )}
          </div>

          <div style={DETAIL_PANE_STYLE}>
            {selectedHandoff ? <HandoffDetailHeader entry={selectedHandoff} /> : null}
            {selectedSessionId ? (
              <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                <TeamConversationView sessionId={selectedSessionId} compact />
              </div>
            ) : (
              <EmptyState
                emoji="💬"
                title="选择上方节点或左侧消息查看详情"
                description="点击流水线上的层级节点展开该层对话；点击连线或左侧消息查看一次层间传递的详情。"
                style={{ flex: 1 }}
              />
            )}
          </div>
        </div>
      </div>
    </TabContainer>
  );
}

// ─── 流水线节点 + 连线 ──────────────────────────────────────────────────────

function FlowSegment({
  view,
  edge,
  selected,
  onSelectLayer,
  onSelectEdge,
}: {
  view: LayerNodeView;
  edge: EdgeView | null;
  selected: boolean;
  onSelectLayer: () => void;
  onSelectEdge?: () => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', flex: '1 0 auto' }}>
      <FlowNode view={view} selected={selected} onSelect={onSelectLayer} />
      {edge ? <FlowEdge edge={edge} onSelect={onSelectEdge} /> : null}
    </div>
  );
}

function FlowNode({
  view,
  selected,
  onSelect,
}: {
  view: LayerNodeView;
  selected: boolean;
  onSelect: () => void;
}) {
  const id = getRoleLayerIdentity(view.layer);
  const color = view.state === 'idle' ? id.color : (STATE_COLOR[view.state] ?? id.color);
  const clickable = Boolean(view.sessionId);

  // 新事件到达 → 一次性弹跳动画：用 updatedAt 变化作为触发。
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
    gap: 6,
    width: 96,
    padding: '10px 8px',
    borderRadius: 12,
    border: selected
      ? `1.5px solid ${color}`
      : `1px solid color-mix(in srgb, ${color} 35%, transparent)`,
    background: selected
      ? `color-mix(in srgb, ${color} 14%, var(--bg-overlay))`
      : `color-mix(in srgb, ${color} 6%, var(--bg-overlay))`,
    cursor: clickable ? 'pointer' : 'default',
    opacity: clickable || view.active ? 1 : 0.7,
    flexShrink: 0,
    transition: 'background 160ms ease, border-color 160ms ease',
    // 自定义 CSS 变量供 keyframe team-flow-node-pulse 读取（用 as 注入，避免与
    // CSSProperties 的强类型冲突）。
    ['--team-flow-glow' as string]: `color-mix(in srgb, ${color} 45%, transparent)`,
    ['--team-flow-glow-mid' as string]: color,
  };

  const circleStyle: CSSProperties = {
    display: 'grid',
    placeItems: 'center',
    width: 38,
    height: 38,
    borderRadius: '50%',
    fontSize: 18,
    background: `color-mix(in srgb, ${color} 18%, var(--bg-overlay))`,
    border: `1.5px solid ${color}`,
    animation: [
      view.active ? 'team-flow-node-pulse 1.8s ease-in-out infinite' : null,
      arrive ? 'team-flow-node-arrive 0.46s ease-out' : null,
    ]
      .filter(Boolean)
      .join(', '),
  };

  return (
    <button
      type="button"
      onClick={clickable ? onSelect : undefined}
      disabled={!clickable}
      aria-pressed={selected}
      title={clickable ? `查看${id.label}对话` : `${id.label}（暂无会话）`}
      style={nodeStyle}
    >
      <span aria-hidden style={circleStyle}>
        {id.icon}
      </span>
      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--fg-strong)' }}>{id.short}</span>
      <span
        style={{
          fontSize: 9.5,
          fontWeight: 700,
          padding: '1px 7px',
          borderRadius: 999,
          background: `color-mix(in srgb, ${color} 16%, transparent)`,
          color,
        }}
      >
        {STATE_LABELS[view.state] ?? view.state}
      </span>
      {view.inboundCount > 0 ? (
        <span style={{ fontSize: 9, color: 'var(--fg-muted)', fontVariantNumeric: 'tabular-nums' }}>
          {view.inboundCount} 次传递
        </span>
      ) : null}
    </button>
  );
}

function FlowEdge({ edge, onSelect }: { edge: EdgeView; onSelect?: () => void }) {
  const color = edge.state === 'idle' ? 'var(--border-default)' : (STATE_COLOR[edge.state] ?? 'var(--fg-muted)');
  const clickable = Boolean(onSelect);

  // 活跃边：流光动画（gradient + 背景位移）。静态边：实线。
  const trackStyle: CSSProperties = edge.active
    ? {
        height: 3,
        width: '100%',
        borderRadius: 999,
        backgroundImage: `linear-gradient(90deg, color-mix(in srgb, ${color} 20%, transparent) 0%, ${color} 50%, color-mix(in srgb, ${color} 20%, transparent) 100%)`,
        backgroundSize: '200% 100%',
        animation: 'team-flow-dash 1.1s linear infinite',
      }
    : {
        height: 2,
        width: '100%',
        borderRadius: 999,
        background:
          edge.latest && edge.state !== 'idle'
            ? `color-mix(in srgb, ${color} 55%, transparent)`
            : 'color-mix(in srgb, var(--border-default) 50%, transparent)',
      };

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={!clickable}
      aria-label={edge.latest ? '查看该层间消息详情' : '该相邻层暂无消息传递'}
      title={edge.latest ? '查看层间消息详情' : '暂无传递'}
      style={{
        flex: '1 1 32px',
        minWidth: 28,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 3,
        padding: '0 4px',
        background: 'transparent',
        border: 'none',
        cursor: clickable ? 'pointer' : 'default',
      }}
    >
      <span aria-hidden style={{ fontSize: 11, color, lineHeight: 1 }}>
        ▸
      </span>
      <span style={trackStyle} aria-hidden />
      {edge.latest ? (
        <span style={{ fontSize: 9, color: 'var(--fg-muted)' }}>
          {STATE_LABELS[edge.state] ?? edge.state}
        </span>
      ) : (
        <span style={{ fontSize: 9, color: 'var(--fg-muted)', opacity: 0.5 }}>—</span>
      )}
    </button>
  );
}

// ─── 时间线行 + 详情头 ──────────────────────────────────────────────────────

function HandoffTimelineRow({
  entry,
  selected,
  onSelect,
}: {
  entry: HandoffEntry;
  selected: boolean;
  onSelect: () => void;
}) {
  const fromId = getRoleLayerIdentity(entry.fromRoleLayer);
  const toId = getRoleLayerIdentity(entry.toRoleLayer);
  const color = STATE_COLOR[entry.state] ?? 'var(--fg-muted)';
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      style={{
        textAlign: 'left',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: '8px 10px',
        borderRadius: 10,
        border: selected
          ? `1px solid color-mix(in srgb, ${color} 60%, transparent)`
          : '1px solid color-mix(in srgb, var(--border-default) 40%, transparent)',
        background: selected
          ? `color-mix(in srgb, ${color} 10%, var(--bg-overlay))`
          : 'color-mix(in srgb, var(--bg-overlay) 75%, var(--bg-base))',
        cursor: 'pointer',
        width: '100%',
        animation: 'team-flow-row-in 0.28s ease-out',
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span aria-hidden>{fromId.icon}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--fg-strong)' }}>
          {fromId.short}
        </span>
        <span aria-hidden style={{ color: 'var(--fg-muted)' }}>
          →
        </span>
        <span aria-hidden>{toId.icon}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--fg-strong)' }}>
          {toId.short}
        </span>
        <span style={{ flex: 1 }} />
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            padding: '1px 6px',
            borderRadius: 999,
            background: `color-mix(in srgb, ${color} 16%, transparent)`,
            color,
          }}
        >
          {STATE_LABELS[entry.state] ?? entry.state}
        </span>
      </span>
      {entry.summary ? (
        <span
          style={{
            fontSize: 10.5,
            color: 'var(--fg-muted)',
            lineHeight: 1.45,
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
          }}
        >
          {entry.summary}
        </span>
      ) : null}
      <span style={{ fontSize: 9, color: 'var(--fg-muted)' }}>
        {new Date(entry.updatedAt).toLocaleTimeString('zh-CN')}
      </span>
    </button>
  );
}

function HandoffDetailHeader({ entry }: { entry: HandoffEntry }) {
  const fromId = getRoleLayerIdentity(entry.fromRoleLayer);
  const toId = getRoleLayerIdentity(entry.toRoleLayer);
  const color = STATE_COLOR[entry.state] ?? 'var(--fg-muted)';
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: '10px 14px',
        borderBottom: '1px solid color-mix(in srgb, var(--border-default) 40%, transparent)',
        background: `color-mix(in srgb, ${color} 6%, var(--bg-overlay))`,
        flexShrink: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--fg-strong)' }}>
          {fromId.icon} {fromId.label} → {toId.icon} {toId.label}
        </span>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            padding: '1px 8px',
            borderRadius: 999,
            background: `color-mix(in srgb, ${color} 16%, transparent)`,
            color,
          }}
        >
          {STATE_LABELS[entry.state] ?? entry.state}
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>
          {new Date(entry.updatedAt).toLocaleString('zh-CN')}
        </span>
      </div>
      {entry.summary ? (
        <p style={{ margin: 0, fontSize: 11.5, color: 'var(--fg-default)', lineHeight: 1.55 }}>
          {entry.summary}
        </p>
      ) : null}
    </div>
  );
}
