/**
 * `/prompt-snippets/*` 客户端：快捷提示词分组 + 条目 CRUD。
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

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PromptSnippetGroup {
  id: string;
  userId: string;
  name: string;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface PromptSnippet {
  id: string;
  userId: string;
  groupId: string;
  title: string;
  content: string;
  order: number;
  createdAt: string;
  updatedAt: string;
}

/** 提示词内容版本（资产化沉淀：内容变更自动留痕，可回滚）。 */
export interface PromptSnippetVersion {
  id: string;
  snippetId: string;
  userId: string;
  /** 版本号（同一 snippet 内单调递增，从 1 开始）。 */
  version: number;
  title: string;
  content: string;
  /** 创建来源：'created' = 首次创建；'updated' = 内容更新；'restored' = 回滚到历史版本。 */
  source: 'created' | 'updated' | 'restored';
  createdAt: string;
}

export interface CreateGroupInput {
  name: string;
  order?: number;
}

export interface UpdateGroupInput {
  name?: string;
  order?: number;
}

export interface CreateSnippetInput {
  groupId: string;
  title: string;
  content: string;
  order?: number;
}

export interface UpdateSnippetInput {
  title?: string;
  content?: string;
  groupId?: string;
  order?: number;
  /** 版本来源标记：'restored' 表示该更新来自回滚，用于版本历史留痕。 */
  source?: 'updated' | 'restored';
}

// ─── Client Interface ───────────────────────────────────────────────────────

export interface PromptSnippetsClient {
  listGroups(token: string, options?: { signal?: AbortSignal }): Promise<PromptSnippetGroup[]>;
  createGroup(token: string, input: CreateGroupInput): Promise<PromptSnippetGroup>;
  updateGroup(token: string, groupId: string, input: UpdateGroupInput): Promise<PromptSnippetGroup>;
  deleteGroup(token: string, groupId: string): Promise<void>;

  listSnippets(
    token: string,
    options?: { groupId?: string; signal?: AbortSignal },
  ): Promise<PromptSnippet[]>;
  createSnippet(token: string, input: CreateSnippetInput): Promise<PromptSnippet>;
  updateSnippet(
    token: string,
    snippetId: string,
    input: UpdateSnippetInput,
  ): Promise<PromptSnippet>;
  deleteSnippet(token: string, snippetId: string): Promise<void>;

  listSnippetVersions(
    token: string,
    snippetId: string,
    options?: { signal?: AbortSignal },
  ): Promise<PromptSnippetVersion[]>;
  restoreSnippetVersion(token: string, snippetId: string, version: number): Promise<PromptSnippet>;
}

function buildPromptSnippetsActionErrorMessage(
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
    return `目标提示词资源不存在，无法${actionLabel}。`;
  }
  if (status === 409) {
    return `当前状态不允许${actionLabel}。`;
  }
  return `${actionLabel}失败（HTTP ${status}）。`;
}

function isGenericPromptSnippetsNetworkErrorMessage(message: string): boolean {
  return isGenericFetchErrorMessage(message);
}

function normalizePromptSnippetsError(actionLabel: string, error: unknown): Error {
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
    if (message.length > 0 && !isGenericPromptSnippetsNetworkErrorMessage(message)) {
      return error;
    }
  }
  return new Error(`网络异常，${actionLabel}失败。`);
}

async function performPromptSnippetsRequest<T>(input: {
  actionLabel: string;
  parseJson?: boolean;
  request: () => Promise<Response>;
}): Promise<T> {
  try {
    const response = await input.request();
    if (!response.ok) {
      const data = await readJsonErrorData<JsonErrorData>(response);
      throw new HttpError(
        buildPromptSnippetsActionErrorMessage(input.actionLabel, response.status, data),
        response.status,
        data,
      );
    }
    if (input.parseJson === false || response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  } catch (error) {
    throw normalizePromptSnippetsError(input.actionLabel, error);
  }
}

// ─── Factory ────────────────────────────────────────────────────────────────

export function createPromptSnippetsClient(baseUrl: string): PromptSnippetsClient {
  return {
    async listGroups(token, options) {
      const data = await performPromptSnippetsRequest<{ groups: PromptSnippetGroup[] }>({
        actionLabel: '读取提示词分组',
        request: () =>
          fetchWithTimeout(`${baseUrl}/prompt-snippets/groups`, {
            headers: authHeader(token),
            signal: options?.signal,
          }),
      });
      return data.groups;
    },

    async createGroup(token, input) {
      const data = await performPromptSnippetsRequest<{ group: PromptSnippetGroup }>({
        actionLabel: '创建提示词分组',
        request: () =>
          fetchWithTimeout(`${baseUrl}/prompt-snippets/groups`, {
            method: 'POST',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify(input),
          }),
      });
      return data.group;
    },

    async updateGroup(token, groupId, input) {
      const data = await performPromptSnippetsRequest<{ group: PromptSnippetGroup }>({
        actionLabel: '更新提示词分组',
        request: () =>
          fetchWithTimeout(`${baseUrl}/prompt-snippets/groups/${encodeURIComponent(groupId)}`, {
            method: 'PUT',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify(input),
          }),
      });
      return data.group;
    },

    async deleteGroup(token, groupId) {
      await performPromptSnippetsRequest({
        actionLabel: '删除提示词分组',
        parseJson: false,
        request: () =>
          fetchWithTimeout(`${baseUrl}/prompt-snippets/groups/${encodeURIComponent(groupId)}`, {
            method: 'DELETE',
            headers: authHeader(token),
          }),
      });
    },

    async listSnippets(token, options) {
      const params = new URLSearchParams();
      if (options?.groupId) {
        params.set('groupId', options.groupId);
      }
      const suffix = params.toString();
      const data = await performPromptSnippetsRequest<{ snippets: PromptSnippet[] }>({
        actionLabel: '读取提示词条目',
        request: () =>
          fetchWithTimeout(`${baseUrl}/prompt-snippets${suffix ? `?${suffix}` : ''}`, {
            headers: authHeader(token),
            signal: options?.signal,
          }),
      });
      return data.snippets;
    },

    async createSnippet(token, input) {
      const data = await performPromptSnippetsRequest<{ snippet: PromptSnippet }>({
        actionLabel: '创建提示词条目',
        request: () =>
          fetchWithTimeout(`${baseUrl}/prompt-snippets`, {
            method: 'POST',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify(input),
          }),
      });
      return data.snippet;
    },

    async updateSnippet(token, snippetId, input) {
      const data = await performPromptSnippetsRequest<{ snippet: PromptSnippet }>({
        actionLabel: '更新提示词条目',
        request: () =>
          fetchWithTimeout(`${baseUrl}/prompt-snippets/${encodeURIComponent(snippetId)}`, {
            method: 'PUT',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify(input),
          }),
      });
      return data.snippet;
    },

    async deleteSnippet(token, snippetId) {
      await performPromptSnippetsRequest({
        actionLabel: '删除提示词条目',
        parseJson: false,
        request: () =>
          fetchWithTimeout(`${baseUrl}/prompt-snippets/${encodeURIComponent(snippetId)}`, {
            method: 'DELETE',
            headers: authHeader(token),
          }),
      });
    },

    async listSnippetVersions(token, snippetId, options) {
      const data = await performPromptSnippetsRequest<{ versions: PromptSnippetVersion[] }>({
        actionLabel: '读取提示词版本历史',
        request: () =>
          fetchWithTimeout(`${baseUrl}/prompt-snippets/${encodeURIComponent(snippetId)}/versions`, {
            headers: authHeader(token),
            signal: options?.signal,
          }),
      });
      return data.versions;
    },

    async restoreSnippetVersion(token, snippetId, version) {
      const data = await performPromptSnippetsRequest<{ snippet: PromptSnippet }>({
        actionLabel: '回滚提示词版本',
        request: () =>
          fetchWithTimeout(
            `${baseUrl}/prompt-snippets/${encodeURIComponent(snippetId)}/versions/${version}/restore`,
            {
              method: 'PUT',
              headers: jsonAuthHeaders(token),
            },
          ),
      });
      return data.snippet;
    },
  };
}
