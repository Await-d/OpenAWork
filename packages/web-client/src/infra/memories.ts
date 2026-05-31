/**
 * `/memories/*` 客户端：用户长期记忆 CRUD + 抽取 + 全局设置。
 *
 * 用于 Settings → 记忆管理面板。响应保留 `unknown`，由调用方收敛实际形状。
 */

import {
  authHeader,
  extractJsonErrorMessage,
  HttpError,
  isGenericFetchErrorMessage,
  jsonAuthHeaders,
  readJsonErrorData,
  type JsonErrorData,
  fetchWithTimeout,
} from '../gateway/http.js';

export interface MemoriesClient {
  list(token: string, options?: { signal?: AbortSignal }): Promise<unknown>;
  getStats(token: string, options?: { signal?: AbortSignal }): Promise<unknown>;
  getSettings(token: string, options?: { signal?: AbortSignal }): Promise<unknown>;
  putSettings(token: string, payload: unknown): Promise<unknown>;
  create(token: string, payload: unknown): Promise<unknown>;
  update(token: string, memoryId: string, payload: unknown): Promise<unknown>;
  remove(token: string, memoryId: string): Promise<void>;
  extract(token: string, payload: unknown): Promise<unknown>;
}

function buildMemoriesActionErrorMessage(
  actionLabel: string,
  status: number,
  data: JsonErrorData | undefined,
): string {
  const extracted = extractJsonErrorMessage(data);
  if (extracted) {
    return extracted;
  }
  if (status === 401 || status === 403) {
    return `认证失效或当前账号无权${actionLabel}。`;
  }
  if (status === 404) {
    return `目标记忆资源不存在，无法${actionLabel}。`;
  }
  if (status === 409) {
    return `当前状态不允许${actionLabel}。`;
  }
  return `${actionLabel}失败（HTTP ${status}）。`;
}

function isGenericMemoriesNetworkErrorMessage(message: string): boolean {
  return isGenericFetchErrorMessage(message);
}

function normalizeMemoriesError(actionLabel: string, error: unknown): Error {
  if (error instanceof HttpError) {
    const extracted = extractJsonErrorMessage(
      (error.data ?? undefined) as JsonErrorData | undefined,
    );
    if (extracted) {
      return new HttpError(extracted, error.status, error.data);
    }
    return error;
  }
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message.length > 0 && !isGenericMemoriesNetworkErrorMessage(message)) {
      return error;
    }
  }
  return new Error(`网络异常，${actionLabel}失败。`);
}

async function performMemoriesRequest<T>(input: {
  actionLabel: string;
  parseJson?: boolean;
  request: () => Promise<Response>;
}): Promise<T> {
  try {
    const response = await input.request();
    if (!response.ok) {
      const data = await readJsonErrorData<JsonErrorData>(response);
      throw new HttpError(
        buildMemoriesActionErrorMessage(input.actionLabel, response.status, data),
        response.status,
        data,
      );
    }
    if (input.parseJson === false || response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  } catch (error) {
    throw normalizeMemoriesError(input.actionLabel, error);
  }
}

export function createMemoriesClient(baseUrl: string): MemoriesClient {
  return {
    async list(token, options) {
      return performMemoriesRequest<unknown>({
        actionLabel: '读取记忆列表',
        request: () =>
          fetchWithTimeout(`${baseUrl}/memories`, {
            headers: authHeader(token),
            signal: options?.signal,
          }),
      });
    },

    async getStats(token, options) {
      return performMemoriesRequest<unknown>({
        actionLabel: '读取记忆统计',
        request: () =>
          fetchWithTimeout(`${baseUrl}/memories/stats`, {
            headers: authHeader(token),
            signal: options?.signal,
          }),
      });
    },

    async getSettings(token, options) {
      return performMemoriesRequest<unknown>({
        actionLabel: '读取记忆设置',
        request: () =>
          fetchWithTimeout(`${baseUrl}/memories/settings`, {
            headers: authHeader(token),
            signal: options?.signal,
          }),
      });
    },

    async putSettings(token, payload) {
      return performMemoriesRequest<unknown>({
        actionLabel: '保存记忆设置',
        request: () =>
          fetchWithTimeout(`${baseUrl}/memories/settings`, {
            method: 'PUT',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify(payload),
          }),
      });
    },

    async create(token, payload) {
      return performMemoriesRequest<unknown>({
        actionLabel: '创建记忆',
        request: () =>
          fetchWithTimeout(`${baseUrl}/memories`, {
            method: 'POST',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify(payload),
          }),
      });
    },

    async update(token, memoryId, payload) {
      return performMemoriesRequest<unknown>({
        actionLabel: '更新记忆',
        request: () =>
          fetchWithTimeout(`${baseUrl}/memories/${encodeURIComponent(memoryId)}`, {
            method: 'PUT',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify(payload),
          }),
      });
    },

    async remove(token, memoryId) {
      await performMemoriesRequest({
        actionLabel: '删除记忆',
        parseJson: false,
        request: () =>
          fetchWithTimeout(`${baseUrl}/memories/${encodeURIComponent(memoryId)}`, {
            method: 'DELETE',
            headers: authHeader(token),
          }),
      });
    },

    async extract(token, payload) {
      return performMemoriesRequest<unknown>({
        actionLabel: '抽取记忆',
        request: () =>
          fetchWithTimeout(`${baseUrl}/memories/extract`, {
            timeoutMs: 120_000,
            method: 'POST',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify(payload),
          }),
      });
    },
  };
}
