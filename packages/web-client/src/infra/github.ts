/**
 * `/github/triggers` 客户端：注册 GitHub webhook 触发器。
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

function buildGitHubActionErrorMessage(
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
    return `目标 GitHub 资源不存在，无法${actionLabel}。`;
  }
  if (status === 409) {
    return `当前状态不允许${actionLabel}。`;
  }
  return `${actionLabel}失败（HTTP ${status}）。`;
}

function isGenericGitHubNetworkErrorMessage(message: string): boolean {
  return isGenericFetchErrorMessage(message);
}

function normalizeGitHubError(actionLabel: string, error: unknown): Error {
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
    if (message.length > 0 && !isGenericGitHubNetworkErrorMessage(message)) {
      return error;
    }
  }
  return new Error(`网络异常，${actionLabel}失败。`);
}

async function performGitHubRequest<T>(input: {
  actionLabel: string;
  parseJson?: boolean;
  request: () => Promise<Response>;
}): Promise<T> {
  try {
    const response = await input.request();
    if (!response.ok) {
      const data = await readJsonErrorData<JsonErrorData>(response);
      throw new HttpError(
        buildGitHubActionErrorMessage(input.actionLabel, response.status, data),
        response.status,
        data,
      );
    }
    if (input.parseJson === false || response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  } catch (error) {
    throw normalizeGitHubError(input.actionLabel, error);
  }
}

export function createGitHubClient(baseUrl: string): GitHubClient {
  return {
    async listTriggers(token, options) {
      const data = await performGitHubRequest<{ triggers: GitHubTrigger[] }>({
        actionLabel: '读取 GitHub 触发器',
        request: () =>
          fetchWithTimeout(`${baseUrl}/github/triggers`, {
            headers: authHeader(token),
            signal: options?.signal,
          }),
      });
      return data.triggers ?? [];
    },

    async createTrigger(token, input) {
      await performGitHubRequest({
        actionLabel: '创建 GitHub 触发器',
        parseJson: false,
        request: () =>
          fetchWithTimeout(`${baseUrl}/github/triggers`, {
            method: 'POST',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify(input),
          }),
      });
    },
  };
}
