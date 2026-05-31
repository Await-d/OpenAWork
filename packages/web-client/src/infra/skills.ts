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
  extractJsonErrorMessage,
  HttpError,
  isGenericFetchErrorMessage,
  jsonAuthHeaders,
  readJsonErrorData,
  type JsonErrorData,
  withQuery,
  fetchWithTimeout,
} from '../gateway/http.js';

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

function buildSkillsActionErrorMessage(
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
    return `目标技能资源不存在，无法${actionLabel}。`;
  }
  if (status === 409) {
    return `当前状态不允许${actionLabel}。`;
  }
  return `${actionLabel}失败（HTTP ${status}）。`;
}

function normalizeSkillsError(actionLabel: string, error: unknown): Error {
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
    if (message.length > 0 && !isGenericFetchErrorMessage(message)) {
      return error;
    }
  }
  return new Error(`网络异常，${actionLabel}失败。`);
}

async function performSkillsRequest<T>(input: {
  actionLabel: string;
  parseJson?: boolean;
  request: () => Promise<Response>;
}): Promise<T> {
  try {
    const response = await input.request();
    if (!response.ok) {
      const data = await readJsonErrorData<JsonErrorData>(response);
      throw new HttpError(
        buildSkillsActionErrorMessage(input.actionLabel, response.status, data),
        response.status,
        data,
      );
    }
    if (input.parseJson === false || response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  } catch (error) {
    throw normalizeSkillsError(input.actionLabel, error);
  }
}

export function createSkillsClient(baseUrl: string): SkillsClient {
  return {
    async search(token, options) {
      const params = new URLSearchParams();
      if (options?.q) params.set('q', options.q);
      if (options?.category) params.set('category', options.category);
      if (options?.limit !== undefined) params.set('limit', String(options.limit));
      if (options?.offset !== undefined) params.set('offset', String(options.offset));
      return performSkillsRequest<unknown>({
        actionLabel: '搜索技能',
        request: () =>
          fetchWithTimeout(withQuery(`${baseUrl}/skills/search`, params), {
            headers: authHeader(token),
            signal: options?.signal,
          }),
      });
    },

    async getDetail(token, skillId, options) {
      return performSkillsRequest<unknown>({
        actionLabel: '读取技能详情',
        request: () =>
          fetchWithTimeout(`${baseUrl}/skills/${encodeURIComponent(skillId)}`, {
            headers: authHeader(token),
            signal: options?.signal,
          }),
      });
    },

    async listInstalled(token, options) {
      return performSkillsRequest<unknown>({
        actionLabel: '读取已安装技能',
        request: () =>
          fetchWithTimeout(`${baseUrl}/skills/installed`, {
            headers: authHeader(token),
            signal: options?.signal,
          }),
      });
    },

    async install(token, input) {
      await performSkillsRequest({
        actionLabel: '安装技能',
        parseJson: false,
        request: () =>
          fetchWithTimeout(`${baseUrl}/skills/install`, {
            timeoutMs: 120_000,
            method: 'POST',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify(input),
          }),
      });
    },

    async uninstall(token, skillId) {
      await performSkillsRequest({
        actionLabel: '卸载技能',
        parseJson: false,
        request: () =>
          fetchWithTimeout(`${baseUrl}/skills/installed/${encodeURIComponent(skillId)}`, {
            timeoutMs: 120_000,
            method: 'DELETE',
            headers: authHeader(token),
          }),
      });
    },

    async setEnabled(token, skillId, enabled) {
      await performSkillsRequest({
        actionLabel: enabled ? '启用技能' : '停用技能',
        parseJson: false,
        request: () =>
          fetchWithTimeout(`${baseUrl}/skills/installed/${encodeURIComponent(skillId)}/enable`, {
            timeoutMs: 120_000,
            method: 'PATCH',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify({ enabled }),
          }),
      });
    },

    async discoverLocal(token, options) {
      return performSkillsRequest<unknown>({
        actionLabel: '发现本地技能',
        request: () =>
          fetchWithTimeout(`${baseUrl}/skills/local/discover`, {
            headers: authHeader(token),
            signal: options?.signal,
          }),
      });
    },

    async installLocal(token, dirPath) {
      await performSkillsRequest({
        actionLabel: '安装本地技能',
        parseJson: false,
        request: () =>
          fetchWithTimeout(`${baseUrl}/skills/local/install`, {
            timeoutMs: 120_000,
            method: 'POST',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify({ dirPath }),
          }),
      });
    },

    async resyncSystem(token) {
      return performSkillsRequest<unknown>({
        actionLabel: '同步系统技能',
        request: () =>
          fetchWithTimeout(`${baseUrl}/skills/system/resync`, {
            timeoutMs: 120_000,
            method: 'POST',
            headers: authHeader(token),
          }),
      });
    },

    async listRegistrySources(token, options) {
      const response = await fetchWithTimeout(`${baseUrl}/skills/registry-sources`, {
        headers: authHeader(token),
        signal: options?.signal,
      });
      if (!response.ok) {
        return { sources: [] };
      }
      return response.json();
    },

    async syncRegistrySources(token, sourceIds) {
      await performSkillsRequest({
        actionLabel: '同步技能注册源',
        parseJson: false,
        request: () =>
          fetchWithTimeout(`${baseUrl}/skills/registry-sources/sync`, {
            timeoutMs: 120_000,
            method: 'POST',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify(sourceIds && sourceIds.length > 0 ? { sourceIds } : {}),
          }),
      });
    },

    async addRegistrySource(token, input) {
      await performSkillsRequest({
        actionLabel: '添加技能注册源',
        parseJson: false,
        request: () =>
          fetchWithTimeout(`${baseUrl}/skills/registry-sources`, {
            method: 'POST',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify(input),
          }),
      });
    },

    async removeRegistrySource(token, id) {
      await performSkillsRequest({
        actionLabel: '删除技能注册源',
        parseJson: false,
        request: () =>
          fetchWithTimeout(`${baseUrl}/skills/registry-sources/${encodeURIComponent(id)}`, {
            method: 'DELETE',
            headers: authHeader(token),
          }),
      });
    },

    async setRegistrySourceEnabled(token, id, enabled) {
      await performSkillsRequest({
        actionLabel: enabled ? '启用技能注册源' : '停用技能注册源',
        parseJson: false,
        request: () =>
          fetchWithTimeout(`${baseUrl}/skills/registry-sources/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify({ enabled }),
          }),
      });
    },

    async getSelection(token, options) {
      const params = new URLSearchParams();
      if (options?.workspacePath && options.workspacePath.trim().length > 0) {
        params.set('workspacePath', options.workspacePath.trim());
      }
      if (options?.sessionId && options.sessionId.trim().length > 0) {
        params.set('sessionId', options.sessionId.trim());
      }
      return performSkillsRequest<unknown>({
        actionLabel: '读取技能选择集',
        request: () =>
          fetchWithTimeout(withQuery(`${baseUrl}/skills/selection`, params), {
            headers: authHeader(token),
            signal: options?.signal,
          }),
      });
    },

    async putSelection(token, input) {
      return performSkillsRequest<unknown>({
        actionLabel: '保存技能选择集',
        request: () =>
          fetchWithTimeout(`${baseUrl}/skills/selection`, {
            method: 'PUT',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify(input),
          }),
      });
    },

    async getSessionSelection(token, sessionId, options) {
      return performSkillsRequest<unknown>({
        actionLabel: '读取会话技能覆盖',
        request: () =>
          fetchWithTimeout(`${baseUrl}/skills/selection/session/${encodeURIComponent(sessionId)}`, {
            headers: authHeader(token),
            signal: options?.signal,
          }),
      });
    },

    async patchSessionSelection(token, sessionId, payload) {
      return performSkillsRequest<unknown>({
        actionLabel: '保存会话技能覆盖',
        request: () =>
          fetchWithTimeout(`${baseUrl}/skills/selection/session/${encodeURIComponent(sessionId)}`, {
            method: 'PATCH',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify(payload),
          }),
      });
    },

    async removeSessionSelection(token, sessionId) {
      const response = await fetchWithTimeout(
        `${baseUrl}/skills/selection/session/${encodeURIComponent(sessionId)}`,
        { method: 'DELETE', headers: authHeader(token) },
      );
      if (!response.ok && response.status !== 404) {
        const data = await readJsonErrorData<JsonErrorData>(response);
        throw new HttpError(
          buildSkillsActionErrorMessage('删除会话技能覆盖', response.status, data),
          response.status,
          data,
        );
      }
    },

    async recommend(token, payload) {
      return performSkillsRequest<unknown>({
        actionLabel: '生成技能推荐',
        request: () =>
          fetchWithTimeout(`${baseUrl}/skills/recommend`, {
            timeoutMs: 120_000,
            method: 'POST',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify(payload),
          }),
      });
    },

    async getLatestRecommendation(token, options) {
      const params = new URLSearchParams();
      if (options?.workspacePath && options.workspacePath.trim().length > 0) {
        params.set('workspacePath', options.workspacePath.trim());
      }
      return performSkillsRequest<unknown>({
        actionLabel: '读取最新技能推荐',
        request: () =>
          fetchWithTimeout(withQuery(`${baseUrl}/skills/recommend/latest`, params), {
            headers: authHeader(token),
            signal: options?.signal,
          }),
      });
    },

    async applyRecommendation(token, recommendationId, payload) {
      return performSkillsRequest<unknown>({
        actionLabel: '应用技能推荐',
        request: () =>
          fetchWithTimeout(
            `${baseUrl}/skills/recommend/${encodeURIComponent(recommendationId)}/apply`,
            {
              timeoutMs: 120_000,
              method: 'POST',
              headers: jsonAuthHeaders(token),
              body: payload !== undefined ? JSON.stringify(payload) : undefined,
            },
          ),
      });
    },
  };
}
