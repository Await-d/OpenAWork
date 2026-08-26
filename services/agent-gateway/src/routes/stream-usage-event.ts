import type { StreamUsageChunk } from '@openAwork/shared';
import { normalizeTokenCount } from '@openAwork/agent-core';
import type { StreamUsageSummary } from './stream-usage.js';
import { createRunEventMeta } from './stream.js';

export function buildStreamUsageChunk(input: {
  eventSequence: { value: number };
  round: number;
  runId: string;
  usage: StreamUsageSummary;
}): StreamUsageChunk {
  return {
    type: 'usage',
    inputTokens: normalizeTokenCount(input.usage.inputTokens),
    outputTokens: normalizeTokenCount(input.usage.outputTokens),
    totalTokens: normalizeTokenCount(input.usage.totalTokens),
    ...(typeof input.usage.reasoningTokens === 'number'
      ? { reasoningTokens: normalizeTokenCount(input.usage.reasoningTokens) }
      : {}),
    ...(typeof input.usage.cacheReadTokens === 'number'
      ? { cacheReadTokens: normalizeTokenCount(input.usage.cacheReadTokens) }
      : {}),
    ...(typeof input.usage.cacheWriteTokens === 'number'
      ? { cacheWriteTokens: normalizeTokenCount(input.usage.cacheWriteTokens) }
      : {}),
    round: Math.max(1, input.round),
    ...createRunEventMeta(input.runId, input.eventSequence),
  };
}
