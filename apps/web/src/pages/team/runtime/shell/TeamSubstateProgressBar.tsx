/**
 * TeamSubstateProgressBar · Phase 2c 前端组件
 *
 * 在 SessionConversationView 的 topBar slot 中显示 c/d/e 层的子状态机进度。
 *
 * **数据源**：
 * - 当前阶段（v0.1）：`sessions.role_layer`（Phase B 已落地）+ `sessions.state_status`（已落地）
 * - 后续阶段（v1.0，等 L1.3 改造 2 落地后）：`sessions.substate` + `session.substate-changed` 事件
 *
 * **当前回退行为**：substate 字段缺失时，仅根据 state_status 显示一个最简状态徽章
 * （running / paused / idle）。等 L1.3 改造 2 落地后，订阅 substate 变化即可
 * 自动切换到完整子状态机进度展示。
 *
 * 关联文档：
 * - `docs/team-architecture-l1-3-streaming-handoff-spec.md` §1.2
 * - `docs/chat-conversation-reuse-plan.md` Phase 2c
 */

import type { CSSProperties } from 'react';
import { computeSubstateProgress, selectSubstateMeta } from '../data/substates.js';

export interface TeamSubstateProgressBarProps {
  /** session 的 role_layer（来自 sessions 表）。null 时不渲染。 */
  roleLayer?: string | null;
  /**
   * session 的 substate 字段（来自 L1.3 改造 2，当前未落地）。
   * 为 null/undefined 时回退到 state_status 显示。
   */
  substate?: string | null;
  /** session 的 state_status（fallback 数据源）。 */
  stateStatus?: 'idle' | 'running' | 'paused' | null;
  /** 自定义 className（可选）。 */
  className?: string;
}

const CONTAINER_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '5px 12px',
  borderBottom: '1px solid color-mix(in srgb, var(--border) 40%, transparent)',
  background: 'color-mix(in srgb, var(--surface) 60%, var(--bg))',
  fontSize: 12,
  flexShrink: 0,
};

const LAYER_BADGE_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '2px 8px',
  borderRadius: 999,
  border: '1px solid color-mix(in srgb, var(--accent) 40%, transparent)',
  background: 'color-mix(in srgb, var(--accent) 10%, var(--surface))',
  color: 'var(--text)',
  fontSize: 11,
  fontWeight: 700,
  flexShrink: 0,
};

const PROGRESS_TRACK_STYLE: CSSProperties = {
  flex: 1,
  height: 4,
  borderRadius: 999,
  background: 'color-mix(in srgb, var(--border) 50%, transparent)',
  overflow: 'hidden',
  minWidth: 60,
};

const STATE_LABEL_STYLE: CSSProperties = {
  color: 'var(--text-2)',
  flexShrink: 0,
  fontVariantNumeric: 'tabular-nums',
};

function progressFillStyle(percent: number, status: 'running' | 'paused' | 'idle'): CSSProperties {
  const accentColor =
    status === 'paused'
      ? 'color-mix(in srgb, var(--warning, #f59e0b) 60%, var(--surface))'
      : status === 'running'
        ? 'var(--accent)'
        : 'color-mix(in srgb, var(--text-3) 30%, var(--surface))';
  return {
    width: `${percent}%`,
    height: '100%',
    background: accentColor,
    transition: 'width 200ms ease',
  };
}

function roleLayerBadgeText(roleLayer: string): string {
  switch (roleLayer) {
    case 'reception':
      return 'b · 接待';
    case 'pm1':
      return 'c · 任务规划';
    case 'pm2':
      return 'd · 开发管控';
    case 'executor':
      return 'e · 执行';
    case 'reviewer':
      return 'g · 评审';
    default:
      return roleLayer;
  }
}

/**
 * 进度条主组件。
 *
 * 三种渲染分支：
 * 1. 有 substate（L1.3 改造 2 落地后）→ 显示完整子状态机进度
 * 2. 无 substate 但有 stateStatus → 显示 fallback（状态徽章 + 进度 0/50/100）
 * 3. 都没有 → 渲染 null
 */
export function TeamSubstateProgressBar({
  roleLayer,
  substate,
  stateStatus,
  className,
}: TeamSubstateProgressBarProps) {
  if (!roleLayer) return null;

  const meta = selectSubstateMeta(roleLayer);
  const layerBadge = roleLayerBadgeText(roleLayer);

  // 分支 1：有 substate（L1.3 改造 2 落地后会走这里）
  if (substate && meta) {
    const percent = computeSubstateProgress(meta.order, substate);
    const label = meta.label[substate] ?? substate;
    const fillStatus =
      substate === 'failed' || substate === 'cancelled'
        ? 'idle'
        : stateStatus === 'paused'
          ? 'paused'
          : 'running';
    return (
      <div className={className} style={CONTAINER_STYLE} aria-label="会话进度">
        <span style={LAYER_BADGE_STYLE}>{layerBadge}</span>
        <div style={PROGRESS_TRACK_STYLE} role="progressbar" aria-valuenow={percent}>
          <div style={progressFillStyle(percent, fillStatus)} />
        </div>
        <span style={STATE_LABEL_STYLE}>
          {label} · {percent}%
        </span>
      </div>
    );
  }

  // 分支 2：fallback 到 stateStatus
  if (stateStatus) {
    const fallbackPercent = stateStatus === 'paused' ? 50 : stateStatus === 'running' ? 70 : 0;
    const fallbackLabel =
      stateStatus === 'running' ? '运行中' : stateStatus === 'paused' ? '已暂停' : '空闲';
    return (
      <div className={className} style={CONTAINER_STYLE} aria-label="会话状态">
        <span style={LAYER_BADGE_STYLE}>{layerBadge}</span>
        <div
          style={PROGRESS_TRACK_STYLE}
          role="progressbar"
          aria-valuenow={fallbackPercent}
          aria-label="状态指示"
        >
          <div style={progressFillStyle(fallbackPercent, stateStatus)} />
        </div>
        <span style={STATE_LABEL_STYLE}>{fallbackLabel}</span>
      </div>
    );
  }

  // 分支 3：什么都没有，渲染最简徽章
  return (
    <div className={className} style={CONTAINER_STYLE}>
      <span style={LAYER_BADGE_STYLE}>{layerBadge}</span>
      <span style={STATE_LABEL_STYLE}>—</span>
    </div>
  );
}
