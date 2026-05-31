/**
 * 方案 2：请求解析辅助函数
 *
 * 统一 Zod schema 解析 + 错误抛出，替代各 handler 中重复的
 * safeParse + reply.status(400).send(...) 模式。
 */
import type { ZodType, infer as ZodInfer } from 'zod';
import { ApiError } from './error-response.js';

/**
 * 解析请求 body，失败时抛出 ApiError.badRequest
 */
export function parseBody<T extends ZodType>(schema: T, body: unknown): ZodInfer<T> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw ApiError.badRequest('请求体参数无效。', {
      kind: 'Body',
      issues: result.error.issues,
    });
  }
  return result.data;
}

/**
 * 解析 query 参数，失败时抛出 ApiError.badRequest
 */
export function parseQuery<T extends ZodType>(schema: T, query: unknown): ZodInfer<T> {
  const result = schema.safeParse(query);
  if (!result.success) {
    throw ApiError.badRequest('查询参数无效。', {
      kind: 'Query',
      issues: result.error.issues,
    });
  }
  return result.data;
}

/**
 * 解析路径参数，失败时抛出 ApiError.badRequest
 */
export function parseParams<T extends ZodType>(schema: T, params: unknown): ZodInfer<T> {
  const result = schema.safeParse(params);
  if (!result.success) {
    throw ApiError.badRequest('路径参数无效。', {
      kind: 'Params',
      issues: result.error.issues,
    });
  }
  return result.data;
}
