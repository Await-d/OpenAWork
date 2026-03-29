import type { ProviderQuota, QuotaManager } from './types.js';

function parseResetTime(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const ms = Date.parse(value);
  return isNaN(ms) ? undefined : ms;
}

export class QuotaManagerImpl implements QuotaManager {
  private quotas: Map<string, ProviderQuota> = new Map();
  private subscribers: Set<(providerId: string, quota: ProviderQuota) => void> = new Set();

  getQuota(providerId: string): ProviderQuota | null {
    return this.quotas.get(providerId) ?? null;
  }

  updateFromHeaders(providerId: string, headers: Record<string, string>): void {
    const existing = this.quotas.get(providerId) ?? { providerId, fetchedAt: Date.now() };
    const quota: ProviderQuota = { ...existing, fetchedAt: Date.now() };

    const openaiLimit = headers['x-ratelimit-limit-requests'];
    const openaiRemaining = headers['x-ratelimit-remaining-requests'];
    const openaiReset = headers['x-ratelimit-reset-requests'];
    if (openaiLimit !== undefined) quota.requestsLimit = parseInt(openaiLimit, 10);
    if (openaiLimit !== undefined && openaiRemaining !== undefined) {
      quota.requestsUsed = parseInt(openaiLimit, 10) - parseInt(openaiRemaining, 10);
    }
    if (openaiReset !== undefined) quota.requestsResetAt = parseResetTime(openaiReset);

    const anthropicLimit = headers['anthropic-ratelimit-requests-limit'];
    const anthropicRemaining = headers['anthropic-ratelimit-requests-remaining'];
    const anthropicReset = headers['anthropic-ratelimit-requests-reset'];
    if (anthropicLimit !== undefined) quota.requestsLimit = parseInt(anthropicLimit, 10);
    if (anthropicLimit !== undefined && anthropicRemaining !== undefined) {
      quota.requestsUsed = parseInt(anthropicLimit, 10) - parseInt(anthropicRemaining, 10);
    }
    if (anthropicReset !== undefined) quota.requestsResetAt = parseResetTime(anthropicReset);

    this.quotas.set(providerId, quota);
    for (const cb of this.subscribers) cb(providerId, { ...quota });
  }

  subscribe(cb: (providerId: string, quota: ProviderQuota) => void): () => void {
    this.subscribers.add(cb);
    return () => {
      this.subscribers.delete(cb);
    };
  }

  clearQuota(providerId: string): void {
    this.quotas.delete(providerId);
  }
}
