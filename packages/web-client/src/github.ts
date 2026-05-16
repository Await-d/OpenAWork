/**
 * `/github/triggers` 客户端：注册 GitHub webhook 触发器。
 */

import { authHeader, expectJson, jsonAuthHeaders, readJsonErrorData, HttpError } from './http.js';

export interface GitHubTrigger {
  events: string[];
  repo: string;
}

export interface CreateGitHubTriggerInput {
  events: string[];
  repoFullNameOwnerSlashRepo: string;
}

export interface GitHubClient {
  listTriggers(token: string, options?: { signal?: AbortSignal }): Promise<GitHubTrigger[]>;
  createTrigger(token: string, input: CreateGitHubTriggerInput): Promise<void>;
}

export function createGitHubClient(baseUrl: string): GitHubClient {
  return {
    async listTriggers(token, options) {
      const response = await fetch(`${baseUrl}/github/triggers`, {
        headers: authHeader(token),
        signal: options?.signal,
      });
      const data = await expectJson<{ triggers: GitHubTrigger[] }>(response, 'github.listTriggers');
      return data.triggers ?? [];
    },

    async createTrigger(token, input) {
      const response = await fetch(`${baseUrl}/github/triggers`, {
        method: 'POST',
        headers: jsonAuthHeaders(token),
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        const data = await readJsonErrorData<{ message?: string; error?: string }>(response);
        throw new HttpError(
          data?.message ?? data?.error ?? `Failed to create GitHub trigger: ${response.status}`,
          response.status,
          data,
        );
      }
    },
  };
}
