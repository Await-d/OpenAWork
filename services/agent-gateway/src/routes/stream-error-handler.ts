/**
 * stream-error-handler.ts — 统一错误处理
 *
 * 职责：
 * - 错误分类与转换
 * - 错误消息映射（用户友好 + 技术细节）
 * - 日志记录与审计
 * - 错误恢复建议
 *
 * 依赖：logger、audit-log、错误类型
 * 被依赖：stream-handler（错误路径）
 */

import type { MessageContent } from '@openAwork/shared';
import { extractSafeErrorInfo, redactErrorText } from '../infra/error-handling.js';
import { logGatewayError } from '../infra/gateway-logger.js';
import { writeAuditLog } from '../infra/audit-log.js';

/**
 * 流式执行错误消息映射表
 */
export const STREAM_ERROR_MESSAGES = {
  inputImageMissingSource: 'input_image 必须提供 artifactId、fileId 或 imageUrl 其中之一。',
  requestReplayFailed: '请求重放失败。',
  sessionAlreadyRunning: '当前会话已有请求正在运行。',
  teamModelBindingUnavailable: '团队会话绑定的模型当前不可用，请在团队模板或会话中重新绑定模型。',
} as const;

/**
 * Team 模型绑定不可用错误
 */
export class TeamModelBindingUnavailableError extends Error {
  readonly code = 'TEAM_MODEL_BINDING_UNAVAILABLE';

  constructor() {
    super(STREAM_ERROR_MESSAGES.teamModelBindingUnavailable);
    this.name = 'TeamModelBindingUnavailableError';
  }
}

/**
 * 判断是否为 Team 模型绑定错误
 *
 * @param error - 任意错误对象
 * @returns 是否为 Team 模型绑定错误
 */
export function isTeamModelBindingUnavailable(
  error: unknown,
): error is TeamModelBindingUnavailableError {
  return error instanceof TeamModelBindingUnavailableError;
}

/**
 * 建立错误内容消息（用于会话历史记录）
 *
 * 正文形态：`[错误: CODE] 摘要`，可选追加 `\n\n技术详情：…`。这是**全网关唯一**的
 * 错误正文构造实现——顶层路径与模型轮次路径都必须经此构造，否则同一错误在两条路径
 * 落库内容不一致（前端 `assistant-error-content-v2` 依 `\n\n技术详情：` 标记还原技术
 * 详情折叠区，缺标记即丢失）。
 *
 * @param code - 错误码
 * @param message - 用户可见摘要
 * @param technicalDetail - 可选技术详情；与摘要相同或仅空白时不追加，避免重复
 * @returns 消息内容数组
 */
export function buildErrorContent(
  code: string,
  message: string,
  technicalDetail?: string,
): MessageContent[] {
  const normalizedTechnicalDetail = technicalDetail?.trim();
  const detailSuffix =
    normalizedTechnicalDetail && normalizedTechnicalDetail !== message
      ? `\n\n技术详情：${normalizedTechnicalDetail}`
      : '';
  return [{ type: 'text', text: `[错误: ${code}] ${message}${detailSuffix}`.trim() }];
}

/**
 * 记录流式执行错误到日志和审计
 *
 * @param input - 错误上下文
 */
export function recordStreamError(input: {
  error: unknown;
  sessionId: string;
  userId: string;
  clientRequestId: string;
  transport: 'SSE' | 'WS';
  model?: string;
}): { message: string; detail: string; stack?: string } {
  const errorInfo = extractSafeErrorInfo(input.error);
  const errorDetail = {
    errorName: input.error instanceof Error ? redactErrorText(input.error.name) : 'NonError',
    errorMessage: errorInfo.message,
    errorStack:
      input.error instanceof Error && input.error.stack
        ? redactErrorText(input.error.stack.slice(0, 8_000))
        : null,
  };

  logGatewayError(`[stream] 流式执行失败：${errorDetail.errorMessage}`, {
    kind: 'STREAM_ERROR',
    sessionId: input.sessionId,
    clientRequestId: input.clientRequestId,
    userId: input.userId,
    transport: input.transport,
    model: input.model,
    ...errorDetail,
  });

  writeAuditLog({
    sessionId: input.sessionId,
    category: 'stream',
    sourceName: 'STREAM_ERROR',
    requestId: input.clientRequestId,
    output: {
      message: errorDetail.errorMessage,
      code: 'STREAM_ERROR',
      stack: errorDetail.errorStack,
    },
  });

  return {
    message: errorDetail.errorMessage,
    detail: errorDetail.errorStack ?? '',
    stack: errorDetail.errorStack ?? undefined,
  };
}

/**
 * 记录路由解析错误到审计
 *
 * @param input - 路由解析错误上下文
 */
export function recordRouteResolutionError(input: {
  sessionId: string;
  clientRequestId: string;
  error: unknown;
  agentId?: string;
}): void {
  const { message } = extractSafeErrorInfo(input.error);

  writeAuditLog({
    sessionId: input.sessionId,
    category: 'route',
    sourceName: 'MODEL_RESOLVE',
    requestId: input.clientRequestId,
    input: { agentId: input.agentId },
    output: { message, code: 'MODEL_RESOLVE' },
  });
}

/**
 * 记录权限检查错误
 *
 * @param input - 权限检查错误上下文
 */
export function recordPermissionError(input: {
  sessionId: string;
  clientRequestId: string;
  userId: string;
  error: string;
}): void {
  writeAuditLog({
    sessionId: input.sessionId,
    category: 'route',
    sourceName: 'SESSION_CONFLICT',
    requestId: input.clientRequestId,
    output: {
      message: input.error,
      code: 'SESSION_ALREADY_RUNNING',
    },
  });
}

/**
 * 为流式执行失败构建用户友好的错误消息
 *
 * @param input - 错误详情
 * @returns 用户友好的摘要和技术细节
 */
export function buildStreamFailureMessage(input: {
  errorMessage: string;
  errorStack?: string;
  code?: string;
}): { summary: string; detail?: string; code?: string } {
  return {
    summary: input.errorMessage,
    ...(input.errorStack ? { detail: input.errorStack } : {}),
    ...(input.code ? { code: input.code } : {}),
  };
}

/**
 * 判断错误是否可恢复
 *
 * @param error - 错误对象
 * @returns 是否可恢复
 */
export function isRecoverableError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();

  // 瞬时网络错误可恢复
  if (message.includes('timeout') || message.includes('econnreset')) {
    return true;
  }

  // 关键业务错误不可恢复
  if (message.includes('model binding unavailable') || message.includes('not found')) {
    return false;
  }

  return false;
}

/**
 * 提取错误堆栈用于诊断
 *
 * @param error - 错误对象
 * @returns 格式化的错误信息
 */
export function extractErrorDiagnostics(error: unknown): string {
  if (error instanceof Error) {
    return redactErrorText(`${error.name}: ${error.message}\n${error.stack ?? ''}`);
  }
  return redactErrorText(error);
}
