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
import type { HandoffRecord } from '@openAwork/web-client';
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

interface DispositionPayload {
  failure_disposition?: {
    action?: FailureAction;
    reason?: string;
  };
  escalation_round?: number;
}

function isPayloadObject(value: unknown): value is DispositionPayload {
  return typeof value === 'object' && value !== null;
}

function pickLatestPm2Handoff(records: HandoffRecord[]): HandoffRecord | null {
  // 选 from_role_layer = 'pm2' 的最近 handoff（无论成功或失败），
  // 用 updatedAt 比较；同时要求 state ∈ {completed, failed} 才有 disposition 信息。
  const candidates = records
    .filter((record) => record.fromRoleLayer === 'pm2')
    .filter((record) => record.state === 'completed' || record.state === 'failed')
    .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
  return candidates[0] ?? null;
}

export function useReviewDisposition(sessionId: string | null): ReviewDisposition {
  const { handoffs, loading, error } = useSessionHandoffs(sessionId);

  return useMemo(() => {
    const pm2 = pickLatestPm2Handoff(handoffs);
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

    const payload = pm2.payload;
    const failureDisposition = isPayloadObject(payload)
      ? (payload.failure_disposition ?? null)
      : null;
    const escalationRound = isPayloadObject(payload)
      ? typeof payload.escalation_round === 'number'
        ? payload.escalation_round
        : pm2.retryCount
      : pm2.retryCount;

    if (!failureDisposition || !failureDisposition.action) {
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
      action: failureDisposition.action,
      reason: failureDisposition.reason ?? null,
      escalationRound,
      pm2HandoffId: pm2.id,
      pm2HandoffState: pm2.state,
      loading,
      error,
    };
  }, [handoffs, loading, error]);
}
