/**
 * `/plugins/*` 客户端：插件状态查询 + 安装 / 卸载 / 重载。
 *
 * 对应网关 v2 插件平台的只读投影与管理端点：
 *   GET    /plugins
 *   POST   /plugins/install            { path, force? }
 *   DELETE /plugins/:installId
 *   POST   /plugins/:installId/reload
 *
 * 安装来源是网关所在机器上的本地路径（目录或单文件）；npm / zip 安装
 * 尚未支持。
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

export interface GatewayPluginState {
  readonly status: 'active' | 'disabled' | 'failed';
  readonly error?: string;
}

export interface GatewayPluginInfo {
  readonly id: string;
  readonly source?: string;
  /** 安装目录名；仅当来源位于 `<dataDir>/plugins` 时存在。 */
  readonly installId?: string;
  readonly state: GatewayPluginState;
  readonly guarded: boolean;
}

export interface PluginListResponse {
  readonly plugins: GatewayPluginInfo[];
}

export interface PluginInstallResponse {
  readonly install: {
    readonly installId: string;
    readonly path: string;
    readonly entrypoint: string;
  };
  readonly plugin: { readonly id: string; readonly state: GatewayPluginState } | null;
}

export interface PluginReloadResponse {
  readonly reloaded: boolean;
  readonly error?: string;
}

export interface PluginMarketSource {
  readonly id: string;
  readonly name: string;
  readonly repo: string;
  readonly ref?: string;
  readonly enabled: boolean;
  readonly createdAt: string;
}

export interface PluginMarketEntry {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly version?: string;
  readonly author?: string;
  /** 仓库内路径；`''` 表示仓库根。 */
  readonly path: string;
  readonly sourceId: string;
  readonly sourceName: string;
  readonly repo: string;
  readonly ref?: string;
  readonly fallback: boolean;
}

export interface PluginMarketListing {
  readonly entries: PluginMarketEntry[];
  readonly failedSources: Array<{ readonly sourceId: string; readonly error: string }>;
}

export interface PluginMarketDetail {
  readonly entry: PluginMarketEntry;
  readonly readme?: string;
  readonly repoUrl: string;
}

export interface PluginGithubInstallResponse {
  readonly install: {
    readonly installId: string;
    readonly path: string;
    readonly entrypoint: string;
  };
  readonly source: { readonly repo: string; readonly ref?: string; readonly path: string };
  readonly plugin: { readonly id: string; readonly state: GatewayPluginState } | null;
}

export interface PluginsClient {
  list(token: string, options?: { signal?: AbortSignal }): Promise<GatewayPluginInfo[]>;
  install(
    token: string,
    payload: { path: string; force?: boolean },
  ): Promise<PluginInstallResponse>;
  remove(token: string, installId: string): Promise<void>;
  reload(token: string, installId: string): Promise<PluginReloadResponse>;
  /** 停用插件（保留安装；可用 enable 恢复）。 */
  disable(token: string, pluginId: string): Promise<void>;
  /** 重新启用被停用的插件。 */
  enable(token: string, pluginId: string): Promise<{ enabled: boolean; error?: string }>;
  /** 市场：GitHub 源列表。 */
  listMarketSources(token: string): Promise<PluginMarketSource[]>;
  /** 市场：添加 / 更新 GitHub 源（`owner/repo` 或 `owner/repo@ref`）。 */
  addMarketSource(
    token: string,
    payload: { repo: string; ref?: string; name?: string },
  ): Promise<PluginMarketSource>;
  /** 市场：移除源。 */
  removeMarketSource(token: string, sourceId: string): Promise<void>;
  /** 市场：聚合清单（可按关键字过滤）。 */
  searchMarket(
    token: string,
    options?: { query?: string; signal?: AbortSignal },
  ): Promise<PluginMarketListing>;
  /** 市场：条目详情（含 README）。 */
  getMarketEntry(
    token: string,
    query: { sourceId: string; name: string },
  ): Promise<PluginMarketDetail>;
  /** 市场：从 GitHub zipball 一键安装。 */
  installFromGithub(
    token: string,
    payload: { repo: string; path?: string; ref?: string; name?: string; force?: boolean },
  ): Promise<PluginGithubInstallResponse>;
}

function buildPluginsActionErrorMessage(
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
    return `目标插件不存在，无法${actionLabel}。`;
  }
  if (status === 409) {
    return `当前状态不允许${actionLabel}。`;
  }
  return `${actionLabel}失败（HTTP ${status}）。`;
}

function normalizePluginsError(actionLabel: string, error: unknown): Error {
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

async function performPluginsRequest<T>(input: {
  actionLabel: string;
  parseJson?: boolean;
  request: () => Promise<Response>;
}): Promise<T> {
  try {
    const response = await input.request();
    if (!response.ok) {
      const data = await readJsonErrorData<JsonErrorData>(response);
      throw new HttpError(
        buildPluginsActionErrorMessage(input.actionLabel, response.status, data),
        response.status,
        data,
      );
    }
    if (input.parseJson === false || response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  } catch (error) {
    throw normalizePluginsError(input.actionLabel, error);
  }
}

export function createPluginsClient(baseUrl: string): PluginsClient {
  return {
    async list(token, options) {
      const data = await performPluginsRequest<PluginListResponse>({
        actionLabel: '读取插件列表',
        request: () =>
          fetchWithTimeout(`${baseUrl}/plugins`, {
            headers: authHeader(token),
            signal: options?.signal,
          }),
      });
      return data.plugins ?? [];
    },

    async install(token, payload) {
      return performPluginsRequest<PluginInstallResponse>({
        actionLabel: '安装插件',
        request: () =>
          fetchWithTimeout(`${baseUrl}/plugins/install`, {
            method: 'POST',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify(payload),
          }),
      });
    },

    async remove(token, installId) {
      await performPluginsRequest({
        actionLabel: '卸载插件',
        parseJson: false,
        request: () =>
          fetchWithTimeout(`${baseUrl}/plugins/${encodeURIComponent(installId)}`, {
            method: 'DELETE',
            headers: authHeader(token),
          }),
      });
    },

    async reload(token, installId) {
      return performPluginsRequest<PluginReloadResponse>({
        actionLabel: '重载插件',
        request: () =>
          fetchWithTimeout(`${baseUrl}/plugins/${encodeURIComponent(installId)}/reload`, {
            method: 'POST',
            headers: authHeader(token),
          }),
      });
    },

    async disable(token, pluginId) {
      await performPluginsRequest({
        actionLabel: '停用插件',
        parseJson: false,
        request: () =>
          fetchWithTimeout(`${baseUrl}/plugins/${encodeURIComponent(pluginId)}/disable`, {
            method: 'POST',
            headers: authHeader(token),
          }),
      });
    },

    async enable(token, pluginId) {
      return performPluginsRequest<{ enabled: boolean; error?: string }>({
        actionLabel: '启用插件',
        request: () =>
          fetchWithTimeout(`${baseUrl}/plugins/${encodeURIComponent(pluginId)}/enable`, {
            method: 'POST',
            headers: authHeader(token),
          }),
      });
    },

    async listMarketSources(token) {
      const data = await performPluginsRequest<{ sources: PluginMarketSource[] }>({
        actionLabel: '读取插件市场源',
        request: () =>
          fetchWithTimeout(`${baseUrl}/plugins/market/sources`, {
            headers: authHeader(token),
          }),
      });
      return data.sources ?? [];
    },

    async addMarketSource(token, payload) {
      const data = await performPluginsRequest<{ source: PluginMarketSource }>({
        actionLabel: '添加插件市场源',
        request: () =>
          fetchWithTimeout(`${baseUrl}/plugins/market/sources`, {
            method: 'POST',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify(payload),
          }),
      });
      return data.source;
    },

    async removeMarketSource(token, sourceId) {
      await performPluginsRequest({
        actionLabel: '移除插件市场源',
        parseJson: false,
        request: () =>
          fetchWithTimeout(`${baseUrl}/plugins/market/sources/${encodeURIComponent(sourceId)}`, {
            method: 'DELETE',
            headers: authHeader(token),
          }),
      });
    },

    async searchMarket(token, options) {
      const query = options?.query?.trim();
      const suffix =
        query !== undefined && query.length > 0 ? `?query=${encodeURIComponent(query)}` : '';
      return performPluginsRequest<PluginMarketListing>({
        actionLabel: '读取插件市场',
        request: () =>
          fetchWithTimeout(`${baseUrl}/plugins/market${suffix}`, {
            headers: authHeader(token),
            signal: options?.signal,
          }),
      });
    },

    async getMarketEntry(token, query) {
      const params = `sourceId=${encodeURIComponent(query.sourceId)}&name=${encodeURIComponent(query.name)}`;
      return performPluginsRequest<PluginMarketDetail>({
        actionLabel: '读取插件详情',
        request: () =>
          fetchWithTimeout(`${baseUrl}/plugins/market/entry?${params}`, {
            headers: authHeader(token),
          }),
      });
    },

    async installFromGithub(token, payload) {
      return performPluginsRequest<PluginGithubInstallResponse>({
        actionLabel: '从 GitHub 安装插件',
        request: () =>
          fetchWithTimeout(`${baseUrl}/plugins/install/github`, {
            method: 'POST',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify(payload),
          }),
      });
    },
  };
}
