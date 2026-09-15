import type { Message } from '@openAwork/shared';

export function hasActivePendingPermissionRequest(input: {
  isError?: boolean;
  pendingPermissionRequestId?: string;
  resumedAfterApproval?: boolean;
  status?: string;
}): boolean {
  return (
    typeof input.pendingPermissionRequestId === 'string' &&
    input.pendingPermissionRequestId.trim().length > 0 &&
    input.isError !== true &&
    input.resumedAfterApproval !== true &&
    input.status !== 'completed' &&
    input.status !== 'failed' &&
    input.status !== 'error'
  );
}

export function estimateTokenCount(text: string): number {
  const normalized = text.trim();
  if (!normalized) return 0;
  return Math.max(1, Math.round(normalized.length / 4));
}

export function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeNonNegativeTokenCount(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }

  return Math.max(0, Math.trunc(value));
}

export function normalizeProviderUsage(value: unknown): Message['providerUsage'] | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const inputTokens = normalizeNonNegativeTokenCount(record['inputTokens']);
  const outputTokens = normalizeNonNegativeTokenCount(record['outputTokens']);
  const totalTokens = normalizeNonNegativeTokenCount(record['totalTokens']);
  if (inputTokens === undefined || outputTokens === undefined || totalTokens === undefined) {
    return undefined;
  }

  const reasoningTokens = normalizeNonNegativeTokenCount(record['reasoningTokens']);
  const cacheReadTokens = normalizeNonNegativeTokenCount(record['cacheReadTokens']);
  const cacheWriteTokens = normalizeNonNegativeTokenCount(record['cacheWriteTokens']);
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
    ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
    ...(cacheWriteTokens !== undefined ? { cacheWriteTokens } : {}),
  };
}

export function normalizeCreatedAt(value: number | string | undefined): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return Date.now();
}

export function joinReasoningBlocks(blocks: string[] | undefined): string {
  if (!blocks || blocks.length === 0) return '';
  return blocks.join('\n').trim();
}

export function getComparableCreatedAt(value: number | string | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  return null;
}
