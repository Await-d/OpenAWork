/**
 * Inbound Message 类型定义（L1.3 spec §1.3.2 同步）
 *
 * 来源：`docs/team-architecture-l1-3-streaming-handoff-spec.md` §1.3.2
 *
 * 这些类型由 L1.3 spec 规约，前端写入 `POST /team/sessions/:sessionId/inbound-messages`，
 * 后端 layer runner 在 LLM 循环里消费。本文件作为前后端共同遵守的载荷契约。
 *
 * **当前阶段（Phase 2b 前端契约先行）**：本文件定义类型，但实际写入端点
 * 由后端 L1.3 spec 改造 1 提供。后端落地前，前端调用会得到 404；后端落地后
 * 前端无需改动即可使用。
 */

/** 用户对 c session 中 [NEEDS CLARIFICATION] 标记的回答。 */
export interface ClarificationAnswerPayload {
  /** 对应 c session 推送时携带的 questionId（来自 escalation_request）。 */
  questionId: string;
  answer: string;
  answeredBy: 'user' | 'auto';
  answeredAt: number;
}

/** 用户中途追加的输入。 */
export interface UserInputPayload {
  text: string;
  intent?: 'add_requirement' | 'clarify_existing' | 'change_priority';
  /** 引用的 artifact id 列表（可选）。 */
  attachments?: string[];
}

/** 取消信号（cascade 到子 session）。 */
export interface CancelSignalPayload {
  reason: string;
  /** 触发 cancel 的 session id（用于审计）。 */
  cascadeFrom: string;
  /** 是否保留中间产物（默认 true）。 */
  preserveArtifacts: boolean;
}

/** 暂停 / 恢复信号（cascade 到子 session）。 */
export interface PauseSignalPayload {
  reason?: string;
  pausedBy: string;
  pausedAt: number;
}

/** 反向通知 b（escape hatch）。target=reception session id。 */
export interface EscalationRequestPayload {
  fromLayer: 'pm1' | 'pm2' | 'execution';
  fromSessionId: string;
  reason:
    | 'constitution_violation'
    | 'review_failed_threshold'
    | 'crash_recovery_failed'
    | 'needs_clarification';
  escalationRound: number;
  /** 给用户看的人话描述。 */
  context: string;
  suggestedActions: Array<{
    label: string;
    action: 'edit_constitution' | 'edit_original_request' | 'answer';
  }>;
}

/** 进度上报（target=reception session id）。 */
export interface ProgressReportPayload {
  fromSessionId: string;
  fromLayer: string;
  substate: string;
  completed?: number;
  total?: number;
  estimatedRemainingMs?: number;
}

/** 全部 message_type 取值（按 L1.3 spec 优先级排序）。 */
export type InboundMessageType =
  | 'cancel_signal' // P0
  | 'pause_signal' // P1
  | 'resume_signal' // P1
  | 'clarification_answer' // P2
  | 'user_input' // P3
  | 'escalation_request' // 反向通知（target=b）
  | 'progress_report'; // 反向通知（target=b）

/**
 * message_type 与 payload 类型的映射表。
 * 用于在 client 提交时做类型守卫。
 */
export interface InboundPayloadByType {
  cancel_signal: CancelSignalPayload;
  pause_signal: PauseSignalPayload;
  resume_signal: PauseSignalPayload;
  clarification_answer: ClarificationAnswerPayload;
  user_input: UserInputPayload;
  escalation_request: EscalationRequestPayload;
  progress_report: ProgressReportPayload;
}

/** 提交 inbound 的请求结构（前端 → 后端）。 */
export interface InboundSubmitRequest<T extends InboundMessageType = InboundMessageType> {
  messageType: T;
  payload: InboundPayloadByType[T];
  /**
   * 可选：客户端生成的幂等 key（避免网络抖动导致重复提交）。
   * 未来可能由后端用作 idempotency_key（与 handoff_records.idempotency_key 同语义）。
   */
  clientIdempotencyKey?: string;
  /**
   * 可选：消息过期时间（ms epoch）。后端用于 expires_at 字段。
   * 不传 = 默认 24h（cancel_signal 不过期，由后端覆盖）。
   */
  expiresAt?: number;
}

/** 提交成功后的响应结构。 */
export interface InboundSubmitResponse {
  /** 后端落库后的 message id。 */
  messageId: string;
  /** 入库时间（ISO datetime）。 */
  createdAt: string;
}
