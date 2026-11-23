import { catalogModelSupportsThinking } from '@openAwork/agent-core';
import type { CreatedSessionModelConfig } from '@openAwork/shared';
import { getCatalog } from '../provider/provider-catalog.js';
import type { validateSessionMetadataPatch } from './session-workspace-metadata.js';
import { readUserChatThinkingSettings } from '../user/user-thinking-defaults.js';
import { clampReasoningEffortForModel } from '../v2-runtime/upstream/provider-options.js';

type SessionMetadataPatch = Extract<
  ReturnType<typeof validateSessionMetadataPatch>,
  { success: true }
>['data'];

export async function resolveCreatedSessionModelConfig(
  userId: string,
  metadata: SessionMetadataPatch,
  options: { useDefaultModel: boolean; useDefaultThinking: boolean },
): Promise<CreatedSessionModelConfig | undefined> {
  const { providers, activeSelection } = await getCatalog(userId);
  const manualProvider = options.useDefaultModel
    ? undefined
    : providers.find((provider) => provider.enabled && provider.id === metadata.providerId);
  // Match stream routing: an explicit model on an enabled provider may be absent from its catalog.
  const useManualModel = Boolean(manualProvider && metadata.modelId);
  const provider = useManualModel
    ? manualProvider
    : providers.find((item) => item.enabled && item.id === activeSelection.chat.providerId);
  const modelId = useManualModel ? metadata.modelId : activeSelection.chat.modelId;
  if (!provider || !modelId) return undefined;
  const model = provider.defaultModels.find((item) => item.id === modelId);
  if (!useManualModel && !model?.enabled) return undefined;

  const savedThinking = readUserChatThinkingSettings(userId);
  const requestedEnabled = options.useDefaultThinking
    ? savedThinking.enabled
    : (metadata.thinkingEnabled ?? savedThinking.enabled);
  const requestedEffort = options.useDefaultThinking
    ? savedThinking.effort
    : (metadata.reasoningEffort ?? savedThinking.effort);
  const supportsThinking =
    model?.supportsThinking === true || catalogModelSupportsThinking(provider.type, modelId);
  const modelLabel = model?.label ?? (useManualModel ? metadata.modelLabel : undefined);
  return {
    providerId: provider.id,
    modelId,
    ...(modelLabel ? { modelLabel } : {}),
    thinkingEnabled: supportsThinking && requestedEnabled,
    ...(supportsThinking && {
      reasoningEffort: clampReasoningEffortForModel(
        modelId,
        requestedEffort,
        model?.reasoningOptions,
      ),
    }),
  };
}
