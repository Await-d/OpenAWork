/**
 * `/prompt-snippets/*` 客户端：快捷提示词分组 + 条目 CRUD。
 */

import {
  authHeader,
  expectJson,
  HttpError,
  jsonAuthHeaders,
  readJsonErrorData,
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
}

// ─── Factory ────────────────────────────────────────────────────────────────

export function createPromptSnippetsClient(baseUrl: string): PromptSnippetsClient {
  return {
    async listGroups(token, options) {
      const response = await fetch(`${baseUrl}/prompt-snippets/groups`, {
        headers: authHeader(token),
        signal: options?.signal,
      });
      const data = await expectJson<{ groups: PromptSnippetGroup[] }>(
        response,
        'prompt-snippets.groups.list',
      );
      return data.groups;
    },

    async createGroup(token, input) {
      const response = await fetch(`${baseUrl}/prompt-snippets/groups`, {
        method: 'POST',
        headers: jsonAuthHeaders(token),
        body: JSON.stringify(input),
      });
      const data = await expectJson<{ group: PromptSnippetGroup }>(
        response,
        'prompt-snippets.groups.create',
      );
      return data.group;
    },

    async updateGroup(token, groupId, input) {
      const response = await fetch(
        `${baseUrl}/prompt-snippets/groups/${encodeURIComponent(groupId)}`,
        {
          method: 'PUT',
          headers: jsonAuthHeaders(token),
          body: JSON.stringify(input),
        },
      );
      const data = await expectJson<{ group: PromptSnippetGroup }>(
        response,
        'prompt-snippets.groups.update',
      );
      return data.group;
    },

    async deleteGroup(token, groupId) {
      const response = await fetch(
        `${baseUrl}/prompt-snippets/groups/${encodeURIComponent(groupId)}`,
        {
          method: 'DELETE',
          headers: authHeader(token),
        },
      );
      if (!response.ok) {
        const data = await readJsonErrorData<{ error?: string }>(response);
        throw new HttpError(
          data?.error ?? `prompt-snippets.groups.delete failed: ${response.status}`,
          response.status,
          data,
        );
      }
    },

    async listSnippets(token, options) {
      const params = new URLSearchParams();
      if (options?.groupId) {
        params.set('groupId', options.groupId);
      }
      const suffix = params.toString();
      const response = await fetch(`${baseUrl}/prompt-snippets${suffix ? `?${suffix}` : ''}`, {
        headers: authHeader(token),
        signal: options?.signal,
      });
      const data = await expectJson<{ snippets: PromptSnippet[] }>(
        response,
        'prompt-snippets.list',
      );
      return data.snippets;
    },

    async createSnippet(token, input) {
      const response = await fetch(`${baseUrl}/prompt-snippets`, {
        method: 'POST',
        headers: jsonAuthHeaders(token),
        body: JSON.stringify(input),
      });
      const data = await expectJson<{ snippet: PromptSnippet }>(response, 'prompt-snippets.create');
      return data.snippet;
    },

    async updateSnippet(token, snippetId, input) {
      const response = await fetch(`${baseUrl}/prompt-snippets/${encodeURIComponent(snippetId)}`, {
        method: 'PUT',
        headers: jsonAuthHeaders(token),
        body: JSON.stringify(input),
      });
      const data = await expectJson<{ snippet: PromptSnippet }>(response, 'prompt-snippets.update');
      return data.snippet;
    },

    async deleteSnippet(token, snippetId) {
      const response = await fetch(`${baseUrl}/prompt-snippets/${encodeURIComponent(snippetId)}`, {
        method: 'DELETE',
        headers: authHeader(token),
      });
      if (!response.ok) {
        const data = await readJsonErrorData<{ error?: string }>(response);
        throw new HttpError(
          data?.error ?? `prompt-snippets.delete failed: ${response.status}`,
          response.status,
          data,
        );
      }
    },
  };
}
