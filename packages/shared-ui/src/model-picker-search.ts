import fuzzysort from 'fuzzysort';

const OPENCODE_POPULAR_PROVIDER_IDS = [
  'opencode',
  'opencode-go',
  'anthropic',
  'github-copilot',
  'openai',
  'google',
  'openrouter',
  'vercel',
] as const;

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

const resolveProviderRankId = (
  provider: Pick<ModelPickerProvider, 'id' | 'name' | 'type'>,
): string => {
  if (provider.id === 'gemini' || provider.type === 'gemini') {
    return 'google';
  }

  return provider.id;
};

const compareProviderGroups = (left: ModelPickerGroup, right: ModelPickerGroup): number => {
  const leftRank = OPENCODE_POPULAR_PROVIDER_IDS.indexOf(
    resolveProviderRankId(left.provider) as (typeof OPENCODE_POPULAR_PROVIDER_IDS)[number],
  );
  const rightRank = OPENCODE_POPULAR_PROVIDER_IDS.indexOf(
    resolveProviderRankId(right.provider) as (typeof OPENCODE_POPULAR_PROVIDER_IDS)[number],
  );
  const leftPopular = leftRank >= 0;
  const rightPopular = rightRank >= 0;
  if (leftPopular && !rightPopular) return -1;
  if (!leftPopular && rightPopular) return 1;
  return leftRank - rightRank;
};

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
  const filtered = !needle
    ? options
    : fuzzysort
        .go<SearchableModelOption>(needle, options, { keys: ['provider.name', 'name', 'id'] })
        .map((result: { obj: SearchableModelOption }) => result.obj);

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
      models: [...group.models].sort((left, right) => left.name.localeCompare(right.name)),
    }))
    .sort(compareProviderGroups);
}
