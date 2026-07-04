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

import type { CSSProperties, ReactNode } from 'react';
import { computeSubstateProgress, selectSubstateMeta } from '../../runtime/data/substates.js';
import { getRoleLayerIdentity } from '../../runtime/data/role-layer-identity.js';

export interface TeamSubstateProgressBarProps {
  roleLayer?: string | null;
  substate?: string | null;
  stateStatus?: 'idle' | 'running' | 'paused' | null;
  className?: string;
  rightSlot?: ReactNode;
}

const CONTAINER_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '6px 12px',
  borderBottom: '1px solid var(--border-default)',
  background: 'var(--bg-overlay)',
  fontSize: 11,
  flexShrink: 0,
};

const PROGRESS_TRACK_STYLE: CSSProperties = {
  flex: 1,
  height: 3,
  borderRadius: 999,
  background: 'color-mix(in srgb, var(--border-default) 40%, transparent)',
  overflow: 'hidden',
  minWidth: 40,
};

const STATE_LABEL_STYLE: CSSProperties = {
  color: 'var(--fg-muted)',
  flexShrink: 0,
  fontVariantNumeric: 'tabular-nums',
  fontSize: 10,
};

function progressFillStyle(
  percent: number,
  status: 'running' | 'paused' | 'idle',
  layerColor?: string,
): CSSProperties {
  const accentColor =
    status === 'paused'
      ? 'color-mix(in srgb, var(--warning) 60%, var(--bg-overlay))'
      : status === 'running'
        ? (layerColor ?? 'var(--accent)')
        : 'color-mix(in srgb, var(--fg-muted) 30%, var(--bg-overlay))';
  return {
    width: `${percent}%`,
    height: '100%',
    background: accentColor,
    transition: 'width 200ms ease',
  };
}

function roleLayerBadgeText(roleLayer: string): string {
  const id = getRoleLayerIdentity(roleLayer);
  return id.code ? `${id.code} · ${id.short}` : id.short;
}

function roleLayerBadgeStyle(roleLayer: string): CSSProperties {
  const id = getRoleLayerIdentity(roleLayer);
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 3,
    padding: '2px 6px',
    borderRadius: 4,
    background: `color-mix(in srgb, ${id.color} 10%, transparent)`,
    color: id.color,
    fontSize: 10,
    fontWeight: 700,
    flexShrink: 0,
  };
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
  rightSlot,
}: TeamSubstateProgressBarProps) {
  if (!roleLayer) return null;

  const meta = selectSubstateMeta(roleLayer);
  const layerBadge = roleLayerBadgeText(roleLayer);
  const badgeStyle = roleLayerBadgeStyle(roleLayer);
  const layerIdentity = getRoleLayerIdentity(roleLayer);

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
        <span style={badgeStyle}>{layerBadge}</span>
        <div style={PROGRESS_TRACK_STYLE} role="progressbar" aria-valuenow={percent}>
          <div style={progressFillStyle(percent, fillStatus, layerIdentity.color)} />
        </div>
        <span style={STATE_LABEL_STYLE}>
          {label} · {percent}%
        </span>
        {rightSlot && <div style={{ flexShrink: 0, marginLeft: 'auto' }}>{rightSlot}</div>}
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
        <span style={badgeStyle}>{layerBadge}</span>
        <div
          style={PROGRESS_TRACK_STYLE}
          role="progressbar"
          aria-valuenow={fallbackPercent}
          aria-label="状态指示"
        >
          <div style={progressFillStyle(fallbackPercent, stateStatus, layerIdentity.color)} />
        </div>
        <span style={STATE_LABEL_STYLE}>{fallbackLabel}</span>
        {rightSlot && <div style={{ flexShrink: 0, marginLeft: 'auto' }}>{rightSlot}</div>}
      </div>
    );
  }

  // 分支 3：什么都没有，渲染最简徽章
  return (
    <div className={className} style={CONTAINER_STYLE}>
      <span style={badgeStyle}>{layerBadge}</span>
      <span style={STATE_LABEL_STYLE}>—</span>
      {rightSlot && <div style={{ flexShrink: 0, marginLeft: 'auto' }}>{rightSlot}</div>}
    </div>
  );
}
