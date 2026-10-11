import type { AIModelConfigItem, AIModelConfigRef, AIProviderRef } from '@openAwork/shared-ui';
import { normalizeModelIdKey } from '../shared/upstream-model-mapping.js';

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

/**
 * 仅补齐 `current` 中**未定义**的元数据字段(不覆盖用户已有取值,也不动 `enabled`),
 * 无实际变化时返回原引用。
 */
function fillMissingModelMetadata(
  current: AIModelConfigRef,
  incoming: AIModelConfigItem,
): AIModelConfigRef {
  const merged: AIModelConfigRef = {
    ...current,
    contextWindow: current.contextWindow ?? incoming.contextWindow,
    contextWindowOverride: current.contextWindowOverride ?? incoming.contextWindowOverride,
    maxOutputTokens: current.maxOutputTokens ?? incoming.maxOutputTokens,
    inputPricePerMillion: current.inputPricePerMillion ?? incoming.inputPricePerMillion,
    outputPricePerMillion: current.outputPricePerMillion ?? incoming.outputPricePerMillion,
    autoCompactTargetRatio: current.autoCompactTargetRatio ?? incoming.autoCompactTargetRatio,
    autoCompactThresholdRatio:
      current.autoCompactThresholdRatio ?? incoming.autoCompactThresholdRatio,
    supportsTools: current.supportsTools ?? incoming.supportsTools,
    supportsVision: current.supportsVision ?? incoming.supportsVision,
    supportsThinking: current.supportsThinking ?? incoming.supportsThinking,
    supportsImageGeneration: current.supportsImageGeneration ?? incoming.supportsImageGeneration,
    supportsImageGeneration4K:
      current.supportsImageGeneration4K ?? incoming.supportsImageGeneration4K,
    reasoningOptions: current.reasoningOptions ?? incoming.reasoningOptions,
  };

  const changed = (Object.keys(merged) as (keyof AIModelConfigRef)[]).some(
    (key) => merged[key] !== current[key],
  );
  return changed ? merged : current;
}

/**
 * 批量并入模型(用于「拉取上游模型」后一次性同步):
 *   - 不存在的新模型:直接追加(携带由本地同名模型迁移来的上下文 / 能力 / 价格);
 *   - 已存在的模型:只**补齐缺失字段**(如为空则迁移上下文大小与能力),
 *     不覆盖用户已有的显式配置,也不改动 `enabled`。
 *
 * 去重按**大小写不敏感**判定(`gpt-4o` 与 `GPT-4o` 视为同一模型),避免上游与本地
 * 大小写差异导致重复添加;写回时保留已有条目的原始 id。
 */
export function addProviderModels(
  providers: AIProviderRef[],
  providerId: string,
  models: AIModelConfigItem[],
): AIProviderRef[] {
  return providers.map((provider) => {
    if (provider.id !== providerId) {
      return provider;
    }
    const nextModels = [...provider.defaultModels];
    const indexById = new Map(
      nextModels.map((model, index) => [normalizeModelIdKey(model.id), index]),
    );
    let changed = false;

    for (const incoming of models) {
      const key = normalizeModelIdKey(incoming.id);
      const existingIndex = indexById.get(key);
      if (existingIndex === undefined) {
        indexById.set(key, nextModels.length);
        nextModels.push(incoming);
        changed = true;
        continue;
      }
      const current = nextModels[existingIndex];
      if (!current) continue;
      const merged = fillMissingModelMetadata(current, incoming);
      if (merged !== current) {
        nextModels[existingIndex] = merged;
        changed = true;
      }
    }

    return changed ? { ...provider, defaultModels: nextModels } : provider;
  });
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

/**
 * 批量更新同一 provider 下多个模型的字段(如「批量设置思考档位」)。
 *
 * 把每条 `updates` 一次性合并到对应模型(合并语义与 `updateProviderModel` 完全一致),
 * 并把整批改动收敛为**一次**保存,避免逐项触发多次 PUT。未匹配到任何模型的
 * provider 原样返回(保持引用),便于无变化时不触发保存。
 *
 * 注:`reasoningOptions` 置空走 `updates.reasoningOptions = undefined`,与单模型更新
 * 语义一致——`JSON.stringify` 会丢弃 undefined 键,落库时即清除声明。
 */
export function batchUpdateProviderModels(
  providers: AIProviderRef[],
  providerId: string,
  updates: Array<{ modelId: string; updates: Partial<AIModelConfigItem> }>,
): AIProviderRef[] {
  if (updates.length === 0) return providers;
  const updatesByKey = new Map(updates.map((entry) => [normalizeModelIdKey(entry.modelId), entry]));
  return providers.map((provider) => {
    if (provider.id !== providerId) return provider;
    let changed = false;
    const nextModels = provider.defaultModels.map((model: AIModelConfigRef) => {
      const entry = updatesByKey.get(normalizeModelIdKey(model.id));
      if (!entry) return model;
      changed = true;
      return { ...model, ...entry.updates } as AIModelConfigRef;
    });
    return changed ? { ...provider, defaultModels: nextModels } : provider;
  });
}

/** 仅 custom 可移除:内置平台保存时会被后端 syncProviderCatalog 重新播种。 */
export function removeProvider(providers: AIProviderRef[], providerId: string): AIProviderRef[] {
  return providers.filter((provider) => provider.id !== providerId);
}
