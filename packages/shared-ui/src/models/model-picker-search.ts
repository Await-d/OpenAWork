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
      models: [...group.models].sort((left, right) => left.name.localeCompare(right.name)),
    }))
    .sort(compareProviderGroups);
}
