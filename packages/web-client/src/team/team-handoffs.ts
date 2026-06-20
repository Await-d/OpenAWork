/**
 * 260517-team-page-v2 · Team Handoffs Web Client
 *
 * 封装 services/agent-gateway 暴露的 handoff 只读 + 控制接口：
 *   GET  /team/handoffs/:handoffId
 *   GET  /team/sessions/:sessionId/handoffs
 *   POST /team/handoffs/:handoffId/cancel
 *   POST /team/handoffs/:handoffId/pause
 *   POST /team/handoffs/:handoffId/resume
 *
 * 设计原则：
 *   - 所有方法 token 必填，token 缺失视作未登录直接返回 null/false
 *   - 网络错误一律收敛为 null（业务 UI 自行兜底，不抛异常打断渲染）
 *   - HandoffRecord 字段与 gateway HandoffStore 完全一致，避免前后端 drift
 */

import {
  authHeader,
  fetchWithTimeout,
  extractJsonErrorMessage,
  isGenericFetchErrorMessage,
  jsonAuthHeaders,
  readJsonErrorData,
  type JsonErrorData,
} from '../gateway/http.js';

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
  resultJson?: unknown;
  state: HandoffState;
  claimToken: string | null;
  claimedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  failureReason: string | null;
  retryCount: number;
  idempotencyKey?: string | null;
  paused?: boolean;
  pausedAt?: string | null;
  pausedByUserId?: string | null;
  pauseReason?: string | null;
  recoverableFailure?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface HandoffControlResult {
  ok: boolean;
  errorMessage?: string;
  handoff?: HandoffRecord | null;
  paused?: boolean;
  retryable: boolean;
  status?: number;
  state?: HandoffState;
}

export type HandoffCancelResult = HandoffControlResult;
export type HandoffPauseResult = HandoffControlResult;
export type HandoffResumeResult = HandoffControlResult;

export type HandoffReviewAction = 'redispatch' | 'return-to-c' | 'escalate-to-user';
export type HandoffReviewDispositionStatus = 'handled' | 'pending';

export interface HandoffReviewDisposition {
  action: HandoffReviewAction;
  reason: string;
  source: 'structured' | 'failure-reason';
  status: HandoffReviewDispositionStatus;
  updatedAtMs: number;
}

export interface HandoffReviewActionResult {
  action: HandoffReviewAction;
  createdHandoffId?: string;
  errorMessage?: string;
  handoffs: HandoffRecord[];
  handoffId: string;
  ok: boolean;
  retryable: boolean;
  status?: number;
}

export interface TeamHandoffListBySessionResult {
  handoffs: HandoffRecord[];
  ok: boolean;
  retryable: boolean;
  errorMessage?: string;
  status?: number;
}

export interface TeamHandoffsClient {
  /** 拉单条 handoff。404 / 401 / 网络错误一律返回 null。 */
  getHandoff(token: string | null, handoffId: string): Promise<HandoffRecord | null>;

  /** 拉某个 session 的全部 handoff（fromSessionId 与 toSessionId 都会包含）。 */
  listHandoffsBySession(token: string | null, sessionId: string): Promise<HandoffRecord[]>;
  listHandoffsBySessionResult(
    token: string | null,
    sessionId: string,
  ): Promise<TeamHandoffListBySessionResult>;

  /**
   * 主动取消处于 pending/claimed/running 的 handoff。
   *
   * @returns ok=true 表示后端已转入 cancelled；
   *          ok=false 时附带当前 state（通常是已完成/已失败这类终态）。
   */
  cancelHandoff(token: string | null, handoffId: string): Promise<HandoffCancelResult>;
  pauseHandoff(
    token: string | null,
    handoffId: string,
    input?: { reason?: string },
  ): Promise<HandoffPauseResult>;
  resumeHandoff(token: string | null, handoffId: string): Promise<HandoffResumeResult>;
  runReviewAction(
    token: string | null,
    handoffId: string,
    action: HandoffReviewAction,
  ): Promise<HandoffReviewActionResult>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isHandledReviewDispositionPayload(payload: unknown): boolean {
  const structured = getStructuredReviewDisposition(payload);
  if (structured?.status === 'handled') {
    return true;
  }
  if (!isRecord(payload)) {
    return false;
  }
  return (
    typeof payload['reviewDispositionHandledAt'] === 'number' ||
    typeof payload['reviewDispositionHandledAt'] === 'string'
  );
}

export function getStructuredReviewDisposition(payload: unknown): HandoffReviewDisposition | null {
  if (!isRecord(payload)) {
    return null;
  }
  const raw = payload['reviewDisposition'];
  if (!isRecord(raw)) {
    return null;
  }
  if (
    (raw['action'] === 'redispatch' ||
      raw['action'] === 'return-to-c' ||
      raw['action'] === 'escalate-to-user') &&
    typeof raw['reason'] === 'string' &&
    (raw['status'] === 'pending' || raw['status'] === 'handled') &&
    typeof raw['updatedAtMs'] === 'number'
  ) {
    return {
      action: raw['action'],
      reason: raw['reason'],
      source: 'structured',
      status: raw['status'],
      updatedAtMs: raw['updatedAtMs'],
    };
  }
  return null;
}

export function inferReviewDispositionFromFailureReason(
  failureReason: string | null | undefined,
): HandoffReviewDisposition | null {
  if (!failureReason) {
    return null;
  }

  // 规划型失败 → 退回 PM1 重新生成 spec/plan/tasks
  const returnToCPrefixes = [
    'Spec Review 未通过',
    'Planning Contract 未通过',
    'Constitution Check 硬门禁未通过',
    'Architecture Review 未通过',
  ];
  if (returnToCPrefixes.some((prefix) => failureReason.startsWith(prefix))) {
    return {
      action: 'return-to-c',
      reason: failureReason,
      source: 'failure-reason',
      status: 'pending',
      updatedAtMs: 0,
    };
  }

  if (failureReason.includes('需要用户介入')) {
    return {
      action: 'escalate-to-user',
      reason: failureReason,
      source: 'failure-reason',
      status: 'pending',
      updatedAtMs: 0,
    };
  }
  if (
    failureReason.startsWith('quality-review-degraded-summary-failed:') ||
    failureReason.startsWith('Quality Review 未通过')
  ) {
    return {
      action: 'redispatch',
      reason: failureReason,
      source: 'failure-reason',
      status: 'pending',
      updatedAtMs: 0,
    };
  }
  return null;
}

export function getEffectiveReviewDisposition(
  record: Pick<HandoffRecord, 'failureReason' | 'payload'>,
): HandoffReviewDisposition | null {
  return (
    getStructuredReviewDisposition(record.payload) ??
    inferReviewDispositionFromFailureReason(record.failureReason)
  );
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function isRetryableHandoffControlStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function isRetryableReviewActionStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function isGenericTeamHandoffsNetworkErrorMessage(message: string): boolean {
  return isGenericFetchErrorMessage(message);
}

function normalizeTeamHandoffsNetworkMessage(actionLabel: string, error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message.length > 0 && !isGenericTeamHandoffsNetworkErrorMessage(message)) {
      return message;
    }
  }
  return `网络异常，${actionLabel}失败。`;
}

function buildListBySessionHttpErrorMessage(
  status: number,
  data: JsonErrorData | undefined,
): string {
  const extracted = extractJsonErrorMessage(data);
  if (extracted) {
    return extracted;
  }
  if (status === 401 || status === 403) {
    return '认证失效或无权读取该会话的 handoff 列表。';
  }
  if (status === 404) {
    return '目标会话不存在，无法读取 handoff 列表。';
  }
  return `加载 handoff 列表失败（HTTP ${status}）。`;
}

function buildReviewActionHttpErrorMessage(input: {
  action: HandoffReviewAction;
  data: JsonErrorData | undefined;
  status: number;
}): string {
  const routeCode = typeof input.data?.code === 'string' ? input.data.code : null;
  const legacyError = typeof input.data?.error === 'string' ? input.data.error : null;
  if (routeCode === 'team_handoff_cannot_redispatch' || legacyError === 'cannot-redispatch') {
    return '当前 handoff 无法重派，可能已被其他流程接管。';
  }
  if (routeCode === 'team_handoff_cannot_return_to_pm1' || legacyError === 'cannot-return-to-c') {
    return '当前 handoff 无法退回 PM1，可能缺少可回放的上游规划。';
  }
  if (
    routeCode === 'team_handoff_review_requires_pm2' ||
    legacyError === 'Review action only supports pm2 handoff'
  ) {
    return '只有 PM2 handoff 支持该评审动作。';
  }
  if (routeCode === 'team_handoff_not_found' || legacyError === 'Handoff not found') {
    return '目标 handoff 不存在。';
  }
  const extracted = extractJsonErrorMessage(input.data);
  if (extracted) {
    return extracted;
  }
  if (input.status === 401 || input.status === 403) {
    return '认证失效或当前账号无权执行该评审动作。';
  }
  if (input.status === 404) {
    return '目标 handoff 不存在。';
  }
  return `执行评审动作失败（HTTP ${input.status}）。`;
}

function buildHandoffControlHttpErrorMessage(input: {
  actionLabel: string;
  data: JsonErrorData | undefined;
  status: number;
}): string {
  const routeCode = typeof input.data?.code === 'string' ? input.data.code : null;
  const legacyError = typeof input.data?.error === 'string' ? input.data.error : null;

  if (routeCode === 'team_handoff_not_found' || legacyError === 'Handoff not found') {
    return '目标 handoff 不存在。';
  }
  if (routeCode === 'team_handoff_cannot_cancel' || legacyError === 'cannot-cancel') {
    return '当前状态不允许取消该 handoff。';
  }
  if (routeCode === 'team_handoff_cannot_pause' || legacyError === 'cannot-pause') {
    return '当前状态不允许暂停该 handoff。';
  }
  if (routeCode === 'team_handoff_cannot_resume' || legacyError === 'cannot-resume') {
    return '当前状态不允许恢复该 handoff。';
  }
  const extracted = extractJsonErrorMessage(input.data);
  if (extracted) {
    return extracted;
  }
  if (input.status === 401 || input.status === 403) {
    return `认证失效或当前账号无权${input.actionLabel}。`;
  }
  if (input.status === 404) {
    return `目标 handoff 不存在，无法${input.actionLabel}。`;
  }
  if (input.status === 409) {
    return `当前状态不允许${input.actionLabel}。`;
  }
  return `${input.actionLabel}失败（HTTP ${input.status}）。`;
}

export function createTeamHandoffsClient(baseUrl: string): TeamHandoffsClient {
  const trimmed = baseUrl.replace(/\/$/, '');
  const listHandoffsBySessionResult = async (
    token: string | null,
    sessionId: string,
  ): Promise<TeamHandoffListBySessionResult> => {
    if (!token) {
      return {
        handoffs: [],
        ok: false,
        retryable: false,
        errorMessage: '未登录，无法读取 handoff 列表。',
      };
    }
    try {
      const response = await fetchWithTimeout(
        `${trimmed}/team/sessions/${encodeURIComponent(sessionId)}/handoffs`,
        { headers: authHeader(token) },
      );
      if (!response.ok) {
        const data = await readJsonErrorData<JsonErrorData>(response);
        return {
          handoffs: [],
          ok: false,
          retryable: isRetryableStatus(response.status),
          errorMessage: buildListBySessionHttpErrorMessage(response.status, data),
          status: response.status,
        };
      }
      const data = (await response.json()) as { handoffs?: HandoffRecord[] };
      return {
        handoffs: data.handoffs ?? [],
        ok: true,
        retryable: false,
      };
    } catch (error) {
      return {
        handoffs: [],
        ok: false,
        retryable: true,
        errorMessage: normalizeTeamHandoffsNetworkMessage('读取 handoff 列表', error),
      };
    }
  };

  return {
    async getHandoff(token, handoffId) {
      if (!token) return null;
      try {
        const response = await fetchWithTimeout(
          `${trimmed}/team/handoffs/${encodeURIComponent(handoffId)}`,
          {
            headers: authHeader(token),
          },
        );
        if (!response.ok) return null;
        const data = (await response.json()) as { handoff?: HandoffRecord };
        return data.handoff ?? null;
      } catch {
        return null;
      }
    },

    async listHandoffsBySession(token, sessionId) {
      const result = await listHandoffsBySessionResult(token, sessionId);
      return result.handoffs;
    },

    listHandoffsBySessionResult,

    async cancelHandoff(token, handoffId) {
      if (!token) {
        return {
          ok: false,
          retryable: false,
          errorMessage: '未登录，无法取消该 handoff。',
        };
      }
      try {
        const response = await fetchWithTimeout(
          `${trimmed}/team/handoffs/${encodeURIComponent(handoffId)}/cancel`,
          {
            method: 'POST',
            headers: authHeader(token),
          },
        );
        const data = await readJsonErrorData<
          JsonErrorData & {
            handoff?: HandoffRecord;
            paused?: boolean;
            state?: HandoffState;
          }
        >(response);
        if (response.ok) {
          return {
            ok: true,
            handoff: data?.handoff ?? null,
            retryable: false,
          };
        }
        return {
          ok: false,
          retryable: isRetryableHandoffControlStatus(response.status),
          errorMessage: buildHandoffControlHttpErrorMessage({
            actionLabel: '取消派发任务',
            data,
            status: response.status,
          }),
          status: response.status,
          state: data?.state,
          paused: data?.paused,
        };
      } catch (error) {
        return {
          ok: false,
          retryable: true,
          errorMessage: normalizeTeamHandoffsNetworkMessage('取消派发任务', error),
        };
      }
    },

    async pauseHandoff(token, handoffId, input) {
      if (!token) {
        return {
          ok: false,
          retryable: false,
          errorMessage: '未登录，无法暂停该 handoff。',
        };
      }
      try {
        const response = await fetchWithTimeout(
          `${trimmed}/team/handoffs/${encodeURIComponent(handoffId)}/pause`,
          {
            method: 'POST',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify(input ?? {}),
          },
        );
        const data = await readJsonErrorData<
          JsonErrorData & {
            handoff?: HandoffRecord;
            paused?: boolean;
            state?: HandoffState;
          }
        >(response);
        if (response.ok) {
          return {
            ok: true,
            handoff: data?.handoff ?? null,
            retryable: false,
          };
        }
        return {
          ok: false,
          retryable: isRetryableHandoffControlStatus(response.status),
          errorMessage: buildHandoffControlHttpErrorMessage({
            actionLabel: '暂停派发任务',
            data,
            status: response.status,
          }),
          status: response.status,
          state: data?.state,
          paused: data?.paused,
        };
      } catch (error) {
        return {
          ok: false,
          retryable: true,
          errorMessage: normalizeTeamHandoffsNetworkMessage('暂停派发任务', error),
        };
      }
    },

    async resumeHandoff(token, handoffId) {
      if (!token) {
        return {
          ok: false,
          retryable: false,
          errorMessage: '未登录，无法恢复该 handoff。',
        };
      }
      try {
        const response = await fetchWithTimeout(
          `${trimmed}/team/handoffs/${encodeURIComponent(handoffId)}/resume`,
          {
            method: 'POST',
            headers: authHeader(token),
          },
        );
        const data = await readJsonErrorData<
          JsonErrorData & {
            handoff?: HandoffRecord;
            paused?: boolean;
            state?: HandoffState;
          }
        >(response);
        if (response.ok) {
          return {
            ok: true,
            handoff: data?.handoff ?? null,
            retryable: false,
          };
        }
        return {
          ok: false,
          retryable: isRetryableHandoffControlStatus(response.status),
          errorMessage: buildHandoffControlHttpErrorMessage({
            actionLabel: '恢复派发任务',
            data,
            status: response.status,
          }),
          status: response.status,
          state: data?.state,
          paused: data?.paused,
        };
      } catch (error) {
        return {
          ok: false,
          retryable: true,
          errorMessage: normalizeTeamHandoffsNetworkMessage('恢复派发任务', error),
        };
      }
    },

    async runReviewAction(token, handoffId, action) {
      if (!token) {
        return {
          action,
          handoffId,
          handoffs: [],
          ok: false,
          retryable: false,
          errorMessage: '未登录，无法执行该评审动作。',
        };
      }
      try {
        const response = await fetchWithTimeout(
          `${trimmed}/team/handoffs/${encodeURIComponent(handoffId)}/review-actions/${encodeURIComponent(action)}`,
          {
            method: 'POST',
            headers: authHeader(token),
          },
        );
        if (!response.ok) {
          const data = await readJsonErrorData<JsonErrorData>(response);
          return {
            action,
            handoffId,
            handoffs: [],
            ok: false,
            retryable: isRetryableReviewActionStatus(response.status),
            errorMessage: buildReviewActionHttpErrorMessage({
              action,
              data,
              status: response.status,
            }),
            status: response.status,
          };
        }
        const data = (await response.json()) as {
          action: HandoffReviewAction;
          createdHandoffId?: string;
          handoffs?: HandoffRecord[];
          handoffId: string;
        };
        return {
          action: data.action,
          createdHandoffId: data.createdHandoffId,
          handoffs: data.handoffs ?? [],
          handoffId: data.handoffId,
          ok: true,
          retryable: false,
        };
      } catch (error) {
        return {
          action,
          handoffId,
          handoffs: [],
          ok: false,
          retryable: true,
          errorMessage: normalizeTeamHandoffsNetworkMessage('执行评审动作', error),
        };
      }
    },
  };
}
