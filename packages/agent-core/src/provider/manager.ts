import {
  BUILTIN_PROVIDER_TYPES,
  type BuiltinProviderType,
  getBuiltinProviderPreset,
} from './presets.js';
import type { ProviderPersistenceAdapter } from './persistence.js';
import type {
  AIModelConfig,
  AIProvider,
  ActiveSelection,
  ProviderConfig,
  ProviderManager,
  ProviderType,
} from './types.js';
import { mergeBuiltinModels, normalizeProviderBaseUrl } from './utils.js';
import * as ModelsDev from './models-dev.js';

const cloneModel = (model: AIModelConfig): AIModelConfig => ({
  ...model,
  thinking: model.thinking ? { ...model.thinking } : undefined,
  requestOverrides: model.requestOverrides
    ? {
        ...model.requestOverrides,
        headers: model.requestOverrides.headers ? { ...model.requestOverrides.headers } : undefined,
        body: model.requestOverrides.body ? { ...model.requestOverrides.body } : undefined,
        omitBodyKeys: model.requestOverrides.omitBodyKeys
          ? [...model.requestOverrides.omitBodyKeys]
          : undefined,
      }
    : undefined,
});

const cloneProvider = (provider: AIProvider): AIProvider => ({
  ...provider,
  oauth: provider.oauth ? { ...provider.oauth } : undefined,
  requestOverrides: provider.requestOverrides
    ? {
        ...provider.requestOverrides,
        headers: provider.requestOverrides.headers
          ? { ...provider.requestOverrides.headers }
          : undefined,
        body: provider.requestOverrides.body ? { ...provider.requestOverrides.body } : undefined,
        omitBodyKeys: provider.requestOverrides.omitBodyKeys
          ? [...provider.requestOverrides.omitBodyKeys]
          : undefined,
      }
    : undefined,
  defaultModels: provider.defaultModels.map((model) => cloneModel(model)),
});

const nowIso = (): string => new Date().toISOString();

const isBuiltinType = (type: ProviderType): type is BuiltinProviderType =>
  BUILTIN_PROVIDER_TYPES.includes(type as BuiltinProviderType);

export class ProviderManagerImpl implements ProviderManager {
  private readonly providerMap = new Map<string, AIProvider>();

  private active: ActiveSelection;

  private persistenceAdapter?: ProviderPersistenceAdapter;

  public constructor(initialConfig?: Partial<ProviderConfig>) {
    const initialProviders = initialConfig?.providers
      ? initialConfig.providers.map((provider) => cloneProvider(provider))
      : BUILTIN_PROVIDER_TYPES.map((type) => getBuiltinProviderPreset(type));

    for (const provider of initialProviders) {
      const normalized = {
        ...provider,
        baseUrl: normalizeProviderBaseUrl(provider.baseUrl),
      };
      this.providerMap.set(normalized.id, normalized);
    }

    this.active = initialConfig?.active ??
      this.pickFirstAvailableSelection() ?? {
        chat: { providerId: '', modelId: '' },
        fast: { providerId: '', modelId: '' },
      };
  }

  public listProviders(): AIProvider[] {
    return Array.from(this.providerMap.values()).map((provider) => cloneProvider(provider));
  }

  public setPersistenceAdapter(adapter: ProviderPersistenceAdapter): void {
    if (this.persistenceAdapter === adapter) {
      return;
    }

    this.persistenceAdapter = adapter;
  }

  public addProviderFromPreset(type: ProviderType, overrides?: Partial<AIProvider>): AIProvider {
    const now = nowIso();
    const baseProvider = isBuiltinType(type)
      ? getBuiltinProviderPreset(type)
      : {
          id: `custom-${now}`,
          type,
          name: 'Custom Provider',
          enabled: true,
          baseUrl: '',
          defaultModels: [],
          createdAt: now,
          updatedAt: now,
        };

    const provider: AIProvider = {
      ...baseProvider,
      ...overrides,
      id: overrides?.id ?? baseProvider.id,
      type: baseProvider.type,
      baseUrl: normalizeProviderBaseUrl(overrides?.baseUrl ?? baseProvider.baseUrl),
      defaultModels: (overrides?.defaultModels ?? baseProvider.defaultModels).map((model) =>
        cloneModel(model),
      ),
      createdAt: baseProvider.createdAt,
      updatedAt: now,
    };

    this.providerMap.set(provider.id, provider);
    this.ensureActiveSelectionValid();
    return cloneProvider(provider);
  }

  public updateProvider(
    providerId: string,
    updates: Partial<Omit<AIProvider, 'id' | 'type' | 'defaultModels'>>,
  ): AIProvider {
    const current = this.getProviderOrThrow(providerId);
    const next: AIProvider = {
      ...current,
      ...updates,
      baseUrl: updates.baseUrl
        ? normalizeProviderBaseUrl(updates.baseUrl)
        : normalizeProviderBaseUrl(current.baseUrl),
      updatedAt: nowIso(),
    };

    this.providerMap.set(providerId, next);
    this.ensureActiveSelectionValid();
    return cloneProvider(next);
  }

  public removeProvider(providerId: string): boolean {
    const removed = this.providerMap.delete(providerId);
    if (removed) {
      this.ensureActiveSelectionValid();
    }
    return removed;
  }

  public toggleProviderEnabled(providerId: string, enabled?: boolean): AIProvider {
    const provider = this.getProviderOrThrow(providerId);
    const next: AIProvider = {
      ...provider,
      enabled: enabled ?? !provider.enabled,
      updatedAt: nowIso(),
    };
    this.providerMap.set(providerId, next);
    this.ensureActiveSelectionValid();
    return cloneProvider(next);
  }

  public addModel(providerId: string, model: AIModelConfig): AIProvider {
    const provider = this.getProviderOrThrow(providerId);
    if (provider.defaultModels.some((item) => item.id === model.id)) {
      throw new Error(`Model already exists: ${model.id}`);
    }

    const next: AIProvider = {
      ...provider,
      defaultModels: [...provider.defaultModels.map((item) => cloneModel(item)), cloneModel(model)],
      updatedAt: nowIso(),
    };
    this.providerMap.set(providerId, next);
    this.ensureActiveSelectionValid();
    return cloneProvider(next);
  }

  public updateModel(
    providerId: string,
    modelId: string,
    updates: Partial<AIModelConfig>,
  ): AIProvider {
    const provider = this.getProviderOrThrow(providerId);

    let found = false;
    const models = provider.defaultModels.map((model) => {
      if (model.id !== modelId) {
        return cloneModel(model);
      }
      found = true;
      return {
        ...cloneModel(model),
        ...updates,
        id: model.id,
      };
    });

    if (!found) {
      throw new Error(`Model not found: ${modelId}`);
    }

    const next: AIProvider = {
      ...provider,
      defaultModels: models,
      updatedAt: nowIso(),
    };
    this.providerMap.set(providerId, next);
    this.ensureActiveSelectionValid();
    return cloneProvider(next);
  }

  public removeModel(providerId: string, modelId: string): AIProvider {
    const provider = this.getProviderOrThrow(providerId);
    const models = provider.defaultModels
      .filter((model) => model.id !== modelId)
      .map((model) => cloneModel(model));

    if (models.length === provider.defaultModels.length) {
      throw new Error(`Model not found: ${modelId}`);
    }

    const next: AIProvider = {
      ...provider,
      defaultModels: models,
      updatedAt: nowIso(),
    };
    this.providerMap.set(providerId, next);
    this.ensureActiveSelectionValid();
    return cloneProvider(next);
  }

  public toggleModelEnabled(providerId: string, modelId: string, enabled?: boolean): AIProvider {
    const provider = this.getProviderOrThrow(providerId);
    let found = false;
    const models = provider.defaultModels.map((model) => {
      if (model.id !== modelId) {
        return cloneModel(model);
      }
      found = true;
      return {
        ...cloneModel(model),
        enabled: enabled ?? !model.enabled,
      };
    });

    if (!found) {
      throw new Error(`Model not found: ${modelId}`);
    }

    const next: AIProvider = {
      ...provider,
      defaultModels: models,
      updatedAt: nowIso(),
    };
    this.providerMap.set(providerId, next);
    this.ensureActiveSelectionValid();
    return cloneProvider(next);
  }

  public setActiveChat(providerId: string, modelId: string): ActiveSelection {
    this.assertProviderModelAvailable(providerId, modelId);
    this.active = {
      ...this.active,
      chat: { providerId, modelId },
    };
    return this.getActiveSelection();
  }

  public setActiveFast(providerId: string, modelId: string): ActiveSelection {
    this.assertProviderModelAvailable(providerId, modelId);
    this.active = {
      ...this.active,
      fast: { providerId, modelId },
    };
    return this.getActiveSelection();
  }

  public getChatProviderConfig(): { provider: AIProvider; model: AIModelConfig } {
    return this.getSelectionConfig(this.active.chat.providerId, this.active.chat.modelId);
  }

  public getFastProviderConfig(): { provider: AIProvider; model: AIModelConfig } {
    return this.getSelectionConfig(this.active.fast.providerId, this.active.fast.modelId);
  }

  public syncBuiltinPresets(): AIProvider[] {
    return this.syncProviderCatalog(ModelsDev.getSync() ?? undefined);
  }

  public async syncFromModelsDev(): Promise<AIProvider[]> {
    return this.syncProviderCatalog(await ModelsDev.get());
  }

  private syncProviderCatalog(data?: ModelsDev.ModelsDevData): AIProvider[] {
    for (const type of BUILTIN_PROVIDER_TYPES) {
      const builtin = getBuiltinProviderPreset(type);
      const liveProvider = data?.[type] ?? data?.[builtin.id];
      const builtinModels = this.buildBuiltinModelsFromCatalog(builtin, liveProvider);
      const existing = Array.from(this.providerMap.values()).find(
        (provider) => provider.type === type,
      );

      if (!existing) {
        this.providerMap.set(builtin.id, {
          ...builtin,
          defaultModels: builtinModels,
        });
        continue;
      }

      const next: AIProvider = {
        ...existing,
        name: builtin.name,
        baseUrl: normalizeProviderBaseUrl(existing.baseUrl || builtin.baseUrl),
        apiKeyEnv: existing.apiKeyEnv ?? builtin.apiKeyEnv,
        defaultModels: mergeBuiltinModels(
          builtinModels,
          existing.defaultModels.filter((model) => this.isSupportedBuiltinModelId(type, model.id)),
        ),
        updatedAt: nowIso(),
      };

      this.providerMap.set(existing.id, next);
    }

    this.ensureActiveSelectionValid();
    return this.listProviders();
  }

  private buildBuiltinModelsFromCatalog(
    builtin: AIProvider,
    liveProvider?: ModelsDev.ModelsDevProvider,
  ): AIModelConfig[] {
    const builtinModels = builtin.defaultModels.map((model) => cloneModel(model));
    if (!liveProvider) {
      return builtinModels;
    }

    const liveModels = liveProvider.models ?? {};
    const builtinIds = new Set(builtinModels.map((model) => model.id));
    const mergedBuiltin = builtinModels.map((model) =>
      this.mergeLiveModelIntoConfig(model, liveModels[model.id]),
    );

    const extraLiveModels = Object.entries(liveModels)
      .filter(
        ([modelId, model]) =>
          !builtinIds.has(modelId) &&
          model.status !== 'deprecated' &&
          this.isSupportedBuiltinModelId(builtin.id as BuiltinProviderType, modelId),
      )
      .sort(([leftId, left], [rightId, right]) =>
        (left.name ?? leftId).localeCompare(right.name ?? rightId),
      )
      .map(([modelId, model]) => this.createModelFromCatalog(modelId, model));

    return [...mergedBuiltin, ...extraLiveModels];
  }

  private mergeLiveModelIntoConfig(
    model: AIModelConfig,
    live?: ModelsDev.ModelsDevModel,
  ): AIModelConfig {
    if (!live) {
      return model;
    }

    return {
      ...model,
      label: model.label || live.name || model.id,
      contextWindow: live.limit?.context ?? model.contextWindow,
      maxOutputTokens: live.limit?.output ?? model.maxOutputTokens,
      supportsTools: live.tool_call ?? model.supportsTools,
      supportsThinking: live.reasoning ?? model.supportsThinking,
      supportsVision: live.modalities?.input
        ? live.modalities.input.includes('image')
        : model.supportsVision,
      inputPricePerMillion: live.cost?.input ?? model.inputPricePerMillion,
      outputPricePerMillion: live.cost?.output ?? model.outputPricePerMillion,
    };
  }

  private isSupportedBuiltinModelId(type: BuiltinProviderType, modelId: string): boolean {
    if (type === 'openai' && modelId === 'gpt-5.1-nano') {
      return false;
    }

    return true;
  }

  private createModelFromCatalog(modelId: string, live: ModelsDev.ModelsDevModel): AIModelConfig {
    return {
      id: modelId,
      label: live.name || modelId,
      enabled: live.status !== 'deprecated',
      contextWindow: live.limit?.context,
      maxOutputTokens: live.limit?.output,
      supportsTools: live.tool_call ?? false,
      supportsVision: live.modalities?.input?.includes('image') ?? false,
      supportsThinking: live.reasoning ?? false,
      inputPricePerMillion: live.cost?.input,
      outputPricePerMillion: live.cost?.output,
    };
  }

  public getConfig(): ProviderConfig {
    return {
      providers: this.listProviders(),
      active: this.getActiveSelection(),
    };
  }

  private getProviderOrThrow(providerId: string): AIProvider {
    const provider = this.providerMap.get(providerId);
    if (!provider) {
      throw new Error(`Provider not found: ${providerId}`);
    }
    return provider;
  }

  private assertProviderModelAvailable(providerId: string, modelId: string): void {
    const provider = this.getProviderOrThrow(providerId);
    if (!provider.enabled) {
      throw new Error(`Provider is disabled: ${providerId}`);
    }

    const model = provider.defaultModels.find((item) => item.id === modelId);
    if (!model) {
      throw new Error(`Model not found: ${modelId}`);
    }
    if (!model.enabled) {
      throw new Error(`Model is disabled: ${modelId}`);
    }
  }

  private getSelectionConfig(
    providerId: string,
    modelId: string,
  ): { provider: AIProvider; model: AIModelConfig } {
    const provider = this.getProviderOrThrow(providerId);
    const model = provider.defaultModels.find((item) => item.id === modelId);
    if (!model) {
      throw new Error(`Model not found: ${modelId}`);
    }

    return {
      provider: cloneProvider(provider),
      model: cloneModel(model),
    };
  }

  private ensureActiveSelectionValid(): void {
    const chatValid = this.isSelectionValid(this.active.chat);
    const fastValid = this.isSelectionValid(this.active.fast);
    const fallback = this.pickFirstAvailableSelection();

    if (!fallback) {
      this.active = {
        chat: { providerId: '', modelId: '' },
        fast: { providerId: '', modelId: '' },
      };
      return;
    }

    this.active = {
      chat: chatValid ? this.active.chat : fallback.chat,
      fast: fastValid ? this.active.fast : fallback.fast,
    };
  }

  private isSelectionValid(selection: { providerId: string; modelId: string }): boolean {
    const provider = this.providerMap.get(selection.providerId);
    if (!provider || !provider.enabled) {
      return false;
    }

    return provider.defaultModels.some((model) => model.id === selection.modelId && model.enabled);
  }

  private pickFirstAvailableSelection(): ActiveSelection | undefined {
    const candidates = Array.from(this.providerMap.values())
      .filter((provider) => provider.enabled)
      .map((provider) => {
        const model = provider.defaultModels.find((item) => item.enabled);
        return model ? { providerId: provider.id, modelId: model.id } : undefined;
      })
      .filter((item): item is { providerId: string; modelId: string } => item !== undefined);

    const first = candidates[0];
    if (!first) {
      return undefined;
    }

    return {
      chat: first,
      fast: candidates[1] ?? first,
    };
  }

  private getActiveSelection(): ActiveSelection {
    return {
      chat: { ...this.active.chat },
      fast: { ...this.active.fast },
    };
  }
}
