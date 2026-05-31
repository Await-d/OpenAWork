/**
 * 260516-team-phase-d · T-11 · 失败重派/退回 c 状态流转
 *
 * 把后端 `runReviewAggregation.determineFailureDisposition` 的结果可视化：
 *   - redispatch     → 实现型失败，重新派发到 e/f/g
 *   - return-to-c    → 规划型失败，退回 c 层重写 spec/plan/tasks
 *   - escalate-to-user → 多轮重试仍失败，升级给用户决策
 *
 * Phase D-T11：除了「展示」，还提供三个用户主动动作：
 *   - 重派：把失败的 PM2 handoff 重新置回 pending，重新派发 d→e/f/g
 *   - 退回：基于原 reception→pm1 payload 重新创建一条 PM1 handoff
 *   - 升级：记录“用户接管”的显式确认
 */

import { useState, type CSSProperties } from 'react';
import { createTeamHandoffsClient, type HandoffReviewActionResult } from '@openAwork/web-client';
import { useAuthStore } from '../../../../../stores/auth/auth.js';

const INDICATOR_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  padding: '14px 16px',
  borderRadius: 12,
  border: '1px solid color-mix(in srgb, var(--border-default) 50%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 90%, var(--bg-base))',
};

const HEADER_ROW_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  flexWrap: 'wrap',
};

const REASON_STYLE: CSSProperties = {
  fontSize: 12,
  color: 'var(--fg-default)',
  lineHeight: 1.55,
  whiteSpace: 'pre-wrap',
};

const HINT_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '3px 8px',
  borderRadius: 6,
  fontSize: 11,
  fontWeight: 600,
};

const ACTIONS_ROW_STYLE: CSSProperties = {
  display: 'flex',
  gap: 8,
  flexWrap: 'wrap',
  paddingTop: 8,
  borderTop: '1px dashed color-mix(in srgb, var(--border-default) 45%, transparent)',
};

const PRIMARY_BTN_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '6px 12px',
  borderRadius: 6,
  border: 'none',
  background: 'var(--accent)',
  color: 'var(--bg-base)',
  fontSize: 11,
  fontWeight: 700,
  cursor: 'pointer',
};

const SECONDARY_BTN_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '6px 12px',
  borderRadius: 6,
  border: '1px solid color-mix(in srgb, var(--border-default) 50%, transparent)',
  background: 'transparent',
  color: 'var(--fg-default)',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
};

const DANGER_BTN_STYLE: CSSProperties = {
  ...SECONDARY_BTN_STYLE,
  borderColor: 'color-mix(in srgb, var(--danger) 36%, transparent)',
  color: 'var(--danger)',
};

export type FailureAction = 'redispatch' | 'return-to-c' | 'escalate-to-user';

const ACTION_META: Record<
  FailureAction,
  { icon: string; label: string; color: string; description: string }
> = {
  redispatch: {
    icon: '🔄',
    label: '重派给 executor / reviewer',
    color: 'var(--warning)',
    description: '实现型失败 → 重新派发到执行层（沿用现有 spec / plan / tasks）',
  },
  'return-to-c': {
    icon: '↩️',
    label: '退回 PM1 重新规划',
    color: 'var(--chart-5)',
    description: '规划型失败 → 退回 c 层重写 spec / plan / tasks',
  },
  'escalate-to-user': {
    icon: '⬆️',
    label: '已升级给你决策',
    color: 'var(--danger)',
    description: '多轮重试仍未通过 → 团队等待你介入（编辑宪法 / 修改原始需求 / 直接回答）',
  },
};

export interface FailureFlowIndicatorProps {
  action: FailureAction | null;
  reason: string | null;
  escalationRound: number;
  /** 当前 PM2 handoff id。 */
  pm2HandoffId?: string | null;
  /**
   * 当用户动作成功后回调。
   * 父组件可用返回的 handoff preview 先局部更新，再触发 refresh。
   */
  onActionComplete?: (result: HandoffReviewActionResult) => void;
}

export function FailureFlowIndicator({
  action,
  reason,
  escalationRound,
  pm2HandoffId,
  onActionComplete,
}: FailureFlowIndicatorProps) {
  const { gatewayUrl, accessToken } = useAuthStore();
  const [busyAction, setBusyAction] = useState<FailureAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  if (!action) return null;
  const meta = ACTION_META[action];
  const canActionate = Boolean(gatewayUrl && accessToken && pm2HandoffId) && busyAction === null;

  const runReviewAction = async (nextAction: FailureAction): Promise<void> => {
    if (!gatewayUrl || !accessToken || !pm2HandoffId) {
      setActionError('未登录或缺少 PM2 handoff，无法执行该评审动作。');
      return;
    }
    const client = createTeamHandoffsClient(gatewayUrl);
    setBusyAction(nextAction);
    setActionError(null);
    try {
      const result = await client.runReviewAction(accessToken, pm2HandoffId, nextAction);
      if (!result.ok) {
        setActionError(result.errorMessage ?? '评审动作执行失败。');
        return;
      }
      setActionError(null);
      onActionComplete?.(result);
    } catch (err) {
      console.error('[FailureFlowIndicator] review action failed', err);
      setActionError(err instanceof Error ? err.message : '评审动作执行失败。');
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div style={INDICATOR_STYLE}>
      <div style={HEADER_ROW_STYLE}>
        <span style={{ fontSize: 22 }} aria-hidden>
          {meta.icon}
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <strong style={{ fontSize: 13, color: meta.color, letterSpacing: '0.005em' }}>
            {meta.label}
          </strong>
          <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
            升级轮次 {escalationRound}
            {pm2HandoffId ? ` · #${pm2HandoffId.slice(0, 8)}` : ''}
          </span>
        </div>
        <span style={{ flex: 1 }} />
        <span
          style={{
            ...HINT_STYLE,
            background: `color-mix(in srgb, ${meta.color} 14%, transparent)`,
            color: meta.color,
          }}
        >
          {meta.description}
        </span>
      </div>

      {reason ? <span style={REASON_STYLE}>{reason}</span> : null}

      <div style={ACTIONS_ROW_STYLE}>
        <button
          type="button"
          onClick={() => void runReviewAction('redispatch')}
          disabled={!canActionate || action === 'escalate-to-user'}
          style={{
            ...(action === 'redispatch' ? PRIMARY_BTN_STYLE : SECONDARY_BTN_STYLE),
            opacity: canActionate ? 1 : 0.55,
            cursor: canActionate ? 'pointer' : 'not-allowed',
          }}
          title="把当前 plan / tasks 重新派发给 e/f/g 层"
        >
          {busyAction === 'redispatch' ? '重派中…' : '重派 e/f/g'}
        </button>
        <button
          type="button"
          onClick={() => void runReviewAction('return-to-c')}
          disabled={!canActionate || action === 'escalate-to-user'}
          style={{
            ...(action === 'return-to-c' ? PRIMARY_BTN_STYLE : SECONDARY_BTN_STYLE),
            opacity: canActionate ? 1 : 0.55,
            cursor: canActionate ? 'pointer' : 'not-allowed',
          }}
          title="退回 c 层（PM1）重新生成 spec / plan / tasks"
        >
          {busyAction === 'return-to-c' ? '退回中…' : '退回 PM1'}
        </button>
        <button
          type="button"
          onClick={() => void runReviewAction('escalate-to-user')}
          disabled={!canActionate}
          style={{
            ...DANGER_BTN_STYLE,
            opacity: canActionate ? 1 : 0.55,
            cursor: canActionate ? 'pointer' : 'not-allowed',
          }}
          title="标记为需要人工介入；可同时编辑宪法或原始需求"
        >
          {busyAction === 'escalate-to-user' ? '提交中…' : '我来处理'}
        </button>
      </div>
      {actionError ? (
        <span style={{ fontSize: 11, color: 'var(--danger)', lineHeight: 1.55 }}>
          {actionError}
        </span>
      ) : null}
    </div>
  );
}
