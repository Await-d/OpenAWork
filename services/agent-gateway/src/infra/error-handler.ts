/**
 * 方案 2：全局错误处理中间件
 *
 * 捕获所有未处理的错误，统一格式化为 ApiErrorResponse。
 * - ApiError 实例 → 直接返回结构化响应
 * - Fastify validation 错误 → 格式化为 BadRequest
 * - 未知错误 → 500 InternalError（不泄露内部信息）
 */
import type { FastifyInstance, FastifyError } from 'fastify';
import { ApiError } from './error-response.js';

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError | Error | ApiError, request, reply) => {
    // 已知的 ApiError — 直接返回结构化响应
    if (error instanceof ApiError) {
      return reply.status(error.statusCode).send(error.response);
    }

    // Fastify 内置的 schema validation 错误（来自 JSON Schema 校验）
    if ('validation' in error && error.validation) {
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
      return reply.status(error.statusCode).send({
        name: error.statusCode === 404 ? 'NotFound' : 'BadRequest',
        data: {
          message:
            error.statusCode === 404 ? '请求的接口不存在。' : '请求参数无效。',
        },
      });
    }

    // 未知错误 — 记录日志但不泄露内部信息
    request.log.error(error);
    return reply.status(500).send({
      name: 'InternalError',
      data: { message: '服务器内部错误。' },
    });
  });
}
