/**
 * 260516-team-page-v2 · T-11
 *
 * BuddyCard：3D 折叠后的浮动状态卡。
 *
 * 显示当前活跃 agent / 待审批 / 待回答数量，作为 3D 动画的轻量替代。
 */

import { type CSSProperties } from 'react';
import { useHandoffStore, useLayerStore } from '../../../../stores/team/team-events.js';

const CARD_STYLE: CSSProperties = {
  display: 'grid',
  gap: 8,
  padding: 12,
  borderRadius: 12,
  border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
  background: 'color-mix(in srgb, var(--accent) 6%, var(--bg-overlay))',
  fontSize: 12,
};

const STAT_ROW_STYLE: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, 1fr)',
  gap: 6,
};

const STAT_CELL_STYLE: CSSProperties = {
  display: 'grid',
  gap: 2,
  padding: '6px 10px',
  borderRadius: 8,
  background: 'color-mix(in srgb, var(--bg-overlay) 80%, var(--bg-base))',
  border: '1px solid color-mix(in srgb, var(--border-default) 50%, transparent)',
};

export function BuddyCard() {
  const handoffs = useHandoffStore((s) => s.handoffs);
  const nodes = useLayerStore((s) => s.nodes);

  const activeAgents = nodes.size;
  const runningTasks = Array.from(handoffs.values()).filter(
    (h) => h.state === 'running' || h.state === 'claimed',
  ).length;
  const failedTasks = Array.from(handoffs.values()).filter((h) => h.state === 'failed').length;

  return (
    <div style={CARD_STYLE} aria-label="团队 Buddy 卡片">
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <strong style={{ fontSize: 13, color: 'var(--fg-strong)' }}>Buddy</strong>
        <span style={{ fontSize: 10, color: 'var(--fg-muted)', textTransform: 'uppercase' }}>
          团队助理
        </span>
      </header>

      <div style={STAT_ROW_STYLE}>
        <div style={STAT_CELL_STYLE}>
          <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>活跃 Agent</span>
          <strong style={{ fontSize: 16 }}>{activeAgents}</strong>
        </div>
        <div style={STAT_CELL_STYLE}>
          <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>运行中</span>
          <strong style={{ fontSize: 16, color: 'var(--success))' }}>{runningTasks}</strong>
        </div>
      </div>

      {failedTasks > 0 ? (
        <div
          style={{
            ...STAT_CELL_STYLE,
            border: '1px solid color-mix(in srgb, var(--danger) 40%, transparent)',
            background: 'color-mix(in srgb, var(--danger) 8%, var(--bg-overlay))',
          }}
        >
          <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>需要关注</span>
          <strong style={{ fontSize: 14, color: 'var(--danger))' }}>
            {failedTasks} 个任务失败
          </strong>
        </div>
      ) : null}
    </div>
  );
}
