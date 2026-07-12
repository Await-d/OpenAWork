export type ModelSelectionSource = 'metadata' | 'defaults' | 'manual';

function normalizeSelectionValue(value: string | null | undefined): string {
  return value?.trim() ?? '';
}

export function resolveModelSelectionSourceFromMetadata(input: {
  providerId?: string | null;
  modelId?: string | null;
  modelSelectionSource?: string | null;
}): ModelSelectionSource | null {
  const providerId = normalizeSelectionValue(input.providerId);
  const modelId = normalizeSelectionValue(input.modelId);
  if (providerId.length === 0 || modelId.length === 0) {
    return null;
  }

  return input.modelSelectionSource === 'manual' || input.modelSelectionSource === 'defaults'
    ? input.modelSelectionSource
    : 'metadata';
}

export function shouldAdoptSessionModelSelectionDefaults(input: {
  sessionId: string | null | undefined;
  source: ModelSelectionSource | null;
  defaultProviderId?: string | null;
  defaultModelId?: string | null;
}): boolean {
  if (!input.sessionId || input.source !== null) {
    return false;
  }

  const defaultProviderId = normalizeSelectionValue(input.defaultProviderId);
  const defaultModelId = normalizeSelectionValue(input.defaultModelId);
  return defaultProviderId.length > 0 && defaultModelId.length > 0;
}

export function shouldSendExplicitStreamModelSelection(
  source: ModelSelectionSource | null,
): boolean {
  return source === 'manual';
}
