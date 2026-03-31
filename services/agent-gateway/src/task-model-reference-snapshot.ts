import {
  FROZEN_AGENT_MODEL_ENTRIES,
  FROZEN_CATEGORY_MODEL_ENTRIES,
} from './reference-frozen/model-snapshot.js';

export interface ReferenceModelEntry {
  modelId: string;
  providerHints: string[];
  variant?: string;
}

export function getReferenceAgentModelCandidates(agentId: string | undefined): string[] {
  return getReferenceAgentModelEntries(agentId).map((entry) => entry.modelId);
}

export function getReferenceCategoryModelCandidates(category: string | undefined): string[] {
  return getReferenceCategoryModelEntries(category).map((entry) => entry.modelId);
}

export function getReferenceAgentModelEntries(agentId: string | undefined): ReferenceModelEntry[] {
  if (!agentId) {
    return [];
  }
  return FROZEN_AGENT_MODEL_ENTRIES[agentId] ?? [];
}

export function getReferenceCategoryModelEntries(
  category: string | undefined,
): ReferenceModelEntry[] {
  if (!category) {
    return [];
  }
  return FROZEN_CATEGORY_MODEL_ENTRIES[category] ?? [];
}
