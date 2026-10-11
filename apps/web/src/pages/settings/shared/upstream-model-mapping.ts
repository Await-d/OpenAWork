import type {
  AIModelConfigItem,
  AIModelConfigRef,
  AIProviderRef,
  UpstreamModelItem,
  UpstreamModelMetadata,
} from '@openAwork/shared-ui';

/**
 * 上游模型条目的收敛 / 迁移工具。
 *
 * 网关 `/settings/providers/upstream-models` 返回的是自由 JSON,这里把响应体收敛为
 * `UpstreamModelItem[]`,并在导入时把「本地同名模型迁移来的元数据」(`meta`)铺平到
 * 目标模型配置里——上游 `/models` 不含上下文与能力,必须靠本地数据补齐。
 */

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

/**
 * 模型 id 的匹配键:上游与本地的大小写 / 首尾空白差异不应阻止「同名模型」匹配
 * (例如上游返回 `GPT-4o`、本地配置为 `gpt-4o`)。**仅用于匹配与去重**,
 * 写回 provider 时始终保留原始 id。
 */
export function normalizeModelIdKey(id: string): string {
  return id.trim().toLowerCase();
}

function readNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  return typeof value === 'boolean' ? value : undefined;
}

function toReasoningOptions(raw: unknown): { type: string; values?: string[] }[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const options: { type: string; values?: string[] }[] = [];
  for (const entry of raw) {
    const record = asRecord(entry);
    if (!record) continue;
    const type = typeof record['type'] === 'string' ? record['type'] : undefined;
    if (!type) continue;
    const valuesRaw = record['values'];
    const values = Array.isArray(valuesRaw)
      ? valuesRaw.filter((value): value is string => typeof value === 'string')
      : undefined;
    options.push({ type, ...(values && values.length > 0 ? { values } : {}) });
  }
  return options.length > 0 ? options : undefined;
}

/** 把网关返回的 `meta` 收敛为受控的元数据(未知 / 非法字段直接丢弃)。 */
function toMetadata(raw: unknown): UpstreamModelMetadata | undefined {
  const record = asRecord(raw);
  if (!record) return undefined;
  const meta: UpstreamModelMetadata = {};
  const contextWindow = readNumber(record, 'contextWindow');
  if (contextWindow !== undefined) meta.contextWindow = contextWindow;
  const maxOutputTokens = readNumber(record, 'maxOutputTokens');
  if (maxOutputTokens !== undefined) meta.maxOutputTokens = maxOutputTokens;
  const inputPricePerMillion = readNumber(record, 'inputPricePerMillion');
  if (inputPricePerMillion !== undefined) meta.inputPricePerMillion = inputPricePerMillion;
  const outputPricePerMillion = readNumber(record, 'outputPricePerMillion');
  if (outputPricePerMillion !== undefined) meta.outputPricePerMillion = outputPricePerMillion;
  const supportsTools = readBoolean(record, 'supportsTools');
  if (supportsTools !== undefined) meta.supportsTools = supportsTools;
  const supportsVision = readBoolean(record, 'supportsVision');
  if (supportsVision !== undefined) meta.supportsVision = supportsVision;
  const supportsThinking = readBoolean(record, 'supportsThinking');
  if (supportsThinking !== undefined) meta.supportsThinking = supportsThinking;
  const supportsImageGeneration = readBoolean(record, 'supportsImageGeneration');
  if (supportsImageGeneration !== undefined) meta.supportsImageGeneration = supportsImageGeneration;
  const supportsImageGeneration4K = readBoolean(record, 'supportsImageGeneration4K');
  if (supportsImageGeneration4K !== undefined) {
    meta.supportsImageGeneration4K = supportsImageGeneration4K;
  }
  const reasoningOptions = toReasoningOptions(record['reasoningOptions']);
  if (reasoningOptions) meta.reasoningOptions = reasoningOptions;
  return Object.keys(meta).length > 0 ? meta : undefined;
}

/** 收敛网关返回的模型数组(过滤无效项,保留本地迁移来的 `meta`)。 */
export function toUpstreamItems(raw: unknown): UpstreamModelItem[] {
  if (!Array.isArray(raw)) return [];
  const items: UpstreamModelItem[] = [];
  for (const entry of raw) {
    const record = asRecord(entry);
    if (!record) continue;
    const id = typeof record['id'] === 'string' ? record['id'] : undefined;
    if (!id) continue;
    const label =
      typeof record['label'] === 'string' && record['label'].length > 0 ? record['label'] : id;
    const ownedBy = typeof record['ownedBy'] === 'string' ? record['ownedBy'] : undefined;
    const meta = toMetadata(record['meta']);
    items.push({
      id,
      label,
      ...(ownedBy ? { ownedBy } : {}),
      ...(meta ? { meta } : {}),
    });
  }
  return items;
}

/**
 * 把上游模型条目转换为可写入 provider 的模型配置:`meta` 里的上下文 / 能力 / 价格
 * 直接铺平,使同步进来的模型与本地同名模型具备一致的可用性。
 */
export function toUpstreamModelConfigs(models: UpstreamModelItem[]): AIModelConfigItem[] {
  return models.map((model) => ({
    id: model.id,
    label: model.label,
    enabled: true,
    ...(model.meta ?? {}),
  }));
}

/** 从本地模型配置里挑出可迁移元数据(未定义的字段不写入)。 */
export function pickLocalMetadata(model: AIModelConfigRef): UpstreamModelMetadata | undefined {
  const meta: UpstreamModelMetadata = {};
  if (typeof model.contextWindow === 'number') meta.contextWindow = model.contextWindow;
  if (typeof model.maxOutputTokens === 'number') meta.maxOutputTokens = model.maxOutputTokens;
  if (typeof model.inputPricePerMillion === 'number') {
    meta.inputPricePerMillion = model.inputPricePerMillion;
  }
  if (typeof model.outputPricePerMillion === 'number') {
    meta.outputPricePerMillion = model.outputPricePerMillion;
  }
  if (typeof model.supportsTools === 'boolean') meta.supportsTools = model.supportsTools;
  if (typeof model.supportsVision === 'boolean') meta.supportsVision = model.supportsVision;
  if (typeof model.supportsThinking === 'boolean') meta.supportsThinking = model.supportsThinking;
  if (typeof model.supportsImageGeneration === 'boolean') {
    meta.supportsImageGeneration = model.supportsImageGeneration;
  }
  if (typeof model.supportsImageGeneration4K === 'boolean') {
    meta.supportsImageGeneration4K = model.supportsImageGeneration4K;
  }
  if (Array.isArray(model.reasoningOptions) && model.reasoningOptions.length > 0) {
    meta.reasoningOptions = model.reasoningOptions;
  }
  return Object.keys(meta).length > 0 ? meta : undefined;
}

/**
 * 从**客户端自身**的 provider 状态构建「model id → 本地元数据」索引。
 *
 * 客户端这份状态就是用户实际看到的「本地配置」(含内置平台由 models.dev 派生的
 * 上下文 / 能力,以及用户显式配置),因此可作为上游 `meta` 缺失时的兜底迁移来源。
 * 优先级:`preferProviderId` 指定的目标接口 > 其余接口按列表顺序;同名 id 只补
 * 未定义字段,先写入者保留已定义字段。
 */
export function buildLocalMetadataIndex(
  providers: AIProviderRef[],
  preferProviderId?: string,
): Map<string, UpstreamModelMetadata> {
  const index = new Map<string, UpstreamModelMetadata>();
  const ordered = preferProviderId
    ? [
        ...providers.filter((provider) => provider.id === preferProviderId),
        ...providers.filter((provider) => provider.id !== preferProviderId),
      ]
    : providers;
  // 低优先级先写入、高优先级后覆盖(仅覆盖已定义字段,后写入者胜出)。
  // 键做大小写归一,避免「上游 GPT-4o / 本地 gpt-4o」这类差异导致匹配失败。
  for (const provider of [...ordered].reverse()) {
    for (const model of provider.defaultModels) {
      const picked = pickLocalMetadata(model);
      if (!picked) continue;
      const key = normalizeModelIdKey(model.id);
      const existing = index.get(key);
      index.set(key, existing ? { ...existing, ...picked } : picked);
    }
  }
  return index;
}

/** 用本地索引补齐上游条目缺失的 meta 字段(不覆盖上游已带 / 已解析出的取值)。 */
export function applyLocalMetadataFallback(
  items: UpstreamModelItem[],
  index: Map<string, UpstreamModelMetadata>,
): UpstreamModelItem[] {
  return items.map((item) => {
    const local = index.get(normalizeModelIdKey(item.id));
    if (!local) return item;
    if (!item.meta) return { ...item, meta: local };
    const merged: UpstreamModelMetadata = { ...local, ...item.meta };
    const changed = (Object.keys(merged) as (keyof UpstreamModelMetadata)[]).some(
      (key) => merged[key] !== item.meta?.[key],
    );
    return changed ? { ...item, meta: merged } : item;
  });
}
