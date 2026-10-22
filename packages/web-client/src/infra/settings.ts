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

/**
 * 单个频道的持久化健康快照（对应网关 `channel_health` 表）。
 *
 * 与「运行时 diagnostics」的区别：这组字段**跨进程重启存活**，回答的是
 * 「上次这个频道坏在哪」，而非「此刻它是否在线」。所有字段可空 —— 频道刚创建
 * 还没出过任何状况时表里只有归属信息。
 */
export interface ChannelHealthRecord {
  /** 频道实例 id；兜底场景（pluginId 不可知）可能是 `'unknown'`。 */
  readonly channelId: string;
  readonly lastError: string | null;
  readonly lastErrorAt: number | null;
  readonly lastErrorChannelType: string | null;
  readonly lastErrorSource: string | null;
  readonly lastInboundAccepted: boolean | null;
  readonly lastInboundAt: number | null;
  readonly lastInboundError: string | null;
  readonly lastInboundType: string | null;
  readonly lastMessageAt: number | null;
  readonly lastMessageChatId: string | null;
  readonly ownerUserId: string | null;
  readonly status: string | null;
  readonly updatedAt: string;
}

/** 单条频道错误审计行（对应网关 `audit_logs` 中 `tool_name LIKE 'channel:%'`）。 */
export interface ChannelErrorAuditRecord {
  readonly id: number;
  readonly channelId: string | null;
  readonly code: string | null;
  readonly createdAt: string;
  readonly message: string;
  /**
   * 技术详情（上游错误码 / HTTP 状态 / 原始错误 / 恢复建议）。
   * 早期网关只在审计行写 `message`，排障页因此只能看到一句通用文案。
   */
  readonly channelDetail?: string | null;
  /** 上游错误码（如 `V2_TRANSIENT_5XX`），与渠道侧的 `code` 并存。 */
  readonly errorCode?: string | null;
  /** 可空：没有会话的频道级故障（启停 / 队列 / 投递）无法按会话归属。 */
  readonly sessionId: string | null;
  readonly source: string | null;
  readonly stack: string | null;
  readonly toolName: string;
  readonly requestId: string;
}

export interface ChannelTroubleshootingReport {
  readonly auditLogs: readonly ChannelErrorAuditRecord[];
  readonly channels: readonly ChannelHealthRecord[];
}

export interface ChannelTroubleshootingClearResult {
  readonly clearedAuditRows: number;
  readonly clearedHealthRows: number;
  readonly ok: boolean;
}

export interface SettingsProfileResponse {
  displayName: string;
  email: string;
  nickname: string | null;
  updatedAt?: string | null;
}

export interface SettingsProfileUpdateInput {
  nickname?: string | null;
}

export interface SettingsDisplayPreferencesResponse {
  preferences: Record<string, unknown> | null;
  updatedAt: string | null;
}

/**
 * 内置浏览器标签的同步载荷（服务端 `user_settings` 里的 `user_browser_tabs_v1`）。
 *
 * 只包含「可恢复的部分」：地址与历史。页面运行态（滚动位置、表单内容）不属于标签语义。
 */
export interface SettingsBrowserTab {
  id: string;
  url: string;
  title?: string;
  faviconUrl?: string;
  history: string[];
  historyIndex: number;
}

export interface SettingsBrowserTabsResponse {
  /** 服务端无记录时为 `null`（客户端应保留本机缓存，而不是清空）。 */
  tabs: { tabs?: SettingsBrowserTab[]; activeTabId?: string } | null;
  updatedAt: string | null;
}

/** 工作台现场的浏览器书签条目。 */
export interface SettingsWorkspaceBookmark {
  id: string;
  url: string;
  title: string;
  faviconUrl?: string;
  createdAt: number;
}

/**
 * 工作台现场快照（`/settings/workspace-state`）。
 *
 * `uiState` 是前端 UI store 的持久化载荷原样透传：服务端不解释字段，只限制大小，
 * 这样新增面板 / 布局字段不需要同步改协议。
 */
export interface SettingsWorkspaceStatePayload {
  version: number;
  /** 前端 UI store 的持久化版本，回灌时用于跑迁移。 */
  uiStateVersion: number;
  uiState: Record<string, unknown>;
  bookmarks: SettingsWorkspaceBookmark[];
  browserTabsByWorkspace: Record<string, { tabs: SettingsBrowserTab[]; activeTabId: string }>;
}

export interface SettingsWorkspaceStateResponse {
  /** 服务端无记录时为 `null`（客户端以本地为种子推上去）。 */
  state: SettingsWorkspaceStatePayload | null;
  updatedAt: string | null;
}

export interface SettingsClient {
  getProfile(token: string, options?: { signal?: AbortSignal }): Promise<SettingsProfileResponse>;
  putProfile(token: string, payload: SettingsProfileUpdateInput): Promise<SettingsProfileResponse>;
  // 显示偏好（跨设备恢复；服务端无记录时 preferences 为 null）
  getDisplayPreferences(
    token: string,
    options?: { signal?: AbortSignal },
  ): Promise<SettingsDisplayPreferencesResponse>;
  putDisplayPreferences(
    token: string,
    payload: Record<string, unknown>,
  ): Promise<SettingsDisplayPreferencesResponse>;
  // 内置浏览器标签（跨设备 / 跨重装恢复；服务端无记录时 tabs 为 null）
  getBrowserTabs(
    token: string,
    options?: { signal?: AbortSignal },
  ): Promise<SettingsBrowserTabsResponse>;
  putBrowserTabs(
    token: string,
    payload: { tabs?: SettingsBrowserTab[]; activeTabId?: string },
  ): Promise<SettingsBrowserTabsResponse>;
  // 工作台现场（打开记录 + 面板布局；服务端无记录时 state 为 null）
  getWorkspaceState(
    token: string,
    options?: { signal?: AbortSignal },
  ): Promise<SettingsWorkspaceStateResponse>;
  putWorkspaceState(
    token: string,
    payload: SettingsWorkspaceStatePayload,
  ): Promise<SettingsWorkspaceStateResponse>;
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
  /**
   * 拉取指定 provider 上游 `GET {baseUrl}/models` 实际暴露的模型列表(只读,不落库)。
   * 业务层失败也以 200 + 结构化结果返回(`ok` / `status` / `message` / `models`)。
   */
  fetchUpstreamModels(
    token: string,
    payload: { providerId?: string; provider?: unknown },
    options?: { signal?: AbortSignal },
  ): Promise<unknown>;
  /** 从 models.dev 发现尚未内置的平台列表。 */
  discoverProviders(token: string, options?: { signal?: AbortSignal }): Promise<unknown>;
  /** 从 models.dev 导入指定平台为 custom provider。 */
  importProviderFromModelsDev(
    token: string,
    payload: { modelsDevProviderId: string; name?: string; enabled?: boolean },
    options?: { signal?: AbortSignal },
  ): Promise<unknown>;
  putProviders(token: string, payload: unknown): Promise<unknown>;
  putProviderFastMode(
    token: string,
    payload: { providerId: string; enabled: boolean },
  ): Promise<{ ok: boolean; providerId: string; openaiFastMode: boolean }>;
  putModelContext(
    token: string,
    payload: { providerId: string; modelId: string; contextWindowOverride: number | null },
  ): Promise<{
    ok: boolean;
    providerId: string;
    modelId: string;
    contextWindowOverride: number | null;
  }>;
  /** 单独更新 active-selection（chat / fast / image / compaction 的 provider+model 绑定）。 */
  putActiveSelection(token: string, payload: unknown): Promise<unknown>;
  // MCP servers
  listMcpServers(token: string, options?: { signal?: AbortSignal }): Promise<unknown>;
  putMcpServers(token: string, payload: unknown): Promise<void>;
  retryMcpServer(token: string, serverId: string): Promise<unknown>;
  getMcpStatus(
    token: string,
    options?: { includeTools?: boolean; signal?: AbortSignal },
  ): Promise<unknown>;
  // 价格 / 文件 patterns / dev logs / workers / diagnostics
  getModelPrices(token: string, options?: { signal?: AbortSignal }): Promise<unknown>;
  getFilePatterns(token: string, options?: { signal?: AbortSignal }): Promise<unknown>;
  putFilePatterns(token: string, patterns: string[]): Promise<void>;
  getDevLogs(token: string, options?: { signal?: AbortSignal }): Promise<unknown>;
  clearDevLogs(token: string): Promise<void>;
  getWorkers(token: string, options?: { signal?: AbortSignal }): Promise<unknown>;
  getDiagnostics(token: string, options?: { signal?: AbortSignal }): Promise<unknown>;
  clearDiagnostics(token: string): Promise<void>;
  // 消息频道路障（频道健康快照 + 频道错误审计行）
  getChannelTroubleshooting(
    token: string,
    options?: { limit?: number; signal?: AbortSignal },
  ): Promise<ChannelTroubleshootingReport>;
  clearChannelTroubleshooting(token: string): Promise<ChannelTroubleshootingClearResult>;
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
  // 自定义域名
  getBaseUrl(token: string, options?: { signal?: AbortSignal }): Promise<{ baseUrl: string }>;
  putBaseUrl(token: string, payload: { baseUrl: string }): Promise<void>;
  // 版本 / 校验
  getVersion(
    token: string,
    options?: { signal?: AbortSignal; channel?: 'preview' | 'stable' },
  ): Promise<unknown>;
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
  maxRetries?: number;
}): Promise<T> {
  const maxRetries = input.maxRetries ?? 2;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
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
      lastError = error;
      // 只对网络错误重试，不对 HTTP 业务错误重试
      const isNetworkError =
        error instanceof TypeError ||
        (error instanceof Error && isGenericSettingsNetworkErrorMessage(error.message));
      if (isNetworkError && attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
        continue;
      }
      throw normalizeSettingsActionError(input.actionLabel, error);
    }
  }

  throw normalizeSettingsActionError(input.actionLabel, lastError);
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
    async getProfile(token, options) {
      return performSettingsRequest<SettingsProfileResponse>({
        actionLabel: '读取个人资料',
        request: () =>
          fetchWithTimeout(`${baseUrl}/settings/profile`, {
            headers: authHeader(token),
            signal: options?.signal,
          }),
      });
    },

    async putProfile(token, payload) {
      return performSettingsRequest<SettingsProfileResponse>({
        actionLabel: '保存个人资料',
        request: () =>
          fetchWithTimeout(`${baseUrl}/settings/profile`, {
            method: 'PUT',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify(payload),
          }),
      });
    },

    async getDisplayPreferences(token, options) {
      return performSettingsRequest<SettingsDisplayPreferencesResponse>({
        actionLabel: '读取显示偏好',
        request: () =>
          fetchWithTimeout(`${baseUrl}/settings/display-preferences`, {
            headers: authHeader(token),
            signal: options?.signal,
          }),
      });
    },

    async putDisplayPreferences(token, payload) {
      return performSettingsRequest<SettingsDisplayPreferencesResponse>({
        actionLabel: '保存显示偏好',
        request: () =>
          fetchWithTimeout(`${baseUrl}/settings/display-preferences`, {
            method: 'PUT',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify(payload),
          }),
      });
    },

    async getBrowserTabs(token, options) {
      return performSettingsRequest<SettingsBrowserTabsResponse>({
        actionLabel: '读取浏览器标签',
        request: () =>
          fetchWithTimeout(`${baseUrl}/settings/browser-tabs`, {
            headers: authHeader(token),
            signal: options?.signal,
          }),
      });
    },

    async putBrowserTabs(token, payload) {
      return performSettingsRequest<SettingsBrowserTabsResponse>({
        actionLabel: '保存浏览器标签',
        request: () =>
          fetchWithTimeout(`${baseUrl}/settings/browser-tabs`, {
            method: 'PUT',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify(payload),
          }),
      });
    },

    async getWorkspaceState(token, options) {
      return performSettingsRequest<SettingsWorkspaceStateResponse>({
        actionLabel: '读取工作台状态',
        request: () =>
          fetchWithTimeout(`${baseUrl}/settings/workspace-state`, {
            headers: authHeader(token),
            signal: options?.signal,
          }),
      });
    },

    async putWorkspaceState(token, payload) {
      return performSettingsRequest<SettingsWorkspaceStateResponse>({
        actionLabel: '保存工作台状态',
        request: () =>
          fetchWithTimeout(`${baseUrl}/settings/workspace-state`, {
            method: 'PUT',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify(payload),
          }),
      });
    },

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

    async fetchUpstreamModels(token, payload, options) {
      // 与自检一致:业务层失败也以 200 + 结构化结果返回,这里直接透传 JSON,
      // 让调用方按返回体里的 `ok` / `status` / `models` 渲染面板状态。
      const response = await fetchWithTimeout(`${baseUrl}/settings/providers/upstream-models`, {
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
      throw new HttpError(`拉取上游模型列表失败(HTTP ${response.status})`, response.status);
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

    async putProviderFastMode(token, payload) {
      return performSettingsRequest({
        actionLabel: payload.enabled ? '开启 OpenAI Fast 模式' : '关闭 OpenAI Fast 模式',
        request: () =>
          fetchWithTimeout(`${baseUrl}/settings/providers/fast-mode`, {
            method: 'PUT',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify(payload),
          }),
      });
    },

    async putModelContext(token, payload) {
      return performSettingsRequest({
        actionLabel: '保存模型上下文挡位',
        request: () =>
          fetchWithTimeout(`${baseUrl}/settings/providers/model-context`, {
            method: 'PUT',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify(payload),
          }),
      });
    },

    async putActiveSelection(token, payload) {
      return performSettingsRequest<unknown>({
        actionLabel: '保存模型选择',
        request: () =>
          fetchWithTimeout(`${baseUrl}/settings/active-selection`, {
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
        removedModels?: number;
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

    async discoverProviders(token, options) {
      const response = await fetchWithTimeout(`${baseUrl}/settings/providers/discover`, {
        headers: authHeader(token),
        signal: options?.signal,
      });
      if (!response.ok) {
        throw new HttpError(`发现 Provider 失败（HTTP ${response.status}）`, response.status);
      }
      return (await response.json()) as unknown;
    },

    async importProviderFromModelsDev(token, payload, options) {
      return performSettingsRequest<unknown>({
        actionLabel: '从 models.dev 导入 Provider',
        request: () =>
          fetchWithTimeout(`${baseUrl}/settings/providers/import-from-models-dev`, {
            method: 'POST',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify(payload),
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
      const params = new URLSearchParams();
      if (options?.includeTools) params.set('includeTools', 'true');
      const path = withQuery('/settings/mcp-status', params);
      return performSettingsRequest<unknown>({
        actionLabel: '读取 MCP 状态',
        request: () =>
          fetchWithTimeout(`${baseUrl}${path}`, {
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

    async clearDevLogs(token) {
      await performSettingsRequest({
        actionLabel: '清空开发日志',
        parseJson: false,
        request: () =>
          fetchWithTimeout(`${baseUrl}/settings/dev-logs`, {
            method: 'DELETE',
            headers: authHeader(token),
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

    async getChannelTroubleshooting(token, options) {
      // 沿用 getDiagnostics 的失败语义：抛错交给上层 hook 转成「加载失败」态。
      // 排障页刻意区别于普通设置页 —— 加载失败本身就是需要被看到的状态，
      // 静默降级成空列表会把「没查到」和「查不到」混为一谈。
      return performSettingsRequest<ChannelTroubleshootingReport>({
        actionLabel: '读取频道路障信息',
        request: () =>
          fetchWithTimeout(
            withQuery(
              `${baseUrl}/settings/channel-troubleshooting`,
              new URLSearchParams(
                typeof options?.limit === 'number' ? { limit: String(options.limit) } : {},
              ),
            ),
            {
              headers: authHeader(token),
              signal: options?.signal,
            },
          ),
      });
    },

    async clearChannelTroubleshooting(token) {
      return performSettingsRequest<ChannelTroubleshootingClearResult>({
        actionLabel: '清空频道路障信息',
        request: () =>
          fetchWithTimeout(`${baseUrl}/settings/channel-troubleshooting`, {
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

    async getBaseUrl(token, options) {
      return performSettingsRequest<{ baseUrl: string }>({
        actionLabel: '读取自定义域名',
        request: () =>
          fetchWithTimeout(`${baseUrl}/settings/base-url`, {
            headers: authHeader(token),
            signal: options?.signal,
          }),
      });
    },

    async putBaseUrl(token, payload) {
      await performSettingsRequest<void>({
        actionLabel: '保存自定义域名',
        request: () =>
          fetchWithTimeout(`${baseUrl}/settings/base-url`, {
            method: 'PUT',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify(payload),
          }),
      });
    },

    async getVersion(token, options) {
      const params = new URLSearchParams();
      if (options?.channel === 'preview' || options?.channel === 'stable') {
        params.set('channel', options.channel);
      }
      const query = params.toString();
      const url = query ? `${baseUrl}/settings/version?${query}` : `${baseUrl}/settings/version`;
      return performSettingsRequest<unknown>({
        actionLabel: '读取版本信息',
        request: () =>
          fetchWithTimeout(url, {
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
