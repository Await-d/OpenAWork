import fuzzysort from 'fuzzysort';

export interface ModelPickerModel {
  id: string;
  label: string;
  enabled: boolean;
  contextWindow?: number;
  supportsTools?: boolean;
  supportsVision?: boolean;
  supportsThinking?: boolean;
}

export interface ModelPickerProvider {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
  defaultModels: ModelPickerModel[];
}

export interface SearchableModelOption {
  id: string;
  name: string;
  provider: Pick<ModelPickerProvider, 'id' | 'name' | 'type'>;
  contextWindow?: number;
  supportsTools?: boolean;
  supportsVision?: boolean;
  supportsThinking?: boolean;
}

export interface ModelPickerGroup {
  provider: Pick<ModelPickerProvider, 'id' | 'name' | 'type'>;
  models: SearchableModelOption[];
}

/**
 * 全局统一的「模型名称」排序比较器（数字感知，降序）。
 *
 * 用 localeCompare + numeric 让形如 GPT-4.1 / GPT-5.4 / Claude Opus 4.6 / 4.8 的
 * 版本号按数值大小排序，并取反结果实现**降序**（新/大版本在前）。所有「模型选择 /
 * 展示」入口（聊天模型选择器、设置页模型下拉、团队模板模型池等）都复用此比较器，
 * 保证全应用的模型排序一致。
 *
 * 入参只要带 name / label / id / modelId 任一即可（兼容不同模型对象形状）。
 */
export function compareModelsByName(
  a: { name?: string; label?: string; id?: string; modelId?: string },
  b: { name?: string; label?: string; id?: string; modelId?: string },
): number {
  const nameA = a.name ?? a.label ?? a.id ?? a.modelId ?? '';
  const nameB = b.name ?? b.label ?? b.id ?? b.modelId ?? '';
  return -nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
}

/**
 * 供应商分组排序：统一改为「按供应商名称」降序（数字感知），与组内模型排序口径一致，
 * 让整个模型选择界面的排序规则保持统一、可预期。
 */
const compareProviderGroups = (left: ModelPickerGroup, right: ModelPickerGroup): number =>
  compareModelsByName({ name: left.provider.name }, { name: right.provider.name });

export function buildFilteredModelGroups(
  providers: ModelPickerProvider[],
  search: string,
): ModelPickerGroup[] {
  const options = providers.flatMap((provider) => {
    if (!provider.enabled) {
      return [];
    }

    return provider.defaultModels
      .filter((model) => model.enabled)
      .map((model) => ({
        id: model.id,
        name: model.label,
        provider: {
          id: provider.id,
          name: provider.name,
          type: provider.type,
        },
        contextWindow: model.contextWindow,
        supportsTools: model.supportsTools,
        supportsVision: model.supportsVision,
        supportsThinking: model.supportsThinking,
      }));
  });

  const needle = search.trim().toLowerCase();
  let filtered: SearchableModelOption[];
  if (!needle) {
    filtered = options;
  } else {
    // fuzzysort@3 occasionally drops candidates whose match path is
    // obvious to a human (queries with spaces / version numbers, or
    // when the needle straddles two non-adjacent runs in the target).
    // Run fuzzysort first for ranking, then add any options whose
    // label / id / provider name *contains* the needle as a plain
    // case-insensitive substring — this matches the user mental model
    // ("I can see the text in the option, why doesn't it match?") and
    // keeps the chat picker on parity with the settings dropdown.
    const fuzzyHits = fuzzysort
      .go<SearchableModelOption>(needle, options, { keys: ['provider.name', 'name', 'id'] })
      .map((result: { obj: SearchableModelOption }) => result.obj);
    const seen = new Set(fuzzyHits.map((option) => `${option.provider.id}:${option.id}`));
    const substringHits = options.filter((option) => {
      const key = `${option.provider.id}:${option.id}`;
      if (seen.has(key)) return false;
      const haystack = `${option.provider.name} ${option.name} ${option.id}`.toLowerCase();
      return haystack.includes(needle);
    });
    filtered = [...fuzzyHits, ...substringHits];
  }

  const grouped = new Map<string, ModelPickerGroup>();
  for (const option of filtered) {
    const existing = grouped.get(option.provider.id);
    if (existing) {
      existing.models.push(option);
      continue;
    }

    grouped.set(option.provider.id, {
      provider: option.provider,
      models: [option],
    });
  }

  return Array.from(grouped.values())
    .map((group) => ({
      ...group,
      models: [...group.models].sort(compareModelsByName),
    }))
    .sort(compareProviderGroups);
}
