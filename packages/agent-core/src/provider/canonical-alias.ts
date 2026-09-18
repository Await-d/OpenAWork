import type { AIModelConfig } from './types.js';
import type { CanonicalModelsData } from './canonical-models.js';

export interface CanonicalAliasIndex {
  readonly idsAnywhere: ReadonlySet<string>;
  readonly idsByLabAndName: ReadonlyMap<string, ReadonlyMap<string, readonly string[]>>;
}

export const buildCanonicalAliasIndex = (canonical: CanonicalModelsData): CanonicalAliasIndex => {
  const idsAnywhere = new Set<string>();
  const idsByLabAndName = new Map<string, Map<string, string[]>>();

  for (const [key, entry] of Object.entries(canonical)) {
    const slash = key.indexOf('/');
    if (slash <= 0 || slash === key.length - 1) continue;
    const lab = key.slice(0, slash);
    const id = key.slice(slash + 1);
    idsAnywhere.add(id);

    const name = typeof entry?.name === 'string' ? entry.name : '';
    if (!name) continue;
    const byName = idsByLabAndName.get(lab) ?? new Map<string, string[]>();
    byName.set(name, [...(byName.get(name) ?? []), id]);
    idsByLabAndName.set(lab, byName);
  }

  return { idsAnywhere, idsByLabAndName };
};

const labIds = (byName: ReadonlyMap<string, readonly string[]>): Set<string> => {
  const ids = new Set<string>();
  for (const list of byName.values()) {
    for (const id of list) ids.add(id);
  }
  return ids;
};

export const deriveCanonicalLab = (
  index: CanonicalAliasIndex,
  modelIds: readonly string[],
): string | null => {
  let best: string | null = null;
  let bestHits = 0;
  for (const [lab, byName] of index.idsByLabAndName) {
    const ids = labIds(byName);
    const hits = modelIds.filter((id) => ids.has(id)).length;
    if (hits > bestHits) {
      bestHits = hits;
      best = lab;
    }
  }
  return bestHits > 0 ? best : null;
};

export const resolveCanonicalModelId = (
  index: CanonicalAliasIndex,
  lab: string,
  model: Pick<AIModelConfig, 'id' | 'label'>,
): string | null => {
  if (index.idsAnywhere.has(model.id)) return null;
  const matches = index.idsByLabAndName.get(lab)?.get(model.label) ?? [];
  if (matches.length !== 1) return null;
  const target = matches[0];
  return target && target !== model.id ? target : null;
};

export const applyCanonicalModelAliases = (
  models: readonly AIModelConfig[],
  index: CanonicalAliasIndex,
  lab: string,
): AIModelConfig[] => {
  const seen = new Set<string>();
  const next: AIModelConfig[] = [];
  for (const model of models) {
    const alias = resolveCanonicalModelId(index, lab, model);
    const id = alias ?? model.id;
    if (seen.has(id)) continue;
    seen.add(id);
    next.push(alias ? { ...model, id } : model);
  }
  return next;
};

export const isOfficialProviderHost = (providerBaseUrl: string, presetBaseUrl: string): boolean => {
  try {
    return new URL(providerBaseUrl).host === new URL(presetBaseUrl).host;
  } catch {
    return true;
  }
};
