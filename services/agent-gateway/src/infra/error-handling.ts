/**
 * 统一错误处理规范与工具集。
 *
 * 本模块定义了全网关统一的错误分类、结构化日志规范、决策树与审计日志标准。
 * 所有 catch 块必须遵循本规范记录错误，禁止空 catch。
 */

import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { redactLogText } from '@openAwork/logger';
import { redactAuditValue } from './audit-redaction.js';
import { writeAuditLog } from './audit-log.js';
import { logGatewayError, logGatewayWarn, logGatewayInfo } from './gateway-logger.js';

/**
 * 错误分类枚举。
 *
 * 用于结构化日志、审计记录与决策树。每个错误类别对应一个标准的处理策略与日志级别。
 */
export enum ErrorCategory {
  /** 认证失败：JWT 无效、过期、缺失等。 */
  AUTH_FAILURE = 'auth_failure',

  /** 解析失败：JSON parse / validation schema mismatch 等。 */
  PARSE_FAILURE = 'parse_failure',

  /** 权限被拒绝：用户无权访问该资源或执行该操作。 */
  PERMISSION_DENIED = 'permission_denied',

  /** 工具执行失败：调用内部工具或外部 API 时失败（可预期可恢复）。 */
  TOOL_EXECUTION_FAILED = 'tool_execution_failed',

  /** 网络错误：连接超时、DNS 失败、对端无响应等。 */
  NETWORK_ERROR = 'network_error',

  /** 意外错误：其他未分类错误（通常需要调查）。 */
  UNEXPECTED_ERROR = 'unexpected_error',
}

/**
 * 日志级别决策树。
 *
 * 用于在 catch 块中决定记录到 error / warn / info 的规则。
 */
export const LOG_LEVEL_DECISION: Record<ErrorCategory, 'error' | 'warn' | 'info'> = {
  [ErrorCategory.AUTH_FAILURE]: 'warn', // 预期发生（用户输入错误），不需要 error 级别
  [ErrorCategory.PARSE_FAILURE]: 'warn', // 预期发生（数据格式错误），不需要 error 级别
  [ErrorCategory.PERMISSION_DENIED]: 'info', // 预期发生（权限检查），可作为审计日志
  [ErrorCategory.TOOL_EXECUTION_FAILED]: 'error', // 可恢复但需要记录
  [ErrorCategory.NETWORK_ERROR]: 'warn', // 预期发生（外部服务可能不可用），retry 后可能恢复
  [ErrorCategory.UNEXPECTED_ERROR]: 'error', // 不预期，需要调查
};

/**
 * 结构化错误日志的标准签名。
 *
 * 所有记录到日志的错误必须包含：
 * - category: 错误分类（用于按类别统计 / 告警）
 * - context: 错误发生的上下文（会话 ID / 用户 ID / 操作描述 等）
 * - reason: 人类可读的错误理由
 * - recoverable: 是否可恢复（用于决定是否应重试、降级等）
 * - metadata: 错误详情（错误消息、错误码、堆栈 等）
 *
 * 签名：
 *   structuredLog(app, category, context, reason, recoverable, metadata)
 *
 * 示例：
 *   structuredLog(
 *     app,
 *     ErrorCategory.PERMISSION_DENIED,
 *     { userId: req.user.id, sessionId: req.params.sessionId },
 *     '用户无权访问该会话',
 *     false,
 *     { error: err.message, requestId: req.id },
 *   );
 */
export interface ErrorContext {
  userId?: string;
  sessionId?: string;
  toolName?: string;
  operationId?: string;
  requestId?: string;
  [key: string]: unknown;
}

export interface ErrorMetadata {
  error?: unknown;
  message?: string;
  code?: string;
  originalError?: Error;
  stack?: string;
  attempt?: number;
  maxAttempts?: number;
  [key: string]: unknown;
}

/**
 * 生成结构化错误日志。
 *
 * 此函数是所有 catch 块的统一入口，确保错误信息的格式一致、可追踪、可统计。
 */
export function structuredLog(
  app: FastifyInstance,
  category: ErrorCategory,
  context: ErrorContext,
  reason: string,
  recoverable: boolean,
  metadata: ErrorMetadata = {},
): void {
  const level = LOG_LEVEL_DECISION[category];
  const safeContext = sanitizeErrorLogValue(context) as ErrorContext;
  const safeMetadata = sanitizeErrorLogValue(metadata) as ErrorMetadata;
  const safeReason = redactErrorText(reason);
  const logMessage = buildLogMessage(category, safeContext, safeReason, recoverable, safeMetadata);
  const auditEntry = buildAuditEntry(category, safeContext, safeReason, recoverable, safeMetadata);
  const fields = {
    category,
    context: safeContext,
    reason: safeReason,
    recoverable,
    metadata: safeMetadata,
  };

  // 按日志级别记录
  switch (level) {
    case 'error':
      logGatewayError(logMessage, fields);
      break;
    case 'warn':
      logGatewayWarn(logMessage, fields);
      break;
    case 'info':
      logGatewayInfo(logMessage, fields);
      break;
  }

  // 投递审计日志（异步，不阻塞）
  void sendAuditLog(app, auditEntry);
}

/**
 * 快捷方式：记录预期错误（通常不需要调查）。
 */
export function logExpectedError(
  app: FastifyInstance,
  category:
    | ErrorCategory.AUTH_FAILURE
    | ErrorCategory.PARSE_FAILURE
    | ErrorCategory.PERMISSION_DENIED
    | ErrorCategory.NETWORK_ERROR,
  context: ErrorContext,
  reason: string,
  metadata?: ErrorMetadata,
): void {
  structuredLog(app, category, context, reason, false, metadata);
}

/**
 * 快捷方式：记录可恢复的工具执行错误（将重试）。
 *
 * @remarks 预留接口（见 `logExpectedError`）：当前生产引用为 0，保留以待工具重试
 * 路径统一到本入口（`isRetryableError` 判定后即可直接调用）。
 */
export function logRecoverableToolError(
  app: FastifyInstance,
  context: ErrorContext,
  reason: string,
  metadata?: ErrorMetadata,
): void {
  structuredLog(app, ErrorCategory.TOOL_EXECUTION_FAILED, context, reason, true, metadata);
}

/**
 * 快捷方式：记录意外错误（需要调查）。
 *
 * @remarks 预留接口（见 `logExpectedError`）：当前仅测试引用；`logUnexpectedError`
 * 已被 `stream-layered-refactor-audit.test.ts` 覆盖。保留待 catch-all 路径收敛。
 */
export function logUnexpectedError(
  app: FastifyInstance,
  context: ErrorContext,
  reason: string,
  originalError: unknown,
  metadata?: ErrorMetadata,
): void {
  structuredLog(app, ErrorCategory.UNEXPECTED_ERROR, context, reason, false, {
    ...metadata,
    error: originalError,
  });
}

/**
 * 构建人类可读的日志消息。
 */
function buildLogMessage(
  category: ErrorCategory,
  context: ErrorContext,
  reason: string,
  recoverable: boolean,
  metadata: ErrorMetadata,
): string {
  const parts: string[] = [];

  parts.push(`[${category}]`);

  if (context.userId) {
    parts.push(`user=${context.userId}`);
  }
  if (context.sessionId) {
    parts.push(`session=${context.sessionId}`);
  }
  if (context.toolName) {
    parts.push(`tool=${context.toolName}`);
  }
  if (context.requestId) {
    parts.push(`req=${context.requestId}`);
  }

  parts.push(reason);

  if (recoverable) {
    parts.push('(recoverable, will retry)');
  }

  if (metadata.message) {
    parts.push(`message: ${metadata.message}`);
  }

  if (metadata.code) {
    parts.push(`code: ${metadata.code}`);
  }

  if (metadata.attempt !== undefined && metadata.maxAttempts !== undefined) {
    parts.push(`attempt ${metadata.attempt}/${metadata.maxAttempts}`);
  }

  return parts.join(' | ');
}

/**
 * 构建审计日志条目（异步投递到持久化存储）。
 */
interface AuditLogEntry {
  timestamp: number;
  category: ErrorCategory;
  context: ErrorContext;
  reason: string;
  recoverable: boolean;
  message?: string;
  code?: string;
}

function buildAuditEntry(
  category: ErrorCategory,
  context: ErrorContext,
  reason: string,
  recoverable: boolean,
  metadata: ErrorMetadata,
): AuditLogEntry {
  return {
    timestamp: Date.now(),
    category,
    context,
    reason,
    recoverable,
    message: typeof metadata.message === 'string' ? metadata.message : undefined,
    code: typeof metadata.code === 'string' ? metadata.code : undefined,
  };
}

/**
 * 异步投递审计日志（实现可根据部署情况调整：本地 SQLite / 远程审计服务等）。
 */
async function sendAuditLog(_app: FastifyInstance, entry: AuditLogEntry): Promise<void> {
  try {
    writeAuditLog({
      sessionId: entry.context.sessionId ?? null,
      requestId: entry.context.requestId ?? entry.context.operationId ?? randomUUID(),
      category: entry.category === ErrorCategory.TOOL_EXECUTION_FAILED ? 'tool' : 'stream',
      sourceName: entry.context.toolName ?? entry.category,
      output: {
        message: entry.reason,
        code: entry.code,
        detail: entry.message,
        recoverable: entry.recoverable,
        context: entry.context,
      },
    });
  } catch (err) {
    // 审计日志投递失败不应中断主流程，记录到 stderr
    logGatewayError('[audit-log-send-failed]', extractSafeErrorInfo(err));
  }
}

/**
 * 从错误对象提取安全的错误信息。
 *
 * 避免在日志中泄露敏感信息（API 密钥等）。
 */
export function extractSafeErrorInfo(error: unknown): { message: string; code?: string } {
  if (error instanceof Error) {
    return {
      message: redactErrorText(error.message),
      code: 'code' in error ? redactErrorText(error.code) : undefined,
    };
  }
  return { message: redactErrorText(error) };
}

/** 未知对象不执行自定义转换；URL 展示不携带用户信息、查询参数或片段。 */
export function redactErrorText(value: unknown): string {
  const text =
    value !== null && (typeof value === 'object' || typeof value === 'function')
      ? '[Unknown error]'
      : String(value);
  return redactLogText(
    text.replace(/https?:\/\/[^\s<>"'`]+/gi, (urlText) => {
      try {
        const url = new URL(urlText);
        return `${url.protocol}//${url.host}${url.pathname}`;
      } catch {
        return '[REDACTED_URL]';
      }
    }),
  );
}

function sanitizeErrorLogValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return redactErrorText(value);
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (value instanceof Error) {
    return {
      name: redactErrorText(value.name),
      ...extractSafeErrorInfo(value),
      stack: value.stack ? redactErrorText(value.stack) : undefined,
    };
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeErrorLogValue(item, seen));
  return redactAuditValue(
    Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, sanitizeErrorLogValue(item, seen)]),
    ),
  );
}

/**
 * 判断错误是否可重试（基于错误类别与状态码）。
 */
export function isRetryableError(error: unknown, category: ErrorCategory): boolean {
  // 网络错误通常可重试
  if (category === ErrorCategory.NETWORK_ERROR) {
    return true;
  }

  // 特定的工具执行错误（超时、临时不可用）可重试
  if (category === ErrorCategory.TOOL_EXECUTION_FAILED) {
    if (error instanceof Error && 'code' in error) {
      const code = String(error.code);
      // 临时不可用、超时等
      return ['ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND', 'EHOSTUNREACH'].includes(code);
    }
  }

  return false;
}
