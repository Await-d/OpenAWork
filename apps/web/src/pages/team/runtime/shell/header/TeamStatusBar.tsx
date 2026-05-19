/**
 * 260515-team-phase-b · T-12 + 260516-team-page-v2 · T-04 / T-05
 *
 * TeamStatusBar：顶部固定运行状态栏。
 *
 * V2 升级（T-04 / T-05）：
 *   - 始终渲染（无 handoff 时最小化为单行提示）
 *   - 集成 LayerStatusIndicator（活跃层级 chip 列表）
 *   - 集成 TaskProgressBar（已完成 / 总数 进度条）
 *   - 集成 EstimatedTimeLabel（基于运行中任务的最早 startedAt 估算）
 */

import { useMemo, type CSSProperties } from 'react';
import { useHandoffStore, type TeamRoleLayer } from '../../../../../stores/team/team-events.js';

const BAR_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '4px 0',
  fontSize: 12,
  fontWeight: 600,
  flexWrap: 'nowrap',
  minWidth: 0,
  overflow: 'hidden',
};

const MINIMIZED_BAR_STYLE: CSSProperties = {
  ...BAR_STYLE,
  opacity: 0.6,
};

const LAYER_BADGE_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '2px 8px',
  borderRadius: 999,
  fontSize: 10,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};

const PROGRESS_TRACK_STYLE: CSSProperties = {
  position: 'relative',
  width: 100,
  height: 4,
  borderRadius: 999,
  background: 'color-mix(in srgb, var(--border) 40%, transparent)',
  overflow: 'hidden',
};

const PROGRESS_FILL_STYLE: CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  height: '100%',
  borderRadius: 999,
  background: 'var(--accent)',
  transition: 'width 300ms ease',
};

const ESTIMATE_LABEL_STYLE: CSSProperties = {
  fontSize: 11,
  color: 'var(--text-3)',
  fontWeight: 400,
  flexShrink: 0,
  whiteSpace: 'nowrap',
};

const LAYER_COLORS: Record<TeamRoleLayer, string> = {
  user: 'var(--text-3)',
  reception: 'var(--accent, var(--accent, #5cd4c0))',
  pm1: 'var(--chart-5, var(--chart-5, #c4b5fd))',
  pm2: 'var(--chart-5, var(--chart-5, #c4b5fd))',
  executor: 'var(--success, var(--success, #3dd49a))',
  reviewer: 'var(--warning, var(--warning, #f0b429))',
};

export interface TeamStatusBarProps {
  onPauseAll?: () => void;
  onResumeAll?: () => void;
  paused?: boolean;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return '<1s';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function formatEstimatedMinutes(ms: number | null): string {
  if (ms === null) return '计算中...';
  if (ms === 0) return '~0min';
  const minutes = Math.max(1, Math.ceil(ms / 60000));
  return `~${minutes}min`;
}

export function TeamStatusBar({ onPauseAll, onResumeAll, paused }: TeamStatusBarProps) {
  const handoffs = useHandoffStore((s) => s.handoffs);

  const stats = useMemo(() => {
    let pending = 0;
    let running = 0;
    let completed = 0;
    let failed = 0;
    let cancelled = 0;
    let earliestStart: number | null = null;
    const activeLayers = new Set<TeamRoleLayer>();

    for (const h of handoffs.values()) {
      if (h.state === 'pending') pending += 1;
      else if (h.state === 'running' || h.state === 'claimed') {
        running += 1;
        activeLayers.add(h.toRoleLayer);
        if (earliestStart === null || h.updatedAt < earliestStart) {
          earliestStart = h.updatedAt;
        }
      } else if (h.state === 'completed') completed += 1;
      else if (h.state === 'failed') failed += 1;
      else if (h.state === 'cancelled') cancelled += 1;
    }
    const total = pending + running + completed + failed + cancelled;
    const progress = total > 0 ? completed / total : 0;
    const elapsedMs = earliestStart ? Date.now() - earliestStart : null;
    const remaining = Math.max(total - completed, 0);
    const averageTaskMs = completed > 0 && elapsedMs !== null ? elapsedMs / completed : null;
    const estimatedRemainingMs =
      remaining === 0 ? 0 : averageTaskMs !== null ? remaining * averageTaskMs : null;

    return {
      pending,
      running,
      completed,
      failed,
      cancelled,
      total,
      progress,
      elapsedMs,
      estimatedRemainingMs,
      activeLayers: Array.from(activeLayers),
    };
  }, [handoffs]);

  // 无 handoff 时最小化展示
  if (handoffs.size === 0) {
    return (
      <div style={MINIMIZED_BAR_STYLE} role="status" aria-label="团队运行状态（待命中）">
        <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>● AI 团队待命中</span>
      </div>
    );
  }

  return (
    <div style={BAR_STYLE} role="status" aria-label="团队运行状态">
      {/* TaskProgressBar */}
      {stats.total > 0 ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <div style={PROGRESS_TRACK_STYLE} aria-label="任务进度">
            <div
              style={{
                ...PROGRESS_FILL_STYLE,
                width: `${stats.progress * 100}%`,
              }}
            />
          </div>
          <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
            {stats.completed}/{stats.total}
          </span>
        </div>
      ) : null}

      {/* 任务计数 */}
      {stats.running > 0 ? (
        <span style={{ color: 'var(--success, var(--success, var(--success, #3dd49a)))', flexShrink: 0, whiteSpace: 'nowrap' }}>
          ● {stats.running} 运行中
        </span>
      ) : null}
      {stats.pending > 0 ? (
        <span style={{ color: 'var(--text-3)', flexShrink: 0, whiteSpace: 'nowrap' }}>
          ◌ {stats.pending} 等待
        </span>
      ) : null}
      {stats.failed > 0 ? (
        <span style={{ color: 'var(--danger, #d4574e)', flexShrink: 0, whiteSpace: 'nowrap' }}>
          ✗ {stats.failed}
        </span>
      ) : null}

      {/* LayerStatusIndicator —— 可被压缩 */}
      {stats.activeLayers.length > 0 ? (
        <div
          style={{
            display: 'flex',
            gap: 4,
            minWidth: 0,
            overflow: 'hidden',
          }}
        >
          {stats.activeLayers.map((layer) => (
            <span
              key={layer}
              style={{
                ...LAYER_BADGE_STYLE,
                color: LAYER_COLORS[layer],
                border: `1px solid ${LAYER_COLORS[layer]}40`,
                background: `${LAYER_COLORS[layer]}10`,
              }}
            >
              {layer}
            </span>
          ))}
        </div>
      ) : null}

      {/* EstimatedTimeLabel */}
      <span style={ESTIMATE_LABEL_STYLE}>
        预计 {formatEstimatedMinutes(stats.estimatedRemainingMs)}
      </span>
      {stats.elapsedMs !== null ? (
        <span style={ESTIMATE_LABEL_STYLE}>已运行 {formatDuration(stats.elapsedMs)}</span>
      ) : null}

      {/* 暂停/恢复按钮 */}
      {onPauseAll && !paused ? (
        <button
          className="team-v2-control team-v2-control--transparent"
          type="button"
          onClick={onPauseAll}
          style={{
            marginLeft: 'auto',
            padding: '2px 10px',
            borderRadius: 6,
            border: '1px solid color-mix(in srgb, var(--border) 72%, transparent)',
            color: 'var(--text-2)',
            fontSize: 11,
            cursor: 'pointer',
            flexShrink: 0,
            whiteSpace: 'nowrap',
          }}
        >
          全部暂停
        </button>
      ) : null}
      {onResumeAll && paused ? (
        <button
          className="team-v2-control team-v2-control--transparent"
          type="button"
          onClick={onResumeAll}
          style={{
            marginLeft: 'auto',
            padding: '2px 10px',
            borderRadius: 6,
            border: '1px solid color-mix(in srgb, var(--success, var(--success, var(--success, #3dd49a))) 40%, transparent)',
            color: 'var(--success, var(--success, var(--success, #3dd49a)))',
            fontSize: 11,
            cursor: 'pointer',
            flexShrink: 0,
            whiteSpace: 'nowrap',
          }}
        >
          全部恢复
        </button>
      ) : null}
    </div>
  );
}
