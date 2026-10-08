import type { WorkflowLogger } from './workflow-logger.js';
import type { RequestContext } from './types.js';

export type RequestLoggerDecorators = {
  workflowLogger: WorkflowLogger;
  workflowContext: RequestContext;
};

/** 请求 ID 头。客户端可透传该头把自己的日志与网关日志串联起来。 */
export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * 超过该长度的入站 requestId 视为不可信（可能被用于日志字段注入或撑爆单条日志），
 * 直接丢弃并重新生成。
 */
const MAX_INBOUND_REQUEST_ID_LENGTH = 200;

/**
 * 生成 requestId。
 *
 * 刻意不使用 `node:crypto`：本包同时被打进浏览器 bundle（`apps/web` 通过 Vite
 * alias 直引 `src/index.ts`），引入 Node 内置模块会破坏前端构建。这里用 Web Crypto
 * 全局——Node 18+ / Bun / 浏览器均可用。
 */
export function generateRequestId(): string {
  const webCrypto = globalThis.crypto;
  if (webCrypto && typeof webCrypto.randomUUID === 'function') {
    return webCrypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * 解析入站 requestId：优先信任调用方透传的值，让一次用户操作在客户端日志、
 * 网关访问日志与 `request_workflow_logs` 表里共用同一个 ID。
 *
 * @param headers        请求头
 * @param fallbackId     调用方已生成的 ID（例如 Fastify 的 `request.id`）；入站头缺失时复用，
 *                       避免同一请求在两处各生成一个 ID 而无法交叉检索。
 */
export function resolveRequestId(
  headers: Record<string, string | string[] | undefined>,
  fallbackId?: string,
): string {
  const raw = headers[REQUEST_ID_HEADER];
  const candidate = Array.isArray(raw) ? raw[0] : raw;
  if (typeof candidate === 'string') {
    const trimmed = candidate.trim();
    if (trimmed.length > 0 && trimmed.length <= MAX_INBOUND_REQUEST_ID_LENGTH) {
      return trimmed;
    }
  }
  return fallbackId && fallbackId.length > 0 ? fallbackId : generateRequestId();
}

export function createRequestContext(
  method: string,
  url: string,
  headers: Record<string, string | string[] | undefined>,
  ip: string,
  fallbackRequestId?: string,
): RequestContext {
  const forwardedIp =
    (headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ?? ip;
  const userAgent = headers['user-agent'] as string | undefined;
  return {
    requestId: resolveRequestId(headers, fallbackRequestId),
    method,
    path: url.split('?')[0] ?? url,
    ip: forwardedIp,
    userAgent,
    startTime: Date.now(),
  };
}