import { LLMError, TransportReason } from '../../schema/index.js';

// Only expose diagnostic identifiers, never arbitrary HTTP error objects, URLs or headers.
const diagnosticCode = (error: unknown, seen = new Set<unknown>()): string | undefined => {
  if (!error || typeof error !== 'object' || seen.has(error) || seen.size >= 6) return undefined;
  seen.add(error);
  if (
    'code' in error &&
    typeof error.code === 'string' &&
    /^[A-Z][A-Z0-9_]{1,63}$/.test(error.code)
  ) {
    return error.code;
  }
  if ('name' in error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return error.name;
  }
  const nested = 'cause' in error ? diagnosticCode(error.cause, seen) : undefined;
  return nested ?? ('reason' in error ? diagnosticCode(error.reason, seen) : undefined);
};

export function httpStreamError(route: string, error: unknown): LLMError {
  if (error instanceof LLMError) return error;
  const code = diagnosticCode(error);
  return new LLMError({
    module: 'ProviderShared',
    method: 'stream',
    reason: new TransportReason({
      kind: code ?? 'StreamReadError',
      message: `Failed to read ${route} stream: HTTP 响应流读取失败${code ? ` (${code})` : ''}；本轮输出可能不完整，请检查上游连接或超时。`,
    }),
  });
}
