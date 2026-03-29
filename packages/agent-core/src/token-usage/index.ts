export interface TokenUsageRecord {
  id: string;
  sessionId: string;
  providerId: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  costUsd: number;
  timestamp: number;
}

export interface MonthlyUsageSummary {
  month: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  byProvider: Record<string, { inputTokens: number; outputTokens: number; costUsd: number }>;
}

export interface TokenUsageManager {
  record(entry: Omit<TokenUsageRecord, 'id'>): TokenUsageRecord;
  getMonthly(month: string): MonthlyUsageSummary;
  listRecords(sessionId?: string): TokenUsageRecord[];
}

function generateId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function getMonthKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 7);
}

export class TokenUsageManagerImpl implements TokenUsageManager {
  private records: TokenUsageRecord[] = [];

  record(entry: Omit<TokenUsageRecord, 'id'>): TokenUsageRecord {
    const created: TokenUsageRecord = {
      ...entry,
      id: generateId(),
    };
    this.records.push(created);
    return created;
  }

  getMonthly(month: string): MonthlyUsageSummary {
    const summary: MonthlyUsageSummary = {
      month,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCostUsd: 0,
      byProvider: {},
    };

    for (const record of this.records) {
      if (getMonthKey(record.timestamp) !== month) {
        continue;
      }
      summary.totalInputTokens += record.inputTokens;
      summary.totalOutputTokens += record.outputTokens;
      summary.totalCostUsd += record.costUsd;

      const existing = summary.byProvider[record.providerId] ?? {
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
      };
      existing.inputTokens += record.inputTokens;
      existing.outputTokens += record.outputTokens;
      existing.costUsd += record.costUsd;
      summary.byProvider[record.providerId] = existing;
    }

    return summary;
  }

  listRecords(sessionId?: string): TokenUsageRecord[] {
    if (!sessionId) {
      return [...this.records];
    }
    return this.records.filter((record) => record.sessionId === sessionId);
  }
}
