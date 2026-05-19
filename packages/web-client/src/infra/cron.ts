/**
 * `/cron/jobs` 客户端：列表 + 启停 + 删除。
 *
 * 网关使用通用 PATCH 设置 `enabled` 字段，DELETE 永久移除。
 */

import { authHeader, expectJson, expectOk, jsonAuthHeaders } from '../gateway/http.js';

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

export function createCronClient(baseUrl: string): CronClient {
  return {
    async list(token, options) {
      const response = await fetch(`${baseUrl}/cron/jobs`, {
        headers: authHeader(token),
        signal: options?.signal,
      });
      const data = await expectJson<CronJobsResponse>(response, 'listCronJobs');
      return data.jobs ?? [];
    },

    async setEnabled(token, jobId, enabled) {
      const response = await fetch(`${baseUrl}/cron/jobs/${encodeURIComponent(jobId)}`, {
        method: 'PATCH',
        headers: jsonAuthHeaders(token),
        body: JSON.stringify({ enabled }),
      });
      await expectOk(response, 'setCronJobEnabled');
    },

    async remove(token, jobId) {
      const response = await fetch(`${baseUrl}/cron/jobs/${encodeURIComponent(jobId)}`, {
        method: 'DELETE',
        headers: authHeader(token),
      });
      await expectOk(response, 'removeCronJob');
    },
  };
}
