/**
 * `/usage/*` 接口客户端：用量记录与费用拆分。
 *
 * - GET `/usage/records` → `{ records, budgetUsd }`，最近 12 个月用量。
 * - GET `/usage/breakdown` → `{ monthlyCostUsd, breakdown }`，本月费用按模型拆分。
 */

import {
  authHeader,
  extractJsonErrorMessage,
  HttpError,
  isGenericFetchErrorMessage,
  readJsonErrorData,
  type JsonErrorData,
  fetchWithTimeout,
} from '../gateway/http.js';

export interface UsageMonthlyRecord {
  month: string;
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  byProvider: Record<string, number>;
}

export interface UsageRecordsResponse {
  records: UsageMonthlyRecord[];
  budgetUsd: number;
}

export interface UsageCostBreakdownItem {
  modelName: string;
  inputCost: number;
  outputCost: number;
  totalCost: number;
}

export interface UsageBreakdownResponse {
  monthlyCostUsd: number;
  breakdown: UsageCostBreakdownItem[];
}

export interface UsageClient {
  getRecords(token: string, options?: { signal?: AbortSignal }): Promise<UsageRecordsResponse>;
  getBreakdown(token: string, options?: { signal?: AbortSignal }): Promise<UsageBreakdownResponse>;
}

function buildUsageActionErrorMessage(
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
    return `目标用量资源不存在，无法${actionLabel}。`;
  }
  if (status === 409) {
    return `当前状态不允许${actionLabel}。`;
  }
  return `${actionLabel}失败（HTTP ${status}）。`;
}

function normalizeUsageError(actionLabel: string, error: unknown): Error {
  if (error instanceof HttpError) {
    const extracted = extractJsonErrorMessage((error.data ?? undefined) as JsonErrorData | undefined);
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

async function performUsageRequest<T>(input: {
  actionLabel: string;
  request: () => Promise<Response>;
}): Promise<T> {
  try {
    const response = await input.request();
    if (!response.ok) {
      const data = await readJsonErrorData<JsonErrorData>(response);
      throw new HttpError(
        buildUsageActionErrorMessage(input.actionLabel, response.status, data),
        response.status,
        data,
      );
    }
    return (await response.json()) as T;
  } catch (error) {
    throw normalizeUsageError(input.actionLabel, error);
  }
}

export function createUsageClient(baseUrl: string): UsageClient {
  return {
    async getRecords(token, options) {
      return performUsageRequest<UsageRecordsResponse>({
        actionLabel: '读取用量记录',
        request: () =>
          fetchWithTimeout(`${baseUrl}/usage/records`, {
            headers: authHeader(token),
            signal: options?.signal,
          }),
      });
    },

    async getBreakdown(token, options) {
      return performUsageRequest<UsageBreakdownResponse>({
        actionLabel: '读取用量拆分',
        request: () =>
          fetchWithTimeout(`${baseUrl}/usage/breakdown`, {
            headers: authHeader(token),
            signal: options?.signal,
          }),
      });
    },
  };
}
