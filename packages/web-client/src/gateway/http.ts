/**
 * 共享 HTTP 辅助工具，供 web-client 各资源域客户端复用。
 *
 * 设计原则：
 * - 不引入第三方依赖，仅依赖标准 `fetch` / `URL` / `URLSearchParams`。
 * - 对错误统一使用 `HttpError`，携带 status 与可选 payload，便于上层做差异化处理。
 * - 鉴权 header / JSON header / 查询串构造保持纯函数风格，便于在测试中拼装请求。
 */

/** 网关回写 requestId 的响应头。与服务端 error-handler / request_workflow_logs 同源。 */
const REQUEST_ID_HEADER = 'x-request-id';

export class HttpError<T = unknown> extends Error {
  /**
   * 网关侧 requestId。
   *
   * 这是排障闭环的关键：用户报障时把这个 ID 交给我们，就能直接在网关日志与
   * `request_workflow_logs` 表里定位到那一次请求。没有它，客户端只知道
   * 「500」这个数字，无法区分是哪一次调用。
   */
  readonly requestId?: string;
  /** 服务端返回的可读原因（从 `data.message` / `error` / `message` 提取）。 */
  readonly serverMessage?: string;

  constructor(
    message: string,
    public readonly status: number,
    public readonly data?: T,
    context?: { requestId?: string; serverMessage?: string },
  ) {
    super(message);
    this.name = 'HttpError';
    if (context?.requestId) this.requestId = context.requestId;
    if (context?.serverMessage) this.serverMessage = context.serverMessage;
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
  retryable?: boolean;
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

/** 读取网关回写的 requestId（缺失返回 undefined，不视为错误）。 */
export function readRequestId(response: Response): string | undefined {
  const raw = response.headers?.get?.(REQUEST_ID_HEADER);
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
}

/**
 * 构造 HttpError：统一补齐 requestId 与服务端可读原因。
 *
 * 注意 `message` 保持 `${label} failed: ${status}` 原样——上层有若干处依赖该格式做
 * 分支判断，改写会波及行为。可读原因放在 `serverMessage` 上按需取用。
 */
function buildHttpError<T>(label: string, response: Response, data: T | undefined): HttpError<T> {
  const requestId = readRequestId(response);
  const serverMessage = extractJsonErrorMessage(data as JsonErrorData | undefined);
  return new HttpError(`${label} failed: ${response.status}`, response.status, data, {
    ...(requestId ? { requestId } : {}),
    ...(serverMessage ? { serverMessage } : {}),
  });
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
  throw buildHttpError(label, response, await readJsonErrorData(response));
}

/** Default wall-clock ceiling for gateway reads (ms). */
export const DEFAULT_FETCH_TIMEOUT_MS = 20_000;

/**
 * 生成「响应不是 JSON」的可执行提示。
 *
 * 前端拿到 `<!doctype html>` 的原因基本只有一个:请求没有落到网关,而是落到了托管
 * 前端的同源地址(dev server 的 SPA 兜底、反代 `try_files ... /index.html` 都会这么
 * 干),最常见的诱因是网关地址为空 —— `${baseUrl}/xxx` 会退化成相对路径。此时
 * `response.json()` 抛出的 `SyntaxError: Unexpected token '<'` 只说明「解析器看到了
 * 尖括号」,会把排障方向误导到「后端接口坏了」。
 */
export function describeNonJsonResponse(response: Response): string {
  const contentType = response.headers?.get?.('content-type') ?? '';
  if (contentType.includes('text/html')) {
    return '网关返回的是网页(HTML)而不是接口数据:请求可能没有打到 Gateway(常见原因是网关地址为空或指向了前端页面)。请在设置中确认 Gateway 地址。';
  }
  return `网关返回的内容不是可解析的 JSON(HTTP ${response.status})。`;
}

/**
 * 给 `response.json()` 套一层诊断:解析失败时抛出可执行文案,并把原始
 * `SyntaxError` 挂在 `cause` 上便于进一步定位。
 *
 * 之所以放在 `fetchWithTimeout` 这个唯一的传输汇聚点统一包装,而不是逐个调用点判断:
 * web-client 有二十多个资源域客户端各自直接 `response.json()`,逐个改既会漏、也会
 * 随着新增客户端持续腐化。这里只改写 response 实例自身的方法(不动其它属性与流),
 * 解析成功时与原生行为完全一致。
 */
function withJsonDiagnostics(response: Response): Response {
  if (typeof response?.json !== 'function') {
    return response;
  }
  const boundJson = response.json.bind(response);
  try {
    Object.defineProperty(response, 'json', {
      configurable: true,
      writable: true,
      value: async (): Promise<unknown> => {
        try {
          return await boundJson();
        } catch (error) {
          throw new Error(describeNonJsonResponse(response), { cause: error });
        }
      },
    });
  } catch {
    // 不可扩展的 Response(只读替身、被冻结的测试桩)保持原样透传:诊断是增强项,
    // 不应让请求本身失败。
  }
  return response;
}

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
  // 超时 reason 刻意包含 "aborted"：既让日志能区分「超时」与「调用方主动取消」，
  // 又能被 isGenericFetchErrorMessage 的 /\babort/i 命中，从而维持既有的
  // 「超时 → 折叠为友好文案」行为不变。
  const timer = setTimeout(() => {
    if (typeof controller.abort === 'function') {
      controller.abort(new Error(`Request aborted: gateway timeout after ${timeoutMs}ms`));
      return;
    }
    controller.abort();
  }, timeoutMs);
  try {
    return withJsonDiagnostics(await fetch(input, { ...init, signal: controller.signal }));
  } finally {
    clearTimeout(timer);
    if (callerSignal) {
      callerSignal.removeEventListener('abort', onAbort);
    }
  }
}
