/**
 * 方案 2：统一 API 错误响应格式
 *
 * 所有 API 错误统一为：
 * {
 *   name: 'BadRequest' | 'NotFound' | 'Unauthorized' | 'InternalError',
 *   data: { message, kind?, issues? }
 * }
 */
import type { ZodIssue } from 'zod';

export type ApiErrorName = 'BadRequest' | 'NotFound' | 'Unauthorized' | 'InternalError';
export type ApiErrorKind = 'Body' | 'Query' | 'Params' | 'Headers';

export interface ApiErrorResponse {
  name: ApiErrorName;
  data: {
    message: string;
    kind?: ApiErrorKind | null;
    issues?: ZodIssue[];
  };
}

export class ApiError extends Error {
  readonly statusCode: number;
  readonly response: ApiErrorResponse;

  constructor(
    statusCode: number,
    name: ApiErrorName,
    message: string,
    opts?: { kind?: ApiErrorKind | null; issues?: ZodIssue[] },
  ) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.response = {
      name,
      data: {
        message,
        ...(opts?.kind !== undefined ? { kind: opts.kind } : {}),
        ...(opts?.issues ? { issues: opts.issues } : {}),
      },
    };
  }

  static badRequest(message: string, opts?: { kind?: ApiErrorKind; issues?: ZodIssue[] }) {
    return new ApiError(400, 'BadRequest', message, opts);
  }

  static notFound(message: string) {
    return new ApiError(404, 'NotFound', message);
  }

  static unauthorized(message = '未授权或登录已失效。') {
    return new ApiError(401, 'Unauthorized', message);
  }

  static internal(message = '服务器内部错误。') {
    return new ApiError(500, 'InternalError', message);
  }
}
