export interface ProviderQuota {
  providerId: string;
  planType?: string;
  requestsUsed?: number;
  requestsLimit?: number;
  requestsResetAt?: number;
  tokensUsed?: number;
  tokensLimit?: number;
  tokensResetAt?: number;
  fetchedAt: number;
}

export interface QuotaManager {
  getQuota(providerId: string): ProviderQuota | null;
  updateFromHeaders(providerId: string, headers: Record<string, string>): void;
  subscribe(cb: (providerId: string, quota: ProviderQuota) => void): () => void;
  clearQuota(providerId: string): void;
}
