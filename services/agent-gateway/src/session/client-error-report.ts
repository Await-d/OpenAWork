/**
 * 客户端侧流错误的上报落库。
 *
 * 背景：失败轮次里有两类来源，但只有一类会进历史——
 *   1. 网关侧失败（上游模型、流中断、顶层异常）：网关自己
 *      `appendSessionMessageV2({ status: 'error' })` 落库，刷新后可见；
 *   2. 客户端侧传输失败（`SSE_ERROR` / `WS_CLOSED` / `*_INVALID_PAYLOAD` 等）：
 *      错误 chunk 完全由浏览器合成，网关侧不存在对应记录，因此只活在本地
 *      state 里，刷新即消失。
 *
 * 本模块为第 2 类补一条**由网关执行**的落库通道：客户端只上报「我这边看到
 * 什么错误」，写入权仍在网关，避免客户端伪造 assistant 消息。
 *
 * 三条不变式：
 *   - **幂等**：同一 `clientRequestId` 下若已有 assistant 消息（无论终态是
 *     error 还是 final），一律跳过。网关侧已落库的失败不会被客户端补写覆盖，
 *     已成功的回合也不会被迟到的传输错误反写成失败。
 *   - **不进模型上下文**：`status: 'error'` 的消息在
 *     `message-to-model-messages.ts` 被显式剔除，落库不会污染 prompt。
 *   - **可被重试清理**：`replaceExisting` 语义与网关侧失败一致，用户点重试时
 *     `clearStaleReplayRequestArtifacts` 会按请求作用域一并清掉。
 */

import { z } from 'zod';
import {
  appendSessionMessageV2,
  getSessionMessageByRequestId,
} from '../message/message-v2-adapter.js';

/** 技术详情上限：前端会把整段连接诊断原文带上来，防止单条消息无限膨胀。 */
export const CLIENT_STREAM_ERROR_TECHNICAL_DETAIL_MAX = 4_000;

/**
 * `code` 必须能通过前端 `looksLikeAssistantErrorContent` 的
 * `/^\[错误:\s*[A-Za-z0-9_]+\]/`，否则落库后刷新回来会退化成普通正文气泡。
 */
export const clientStreamErrorReportSchema = z.object({
  clientRequestId: z.string().trim().min(1).max(200),
  code: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9_]+$/, '错误码只允许字母、数字与下划线。'),
  message: z.string().trim().min(1).max(2_000),
  technicalDetail: z.string().trim().max(CLIENT_STREAM_ERROR_TECHNICAL_DETAIL_MAX).optional(),
});

export type ClientStreamErrorReport = z.infer<typeof clientStreamErrorReportSchema>;

/**
 * 落库结果。
 * - `persisted`：本次写入了一条 error 消息；
 * - `deduplicated`：网关侧已为该请求落库过失败消息，客户端重复上报被丢弃；
 * - `skipped_existing`：该请求已有 assistant 消息（通常是成功回合），不反写失败。
 */
export type ClientStreamErrorPersistOutcome = 'persisted' | 'deduplicated' | 'skipped_existing';

export interface ClientStreamErrorPersistResult {
  messageId?: string;
  outcome: ClientStreamErrorPersistOutcome;
}

/**
 * 正文格式与网关侧 `buildErrorContent` / `buildUserFacingStreamErrorMessage`
 * 完全一致：`[错误: CODE] 摘要` + 可选 `\n\n技术详情：…`，
 * 保证落库后能被同一个解析器（`assistant-error-content-v2.ts`）还原成错误卡片。
 */
export function buildClientStreamErrorText(input: {
  code: string;
  message: string;
  technicalDetail?: string | undefined;
}): string {
  const summary = input.message.trim();
  const detail = input.technicalDetail?.trim();
  const detailSuffix = detail && detail !== summary ? `\n\n技术详情：${detail}` : '';
  return `[错误: ${input.code.trim()}] ${summary}${detailSuffix}`.trim();
}

export function persistClientStreamErrorMessage(input: {
  sessionId: string;
  userId: string;
  report: ClientStreamErrorReport;
}): ClientStreamErrorPersistResult {
  const { clientRequestId, code, message, technicalDetail } = input.report;

  // 幂等准入：请求作用域内已有 assistant 消息就不再写第二条。
  const existing = getSessionMessageByRequestId({
    clientRequestId,
    role: 'assistant',
    sessionId: input.sessionId,
    userId: input.userId,
  });
  if (existing) {
    return {
      outcome: existing.status === 'error' ? 'deduplicated' : 'skipped_existing',
      messageId: existing.message.id,
    };
  }

  const text = buildClientStreamErrorText({ code, message, technicalDetail });
  const persisted = appendSessionMessageV2({
    sessionId: input.sessionId,
    userId: input.userId,
    role: 'assistant',
    content: [{ type: 'text', text }],
    clientRequestId,
    status: 'error',
    // 已确认请求作用域内没有 assistant 消息，无需（也不应）删除任何东西。
    replaceExisting: false,
  });

  return { outcome: 'persisted', messageId: persisted.id };
}
