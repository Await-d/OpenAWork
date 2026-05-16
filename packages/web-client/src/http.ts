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
