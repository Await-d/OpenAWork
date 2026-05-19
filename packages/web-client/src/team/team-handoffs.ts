/**
 * 260517-team-page-v2 · Team Handoffs Web Client
 *
 * 封装 services/agent-gateway 暴露的 handoff 只读 + cancel 接口：
 *   GET  /team/handoffs/:handoffId
 *   GET  /team/sessions/:sessionId/handoffs
 *   POST /team/handoffs/:handoffId/cancel
 *
 * 设计原则：
 *   - 所有方法 token 必填，token 缺失视作未登录直接返回 null/false
 *   - 网络错误一律收敛为 null（业务 UI 自行兜底，不抛异常打断渲染）
 *   - HandoffRecord 字段与 gateway HandoffStore 完全一致，避免前后端 drift
 */

import { jsonAuthHeaders } from '../gateway/http.js';

export type HandoffRoleLayer =
  | 'user'
  | 'reception'
  | 'pm1'
  | 'pm2'
  | 'executor'
  | 'tester'
  | 'reviewer';

export type HandoffState = 'pending' | 'claimed' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface HandoffRecord {
  id: string;
  userId: string;
  fromSessionId: string;
  fromRoleLayer: HandoffRoleLayer;
  toRoleLayer: HandoffRoleLayer;
  toSessionId: string | null;
  payload: unknown;
  state: HandoffState;
  claimToken: string | null;
  claimedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  failureReason: string | null;
  retryCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface HandoffCancelResult {
  ok: boolean;
  /** 当 ok=false 时，返回 gateway 报告的当前状态（如已是终态）。 */
  state?: HandoffState;
}

export interface TeamHandoffsClient {
  /** 拉单条 handoff。404 / 401 / 网络错误一律返回 null。 */
  getHandoff(token: string | null, handoffId: string): Promise<HandoffRecord | null>;

  /** 拉某个 session 的全部 handoff（fromSessionId 与 toSessionId 都会包含）。 */
  listHandoffsBySession(token: string | null, sessionId: string): Promise<HandoffRecord[]>;

  /**
   * 主动取消处于 pending/claimed/running 的 handoff。
   *
   * @returns ok=true 表示后端已转入 cancelled；
   *          ok=false 时附带当前 state（通常是已完成/已失败这类终态）。
   */
  cancelHandoff(token: string | null, handoffId: string): Promise<HandoffCancelResult>;
}

export function createTeamHandoffsClient(baseUrl: string): TeamHandoffsClient {
  const trimmed = baseUrl.replace(/\/$/, '');

  return {
    async getHandoff(token, handoffId) {
      if (!token) return null;
      try {
        const response = await fetch(`${trimmed}/team/handoffs/${encodeURIComponent(handoffId)}`, {
          headers: jsonAuthHeaders(token),
        });
        if (!response.ok) return null;
        const data = (await response.json()) as { handoff?: HandoffRecord };
        return data.handoff ?? null;
      } catch {
        return null;
      }
    },

    async listHandoffsBySession(token, sessionId) {
      if (!token) return [];
      try {
        const response = await fetch(
          `${trimmed}/team/sessions/${encodeURIComponent(sessionId)}/handoffs`,
          { headers: jsonAuthHeaders(token) },
        );
        if (!response.ok) return [];
        const data = (await response.json()) as { handoffs?: HandoffRecord[] };
        return data.handoffs ?? [];
      } catch {
        return [];
      }
    },

    async cancelHandoff(token, handoffId) {
      if (!token) return { ok: false };
      try {
        const response = await fetch(
          `${trimmed}/team/handoffs/${encodeURIComponent(handoffId)}/cancel`,
          {
            method: 'POST',
            headers: jsonAuthHeaders(token),
          },
        );
        if (response.ok) return { ok: true };
        if (response.status === 409) {
          // gateway 返回当前 state 作为不能取消的原因
          try {
            const data = (await response.json()) as { state?: HandoffState };
            return { ok: false, state: data.state };
          } catch {
            return { ok: false };
          }
        }
        return { ok: false };
      } catch {
        return { ok: false };
      }
    },
  };
}
