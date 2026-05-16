/**
 * 260516-team-phase-d · T-11
 *
 * 失败重派/退回 c 的状态流转展示。
 */

import { type CSSProperties } from 'react';

const INDICATOR_STYLE: CSSProperties = {
  display: 'grid',
  gap: 8,
  padding: 12,
  borderRadius: 10,
  border: '1px solid color-mix(in srgb, var(--border) 72%, transparent)',
  background: 'color-mix(in srgb, var(--surface) 82%, var(--bg))',
};

export type FailureAction = 'redispatch' | 'return-to-c' | 'escalate-to-user';

const ACTION_META: Record<FailureAction, { icon: string; label: string; color: string }> = {
  redispatch: {
    icon: '🔄',
    label: '重派给 executor/reviewer',
    color: '#f59e0b',
  },
  'return-to-c': {
    icon: '↩️',
    label: '退回 PM1 重新规划',
    color: '#8b5cf6',
  },
  'escalate-to-user': {
    icon: '⬆️',
    label: '升级给用户',
    color: 'var(--danger, #d4574e)',
  },
};

export interface FailureFlowIndicatorProps {
  action: FailureAction | null;
  reason: string | null;
  escalationRound: number;
}

export function FailureFlowIndicator({
  action,
  reason,
  escalationRound,
}: FailureFlowIndicatorProps) {
  if (!action) return null;

  const meta = ACTION_META[action];

  return (
    <div style={INDICATOR_STYLE}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 18 }}>{meta.icon}</span>
        <div style={{ display: 'grid', gap: 2 }}>
          <strong style={{ fontSize: 12, color: meta.color }}>{meta.label}</strong>
          <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
            escalation round: {escalationRound}
          </span>
        </div>
      </div>
      {reason ? <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{reason}</span> : null}
      <div
        style={{
          display: 'flex',
          gap: 4,
          padding: '4px 8px',
          borderRadius: 6,
          background: `${meta.color}10`,
          border: `1px solid ${meta.color}30`,
          fontSize: 10,
          color: meta.color,
        }}
      >
        {action === 'redispatch' && '实现型失败 → 重新派发给执行层'}
        {action === 'return-to-c' && '规划型失败 → 退回 c 层重新生成 spec/plan/tasks'}
        {action === 'escalate-to-user' && '多轮重试仍失败 → 需要用户介入决策'}
      </div>
    </div>
  );
}
