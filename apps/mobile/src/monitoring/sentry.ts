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

export function initSentry(dsn: string, release?: string): void {
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

export function captureError(error: unknown, context?: Record<string, unknown>): void {
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
  Sentry.captureMessage(redact(message), level);
}

export function setUserContext(userId: string): void {
  Sentry.setUser({ id: userId });
}

export function clearUserContext(): void {
  Sentry.setUser(null);
}
