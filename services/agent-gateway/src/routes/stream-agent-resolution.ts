import type { ManagedAgentRecord } from '@openAwork/shared';
import { listManagedAgentsForUser } from '../agent/agent-catalog.js';
import { selectDelegatedModelForUser } from '../task/task-model-selection.js';

export type StreamAgentDowngradeReason =
  'agent_disabled' | 'agent_model_unavailable' | 'agent_not_found';

export interface StreamAgentSelection {
  deferToolLoading?: boolean;
  downgradeReason?: StreamAgentDowngradeReason;
  effectiveAgentId?: string;
  modelId?: string;
  providerId?: string;
  requestedAgentId?: string;
  systemPrompt?: string;
  variant?: string;
}

export function normalizeRequestedAgentId(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

export function normalizeRequestedProviderId(providerId: string | undefined): string | undefined {
  const normalized = providerId?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

export function normalizeManagedAgentIdentifier(value: string): string {
  return value.trim().toLowerCase();
}

export function findManagedStreamAgent(
  agents: ManagedAgentRecord[],
  requestedAgentId: string,
): ManagedAgentRecord | undefined {
  const normalizedRequestedAgentId = normalizeManagedAgentIdentifier(requestedAgentId);
  return agents.find((agent) => {
    if (normalizeManagedAgentIdentifier(agent.id) === normalizedRequestedAgentId) {
      return true;
    }

    if (normalizeManagedAgentIdentifier(agent.label) === normalizedRequestedAgentId) {
      return true;
    }

    return agent.aliases.some(
      (alias) => normalizeManagedAgentIdentifier(alias) === normalizedRequestedAgentId,
    );
  });
}

export function normalizeAgentModelCandidate(modelId: string): string {
  const normalized = modelId.trim();
  return normalized.includes('/') ? (normalized.split('/').at(-1) ?? normalized) : normalized;
}

export function getManagedAgentModelCandidates(agent: ManagedAgentRecord): string[] {
  return Array.from(
    new Set(
      [agent.model, ...(agent.fallbackModels ?? [])]
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .map((value) => normalizeAgentModelCandidate(value)),
    ),
  );
}

export async function resolveStreamAgentSelection(input: {
  requestedAgentId: string | undefined;
  sessionAgentId?: string | undefined;
  userId: string;
}): Promise<StreamAgentSelection> {
  // 请求显式值优先；缺席时落到会话绑定（见 SessionProviderSelection.agentId）。
  const requestedAgentId =
    normalizeRequestedAgentId(input.requestedAgentId) ??
    normalizeRequestedAgentId(input.sessionAgentId);
  if (!requestedAgentId) {
    return {};
  }

  const agents = listManagedAgentsForUser(input.userId);
  const matchedAgent = findManagedStreamAgent(agents, requestedAgentId);
  if (!matchedAgent) {
    return {
      downgradeReason: 'agent_not_found',
      requestedAgentId,
    };
  }

  if (!matchedAgent.enabled) {
    return {
      downgradeReason: 'agent_disabled',
      requestedAgentId,
    };
  }

  const modelCandidates = getManagedAgentModelCandidates(matchedAgent);
  const delegatedModel =
    modelCandidates.length > 0
      ? await selectDelegatedModelForUser(input.userId, modelCandidates)
      : undefined;

  return {
    ...(modelCandidates.length > 0 && !delegatedModel?.providerId
      ? { downgradeReason: 'agent_model_unavailable' as const }
      : {}),
    deferToolLoading: matchedAgent.deferToolLoading === true ? true : undefined,
    effectiveAgentId: matchedAgent.id,
    modelId: delegatedModel?.modelId,
    providerId: delegatedModel?.providerId,
    requestedAgentId,
    systemPrompt: matchedAgent.systemPrompt,
    variant: delegatedModel?.variant ?? matchedAgent.variant,
  };
}
