import { HttpError } from '@openAwork/web-client';
import type { JsonErrorData } from '@openAwork/web-client';

export interface UserVisibleErrorDescriptor {
  readonly code?: string;
  readonly message: string;
  readonly retryable: boolean;
}

interface UserVisibleErrorPayload extends JsonErrorData {
  readonly retryable?: boolean;
}

const DEFAULT_SUSPICIOUS_ERROR_PATTERNS = [
  /https?:\/\//iu,
  /(?:^|[\s(])(?:select|insert|update|delete|drop|sqlite|postgres|mysql|exception|stack|trace)(?:[\s):]|$)/iu,
  /[A-Za-z]:\\/u,
  /(?:\/|\\)[\w./-]+/u,
  /\b(?:token|api[_-]?key|secret|authorization|cookie)\b/iu,
  /\bat\s+\S+:\d+:\d+/iu,
] as const;

function isRetryableHttpStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export function isAbortLikeError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

export function isSafeUserVisibleErrorMessage(
  message: string,
  extraSuspiciousPatterns: readonly RegExp[] = [],
): boolean {
  const normalized = message.trim();
  if (normalized.length === 0 || normalized.length > 120 || /[\r\n]/u.test(normalized)) {
    return false;
  }

  return ![...DEFAULT_SUSPICIOUS_ERROR_PATTERNS, ...extraSuspiciousPatterns].some((pattern) =>
    pattern.test(normalized),
  );
}

export function getUserVisibleErrorDescriptor(
  error: unknown,
  fallbackMessage: string,
  extraSuspiciousPatterns: readonly RegExp[] = [],
): UserVisibleErrorDescriptor {
  let retryable = isAbortLikeError(error);
  let code: string | undefined;

  if (error instanceof HttpError) {
    const data = error.data as UserVisibleErrorPayload | undefined;
    retryable =
      typeof data?.retryable === 'boolean' ? data.retryable : isRetryableHttpStatus(error.status);
    code = typeof data?.code === 'string' && data.code.length > 0 ? data.code : undefined;
  }

  if (
    error instanceof Error &&
    isSafeUserVisibleErrorMessage(error.message, extraSuspiciousPatterns)
  ) {
    return {
      ...(code ? { code } : {}),
      message: error.message.trim(),
      retryable,
    };
  }

  return {
    ...(code ? { code } : {}),
    message: fallbackMessage,
    retryable,
  };
}

export function getUserVisibleErrorMessage(
  error: unknown,
  fallbackMessage: string,
  extraSuspiciousPatterns: readonly RegExp[] = [],
): string {
  return getUserVisibleErrorDescriptor(error, fallbackMessage, extraSuspiciousPatterns).message;
}
