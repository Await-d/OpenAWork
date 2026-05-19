/**
 * 260516-team-phase-d · T-11 · 失败重派/退回 c 状态流转
 *
 * 把后端 `runReviewAggregation.determineFailureDisposition` 的结果可视化：
 *   - redispatch     → 实现型失败，重新派发到 e/f/g
 *   - return-to-c    → 规划型失败，退回 c 层重写 spec/plan/tasks
 *   - escalate-to-user → 多轮重试仍失败，升级给用户决策
 *
 * Phase D-T11：除了「展示」，还提供三个用户主动动作：
 *   - 重派：通过 inbound 通道发 `progress_report` 触发 PM2 重新拆包派发
 *   - 退回：通过 inbound 通道发 `escalation_request`（reason=review_failed_threshold）
 *   - 升级：直接接受 disposition，把当前会话标为「需要人工介入」
 *
 * 三个动作均经由 createTeamInboundClient.submit 写入 PM2 的 inbound 通道，
 * 后端在下一次 poll 时消费，避免前端绕过 handoff 协议直接写 sessions。
 */

import { useState, type CSSProperties } from 'react';
import { createTeamInboundClient } from '@openAwork/web-client';
import { useAuthStore } from '../../../../../stores/auth.js';

const INDICATOR_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  padding: '14px 16px',
  borderRadius: 12,
  border: '1px solid color-mix(in srgb, var(--border) 50%, transparent)',
  background: 'color-mix(in srgb, var(--surface) 90%, var(--bg))',
};

const HEADER_ROW_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  flexWrap: 'wrap',
};

const REASON_STYLE: CSSProperties = {
  fontSize: 12,
  color: 'var(--text-2)',
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
  borderTop: '1px dashed color-mix(in srgb, var(--border) 45%, transparent)',
};

const PRIMARY_BTN_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '6px 12px',
  borderRadius: 6,
  border: 'none',
  background: 'var(--accent)',
  color: 'var(--bg)',
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
  border: '1px solid color-mix(in srgb, var(--border) 50%, transparent)',
  background: 'transparent',
  color: 'var(--text-2)',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
};

const DANGER_BTN_STYLE: CSSProperties = {
  ...SECONDARY_BTN_STYLE,
  borderColor: 'color-mix(in srgb, var(--danger, #d4574e) 36%, transparent)',
  color: 'var(--danger, #d4574e)',
};

export type FailureAction = 'redispatch' | 'return-to-c' | 'escalate-to-user';

const ACTION_META: Record<
  FailureAction,
  { icon: string; label: string; color: string; description: string }
> = {
  redispatch: {
    icon: '🔄',
    label: '重派给 executor / reviewer',
    color: 'var(--warning, var(--warning, #f0b429))',
    description: '实现型失败 → 重新派发到执行层（沿用现有 spec / plan / tasks）',
  },
  'return-to-c': {
    icon: '↩️',
    label: '退回 PM1 重新规划',
    color: 'var(--chart-5, var(--chart-5, #c4b5fd))',
    description: '规划型失败 → 退回 c 层重写 spec / plan / tasks',
  },
  'escalate-to-user': {
    icon: '⬆️',
    label: '已升级给你决策',
    color: 'var(--danger, #d4574e)',
    description: '多轮重试仍未通过 → 团队等待你介入（编辑宪法 / 修改原始需求 / 直接回答）',
  },
};

export interface FailureFlowIndicatorProps {
  action: FailureAction | null;
  reason: string | null;
  escalationRound: number;
  /** 当前 PM2 handoff id（用于 inbound 写回 target session）。 */
  pm2HandoffId?: string | null;
  /** 当前 PM2 from_session_id（inbound 通道发送目标 session）。可选；缺省时按钮 disabled。 */
  pm2SourceSessionId?: string | null;
  /**
   * 当用户动作完成后回调（成功时 success=true；失败时 success=false 并附 error）。
   * 父组件可用此触发 useSessionHandoffs.refresh()。
   */
  onActionComplete?: (action: FailureAction, success: boolean, error?: unknown) => void;
}

export function FailureFlowIndicator({
  action,
  reason,
  escalationRound,
  pm2HandoffId,
  pm2SourceSessionId,
  onActionComplete,
}: FailureFlowIndicatorProps) {
  const { gatewayUrl, accessToken } = useAuthStore();
  const [busyAction, setBusyAction] = useState<FailureAction | null>(null);

  if (!action) return null;
  const meta = ACTION_META[action];
  const canActionate =
    Boolean(gatewayUrl && accessToken && pm2SourceSessionId) && busyAction === null;

  const dispatchInbound = async (
    nextAction: FailureAction,
    overrideReason: string,
  ): Promise<void> => {
    if (!gatewayUrl || !accessToken || !pm2SourceSessionId) {
      console.warn('[FailureFlowIndicator] missing gateway/token/session');
      onActionComplete?.(nextAction, false, new Error('未登录或缺少 PM2 来源会话'));
      return;
    }
    const client = createTeamInboundClient(gatewayUrl);
    setBusyAction(nextAction);
    try {
      // 复用 escalation_request 通道把用户的"重派/退回/升级"决定写回 PM2
      await client.submit(accessToken, pm2SourceSessionId, {
        messageType: 'escalation_request',
        payload: {
          fromLayer: 'pm2',
          fromSessionId: pm2SourceSessionId,
          reason: 'review_failed_threshold',
          escalationRound,
          context: overrideReason,
          suggestedActions: [
            {
              label: ACTION_META[nextAction].label,
              action:
                nextAction === 'return-to-c'
                  ? 'edit_original_request'
                  : nextAction === 'escalate-to-user'
                    ? 'edit_constitution'
                    : 'answer',
            },
          ],
        },
      });
      onActionComplete?.(nextAction, true);
    } catch (err) {
      console.error('[FailureFlowIndicator] inbound submit failed', err);
      onActionComplete?.(nextAction, false, err);
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
          <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
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
          onClick={() => void dispatchInbound('redispatch', '用户确认实现型失败，重新派发')}
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
          onClick={() => void dispatchInbound('return-to-c', '用户确认规划型失败，退回 PM1')}
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
          onClick={() => void dispatchInbound('escalate-to-user', '用户主动确认升级')}
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
    </div>
  );
}
