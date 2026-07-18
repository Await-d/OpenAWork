/**
 * Team Inbound Messages 客户端（Phase 2b · L1.3 spec §1.3）
 *
 * 写入 `session_inbound_messages` 表的反向消息通道。
 * 后端端点由 L1.3 spec 改造 1 提供：`POST /team/sessions/:sessionId/inbound-messages`。
 *
 * **字段名约定**（L1.3 spec §0.A.5 命名对照）：
 * - 后端表中字段为 `to_session_id`（对应 spec §1.3.1）
 * - 客户端 URL 路径用 `:sessionId`（即 to_session_id）
 * - 请求体 `messageType`、`payload`、`clientIdempotencyKey`、`expiresAt`
 * - 响应体 `messageId`、`createdAt`
 *
 * **错误处理**：失败抛 `HttpError`（与其他 client 一致），保留后端 `error` 文案。
 */

import type { TeamReasoningEffort } from '@openAwork/shared';
import {
  fetchWithTimeout,
  extractJsonErrorMessage,
  HttpError,
  isGenericFetchErrorMessage,
  jsonAuthHeaders,
  readJsonErrorData,
  type JsonErrorData,
} from '../gateway/http.js';

// ─── L1.3 spec §1.3.2 载荷类型（前端 inbound-types.ts 同步）───────────────

export type InboundMessageType =
  | 'cancel_signal'
  | 'pause_signal'
  | 'resume_signal'
  | 'clarification_answer'
  | 'user_input'
  | 'escalation_request'
  | 'progress_report';

export interface ClarificationAnswerPayload {
  questionId: string;
  answer: string;
  answeredBy: 'user' | 'auto';
  answeredAt: number;
}

export interface UserInputPayload {
  text: string;
  intent?: 'add_requirement' | 'clarify_existing' | 'change_priority';
  attachments?: string[];
  providerId?: string;
  modelId?: string;
  thinkingEnabled?: boolean;
  reasoningEffort?: TeamReasoningEffort;
}

export interface CancelSignalPayload {
  reason: string;
  cascadeFrom: string;
  preserveArtifacts: boolean;
}

export interface PauseSignalPayload {
  reason?: string;
  pausedBy: string;
  pausedAt: number;
}

export interface EscalationRequestPayload {
  fromLayer: 'pm1' | 'pm2' | 'execution';
  fromSessionId: string;
  reason:
    | 'constitution_violation'
    | 'review_failed_threshold'
    | 'crash_recovery_failed'
    | 'needs_clarification';
  escalationRound: number;
  context: string;
  suggestedActions: Array<{
    label: string;
    action: 'edit_constitution' | 'edit_original_request' | 'answer';
  }>;
}

export interface ProgressReportPayload {
  fromSessionId: string;
  fromLayer: string;
  substate: string;
  completed?: number;
  total?: number;
  estimatedRemainingMs?: number;
}

export interface InboundPayloadByType {
  cancel_signal: CancelSignalPayload;
  pause_signal: PauseSignalPayload;
  resume_signal: PauseSignalPayload;
  clarification_answer: ClarificationAnswerPayload;
  user_input: UserInputPayload;
  escalation_request: EscalationRequestPayload;
  progress_report: ProgressReportPayload;
}

export interface InboundSubmitRequest<T extends InboundMessageType = InboundMessageType> {
  messageType: T;
  payload: InboundPayloadByType[T];
  clientIdempotencyKey?: string;
  expiresAt?: number;
}

export interface InboundSubmitResponse {
  messageId: string;
  createdAt: string;
}

// ─── Client ───────────────────────────────────────────────────────────────

export interface TeamInboundClient {
  /**
   * 提交 inbound message 到指定 target session。
   *
   * @param token 用户访问 token
   * @param sessionId 目标 session id（对应后端 `to_session_id`）
   * @param request 消息类型 + 载荷
   * @throws {HttpError} 当后端返回非 2xx 时抛出
   */
  submit<T extends InboundMessageType>(
    token: string,
    sessionId: string,
    request: InboundSubmitRequest<T>,
  ): Promise<InboundSubmitResponse>;
  dismissClarification(token: string, sessionId: string, questionId: string): Promise<{ ok: true }>;
}

function buildTeamInboundActionErrorMessage(
  actionLabel: string,
  status: number,
  data: JsonErrorData | undefined,
): string {
  const extracted = extractJsonErrorMessage(data);
  if (extracted) {
    return extracted;
  }
  if (status === 401 || status === 403) {
    return `认证失效或当前账号无权${actionLabel}。`;
  }
  if (status === 404) {
    return `目标团队会话不存在，无法${actionLabel}。`;
  }
  if (status === 409) {
    return `当前状态不允许${actionLabel}。`;
  }
  return `${actionLabel}失败（HTTP ${status}）。`;
}

function isGenericTeamInboundNetworkErrorMessage(message: string): boolean {
  return isGenericFetchErrorMessage(message);
}

function normalizeTeamInboundError(actionLabel: string, error: unknown): Error {
  if (error instanceof HttpError) {
    const extracted = extractJsonErrorMessage(
      (error.data ?? undefined) as JsonErrorData | undefined,
    );
    if (extracted) {
      return new HttpError(extracted, error.status, error.data);
    }
    return error;
  }
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message.length > 0 && !isGenericTeamInboundNetworkErrorMessage(message)) {
      return error;
    }
  }
  return new Error(`网络异常，${actionLabel}失败。`);
}

async function performTeamInboundRequest<T>(input: {
  actionLabel: string;
  request: () => Promise<Response>;
}): Promise<T> {
  try {
    const response = await input.request();
    if (!response.ok) {
      const data = await readJsonErrorData<JsonErrorData>(response);
      throw new HttpError(
        buildTeamInboundActionErrorMessage(input.actionLabel, response.status, data),
        response.status,
        data,
      );
    }
    return (await response.json()) as T;
  } catch (error) {
    throw normalizeTeamInboundError(input.actionLabel, error);
  }
}

export function createTeamInboundClient(baseUrl: string): TeamInboundClient {
  return {
    async submit(token, sessionId, request) {
      return performTeamInboundRequest<InboundSubmitResponse>({
        actionLabel: '提交团队反向消息',
        request: () =>
          fetchWithTimeout(
            `${baseUrl}/team/sessions/${encodeURIComponent(sessionId)}/inbound-messages`,
            {
              method: 'POST',
              headers: jsonAuthHeaders(token),
              body: JSON.stringify(request),
            },
          ),
      });
    },

    async dismissClarification(token, sessionId, questionId) {
      return performTeamInboundRequest<{ ok: true }>({
        actionLabel: '忽略澄清问题',
        request: () =>
          fetchWithTimeout(
            `${baseUrl}/team/sessions/${encodeURIComponent(sessionId)}/clarifications/${encodeURIComponent(questionId)}/dismiss`,
            {
              method: 'POST',
              headers: jsonAuthHeaders(token),
              body: JSON.stringify({ answeredAt: Date.now() }),
            },
          ),
      });
    },
  };
}
