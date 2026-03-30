import { sqliteGet } from './db.js';
import type { ReferenceModelEntry } from './task-model-reference-snapshot.js';

interface UserSettingRow {
  value: string;
}

interface StoredProviderModel {
  enabled?: boolean;
  id?: string;
}

interface StoredProvider {
  defaultModels?: StoredProviderModel[];
  enabled?: boolean;
  id?: string;
  type?: string;
}

export interface DelegatedModelSelection {
  modelId: string;
  providerId?: string;
  variant?: string;
}

function normalizeProviderHint(value: string): string {
  switch (value.trim().toLowerCase()) {
    case 'google':
      return 'gemini';
    case 'moonshotai':
    case 'moonshotai-cn':
      return 'moonshot';
    default:
      return value.trim().toLowerCase();
  }
}

function providerMatchesHints(provider: StoredProvider, hints: string[]): boolean {
  if (hints.length === 0) {
    return true;
  }
  const providerKeys = new Set(
    [provider.id, provider.type]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .map((value) => value.trim().toLowerCase())
      .flatMap((value) => [value, normalizeProviderHint(value)]),
  );
  return hints.some((hint) => providerKeys.has(normalizeProviderHint(hint)));
}

function parseProviders(value: string | undefined): StoredProvider[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as StoredProvider[]) : [];
  } catch {
    return [];
  }
}

export function selectDelegatedModelForUser(
  userId: string,
  modelCandidates: string[] | ReferenceModelEntry[],
): DelegatedModelSelection | undefined {
  const candidates: ReferenceModelEntry[] =
    Array.isArray(modelCandidates) && typeof modelCandidates[0] === 'object'
      ? (modelCandidates as ReferenceModelEntry[])
      : Array.from(
          new Set((modelCandidates as string[]).map((item) => item.trim()).filter(Boolean)),
        ).map((modelId) => ({ modelId, providerHints: [] }));
  if (candidates.length === 0) {
    return undefined;
  }

  const providersRow = sqliteGet<UserSettingRow>(
    `SELECT value FROM user_settings WHERE user_id = ? AND key = 'providers'`,
    [userId],
  );
  const providers = parseProviders(providersRow?.value);

  for (const candidate of candidates) {
    const matchedProvider = providers.find(
      (provider) =>
        provider.enabled !== false &&
        typeof provider.id === 'string' &&
        providerMatchesHints(provider, candidate.providerHints) &&
        provider.defaultModels?.some(
          (model) => model.enabled !== false && model.id === candidate.modelId,
        ),
    );
    if (matchedProvider?.id) {
      return {
        providerId: matchedProvider.id,
        modelId: candidate.modelId,
        variant: candidate.variant,
      };
    }
  }

  const firstCandidate = candidates[0];
  if (!firstCandidate) {
    return undefined;
  }

  return { modelId: firstCandidate.modelId, variant: firstCandidate.variant };
}
