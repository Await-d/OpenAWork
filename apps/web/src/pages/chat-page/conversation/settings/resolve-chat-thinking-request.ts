import {
  canConfigureThinkingForModel,
  getSupportedReasoningEffortsForModel,
  inferSupportsThinking,
} from '@openAwork/shared-ui';
import type { ReasoningEffort } from '../../../../components/conversation-runtime/messages/support.js';

const EFFORT_RANK: Record<ReasoningEffort, number> = {
  minimal: 0,
  low: 1,
  medium: 2,
  high: 3,
  xhigh: 4,
};

export interface NormalizeChatThinkingStateInput {
  providerType?: string;
  modelId?: string;
  declaredSupportsThinking: boolean;
  thinkingEnabled: boolean;
  reasoningEffort: ReasoningEffort;
}

export interface NormalizedChatThinkingState {
  supportsThinking: boolean;
  canConfigureThinking: boolean;
  thinkingEnabled: boolean;
  reasoningEffort: ReasoningEffort;
}

export interface ResolveChatThinkingRequestInput extends NormalizeChatThinkingStateInput {}

export interface ResolvedChatThinkingRequest {
  thinkingEnabled: boolean;
  reasoningEffort: ReasoningEffort | undefined;
}

function inferSupportsThinkingForChat(
  providerType: string | undefined,
  modelId: string | undefined,
  declaredSupportsThinking: boolean,
): boolean {
  return inferSupportsThinking(providerType, modelId, declaredSupportsThinking);
}

function normalizeReasoningEffort(
  selected: ReasoningEffort,
  supportedEfforts: readonly ReasoningEffort[],
): ReasoningEffort {
  if (supportedEfforts.length === 0) {
    return 'medium';
  }
  if (supportedEfforts.includes(selected)) {
    return selected;
  }
  const targetRank = EFFORT_RANK[selected];
  const sortedDesc = [...supportedEfforts].sort((a, b) => EFFORT_RANK[b] - EFFORT_RANK[a]);
  for (const effort of sortedDesc) {
    if (EFFORT_RANK[effort] <= targetRank) {
      return effort;
    }
  }
  return sortedDesc[sortedDesc.length - 1] ?? 'medium';
}

export function normalizeChatThinkingState(
  input: NormalizeChatThinkingStateInput,
): NormalizedChatThinkingState {
  if (!input.providerType || !input.modelId) {
    return {
      supportsThinking: input.declaredSupportsThinking,
      canConfigureThinking: input.declaredSupportsThinking,
      thinkingEnabled: input.thinkingEnabled,
      reasoningEffort: input.reasoningEffort,
    };
  }

  const supportsThinking = inferSupportsThinkingForChat(
    input.providerType,
    input.modelId,
    input.declaredSupportsThinking,
  );

  if (!supportsThinking) {
    return {
      supportsThinking: false,
      canConfigureThinking: false,
      thinkingEnabled: false,
      reasoningEffort: input.reasoningEffort,
    };
  }

  const canConfigureThinking = canConfigureThinkingForModel(input.providerType, input.modelId);
  if (!canConfigureThinking) {
    return {
      supportsThinking: true,
      canConfigureThinking: false,
      thinkingEnabled: false,
      reasoningEffort: input.reasoningEffort,
    };
  }

  const supportedEfforts = getSupportedReasoningEffortsForModel(
    input.providerType,
    input.modelId,
  ) as readonly ReasoningEffort[];

  return {
    supportsThinking: true,
    canConfigureThinking: true,
    thinkingEnabled: input.thinkingEnabled,
    reasoningEffort: normalizeReasoningEffort(input.reasoningEffort, supportedEfforts),
  };
}

/**
 * Normalize the thinking config sent on a chat turn.
 *
 * The user's selected effort must be the single source of truth. We do not
 * implicitly promote the effort based on prompt keywords such as "思考" or
 * "think", because that makes the UI selection lie about what is actually
 * sent upstream.
 */
export function resolveChatThinkingRequest(
  input: ResolveChatThinkingRequestInput,
): ResolvedChatThinkingRequest {
  const normalized = normalizeChatThinkingState(input);
  if (!normalized.supportsThinking || !normalized.canConfigureThinking) {
    return {
      thinkingEnabled: false,
      reasoningEffort: undefined,
    };
  }

  return {
    thinkingEnabled: normalized.thinkingEnabled,
    reasoningEffort: normalized.reasoningEffort,
  };
}
