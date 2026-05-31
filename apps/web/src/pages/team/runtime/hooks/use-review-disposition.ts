/**
 * 260517-team-phase-d · review 失败分流的真实数据派生
 *
 * 后端 `runReviewAggregation` 完成后会把 `failure_disposition` 写到 PM2
 * handoff 的 payload。前端不再 mock：
 *   - 从 useSessionHandoffs 拉到当前 session 的所有 handoff
 *   - 找出最新一条 from_role_layer === 'pm2' 且 state === 'completed' 或 'failed'
 *   - 解析其 payload.failure_disposition + payload.review_report
 *
 * 返回值含义：
 *   - action: 失败动作（redispatch / return-to-c / escalate-to-user），通过=null
 *   - reason: 后端附的人类可读理由
 *   - escalationRound: 当前是第几轮重试（>=2 自动升级）
 *   - canRedispatch / canReturnToC / canEscalate: UI 按钮可用性
 */

import { useMemo } from 'react';
import {
  getEffectiveReviewDisposition,
  isHandledReviewDispositionPayload,
  type HandoffRecord,
} from '@openAwork/web-client';
import { useSessionHandoffs } from './use-session-handoffs.js';

export type FailureAction = 'redispatch' | 'return-to-c' | 'escalate-to-user';

export interface ReviewDisposition {
  action: FailureAction | null;
  reason: string | null;
  escalationRound: number;
  /** 触发该 disposition 的 PM2 handoff id，用于「忽略」/「重派」时引用。 */
  pm2HandoffId: string | null;
  /** PM2 handoff 自身状态（用于 disabled 处理）。 */
  pm2HandoffState: HandoffRecord['state'] | null;
  /** 是否在轮询/加载。 */
  loading: boolean;
  /** 拉取错误。 */
  error: string | null;
}

function isEligiblePm2DispositionRecord(record: HandoffRecord): boolean {
  return (
    record.toRoleLayer === 'pm2' &&
    (record.state === 'completed' || record.state === 'failed') &&
    !isHandledReviewDispositionPayload(record.payload)
  );
}

function pickPm2Handoff(records: HandoffRecord[], focusHandoffId?: string | null): HandoffRecord | null {
  if (focusHandoffId) {
    const focused = records.find((record) => record.id === focusHandoffId);
    if (focused && isEligiblePm2DispositionRecord(focused)) {
      return focused;
    }
  }
  // 真正的 PM2 handoff 本体是 toRoleLayer='pm2'。
  // 这里只选终态，避免把仍在 dispatch / review 中的 handoff 当成失败分流来源。
  const candidates = records
    .filter(isEligiblePm2DispositionRecord)
    .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
  return candidates[0] ?? null;
}

export function useReviewDisposition(
  sessionId: string | null,
  focusHandoffId?: string | null,
): ReviewDisposition {
  const { handoffs, loading, error } = useSessionHandoffs(sessionId);

  return useMemo(() => {
    const pm2 = pickPm2Handoff(handoffs, focusHandoffId);
    if (!pm2) {
      return {
        action: null,
        reason: null,
        escalationRound: 0,
        pm2HandoffId: null,
        pm2HandoffState: null,
        loading,
        error,
      };
    }

    const escalationRound = pm2.retryCount;
    const effectiveDisposition = getEffectiveReviewDisposition(pm2);
    if (effectiveDisposition && effectiveDisposition.status !== 'handled') {
      return {
        action: effectiveDisposition.action,
        reason: effectiveDisposition.reason,
        escalationRound,
        pm2HandoffId: pm2.id,
        pm2HandoffState: pm2.state,
        loading,
        error,
      };
    }
    if (!effectiveDisposition || !effectiveDisposition.action) {
      return {
        action: null,
        reason: null,
        escalationRound,
        pm2HandoffId: pm2.id,
        pm2HandoffState: pm2.state,
        loading,
        error,
      };
    }

    return {
      action: effectiveDisposition.action,
      reason: effectiveDisposition.reason ?? null,
      escalationRound,
      pm2HandoffId: pm2.id,
      pm2HandoffState: pm2.state,
      loading,
      error,
    };
  }, [focusHandoffId, handoffs, loading, error]);
}
