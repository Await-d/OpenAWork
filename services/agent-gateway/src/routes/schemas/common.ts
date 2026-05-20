/**
 * 方案 4：共享 API Schema 定义
 *
 * 统一分页、ID 参数、错误响应等通用类型，
 * 供所有路由 schema 文件引用。
 */
import { z } from 'zod';

/** 统一分页查询参数 */
export const paginationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type PaginationQuery = z.infer<typeof paginationQuery>;

/** 统一 session ID 路径参数 */
export const sessionIdParam = z.object({
  id: z.string().min(1).max(64),
});
export type SessionIdParam = z.infer<typeof sessionIdParam>;

/** 统一成功响应 */
export const okResponse = z.object({ ok: z.literal(true) });

/** 统一错误响应格式 */
export const apiErrorResponse = z.object({
  name: z.enum(['BadRequest', 'NotFound', 'Unauthorized', 'InternalError']),
  data: z.object({
    message: z.string(),
    kind: z.enum(['Body', 'Query', 'Params', 'Headers']).nullable().optional(),
    issues: z.array(z.any()).optional(),
  }),
});

/** 带分页元数据的列表响应包装 */
export function paginatedResponse<T extends z.ZodType>(itemSchema: T) {
  return z.object({
    items: z.array(itemSchema),
    total: z.number().int().min(0),
    limit: z.number().int().min(1),
    offset: z.number().int().min(0),
  });
}
