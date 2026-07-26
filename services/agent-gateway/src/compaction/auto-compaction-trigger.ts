/**
 * Auto-Compaction Trigger
 *
 * Extracted from stream.ts to improve separation of concerns.
 * Encapsulates the logic for:
 * 1. Proactive compaction (before overflow, based on token usage trends)
 * 2. Reactive compaction (after overflow error from provider)
 * 3. Phase 2 aggressive truncation (before full summarization)
 *
 * The stream loop calls these functions at the appropriate points;
 * they return results that the loop uses to decide whether to continue,
 * retry, or stop.
 */

import type { CompactionSettings } from './compaction-policy.js';
import type { ModelRouteConfig } from '../provider/model-router.js';
import { isContextNearOverflow, isContextOverflow } from '../session/session-message-store.js';
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

const RUNTIME_REPLACE_STRATEGY = 'runtime_replace' as const;
const SUMMARY_ONLY_STRATEGY = 'summary_only' as const;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AutoCompactionContext {
  userId: string;
  sessionId: string;
  metadataJson: string;
  clientRequestId: string;
  runId: string;
  route: ModelRouteConfig;
  compactionSettings: CompactionSettings;
  signal: AbortSignal;
}

export interface ProactiveCompactionInput extends AutoCompactionContext {
  round: number;
  lastRoundUsage: {
    inputTokens: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
}

export interface ProactiveCompactionResult {
  triggered: boolean;
  metadataJson: string;
}

export interface OverflowCompactionInput extends AutoCompactionContext {
  round: number;
  /** The model round result that triggered overflow detection. */
  roundResult: {
    overflow: boolean;
    stopReason: string;
    usage?: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      cacheReadTokens?: number;
      cacheWriteTokens?: number;
    };
    upstreamError?: unknown;
  };
}

export interface OverflowCompactionResult {
  triggered: boolean;
  recovered: boolean;
  metadataJson: string;
  syntheticContinuationPrompt?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseStoredJson<T>(value: string | undefined): T | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
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

// ─── Proactive Compaction ────────────────────────────────────────────────────

/**
 * Check whether proactive compaction should trigger and execute it if so.
 *
 * Called at the start of each round (round > 1) before sending the next
 * request to the model. If the previous round's token usage is near the
 * effective context window limit, compaction runs preemptively to avoid
 * the user-visible "error → compact → retry" cycle.
 */
export async function triggerProactiveCompaction(
  input: ProactiveCompactionInput,
): Promise<ProactiveCompactionResult> {
  const effectiveContextWindow = resolveEffectiveContextWindow(
    input.userId,
    input.route.model,
    input.route.contextWindow,
  );

  // Check preconditions
  if (
    !input.compactionSettings.auto ||
    typeof effectiveContextWindow !== 'number' ||
    isAutoCompactCircuitBreakerTripped(input.metadataJson) ||
    !isContextNearOverflow(
      input.lastRoundUsage,
      effectiveContextWindow,
      input.compactionSettings.reserved,
      input.route.maxOutputTokens,
    )
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

    publishSessionRunEvent(
      input.sessionId,
      {
        type: 'compaction',
        summary: '上下文接近阈值，正在预防性压缩。',
        trigger: 'automatic',
        phase: 'started',
        cause: 'proactive_near_overflow',
        strategy: RUNTIME_REPLACE_STRATEGY,
        eventId: `${input.clientRequestId}:proactive-compact:${input.round}:started`,
        runId: input.runId,
        occurredAt: Date.now(),
      },
      { clientRequestId: input.clientRequestId },
    );

    const compactionResult = await executeSessionCompaction({
      metadataJson: input.metadataJson,
      messages: allMessages,
      prune: input.compactionSettings.prune,
      recentMessagesKept: input.compactionSettings.recentMessagesKept,
      route: compactionRoute,
      sessionId: input.sessionId,
      signal: input.signal,
      trigger: 'automatic',
      userId: input.userId,
    });

    const signature = compactionResult.durableSummary?.signature ?? String(Date.now());
    const compactedCount =
      compactionResult.durableSummary?.newlySummarizedMessages ?? allMessages.length;
    const representedCount =
      compactionResult.durableSummary?.totalRepresentedMessages ?? allMessages.length;

    publishSessionRunEvent(
      input.sessionId,
      {
        type: 'compaction',
        summary: `已预防性压缩 ${compactedCount} 条较早消息，保留 ${input.compactionSettings.recentMessagesKept} 条近期消息。`,
        trigger: 'automatic',
        phase: 'completed',
        cause: 'proactive_near_overflow',
        strategy: RUNTIME_REPLACE_STRATEGY,
        compactedMessages: compactedCount,
        representedMessages: representedCount,
        eventId: `${input.clientRequestId}:proactive-compact:${input.round}:${signature}:completed`,
        runId: input.runId,
        occurredAt: Date.now(),
      },
      { clientRequestId: input.clientRequestId },
    );

    return { triggered: true, metadataJson: compactionResult.metadataJson };
  } catch (error: unknown) {
    publishSessionRunEvent(
      input.sessionId,
      {
        type: 'compaction',
        summary: error instanceof Error ? error.message : '预防性压缩失败，保留当前上下文状态。',
        trigger: 'automatic',
        phase: 'failed',
        cause: 'proactive_near_overflow',
        strategy: SUMMARY_ONLY_STRATEGY,
        eventId: `${input.clientRequestId}:proactive-compact:${input.round}:failed`,
        runId: input.runId,
        occurredAt: Date.now(),
      },
      { clientRequestId: input.clientRequestId },
    );
    console.warn('proactive compaction failed', error);
    return { triggered: false, metadataJson: input.metadataJson };
  }
}

// ─── Overflow Compaction ─────────────────────────────────────────────────────

/**
 * Handle context overflow after a model round completes.
 *
 * Called after each round when the result indicates overflow. Executes:
 * 1. Error parsing → discover actual context limit from provider error
 * 2. Phase 2: Aggressive tool output truncation (fast, less lossy)
 * 3. Phase 3: Full compaction with LLM summarization (fallback)
 *
 * Returns whether recovery was successful and the conversation can continue.
 */
export async function triggerOverflowCompaction(
  input: OverflowCompactionInput,
): Promise<OverflowCompactionResult> {
  const { roundResult } = input;
  const effectiveContextWindow = resolveEffectiveContextWindow(
    input.userId,
    input.route.model,
    input.route.contextWindow,
  );

  // ── Step 1: Parse error to discover actual context limit ──
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

  // ── Check if auto-compaction should trigger ──
  const shouldAutoCompact =
    input.compactionSettings.auto &&
    roundResult.overflow === true &&
    !isAutoCompactCircuitBreakerTripped(input.metadataJson) &&
    ((roundResult.usage &&
      typeof effectiveContextWindow === 'number' &&
      isContextOverflow(
        roundResult.usage,
        effectiveContextWindow,
        input.compactionSettings.reserved,
        input.route.maxOutputTokens,
      )) ||
      (!roundResult.usage && roundResult.stopReason === 'error'));

  if (!shouldAutoCompact) {
    return {
      triggered: false,
      recovered: false,
      metadataJson: input.metadataJson,
    };
  }

  // ── Step 1.5: Reactive Compact — fast recovery by dropping oldest rounds ──
  // (Claude Code pattern: drop API-round groups from the head until the token
  // gap is covered. No LLM call, faster than full compaction but more lossy.)
  if (discoveredLimit && discoveredLimit.currentTokens > 0) {
    const tokenGap = discoveredLimit.currentTokens - discoveredLimit.maxTokens;
    if (tokenGap > 0) {
      const allMessagesForReactive = listSessionMessagesV2({
        sessionId: input.sessionId,
        userId: input.userId,
        statuses: ['final'],
      });
      const reactiveResult = reactiveCompactByTokenGap(allMessagesForReactive, tokenGap);
      if (reactiveResult?.recovered && reactiveResult.tokensFreed >= tokenGap) {
        publishSessionRunEvent(
          input.sessionId,
          {
            type: 'compaction',
            summary: `上下文超限，已通过丢弃 ${reactiveResult.droppedGroups} 个较早对话轮次恢复（释放约 ${Math.round(reactiveResult.tokensFreed / 1000)}K token）。`,
            trigger: 'automatic',
            phase: 'completed',
            cause: 'usage_overflow',
            compactedMessages: reactiveResult.droppedMessages,
            eventId: `${input.clientRequestId}:reactive-compact:${input.round}:completed`,
            runId: input.runId,
            occurredAt: Date.now(),
          },
          { clientRequestId: input.clientRequestId },
        );
        // Reactive compact operates on an in-memory copy — it doesn't persist
        // changes to the DB. Its value here is confirming that dropping N groups
        // would free enough tokens. The actual persistence happens via the full
        // compaction path (Step 3) which writes a compaction marker. We fall
        // through to Session Memory Compact or Full Compact for persistence.
      }
    }
  }

  // ── Step 1.7: Session Memory Compact — use pre-extracted summary (no LLM) ──
  // (Claude Code pattern: if session memory has been extracted in the background,
  // use it directly as the compaction summary without an additional LLM call.)
  try {
    const allMessagesForSM = listSessionMessagesV2({
      sessionId: input.sessionId,
      userId: input.userId,
      statuses: ['final'],
    });
    const smResult = await trySessionMemoryCompaction({
      sessionId: input.sessionId,
      userId: input.userId,
      messages: allMessagesForSM,
      metadataJson: input.metadataJson,
    });
    if (smResult) {
      publishSessionRunEvent(
        input.sessionId,
        {
          type: 'compaction',
          summary: `已使用会话记忆进行压缩（保留 ${smResult.messagesToKeep.length} 条近期消息），无需额外 LLM 调用。`,
          trigger: 'automatic',
          phase: 'completed',
          cause: roundResult.usage ? 'usage_overflow' : 'provider_overflow',
          strategy: RUNTIME_REPLACE_STRATEGY,
          compactedMessages: allMessagesForSM.length - smResult.messagesToKeep.length,
          eventId: `${input.clientRequestId}:session-memory-compact:${input.round}:completed`,
          runId: input.runId,
          occurredAt: Date.now(),
        },
        { clientRequestId: input.clientRequestId },
      );
      return {
        triggered: true,
        recovered: true,
        metadataJson: smResult.metadataJson,
      };
    }
  } catch (smError: unknown) {
    // Session memory compact failed — fall through to aggressive truncation + full compact
    console.warn('session memory compaction failed, falling through', smError);
  }

  // ── Step 2: Phase 2 — Aggressive tool output truncation ──
  if (discoveredLimit && discoveredLimit.currentTokens > 0) {
    const allMessagesForTruncation = listSessionMessagesV2({
      sessionId: input.sessionId,
      userId: input.userId,
      statuses: ['final'],
    });
    const truncationResult = aggressiveTruncateToolOutputs(
      allMessagesForTruncation as unknown as Parameters<typeof aggressiveTruncateToolOutputs>[0],
      discoveredLimit.currentTokens,
      discoveredLimit.maxTokens,
    );
    if (truncationResult.success && truncationResult.sufficient) {
      publishSessionRunEvent(
        input.sessionId,
        {
          type: 'compaction',
          summary: `上下文超限，已截断 ${truncationResult.truncatedCount} 个大型工具输出（共移除 ${Math.round(truncationResult.totalCharsRemoved / 1024)}KB），无需完整压缩。`,
          trigger: 'automatic',
          phase: 'completed',
          cause: 'usage_overflow',
          compactedMessages: truncationResult.truncatedCount,
          eventId: `${input.clientRequestId}:aggressive-truncate:${input.round}:completed`,
          runId: input.runId,
          occurredAt: Date.now(),
        },
        { clientRequestId: input.clientRequestId },
      );
      // Truncation sufficient — fall through to full compaction anyway
      // because the in-memory truncation doesn't persist. The full compaction
      // path will also prune these outputs via pruneToolResultsByTokenBudget.
    }
  }

  // ── Step 3: Phase 3 — Full compaction with LLM summarization ──
  try {
    const compactionRoute = await resolveCompactionRouteForUser(input.userId, input.route);
    const allMessages = listSessionMessagesV2({
      sessionId: input.sessionId,
      userId: input.userId,
      statuses: ['final'],
    });

    const latestFinalMessage = allMessages.at(-1);
    const replayMessage =
      !roundResult.usage &&
      roundResult.stopReason === 'error' &&
      latestFinalMessage?.role === 'user'
        ? latestFinalMessage
        : null;
    const cause = roundResult.usage ? 'usage_overflow' : 'provider_overflow';
    const strategy = replayMessage
      ? ('replay' as const)
      : !roundResult.usage && roundResult.stopReason === 'error'
        ? ('synthetic_continue' as const)
        : RUNTIME_REPLACE_STRATEGY;
    const messagesForCompaction = replayMessage ? allMessages.slice(0, -1) : allMessages;

    if (messagesForCompaction.length === 0) {
      throw new Error('no earlier history available for overflow compaction recovery');
    }

    publishSessionRunEvent(
      input.sessionId,
      {
        type: 'compaction',
        summary: '正在压缩会话上下文。',
        trigger: 'automatic',
        phase: 'started',
        cause,
        strategy,
        eventId: `${input.clientRequestId}:auto-compact:${input.round}:started`,
        runId: input.runId,
        occurredAt: Date.now(),
      },
      { clientRequestId: input.clientRequestId },
    );

    const compactionResult = await executeSessionCompaction({
      metadataJson: input.metadataJson,
      messages: messagesForCompaction,
      prune: input.compactionSettings.prune,
      recentMessagesKept: input.compactionSettings.recentMessagesKept,
      route: compactionRoute,
      sessionId: input.sessionId,
      signal: input.signal,
      trigger: 'automatic',
      userId: input.userId,
    });

    const signature = compactionResult.durableSummary?.signature ?? String(Date.now());
    const compactedCount =
      compactionResult.durableSummary?.newlySummarizedMessages ?? messagesForCompaction.length;
    const representedCount =
      compactionResult.durableSummary?.totalRepresentedMessages ?? messagesForCompaction.length;

    if (compactionResult.llmErrorMessage) {
      publishSessionRunEvent(
        input.sessionId,
        {
          type: 'compaction',
          summary: `压缩 LLM 失败，已回退到结构化摘要：${compactionResult.llmErrorMessage}`,
          trigger: 'automatic',
          phase: 'failed',
          cause,
          strategy: SUMMARY_ONLY_STRATEGY,
          eventId: `${input.clientRequestId}:auto-compact:${input.round}:${signature}:llm-failed`,
          runId: input.runId,
          occurredAt: Date.now(),
        },
        { clientRequestId: input.clientRequestId },
      );
    }

    publishSessionRunEvent(
      input.sessionId,
      {
        type: 'compaction',
        summary: replayMessage
          ? `已在上下文溢出后压缩 ${compactedCount} 条较早消息，并保留当前用户请求继续执行。`
          : `已在上下文溢出后压缩 ${compactedCount} 条较早消息，并注入继续执行提示。`,
        trigger: 'automatic',
        phase: 'completed',
        cause,
        strategy,
        compactedMessages: compactedCount,
        representedMessages: representedCount,
        eventId: `${input.clientRequestId}:auto-compact:${input.round}:${signature}:completed`,
        runId: input.runId,
        occurredAt: Date.now(),
      },
      { clientRequestId: input.clientRequestId },
    );

    const recovered = replayMessage !== null;
    const syntheticContinuationPrompt = recovered
      ? undefined
      : 'The conversation was compacted after a context overflow. Continue if you have clear next steps, or ask for clarification if additional user input is required.';

    return {
      triggered: true,
      recovered,
      metadataJson: compactionResult.metadataJson,
      syntheticContinuationPrompt,
    };
  } catch (error: unknown) {
    publishSessionRunEvent(
      input.sessionId,
      {
        type: 'compaction',
        summary: error instanceof Error ? error.message : '自动压缩失败，保留当前上下文状态。',
        trigger: 'automatic',
        phase: 'failed',
        cause: roundResult.usage ? 'usage_overflow' : 'provider_overflow',
        strategy: SUMMARY_ONLY_STRATEGY,
        eventId: `${input.clientRequestId}:auto-compact:${input.round}:failed`,
        runId: input.runId,
        occurredAt: Date.now(),
      },
      { clientRequestId: input.clientRequestId },
    );
    console.warn('automatic llm compaction failed', error);
    return {
      triggered: true,
      recovered: false,
      metadataJson: input.metadataJson,
    };
  }
}
