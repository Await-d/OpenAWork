/**
 * `/cron/jobs` 客户端：列表 + 启停 + 删除。
 *
 * 网关使用通用 PATCH 设置 `enabled` 字段，DELETE 永久移除。
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

export interface CronJobRecord {
  id: string;
  name: string;
  expression: string;
  status: 'enabled' | 'disabled';
  [key: string]: unknown;
}

export interface CronJobsResponse {
  jobs: CronJobRecord[];
}

export interface CronClient {
  list(token: string, options?: { signal?: AbortSignal }): Promise<CronJobRecord[]>;
  setEnabled(token: string, jobId: string, enabled: boolean): Promise<void>;
  remove(token: string, jobId: string): Promise<void>;
}

function buildCronActionErrorMessage(
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
    return `目标定时任务不存在，无法${actionLabel}。`;
  }
  if (status === 409) {
    return `当前状态不允许${actionLabel}。`;
  }
  return `${actionLabel}失败（HTTP ${status}）。`;
}

function isGenericCronNetworkErrorMessage(message: string): boolean {
  return isGenericFetchErrorMessage(message);
}

function normalizeCronError(actionLabel: string, error: unknown): Error {
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
    if (message.length > 0 && !isGenericCronNetworkErrorMessage(message)) {
      return error;
    }
  }
  return new Error(`网络异常，${actionLabel}失败。`);
}

async function performCronRequest<T>(input: {
  actionLabel: string;
  parseJson?: boolean;
  request: () => Promise<Response>;
}): Promise<T> {
  try {
    const response = await input.request();
    if (!response.ok) {
      const data = await readJsonErrorData<JsonErrorData>(response);
      throw new HttpError(
        buildCronActionErrorMessage(input.actionLabel, response.status, data),
        response.status,
        data,
      );
    }
    if (input.parseJson === false || response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  } catch (error) {
    throw normalizeCronError(input.actionLabel, error);
  }
}

export function createCronClient(baseUrl: string): CronClient {
  return {
    async list(token, options) {
      const data = await performCronRequest<CronJobsResponse>({
        actionLabel: '读取定时任务列表',
        request: () =>
          fetchWithTimeout(`${baseUrl}/cron/jobs`, {
            headers: authHeader(token),
            signal: options?.signal,
          }),
      });
      return data.jobs ?? [];
    },

    async setEnabled(token, jobId, enabled) {
      await performCronRequest({
        actionLabel: enabled ? '启用定时任务' : '停用定时任务',
        parseJson: false,
        request: () =>
          fetchWithTimeout(`${baseUrl}/cron/jobs/${encodeURIComponent(jobId)}`, {
            method: 'PATCH',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify({ enabled }),
          }),
      });
    },

    async remove(token, jobId) {
      await performCronRequest({
        actionLabel: '删除定时任务',
        parseJson: false,
        request: () =>
          fetchWithTimeout(`${baseUrl}/cron/jobs/${encodeURIComponent(jobId)}`, {
            method: 'DELETE',
            headers: authHeader(token),
          }),
      });
    },
  };
}
