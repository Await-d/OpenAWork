/**
 * TeamRunStatePill · 团队整体运行状态的紧凑胶囊
 *
 * 复用 useTeamRunState 的聚合结果，渲染成一个小胶囊（圆点/spinner + 文案），
 * 用于「顶部 tab 栏」等空间受限处，让用户在任意 tab 都能一眼看到团队是在跑 /
 * 失败 / 完成 / 断连。与接待对话顶部的完整横幅（TeamRunStateBanner）共用
 * 同一份运行态来源，保证全局一致。
 *
 * idle（从未开始）时不渲染，避免噪音。
 */

import type { CSSProperties } from 'react';
import { useTeamRunState, type TeamRunPhase } from '../hooks/use-team-run-state.js';

const DANGER = 'var(--danger, #e5484d)';

interface PhaseVisual {
  color: string;
  icon: string;
  label: string;
  spinning?: boolean;
}

const PHASE_VISUAL: Record<Exclude<TeamRunPhase, 'idle'>, PhaseVisual> = {
  working: { color: 'var(--accent)', icon: '🟢', label: '运行中', spinning: true },
  failed: { color: DANGER, icon: '🔴', label: '出现失败' },
  completed: { color: 'var(--success)', icon: '✅', label: '已完成' },
  disconnected: { color: 'var(--warning)', icon: '⚠', label: '连接断开' },
};

const PILL_BASE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  padding: '3px 10px',
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 700,
  whiteSpace: 'nowrap',
  flexShrink: 0,
};

const SPINNER_STYLE: CSSProperties = {
  width: 9,
  height: 9,
  borderRadius: '50%',
  border: '2px solid color-mix(in srgb, var(--accent) 30%, transparent)',
  borderTopColor: 'var(--accent)',
  animation: 'team-empty-spin 0.8s linear infinite',
  flexShrink: 0,
};

export interface TeamRunStatePillProps {
  /** 紧凑模式：仅显示圆点 + 计数，不显示文字标签（更省空间）。 */
  compact?: boolean;
  style?: CSSProperties;
}

export function TeamRunStatePill({ compact = false, style }: TeamRunStatePillProps) {
  const run = useTeamRunState();
  if (run.phase === 'idle') return null;

  const visual = PHASE_VISUAL[run.phase];
  const count =
    run.phase === 'working' ? run.activeCount : run.phase === 'failed'
        ? run.failedCount
        : 0;

  const title = `团队状态：${visual.label}${count > 0 ? ` · ${count}` : ''}`;

  return (
    <span
      role="status"
      aria-label={title}
      title={title}
      style={{
        ...PILL_BASE,
        background: `color-mix(in srgb, ${visual.color} 12%, transparent)`,
        color: visual.color,
        border: `1px solid color-mix(in srgb, ${visual.color} 32%, transparent)`,
        ...style,
      }}
    >
      {visual.spinning ? (
        <span style={SPINNER_STYLE} aria-hidden />
      ) : (
        <span aria-hidden style={{ fontSize: 10 }}>
          {visual.icon}
        </span>
      )}
      {!compact ? <span>{visual.label}</span> : null}
      {count > 0 ? <span style={{ fontVariantNumeric: 'tabular-nums' }}>{count}</span> : null}
    </span>
  );
}
