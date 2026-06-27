/**
 * TeamRunStateBanner · 团队会话整体运行状态横幅
 *
 * 常驻在接待对话顶部，把分散的运行信号聚合成一句「人话」状态，解决「提交需求后
 * 完全不知道是在跑、卡住了、还是异常停了」的可观测性缺口。
 *
 * 显示内容随 phase 变化：
 *   - working    : 🟢 团队运行中 · N 个活跃任务 · 正在 X 层 · 最后活动 Ns 前
 *   - failed     : 🔴 出现失败 · N 个任务失败，去任务/评审查看
 *   - completed  : ✅ 团队已完成本轮 · 共 N 个任务
 *   - disconnected: ⚠ 实时连接断开 · 状态可能不是最新
 *   - idle       : 不渲染（还没开始，交给空态卡片引导）
 */

import { useMemo, type CSSProperties, type ReactNode } from 'react';
import { useTeamRunState, type TeamRunPhase } from '../../runtime/hooks/use-team-run-state.js';
import type { TeamRuntimeDiagnostics } from '@openAwork/web-client';

export interface TeamRunStateBannerProps {
  diagnostics?: TeamRuntimeDiagnostics;
  receptionStateStatus?: 'idle' | 'running' | 'paused' | null;
  rightSlot?: ReactNode;
  sessionId?: string | null;
}

const LAYER_LABEL: Record<string, string> = {
  reception: '接待',
  pm1: '规划',
  pm2: '管控',
  executor: '执行',
  reviewer: '评审',
};

interface PhaseVisual {
  color: string;
  icon: string;
  title: string;
  spinning?: boolean;
}

function formatAgo(ms: number | null): string | null {
  if (ms === null) return null;
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}秒前`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}分钟前`;
  const hr = Math.floor(min / 60);
  return `${hr}小时前`;
}

const CONTAINER_BASE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexShrink: 0,
  padding: '5px 10px',
  borderBottom: '1px solid',
  fontSize: 12,
  fontWeight: 500,
};

const SPINNER_STYLE: CSSProperties = {
  width: 10,
  height: 10,
  borderRadius: '50%',
  border: '2px solid color-mix(in srgb, var(--accent) 30%, transparent)',
  borderTopColor: 'var(--accent)',
  animation: 'team-empty-spin 0.8s linear infinite',
  flexShrink: 0,
};

const DANGER = 'var(--danger, #e5484d)';

export function TeamRunStateBanner({
  diagnostics,
  receptionStateStatus,
  rightSlot,
  sessionId = null,
}: TeamRunStateBannerProps = {}) {
  const run = useTeamRunState({
    pendingPermissionCount: diagnostics?.pendingInteractions.pendingPermissionCount ?? 0,
    pendingQuestionCount: diagnostics?.pendingInteractions.pendingQuestionCount ?? 0,
    pendingSessionId: sessionId,
  });

  // reception 会话自身在跑（早期编排窗口），但还没有子 handoff → 也显示 working，
  // 避免「正在跑却显示 idle/不渲染」的空窗。
  const effectivePhase: TeamRunPhase =
    run.phase === 'idle' && receptionStateStatus === 'running' ? 'working' : run.phase;

  const visual = useMemo<PhaseVisual | null>(() => {
    const map: Record<Exclude<TeamRunPhase, 'idle'>, PhaseVisual> = {
      working: { color: 'var(--accent)', icon: '🟢', title: '团队运行中', spinning: true },
      failed: { color: DANGER, icon: '🔴', title: '出现失败' },
      completed: { color: 'var(--success)', icon: '✅', title: '团队已完成本轮' },
      disconnected: { color: 'var(--warning)', icon: '⚠', title: '实时连接断开' },
    };
    if (effectivePhase === 'idle') return null;
    return map[effectivePhase];
  }, [effectivePhase]);

  if (!visual) return null;

  const ago = formatAgo(run.lastActivityAgoMs);
  const layerName = run.activeLayer ? (LAYER_LABEL[run.activeLayer] ?? run.activeLayer) : null;
  const topAlert = diagnostics?.activeAlerts?.[0] ?? null;
  const latestIncident = diagnostics?.incidents?.[0] ?? null;
  const diagnosticsSummary = topAlert?.message?.trim() || latestIncident?.message?.trim() || null;

  let detail: string;
  switch (effectivePhase) {
    case 'working':
      detail = [
        run.activeCount > 0 ? `${run.activeCount} 个活跃任务` : '正在准备任务',
        layerName ? `正在「${layerName}」层` : null,
        ago ? `最后活动 ${ago}` : null,
        diagnosticsSummary ? `关注：${diagnosticsSummary}` : null,
      ]
        .filter(Boolean)
        .join(' · ');
      break;
    case 'failed':
      detail = `${run.failedCount} 个任务失败，请到「任务 / 评审」tab 查看详情并重试${
        diagnosticsSummary ? ` · 原因：${diagnosticsSummary}` : ''
      }`;
      break;
    case 'completed':
      detail = `共 ${run.completedCount}/${run.totalCount} 个任务完成${
        run.failedCount > 0 ? `，${run.failedCount} 个失败` : ''
      }${run.cancelledCount > 0 ? `，${run.cancelledCount} 个已取消` : ''}`;
      break;
    case 'disconnected':
      detail = `与团队的实时连接已断开，当前状态可能不是最新，正在尝试重连…${
        diagnosticsSummary ? ` · 最近异常：${diagnosticsSummary}` : ''
      }`;
      break;
    default:
      detail = '';
  }

  const containerStyle: CSSProperties = {
    ...CONTAINER_BASE,
    background: `color-mix(in srgb, ${visual.color} 8%, var(--bg-overlay))`,
    borderBottomColor: `color-mix(in srgb, ${visual.color} 30%, transparent)`,
  };

  return (
    <div style={containerStyle} role="status" aria-live="polite" aria-label="团队运行状态">
      {visual.spinning ? (
        <span style={SPINNER_STYLE} aria-hidden />
      ) : (
        <span aria-hidden style={{ fontSize: 12 }}>
          {visual.icon}
        </span>
      )}
      <strong style={{ color: visual.color, fontWeight: 700, flexShrink: 0, fontSize: 12 }}>
        {visual.title}
      </strong>
      <span
        style={{ color: 'var(--fg-muted)', minWidth: 0, lineHeight: 1.4, fontSize: 11, flex: 1 }}
      >
        {detail}
      </span>
      {rightSlot && <div style={{ flexShrink: 0, marginLeft: 'auto' }}>{rightSlot}</div>}
    </div>
  );
}
