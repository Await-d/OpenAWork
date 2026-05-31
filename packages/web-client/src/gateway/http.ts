/**
 * 共享 HTTP 辅助工具，供 web-client 各资源域客户端复用。
 *
 * 设计原则：
 * - 不引入第三方依赖，仅依赖标准 `fetch` / `URL` / `URLSearchParams`。
 * - 对错误统一使用 `HttpError`，携带 status 与可选 payload，便于上层做差异化处理。
 * - 鉴权 header / JSON header / 查询串构造保持纯函数风格，便于在测试中拼装请求。
 */

export class HttpError<T = unknown> extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly data?: T,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export interface JsonErrorData {
  code?: string;
  data?: {
    message?: string;
  };
  error?: string;
  message?: string;
  name?: string;
}

export function extractJsonErrorMessage(data: JsonErrorData | undefined): string | null {
  if (typeof data?.error === 'string' && data.error.length > 0) {
    return data.error;
  }
  if (typeof data?.message === 'string' && data.message.length > 0) {
    return data.message;
  }
  if (typeof data?.data?.message === 'string' && data.data.message.length > 0) {
    return data.data.message;
  }
  return null;
}

export function isGenericFetchErrorMessage(message: string): boolean {
  // Abort-style messages: `fetchWithTimeout` aborts the request on its
  // wall-clock deadline, which surfaces as an `AbortError` whose message varies
  // by runtime ('The operation was aborted', 'This operation was aborted',
  // 'The user aborted a request.', 'signal is aborted without reason', or a
  // bare 'aborted'). Treat any of these as a generic network failure so the
  // ~30 resource clients collapse a timeout to their friendly localized
  // message instead of leaking the raw abort string to the UI. This path only
  // sees thrown transport errors — real backend failures arrive as structured
  // `HttpError`s and never reach here — so substring matching is safe.
  if (/\babort/i.test(message)) {
    return true;
  }
  return (
    message === 'Failed to fetch' ||
    message === 'Load failed' ||
    message === 'fetch failed' ||
    message === 'Network request failed' ||
    message === 'NetworkError when attempting to fetch resource.'
  );
}

export function authHeader(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

export function jsonAuthHeaders(token: string): { Authorization: string; 'Content-Type': string } {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

export async function readJsonErrorData<T>(response: Response): Promise<T | undefined> {
  const data = (await response.json().catch(() => null)) as T | null;
  return data ?? undefined;
}

/**
 * 把可选标量字段拼到 `URLSearchParams`。
 * - `undefined` / `null` 跳过。
 * - 布尔值映射到 `'1' | '0'`，与现有路由（`/file-changes?includeText=1`）保持一致。
 */
export function appendQueryParam(
  params: URLSearchParams,
  key: string,
  value: string | number | boolean | null | undefined,
): void {
  if (value === undefined || value === null) {
    return;
  }
  if (typeof value === 'boolean') {
    params.set(key, value ? '1' : '0');
    return;
  }
  params.set(key, String(value));
}

export function withQuery(url: string, params: URLSearchParams): string {
  const suffix = params.toString();
  return suffix ? `${url}?${suffix}` : url;
}

/**
 * 统一的"调用 → 解析 → 抛错"封装：
 * - 200/2xx：返回 `await response.json()` 强转 `T`。
 * - 204：返回 `undefined`，由上层按 `T = void` 使用。
 * - 其它：抛 `HttpError`，尝试携带响应 JSON 作为 `data`。
 */
export async function expectJson<T>(response: Response, label: string): Promise<T> {
  if (response.status === 204) {
    return undefined as T;
  }
  if (!response.ok) {
    throw new HttpError(
      `${label} failed: ${response.status}`,
      response.status,
      await readJsonErrorData(response),
    );
  }
  return (await response.json()) as T;
}

/**
 * 仅校验状态码、不解析 body 的版本，适合 204 / 仅副作用的 POST / DELETE。
 * 4xx/5xx 会抛 `HttpError`，但 204 视为成功。
 */
export async function expectOk(response: Response, label: string): Promise<void> {
  if (response.ok || response.status === 204) {
    return;
  }
  throw new HttpError(
    `${label} failed: ${response.status}`,
    response.status,
    await readJsonErrorData(response),
  );
}

/** Default wall-clock ceiling for gateway reads (ms). */
export const DEFAULT_FETCH_TIMEOUT_MS = 20_000;

/**
 * `fetch` with a wall-clock ceiling. The browser `fetch` has no built-in
 * timeout: a server that accepts the connection but never responds (half-open
 * socket, stalled proxy, overloaded gateway) leaves the promise pending
 * forever. For the team read models this is especially harmful — the polling
 * hooks (`use-team-workspace-snapshot-state`, runtime snapshot) only schedule a
 * retry when the request *settles*, so a hung request wedges the UI in
 * `loading` indefinitely with no recovery. This aborts after `timeoutMs` and
 * rejects with an `AbortError`, which the result readers already map to a
 * `{ ok: false, retryable: true }` outcome — so a timeout flows straight into
 * the existing exponential-backoff retry. A caller-supplied `signal` is merged:
 * whichever fires first wins. `timeoutMs <= 0` disables the ceiling.
 */
export async function fetchWithTimeout(
  input: string | URL,
  init?: RequestInit & { timeoutMs?: number },
): Promise<Response> {
  const timeoutMs = init?.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  if (!(timeoutMs > 0) || typeof AbortController === 'undefined') {
    return fetch(input, init);
  }
  const controller = new AbortController();
  const callerSignal = init?.signal ?? undefined;
  const onAbort = (): void => controller.abort();
  if (callerSignal) {
    if (callerSignal.aborted) {
      controller.abort();
    } else {
      callerSignal.addEventListener('abort', onAbort, { once: true });
    }
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    if (callerSignal) {
      callerSignal.removeEventListener('abort', onAbort);
    }
  }
}
