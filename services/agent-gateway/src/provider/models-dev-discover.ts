/**
 * models.dev 发现列表与导入构建逻辑（可测纯函数）。
 *
 * 发现层把尚未内置的 models.dev 厂商列出来；导入统一落为 type: 'custom'，
 * 避免每次发现都扩展 ProviderType 联合类型。
 */
import {
  PROVIDER_CATALOG,
  normalizeProviderAlias,
  type AIModelConfig,
  type AIProvider,
  type ModelsDevData,
  type ModelsDevModel,
} from '@openAwork/agent-core';

export interface DiscoverProviderItem {
  id: string;
  name: string;
  api?: string;
  env?: string[];
  modelCount: number;
  alreadyBuiltin: boolean;
  sampleModels: Array<{ id: string; name: string }>;
}

function builtinIdSet(): Set<string> {
  const set = new Set<string>();
  for (const entry of PROVIDER_CATALOG) {
    set.add(entry.type.toLowerCase());
    for (const alias of entry.ui.aliases ?? []) {
      set.add(alias.toLowerCase());
    }
  }
  return set;
}

function isAlreadyBuiltin(id: string, builtins: Set<string>): boolean {
  const key = id.toLowerCase();
  return builtins.has(key) || builtins.has(normalizeProviderAlias(key));
}

export function listDiscoverableProviders(
  data: ModelsDevData,
  options?: { includeBuiltin?: boolean },
): DiscoverProviderItem[] {
  const builtins = builtinIdSet();
  const includeBuiltin = options?.includeBuiltin === true;
  const items: DiscoverProviderItem[] = [];

  for (const [id, provider] of Object.entries(data)) {
    const providerId = provider.id || id;
    const alreadyBuiltin = isAlreadyBuiltin(providerId, builtins) || isAlreadyBuiltin(id, builtins);
    if (alreadyBuiltin && !includeBuiltin) continue;

    const models = Object.entries(provider.models ?? {}).filter(
      ([, m]) => m.status !== 'deprecated',
    );
    items.push({
      id: providerId,
      name: provider.name || id,
      ...(provider.api ? { api: provider.api } : {}),
      ...(provider.env ? { env: [...provider.env] } : {}),
      modelCount: models.length,
      alreadyBuiltin,
      sampleModels: models.slice(0, 5).map(([mid, m]) => ({
        id: mid,
        name: m.name || mid,
      })),
    });
  }

  return items.sort((a, b) => a.name.localeCompare(b.name));
}

function mapLiveModel(modelId: string, live: ModelsDevModel): AIModelConfig {
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

export function buildCustomProviderFromModelsDev(
  data: ModelsDevData,
  modelsDevProviderId: string,
  overrides?: { name?: string; enabled?: boolean },
): AIProvider {
  const live =
    data[modelsDevProviderId] ??
    Object.values(data).find(
      (p) =>
        p.id === modelsDevProviderId ||
        p.id?.toLowerCase() === modelsDevProviderId.toLowerCase(),
    );
  if (!live) {
    throw new Error(`models.dev provider not found: ${modelsDevProviderId}`);
  }

  const now = new Date().toISOString();
  const short = now.replace(/\D/g, '').slice(-8);
  const safeId = modelsDevProviderId.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
  const models = Object.entries(live.models ?? {})
    .filter(([, m]) => m.status !== 'deprecated')
    .map(([mid, m]) => mapLiveModel(mid, m));

  // 不设置 apiKeyEnv：custom 在 sanitize 阶段不会保留 env，API Key 靠用户粘贴。
  return {
    id: `custom-md-${safeId}-${short}`,
    type: 'custom',
    name: overrides?.name?.trim() || live.name || modelsDevProviderId,
    enabled: overrides?.enabled ?? true,
    baseUrl: live.api ?? '',
    defaultModels: models,
    createdAt: now,
    updatedAt: now,
  };
}
