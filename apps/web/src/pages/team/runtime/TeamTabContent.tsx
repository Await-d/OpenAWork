/**
 * 260516-team-page-v2 · T-07
 *
 * 团队 Tab 内容：3D 全屏入口 + 角色状态 + Buddy 卡片 + 编制配置概览。
 */

import { useMemo, type CSSProperties } from 'react';
import { useHandoffStore, useLayerStore, type TeamRoleLayer } from '../../../stores/team-events.js';
import { BuddyCard } from './BuddyCard.js';

const SECTION_STYLE: CSSProperties = {
  display: 'grid',
  gap: 12,
};

const PANEL_STYLE: CSSProperties = {
  display: 'grid',
  gap: 8,
  padding: 12,
  borderRadius: 10,
  border: '1px solid color-mix(in srgb, var(--border) 60%, transparent)',
  background: 'color-mix(in srgb, var(--bg-2) 80%, var(--bg))',
  fontSize: 12,
};

const ROLE_LAYERS: TeamRoleLayer[] = ['reception', 'pm1', 'pm2', 'executor', 'reviewer'];

const LAYER_LABELS: Record<TeamRoleLayer, string> = {
  user: '用户',
  reception: '接待',
  pm1: '任务规划 PM1',
  pm2: '开发管控 PM2',
  executor: '执行',
  reviewer: '评审',
};

const STATE_INDICATOR_COLORS: Record<string, string> = {
  idle: 'var(--text-3)',
  pending: '#f59e0b',
  claimed: '#3b82f6',
  running: 'var(--success, #22c55e)',
  completed: 'var(--text-3)',
  failed: 'var(--danger, #d4574e)',
  cancelled: 'var(--text-3)',
};

export interface TeamTabContentProps {
  workspaceName?: string;
  onOpenFullscreen3D?: () => void;
}

const DASHBOARD_GRID_STYLE: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, 1fr)',
  gap: 8,
};

const METRIC_CARD_STYLE: CSSProperties = {
  display: 'grid',
  gap: 2,
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid color-mix(in srgb, var(--border) 50%, transparent)',
  background: 'color-mix(in srgb, var(--surface) 80%, var(--bg))',
};

function useOverviewMetrics() {
  const handoffs = useHandoffStore((s) => s.handoffs);

  return useMemo(() => {
    let running = 0;
    let completed = 0;
    let failed = 0;
    let totalDuration = 0;
    let durationCount = 0;

    for (const h of handoffs.values()) {
      if (h.state === 'running' || h.state === 'claimed' || h.state === 'pending') {
        running++;
      } else if (h.state === 'completed') {
        completed++;
        if (h.updatedAt) {
          totalDuration += h.updatedAt;
          durationCount++;
        }
      } else if (h.state === 'failed') {
        failed++;
      }
    }

    const avgDurationMs = durationCount > 0 ? totalDuration / durationCount : 0;
    const avgDurationMin = avgDurationMs > 0 ? Math.round(avgDurationMs / 60000) : 0;
    const total = completed + failed;
    const successRate = total > 0 ? Math.round((completed / total) * 100) : 0;

    return { running, completed, avgDurationMin, successRate };
  }, [handoffs]);
}

export function TeamTabContent({ workspaceName, onOpenFullscreen3D }: TeamTabContentProps) {
  const nodes = useLayerStore((s) => s.nodes);
  const metrics = useOverviewMetrics();

  const layerActivity = new Map<TeamRoleLayer, number>();
  for (const node of nodes.values()) {
    layerActivity.set(node.roleLayer, (layerActivity.get(node.roleLayer) ?? 0) + 1);
  }

  return (
    <div style={SECTION_STYLE}>
      <div style={DASHBOARD_GRID_STYLE}>
        <div style={METRIC_CARD_STYLE}>
          <span style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)' }}>
            {metrics.running}
          </span>
          <span style={{ fontSize: 10, color: 'var(--text-3)', fontWeight: 600 }}>活跃任务</span>
        </div>
        <div style={METRIC_CARD_STYLE}>
          <span style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)' }}>
            {metrics.completed}
          </span>
          <span style={{ fontSize: 10, color: 'var(--text-3)', fontWeight: 600 }}>已完成</span>
        </div>
        <div style={METRIC_CARD_STYLE}>
          <span style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)' }}>
            {metrics.avgDurationMin > 0 ? `${metrics.avgDurationMin}m` : '—'}
          </span>
          <span style={{ fontSize: 10, color: 'var(--text-3)', fontWeight: 600 }}>平均耗时</span>
        </div>
        <div style={METRIC_CARD_STYLE}>
          <span style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)' }}>
            {metrics.successRate}%
          </span>
          <span style={{ fontSize: 10, color: 'var(--text-3)', fontWeight: 600 }}>成功率</span>
        </div>
      </div>
      {workspaceName ? (
        <div style={PANEL_STYLE}>
          <span style={{ fontSize: 11, color: 'var(--text-3)' }}>当前工作区</span>
          <strong style={{ fontSize: 13 }}>{workspaceName}</strong>
        </div>
      ) : null}

      <BuddyCard />

      {/* 3D 全屏入口 */}
      {onOpenFullscreen3D ? (
        <button
          type="button"
          onClick={onOpenFullscreen3D}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            padding: '10px 12px',
            borderRadius: 10,
            border: '1px solid color-mix(in srgb, var(--accent) 40%, transparent)',
            background: 'color-mix(in srgb, var(--accent) 10%, var(--surface))',
            color: 'var(--text)',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          <span>⛶ 打开 3D 办公场景</span>
          <span style={{ fontSize: 11, color: 'var(--text-3)' }}>全屏</span>
        </button>
      ) : null}

      {/* 角色状态 */}
      <div style={SECTION_STYLE}>
        <span
          style={{
            fontSize: 11,
            color: 'var(--text-3)',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}
        >
          角色状态
        </span>
        {ROLE_LAYERS.map((layer) => {
          const count = layerActivity.get(layer) ?? 0;
          const stateColor =
            count > 0 ? STATE_INDICATOR_COLORS['running'] : STATE_INDICATOR_COLORS['idle'];
          return (
            <div
              key={layer}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                padding: '8px 10px',
                borderRadius: 8,
                background: 'color-mix(in srgb, var(--bg-2) 80%, var(--bg))',
                border: '1px solid color-mix(in srgb, var(--border) 50%, transparent)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    background: stateColor,
                  }}
                />
                <span style={{ fontSize: 12 }}>{LAYER_LABELS[layer]}</span>
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                {count > 0 ? `${count} 个活跃` : '待命'}
              </span>
            </div>
          );
        })}
      </div>

      {/* 编制配置概览 */}
      <div style={PANEL_STYLE}>
        <span style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase' }}>
          编制配置
        </span>
        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
          executor 最少 2 并行 / 上限 8（D46 动态编制）。详细配置在「设置」Tab 中。
        </span>
      </div>
    </div>
  );
}
