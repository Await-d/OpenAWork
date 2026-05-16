/**
 * 260516-team-page-v2 · T-13 · LayeredConversationView
 *
 * 把原 `LayerConversationDrawer` 的内容抽出，作为 TeamPageV2「层级对话」
 * tab 的内嵌视图。
 *
 * 与 Drawer 版本的差异：
 *   - 不再固定在底部、不带折叠开关；直接铺满 tab 内容区
 *   - 保留按 layer 分组的 tab 切换
 *   - 支持点击「在抽屉中打开」回到 Drawer 行为，让用户可以在浏览
 *     其他 tab 时仍能看到当前 layer 对话
 */

import { useMemo, useState, type CSSProperties } from 'react';
import {
  useHandoffStore,
  useLayerStore,
  type HandoffEntry,
  type TeamRoleLayer,
} from '../../../stores/team-events.js';

const LAYER_LABELS: Record<TeamRoleLayer, string> = {
  user: '用户',
  reception: '接待',
  pm1: 'PM1 · 规划',
  pm2: 'PM2 · 管控',
  executor: '执行',
  reviewer: '评审',
};

const LAYER_ORDER: TeamRoleLayer[] = ['user', 'reception', 'pm1', 'pm2', 'executor', 'reviewer'];

const STATE_COLORS: Record<string, string> = {
  idle: 'var(--text-3)',
  pending: '#f59e0b',
  claimed: '#3b82f6',
  running: 'var(--success, #22c55e)',
  completed: 'var(--text-3)',
  failed: 'var(--danger, #d4574e)',
  cancelled: 'var(--text-3)',
};

const CONTAINER_STYLE: CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  padding: 12,
};

const HEADER_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '6px 10px',
  borderRadius: 10,
  border: '1px solid color-mix(in srgb, var(--border) 50%, transparent)',
  background: 'color-mix(in srgb, var(--surface) 80%, var(--bg))',
};

const TAB_BAR_STYLE: CSSProperties = {
  display: 'flex',
  gap: 4,
  flexWrap: 'wrap',
};

const TAB_BTN_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '4px 10px',
  borderRadius: 6,
  border: '1px solid transparent',
  background: 'transparent',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  color: 'var(--text-3)',
};

const HANDOFF_TIMELINE_STYLE: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflow: 'auto',
  display: 'grid',
  gap: 8,
  padding: 4,
};

const EMPTY_STYLE: CSSProperties = {
  flex: 1,
  display: 'grid',
  placeItems: 'center',
  padding: 24,
  borderRadius: 12,
  border: '1px dashed color-mix(in srgb, var(--border) 60%, transparent)',
  color: 'var(--text-3)',
  fontSize: 12,
  textAlign: 'center',
  gap: 6,
};

export interface LayeredConversationViewProps {
  /** 用户希望以 Drawer 形式打开（保留全屏抽屉的兼容入口）。 */
  onSelectSessionDrawer?: () => void;
}

export function LayeredConversationView({ onSelectSessionDrawer }: LayeredConversationViewProps) {
  const nodes = useLayerStore((s) => s.nodes);
  const handoffs = useHandoffStore((s) => s.handoffs);
  const [activeLayer, setActiveLayer] = useState<TeamRoleLayer | 'all'>('all');

  // 按 layer 分组节点
  const nodesByLayer = useMemo(() => {
    const map = new Map<TeamRoleLayer, string[]>();
    for (const node of nodes.values()) {
      const list = map.get(node.roleLayer) ?? [];
      list.push(node.sessionId);
      map.set(node.roleLayer, list);
    }
    return map;
  }, [nodes]);

  // 收集相关 handoffs（按时间倒序）
  const visibleHandoffs = useMemo(() => {
    const list: HandoffEntry[] = [];
    for (const entry of handoffs.values()) {
      if (
        activeLayer === 'all' ||
        entry.fromRoleLayer === activeLayer ||
        entry.toRoleLayer === activeLayer
      ) {
        list.push(entry);
      }
    }
    list.sort((a, b) => b.updatedAt - a.updatedAt);
    return list;
  }, [activeLayer, handoffs]);

  const totalNodes = nodes.size;
  const totalHandoffs = handoffs.size;

  if (totalNodes === 0 && totalHandoffs === 0) {
    return (
      <div style={CONTAINER_STYLE}>
        <div style={EMPTY_STYLE}>
          <span style={{ fontSize: 26 }} aria-hidden>
            🪜
          </span>
          <strong style={{ color: 'var(--text-2)' }}>暂无层级对话数据</strong>
          <span>当团队启动后，每层的会话和 handoff 会出现在这里。</span>
        </div>
      </div>
    );
  }

  return (
    <div style={CONTAINER_STYLE}>
      <div style={HEADER_STYLE}>
        <strong style={{ fontSize: 12, color: 'var(--text)' }}>层级对话</strong>
        <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
          {totalNodes} 个 session · {totalHandoffs} 个 handoff
        </span>
        <div style={{ flex: 1 }} />
        {onSelectSessionDrawer ? (
          <button
            type="button"
            onClick={onSelectSessionDrawer}
            style={{
              padding: '4px 10px',
              borderRadius: 6,
              border: '1px solid color-mix(in srgb, var(--border) 60%, transparent)',
              background: 'transparent',
              color: 'var(--text-3)',
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            在抽屉中打开
          </button>
        ) : null}
      </div>

      <div style={TAB_BAR_STYLE} role="tablist" aria-label="层级筛选">
        <LayerTabBtn
          label={`全部 · ${totalHandoffs}`}
          active={activeLayer === 'all'}
          onClick={() => setActiveLayer('all')}
        />
        {LAYER_ORDER.map((layer) => {
          const count = nodesByLayer.get(layer)?.length ?? 0;
          if (count === 0 && layer !== 'user') return null;
          return (
            <LayerTabBtn
              key={layer}
              label={`${LAYER_LABELS[layer]} · ${count}`}
              active={activeLayer === layer}
              onClick={() => setActiveLayer(layer)}
            />
          );
        })}
      </div>

      <div style={HANDOFF_TIMELINE_STYLE}>
        {visibleHandoffs.length === 0 ? (
          <div style={EMPTY_STYLE}>
            <span style={{ fontSize: 22 }} aria-hidden>
              📭
            </span>
            <span>当前层级暂无 handoff。</span>
          </div>
        ) : (
          visibleHandoffs.map((entry) => <HandoffRow key={entry.id} entry={entry} />)
        )}
      </div>
    </div>
  );
}

function LayerTabBtn({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        ...TAB_BTN_STYLE,
        background: active
          ? 'color-mix(in srgb, var(--accent) 14%, var(--surface))'
          : 'transparent',
        borderColor: active ? 'color-mix(in srgb, var(--accent) 40%, transparent)' : 'transparent',
        color: active ? 'var(--text)' : 'var(--text-3)',
      }}
    >
      {label}
    </button>
  );
}

function HandoffRow({ entry }: { entry: HandoffEntry }) {
  const color = STATE_COLORS[entry.state] ?? 'var(--text-3)';
  const dateStr = new Date(entry.updatedAt).toLocaleTimeString();

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 12px',
        borderRadius: 10,
        border: '1px solid color-mix(in srgb, var(--border) 45%, transparent)',
        background: 'color-mix(in srgb, var(--surface) 80%, var(--bg))',
        fontSize: 12,
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: 999,
          background: color,
          boxShadow:
            entry.state === 'running'
              ? `0 0 0 3px color-mix(in srgb, ${color} 30%, transparent)`
              : 'none',
          flexShrink: 0,
        }}
      />
      <span
        style={{
          minWidth: 110,
          color: 'var(--text-2)',
          fontWeight: 600,
        }}
      >
        {LAYER_LABELS[entry.fromRoleLayer]} → {LAYER_LABELS[entry.toRoleLayer]}
      </span>
      <span
        style={{
          padding: '1px 8px',
          borderRadius: 999,
          background: 'color-mix(in srgb, var(--surface) 60%, transparent)',
          border: '1px solid color-mix(in srgb, var(--border) 50%, transparent)',
          color: 'var(--text-2)',
          fontSize: 10,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}
      >
        {entry.state}
      </span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          color: 'var(--text-3)',
          fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace',
          fontSize: 10,
        }}
        title={entry.id}
      >
        {entry.id}
      </span>
      <span style={{ color: 'var(--text-3)', fontSize: 10, flexShrink: 0 }}>{dateStr}</span>
    </div>
  );
}
