/**
 * 260516-team-page-v2 · T-13 · LayeredConversationView（chat-conversation-reuse-plan 步骤 3 改造）
 *
 * TeamPageV2「层级对话」tab 的内嵌视图。
 *
 * **改造要点（v2）**：从原来的"单栏 handoff timeline"升级为双栏：
 *   - 左栏：handoff timeline（按层过滤，时间倒序）
 *   - 右栏：点击某条 handoff 后，把对应 to_session 用 `<TeamConversationView/>`
 *     渲染出来，实现"层级对话 = 真正能看到会话内容"的体感
 *
 * 兼容点：
 *   - 仍保留「在抽屉中打开」入口（`onSelectSessionDrawer`），不打断老用户习惯
 *   - timeline 行点击同时触发右栏 select：单击切换右栏会话；再次点击同条
 *     handoff 取消 select（回到欢迎面板）
 */

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  useHandoffStore,
  useLayerStore,
  type HandoffEntry,
  type TeamRoleLayer,
} from '../../../../../stores/team/team-events.js';
import { TeamConversationView } from '../../../conversation/TeamConversationView.js';
import { TabContainer } from '../TabContainer.js';

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
  gap: 14,
};

const HEADER_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '6px 10px',
  borderRadius: 10,
  border: '1px solid color-mix(in srgb, var(--border-default) 50%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 80%, var(--bg-base))',
  flexShrink: 0,
};

const TAB_BAR_STYLE: CSSProperties = {
  display: 'flex',
  gap: 4,
  flexWrap: 'wrap',
  flexShrink: 0,
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
  color: 'var(--fg-muted)',
};

const SPLIT_STYLE: CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'grid',
  gridTemplateColumns: 'minmax(280px, 360px) minmax(0, 1fr)',
  gap: 12,
};

const TIMELINE_PANEL_STYLE: CSSProperties = {
  minHeight: 0,
  overflow: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: 4,
  borderRight: '1px solid color-mix(in srgb, var(--border-default) 30%, transparent)',
  paddingRight: 12,
};

const SESSION_PANE_STYLE: CSSProperties = {
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  borderRadius: 12,
  border: '1px solid color-mix(in srgb, var(--border-default) 40%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 60%, var(--bg-base))',
  overflow: 'hidden',
};

const EMPTY_STYLE: CSSProperties = {
  flex: 1,
  display: 'grid',
  placeItems: 'center',
  padding: 24,
  borderRadius: 12,
  border: '1px dashed color-mix(in srgb, var(--border-default) 60%, transparent)',
  color: 'var(--fg-muted)',
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
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

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

  // 当前选中 session 切换 layer 后若不再可见，自动清空
  useEffect(() => {
    if (!selectedSessionId) return;
    const stillVisible = visibleHandoffs.some((entry) => entry.sessionId === selectedSessionId);
    if (!stillVisible) {
      setSelectedSessionId(null);
    }
  }, [visibleHandoffs, selectedSessionId]);

  const handleSelectHandoff = useCallback((entry: HandoffEntry) => {
    if (!entry.sessionId) return;
    const sessionId = entry.sessionId;
    setSelectedSessionId((prev) => (prev === sessionId ? null : sessionId));
  }, []);

  const totalNodes = nodes.size;
  const totalHandoffs = handoffs.size;

  if (totalNodes === 0 && totalHandoffs === 0) {
    return (
      <TabContainer
        title="层级对话"
        subtitle="按 reception → pm1 → pm2 → executor → reviewer 的层级展开 handoff。"
      >
        <div style={CONTAINER_STYLE}>
          <div style={EMPTY_STYLE}>
            <span style={{ fontSize: 26 }} aria-hidden>
              🪜
            </span>
            <strong style={{ color: 'var(--fg-default)' }}>暂无层级对话数据</strong>
            <span>当团队启动后，每层的会话和 handoff 会出现在这里。</span>
          </div>
        </div>
      </TabContainer>
    );
  }

  return (
    <TabContainer
      title="层级对话"
      subtitle="按 reception → pm1 → pm2 → executor → reviewer 的层级展开 handoff。"
    >
      <div style={CONTAINER_STYLE}>
        <div style={HEADER_STYLE}>
          <strong style={{ fontSize: 12, color: 'var(--fg-strong)' }}>层级对话</strong>
          <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
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
                border: '1px solid color-mix(in srgb, var(--border-default) 60%, transparent)',
                background: 'transparent',
                color: 'var(--fg-muted)',
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

        <div style={SPLIT_STYLE}>
          <div style={TIMELINE_PANEL_STYLE}>
            {visibleHandoffs.length === 0 ? (
              <div style={EMPTY_STYLE}>
                <span style={{ fontSize: 22 }} aria-hidden>
                  📭
                </span>
                <span>当前层级暂无 handoff。</span>
              </div>
            ) : (
              visibleHandoffs.map((entry) => (
                <HandoffRow
                  key={entry.id}
                  entry={entry}
                  selected={Boolean(entry.sessionId && selectedSessionId === entry.sessionId)}
                  onSelect={() => handleSelectHandoff(entry)}
                />
              ))
            )}
          </div>

          <div style={SESSION_PANE_STYLE}>
            {selectedSessionId ? (
              <TeamConversationView sessionId={selectedSessionId} />
            ) : (
              <div style={EMPTY_STYLE}>
                <span style={{ fontSize: 26 }} aria-hidden>
                  💬
                </span>
                <strong style={{ color: 'var(--fg-default)' }}>选择左侧 handoff 查看会话内容</strong>
                <span>右侧将以 chat 视图渲染对应 session 的执行流。</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </TabContainer>
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
          ? 'color-mix(in srgb, var(--accent) 14%, var(--bg-overlay))'
          : 'transparent',
        borderColor: active ? 'color-mix(in srgb, var(--accent) 40%, transparent)' : 'transparent',
        color: active ? 'var(--fg-strong)' : 'var(--fg-muted)',
      }}
    >
      {label}
    </button>
  );
}

function HandoffRow({
  entry,
  selected,
  onSelect,
}: {
  entry: HandoffEntry;
  selected: boolean;
  onSelect: () => void;
}) {
  const color = STATE_COLORS[entry.state] ?? 'var(--fg-muted)';
  const dateStr = new Date(entry.updatedAt).toLocaleTimeString();
  const clickable = Boolean(entry.sessionId);

  return (
    <button
      type="button"
      onClick={clickable ? onSelect : undefined}
      disabled={!clickable}
      aria-pressed={selected}
      title={clickable ? `查看会话 ${entry.sessionId}` : '该 handoff 暂无 session 关联'}
      style={{
        textAlign: 'left',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 12px',
        borderRadius: 10,
        border: selected
          ? '1px solid color-mix(in srgb, var(--accent) 60%, transparent)'
          : '1px solid color-mix(in srgb, var(--border-default) 45%, transparent)',
        background: selected
          ? 'color-mix(in srgb, var(--accent) 12%, var(--bg-overlay))'
          : 'color-mix(in srgb, var(--bg-overlay) 80%, var(--bg-base))',
        fontSize: 12,
        cursor: clickable ? 'pointer' : 'default',
        opacity: clickable ? 1 : 0.55,
        width: '100%',
        boxShadow: selected
          ? '0 0 0 2px color-mix(in srgb, var(--accent) 14%, transparent)'
          : 'none',
        transition: 'background 0.15s, border-color 0.15s, box-shadow 0.15s',
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
          color: 'var(--fg-default)',
          fontWeight: 600,
        }}
      >
        {LAYER_LABELS[entry.fromRoleLayer]} → {LAYER_LABELS[entry.toRoleLayer]}
      </span>
      <span
        style={{
          padding: '1px 8px',
          borderRadius: 999,
          background: 'color-mix(in srgb, var(--bg-overlay) 60%, transparent)',
          border: '1px solid color-mix(in srgb, var(--border-default) 50%, transparent)',
          color: 'var(--fg-default)',
          fontSize: 10,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          flexShrink: 0,
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
          color: 'var(--fg-muted)',
          fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace',
          fontSize: 10,
        }}
        title={entry.id}
      >
        {entry.sessionId ?? entry.id}
      </span>
      <span style={{ color: 'var(--fg-muted)', fontSize: 10, flexShrink: 0 }}>{dateStr}</span>
    </button>
  );
}
