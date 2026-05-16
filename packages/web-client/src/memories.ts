/**
 * `/memories/*` 客户端：用户长期记忆 CRUD + 抽取 + 全局设置。
 *
 * 用于 Settings → 记忆管理面板。响应保留 `unknown`，由调用方收敛实际形状。
 */

import { authHeader, expectJson, HttpError, jsonAuthHeaders, readJsonErrorData } from './http.js';

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

export function createMemoriesClient(baseUrl: string): MemoriesClient {
  return {
    async list(token, options) {
      const response = await fetch(`${baseUrl}/memories`, {
        headers: authHeader(token),
        signal: options?.signal,
      });
      return expectJson<unknown>(response, 'memories.list');
    },

    async getStats(token, options) {
      const response = await fetch(`${baseUrl}/memories/stats`, {
        headers: authHeader(token),
        signal: options?.signal,
      });
      return expectJson<unknown>(response, 'memories.getStats');
    },

    async getSettings(token, options) {
      const response = await fetch(`${baseUrl}/memories/settings`, {
        headers: authHeader(token),
        signal: options?.signal,
      });
      return expectJson<unknown>(response, 'memories.getSettings');
    },

    async putSettings(token, payload) {
      const response = await fetch(`${baseUrl}/memories/settings`, {
        method: 'PUT',
        headers: jsonAuthHeaders(token),
        body: JSON.stringify(payload),
      });
      return expectJson<unknown>(response, 'memories.putSettings');
    },

    async create(token, payload) {
      const response = await fetch(`${baseUrl}/memories`, {
        method: 'POST',
        headers: jsonAuthHeaders(token),
        body: JSON.stringify(payload),
      });
      return expectJson<unknown>(response, 'memories.create');
    },

    async update(token, memoryId, payload) {
      const response = await fetch(`${baseUrl}/memories/${encodeURIComponent(memoryId)}`, {
        method: 'PUT',
        headers: jsonAuthHeaders(token),
        body: JSON.stringify(payload),
      });
      return expectJson<unknown>(response, 'memories.update');
    },

    async remove(token, memoryId) {
      const response = await fetch(`${baseUrl}/memories/${encodeURIComponent(memoryId)}`, {
        method: 'DELETE',
        headers: authHeader(token),
      });
      if (!response.ok) {
        const data = await readJsonErrorData<{ error?: string }>(response);
        throw new HttpError(
          data?.error ?? `memories.remove failed: ${response.status}`,
          response.status,
          data,
        );
      }
    },

    async extract(token, payload) {
      const response = await fetch(`${baseUrl}/memories/extract`, {
        method: 'POST',
        headers: jsonAuthHeaders(token),
        body: JSON.stringify(payload),
      });
      return expectJson<unknown>(response, 'memories.extract');
    },
  };
}
