import type {
  FileDiffContent,
  MessageContent,
  RunEvent,
  StreamChunk,
  UpstreamStreamSummary,
} from '@openAwork/shared';
import { Effect, Layer, Stream } from 'effect';
import * as OpenCodeLLM from '@openAwork/opencode-llm';
import { normalizeTokenCount } from '@openAwork/agent-core';
import type { WorkflowLogger, createRequestContext } from '@openAwork/logger';
import { validateThinkingBlocks } from '../session/thinking-block-validator.js';
import {
  resolveEffectiveContextWindow,
  parseContextLimitError,
} from '../compaction/context-window-resolver.js';
import {
  isCompactionThresholdReached,
  parsePercentageOverride,
} from '../compaction/compaction-parity-contract.js';
import { microcompactMessages } from '../compaction/microcompact.js';
import { classifyUpstreamError } from '../provider/retry-classify.js';
import {
  toModelMessages,
  filterCompacted,
  type UnifiedMessage,
} from '../message/message-to-model-messages.js';
import {
  appendSessionMessageV2,
  updateSessionMessagesStatusByRequestScope,
} from '../message/message-v2-adapter.js';
import { streamMessagesWithParts } from '../message/message-store-v2.js';
import { buildModifiedFilesSummaryContent } from '../tools/modified-files-summary.js';
import {
  persistSessionSnapshot,
  createRequestSnapshotRef,
} from '../session/session-snapshot-store.js';
import { appendSnapshotPart, appendPatchPart } from '../message/message-v2-adapter.js';
import type { MessageID, MessageWithParts } from '../message/message-v2-schema.js';
import { upsertArtifactsFromAssistantMessage } from '../session/assistant-content-artifacts.js';
import { touchSessionHeartbeat } from '../handoff/bus/heartbeat.js';
import { resolveSessionWorkspacePath } from '../session/session-workspace-resolution.js';
import { validateWorkspacePath } from '../workspace/workspace-paths.js';
import { buildChannelPersonaPromptFromMetadata } from '../channels/channel-persona-prompt.js';
import { getSnapshotEngine } from '../snapshot/snapshot-engine.js';
import {
  getLatestSnapshotTreeForSession,
  persistSnapshotTree,
} from '../snapshot/snapshot-tree-store.js';
import type { StreamUsageSummary } from './stream-usage.js';
import type { StreamStopReason } from './stream-types.js';

export function resolveModelRoundOverflow(input: {
  readonly usage?: StreamUsageSummary;
  readonly effectiveContextWindow?: number;
  readonly modelMaxOutputTokens?: number;
  readonly autoCompactPercentOverride?: number;
  readonly autoCompactThresholdRatio?: number;
  readonly contextLimitError: ReturnType<typeof parseContextLimitError>;
  readonly compactionReservedTokens?: number;
}): boolean {
  if (input.contextLimitError !== null) {
    return true;
  }
  if (input.usage === undefined || input.effectiveContextWindow === undefined) {
    return false;
  }
  return isCompactionThresholdReached(input.usage, {
    modelContextWindow: input.effectiveContextWindow,
    ...(input.modelMaxOutputTokens !== undefined
      ? { modelMaxOutputTokens: input.modelMaxOutputTokens }
      : {}),
    ...(input.autoCompactPercentOverride !== undefined
      ? { autoCompactPercentOverride: input.autoCompactPercentOverride }
      : {}),
    ...(input.autoCompactThresholdRatio !== undefined
      ? { autoCompactThresholdRatio: input.autoCompactThresholdRatio }
      : {}),
  });
}
import {
  THINKING_LANGUAGE_HINT_MARKERS,
  buildSyntheticRequestContextBlock,
  buildTwoPartSystemPrompts,
  type SyntheticRequestContext,
} from './stream-system-prompts.js';
import type { resolveModelRoute } from '../provider/model-router.js';
import type { SessionStreamContext } from './stream.js';
import { createRunEventMeta, createStreamErrorChunk } from './stream.js';
import type { getEnabledTools } from './stream.js';
import { writeAuditLog } from '../infra/audit-log.js';
import {
  appendReasoningChunk,
  buildReasoningBlockKey,
  closeAllOpenReasoningBlocks,
  extractReasoningEntries,
  extractReasoningTexts,
  markReasoningBlockEnded,
  type ReasoningBlock,
} from '../session/reasoning-blocks.js';
import {
  appendSessionEvent,
  createStreamSessionEventState,
  persistStreamChunkAsSessionEvents,
} from '../session/session-entry-store.js';
import { makeSessionEventId } from '../session/session-event.js';
import {
  buildNativeModel,
  extractNativeSystemFromUnifiedMessages,
  runUpstreamStream,
  wrapGatewayToolsForNativeDeclarationsOnly,
} from '../v2-runtime/upstream/index.js';
import type {
  ExtendedThinkingConfig,
  ThinkingConfig,
} from '../v2-runtime/upstream/provider-options.js';
import { matchesRequestScope } from '../runtime/request-lineage.js';

const nativeLLMLayer = OpenCodeLLM.LLMClient.layer.pipe(
  Layer.provide(OpenCodeLLM.RequestExecutor.fetchLayer),
);

const pendingSnapshotTreeCaptures = new Set<Promise<void>>();

export async function waitForPendingSnapshotTreeCaptures(): Promise<void> {
  while (pendingSnapshotTreeCaptures.size > 0) {
    await Promise.all(Array.from(pendingSnapshotTreeCaptures));
  }
}

// `UpstreamErrorDescriptor` is preserved as a structural type so the
// `RunResult.upstreamError` field stays stable for downstream recovery
// detection in `routes/stream.ts`. The legacy `routes/upstream-error.ts`
// runtime helper that classified upstream HTTP responses is no longer
// reachable from the v2-only path; on v2-side errors we surface a plain
// `{ code, message }` shape.
type UpstreamErrorDescriptor = {
  code: string;
  message: string;
  technicalDetail?: string;
  /**
   * Suggested wait time before the next attempt, in ms. Populated
   * from `retry-after` / `retry-after-ms` headers when the upstream
   * provider returned them. See `retry-classify.ts`.
   */
  retryAfterMs?: number;
};

export function filterMessagesByTeamTaskThread(
  messages: Iterable<MessageWithParts>,
  teamTaskThreadId?: string,
): Iterable<MessageWithParts> {
  if (!teamTaskThreadId) {
    return messages;
  }

  return (function* filterByRequestScope() {
    for (const message of messages) {
      if (matchesRequestScope(teamTaskThreadId, message.info.clientRequestId)) {
        yield message;
      }
    }
  })();
}

export function findLastAssistantTimestamp(
  messages: readonly MessageWithParts[],
): number | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.info.role === 'assistant') {
      return message.info.time.created;
    }
  }
  return undefined;
}

export function getMicrocompactTimeContext(
  messages: readonly MessageWithParts[],
  teamTaskThreadId?: string,
): { lastAssistantTimestamp?: number } | undefined {
  if (teamTaskThreadId) return undefined;
  return { lastAssistantTimestamp: findLastAssistantTimestamp(messages) };
}

const STREAM_RUNTIME_ERROR_MESSAGES = {
  genericStreamError: '流式响应处理中断，请稍后重试。',
} as const;

export interface UpstreamStreamDiagnosticsSummary {
  textDeltaCount: number;
  reasoningDeltaCount: number;
  toolCallDeltaCount: number;
  sawDone: boolean;
  sawError: boolean;
  stalled: boolean;
  openaiServiceTier?: string;
}

interface UpstreamSummaryRouteMeta {
  model: string;
  providerId?: string;
  providerType?: string;
}

function createEmptyStreamDiagnosticsSummary(): UpstreamStreamDiagnosticsSummary {
  return {
    textDeltaCount: 0,
    reasoningDeltaCount: 0,
    toolCallDeltaCount: 0,
    sawDone: false,
    sawError: false,
    stalled: false,
  };
}

function resolveRouteProviderId(route: UpstreamSummaryRouteMeta): string | undefined {
  return route.providerId ?? route.providerType;
}

export function buildUpstreamStreamSummaryLog(input: {
  model: string;
  round: number;
  upstreamProtocol: string;
  stopReason: StreamStopReason;
  diagnostics: UpstreamStreamDiagnosticsSummary;
}): {
  input: { model: string; round: number; upstreamProtocol: string };
  output: {
    stopReason: StreamStopReason;
    textDeltaCount: number;
    reasoningDeltaCount: number;
    toolCallDeltaCount: number;
    sawDone: boolean;
    sawError: boolean;
    stalled: boolean;
    openaiServiceTier?: string;
  };
  isError: boolean;
} {
  return {
    input: {
      model: input.model,
      round: input.round,
      upstreamProtocol: input.upstreamProtocol,
    },
    output: {
      stopReason: input.stopReason,
      textDeltaCount: input.diagnostics.textDeltaCount,
      reasoningDeltaCount: input.diagnostics.reasoningDeltaCount,
      toolCallDeltaCount: input.diagnostics.toolCallDeltaCount,
      sawDone: input.diagnostics.sawDone,
      sawError: input.diagnostics.sawError,
      stalled: input.diagnostics.stalled,
      ...(input.diagnostics.openaiServiceTier === undefined
        ? {}
        : { openaiServiceTier: input.diagnostics.openaiServiceTier }),
    },
    isError: false,
  };
}

export function toUpstreamStreamSummary(
  stopReason: StreamStopReason,
  diagnostics: UpstreamStreamDiagnosticsSummary,
  route: UpstreamSummaryRouteMeta,
): UpstreamStreamSummary {
  const providerId = resolveRouteProviderId(route);
  return {
    stopReason,
    textDeltaCount: diagnostics.textDeltaCount,
    reasoningDeltaCount: diagnostics.reasoningDeltaCount,
    toolCallDeltaCount: diagnostics.toolCallDeltaCount,
    modelId: route.model,
    ...(providerId ? { providerId } : {}),
    sawDone: diagnostics.sawDone,
    sawError: diagnostics.sawError,
    stalled: diagnostics.stalled,
    ...(diagnostics.openaiServiceTier === undefined
      ? {}
      : { openaiServiceTier: diagnostics.openaiServiceTier }),
  };
}

/**
 * 粗略 token 估算（~4 字符/token）。仅在 provider 流式响应不回 usage（token 全 0）时
 * 作为团队度量 / 月度用量统计的兜底，保证「用了却归零」不再发生；有真实 usage 时不启用。
 *
 * 导出仅为单测；运行时只在本模块内 onFinish 处调用。
 */
export function estimateTokensFromText(text: string | null | undefined): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/** 估算一组发往模型的消息的输入 token 数（按整体 JSON 序列化长度近似）。导出仅为单测。 */
export function estimateModelMessagesTokens(messages: readonly unknown[]): number {
  if (!Array.isArray(messages) || messages.length === 0) return 0;
  let chars = 0;
  for (const message of messages) {
    try {
      const content = (message as { content?: unknown })?.content;
      chars += typeof content === 'string' ? content.length : JSON.stringify(content ?? '').length;
    } catch {
      // 序列化失败（极少）跳过该条，不阻塞估算。
    }
  }
  return Math.ceil(chars / 4);
}

type WorkflowStepHandle = ReturnType<WorkflowLogger['start']>;

interface StreamAccumulationState {
  assistantThinkingBlocks: ReasoningBlock[];
  assistantText: string;
  /**
   * Per-call accumulator. `providerMetadata` is attached when the
   * upstream `tool-call` event surfaces a `providerMetadata` payload —
   * the OpenAI Responses adapter sends `openai.itemId` (`fc_xxx`)
   * here, and replaying it on subsequent rounds is required for the
   * upstream prompt-cache prefix to stay byte-stable across turns
   * (without it, the native upstream rebuilds `function_call.id` from the call_id
   * fallback, OpenAI re-keys the item, and every subsequent round 2+
   * cache-prefix from this point on misses).
   */
  toolCalls: Map<
    string,
    {
      toolName: string;
      inputText: string;
      providerMetadata?: Record<string, Record<string, unknown>>;
    }
  >;
  /**
   * Ordered record of every reasoning / text / tool_call segment as it arrives
   * over the wire. `buildAssistantContent` uses this to persist messages in
   * the true event order so refreshed transcripts and live streams render the
   * same sequence (e.g. tool → text → tool → text rather than the legacy
   * `reasoning → text → tool` flattening which loses interleaving).
   * Tool segments hold a stable `toolCallId` reference so streamed
   * `tool_call_delta` chunks for the same call merge in place instead of
   * appending duplicate segments per delta.
   */
  contentSegments: OrderedContentSegment[];
  /** Timestamp of the first text_delta or thinking_delta chunk. */
  firstContentAt?: number;
  /** Encrypted reasoning content from Responses API, needed for multi-turn. */
  reasoningEncryptedContent?: string;
  /** Reasoning output item id from Responses API, needed for multi-turn replay. */
  reasoningItemId?: string;
  /** Reasoning summary from Responses API. */
  reasoningSummary?: string;
  /** Response ID from Responses API, used as previous_response_id for caching. */
  responseId?: string;
}

type OrderedContentSegment =
  | { kind: 'text'; text: string }
  | {
      kind: 'reasoning';
      /**
       * Stable identity of the reasoning block this segment mirrors,
       * derived via `buildReasoningBlockKey(chunk)` so we can match later
       * deltas back to the same segment regardless of intervening text /
       * tool segments. (Switching from `blockIndex: number` because the
       * "length-1" trick to find the just-touched block was wrong when
       * `appendReasoningChunk` extended a non-tail block, causing later
       * deltas of an earlier block to leak into a different segment and
       * scramble the rendered order.)
       */
      blockKey: string;
      text: string;
      startedAt?: number;
      endedAt?: number;
    }
  | { kind: 'tool_call'; toolCallId: string; toolName: string };

const CJK_RANGE = /[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/;

function detectUserLanguageHint(
  messages: Array<{ role: string; content: string | null }>,
): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!;
    if (msg.role !== 'user' || !msg.content) continue;
    const text = msg.content;
    if (CJK_RANGE.test(text)) {
      const jaRatio = (text.match(/[\u3040-\u309f\u30a0-\u30ff]/g) || []).length;
      const krRatio = (text.match(/[\uac00-\ud7af]/g) || []).length;
      const zhRatio = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
      if (krRatio > zhRatio && krRatio > jaRatio)
        return '한국어로 생각하세요. 한국어로만 사고하세요.';
      if (jaRatio > zhRatio) return '日本語で思考してください。必ず日本語のみで思考してください。';
      return '请用中文进行思考。你必须全程使用中文思考，绝对不要切换到英文。';
    }
  }
  return null;
}

function buildThinkingLanguageHint(
  messages: Array<{ role: string; content: string | null }>,
): string | null {
  return detectUserLanguageHint(messages);
}

/**
 * UnifiedMessage version of applyThinkingLanguageHintToConversation.
 *
 * Legacy in-memory fallback for sessions whose user messages were stored
 * before persist-time thinking-hint injection landed. New user messages
 * carry the hint as a `synthetic: true` trailing text part written by
 * `persistStreamUserMessage` → `resolvePersistedUserContent`, which keeps
 * the prompt-cache prefix byte-stable across turns. When the latest user
 * message already contains a known hint marker (post-fix or already-
 * injected legacy session) we skip injection so we don't double-append
 * and re-introduce the byte-instability the caching fix was designed to
 * eliminate.
 */
function applyThinkingLanguageHintToUnifiedMessages(
  messages: UnifiedMessage[],
  hint: string | null,
): UnifiedMessage[] {
  if (!hint) return messages;
  const result: UnifiedMessage[] = messages.map((msg) => ({ ...msg }));
  for (let i = result.length - 1; i >= 0; i--) {
    const msg = result[i]!;
    if (msg.role === 'user') {
      const content = typeof msg.content === 'string' ? msg.content : '';
      // Skip injection when the persisted user content already carries a
      // recognised thinking-language hint (post-fix sessions write it as
      // a `synthetic: true` trailing text part in DB).
      const alreadyHasHint = THINKING_LANGUAGE_HINT_MARKERS.some((marker) =>
        content.includes(marker),
      );
      if (alreadyHasHint) {
        break;
      }
      msg.content = `${msg.content}\n\n[${hint}]`;
      break;
    }
  }
  return result;
}

/**
 * UnifiedMessage version of injectSyntheticRequestContext.
 *
 * Legacy in-memory fallback for sessions whose user messages were stored
 * before persist-time synthetic injection landed. New user messages get the
 * synthetic block stored as a `synthetic: true` text part by
 * `persistStreamUserMessage` → `resolvePersistedUserContent`, which keeps
 * the prompt-cache prefix byte-stable across turns (the websearch low-cache-
 * hit root cause). When the latest user message already starts with the
 * persisted `<system-reminder>` envelope we skip injection so we don't
 * double-prepend (and thus don't mutate the byte-identical prefix that the
 * upstream prompt cache is pointing at).
 */
// Exported for unit tests; production code should keep going through
// `runModelRound`. See `__tests__/inject-synthetic-request-context.test.ts`.
export function injectSyntheticRequestContextUnified(
  messages: UnifiedMessage[],
  context: SyntheticRequestContext,
): UnifiedMessage[] {
  const block = buildSyntheticRequestContextBlock(context);
  if (!block) return messages;

  const result: UnifiedMessage[] = messages.map((msg) => ({ ...msg }));
  for (let i = result.length - 1; i >= 0; i--) {
    const msg = result[i]!;
    if (msg.role === 'user') {
      // Skip injection when the persisted user content already carries the
      // `<system-reminder>` envelope (post-fix sessions). Mirrors the
      // marker emitted by `resolvePersistedUserContent`.
      const content = typeof msg.content === 'string' ? msg.content : '';
      if (content.startsWith('<system-reminder>\n')) {
        break;
      }
      msg.content = `<system-reminder>\n${block}\n</system-reminder>\n\n${msg.content}`;
      break;
    }
  }
  return result;
}

function createAccumulationState(): StreamAccumulationState {
  return {
    assistantThinkingBlocks: [],
    assistantText: '',
    toolCalls: new Map(),
    contentSegments: [],
    reasoningEncryptedContent: undefined,
    reasoningSummary: undefined,
  };
}

function _buildAssistantTextWithThinking(text: string, thinking: string): string {
  const normalizedThinking = thinking.trim();
  const normalizedText = text.trim();

  if (normalizedThinking.length === 0) {
    return text;
  }

  const fenceMatches = normalizedThinking.match(/`{3,}/g);
  const longestFence = fenceMatches?.reduce((max, value) => Math.max(max, value.length), 2) ?? 2;
  const fence = '`'.repeat(longestFence + 1);
  const thinkingBlock = `${fence}thinking\n${normalizedThinking}\n${fence}`;
  return normalizedText.length > 0 ? `${thinkingBlock}\n\n${text}` : thinkingBlock;
}

function accumulateChunk(state: StreamAccumulationState, chunk: StreamChunk): void {
  if (chunk.type === 'text_delta') {
    if (state.firstContentAt === undefined) state.firstContentAt = Date.now();
    state.assistantText += chunk.delta;
    // Order-preserving mirror: extend the trailing text segment if the most
    // recent segment is also text, otherwise open a new one. This way the
    // segment list keeps the original interleaving with reasoning / tool
    // segments instead of being collapsed into a single tail-text block.
    const last = state.contentSegments.at(-1);
    if (last?.kind === 'text') {
      last.text += chunk.delta;
    } else {
      state.contentSegments.push({ kind: 'text', text: chunk.delta });
    }
    return;
  }

  if (chunk.type === 'thinking_start') {
    // Pure UI hint — gateway accumulator has nothing to do because reasoning
    // blocks are created lazily on first delta. Forwarded to clients via
    // `writeChunk` upstream of this accumulator.
    return;
  }

  if (chunk.type === 'thinking_delta') {
    if (state.firstContentAt === undefined) state.firstContentAt = Date.now();
    state.assistantThinkingBlocks = appendReasoningChunk(state.assistantThinkingBlocks, chunk);
    // Trailing-segment extension only: if the wire stream interleaves
    // reasoning with text/tool deltas (e.g. reasoning_A → text →
    // reasoning_A → tool), each reasoning run produces its own segment so
    // the persisted ordering matches the true wire arrival. Segments share
    // a `blockKey` for identity (and metadata mirroring), but the `text`
    // captured here is the *delta* for this contiguous run, not the
    // block's combined full text.
    const blockKey = buildReasoningBlockKey(chunk);
    const block = state.assistantThinkingBlocks.find((entry) => entry.key === blockKey);
    const last = state.contentSegments.at(-1);
    if (last?.kind === 'reasoning' && last.blockKey === blockKey) {
      last.text += chunk.delta;
      if (last.startedAt === undefined && typeof block?.startedAt === 'number') {
        last.startedAt = block.startedAt;
      }
      if (typeof block?.endedAt === 'number') last.endedAt = block.endedAt;
    } else {
      state.contentSegments.push({
        kind: 'reasoning',
        blockKey,
        text: chunk.delta,
        ...(typeof block?.startedAt === 'number' ? { startedAt: block.startedAt } : {}),
        ...(typeof block?.endedAt === 'number' ? { endedAt: block.endedAt } : {}),
      });
    }
    return;
  }

  if (chunk.type === 'thinking_end') {
    state.assistantThinkingBlocks = markReasoningBlockEnded(state.assistantThinkingBlocks, chunk);
    // Capture Responses-API encrypted reasoning payload (forwarded by
    // the v2 stream-runner via thinking_end.providerMetadata) so the
    // round-2 input replay includes the same encrypted reasoning item
    // the upstream produced. Without this, OpenAI rejects round 2 as
    // "missing reasoning replay".
    const pmd = chunk.providerMetadata;
    if (pmd && typeof pmd.encryptedContent === 'string' && pmd.encryptedContent.length > 0) {
      state.reasoningEncryptedContent = pmd.encryptedContent;
    }
    if (pmd && typeof pmd.summary === 'string' && pmd.summary.length > 0) {
      state.reasoningSummary = pmd.summary;
    }
    if (pmd && typeof pmd.responseId === 'string' && pmd.responseId.length > 0) {
      state.responseId = pmd.responseId;
    }
    if (typeof chunk.itemId === 'string' && chunk.itemId.trim().length > 0) {
      state.reasoningItemId = chunk.itemId;
    }
    // Mark every matching segment's endedAt. With the trailing-segment
    // accumulation strategy, a single reasoning block may have produced
    // multiple non-contiguous segments; closing all of them prevents the
    // earlier slices from rendering as "still thinking" forever. Legacy
    // chunks without identity close all open reasoning segments, mirroring
    // `markReasoningBlockEnded`'s fallback. We do *not* overwrite
    // `segment.text` from `block.text` — segments carry per-run deltas
    // now, while `block.text` is the merged full reasoning.
    const hasIdentity =
      (typeof chunk.itemId === 'string' && chunk.itemId.trim().length > 0) ||
      typeof chunk.outputIndex === 'number' ||
      typeof chunk.summaryIndex === 'number';
    const endedAt = chunk.occurredAt ?? Date.now();
    if (hasIdentity) {
      const targetKey = buildReasoningBlockKey(chunk);
      for (const segment of state.contentSegments) {
        if (segment.kind !== 'reasoning' || segment.blockKey !== targetKey) continue;
        if (segment.endedAt === undefined) segment.endedAt = endedAt;
      }
    } else {
      for (const segment of state.contentSegments) {
        if (segment.kind !== 'reasoning') continue;
        if (segment.endedAt === undefined) segment.endedAt = endedAt;
      }
    }
    return;
  }

  if (chunk.type !== 'tool_call_delta') return;
  const existing = state.toolCalls.get(chunk.toolCallId);
  // Merge provider metadata across deltas. The streaming opener and
  // per-input deltas leave it undefined; the *closer* delta emitted at
  // tool-call resolution is what ferries `openai.itemId` (`fc_xxx`)
  // and any sibling provider keys. Earlier metadata (if any) wins for
  // a given (provider, key) tuple — we only fill empty slots so a
  // closer that re-affirms `openai.itemId` does not clobber it.
  const incomingMetadata = chunk.providerMetadata;
  const mergedMetadata = mergeToolCallProviderMetadata(
    existing?.providerMetadata,
    incomingMetadata,
  );
  state.toolCalls.set(chunk.toolCallId, {
    toolName: chunk.toolName,
    inputText: `${existing?.inputText ?? ''}${chunk.inputDelta}`,
    ...(mergedMetadata ? { providerMetadata: mergedMetadata } : {}),
  });
  // Order-preserving mirror: ensure exactly one tool_call segment per
  // toolCallId, positioned where it first appeared in the wire stream.
  // Subsequent argument deltas update toolCalls map only — segment carries
  // just the identity reference and buildAssistantContent reads the latest
  // input from the map at finalize time.
  if (
    !state.contentSegments.some(
      (segment) => segment.kind === 'tool_call' && segment.toolCallId === chunk.toolCallId,
    )
  ) {
    state.contentSegments.push({
      kind: 'tool_call',
      toolCallId: chunk.toolCallId,
      toolName: chunk.toolName,
    });
  }
}

/**
 * Merge two `tool-call.providerMetadata` records, preferring values
 * that already exist on the in-flight accumulator. Both arguments are
 * allowed to be undefined; the result is undefined when neither side
 * supplied a non-empty payload, so callers can spread the return into
 * `{ ...(merged ? { providerMetadata: merged } : {}) }` without
 * persisting an empty object.
 *
 * Why "earlier-wins": the OpenAI Responses protocol emits `openai.itemId`
 * on the first `tool-call` event for a
 * given call_id. A late re-emit (e.g. after a retry) carrying the
 * same id is harmless, but a closer that arrives with an empty
 * payload must NOT overwrite the previously-captured itemId.
 */
function mergeToolCallProviderMetadata(
  existing: Record<string, Record<string, unknown>> | undefined,
  incoming: Record<string, Record<string, unknown>> | undefined,
): Record<string, Record<string, unknown>> | undefined {
  if (!existing && !incoming) return undefined;
  if (!existing) return incoming;
  if (!incoming) return existing;
  const merged: Record<string, Record<string, unknown>> = { ...existing };
  for (const [providerKey, providerValue] of Object.entries(incoming)) {
    const previous = merged[providerKey];
    if (!previous) {
      merged[providerKey] = providerValue;
      continue;
    }
    merged[providerKey] = { ...providerValue, ...previous };
  }
  return merged;
}

function parseToolInput(raw: string): Record<string, unknown> {
  const normalized = raw.trim();
  if (normalized.length === 0) {
    return {};
  }

  try {
    const parsed = JSON.parse(normalized) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return { raw: normalized };
  }

  return { raw: normalized };
}

function buildAssistantContent(
  state: StreamAccumulationState,
  turnFileDiffs?: Map<string, FileDiffContent>,
): MessageContent[] {
  // Preferred path: emit MessageContent[] in the same wire order the chunks
  // arrived in. This drives both persistence and `partsFromAssistantTrace`
  // so refreshed transcripts mirror what the live stream rendered, and
  // tool / text / reasoning interleaving (round-internal sequence) is
  // preserved instead of being flattened to reasoning → text → tool.
  if (state.contentSegments.length > 0) {
    return buildOrderedAssistantContent(state, turnFileDiffs);
  }

  // Fallback path (legacy): kept for safety in case a code path bypasses
  // accumulateChunk and writes directly to the flat fields. Mirrors the
  // historical reasoning → text → tool ordering. Once we are confident the
  // segment-based path covers every accumulator entry point, this branch
  // can be removed.
  const content: MessageContent[] = [];
  const reasoningItemId =
    state.reasoningItemId ??
    state.assistantThinkingBlocks
      .map((block) => /^item:(.*):output:-?\d+:summary:-?\d+$/.exec(block.key)?.[1])
      .find((itemId): itemId is string => typeof itemId === 'string' && itemId.length > 0);

  // Store reasoning as a separate part so it can be reconstructed
  // as a reasoning item for the Responses API in multi-turn conversations.
  const reasoningEntries = extractReasoningEntries(state.assistantThinkingBlocks);
  if (
    reasoningEntries.length > 0 ||
    Boolean(reasoningItemId) ||
    Boolean(state.reasoningEncryptedContent) ||
    Boolean(state.reasoningSummary) ||
    Boolean(state.responseId)
  ) {
    if (reasoningEntries.length === 0) {
      content.push({
        type: 'reasoning',
        text: '',
        ...(reasoningItemId ? { itemId: reasoningItemId } : {}),
        ...(state.reasoningEncryptedContent
          ? { encryptedContent: state.reasoningEncryptedContent }
          : {}),
        ...(state.reasoningSummary ? { summary: state.reasoningSummary } : {}),
        ...(state.responseId ? { responseId: state.responseId } : {}),
      });
    } else {
      reasoningEntries.forEach((entry, index) => {
        content.push({
          type: 'reasoning',
          text: entry.text,
          ...(typeof entry.startedAt === 'number' ? { startedAt: entry.startedAt } : {}),
          ...(typeof entry.endedAt === 'number' ? { endedAt: entry.endedAt } : {}),
          ...(typeof entry.signature === 'string' && entry.signature.length > 0
            ? { signature: entry.signature }
            : {}),
          ...(index === 0 && reasoningItemId ? { itemId: reasoningItemId } : {}),
          ...(index === 0 && state.reasoningEncryptedContent
            ? { encryptedContent: state.reasoningEncryptedContent }
            : {}),
          ...(index === 0 && state.reasoningSummary ? { summary: state.reasoningSummary } : {}),
          ...(index === 0 && state.responseId ? { responseId: state.responseId } : {}),
        });
      });
    }
  }

  if (state.assistantText.trim().length > 0) {
    content.push({ type: 'text', text: state.assistantText.trim() });
  }

  state.toolCalls.forEach((toolCall, toolCallId) => {
    const inputText = toolCall.inputText.trim();
    content.push({
      type: 'tool_call',
      toolCallId,
      toolName: toolCall.toolName,
      input: parseToolInput(inputText),
      ...(inputText.length > 0 ? { rawArguments: inputText } : {}),
      ...(toolCall.providerMetadata && Object.keys(toolCall.providerMetadata).length > 0
        ? { providerMetadata: toolCall.providerMetadata }
        : {}),
    });
  });

  const summary = turnFileDiffs ? buildModifiedFilesSummaryContent(turnFileDiffs) : null;
  if (summary) {
    content.push(summary);
  }

  return content.length > 0 ? content : [{ type: 'text', text: '' }];
}

function buildOrderedAssistantContent(
  state: StreamAccumulationState,
  turnFileDiffs?: Map<string, FileDiffContent>,
): MessageContent[] {
  const content: MessageContent[] = [];
  const reasoningItemId =
    state.reasoningItemId ??
    state.assistantThinkingBlocks
      .map((block) => /^item:(.*):output:-?\d+:summary:-?\d+$/.exec(block.key)?.[1])
      .find((itemId): itemId is string => typeof itemId === 'string' && itemId.length > 0);
  // Some Responses-API metadata only attaches once per assistant message, so
  // we apply it to the first reasoning segment we emit (matching the legacy
  // path's `index === 0` semantics).
  let reasoningMetadataAttached = false;
  // If reasoning text is empty but Responses-API metadata is present, the
  // legacy path still emitted a synthetic reasoning placeholder so multi-turn
  // calls can replay encrypted reasoning. Mirror that behaviour by injecting
  // a placeholder ahead of any other content when no reasoning segment will
  // otherwise carry the metadata.
  const hasResponsesMeta =
    Boolean(reasoningItemId) ||
    Boolean(state.reasoningEncryptedContent) ||
    Boolean(state.reasoningSummary) ||
    Boolean(state.responseId);
  const hasReasoningSegment = state.contentSegments.some((segment) => segment.kind === 'reasoning');
  if (hasResponsesMeta && !hasReasoningSegment) {
    content.push({
      type: 'reasoning',
      text: '',
      ...(reasoningItemId ? { itemId: reasoningItemId } : {}),
      ...(state.reasoningEncryptedContent
        ? { encryptedContent: state.reasoningEncryptedContent }
        : {}),
      ...(state.reasoningSummary ? { summary: state.reasoningSummary } : {}),
      ...(state.responseId ? { responseId: state.responseId } : {}),
    });
    reasoningMetadataAttached = true;
  }

  for (const segment of state.contentSegments) {
    if (segment.kind === 'text') {
      const trimmed = segment.text.trim();
      if (trimmed.length === 0) continue;
      content.push({ type: 'text', text: trimmed });
      continue;
    }

    if (segment.kind === 'reasoning') {
      // Segments now carry per-run deltas (not the merged block full text)
      // so the persisted MessageContent[] reflects the true wire ordering
      // when reasoning is interleaved with text/tool segments. The
      // ReasoningBlock is consulted only as a fallback for missing
      // timestamps (e.g. block.startedAt/endedAt may be set by upstream
      // but the chunk lacked occurredAt).
      const block = state.assistantThinkingBlocks.find((entry) => entry.key === segment.blockKey);
      const text = segment.text;
      const startedAt = segment.startedAt ?? block?.startedAt;
      const endedAt = segment.endedAt ?? block?.endedAt;
      const shouldAttachMeta = !reasoningMetadataAttached && hasResponsesMeta;
      // Skip orphan reasoning segments — i.e. a `thinking_start` was emitted
      // but the wire stream got cut to a tool_use (or finished early)
      // before any `thinking_delta` arrived AND no Responses-API metadata
      // (encryptedContent / summary / responseId) needs to ride along.
      // Persisting these segments serves no purpose: the model can't
      // consume them on the next turn (no encrypted payload), and the
      // client renders them as a stray "Thinking:" header with no body.
      // Real content (text non-empty) and the metadata-carrying placeholder
      // both still emit below.
      if (text.trim().length === 0 && !shouldAttachMeta) {
        continue;
      }
      const signature = block?.signature;
      content.push({
        type: 'reasoning',
        text,
        ...(typeof startedAt === 'number' ? { startedAt } : {}),
        ...(typeof endedAt === 'number' ? { endedAt } : {}),
        ...(typeof signature === 'string' && signature.length > 0 ? { signature } : {}),
        ...(shouldAttachMeta && reasoningItemId ? { itemId: reasoningItemId } : {}),
        ...(shouldAttachMeta && state.reasoningEncryptedContent
          ? { encryptedContent: state.reasoningEncryptedContent }
          : {}),
        ...(shouldAttachMeta && state.reasoningSummary ? { summary: state.reasoningSummary } : {}),
        ...(shouldAttachMeta && state.responseId ? { responseId: state.responseId } : {}),
      });
      if (shouldAttachMeta) reasoningMetadataAttached = true;
      continue;
    }

    // tool_call segment: read the latest accumulated arguments from
    // state.toolCalls so streamed deltas land in the right call.
    const toolCallEntry = state.toolCalls.get(segment.toolCallId);
    if (!toolCallEntry) continue;
    const inputText = toolCallEntry.inputText.trim();
    content.push({
      type: 'tool_call',
      toolCallId: segment.toolCallId,
      toolName: toolCallEntry.toolName,
      input: parseToolInput(inputText),
      ...(inputText.length > 0 ? { rawArguments: inputText } : {}),
      ...(toolCallEntry.providerMetadata && Object.keys(toolCallEntry.providerMetadata).length > 0
        ? { providerMetadata: toolCallEntry.providerMetadata }
        : {}),
    });
  }

  const summary = turnFileDiffs ? buildModifiedFilesSummaryContent(turnFileDiffs) : null;
  if (summary) {
    content.push(summary);
  }

  return content.length > 0 ? content : [{ type: 'text', text: '' }];
}

function buildErrorContent(code: string, message: string): MessageContent[] {
  return [{ type: 'text', text: `[错误: ${code}] ${message}`.trim() }];
}

export function buildUserFacingStreamErrorMessage(input: {
  classificationMessage?: string;
  fallbackMessage: string;
}): string {
  const message = input.classificationMessage?.trim();
  if (message && message.length > 0) {
    switch (message) {
      case 'Provider is overloaded':
        return '模型服务当前负载过高，请稍后重试。';
      case 'Rate Limited':
      case 'Too Many Requests':
        return '请求过于频繁，请稍后重试。';
      default:
        return message;
    }
  }
  return STREAM_RUNTIME_ERROR_MESSAGES.genericStreamError;
}

function isToolUseStopReason(reason: StreamStopReason): boolean {
  return reason === 'tool_use';
}

function isTeamSession(sessionContext: SessionStreamContext): boolean {
  return sessionContext.roleLayer !== null;
}

import type { StreamRequest } from './stream.js';

function createIntermediateAssistantRequestId(clientRequestId: string, round: number): string {
  return `${clientRequestId}:assistant:${round}`;
}

function mergeStreamUsageSummary(
  previous: StreamUsageSummary | undefined,
  next: StreamUsageSummary,
): StreamUsageSummary {
  if (!previous) {
    return next;
  }

  const primary = next.totalTokens >= previous.totalTokens ? next : previous;
  const fallback = primary === next ? previous : next;
  const reasoningTokens = primary.reasoningTokens ?? fallback.reasoningTokens;
  const cacheReadTokens = primary.cacheReadTokens ?? fallback.cacheReadTokens;
  const cacheWriteTokens = primary.cacheWriteTokens ?? fallback.cacheWriteTokens;
  return {
    inputTokens: primary.inputTokens,
    outputTokens: primary.outputTokens,
    totalTokens: primary.totalTokens,
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
    ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
    ...(cacheWriteTokens !== undefined ? { cacheWriteTokens } : {}),
  };
}

/**
 * Capture a shadow-git tree snapshot for the just-finalized round and
 * persist a row in `snapshot_trees`. Best-effort: any failure is logged
 * but never propagated since the legacy snapshotRef path already covered
 * persistence. Runs after `finalizeAssistant` returns so it never blocks
 * the streaming response.
 */
async function captureSnapshotTreeBestEffort(input: {
  clientRequestId: string;
  round: number;
  reason: StreamStopReason;
  sessionContext: SessionStreamContext;
  sessionId: string;
  userId: string;
  diffFiles: FileDiffContent[];
}): Promise<void> {
  try {
    // 递归解析 workingDirectory：子 session 可能没有直接设置，
    // 需要通过 DB 列 team_parent_session_id 向上查找父 session 链。
    const rawWorkspace = resolveSessionWorkspacePath({
      metadataJson: input.sessionContext.metadataJson,
      sessionId: input.sessionId,
      userId: input.userId,
    });
    if (!rawWorkspace) return;

    // Defense in depth: only capture when the workspace path passes the
    // gateway's allowlist. This prevents a malicious or stale session
    // metadata payload from steering the shadow-git engine at an
    // unintended directory.
    const workspaceRoot = validateWorkspacePath(rawWorkspace);
    if (!workspaceRoot) return;

    const engine = getSnapshotEngine();
    if (!(await engine.isShadowGitEnabled())) return;

    const captureResult = await engine.capture({ workspaceRoot });
    if (captureResult.ref.kind !== 'git') return;

    // Link the new tree to the previous one so traceSnapshotTreeChain can
    // walk back to baseline. We pick the latest persisted tree for this
    // session as the parent — turn-finalize is the natural sequencing
    // boundary for the chain, so picking by created_at DESC is safe.
    const previous = getLatestSnapshotTreeForSession({
      sessionId: input.sessionId,
      userId: input.userId,
    });
    const parentTreeHash =
      previous && previous.treeHash !== captureResult.ref.hash ? previous.treeHash : null;

    persistSnapshotTree({
      sessionId: input.sessionId,
      userId: input.userId,
      clientRequestId: input.clientRequestId,
      treeHash: captureResult.ref.hash,
      parentTreeHash,
      scopeKind: input.reason === 'tool_use' ? 'step' : 'turn',
      sourceKind: 'session_snapshot',
      guaranteeLevel: captureResult.guaranteeLevel,
      fileDiffs: input.diffFiles,
    });
  } catch (error) {
    // Don't fail the response on snapshot capture errors.
    console.warn(
      '[stream-model-round] shadow-git capture failed:',
      error instanceof Error ? error.message : String(error),
    );
  }
}

export async function runModelRound(input: {
  clientRequestId: string;
  enabledTools: ReturnType<typeof getEnabledTools>;
  eventSequence: { value: number };
  requestData: StreamRequest;
  round: number;
  route: ReturnType<typeof resolveModelRoute>;
  runId: string;
  signal: AbortSignal;
  sessionContext: SessionStreamContext;
  sessionId: string;
  transport: 'SSE' | 'WS';
  turnFileDiffs?: Map<string, FileDiffContent>;
  userId: string;
  wl: WorkflowLogger;
  ctx: ReturnType<typeof createRequestContext>;
  compactionAutoEnabled?: boolean;
  compactionReservedTokens?: number;
  workspaceCtx: string | null;
  injectedPrompt?: string | null;
  capabilityContext?: string | null;
  lspGuidance?: string | null;
  dialogueModePrompt?: string | null;
  yoloModePrompt?: string | null;
  flatMcpToolsEnabled?: boolean;
  companionPrompt?: string | null;
  dynamicAgentPrompt?: string | null;
  startWorkContext?: string | null;
  commandContext?: string | null;
  /**
   * Optional pinned skills section (PR3). Captured per-session at first turn
   * and rendered into the stable system prompt prefix. See
   * `pinned-skills-prompt.ts`.
   */
  pinnedSkillsPrompt?: string | null;
  /**
   * 260515-team-phase-a · 7 层团队指令栈（含 cache breaker tag）。
   * 由调用方在 round 起始前 await `buildTeamInstructionStack(...)` 取得。
   */
  teamInstructionStack?: string | null;
  teamResumePrompt?: string | null;
  teamStatusPrompt?: string | null;
  syntheticContinuationPrompt?: string;
  memoryBlock?: string | null;
  /** Agent ID for the current stream round (for per-agent color rendering). */
  agentId?: string;
  writeChunk: (chunk: RunEvent) => void;
  beforeUpstreamCall?: (renderedMessageTokens: number) => Promise<boolean>;
}): Promise<{
  overflow: boolean;
  shouldContinue: boolean;
  shouldStop: boolean;
  stopReason: StreamStopReason;
  statusCode: number;
  state: StreamAccumulationState;
  upstreamError?: UpstreamErrorDescriptor;
  usage?: StreamUsageSummary;
  usageOccurredAt?: number;
}> {
  const compactionAutoEnabled = input.compactionAutoEnabled ?? true;
  let streamDiagnostics = createEmptyStreamDiagnosticsSummary();

  // ── 构建 ThinkingConfig（支持新版 + 旧版参数）──
  // 优先使用新版 thinking 参数；如果不存在，则从旧版参数构建
  const thinkingConfig: ThinkingConfig | undefined =
    input.requestData.thinking ??
    (input.requestData.thinkingEnabled !== undefined ||
    input.requestData.reasoningEffort !== undefined
      ? (() => {
          if (input.requestData.thinkingEnabled === false) {
            return { type: 'disabled' as const };
          }
          const effort = input.requestData.reasoningEffort ?? 'medium';
          // 从 effort 推断 budgetTokens（使用 Anthropic 映射表作为默认）
          const BUDGET_MAP: Record<string, number> = {
            none: 0,
            minimal: 1024,
            low: 4096,
            medium: 8192,
            high: 16384,
            xhigh: 31999,
            max: 31999,
          };
          return {
            type: 'enabled' as const,
            budgetTokens: BUDGET_MAP[effort] ?? 8192,
          };
        })()
      : undefined);

  const shouldApplyThinkingConfig = thinkingConfig !== undefined;
  const isThinkingEnabled =
    thinkingConfig?.type === 'adaptive' || thinkingConfig?.type === 'enabled';

  const thinkingLanguagePrompt =
    shouldApplyThinkingConfig && isThinkingEnabled
      ? '思考模式已启用。你的内部思考链必须与用户消息使用完全相同的语言。用户用中文提问 → 你必须全程用中文思考；用户用日文提问 → 你必须全程用日文思考；以此类推。绝对不要在思考链中切换到英文，即使你习惯用英文推理也必须遵守。'
      : null;

  // ── New 2-layer pipeline (opencode pattern) ──
  // Layer 0: Filter messages after the most recent compaction boundary
  // (opencode's filterCompacted — discard pre-compaction messages to avoid
  // sending stale data that duplicates the compaction summary).
  //
  // We feed `filterCompacted` the newest-first streaming iterator so it can
  // short-circuit at the latest compaction marker / tailStartID without
  // ever materialising the full pre-compaction history in memory.
  const messagesV2 = filterCompacted(
    filterMessagesByTeamTaskThread(
      streamMessagesWithParts({ sessionId: input.sessionId, userId: input.userId }),
      input.requestData.teamTaskThreadId,
    ),
  );
  // Layer 1: MessageWithParts[] → UnifiedMessage[] (single conversion entry point).
  // Intentionally no `stripOldToolResults` here. The previous wall-clock-based
  // 10-minute strip rewrote tool outputs differently across rounds within the
  // same session, which silently invalidated the Anthropic / OpenAI prompt
  // cache prefix mid-conversation. opencode-parity: rendering is pure w.r.t.
  // DB state; bounded context size is enforced by `filterCompacted` + the
  // compaction summary path, plus (future) opencode-style prune that sets
  // `part.state.time.compacted` persistently.
  // opencode parity (message-v2.ts:840): assistant turns produced by a
  // different (providerID, modelID) than the current call have their
  // reasoning metadata (signature/encryptedContent/summary) stripped so
  // we never replay an opaque payload an unrelated model cannot consume.
  const routeProviderId = resolveRouteProviderId(input.route);
  const unifiedMessagesRaw = toModelMessages(messagesV2, {
    currentModel: {
      providerID: routeProviderId ?? 'unknown',
      modelID: input.route.model,
    },
  });

  // ── Layer 0.5: Microcompact (Claude Code pattern) ──
  // Clear stale tool_result outputs before sending to upstream.
  // Zero LLM cost, delays full compaction trigger, keeps context lean.
  // Operates on the rendered UnifiedMessage[] so DB data stays intact.
  const microcompactResult = microcompactMessages(
    unifiedMessagesRaw,
    undefined,
    getMicrocompactTimeContext(messagesV2, input.requestData.teamTaskThreadId),
  );
  const unifiedMessages = microcompactResult.messages;

  // Apply thinking language hint to conversation
  const thinkingUserHint =
    shouldApplyThinkingConfig && isThinkingEnabled
      ? buildThinkingLanguageHint(
          unifiedMessages.filter(
            (m): m is Extract<UnifiedMessage, { role: 'user' }> => m.role === 'user',
          ),
        )
      : null;
  const messagesWithHint = thinkingUserHint
    ? applyThinkingLanguageHintToUnifiedMessages(unifiedMessages, thinkingUserHint)
    : unifiedMessages;

  // Apply synthetic request context (injectedPrompt, capabilityContext, companionPrompt)
  const syntheticContext: SyntheticRequestContext = {
    injectedPrompt: input.injectedPrompt,
    capabilityContext: input.capabilityContext,
    companionPrompt: input.companionPrompt,
  };
  // Apply synthetic context using UnifiedMessage-aware helper
  const messagesWithSynthetic = injectSyntheticRequestContextUnified(
    messagesWithHint,
    syntheticContext,
  );

  // Layer 2: 2-segment system prompt (opencode `[header, rest]` pattern)
  // + UnifiedMessage[] → ProviderAdapter.render.
  //
  // The system list is intentionally kept at exactly 2 messages so both
  // segments line up with the 2 system-block cache breakpoints used by
  // Anthropic / OpenRouter / Bedrock renderers and the v2 runtime
  // applyCaching helper. Mixing dynamic content (orchestrator
  // delegation tables, start-work boulder, slash-command instruction,
  // memory block) into the stable prefix would invalidate the prefix
  // hash on every round and tank cache hit rate.
  const { stable: stableSystemContent, dynamic: dynamicSystemContent } = buildTwoPartSystemPrompts({
    workspaceCtx: input.workspaceCtx,
    routeSystemPrompt: input.route.systemPrompt,
    lspGuidance: input.lspGuidance,
    dialogueModePrompt: input.dialogueModePrompt,
    yoloModePrompt: input.yoloModePrompt,
    flatMcpToolsEnabled: input.flatMcpToolsEnabled,
    thinkingLanguagePrompt,
    dynamicAgentPrompt: input.dynamicAgentPrompt,
    startWorkContext: input.startWorkContext,
    commandContext: input.commandContext,
    pinnedSkillsPrompt: input.pinnedSkillsPrompt,
    teamInstructionStack: input.teamInstructionStack,
  });

  const memoryContent = input.memoryBlock ?? '<user-memory />\n当前会话无持久化记忆。';
  const channelPersonaPrompt = buildChannelPersonaPromptFromMetadata(
    input.sessionContext.metadataJson,
  );
  const dynamicSystemTail = [
    dynamicSystemContent,
    channelPersonaPrompt,
    input.teamResumePrompt ?? null,
    input.teamStatusPrompt ?? null,
    memoryContent,
  ]
    .filter((s): s is string => typeof s === 'string' && s.length > 0)
    .join('\n\n');

  // Compose final message list: system prompts + conversation + optional continuation
  const allUnifiedMessages: UnifiedMessage[] = [
    ...(stableSystemContent.length > 0
      ? [{ role: 'system' as const, content: stableSystemContent } satisfies UnifiedMessage]
      : []),
    ...(dynamicSystemTail.length > 0
      ? [{ role: 'system' as const, content: dynamicSystemTail } satisfies UnifiedMessage]
      : []),
    ...messagesWithSynthetic,
    ...(input.syntheticContinuationPrompt
      ? [{ role: 'user' as const, content: input.syntheticContinuationPrompt } as UnifiedMessage]
      : []),
  ];

  if (input.beforeUpstreamCall) {
    const compacted = await input.beforeUpstreamCall(
      estimateModelMessagesTokens(allUnifiedMessages),
    );
    if (compacted) {
      return runModelRound({ ...input, beforeUpstreamCall: undefined });
    }
  }

  // Thinking block validator (oh-my-opencode thinking-block-validator pattern):
  // Proactively validate and fix message structure BEFORE sending to Anthropic API.
  const modelId = input.route.model ?? '';
  validateThinkingBlocks(
    allUnifiedMessages as Array<{
      role: string;
      content?: string | unknown[];
      [k: string]: unknown;
    }>,
    modelId,
  );

  // Audit-log the outbound transformation summary. The legacy v1 path
  // serialised a fully-rendered upstream body here; with v2 the native client
  // owns serialisation, so we only record the conversation-shape inputs
  // that drove the call (sufficient for compliance/debug). The actual
  // wire payload is reconstructable from the v2 stream events.
  writeAuditLog({
    sessionId: input.sessionId,
    category: 'llm',
    sourceName: 'UPSTREAM_TRANSFORM',
    requestId: input.clientRequestId,
    input: {
      model: input.route.model,
      round: input.round,
      protocol: input.route.upstreamProtocol,
      messageCount: allUnifiedMessages.length,
      injectedPromptActive: !!input.injectedPrompt,
      capabilityContextActive: !!input.capabilityContext,
      lspGuidanceActive: !!input.lspGuidance,
      dialogueModeActive: !!input.dialogueModePrompt,
      yoloModeActive: !!input.yoloModePrompt,
      companionPromptActive: !!input.companionPrompt,
      memoryBlockInjected: !!input.memoryBlock,
      syntheticContinuationInjected: !!input.syntheticContinuationPrompt,
      teamResumePromptInjected: !!input.teamResumePrompt,
      teamStatusPromptInjected: !!input.teamStatusPrompt,
      thinkingConfigApplied: shouldApplyThinkingConfig,
      requestOverrideBodyKeys: Object.keys(input.route.requestOverrides.body ?? {}),
      omittedBodyKeys: input.route.requestOverrides.omitBodyKeys ?? [],
    },
    output: {
      message: 'upstream transformation report (v2 path)',
      protocol: input.route.upstreamProtocol,
    },
    isError: false,
  });

  const stepUpstream = input.wl.start(`upstream.fetch.${input.round}`, undefined, {
    maxRetries: input.requestData.upstreamRetryMaxRetries ?? 3,
    model: input.route.model,
    upstreamProtocol: input.route.upstreamProtocol,
    round: input.round,
    stream: true,
  });
  const state = createAccumulationState();

  // Phase 2.2 — stream-time SessionEvent persistence:
  //   - emit `step.started` at round start so replaySessionEntries can
  //     open a fresh assistant aggregate;
  //   - translate each StreamChunk into typed SessionEvents via the
  //     stateful translator (text.delta, reasoning.*, tool.input.*);
  //   - emit `step.ended` once the round resolves (regardless of stop reason).
  // Persistence is best-effort and never blocks the SSE writer.
  const streamSessionEventState = createStreamSessionEventState();
  const stepStartedAt = Date.now();
  let stepStartedEmitted = false;
  const ensureStepStarted = (): void => {
    if (stepStartedEmitted) return;
    stepStartedEmitted = true;
    try {
      appendSessionEvent({
        sessionId: input.sessionId,
        userId: input.userId,
        clientRequestId: input.clientRequestId,
        event: {
          id: makeSessionEventId(stepStartedAt),
          type: 'step.started',
          timestamp: stepStartedAt,
          model: {
            id: input.route.model,
            providerID: routeProviderId ?? 'unknown',
            ...(input.route.variant ? { variant: input.route.variant } : {}),
          },
        },
      });
    } catch {
      // Swallow — best-effort persistence.
    }
  };
  let stepEndedEmitted = false;
  const emitStepEnded = (
    reason: string,
    usageSummary?: {
      input?: number;
      output?: number;
      reasoning?: number;
      cache?: { read?: number; write?: number };
    },
    cost = 0,
  ): void => {
    if (stepEndedEmitted) return;
    stepEndedEmitted = true;
    try {
      appendSessionEvent({
        sessionId: input.sessionId,
        userId: input.userId,
        clientRequestId: input.clientRequestId,
        event: {
          id: makeSessionEventId(),
          type: 'step.ended',
          timestamp: Date.now(),
          reason,
          cost,
          tokens: {
            input: usageSummary?.input ?? 0,
            output: usageSummary?.output ?? 0,
            reasoning: usageSummary?.reasoning ?? 0,
            cache: {
              read: usageSummary?.cache?.read ?? 0,
              write: usageSummary?.cache?.write ?? 0,
            },
          },
        },
      });
    } catch {
      // Swallow — best-effort persistence.
    }
  };
  let stepStream: WorkflowStepHandle | undefined;
  const finalizeAssistant = (reason: StreamStopReason, usage?: StreamUsageSummary) => {
    const hasAssistantContent =
      extractReasoningTexts(state.assistantThinkingBlocks).length > 0 ||
      state.assistantText.trim().length > 0 ||
      state.toolCalls.size > 0 ||
      !!state.reasoningEncryptedContent ||
      !!state.reasoningSummary;
    if ((reason === 'cancelled' || reason === 'error') && !hasAssistantContent) {
      return;
    }
    // Fail-safe: if the upstream stream ended (normally or abruptly) before
    // emitting `thinking_end` for every active reasoning block, close them now
    // so persisted history reflects the true end state.
    state.assistantThinkingBlocks = closeAllOpenReasoningBlocks(state.assistantThinkingBlocks);
    const assistantContent = buildAssistantContent(
      state,
      reason === 'tool_use' ? undefined : input.turnFileDiffs,
    );
    const assistantMessage = appendSessionMessageV2({
      sessionId: input.sessionId,
      userId: input.userId,
      role: 'assistant',
      content: assistantContent,
      clientRequestId:
        reason === 'tool_use'
          ? createIntermediateAssistantRequestId(input.clientRequestId, input.round)
          : input.clientRequestId,
      createdAt: stepStartedAt,
      completedAt: Date.now(),
      firstContentAt: state.firstContentAt,
      modelID: input.route.model,
      replaceExisting: true,
      ...(routeProviderId ? { providerID: routeProviderId } : {}),
      ...(input.agentId ? { agentId: input.agentId } : {}),
      ...(usage ? { usage } : {}),
    });
    if (reason === 'end_turn') {
      upsertArtifactsFromAssistantMessage({
        clientRequestId: input.clientRequestId,
        content: assistantContent,
        sessionId: input.sessionId,
        userId: input.userId,
      });
    }
    if (input.turnFileDiffs && input.turnFileDiffs.size > 0) {
      const snapshotRef = createRequestSnapshotRef(
        reason === 'tool_use'
          ? createIntermediateAssistantRequestId(input.clientRequestId, input.round)
          : input.clientRequestId,
      );

      // Persist snapshot summary to DB (end_turn only, for backward compat)
      if (reason !== 'tool_use') {
        persistSessionSnapshot({
          sessionId: input.sessionId,
          userId: input.userId,
          snapshotRef,
          fileDiffs: Array.from(input.turnFileDiffs.values()),
        });
      }

      // V2 step-level snapshot/patch (opencode pattern)
      // Every round with file diffs gets SnapshotPart + PatchPart,
      // enabling per-step revert instead of only per-turn.
      const diffFiles = Array.from(input.turnFileDiffs.values());
      if (assistantMessage.id) {
        appendSnapshotPart({
          sessionId: input.sessionId,
          messageId: assistantMessage.id as MessageID,
          snapshotRef,
        });
        appendPatchPart({
          sessionId: input.sessionId,
          messageId: assistantMessage.id as MessageID,
          hash: snapshotRef,
          files: diffFiles.map((d) => d.file),
        });
      }

      // Phase 2: shadow-git tree capture (best-effort, non-blocking).
      // This produces a real git tree hash that supplements the legacy
      // request-scope snapshotRef. When shadow git is unavailable the
      // engine returns a noop and we silently skip (legacy backup path
      // already handled the diffs above).
      const capturePromise = captureSnapshotTreeBestEffort({
        clientRequestId: input.clientRequestId,
        round: input.round,
        reason,
        sessionContext: input.sessionContext,
        sessionId: input.sessionId,
        userId: input.userId,
        diffFiles,
      });
      pendingSnapshotTreeCaptures.add(capturePromise);
      void capturePromise.then(
        () => pendingSnapshotTreeCaptures.delete(capturePromise),
        () => pendingSnapshotTreeCaptures.delete(capturePromise),
      );
    }
  };
  const markFailedRequestScopeMessages = () => {
    updateSessionMessagesStatusByRequestScope({
      clientRequestId: input.clientRequestId,
      roles: ['assistant', 'tool'],
      sessionId: input.sessionId,
      status: 'error',
      userId: input.userId,
    });
  };

  // ── v2-only upstream pipeline ─────────────────────────────────────
  //
  // The legacy v1 fetch + manual SSE parser was removed in the v2
  // cutover. Every round now goes through the native provider factory
  // (`runUpstreamStream`) which handles cache breakpoints, message
  // normalisation, provider-specific thinking options, and protocol
  // decoding uniformly across `chat_completions`, `anthropic_messages`,
  // and Responses once the user opts in via
  // `upstreamProtocol: 'responses'` in provider settings.
  void compactionAutoEnabled;

  try {
    if (input.signal.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    const modelHandle = buildNativeModel({
      providerType: input.route.providerType,
      upstreamProtocol: input.route.upstreamProtocol,
      ...(input.route.apiKey ? { apiKey: input.route.apiKey } : {}),
      ...(input.route.apiBaseUrl ? { baseURL: input.route.apiBaseUrl } : {}),
      ...(input.route.requestOverrides.headers &&
      Object.keys(input.route.requestOverrides.headers).length > 0
        ? { headers: input.route.requestOverrides.headers }
        : {}),
      model: input.route.model,
    });

    // Extract leading system messages from the conversation so they can be
    // passed via the native client's dedicated `system` parameter instead of being
    // embedded in the `messages` array. This avoids the SDK's
    // "system messages in messages can be a security risk" warning while
    // preserving the multi-segment system-prompt design (stable prefix +
    // dynamic suffix) used for prompt-cache breakpoints.
    const { system: systemMessages, messages: nonSystemModelMessages } =
      extractNativeSystemFromUnifiedMessages(allUnifiedMessages);
    const modelMessages = nonSystemModelMessages;

    // Declarations-only ToolSet — the gateway's `enabledTools` are
    // already JSON-schema'd, so we wrap them without an `execute` and
    // let the existing OpenAWork agent loop in `routes/stream.ts`
    // pick up `tool_call_delta` chunks and drive sandboxed execution
    // out-of-band.
    const v2Tools =
      input.enabledTools.length > 0
        ? wrapGatewayToolsForNativeDeclarationsOnly(input.enabledTools)
        : undefined;

    input.wl.succeed(stepUpstream, undefined, {
      toolCount: input.enabledTools.length,
    });
    stepStream = input.wl.start('upstream.stream', undefined, {
      protocol: input.transport,
      upstreamProtocol: input.route.upstreamProtocol,
      round: input.round,
    });

    let stopReason: StreamStopReason = 'end_turn';
    let doneEmitted = false;
    let v2Usage: StreamUsageSummary | undefined;
    let v2UsageOccurredAt: number | undefined;
    let streamedUpstreamError: UpstreamErrorDescriptor | undefined;
    let streamedContextLimitError: ReturnType<typeof parseContextLimitError> = null;
    try {
      if (isTeamSession(input.sessionContext)) {
        touchSessionHeartbeat(input.sessionId);
      }

      const streamProgram = runUpstreamStream({
        model: modelHandle,
        modelId: input.route.model,
        messages: modelMessages,
        // Pass system prompts via the dedicated `system` parameter to avoid
        // the client's security warning about system messages in `messages`.
        // The multi-segment design (stable prefix + dynamic suffix) is
        // preserved because `system` accepts `SystemModelMessage[]`.
        ...(systemMessages.length > 0 ? { system: systemMessages } : {}),
        signal: input.signal,
        runId: input.runId,
        ...(input.agentId ? { agentId: input.agentId } : {}),
        sessionId: input.sessionId,
        providerType: input.route.providerType,
        ...(input.route.openaiFastMode ? { openaiFastMode: true } : {}),
        ...(input.route.upstreamProtocol ? { upstreamProtocol: input.route.upstreamProtocol } : {}),
        ...(input.route.apiKey ? { apiKey: input.route.apiKey } : {}),
        ...(input.route.apiBaseUrl ? { baseURL: input.route.apiBaseUrl } : {}),
        temperature: input.route.temperature,
        maxOutputTokens: input.route.maxTokens,
        requestOverrides: input.route.requestOverrides,
        ...(v2Tools ? { tools: v2Tools } : {}),
        ...(typeof input.requestData.upstreamRetryMaxRetries === 'number'
          ? { maxRetries: input.requestData.upstreamRetryMaxRetries }
          : {}),
        ...(shouldApplyThinkingConfig && input.route.providerType && thinkingConfig
          ? {
              thinking: {
                config: thinkingConfig,
                effort: input.requestData.reasoningEffort,
                providerType: input.route.providerType,
                supportsThinking: input.route.supportsThinking ?? true,
              } satisfies ExtendedThinkingConfig,
            }
          : {}),
        onDiagnostics: (info) => {
          streamDiagnostics = info;
        },
        onFinish: ({ usage }) => {
          const reasoningTokens = normalizeTokenCount(
            usage.outputTokenDetails?.reasoningTokens ?? usage.reasoningTokens,
          );
          const cacheReadTokens = normalizeTokenCount(
            usage.inputTokenDetails?.cacheReadTokens ?? usage.cachedInputTokens,
          );
          const cacheWriteTokens = normalizeTokenCount(usage.inputTokenDetails?.cacheWriteTokens);
          let rawInputTokens = normalizeTokenCount(usage.inputTokens);
          let rawOutputTokens = normalizeTokenCount(usage.outputTokens);
          // 兜底：部分 provider 流式响应不回 usage（token 全 0）。为了让团队度量
          // 面板与月度用量统计不至于「用了却归零」，按 ~4 字符/token 的粗略口径，
          // 从本轮入参消息 / 已累积的助手文本估算。仅在 provider 完全没给时启用，
          // 有真实 usage 时绝不覆盖。
          if (
            rawInputTokens === 0 &&
            rawOutputTokens === 0 &&
            cacheReadTokens === 0 &&
            cacheWriteTokens === 0
          ) {
            const estimatedInput = estimateModelMessagesTokens(modelMessages);
            const estimatedOutput = estimateTokensFromText(state.assistantText);
            if (estimatedInput > 0 || estimatedOutput > 0) {
              rawInputTokens = estimatedInput;
              rawOutputTokens = estimatedOutput;
            }
          }
          const nextUsage: StreamUsageSummary = {
            inputTokens: Math.max(0, rawInputTokens - cacheReadTokens - cacheWriteTokens),
            outputTokens: Math.max(0, rawOutputTokens - reasoningTokens),
            totalTokens: normalizeTokenCount(usage.totalTokens ?? rawInputTokens + rawOutputTokens),
            ...(reasoningTokens > 0 ? { reasoningTokens } : {}),
            ...(cacheReadTokens > 0 ? { cacheReadTokens } : {}),
            ...(cacheWriteTokens > 0 ? { cacheWriteTokens } : {}),
          };
          v2Usage = mergeStreamUsageSummary(v2Usage, nextUsage);
          v2UsageOccurredAt = Date.now();
        },
      });
      await Effect.runPromise(
        Stream.runForEach(streamProgram, (chunk) =>
          Effect.sync(() => {
            input.eventSequence.value += 1;
            const meta = createRunEventMeta(input.runId, input.eventSequence);
            const chunkWithMeta = {
              ...chunk,
              requestId: input.clientRequestId,
              ...meta,
            } as StreamChunk;

            if (chunkWithMeta.type === 'done') {
              doneEmitted = true;
              stopReason = chunkWithMeta.stopReason;
              if (chunkWithMeta.stopReason !== 'tool_use') {
                input.writeChunk({
                  ...chunkWithMeta,
                  upstreamSummary: toUpstreamStreamSummary(
                    chunkWithMeta.stopReason,
                    streamDiagnostics,
                    input.route,
                  ),
                });
              }
              return;
            }

            if (chunkWithMeta.type === 'error') {
              doneEmitted = true;
              stopReason = 'error';
              streamedContextLimitError = parseContextLimitError({
                message: chunkWithMeta.message,
              });
              streamedUpstreamError = {
                code: `V2_${chunkWithMeta.code}`,
                message: chunkWithMeta.message,
                technicalDetail: chunkWithMeta.message,
              };
              markFailedRequestScopeMessages();
            }

            accumulateChunk(state, chunkWithMeta);
            input.writeChunk(chunkWithMeta);
            ensureStepStarted();
            persistStreamChunkAsSessionEvents({
              sessionId: input.sessionId,
              userId: input.userId,
              clientRequestId: input.clientRequestId,
              chunk: chunkWithMeta,
              state: streamSessionEventState,
            });
          }),
        ).pipe(Effect.provide(nativeLLMLayer)),
      );
    } catch (err) {
      // Re-throw cancellation so the outer try/catch handles it
      // uniformly with the AbortSignal path.
      if (input.signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      // Classify rate-limit / overload / free-usage / 5xx so the
      // recovery layer (`routes/stream.ts`) and the wire-level
      // `upstreamError` surface keep the retry-after hint and a
      // stable category — the native client collapses these into opaque
      // strings otherwise.
      const classification = classifyUpstreamError(err);
      const contextLimitError = parseContextLimitError(err);
      if (stepStream && stepStream.status === 'pending') {
        input.wl.fail(stepStream, message, { round: input.round });
      }
      writeAuditLog({
        sessionId: input.sessionId,
        category: 'stream',
        sourceName: 'V2_UPSTREAM_ERROR',
        requestId: input.clientRequestId,
        input: { model: input.route.model, round: input.round },
        output: {
          message,
          category: classification.category,
          retryable: classification.retryable,
          ...(classification.retryAfterMs !== undefined
            ? { retryAfterMs: classification.retryAfterMs }
            : {}),
        },
        isError: true,
      });
      markFailedRequestScopeMessages();
      const userFacingMessage = buildUserFacingStreamErrorMessage({
        classificationMessage: classification.message,
        fallbackMessage: message,
      });
      appendSessionMessageV2({
        sessionId: input.sessionId,
        userId: input.userId,
        role: 'assistant',
        content: buildErrorContent('V2_UPSTREAM_ERROR', userFacingMessage),
        clientRequestId: input.clientRequestId,
        status: 'error',
        replaceExisting: true,
        modelID: input.route.model,
        ...(routeProviderId ? { providerID: routeProviderId } : {}),
        ...(input.agentId ? { agentId: input.agentId } : {}),
      });
      input.writeChunk(
        createStreamErrorChunk(
          'V2_UPSTREAM_ERROR',
          userFacingMessage,
          input.runId,
          toUpstreamStreamSummary('error', streamDiagnostics, input.route),
          input.clientRequestId,
        ),
      );
      input.wl.flush(input.ctx, 502);
      emitStepEnded('error');
      return {
        overflow: contextLimitError !== null,
        shouldContinue: false,
        shouldStop: true,
        stopReason: 'error',
        statusCode: 502,
        state,
        upstreamError: {
          code: `V2_${classification.category.toUpperCase()}`,
          message: classification.message ?? message,
          technicalDetail: message,
          ...(classification.retryAfterMs !== undefined
            ? { retryAfterMs: classification.retryAfterMs }
            : {}),
        },
        usage: undefined,
        usageOccurredAt: undefined,
      };
    }

    // Synthesise a `done` chunk if the runner finished without
    // emitting one (e.g. AbortSignal triggered before finish-step).
    if (!doneEmitted) {
      stopReason = input.signal.aborted ? 'cancelled' : 'end_turn';
      input.writeChunk({
        type: 'done',
        stopReason,
        requestId: input.clientRequestId,
        upstreamSummary: toUpstreamStreamSummary(stopReason, streamDiagnostics, input.route),
        ...createRunEventMeta(input.runId, input.eventSequence),
      });
    }

    if (stepStream && stepStream.status === 'pending') {
      input.wl.succeed(stepStream, undefined, {
        round: input.round,
        stopReason,
        textDeltaCount: streamDiagnostics.textDeltaCount,
        reasoningDeltaCount: streamDiagnostics.reasoningDeltaCount,
        toolCallDeltaCount: streamDiagnostics.toolCallDeltaCount,
        sawDone: streamDiagnostics.sawDone,
        sawError: streamDiagnostics.sawError,
        stalled: streamDiagnostics.stalled,
      });
    }
    const streamSummaryLog = buildUpstreamStreamSummaryLog({
      model: input.route.model,
      round: input.round,
      upstreamProtocol: input.route.upstreamProtocol,
      stopReason,
      diagnostics: streamDiagnostics,
    });
    writeAuditLog({
      sessionId: input.sessionId,
      category: 'stream',
      sourceName: 'V2_UPSTREAM_STREAM_SUMMARY',
      requestId: input.clientRequestId,
      input: streamSummaryLog.input,
      output: streamSummaryLog.output,
      isError: streamSummaryLog.isError,
    });
    finalizeAssistant(stopReason, v2Usage);
    emitStepEnded(stopReason, {
      input: v2Usage?.inputTokens ?? 0,
      output: v2Usage?.outputTokens ?? 0,
    });

    const shouldContinue = isToolUseStopReason(stopReason) ? state.toolCalls.size > 0 : false;
    const effectiveCtxWindow = resolveEffectiveContextWindow(
      input.userId,
      input.route.model,
      input.route.contextWindow,
      input.route.contextWindowOverride,
    );
    const overflow = resolveModelRoundOverflow({
      usage: v2Usage,
      effectiveContextWindow: effectiveCtxWindow,
      modelMaxOutputTokens: input.route.maxOutputTokens,
      autoCompactPercentOverride: parsePercentageOverride(
        process.env['CLAUDE_AUTOCOMPACT_PCT_OVERRIDE'],
      ),
      autoCompactThresholdRatio: input.route.autoCompactThresholdRatio,
      contextLimitError: streamedContextLimitError,
      compactionReservedTokens: input.compactionReservedTokens,
    });
    return {
      overflow,
      shouldContinue,
      shouldStop: !shouldContinue,
      stopReason,
      statusCode: 200,
      state,
      ...(streamedUpstreamError ? { upstreamError: streamedUpstreamError } : {}),
      ...(v2Usage ? { usage: v2Usage } : {}),
      ...(v2UsageOccurredAt !== undefined ? { usageOccurredAt: v2UsageOccurredAt } : {}),
    };
  } catch (err) {
    if (input.signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
      finalizeAssistant('cancelled');
      input.writeChunk({
        type: 'done',
        stopReason: 'cancelled',
        requestId: input.clientRequestId,
        upstreamSummary: toUpstreamStreamSummary('cancelled', streamDiagnostics, input.route),
        ...createRunEventMeta(input.runId, input.eventSequence),
      });
      const streamSummaryLog = buildUpstreamStreamSummaryLog({
        model: input.route.model,
        round: input.round,
        upstreamProtocol: input.route.upstreamProtocol,
        stopReason: 'cancelled',
        diagnostics: streamDiagnostics,
      });
      writeAuditLog({
        sessionId: input.sessionId,
        category: 'stream',
        sourceName: 'V2_UPSTREAM_STREAM_SUMMARY',
        requestId: input.clientRequestId,
        input: streamSummaryLog.input,
        output: streamSummaryLog.output,
        isError: streamSummaryLog.isError,
      });
      emitStepEnded('cancelled');
      return {
        overflow: false,
        shouldContinue: false,
        shouldStop: true,
        stopReason: 'cancelled',
        statusCode: 200,
        state,
        usage: undefined,
        usageOccurredAt: undefined,
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    const classification = classifyUpstreamError(err);
    const contextLimitError = parseContextLimitError(err);
    if (stepStream && stepStream.status === 'pending') {
      input.wl.fail(stepStream, message, { round: input.round });
    }
    if (stepUpstream.status === 'pending') {
      input.wl.fail(stepUpstream, message);
    }
    writeAuditLog({
      sessionId: input.sessionId,
      category: 'stream',
      sourceName: 'STREAM_ERROR',
      requestId: input.clientRequestId,
      input: { model: input.route.model, round: input.round },
      output: { message, code: 'STREAM_ERROR' },
    });
    markFailedRequestScopeMessages();
    const userFacingMessage = buildUserFacingStreamErrorMessage({
      classificationMessage: classification.message,
      fallbackMessage: message,
    });
    const streamSummaryLog = buildUpstreamStreamSummaryLog({
      model: input.route.model,
      round: input.round,
      upstreamProtocol: input.route.upstreamProtocol,
      stopReason: 'error',
      diagnostics: streamDiagnostics,
    });
    writeAuditLog({
      sessionId: input.sessionId,
      category: 'stream',
      sourceName: 'V2_UPSTREAM_STREAM_SUMMARY',
      requestId: input.clientRequestId,
      input: streamSummaryLog.input,
      output: streamSummaryLog.output,
      isError: streamSummaryLog.isError,
    });
    appendSessionMessageV2({
      sessionId: input.sessionId,
      userId: input.userId,
      role: 'assistant',
      content: buildErrorContent('STREAM_ERROR', userFacingMessage),
      clientRequestId: input.clientRequestId,
      status: 'error',
      replaceExisting: true,
      modelID: input.route.model,
      ...(routeProviderId ? { providerID: routeProviderId } : {}),
      ...(input.agentId ? { agentId: input.agentId } : {}),
    });
    input.writeChunk(
      createStreamErrorChunk(
        'STREAM_ERROR',
        userFacingMessage,
        input.runId,
        toUpstreamStreamSummary('error', streamDiagnostics, input.route),
        input.clientRequestId,
      ),
    );
    input.wl.flush(input.ctx, 500);
    emitStepEnded('error');
    return {
      overflow: contextLimitError !== null,
      shouldContinue: false,
      shouldStop: true,
      stopReason: 'error',
      statusCode: 500,
      state,
      upstreamError: {
        code: `STREAM_${classification.category.toUpperCase()}`,
        message: classification.message ?? message,
        technicalDetail: message,
        ...(classification.retryAfterMs !== undefined
          ? { retryAfterMs: classification.retryAfterMs }
          : {}),
      },
      usage: undefined,
      usageOccurredAt: undefined,
    };
  }
}
