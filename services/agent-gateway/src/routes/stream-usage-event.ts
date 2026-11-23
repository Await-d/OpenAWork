import type { StreamUsageChunk } from '@openAwork/shared';
import { normalizeTokenCount } from '@openAwork/agent-core';
import type { StreamUsageSummary } from './stream-usage.js';
// 从叶子模块导入而非回边 `./stream.js`，避免 stream.ts ⇄ stream-usage-event.ts 运行时环。
import { createRunEventMeta } from './stream-sse-encoder.js';
import { resolveEffectiveContextWindow } from '../compaction/context-window-resolver.js';
import {
  parsePercentageOverride,
  resolveCompactionThreshold,
} from '../compaction/compaction-parity-contract.js';
import type { ModelRouteConfig } from '../provider/model-router.js';

export function buildStreamUsageChunk(input: {
  eventSequence: { value: number };
  round: number;
  runId: string;
  usage: StreamUsageSummary;
  context?: { userId: string; route: ModelRouteConfig; autoCompact: boolean };
}): StreamUsageChunk {
  const context = input.context;
  const windowTokens =
    context &&
    resolveEffectiveContextWindow(
      context.userId,
      context.route.model,
      context.route.contextWindow,
      context.route.contextWindowOverride,
    );
  const contextBudget =
    context && windowTokens !== undefined
      ? {
          windowTokens,
          autoCompactThresholdTokens: context.autoCompact
            ? resolveCompactionThreshold({
                modelContextWindow: windowTokens,
                modelMaxOutputTokens: context.route.maxOutputTokens,
                autoCompactThresholdRatio: context.route.autoCompactThresholdRatio,
                autoCompactPercentOverride: parsePercentageOverride(
                  process.env['CLAUDE_AUTOCOMPACT_PCT_OVERRIDE'],
                ),
              }).autoCompactThreshold
            : null,
        }
      : undefined;
  return {
    type: 'usage',
    inputTokens: normalizeTokenCount(input.usage.inputTokens),
    outputTokens: normalizeTokenCount(input.usage.outputTokens),
    totalTokens: normalizeTokenCount(input.usage.totalTokens),
    ...(contextBudget ? { contextBudget } : {}),
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
