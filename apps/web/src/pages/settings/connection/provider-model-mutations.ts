import type { AIModelConfigItem, AIModelConfigRef, AIProviderRef } from '@openAwork/shared-ui';

export function toggleProviderModel(
  providers: AIProviderRef[],
  providerId: string,
  modelId: string,
): AIProviderRef[] {
  return providers.map((provider) =>
    provider.id === providerId
      ? {
          ...provider,
          defaultModels: provider.defaultModels.map((model: AIModelConfigRef) =>
            model.id === modelId ? { ...model, enabled: !model.enabled } : model,
          ),
        }
      : provider,
  );
}

export function addProviderModel(
  providers: AIProviderRef[],
  providerId: string,
  model: AIModelConfigItem,
): AIProviderRef[] {
  return providers.map((provider) =>
    provider.id === providerId
      ? { ...provider, defaultModels: [...provider.defaultModels, model] }
      : provider,
  );
}

export function updateProviderModel(
  providers: AIProviderRef[],
  providerId: string,
  modelId: string,
  updates: Partial<AIModelConfigRef>,
): AIProviderRef[] {
  return providers.map((provider) =>
    provider.id === providerId
      ? {
          ...provider,
          defaultModels: provider.defaultModels.map((model: AIModelConfigRef) =>
            model.id === modelId ? { ...model, ...updates } : model,
          ),
        }
      : provider,
  );
}

export function removeProviderModel(
  providers: AIProviderRef[],
  providerId: string,
  modelId: string,
): AIProviderRef[] {
  return providers.map((provider) =>
    provider.id === providerId
      ? {
          ...provider,
          defaultModels: provider.defaultModels.filter(
            (model: AIModelConfigRef) => model.id !== modelId,
          ),
        }
      : provider,
  );
}
