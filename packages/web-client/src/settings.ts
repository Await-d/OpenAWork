/**
 * `/settings/*` 客户端：覆盖网关全部 settings 路由，包括 providers、MCP、用量价格、
 * 文件 patterns、permissions、workers / dev-logs / diagnostics、companion、plugins、
 * upstream-retry、websearch、version。
 *
 * 注意：网关里大量 settings 端点的请求 / 响应是高度自由的 JSON（用户输入 + 透传 schema），
 * 客户端选择把响应作为 `unknown` 透传，让 `apps/web` 自己用现有的 `AIProviderRef` 等
 * 类型做收敛——避免重复同步两份 schema。
 */

import { authHeader, expectJson, expectOk, HttpError, jsonAuthHeaders, withQuery } from './http.js';

export interface SettingsClient {
  // Providers / 模型选择
  getProviders(
    token: string,
    options?: { enabledOnly?: boolean; signal?: AbortSignal },
  ): Promise<unknown>;
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
}

function buildCompanionQueryString(options?: { agentId?: string }): URLSearchParams {
  const params = new URLSearchParams();
  if (options?.agentId) params.set('agentId', options.agentId);
  return params;
}

export function createSettingsClient(baseUrl: string): SettingsClient {
  return {
    async getProviders(token, options) {
      const params = new URLSearchParams();
      if (options?.enabledOnly) params.set('enabledOnly', 'true');
      const response = await fetch(withQuery(`${baseUrl}/settings/providers`, params), {
        headers: authHeader(token),
        signal: options?.signal,
      });
      return expectJson<unknown>(response, 'settings.getProviders');
    },

    async putProviders(token, payload) {
      const response = await fetch(`${baseUrl}/settings/providers`, {
        method: 'PUT',
        headers: jsonAuthHeaders(token),
        body: JSON.stringify(payload),
      });
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new HttpError(
          data?.error ?? `settings.putProviders failed: ${response.status}`,
          response.status,
          data ?? undefined,
        );
      }
      return data ?? {};
    },

    async listMcpServers(token, options) {
      const response = await fetch(`${baseUrl}/settings/mcp-servers`, {
        headers: authHeader(token),
        signal: options?.signal,
      });
      return expectJson<unknown>(response, 'settings.listMcpServers');
    },

    async putMcpServers(token, payload) {
      const response = await fetch(`${baseUrl}/settings/mcp-servers`, {
        method: 'PUT',
        headers: jsonAuthHeaders(token),
        body: JSON.stringify(payload),
      });
      await expectOk(response, 'settings.putMcpServers');
    },

    async retryMcpServer(token, serverId) {
      const response = await fetch(
        `${baseUrl}/settings/mcp-servers/${encodeURIComponent(serverId)}/retry`,
        { method: 'POST', headers: authHeader(token) },
      );
      if (!response.ok) {
        const text = await response.text();
        throw new HttpError(text || `HTTP ${response.status}`, response.status);
      }
      return response.json();
    },

    async getMcpStatus(token, options) {
      const response = await fetch(`${baseUrl}/settings/mcp-status`, {
        headers: authHeader(token),
        signal: options?.signal,
      });
      return expectJson<unknown>(response, 'settings.getMcpStatus');
    },

    async getModelPrices(token, options) {
      const response = await fetch(`${baseUrl}/settings/model-prices`, {
        headers: authHeader(token),
        signal: options?.signal,
      });
      return expectJson<unknown>(response, 'settings.getModelPrices');
    },

    async getFilePatterns(token, options) {
      const response = await fetch(`${baseUrl}/settings/file-patterns`, {
        headers: authHeader(token),
        signal: options?.signal,
      });
      return expectJson<unknown>(response, 'settings.getFilePatterns');
    },

    async putFilePatterns(token, patterns) {
      const response = await fetch(`${baseUrl}/settings/file-patterns`, {
        method: 'PUT',
        headers: jsonAuthHeaders(token),
        body: JSON.stringify({ patterns }),
      });
      await expectOk(response, 'settings.putFilePatterns');
    },

    async getDevLogs(token, options) {
      const response = await fetch(`${baseUrl}/settings/dev-logs`, {
        headers: authHeader(token),
        signal: options?.signal,
      });
      return expectJson<unknown>(response, 'settings.getDevLogs');
    },

    async getWorkers(token, options) {
      const response = await fetch(`${baseUrl}/settings/workers`, {
        headers: authHeader(token),
        signal: options?.signal,
      });
      return expectJson<unknown>(response, 'settings.getWorkers');
    },

    async getDiagnostics(token, options) {
      const response = await fetch(`${baseUrl}/settings/diagnostics`, {
        headers: authHeader(token),
        signal: options?.signal,
      });
      return expectJson<unknown>(response, 'settings.getDiagnostics');
    },

    async clearDiagnostics(token) {
      const response = await fetch(`${baseUrl}/settings/diagnostics`, {
        method: 'DELETE',
        headers: authHeader(token),
      });
      await expectOk(response, 'settings.clearDiagnostics');
    },

    async getPermissionRules(token, options) {
      const response = await fetch(`${baseUrl}/settings/permission-rules`, {
        headers: authHeader(token),
        signal: options?.signal,
      });
      if (!response.ok) {
        return { rules: [], categories: [] };
      }
      return response.json();
    },

    async putPermissionRules(token, payload) {
      const response = await fetch(`${baseUrl}/settings/permission-rules`, {
        method: 'PUT',
        headers: jsonAuthHeaders(token),
        body: JSON.stringify(payload),
      });
      await expectOk(response, 'settings.putPermissionRules');
    },

    async getPermissionDecisions(token, options) {
      const response = await fetch(`${baseUrl}/settings/permissions`, {
        headers: authHeader(token),
        signal: options?.signal,
      });
      if (!response.ok) {
        return { decisions: [] };
      }
      return response.json();
    },

    async getPlugins(token, options) {
      const response = await fetch(`${baseUrl}/settings/plugins`, {
        headers: authHeader(token),
        signal: options?.signal,
      });
      return expectJson<unknown>(response, 'settings.getPlugins');
    },

    async putPlugins(token, payload) {
      const response = await fetch(`${baseUrl}/settings/plugins`, {
        method: 'PUT',
        headers: jsonAuthHeaders(token),
        body: JSON.stringify(payload),
      });
      await expectOk(response, 'settings.putPlugins');
    },

    async getCompanion(token, options) {
      const params = buildCompanionQueryString(options);
      const response = await fetch(withQuery(`${baseUrl}/settings/companion`, params), {
        headers: authHeader(token),
        signal: options?.signal,
      });
      return expectJson<unknown>(response, 'settings.getCompanion');
    },

    async putCompanion(token, payload, options) {
      const params = buildCompanionQueryString(options);
      const response = await fetch(withQuery(`${baseUrl}/settings/companion`, params), {
        method: 'PUT',
        headers: jsonAuthHeaders(token),
        body: JSON.stringify(payload),
      });
      return expectJson<unknown>(response, 'settings.putCompanion');
    },

    async putCompanionChat(token, payload) {
      const response = await fetch(`${baseUrl}/settings/companion/chat`, {
        method: 'POST',
        headers: jsonAuthHeaders(token),
        body: JSON.stringify(payload),
      });
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new HttpError(
          data?.error ?? `settings.putCompanionChat failed: ${response.status}`,
          response.status,
          data ?? undefined,
        );
      }
      return data ?? {};
    },

    async getUpstreamRetry(token, options) {
      const response = await fetch(`${baseUrl}/settings/upstream-retry`, {
        headers: authHeader(token),
        signal: options?.signal,
      });
      return expectJson<unknown>(response, 'settings.getUpstreamRetry');
    },

    async putUpstreamRetry(token, payload) {
      const response = await fetch(`${baseUrl}/settings/upstream-retry`, {
        method: 'PUT',
        headers: jsonAuthHeaders(token),
        body: JSON.stringify(payload),
      });
      return expectJson<unknown>(response, 'settings.putUpstreamRetry');
    },

    async getWebsearch(token, options) {
      const response = await fetch(`${baseUrl}/settings/websearch`, {
        headers: authHeader(token),
        signal: options?.signal,
      });
      return expectJson<unknown>(response, 'settings.getWebsearch');
    },

    async putWebsearch(token, payload) {
      const response = await fetch(`${baseUrl}/settings/websearch`, {
        method: 'PUT',
        headers: jsonAuthHeaders(token),
        body: JSON.stringify(payload),
      });
      return expectJson<unknown>(response, 'settings.putWebsearch');
    },

    async getVersion(token, options) {
      const response = await fetch(`${baseUrl}/settings/version`, {
        headers: authHeader(token),
        signal: options?.signal,
      });
      return expectJson<unknown>(response, 'settings.getVersion');
    },
  };
}
