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
 * **错误处理**：失败抛 `HttpError`（与其他 client 一致）。
 */

import { HttpError, jsonAuthHeaders, expectJson } from '../gateway/http.js';

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
}

export function createTeamInboundClient(baseUrl: string): TeamInboundClient {
  return {
    async submit(token, sessionId, request) {
      const response = await fetch(
        `${baseUrl}/team/sessions/${encodeURIComponent(sessionId)}/inbound-messages`,
        {
          method: 'POST',
          headers: jsonAuthHeaders(token),
          body: JSON.stringify(request),
        },
      );
      if (!response.ok) {
        throw new HttpError(
          `Failed to submit inbound message: ${response.status}`,
          response.status,
        );
      }
      return expectJson<InboundSubmitResponse>(response, 'submitInbound');
    },
  };
}
