import type { CompactionSettings } from './compaction-policy.js';
import type { ModelRouteConfig } from '../provider/model-router.js';
import type { StreamCompactionChunk } from '@openAwork/shared';
import {
  executeSessionCompaction,
  isAutoCompactCircuitBreakerTripped,
} from '../session/session-compaction.js';
import {
  aggressiveTruncateToolOutputs,
  parseContextLimitError,
  recordDiscoveredContextWindow,
  resolveEffectiveContextWindow,
} from './context-window-resolver.js';
import { resolveCompactionRoute } from '../provider/model-router.js';
import { getCompactionProviderConfig } from '../provider/provider-config.js';
import { sqliteGet } from '../infra/db.js';
import { listSessionMessagesV2 } from '../message/message-v2-adapter.js';
import { publishSessionRunEvent } from '../session/session-run-events.js';
import { reactiveCompactByTokenGap } from './reactive-compact.js';
import { trySessionMemoryCompaction } from './session-memory-compact.js';
import {
  isCompactionThresholdReached,
  parsePercentageOverride,
  type CompactionTokenUsage,
} from './compaction-parity-contract.js';
import {
  DEFAULT_AUTOMATIC_PRESERVE_RECENT_TOKENS,
  DEFAULT_AUTOMATIC_TAIL_TURNS,
} from './compaction-tail-budget.js';
import { persistCompactionProjection } from './compaction-projection.js';

/* eslint-disable no-redeclare -- TypeScript overload signatures intentionally share one API name. */

const RUNTIME_REPLACE_STRATEGY = 'runtime_replace' as const;
const SUMMARY_ONLY_STRATEGY = 'summary_only' as const;
type CompactionCause = NonNullable<StreamCompactionChunk['cause']>;
type CompactionStrategy = NonNullable<StreamCompactionChunk['strategy']>;

export type AutomaticRequestKind = 'conversation' | 'compaction' | 'session_memory';

export interface AutoCompactionContext {
  readonly userId: string;
  readonly sessionId: string;
  readonly metadataJson: string;
  readonly clientRequestId: string;
  readonly runId: string;
  readonly route: ModelRouteConfig;
  readonly compactionSettings: CompactionSettings;
  readonly signal: AbortSignal;
  readonly requestKind?: AutomaticRequestKind;
}

export interface ProactiveCompactionInput extends AutoCompactionContext {
  readonly round: number;
  readonly lastRoundUsage: {
    readonly inputTokens: number;
    readonly outputTokens?: number;
    readonly cacheReadTokens?: number;
    readonly cacheWriteTokens?: number;
  };
}

export interface ProactiveCompactionResult {
  readonly triggered: boolean;
  readonly metadataJson: string;
}

export interface OverflowCompactionInput extends AutoCompactionContext {
  readonly round: number;
  readonly roundResult: {
    readonly overflow: boolean;
    readonly stopReason: string;
    readonly usage?: {
      readonly inputTokens: number;
      readonly outputTokens: number;
      readonly totalTokens: number;
      readonly cacheReadTokens?: number;
      readonly cacheWriteTokens?: number;
    };
    readonly upstreamError?: unknown;
  };
}

export interface OverflowCompactionResult {
  readonly triggered: boolean;
  readonly recovered: boolean;
  readonly metadataJson: string;
  readonly syntheticContinuationPrompt?: string;
}

export type AutomaticCompactionRequest =
  | { readonly kind: 'proactive'; readonly input: ProactiveCompactionInput }
  | { readonly kind: 'overflow'; readonly input: OverflowCompactionInput };

function isCompactionSubrequest(input: AutoCompactionContext): boolean {
  return input.requestKind === 'compaction' || input.requestKind === 'session_memory';
}

function parseStoredJson<T>(value: string | undefined): T | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

function shouldAutomaticallyCompact(input: {
  readonly usage: CompactionTokenUsage;
  readonly contextWindow: number;
  readonly modelMaxOutputTokens: number | undefined;
}): boolean {
  return isCompactionThresholdReached(input.usage, {
    modelContextWindow: input.contextWindow,
    modelMaxOutputTokens: input.modelMaxOutputTokens,
    autoCompactPercentOverride: parsePercentageOverride(
      process.env['CLAUDE_AUTOCOMPACT_PCT_OVERRIDE'],
    ),
  });
}

async function resolveCompactionRouteForUser(
  userId: string,
  fallbackRoute: ModelRouteConfig,
): Promise<ModelRouteConfig> {
  const providerRow = sqliteGet<{ value: string }>(
    `SELECT value FROM user_settings WHERE user_id = ? AND key = 'providers'`,
    [userId],
  );
  const selectionRow = sqliteGet<{ value: string }>(
    `SELECT value FROM user_settings WHERE user_id = ? AND key = 'active_selection'`,
    [userId],
  );
  const compactionProviderConfig = await getCompactionProviderConfig(
    parseStoredJson(providerRow?.value),
    parseStoredJson(selectionRow?.value),
  );
  return compactionProviderConfig
    ? resolveCompactionRoute(compactionProviderConfig.provider, compactionProviderConfig.modelId)
    : fallbackRoute;
}

function publishStarted(
  input: AutoCompactionContext,
  round: number,
  cause: CompactionCause,
  strategy: CompactionStrategy,
) {
  publishSessionRunEvent(
    input.sessionId,
    {
      type: 'compaction',
      summary: '正在压缩会话上下文。',
      trigger: 'automatic',
      phase: 'started',
      cause,
      strategy,
      eventId: `${input.clientRequestId}:auto-compact:${round}:started`,
      runId: input.runId,
      occurredAt: Date.now(),
    },
    { clientRequestId: input.clientRequestId },
  );
}

function publishFailed(
  input: AutoCompactionContext,
  round: number,
  cause: CompactionCause,
  error: unknown,
) {
  const summary = error instanceof Error ? error.message : '自动压缩失败，保留当前上下文状态。';
  publishSessionRunEvent(
    input.sessionId,
    {
      type: 'compaction',
      summary,
      trigger: 'automatic',
      phase: 'failed',
      cause,
      strategy: SUMMARY_ONLY_STRATEGY,
      eventId: `${input.clientRequestId}:auto-compact:${round}:failed`,
      runId: input.runId,
      occurredAt: Date.now(),
    },
    { clientRequestId: input.clientRequestId },
  );
}

function publishCompleted(
  input: AutoCompactionContext,
  round: number,
  cause: CompactionCause,
  summary: string,
  details: { readonly compactedMessages?: number; readonly representedMessages?: number },
  suffix: string,
): void {
  publishSessionRunEvent(
    input.sessionId,
    {
      type: 'compaction',
      summary,
      trigger: 'automatic',
      phase: 'completed',
      cause,
      strategy: RUNTIME_REPLACE_STRATEGY,
      ...(details.compactedMessages !== undefined
        ? { compactedMessages: details.compactedMessages }
        : {}),
      ...(details.representedMessages !== undefined
        ? { representedMessages: details.representedMessages }
        : {}),
      eventId: `${input.clientRequestId}:auto-compact:${round}:${suffix}:completed`,
      runId: input.runId,
      occurredAt: Date.now(),
    },
    { clientRequestId: input.clientRequestId },
  );
}

async function runProactive(input: ProactiveCompactionInput): Promise<ProactiveCompactionResult> {
  const effectiveContextWindow = resolveEffectiveContextWindow(
    input.userId,
    input.route.model,
    input.route.contextWindow,
  );
  if (
    isCompactionSubrequest(input) ||
    !input.compactionSettings.auto ||
    typeof effectiveContextWindow !== 'number' ||
    isAutoCompactCircuitBreakerTripped(input.metadataJson) ||
    !shouldAutomaticallyCompact({
      usage: input.lastRoundUsage,
      contextWindow: effectiveContextWindow,
      modelMaxOutputTokens: input.route.maxOutputTokens,
    })
  ) {
    return { triggered: false, metadataJson: input.metadataJson };
  }

  try {
    const compactionRoute = await resolveCompactionRouteForUser(input.userId, input.route);
    const allMessages = listSessionMessagesV2({
      sessionId: input.sessionId,
      userId: input.userId,
      statuses: ['final'],
    });
    publishStarted(input, input.round, 'proactive_near_overflow', RUNTIME_REPLACE_STRATEGY);
    const compactionResult = await executeSessionCompaction({
      clientRequestId: input.clientRequestId,
      metadataJson: input.metadataJson,
      messages: allMessages,
      prune: input.compactionSettings.prune,
      recentMessagesKept: input.compactionSettings.recentMessagesKept,
      preserveRecentTokens: DEFAULT_AUTOMATIC_PRESERVE_RECENT_TOKENS,
      round: input.round,
      route: compactionRoute,
      sessionId: input.sessionId,
      signal: input.signal,
      trigger: 'automatic',
      tailTurns: DEFAULT_AUTOMATIC_TAIL_TURNS,
      userId: input.userId,
    });
    const compactedCount =
      compactionResult.durableSummary?.newlySummarizedMessages ?? allMessages.length;
    const representedCount =
      compactionResult.durableSummary?.totalRepresentedMessages ?? allMessages.length;
    if (compactionResult.llmErrorMessage) {
      publishFailed(
        input,
        input.round,
        'proactive_near_overflow',
        compactionResult.llmErrorMessage,
      );
      return { triggered: true, metadataJson: compactionResult.metadataJson };
    }
    publishCompleted(
      input,
      input.round,
      'proactive_near_overflow',
      `已预防性压缩 ${compactedCount} 条较早消息，保留 ${input.compactionSettings.recentMessagesKept} 条近期消息。`,
      { compactedMessages: compactedCount, representedMessages: representedCount },
      compactionResult.durableSummary?.signature ?? String(Date.now()),
    );
    return { triggered: true, metadataJson: compactionResult.metadataJson };
  } catch (error: unknown) {
    publishFailed(input, input.round, 'proactive_near_overflow', error);
    console.warn('proactive compaction failed', error);
    return { triggered: false, metadataJson: input.metadataJson };
  }
}

async function runOverflow(input: OverflowCompactionInput): Promise<OverflowCompactionResult> {
  const { roundResult } = input;
  const effectiveContextWindow = resolveEffectiveContextWindow(
    input.userId,
    input.route.model,
    input.route.contextWindow,
  );
  let discoveredLimit: { currentTokens: number; maxTokens: number } | undefined;
  if (roundResult.stopReason === 'error' && roundResult.upstreamError) {
    const parsed = parseContextLimitError(roundResult.upstreamError);
    if (parsed && parsed.maxTokens > 0) {
      discoveredLimit = { currentTokens: parsed.currentTokens, maxTokens: parsed.maxTokens };
      recordDiscoveredContextWindow(
        input.userId,
        input.route.model,
        parsed.maxTokens,
        input.route.contextWindow,
      );
    }
  }
  const shouldAutoCompact =
    !isCompactionSubrequest(input) &&
    input.compactionSettings.auto &&
    roundResult.overflow === true &&
    !isAutoCompactCircuitBreakerTripped(input.metadataJson) &&
    ((roundResult.usage &&
      typeof effectiveContextWindow === 'number' &&
      shouldAutomaticallyCompact({
        usage: roundResult.usage,
        contextWindow: effectiveContextWindow,
        modelMaxOutputTokens: input.route.maxOutputTokens,
      })) ||
      (!roundResult.usage && roundResult.stopReason === 'error'));
  if (!shouldAutoCompact) {
    return { triggered: false, recovered: false, metadataJson: input.metadataJson };
  }

  const allMessages = listSessionMessagesV2({
    sessionId: input.sessionId,
    userId: input.userId,
    statuses: ['final'],
  });
  const cause = roundResult.usage ? 'usage_overflow' : 'provider_overflow';

  if (discoveredLimit && discoveredLimit.currentTokens > discoveredLimit.maxTokens) {
    const tokenGap = discoveredLimit.currentTokens - discoveredLimit.maxTokens;
    const reactiveResult = reactiveCompactByTokenGap(allMessages, tokenGap);
    if (reactiveResult?.recovered && reactiveResult.tokensFreed >= tokenGap) {
      try {
        const remainingIds = new Set(reactiveResult.remainingMessages.map((message) => message.id));
        const droppedMessages = allMessages.filter((message) => !remainingIds.has(message.id));
        publishStarted(input, input.round, cause, RUNTIME_REPLACE_STRATEGY);
        const persisted = persistCompactionProjection({
          clientRequestId: input.clientRequestId,
          droppedMessages,
          kind: 'reactive',
          metadataJson: input.metadataJson,
          originalMessages: allMessages,
          projectedMessages: reactiveResult.remainingMessages,
          round: input.round,
          sessionId: input.sessionId,
          userId: input.userId,
        });
        publishCompleted(
          input,
          input.round,
          cause,
          `上下文超限，已持久化丢弃 ${reactiveResult.droppedGroups} 个较早对话轮次的快速投影。`,
          {
            compactedMessages: reactiveResult.droppedMessages,
            representedMessages: allMessages.length,
          },
          `reactive-${persisted.signature ?? Date.now()}`,
        );
        return { triggered: true, recovered: true, metadataJson: persisted.metadataJson };
      } catch (error: unknown) {
        console.warn('reactive compaction projection failed, falling through', error);
      }
    }
  }

  if (discoveredLimit && discoveredLimit.currentTokens > 0) {
    const truncationResult = aggressiveTruncateToolOutputs(
      allMessages,
      discoveredLimit.currentTokens,
      discoveredLimit.maxTokens,
    );
    if (truncationResult.success && truncationResult.sufficient) {
      try {
        publishStarted(input, input.round, cause, RUNTIME_REPLACE_STRATEGY);
        const persisted = persistCompactionProjection({
          clientRequestId: input.clientRequestId,
          kind: 'tool_output',
          metadataJson: input.metadataJson,
          originalMessages: allMessages,
          projectedMessages: truncationResult.messages,
          round: input.round,
          sessionId: input.sessionId,
          truncatedCount: truncationResult.truncatedCount,
          userId: input.userId,
        });
        publishCompleted(
          input,
          input.round,
          cause,
          `上下文超限，已持久化 ${truncationResult.truncatedCount} 个大型工具输出的快速投影。`,
          {
            compactedMessages: truncationResult.truncatedCount,
            representedMessages: allMessages.length,
          },
          `tool-output-${persisted.signature ?? Date.now()}`,
        );
        return { triggered: true, recovered: true, metadataJson: persisted.metadataJson };
      } catch (error: unknown) {
        console.warn('tool output projection failed, falling through', error);
      }
    }
  }

  try {
    const smResult = await trySessionMemoryCompaction({
      clientRequestId: input.clientRequestId,
      sessionId: input.sessionId,
      userId: input.userId,
      messages: allMessages,
      metadataJson: input.metadataJson,
      requestKind: 'session_memory',
      round: input.round,
    });
    if (smResult?.success) {
      if (smResult.committed) {
        publishStarted(input, input.round, cause, RUNTIME_REPLACE_STRATEGY);
        publishCompleted(
          input,
          input.round,
          cause,
          `已使用会话记忆进行压缩（保留 ${smResult.messagesToKeep.length} 条近期消息）。`,
          { compactedMessages: allMessages.length - smResult.messagesToKeep.length },
          `session-memory-${smResult.signature}`,
        );
      }
      return { triggered: true, recovered: true, metadataJson: smResult.metadataJson };
    }
  } catch (error: unknown) {
    console.warn('session memory compaction failed, falling through', error);
  }

  try {
    const compactionRoute = await resolveCompactionRouteForUser(input.userId, input.route);
    const latestFinalMessage = allMessages.at(-1);
    const replayMessage =
      !roundResult.usage &&
      roundResult.stopReason === 'error' &&
      latestFinalMessage?.role === 'user'
        ? latestFinalMessage
        : null;
    const strategy = replayMessage
      ? ('replay' as const)
      : !roundResult.usage && roundResult.stopReason === 'error'
        ? ('synthetic_continue' as const)
        : RUNTIME_REPLACE_STRATEGY;
    const messagesForCompaction = replayMessage ? allMessages.slice(0, -1) : allMessages;
    if (messagesForCompaction.length === 0) {
      throw new Error('no earlier history available for overflow compaction recovery');
    }
    publishStarted(input, input.round, cause, strategy);
    const compactionResult = await executeSessionCompaction({
      clientRequestId: input.clientRequestId,
      metadataJson: input.metadataJson,
      messages: messagesForCompaction,
      prune: input.compactionSettings.prune,
      recentMessagesKept: input.compactionSettings.recentMessagesKept,
      preserveRecentTokens: DEFAULT_AUTOMATIC_PRESERVE_RECENT_TOKENS,
      round: input.round,
      route: compactionRoute,
      sessionId: input.sessionId,
      signal: input.signal,
      trigger: 'automatic',
      tailTurns: DEFAULT_AUTOMATIC_TAIL_TURNS,
      userId: input.userId,
    });
    const compactedCount =
      compactionResult.durableSummary?.newlySummarizedMessages ?? messagesForCompaction.length;
    const representedCount =
      compactionResult.durableSummary?.totalRepresentedMessages ?? messagesForCompaction.length;
    if (compactionResult.llmErrorMessage) {
      publishFailed(input, input.round, cause, compactionResult.llmErrorMessage);
      return { triggered: true, recovered: false, metadataJson: compactionResult.metadataJson };
    }
    publishCompleted(
      input,
      input.round,
      cause,
      replayMessage
        ? `已压缩 ${compactedCount} 条较早消息，并保留当前用户请求继续执行。`
        : `已压缩 ${compactedCount} 条较早消息，并注入继续执行提示。`,
      { compactedMessages: compactedCount, representedMessages: representedCount },
      compactionResult.durableSummary?.signature ?? String(Date.now()),
    );
    return {
      triggered: true,
      recovered: replayMessage !== null,
      metadataJson: compactionResult.metadataJson,
      ...(replayMessage
        ? {}
        : {
            syntheticContinuationPrompt:
              'The conversation was compacted after a context overflow. Continue if you have clear next steps, or ask for clarification if additional user input is required.',
          }),
    };
  } catch (error: unknown) {
    publishFailed(input, input.round, cause, error);
    console.warn('automatic compaction failed', error);
    return { triggered: true, recovered: false, metadataJson: input.metadataJson };
  }
}

export function orchestrateAutomaticCompaction(
  input: ProactiveCompactionInput,
): Promise<ProactiveCompactionResult>;
export function orchestrateAutomaticCompaction(
  input: OverflowCompactionInput,
): Promise<OverflowCompactionResult>;
export function orchestrateAutomaticCompaction(
  input: AutomaticCompactionRequest,
): Promise<ProactiveCompactionResult | OverflowCompactionResult>;
export async function orchestrateAutomaticCompaction(
  input: ProactiveCompactionInput | OverflowCompactionInput | AutomaticCompactionRequest,
): Promise<ProactiveCompactionResult | OverflowCompactionResult> {
  const request: AutomaticCompactionRequest =
    'kind' in input
      ? input
      : 'roundResult' in input
        ? { kind: 'overflow', input }
        : { kind: 'proactive', input };
  if (isCompactionSubrequest(request.input)) {
    return request.kind === 'proactive'
      ? { triggered: false, metadataJson: request.input.metadataJson }
      : { triggered: false, recovered: false, metadataJson: request.input.metadataJson };
  }
  return request.kind === 'proactive' ? runProactive(request.input) : runOverflow(request.input);
}

export const runAutomaticCompaction = orchestrateAutomaticCompaction;
