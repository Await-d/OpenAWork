/**
 * 方案 2：全局错误处理中间件
 *
 * 捕获所有未处理的错误，统一格式化为 ApiErrorResponse。
 * - ApiError 实例 → 直接返回结构化响应
 * - Fastify validation 错误 → 格式化为 BadRequest
 * - 未知错误 → 500 InternalError（不泄露内部信息）
 *
 * 记录契约（排障的核心约束：任何离开本处理器的错误都必须在服务端留下痕迹）：
 * - 5xx → `error` 级，携带完整堆栈与业务上下文（userId / method / path / code）；
 * - 4xx → `info` 级，不刷屏但可按追踪 ID 检索；
 * - 404 路由未命中与参数校验失败 → `warn` 级（通常意味着客户端调用方 bug 或版本不匹配，
 *   排查价值高且量级可控）。
 *
 * 同时把追踪 ID 回写到 `x-request-id` 响应头：客户端报障时给出这个 ID，
 * 就能在网关日志与 `request_workflow_logs` 表里定位到那一次请求。
 */
import type { FastifyInstance, FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ApiError } from './error-response.js';
import { getRequestDiagnostics, resolveTraceId, REQUEST_ID_HEADER } from './request-diagnostics.js';

interface ErrorLogContext {
  requestId: string;
  method: string;
  path: string;
  statusCode: number;
  code: string;
  userId: string | null;
}

/** 构造错误日志的公共上下文字段。 */
function buildLogContext(
  request: FastifyRequest,
  statusCode: number,
  code: string,
): ErrorLogContext {
  return {
    requestId: resolveTraceId(request),
    method: request.method,
    path: request.url,
    statusCode,
    code,
    userId: getRequestDiagnostics(request)?.userId ?? null,
  };
}

/** 把追踪 ID 交还客户端，使其报错信息可被服务端检索。 */
function attachRequestIdHeader(reply: FastifyReply, requestId: string): void {
  // `reply.sent` 守卫：流式响应（SSE / WS）已经开始写头之后再设置 header 会抛
  // FST_ERR_REP_ALREADY_SENT，在错误处理器内部抛错会产生二次故障并掩盖原始错误。
  // 此时放弃附加头即可——响应已发出，本来也改不了。
  if (reply.sent || reply.hasHeader(REQUEST_ID_HEADER)) {
    return;
  }
  void reply.header(REQUEST_ID_HEADER, requestId);
}

/**
 * 记录未匹配路由。
 *
 * **必须显式注册 `setNotFoundHandler`**：Fastify 对未匹配路由走自己的 404 路径，
 * **不会**经过 `setErrorHandler`，因此 404 在此之前完全不产生任何服务端记录——
 * 「客户端打错路径」「客户端版本落后于网关」这两类高频问题无从发现。
 *
 * 提取为独立函数供 `app/web-static.ts` 的 SPA 兜底复用，避免两处 404 逻辑分叉。
 */
export function logNotFoundRequest(request: FastifyRequest): string {
  const requestId = resolveTraceId(request);
  request.log.warn(
    { requestId, method: request.method, path: request.url },
    `[error-handler] 路由未命中 ${request.method} ${request.url}`,
  );
  return requestId;
}

export function registerErrorHandler(app: FastifyInstance): void {
  // API-only 场景（桌面端 sidecar、纯网关部署）没有 web-static 插件接管 404，
  // 这里兜底记录。web-static 注册在之后，会覆盖本处理器并复用同一记录逻辑。
  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    const requestId = logNotFoundRequest(request);
    // 响应体逐字段对齐 Fastify 默认 notFoundHandler 的形状
    // （`{ statusCode, error, message }`）。这里刻意不套用 ApiError 的 `{ name, data }`：
    // 客户端可能已按 Fastify 默认结构解析 404，换形状等于无声地改契约。
    void reply
      .code(404)
      .header(REQUEST_ID_HEADER, requestId)
      .send({
        statusCode: 404,
        error: 'Not Found',
        message: `Route ${request.method}:${request.url} not found`,
      });
  });

  app.setErrorHandler((error: FastifyError | Error | ApiError, request, reply) => {
    attachRequestIdHeader(reply, resolveTraceId(request));

    // 已知的 ApiError — 直接返回结构化响应
    if (error instanceof ApiError) {
      const { statusCode } = error;
      const context = buildLogContext(request, statusCode, error.response.name);
      if (statusCode >= 500) {
        request.log.error(
          { ...context, err: error, message: error.message },
          `[error-handler] ${request.method} ${request.url} → ${statusCode} ${error.message}`,
        );
      } else {
        request.log.info(
          { ...context, message: error.message },
          `[error-handler] ${request.method} ${request.url} → ${statusCode} ${error.message}`,
        );
      }
      return reply.status(statusCode).send(error.response);
    }

    // Fastify 内置的 schema validation 错误（来自 JSON Schema 校验）
    if ('validation' in error && error.validation) {
      const context = buildLogContext(request, 400, 'BadRequest');
      request.log.warn(
        { ...context, message: error.message, validation: error.validation },
        `[error-handler] ${request.method} ${request.url} → 400 请求参数校验失败`,
      );
      return reply.status(400).send({
        name: 'BadRequest',
        data: {
          message: '请求参数无效。',
          kind: 'Body',
        },
      });
    }

    // 带 statusCode 的 Fastify 错误（如 404 路由未找到）
    if ('statusCode' in error && typeof error.statusCode === 'number' && error.statusCode < 500) {
      const { statusCode } = error;
      const isNotFound = statusCode === 404;
      const context = buildLogContext(request, statusCode, isNotFound ? 'NotFound' : 'BadRequest');
      // 404 说明客户端打到了不存在的路由，属于排查高频场景，单独提级为 warn。
      const payload = {
        ...context,
        message: error.message,
        ...(typeof error.code === 'string' ? { errorCode: error.code } : {}),
      };
      if (isNotFound) {
        request.log.warn(payload, `[error-handler] 路由未命中 ${request.method} ${request.url}`);
      } else {
        request.log.info(payload, `[error-handler] ${request.method} ${request.url} → ${statusCode}`);
      }
      return reply.status(statusCode).send({
        name: isNotFound ? 'NotFound' : 'BadRequest',
        data: {
          message: isNotFound ? '请求的接口不存在。' : '请求参数无效。',
        },
      });
    }

    // 未知错误 — 记录日志但不泄露内部信息
    const context = buildLogContext(request, 500, 'InternalError');
    request.log.error(
      { ...context, err: error },
      `[error-handler] ${request.method} ${request.url} → 500 ${error.message}`,
    );
    return reply.status(500).send({
      name: 'InternalError',
      data: { message: '服务器内部错误。' },
    });
  });
}