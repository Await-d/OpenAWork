/**
 * `/usage/*` 接口客户端：用量记录与费用拆分。
 *
 * - GET `/usage/records` → `{ records, budgetUsd }`，最近 12 个月用量。
 * - GET `/usage/breakdown` → `{ monthlyCostUsd, breakdown }`，本月费用按模型拆分。
 */

import { authHeader, expectJson } from './http.js';

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

export function createUsageClient(baseUrl: string): UsageClient {
  return {
    async getRecords(token, options) {
      const response = await fetch(`${baseUrl}/usage/records`, {
        headers: authHeader(token),
        signal: options?.signal,
      });
      return expectJson<UsageRecordsResponse>(response, 'getUsageRecords');
    },

    async getBreakdown(token, options) {
      const response = await fetch(`${baseUrl}/usage/breakdown`, {
        headers: authHeader(token),
        signal: options?.signal,
      });
      return expectJson<UsageBreakdownResponse>(response, 'getUsageBreakdown');
    },
  };
}
