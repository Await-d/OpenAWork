import { z } from 'zod';

/**
 * Error types aligned with OpenAI API
 */
export const ErrorTypeSchema = z.enum([
  'invalid_request_error',
  'authentication_error',
  'permission_error',
  'not_found_error',
  'rate_limit_error',
  'api_error',
  'timeout_error',
  'network_error',
  'server_error',
]);
export type ErrorType = z.infer<typeof ErrorTypeSchema>;

/**
 * Error codes
 */
export const ErrorCodeSchema = z.enum([
  'invalid_api_key',
  'invalid_organization',
  'invalid_request',
  'context_length_exceeded',
  'model_not_found',
  'rate_limit_exceeded',
  'quota_exceeded',
  'insufficient_quota',
  'content_policy_violation',
  'billing_hard_limit_reached',
  'server_error',
  'service_unavailable',
  'timeout',
  'network_error',
  'unknown_error',
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

/**
 * Error detail object
 */
export const ErrorDetailSchema = z.object({
  message: z.string(),
  type: ErrorTypeSchema,
  param: z.string().nullable().optional(),
  code: ErrorCodeSchema.optional(),
});
export type ErrorDetail = z.infer<typeof ErrorDetailSchema>;

/**
 * API error response
 */
export const APIErrorResponseSchema = z.object({
  error: ErrorDetailSchema,
});
export type APIErrorResponse = z.infer<typeof APIErrorResponseSchema>;

/**
 * Rate limit information
 */
export const RateLimitInfoSchema = z.object({
  limit: z.number().optional(),
  remaining: z.number().optional(),
  reset: z.number().optional(),
  reset_tokens: z.number().optional(),
  reset_requests: z.number().optional(),
});
export type RateLimitInfo = z.infer<typeof RateLimitInfoSchema>;

/**
 * Extended error with additional context
 */
export const ExtendedErrorSchema = z.object({
  message: z.string(),
  type: ErrorTypeSchema,
  code: ErrorCodeSchema.optional(),
  param: z.string().nullable().optional(),
  status: z.number().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  requestId: z.string().optional(),
  retryable: z.boolean().optional(),
  retryAfter: z.number().optional(),
  rateLimit: RateLimitInfoSchema.optional(),
});
export type ExtendedError = z.infer<typeof ExtendedErrorSchema>;

/**
 * OpenAI-compatible error class
 */
export class OpenAIError extends Error {
  readonly type: ErrorType;
  readonly code?: ErrorCode;
  readonly param?: string | null;
  readonly status?: number;
  readonly headers?: Record<string, string>;
  readonly requestId?: string;
  readonly retryable: boolean;
  readonly retryAfter?: number;
  readonly rateLimit?: RateLimitInfo;

  constructor(
    message: string,
    options: {
      type: ErrorType;
      code?: ErrorCode;
      param?: string | null;
      status?: number;
      headers?: Record<string, string>;
      requestId?: string;
      retryable?: boolean;
      retryAfter?: number;
      rateLimit?: RateLimitInfo;
      cause?: unknown;
    },
  ) {
    super(message, { cause: options.cause });
    this.name = 'OpenAIError';
    this.type = options.type;
    this.code = options.code;
    this.param = options.param;
    this.status = options.status;
    this.headers = options.headers;
    this.requestId = options.requestId;
    this.retryable = options.retryable ?? false;
    this.retryAfter = options.retryAfter;
    this.rateLimit = options.rateLimit;

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, OpenAIError);
    }
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      type: this.type,
      code: this.code,
      param: this.param,
      status: this.status,
      requestId: this.requestId,
      retryable: this.retryable,
      retryAfter: this.retryAfter,
      rateLimit: this.rateLimit,
    };
  }
}

/**
 * Invalid request error
 */
export class InvalidRequestError extends OpenAIError {
  constructor(message: string, param?: string | null, cause?: unknown) {
    super(message, {
      type: 'invalid_request_error',
      code: 'invalid_request',
      param,
      status: 400,
      retryable: false,
      cause,
    });
    this.name = 'InvalidRequestError';
  }
}

/**
 * Authentication error
 */
export class AuthenticationError extends OpenAIError {
  constructor(message: string, cause?: unknown) {
    super(message, {
      type: 'authentication_error',
      code: 'invalid_api_key',
      status: 401,
      retryable: false,
      cause,
    });
    this.name = 'AuthenticationError';
  }
}

/**
 * Permission error
 */
export class PermissionError extends OpenAIError {
  constructor(message: string, cause?: unknown) {
    super(message, {
      type: 'permission_error',
      status: 403,
      retryable: false,
      cause,
    });
    this.name = 'PermissionError';
  }
}

/**
 * Not found error
 */
export class NotFoundError extends OpenAIError {
  constructor(message: string, cause?: unknown) {
    super(message, {
      type: 'not_found_error',
      code: 'model_not_found',
      status: 404,
      retryable: false,
      cause,
    });
    this.name = 'NotFoundError';
  }
}

/**
 * Rate limit error
 */
export class RateLimitError extends OpenAIError {
  constructor(
    message: string,
    options?: {
      retryAfter?: number;
      rateLimit?: RateLimitInfo;
      cause?: unknown;
    },
  ) {
    super(message, {
      type: 'rate_limit_error',
      code: 'rate_limit_exceeded',
      status: 429,
      retryable: true,
      retryAfter: options?.retryAfter,
      rateLimit: options?.rateLimit,
      cause: options?.cause,
    });
    this.name = 'RateLimitError';
  }
}

/**
 * Context length exceeded error
 */
export class ContextLengthError extends OpenAIError {
  constructor(message: string, cause?: unknown) {
    super(message, {
      type: 'invalid_request_error',
      code: 'context_length_exceeded',
      status: 400,
      retryable: false,
      cause,
    });
    this.name = 'ContextLengthError';
  }
}

/**
 * Content policy violation error
 */
export class ContentPolicyError extends OpenAIError {
  constructor(message: string, cause?: unknown) {
    super(message, {
      type: 'invalid_request_error',
      code: 'content_policy_violation',
      status: 400,
      retryable: false,
      cause,
    });
    this.name = 'ContentPolicyError';
  }
}

/**
 * API error (500+)
 */
export class APIError extends OpenAIError {
  constructor(message: string, status?: number, cause?: unknown) {
    super(message, {
      type: 'api_error',
      code: status && status >= 500 ? 'server_error' : 'unknown_error',
      status: status ?? 500,
      retryable: true,
      cause,
    });
    this.name = 'APIError';
  }
}

/**
 * Timeout error
 */
export class TimeoutError extends OpenAIError {
  constructor(message: string, cause?: unknown) {
    super(message, {
      type: 'timeout_error',
      code: 'timeout',
      retryable: true,
      cause,
    });
    this.name = 'TimeoutError';
  }
}

/**
 * Network error
 */
export class NetworkError extends OpenAIError {
  constructor(message: string, cause?: unknown) {
    super(message, {
      type: 'network_error',
      code: 'network_error',
      retryable: true,
      cause,
    });
    this.name = 'NetworkError';
  }
}

/**
 * Helper to parse API error response
 */
export function parseErrorResponse(response: unknown): ExtendedError {
  const parsed = APIErrorResponseSchema.safeParse(response);
  if (parsed.success) {
    return {
      message: parsed.data.error.message,
      type: parsed.data.error.type,
      code: parsed.data.error.code,
      param: parsed.data.error.param,
    };
  }

  // Fallback for non-standard error formats
  if (typeof response === 'object' && response !== null && 'error' in response) {
    const error = response.error;
    if (typeof error === 'object' && error !== null && 'message' in error) {
      return {
        message: String(error.message),
        type: 'api_error',
        code: 'unknown_error',
      };
    }
  }

  return {
    message: 'Unknown error occurred',
    type: 'api_error',
    code: 'unknown_error',
  };
}

/**
 * Helper to create appropriate error from response
 */
export function createErrorFromResponse(
  status: number,
  data: unknown,
  headers?: Record<string, string>,
): OpenAIError {
  const errorData = parseErrorResponse(data);
  const requestId = headers?.['x-request-id'];

  // Extract rate limit info from headers
  const rateLimit: RateLimitInfo | undefined = headers
    ? {
        limit: headers['x-ratelimit-limit-requests']
          ? Number(headers['x-ratelimit-limit-requests'])
          : undefined,
        remaining: headers['x-ratelimit-remaining-requests']
          ? Number(headers['x-ratelimit-remaining-requests'])
          : undefined,
        reset: headers['x-ratelimit-reset-requests']
          ? Number(headers['x-ratelimit-reset-requests'])
          : undefined,
      }
    : undefined;

  const retryAfter = headers?.['retry-after'] ? Number(headers['retry-after']) * 1000 : undefined;

  const message = errorData.message;

  switch (status) {
    case 400:
      if (errorData.code === 'context_length_exceeded') {
        return new ContextLengthError(message);
      }
      if (errorData.code === 'content_policy_violation') {
        return new ContentPolicyError(message);
      }
      return new InvalidRequestError(message, errorData.param);
    case 401:
      return new AuthenticationError(message);
    case 403:
      return new PermissionError(message);
    case 404:
      return new NotFoundError(message);
    case 429:
      return new RateLimitError(message, { retryAfter, rateLimit });
    case 500:
    case 502:
    case 503:
    case 504:
      return new APIError(message, status);
    default:
      return new OpenAIError(message, {
        type: errorData.type,
        code: errorData.code,
        param: errorData.param,
        status,
        headers,
        requestId,
        retryable: status >= 500,
      });
  }
}
