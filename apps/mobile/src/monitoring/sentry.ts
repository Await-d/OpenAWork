import * as Sentry from '@sentry/react-native';

const SENSITIVE_PATTERNS = [
  /Bearer\s+[\w.-]+/gi,
  /authorization["']?\s*:\s*["'][^"']+["']/gi,
  /api[_-]?key["']?\s*:\s*["'][^"']+["']/gi,
  /password["']?\s*:\s*["'][^"']+["']/gi,
  /token["']?\s*:\s*["'][^"']+["']/gi,
  /secret["']?\s*:\s*["'][^"']+["']/gi,
];

function redact(value: string): string {
  let result = value;
  for (const pattern of SENSITIVE_PATTERNS) {
    result = result.replace(pattern, '[REDACTED]');
  }
  return result;
}

let initialized = false;

export function initSentry(dsn: string, release?: string): void {
  if (initialized || !dsn) return;
  initialized = true;
  Sentry.init({
    dsn,
    release,
    environment: __DEV__ ? 'development' : 'production',
    tracesSampleRate: __DEV__ ? 0 : 0.2,
    beforeSend(event) {
      if (event.exception?.values) {
        for (const ex of event.exception.values) {
          if (ex.value) ex.value = redact(ex.value);
          if (ex.stacktrace?.frames) {
            for (const frame of ex.stacktrace.frames) {
              if (frame.vars) {
                for (const key of Object.keys(frame.vars)) {
                  frame.vars[key] = '[FILTERED]';
                }
              }
            }
          }
        }
      }
      if (event.request?.headers) {
        const headers = event.request.headers as Record<string, string>;
        if (headers['Authorization']) headers['Authorization'] = '[REDACTED]';
      }
      return event;
    },
  });
}

/**
 * 记录一条错误。
 *
 * `initialized` 守卫不可省：未配置 DSN 时 Sentry 未初始化，若仍调用
 * `captureException`，SDK 可能尝试向空地址发请求（每次崩溃一次），既无意义又耗电。
 * 本地记录不受影响——那部分在 `error-recorder` 中无条件完成。
 */
export function captureError(error: unknown, context?: Record<string, unknown>): void {
  if (!initialized) return;
  Sentry.withScope((scope) => {
    if (context) {
      const sanitized: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(context)) {
        sanitized[k] = typeof v === 'string' ? redact(v) : v;
      }
      scope.setExtras(sanitized);
    }
    Sentry.captureException(error);
  });
}

export function captureMessage(message: string, level: Sentry.SeverityLevel = 'info'): void {
  if (!initialized) return;
  Sentry.captureMessage(redact(message), level);
}

export function setUserContext(userId: string): void {
  if (!initialized) return;
  Sentry.setUser({ id: userId });
}

export function clearUserContext(): void {
  if (!initialized) return;
  Sentry.setUser(null);
}
