/**
 * `/settings/*` 客户端：覆盖网关全部 settings 路由，包括 providers、MCP、用量价格、
 * 文件 patterns、permissions、workers / dev-logs / diagnostics、companion、plugins、
 * upstream-retry、websearch、version。
 *
 * 注意：网关里大量 settings 端点的请求 / 响应是高度自由的 JSON（用户输入 + 透传 schema），
 * 客户端选择把响应作为 `unknown` 透传，让 `apps/web` 自己用现有的 `AIProviderRef` 等
 * 类型做收敛——避免重复同步两份 schema。
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

export interface SettingsProvidersLoadResult {
  errorMessage?: string;
  ok: boolean;
  providers?: unknown;
  retryable: boolean;
  status?: number;
}

export interface SettingsClient {
  // Providers / 模型选择
  getProviders(
    token: string,
    options?: { enabledOnly?: boolean; signal?: AbortSignal },
  ): Promise<unknown>;
  getProvidersResult(
    token: string,
    options?: { enabledOnly?: boolean; signal?: AbortSignal },
  ): Promise<SettingsProvidersLoadResult>;
  /** 平台 catalog 的 UI 元数据(logo/显示名/上游变体/别名)，新增平台自动可用。 */
  getProviderCatalog(token: string, options?: { signal?: AbortSignal }): Promise<unknown>;
  /** 连通性自检：对单个 provider+模型发起最小化上游调用，返回结构化结果。 */
  testProvider(
    token: string,
    payload: unknown,
    options?: { signal?: AbortSignal },
  ): Promise<unknown>;
  /** 手动从 models.dev 同步内置模型目录；成功后返回 provider/model 数量。 */
  syncModelsCatalog(
    token: string,
    options?: { signal?: AbortSignal },
  ): Promise<{ ok: boolean; providerCount?: number; modelCount?: number; message?: string }>;
  putProviders(token: string, payload: unknown): Promise<unknown>;
  // MCP servers
  listMcpServers(token: string, options?: { signal?: AbortSignal }): Promise<unknown>;
  putMcpServers(token: string, payload: unknown): Promise<void>;
  retryMcpServer(token: string, serverId: string): Promise<unknown>;
  getMcpStatus(token: string, options?: { signal?: AbortSignal }): Promise<unknown>;
  // 价格 / 文件 patterns / dev logs / workers / diagnostics
  getModelPrices(token: string, options?: { signal?: AbortSignal }): Promise<unknown>;
  getFilePatterns(token: string, options?: { signal?: AbortSignal }): Promise<unknown>;
  putFilePatterns(token: string, patterns: string[]): Promise<void>;
  getDevLogs(token: string, options?: { signal?: AbortSignal }): Promise<unknown>;
  getWorkers(token: string, options?: { signal?: AbortSignal }): Promise<unknown>;
  getDiagnostics(token: string, options?: { signal?: AbortSignal }): Promise<unknown>;
  clearDiagnostics(token: string): Promise<void>;
  // Permission rules / decisions
  getPermissionRules(token: string, options?: { signal?: AbortSignal }): Promise<unknown>;
  putPermissionRules(token: string, payload: unknown): Promise<void>;
  getPermissionDecisions(token: string, options?: { signal?: AbortSignal }): Promise<unknown>;
  // Plugins (image generation 等)
  getPlugins(token: string, options?: { signal?: AbortSignal }): Promise<unknown>;
  putPlugins(token: string, payload: unknown): Promise<void>;
  // Companion 偏好（按 agentId 维度）
  getCompanion(
    token: string,
    options?: { agentId?: string; signal?: AbortSignal },
  ): Promise<unknown>;
  putCompanion(token: string, payload: unknown, options?: { agentId?: string }): Promise<unknown>;
  putCompanionChat(token: string, payload: unknown): Promise<unknown>;
  // Upstream retry / web search
  getUpstreamRetry(token: string, options?: { signal?: AbortSignal }): Promise<unknown>;
  putUpstreamRetry(token: string, payload: unknown): Promise<unknown>;
  getWebsearch(token: string, options?: { signal?: AbortSignal }): Promise<unknown>;
  putWebsearch(token: string, payload: unknown): Promise<unknown>;
  // 版本 / 校验
  getVersion(token: string, options?: { signal?: AbortSignal }): Promise<unknown>;
  // 遥测同意 & 事件上报
  getTelemetryConsent(token: string, options?: { signal?: AbortSignal }): Promise<unknown>;
  updateTelemetryConsent(
    token: string,
    status: 'accepted' | 'declined',
  ): Promise<{ ok: boolean; status: string }>;
  reportTelemetryEvent(
    token: string,
    name: string,
    properties?: Record<string, string | number | boolean>,
  ): Promise<{ ok: boolean }>;
}

function buildCompanionQueryString(options?: { agentId?: string }): URLSearchParams {
  const params = new URLSearchParams();
  if (options?.agentId) params.set('agentId', options.agentId);
  return params;
}

function isRetryableSettingsStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function buildSettingsProvidersErrorMessage(
  status: number,
  data: JsonErrorData | undefined,
): string {
  const extracted = extractJsonErrorMessage(data);
  if (extracted) {
    return extracted;
  }
  if (status === 401 || status === 403) {
    return '认证失效或当前账号无权读取 Provider 列表。';
  }
  return `加载 Provider 列表失败（HTTP ${status}）。`;
}

function buildSettingsActionErrorMessage(
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
    return `目标设置资源不存在，无法${actionLabel}。`;
  }
  if (status === 409) {
    return `当前状态不允许${actionLabel}。`;
  }
  return `${actionLabel}失败（HTTP ${status}）。`;
}

function isGenericSettingsNetworkErrorMessage(message: string): boolean {
  return isGenericFetchErrorMessage(message);
}

function normalizeSettingsActionError(actionLabel: string, error: unknown): Error {
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
    if (message.length > 0 && !isGenericSettingsNetworkErrorMessage(message)) {
      return error;
    }
  }
  return new Error(`网络异常，${actionLabel}失败。`);
}

async function performSettingsRequest<T>(input: {
  actionLabel: string;
  parseJson?: boolean;
  request: () => Promise<Response>;
}): Promise<T> {
  try {
    const response = await input.request();
    if (!response.ok) {
      const data = await readJsonErrorData<JsonErrorData>(response);
      throw new HttpError(
        buildSettingsActionErrorMessage(input.actionLabel, response.status, data),
        response.status,
        data,
      );
    }
    if (input.parseJson === false || response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  } catch (error) {
    throw normalizeSettingsActionError(input.actionLabel, error);
  }
}

export function createSettingsClient(baseUrl: string): SettingsClient {
  const getProvidersResult = async (
    token: string,
    options?: { enabledOnly?: boolean; signal?: AbortSignal },
  ): Promise<SettingsProvidersLoadResult> => {
    const params = new URLSearchParams();
    if (options?.enabledOnly) params.set('enabledOnly', 'true');
    try {
      const response = await fetchWithTimeout(withQuery(`${baseUrl}/settings/providers`, params), {
        headers: authHeader(token),
        signal: options?.signal,
      });
      if (!response.ok) {
        return {
          ok: false,
          retryable: isRetryableSettingsStatus(response.status),
          errorMessage: buildSettingsProvidersErrorMessage(
            response.status,
            await readJsonErrorData<JsonErrorData>(response),
          ),
          status: response.status,
        };
      }
      return {
        ok: true,
        retryable: false,
        providers: await response.json(),
      };
    } catch (error) {
      return {
        ok: false,
        retryable: true,
        errorMessage: normalizeSettingsActionError('加载 Provider 列表', error).message,
      };
    }
  };

  return {
    async getProviders(token, options) {
      const result = await getProvidersResult(token, options);
      if (!result.ok) {
        throw new HttpError(result.errorMessage ?? '加载 Provider 列表失败', result.status ?? 500);
      }
      return result.providers ?? {};
    },

    getProvidersResult,

    async getProviderCatalog(token, options) {
      const response = await fetchWithTimeout(`${baseUrl}/settings/providers/catalog`, {
        headers: authHeader(token),
        signal: options?.signal,
      });
      if (!response.ok) {
        throw new HttpError(
          `加载 Provider Catalog 失败（HTTP ${response.status}）`,
          response.status,
        );
      }
      return (await response.json()) as unknown;
    },

    async testProvider(token, payload, options) {
      // 连通性自检：业务层失败也以 200 + 结构化结果返回，这里直接透传 JSON，
      // 让调用方按返回体里的 `ok` 字段渲染按钮状态(成功/鉴权失败/限流/超时/错误)。
      const response = await fetchWithTimeout(`${baseUrl}/settings/providers/test`, {
        timeoutMs: 120_000,
        method: 'POST',
        headers: jsonAuthHeaders(token),
        body: JSON.stringify(payload),
        signal: options?.signal,
      });
      const data = (await response.json().catch(() => null)) as unknown;
      if (data && typeof data === 'object') {
        return data;
      }
      throw new HttpError(`连通性自检失败（HTTP ${response.status}）`, response.status);
    },

    async putProviders(token, payload) {
      return performSettingsRequest<unknown>({
        actionLabel: '保存 Provider 配置',
        request: () =>
          fetchWithTimeout(`${baseUrl}/settings/providers`, {
            method: 'PUT',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify(payload),
          }),
      });
    },

    async syncModelsCatalog(token, options) {
      return performSettingsRequest<{
        ok: boolean;
        providerCount?: number;
        modelCount?: number;
        message?: string;
      }>({
        actionLabel: '同步模型目录',
        request: () =>
          fetchWithTimeout(`${baseUrl}/settings/providers/sync`, {
            timeoutMs: 120_000,
            method: 'POST',
            headers: authHeader(token),
            signal: options?.signal,
          }),
      });
    },

    async listMcpServers(token, options) {
      return performSettingsRequest<unknown>({
        actionLabel: '读取 MCP 服务列表',
        request: () =>
          fetchWithTimeout(`${baseUrl}/settings/mcp-servers`, {
            headers: authHeader(token),
            signal: options?.signal,
          }),
      });
    },

    async putMcpServers(token, payload) {
      await performSettingsRequest({
        actionLabel: '保存 MCP 服务配置',
        parseJson: false,
        request: () =>
          fetchWithTimeout(`${baseUrl}/settings/mcp-servers`, {
            method: 'PUT',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify(payload),
          }),
      });
    },

    async retryMcpServer(token, serverId) {
      return performSettingsRequest<unknown>({
        actionLabel: '重试 MCP 服务连接',
        request: () =>
          fetchWithTimeout(
            `${baseUrl}/settings/mcp-servers/${encodeURIComponent(serverId)}/retry`,
            {
              method: 'POST',
              headers: authHeader(token),
            },
          ),
      });
    },

    async getMcpStatus(token, options) {
      return performSettingsRequest<unknown>({
        actionLabel: '读取 MCP 状态',
        request: () =>
          fetchWithTimeout(`${baseUrl}/settings/mcp-status`, {
            headers: authHeader(token),
            signal: options?.signal,
          }),
      });
    },

    async getModelPrices(token, options) {
      return performSettingsRequest<unknown>({
        actionLabel: '读取模型价格配置',
        request: () =>
          fetchWithTimeout(`${baseUrl}/settings/model-prices`, {
            headers: authHeader(token),
            signal: options?.signal,
          }),
      });
    },

    async getFilePatterns(token, options) {
      return performSettingsRequest<unknown>({
        actionLabel: '读取文件匹配规则',
        request: () =>
          fetchWithTimeout(`${baseUrl}/settings/file-patterns`, {
            headers: authHeader(token),
            signal: options?.signal,
          }),
      });
    },

    async putFilePatterns(token, patterns) {
      await performSettingsRequest({
        actionLabel: '保存文件匹配规则',
        parseJson: false,
        request: () =>
          fetchWithTimeout(`${baseUrl}/settings/file-patterns`, {
            method: 'PUT',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify({ patterns }),
          }),
      });
    },

    async getDevLogs(token, options) {
      return performSettingsRequest<unknown>({
        actionLabel: '读取开发日志',
        request: () =>
          fetchWithTimeout(`${baseUrl}/settings/dev-logs`, {
            headers: authHeader(token),
            signal: options?.signal,
          }),
      });
    },

    async getWorkers(token, options) {
      return performSettingsRequest<unknown>({
        actionLabel: '读取 Worker 状态',
        request: () =>
          fetchWithTimeout(`${baseUrl}/settings/workers`, {
            headers: authHeader(token),
            signal: options?.signal,
          }),
      });
    },

    async getDiagnostics(token, options) {
      return performSettingsRequest<unknown>({
        actionLabel: '读取诊断信息',
        request: () =>
          fetchWithTimeout(`${baseUrl}/settings/diagnostics`, {
            headers: authHeader(token),
            signal: options?.signal,
          }),
      });
    },

    async clearDiagnostics(token) {
      await performSettingsRequest({
        actionLabel: '清空诊断信息',
        parseJson: false,
        request: () =>
          fetchWithTimeout(`${baseUrl}/settings/diagnostics`, {
            method: 'DELETE',
            headers: authHeader(token),
          }),
      });
    },

    async getPermissionRules(token, options) {
      const response = await fetchWithTimeout(`${baseUrl}/settings/permission-rules`, {
        headers: authHeader(token),
        signal: options?.signal,
      });
      if (!response.ok) {
        return { rules: [], categories: [] };
      }
      return response.json();
    },

    async putPermissionRules(token, payload) {
      await performSettingsRequest({
        actionLabel: '保存权限规则',
        parseJson: false,
        request: () =>
          fetchWithTimeout(`${baseUrl}/settings/permission-rules`, {
            method: 'PUT',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify(payload),
          }),
      });
    },

    async getPermissionDecisions(token, options) {
      const response = await fetchWithTimeout(`${baseUrl}/settings/permissions`, {
        headers: authHeader(token),
        signal: options?.signal,
      });
      if (!response.ok) {
        return { decisions: [] };
      }
      return response.json();
    },

    async getPlugins(token, options) {
      return performSettingsRequest<unknown>({
        actionLabel: '读取插件配置',
        request: () =>
          fetchWithTimeout(`${baseUrl}/settings/plugins`, {
            headers: authHeader(token),
            signal: options?.signal,
          }),
      });
    },

    async putPlugins(token, payload) {
      await performSettingsRequest({
        actionLabel: '保存插件配置',
        parseJson: false,
        request: () =>
          fetchWithTimeout(`${baseUrl}/settings/plugins`, {
            method: 'PUT',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify(payload),
          }),
      });
    },

    async getCompanion(token, options) {
      const params = buildCompanionQueryString(options);
      return performSettingsRequest<unknown>({
        actionLabel: '读取 Companion 配置',
        request: () =>
          fetchWithTimeout(withQuery(`${baseUrl}/settings/companion`, params), {
            headers: authHeader(token),
            signal: options?.signal,
          }),
      });
    },

    async putCompanion(token, payload, options) {
      const params = buildCompanionQueryString(options);
      return performSettingsRequest<unknown>({
        actionLabel: '保存 Companion 配置',
        request: () =>
          fetchWithTimeout(withQuery(`${baseUrl}/settings/companion`, params), {
            method: 'PUT',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify(payload),
          }),
      });
    },

    async putCompanionChat(token, payload) {
      return performSettingsRequest<unknown>({
        actionLabel: '发送 Companion 测试消息',
        request: () =>
          fetchWithTimeout(`${baseUrl}/settings/companion/chat`, {
            method: 'POST',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify(payload),
          }),
      });
    },

    async getUpstreamRetry(token, options) {
      return performSettingsRequest<unknown>({
        actionLabel: '读取上游重试配置',
        request: () =>
          fetchWithTimeout(`${baseUrl}/settings/upstream-retry`, {
            headers: authHeader(token),
            signal: options?.signal,
          }),
      });
    },

    async putUpstreamRetry(token, payload) {
      return performSettingsRequest<unknown>({
        actionLabel: '保存上游重试配置',
        request: () =>
          fetchWithTimeout(`${baseUrl}/settings/upstream-retry`, {
            method: 'PUT',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify(payload),
          }),
      });
    },

    async getWebsearch(token, options) {
      return performSettingsRequest<unknown>({
        actionLabel: '读取 Websearch 策略',
        request: () =>
          fetchWithTimeout(`${baseUrl}/settings/websearch`, {
            headers: authHeader(token),
            signal: options?.signal,
          }),
      });
    },

    async putWebsearch(token, payload) {
      return performSettingsRequest<unknown>({
        actionLabel: '保存 Websearch 策略',
        request: () =>
          fetchWithTimeout(`${baseUrl}/settings/websearch`, {
            method: 'PUT',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify(payload),
          }),
      });
    },

    async getVersion(token, options) {
      return performSettingsRequest<unknown>({
        actionLabel: '读取版本信息',
        request: () =>
          fetchWithTimeout(`${baseUrl}/settings/version`, {
            headers: authHeader(token),
            signal: options?.signal,
          }),
      });
    },

    async getTelemetryConsent(token, options) {
      return performSettingsRequest<unknown>({
        actionLabel: '读取遥测同意状态',
        request: () =>
          fetchWithTimeout(`${baseUrl}/settings/telemetry/consent`, {
            headers: authHeader(token),
            signal: options?.signal,
          }),
      });
    },

    async updateTelemetryConsent(token, status) {
      return performSettingsRequest<{ ok: boolean; status: string }>({
        actionLabel: '保存遥测同意状态',
        request: () =>
          fetchWithTimeout(`${baseUrl}/settings/telemetry/consent`, {
            method: 'PUT',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify({ status }),
          }),
      });
    },

    async reportTelemetryEvent(token, name, properties) {
      return performSettingsRequest<{ ok: boolean }>({
        actionLabel: '上报遥测事件',
        request: () =>
          fetchWithTimeout(`${baseUrl}/settings/telemetry/event`, {
            method: 'POST',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify({ name, properties: properties ?? {} }),
          }),
      });
    },
  };
}
