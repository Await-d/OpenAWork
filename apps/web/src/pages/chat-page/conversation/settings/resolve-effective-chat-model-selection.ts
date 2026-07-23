import type {
  ChatSettingsModel,
  ChatSettingsProvider,
} from '../../../../utils/chat/chat-session-defaults.js';

export type EffectiveChatModelSelectionSource =
  'selected' | 'defaults' | 'catalog_fallback' | 'unresolved';

export interface EffectiveChatModelSelection {
  readonly model: ChatSettingsModel | null;
  readonly modelId: string;
  readonly provider: ChatSettingsProvider | null;
  readonly providerId: string;
  readonly rawSelectionInvalid: boolean;
  readonly source: EffectiveChatModelSelectionSource;
}

interface ProviderModelPair {
  readonly model: ChatSettingsModel;
  readonly provider: ChatSettingsProvider;
}

function normalizeSelectionValue(value: string | null | undefined): string {
  return value?.trim() ?? '';
}

function findProviderModel(
  providers: ChatSettingsProvider[],
  providerId: string,
  modelId: string,
): ProviderModelPair | null {
  if (!providerId || !modelId) {
    return null;
  }

  const provider = providers.find((candidate) => candidate.id === providerId);
  const model = provider?.defaultModels.find((candidate) => candidate.id === modelId);
  return provider && model ? { model, provider } : null;
}

function findFirstAvailableProviderModel(
  providers: ChatSettingsProvider[],
): ProviderModelPair | null {
  const provider = providers.find((candidate) => candidate.defaultModels.length > 0);
  const model = provider?.defaultModels[0];
  return provider && model ? { model, provider } : null;
}

export function resolveEffectiveChatModelSelection(input: {
  defaultModelId?: string | null;
  defaultProviderId?: string | null;
  providers: ChatSettingsProvider[];
  selectedModelId?: string | null;
  selectedProviderId?: string | null;
}): EffectiveChatModelSelection {
  const selectedProviderId = normalizeSelectionValue(input.selectedProviderId);
  const selectedModelId = normalizeSelectionValue(input.selectedModelId);
  const hasRawSelection = selectedProviderId.length > 0 || selectedModelId.length > 0;
  const selected = findProviderModel(input.providers, selectedProviderId, selectedModelId);
  if (selected) {
    return {
      model: selected.model,
      modelId: selected.model.id,
      provider: selected.provider,
      providerId: selected.provider.id,
      rawSelectionInvalid: false,
      source: 'selected',
    };
  }

  const defaultSelection = findProviderModel(
    input.providers,
    normalizeSelectionValue(input.defaultProviderId),
    normalizeSelectionValue(input.defaultModelId),
  );
  if (defaultSelection) {
    return {
      model: defaultSelection.model,
      modelId: defaultSelection.model.id,
      provider: defaultSelection.provider,
      providerId: defaultSelection.provider.id,
      rawSelectionInvalid: hasRawSelection,
      source: 'defaults',
    };
  }

  const catalogFallback = findFirstAvailableProviderModel(input.providers);
  if (catalogFallback) {
    return {
      model: catalogFallback.model,
      modelId: catalogFallback.model.id,
      provider: catalogFallback.provider,
      providerId: catalogFallback.provider.id,
      rawSelectionInvalid: hasRawSelection,
      source: 'catalog_fallback',
    };
  }

  return {
    model: null,
    modelId: '',
    provider: null,
    providerId: '',
    rawSelectionInvalid: hasRawSelection,
    source: 'unresolved',
  };
}
