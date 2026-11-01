import type {
  ChatMessage,
  ChatUsageDetails,
} from '../../../../components/conversation-runtime/messages/support.js';
import { estimateTokenCount } from '../../../../components/conversation-runtime/messages/support.js';
import type { ModelPriceEntry } from './chat-page-utils.js';
import { estimateModelUsageCost, resolveModelPriceEntry } from './chat-page-utils.js';

interface AssistantUsageInput {
  messages: ChatMessage[];
  modelPrices: ModelPriceEntry[];
  activeProviderId: string;
  activeModelId: string;
  activeModelLabel: string | undefined;
}

/** 前文累计量和价格均重新计算，仅在所有展示值相同时复用旧 usage。 */
export function buildAssistantUsageDetails(
  input: AssistantUsageInput,
  previous: Map<string, ChatUsageDetails> | null,
): Map<string, ChatUsageDetails> {
  const usageByMessageId = new Map<string, ChatUsageDetails>();
  let contextTokens = 0;
  let requestIndex = 0;
  let unchanged = previous !== null;

  for (const message of input.messages) {
    const providerUsage = message.role === 'assistant' ? message.providerUsage : undefined;
    const messageTokens =
      providerUsage?.outputTokens ?? message.tokenEstimate ?? estimateTokenCount(message.content);

    if (message.role === 'assistant') {
      requestIndex += 1;
      const inputTokens = providerUsage?.inputTokens ?? contextTokens;
      const outputTokens = providerUsage?.outputTokens ?? messageTokens;
      const cacheReadTokens = providerUsage?.cacheReadTokens ?? 0;
      const cacheWriteTokens = providerUsage?.cacheWriteTokens ?? 0;
      const matchedPrice = resolveModelPriceEntry(input.modelPrices, [
        message.providerId ? `${message.providerId}/${message.model ?? ''}` : undefined,
        input.activeProviderId ? `${input.activeProviderId}/${input.activeModelId}` : undefined,
        message.model,
        input.activeModelId,
        input.activeModelLabel,
      ]);
      const totalTokens = providerUsage?.totalTokens ?? inputTokens + outputTokens;
      const estimatedCostUsd = matchedPrice
        ? estimateModelUsageCost({
            inputTokens,
            outputTokens,
            cacheReadTokens,
            cacheWriteTokens,
            price: matchedPrice,
          })
        : undefined;
      const tokensPerSecond =
        message.durationMs && message.durationMs > 0
          ? outputTokens / (message.durationMs / 1000)
          : undefined;
      const cached = previous?.get(message.id);
      const usage =
        cached &&
        Object.is(cached.requestIndex, requestIndex) &&
        Object.is(cached.inputTokens, inputTokens) &&
        Object.is(cached.outputTokens, outputTokens) &&
        Object.is(cached.totalTokens, totalTokens) &&
        Object.is(cached.cacheReadTokens, cacheReadTokens) &&
        Object.is(cached.cacheWriteTokens, cacheWriteTokens) &&
        Object.is(cached.estimatedCostUsd, estimatedCostUsd) &&
        Object.is(cached.durationMs, message.durationMs) &&
        Object.is(cached.firstTokenLatencyMs, message.firstTokenLatencyMs) &&
        Object.is(cached.tokensPerSecond, tokensPerSecond)
          ? cached
          : {
              requestIndex,
              inputTokens,
              outputTokens,
              totalTokens,
              cacheReadTokens,
              cacheWriteTokens,
              estimatedCostUsd,
              durationMs: message.durationMs,
              firstTokenLatencyMs: message.firstTokenLatencyMs,
              tokensPerSecond,
            };
      usageByMessageId.set(message.id, usage);
      unchanged = unchanged && usage === cached;
    }
    contextTokens += messageTokens;
  }

  return unchanged && previous?.size === usageByMessageId.size ? previous : usageByMessageId;
}
