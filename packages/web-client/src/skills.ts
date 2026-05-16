/**
 * `/skills/*` 客户端：技能商城浏览、本地工作区扫描、安装 / 卸载 / 启停、注册源管理、
 * 推荐与选择集（workspace selection）。
 *
 * `apps/web` 的 SkillsPage / SkillSelectionPage / SkillRecommendationDrawer 都会用到，
 * 把它们的 fetch 抽象出来后，desktop / mobile 复用更容易。
 *
 * 同样选择把绝大多数响应作为 `unknown` 透传——`@openAwork/shared-ui` 已有 `MarketSkill`
 * 等类型，避免在客户端层重复定义 schema。
 */

import {
  authHeader,
  expectJson,
  HttpError,
  jsonAuthHeaders,
  readJsonErrorData,
  withQuery,
} from './http.js';

export interface SkillsClient {
  search(
    token: string,
    options?: {
      q?: string;
      category?: string;
      limit?: number;
      offset?: number;
      signal?: AbortSignal;
    },
  ): Promise<unknown>;
  getDetail(token: string, skillId: string, options?: { signal?: AbortSignal }): Promise<unknown>;
  listInstalled(token: string, options?: { signal?: AbortSignal }): Promise<unknown>;
  install(token: string, input: { skillId: string; sourceId?: string }): Promise<void>;
  uninstall(token: string, skillId: string): Promise<void>;
  setEnabled(token: string, skillId: string, enabled: boolean): Promise<void>;
  discoverLocal(token: string, options?: { signal?: AbortSignal }): Promise<unknown>;
  installLocal(token: string, dirPath: string): Promise<void>;
  resyncSystem(token: string): Promise<unknown>;
  listRegistrySources(token: string, options?: { signal?: AbortSignal }): Promise<unknown>;
  syncRegistrySources(token: string, sourceIds?: string[]): Promise<void>;
  addRegistrySource(token: string, input: { name: string; url: string }): Promise<void>;
  removeRegistrySource(token: string, id: string): Promise<void>;
  setRegistrySourceEnabled(token: string, id: string, enabled: boolean): Promise<void>;
  // Selection (workspace + 可选 sessionId 维度)
  getSelection(
    token: string,
    options?: { workspacePath?: string; sessionId?: string; signal?: AbortSignal },
  ): Promise<unknown>;
  putSelection(
    token: string,
    input: { workspacePath?: string | null; items: unknown[] },
  ): Promise<unknown>;
  getSessionSelection(
    token: string,
    sessionId: string,
    options?: { signal?: AbortSignal },
  ): Promise<unknown>;
  patchSessionSelection(token: string, sessionId: string, payload: unknown): Promise<unknown>;
  removeSessionSelection(token: string, sessionId: string): Promise<void>;
  // 推荐
  recommend(token: string, payload: unknown): Promise<unknown>;
  getLatestRecommendation(
    token: string,
    options?: { workspacePath?: string; signal?: AbortSignal },
  ): Promise<unknown>;
  applyRecommendation(token: string, recommendationId: string, payload?: unknown): Promise<unknown>;
}

async function readSkillError(response: Response, fallback: string): Promise<HttpError> {
  const data = await readJsonErrorData<{ error?: string }>(response);
  return new HttpError(data?.error ?? fallback, response.status, data);
}

export function createSkillsClient(baseUrl: string): SkillsClient {
  return {
    async search(token, options) {
      const params = new URLSearchParams();
      if (options?.q) params.set('q', options.q);
      if (options?.category) params.set('category', options.category);
      if (options?.limit !== undefined) params.set('limit', String(options.limit));
      if (options?.offset !== undefined) params.set('offset', String(options.offset));
      const response = await fetch(withQuery(`${baseUrl}/skills/search`, params), {
        headers: authHeader(token),
        signal: options?.signal,
      });
      if (!response.ok) {
        throw await readSkillError(response, `skills.search failed: ${response.status}`);
      }
      return response.json();
    },

    async getDetail(token, skillId, options) {
      const response = await fetch(`${baseUrl}/skills/${encodeURIComponent(skillId)}`, {
        headers: authHeader(token),
        signal: options?.signal,
      });
      return expectJson<unknown>(response, 'skills.getDetail');
    },

    async listInstalled(token, options) {
      const response = await fetch(`${baseUrl}/skills/installed`, {
        headers: authHeader(token),
        signal: options?.signal,
      });
      return expectJson<unknown>(response, 'skills.listInstalled');
    },

    async install(token, input) {
      const response = await fetch(`${baseUrl}/skills/install`, {
        method: 'POST',
        headers: jsonAuthHeaders(token),
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        throw await readSkillError(response, `Install failed: ${response.status}`);
      }
    },

    async uninstall(token, skillId) {
      const response = await fetch(`${baseUrl}/skills/installed/${encodeURIComponent(skillId)}`, {
        method: 'DELETE',
        headers: authHeader(token),
      });
      if (!response.ok) {
        throw await readSkillError(response, `Uninstall failed: ${response.status}`);
      }
    },

    async setEnabled(token, skillId, enabled) {
      const response = await fetch(
        `${baseUrl}/skills/installed/${encodeURIComponent(skillId)}/enable`,
        {
          method: 'PATCH',
          headers: jsonAuthHeaders(token),
          body: JSON.stringify({ enabled }),
        },
      );
      if (!response.ok) {
        throw await readSkillError(response, `Toggle failed: ${response.status}`);
      }
    },

    async discoverLocal(token, options) {
      const response = await fetch(`${baseUrl}/skills/local/discover`, {
        headers: authHeader(token),
        signal: options?.signal,
      });
      return expectJson<unknown>(response, 'skills.discoverLocal');
    },

    async installLocal(token, dirPath) {
      const response = await fetch(`${baseUrl}/skills/local/install`, {
        method: 'POST',
        headers: jsonAuthHeaders(token),
        body: JSON.stringify({ dirPath }),
      });
      if (!response.ok) {
        throw await readSkillError(response, `Install failed: ${response.status}`);
      }
    },

    async resyncSystem(token) {
      const response = await fetch(`${baseUrl}/skills/system/resync`, {
        method: 'POST',
        headers: authHeader(token),
      });
      if (!response.ok) {
        throw await readSkillError(response, `Resync failed: ${response.status}`);
      }
      return response.json();
    },

    async listRegistrySources(token, options) {
      const response = await fetch(`${baseUrl}/skills/registry-sources`, {
        headers: authHeader(token),
        signal: options?.signal,
      });
      if (!response.ok) {
        return { sources: [] };
      }
      return response.json();
    },

    async syncRegistrySources(token, sourceIds) {
      const response = await fetch(`${baseUrl}/skills/registry-sources/sync`, {
        method: 'POST',
        headers: jsonAuthHeaders(token),
        body: JSON.stringify(sourceIds && sourceIds.length > 0 ? { sourceIds } : {}),
      });
      if (!response.ok) {
        throw await readSkillError(response, `Sync failed: ${response.status}`);
      }
    },

    async addRegistrySource(token, input) {
      await fetch(`${baseUrl}/skills/registry-sources`, {
        method: 'POST',
        headers: jsonAuthHeaders(token),
        body: JSON.stringify(input),
      });
    },

    async removeRegistrySource(token, id) {
      await fetch(`${baseUrl}/skills/registry-sources/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: authHeader(token),
      });
    },

    async setRegistrySourceEnabled(token, id, enabled) {
      const response = await fetch(`${baseUrl}/skills/registry-sources/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: jsonAuthHeaders(token),
        body: JSON.stringify({ enabled }),
      });
      if (!response.ok) {
        throw await readSkillError(response, `Toggle failed: ${response.status}`);
      }
    },

    async getSelection(token, options) {
      const params = new URLSearchParams();
      if (options?.workspacePath && options.workspacePath.trim().length > 0) {
        params.set('workspacePath', options.workspacePath.trim());
      }
      if (options?.sessionId && options.sessionId.trim().length > 0) {
        params.set('sessionId', options.sessionId.trim());
      }
      const response = await fetch(withQuery(`${baseUrl}/skills/selection`, params), {
        headers: authHeader(token),
        signal: options?.signal,
      });
      return expectJson<unknown>(response, 'skills.getSelection');
    },

    async putSelection(token, input) {
      const response = await fetch(`${baseUrl}/skills/selection`, {
        method: 'PUT',
        headers: jsonAuthHeaders(token),
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        throw await readSkillError(response, `Save selection failed: ${response.status}`);
      }
      return response.json();
    },

    async getSessionSelection(token, sessionId, options) {
      const response = await fetch(
        `${baseUrl}/skills/selection/session/${encodeURIComponent(sessionId)}`,
        { headers: authHeader(token), signal: options?.signal },
      );
      return expectJson<unknown>(response, 'skills.getSessionSelection');
    },

    async patchSessionSelection(token, sessionId, payload) {
      const response = await fetch(
        `${baseUrl}/skills/selection/session/${encodeURIComponent(sessionId)}`,
        {
          method: 'PATCH',
          headers: jsonAuthHeaders(token),
          body: JSON.stringify(payload),
        },
      );
      return expectJson<unknown>(response, 'skills.patchSessionSelection');
    },

    async removeSessionSelection(token, sessionId) {
      const response = await fetch(
        `${baseUrl}/skills/selection/session/${encodeURIComponent(sessionId)}`,
        { method: 'DELETE', headers: authHeader(token) },
      );
      if (!response.ok && response.status !== 404) {
        throw await readSkillError(response, `Delete session selection failed: ${response.status}`);
      }
    },

    async recommend(token, payload) {
      const response = await fetch(`${baseUrl}/skills/recommend`, {
        method: 'POST',
        headers: jsonAuthHeaders(token),
        body: JSON.stringify(payload),
      });
      return expectJson<unknown>(response, 'skills.recommend');
    },

    async getLatestRecommendation(token, options) {
      const params = new URLSearchParams();
      if (options?.workspacePath && options.workspacePath.trim().length > 0) {
        params.set('workspacePath', options.workspacePath.trim());
      }
      const response = await fetch(withQuery(`${baseUrl}/skills/recommend/latest`, params), {
        headers: authHeader(token),
        signal: options?.signal,
      });
      return expectJson<unknown>(response, 'skills.getLatestRecommendation');
    },

    async applyRecommendation(token, recommendationId, payload) {
      const response = await fetch(
        `${baseUrl}/skills/recommend/${encodeURIComponent(recommendationId)}/apply`,
        {
          method: 'POST',
          headers: jsonAuthHeaders(token),
          body: payload !== undefined ? JSON.stringify(payload) : undefined,
        },
      );
      return expectJson<unknown>(response, 'skills.applyRecommendation');
    },
  };
}
