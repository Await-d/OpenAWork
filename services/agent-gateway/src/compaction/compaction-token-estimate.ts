import type { CompactionTokenEstimate } from '@openAwork/shared';
import { logGatewayWarn } from '../infra/gateway-logger.js';
import { streamMessagesWithParts } from '../message/message-store-v2.js';
import { filterCompacted, toModelMessages } from '../message/message-to-model-messages.js';
import { stripMediaPayloadsForEstimate } from './media-payload-estimate.js';

/** Compare projected conversation history only, not system prompts, tools or provider billing. */
export function estimateCompactionHistoryTokens(input: {
  sessionId: string;
  userId: string;
}): number | undefined {
  try {
    const messages = toModelMessages(filterCompacted(streamMessagesWithParts(input)));
    return Math.ceil(JSON.stringify(stripMediaPayloadsForEstimate(messages)).length / 4);
  } catch (error) {
    logGatewayWarn('Could not estimate compaction history tokens', error);
    return undefined;
  }
}

export function buildCompactionTokenEstimate(
  before: number | undefined,
  readAfter: () => number | undefined,
): CompactionTokenEstimate | undefined {
  if (before === undefined) return undefined;
  const after = readAfter();
  if (after === undefined) return undefined;
  return { before, after };
}
