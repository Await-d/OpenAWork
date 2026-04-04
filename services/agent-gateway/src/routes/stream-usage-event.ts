import type { StreamUsageChunk } from '@openAwork/shared';
import type { StreamUsageSummary } from './stream-protocol.js';
import { createRunEventMeta } from './stream.js';

export function buildStreamUsageChunk(input: {
  eventSequence: { value: number };
  round: number;
  runId: string;
  usage: StreamUsageSummary;
}): StreamUsageChunk {
  return {
    type: 'usage',
    inputTokens: Math.max(0, input.usage.inputTokens),
    outputTokens: Math.max(0, input.usage.outputTokens),
    totalTokens: Math.max(0, input.usage.totalTokens),
    round: Math.max(1, input.round),
    ...createRunEventMeta(input.runId, input.eventSequence),
  };
}
