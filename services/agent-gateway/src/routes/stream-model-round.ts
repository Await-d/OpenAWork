import type { FileDiffContent, MessageContent, RunEvent, StreamChunk } from '@openAwork/shared';
import type { WorkflowLogger, createRequestContext } from '@openAwork/logger';
import { validateThinkingBlocks } from '../session/thinking-block-validator.js';
import { isContextOverflow } from '../session/session-message-store.js';
import { resolveEffectiveContextWindow } from '../compaction/context-window-resolver.js';
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
import type { MessageID } from '../message/message-v2-schema.js';
import { upsertArtifactsFromAssistantMessage } from '../session/assistant-content-artifacts.js';
import { touchSessionHeartbeat } from '../handoff/bus/heartbeat.js';
import { parseSessionMetadataJson } from '../session/session-workspace-metadata.js';
import { validateWorkspacePath } from '../workspace/workspace-paths.js';
import { getSnapshotEngine } from '../snapshot/snapshot-engine.js';
import {
  getLatestSnapshotTreeForSession,
  persistSnapshotTree,
} from '../snapshot/snapshot-tree-store.js';
import type { StreamUsageSummary } from './stream-usage.js';
import type { StreamStopReason } from './stream-types.js';
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
  buildAISdkProvider,
  runUpstreamStream,
  unifiedConversationToModelMessages,
  wrapGatewayToolsForAiSdkDeclarationsOnly,
  type GatewayToolFunctionShape,
} from '../v2-runtime/upstream/index.js';

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
   * (without it, AI SDK rebuilds `function_call.id` from the call_id
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
 * Why "earlier-wins": the OpenAI Responses adapter in @ai-sdk/openai
 * 3.x emits `openai.itemId` on the first `tool-call` event for a
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

  // Store reasoning as a separate part so it can be reconstructed
  // as a reasoning item for the Responses API in multi-turn conversations.
  const reasoningEntries = extractReasoningEntries(state.assistantThinkingBlocks);
  if (
    reasoningEntries.length > 0 ||
    Boolean(state.reasoningEncryptedContent) ||
    Boolean(state.reasoningSummary) ||
    Boolean(state.responseId)
  ) {
    if (reasoningEntries.length === 0) {
      content.push({
        type: 'reasoning',
        text: '',
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
    Boolean(state.reasoningEncryptedContent) ||
    Boolean(state.reasoningSummary) ||
    Boolean(state.responseId);
  const hasReasoningSegment = state.contentSegments.some((segment) => segment.kind === 'reasoning');
  if (hasResponsesMeta && !hasReasoningSegment) {
    content.push({
      type: 'reasoning',
      text: '',
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
    const metadata = parseSessionMetadataJson(input.sessionContext.metadataJson);
    const rawWorkspace =
      typeof metadata['workingDirectory'] === 'string' ? metadata['workingDirectory'] : null;
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
  syntheticContinuationPrompt?: string;
  memoryBlock?: string | null;
  /** Agent ID for the current stream round (for per-agent color rendering). */
  agentId?: string;
  writeChunk: (chunk: RunEvent) => void;
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
  const shouldApplyThinkingConfig =
    input.requestData.thinkingEnabled !== undefined ||
    input.requestData.reasoningEffort !== undefined;
  const thinkingLanguagePrompt =
    shouldApplyThinkingConfig && input.requestData.thinkingEnabled
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
    streamMessagesWithParts({ sessionId: input.sessionId, userId: input.userId }),
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
  const unifiedMessagesRaw = toModelMessages(messagesV2, {
    currentModel: {
      providerID: input.route.providerType ?? 'unknown',
      modelID: input.route.model,
    },
  });

  // ── Layer 0.5: Microcompact (Claude Code pattern) ──
  // Clear stale tool_result outputs before sending to upstream.
  // Zero LLM cost, delays full compaction trigger, keeps context lean.
  // Operates on the rendered UnifiedMessage[] so DB data stays intact.
  const microcompactResult = microcompactMessages(unifiedMessagesRaw);
  const unifiedMessages = microcompactResult.messages;

  // Apply thinking language hint to conversation
  const thinkingUserHint =
    shouldApplyThinkingConfig && input.requestData.thinkingEnabled
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
    thinkingLanguagePrompt,
    dynamicAgentPrompt: input.dynamicAgentPrompt,
    startWorkContext: input.startWorkContext,
    commandContext: input.commandContext,
    pinnedSkillsPrompt: input.pinnedSkillsPrompt,
    teamInstructionStack: input.teamInstructionStack,
  });

  const memoryContent = input.memoryBlock ?? '<user-memory />\n当前会话无持久化记忆。';
  const dynamicSystemTail = [dynamicSystemContent, memoryContent]
    .filter((s) => s.length > 0)
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
  // serialised a fully-rendered upstream body here; with v2 the AI SDK
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
            providerID: input.route.providerType ?? 'unknown',
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
      void captureSnapshotTreeBestEffort({
        clientRequestId: input.clientRequestId,
        round: input.round,
        reason,
        sessionContext: input.sessionContext,
        sessionId: input.sessionId,
        userId: input.userId,
        diffFiles,
      });
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
  // cutover. Every round now goes through the AI SDK provider factory
  // (`runUpstreamStream`) which handles cache breakpoints, message
  // normalisation, provider-specific thinking options, and protocol
  // decoding uniformly across `chat_completions`, `anthropic_messages`,
  // and Responses (`@ai-sdk/openai`) once the user opts in via
  // `upstreamProtocol: 'responses'` in provider settings.
  void compactionAutoEnabled;

  try {
    const provider = buildAISdkProvider({
      providerType: input.route.providerType ?? 'custom',
      upstreamProtocol: input.route.upstreamProtocol,
      ...(input.route.apiKey ? { apiKey: input.route.apiKey } : {}),
      ...(input.route.apiBaseUrl ? { baseURL: input.route.apiBaseUrl } : {}),
      ...(input.route.requestOverrides.headers &&
      Object.keys(input.route.requestOverrides.headers).length > 0
        ? { headers: input.route.requestOverrides.headers }
        : {}),
      model: input.route.model,
      supportsThinking: input.route.supportsThinking,
    });
    const modelHandle = provider.languageModel(input.route.model);
    const modelMessages = unifiedConversationToModelMessages(allUnifiedMessages);

    // Declarations-only ToolSet — the gateway's `enabledTools` are
    // already JSON-schema'd, so we wrap them without an `execute` and
    // let the existing OpenAWork agent loop in `routes/stream.ts`
    // pick up `tool_call_delta` chunks and drive sandboxed execution
    // out-of-band.
    const v2Tools =
      input.enabledTools.length > 0
        ? wrapGatewayToolsForAiSdkDeclarationsOnly(
            input.enabledTools as unknown as GatewayToolFunctionShape[],
          )
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

    try {
      if (isTeamSession(input.sessionContext)) {
        touchSessionHeartbeat(input.sessionId);
      }

      for await (const chunk of runUpstreamStream({
        model: modelHandle,
        modelId: input.route.model,
        messages: modelMessages,
        signal: input.signal,
        runId: input.runId,
        ...(input.agentId ? { agentId: input.agentId } : {}),
        sessionId: input.sessionId,
        providerType: input.route.providerType,
        temperature: input.route.temperature,
        maxOutputTokens: input.route.maxTokens,
        requestOverrides: input.route.requestOverrides,
        ...(v2Tools ? { tools: v2Tools } : {}),
        ...(typeof input.requestData.upstreamRetryMaxRetries === 'number'
          ? { maxRetries: input.requestData.upstreamRetryMaxRetries }
          : {}),
        ...(shouldApplyThinkingConfig && input.route.providerType
          ? {
              thinking: {
                enabled: input.requestData.thinkingEnabled === true,
                effort: input.requestData.reasoningEffort ?? 'medium',
                providerType: input.route.providerType,
                supportsThinking: input.route.supportsThinking,
              },
            }
          : {}),
        onFinish: ({ usage }) => {
          const reasoningTokens =
            usage.outputTokenDetails?.reasoningTokens ?? usage.reasoningTokens ?? 0;
          const cacheReadTokens =
            usage.inputTokenDetails?.cacheReadTokens ?? usage.cachedInputTokens ?? 0;
          const cacheWriteTokens = usage.inputTokenDetails?.cacheWriteTokens ?? 0;
          const rawInputTokens = usage.inputTokens ?? 0;
          const rawOutputTokens = usage.outputTokens ?? 0;
          const nextUsage: StreamUsageSummary = {
            inputTokens: Math.max(0, rawInputTokens - cacheReadTokens - cacheWriteTokens),
            outputTokens: Math.max(0, rawOutputTokens - reasoningTokens),
            totalTokens: usage.totalTokens ?? rawInputTokens + rawOutputTokens,
            ...(reasoningTokens > 0 ? { reasoningTokens } : {}),
            ...(cacheReadTokens > 0 ? { cacheReadTokens } : {}),
            ...(cacheWriteTokens > 0 ? { cacheWriteTokens } : {}),
          };
          v2Usage = mergeStreamUsageSummary(v2Usage, nextUsage);
          v2UsageOccurredAt = Date.now();
        },
      })) {
        input.eventSequence.value += 1;
        const meta = createRunEventMeta(input.runId, input.eventSequence);
        const chunkWithMeta = { ...chunk, ...meta } as StreamChunk;

        if (chunkWithMeta.type === 'done') {
          doneEmitted = true;
          stopReason = chunkWithMeta.stopReason;
          // Suppress intermediate `done(tool_use)` chunks: the agent
          // loop in `routes/stream.ts` continues into another round to
          // dispatch the tool calls, and SSE consumers expect exactly
          // one terminal `done` per stream. Only the final round —
          // which ends with `end_turn` / `error` / `cancelled` etc. —
          // surfaces a `done` event downstream.
          if (chunkWithMeta.stopReason !== 'tool_use') {
            input.writeChunk(chunkWithMeta as RunEvent);
          }
          break;
        }

        // An error chunk from the upstream runner is terminal for this
        // round: suppress the synthetic fallback `done` emission below
        // so SSE consumers see only the error, matching the legacy
        // custom-parser contract the verifier asserts. Also mark any
        // pending assistant/tool messages from this round as `error`
        // so the next turn's history-building (message-to-model-messages)
        // prunes stale tool_use/tool_result pairs instead of replaying
        // them into the recovery request.
        if (chunkWithMeta.type === 'error') {
          doneEmitted = true;
          stopReason = 'error';
          markFailedRequestScopeMessages();
        }

        accumulateChunk(state, chunkWithMeta);
        input.writeChunk(chunkWithMeta as RunEvent);
        ensureStepStarted();
        persistStreamChunkAsSessionEvents({
          sessionId: input.sessionId,
          userId: input.userId,
          clientRequestId: input.clientRequestId,
          chunk: chunkWithMeta,
          state: streamSessionEventState,
        });
      }
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
      // stable category — the AI SDK collapses these into opaque
      // strings otherwise.
      const classification = classifyUpstreamError(err);
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
      appendSessionMessageV2({
        sessionId: input.sessionId,
        userId: input.userId,
        role: 'assistant',
        content: buildErrorContent('V2_UPSTREAM_ERROR', classification.message ?? message),
        clientRequestId: input.clientRequestId,
        status: 'error',
        replaceExisting: true,
      });
      input.writeChunk(
        createStreamErrorChunk('V2_UPSTREAM_ERROR', classification.message ?? message, input.runId),
      );
      input.wl.flush(input.ctx, 502);
      emitStepEnded('error');
      return {
        overflow: false,
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
        ...createRunEventMeta(input.runId, input.eventSequence),
      } as RunEvent);
    }

    if (stepStream && stepStream.status === 'pending') {
      input.wl.succeed(stepStream, undefined, {
        round: input.round,
        stopReason,
      });
    }
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
    );
    const overflow =
      !!v2Usage &&
      typeof effectiveCtxWindow === 'number' &&
      isContextOverflow(
        v2Usage,
        effectiveCtxWindow,
        input.compactionReservedTokens,
        input.route.maxOutputTokens,
      );
    return {
      overflow,
      shouldContinue,
      shouldStop: !shouldContinue,
      stopReason,
      statusCode: 200,
      state,
      ...(v2Usage ? { usage: v2Usage } : {}),
      ...(v2UsageOccurredAt !== undefined ? { usageOccurredAt: v2UsageOccurredAt } : {}),
    };
  } catch (err) {
    if (input.signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
      finalizeAssistant('cancelled');
      input.writeChunk({
        type: 'done',
        stopReason: 'cancelled',
        ...createRunEventMeta(input.runId, input.eventSequence),
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
    appendSessionMessageV2({
      sessionId: input.sessionId,
      userId: input.userId,
      role: 'assistant',
      content: buildErrorContent('STREAM_ERROR', message),
      clientRequestId: input.clientRequestId,
      status: 'error',
      replaceExisting: true,
    });
    input.writeChunk(createStreamErrorChunk('STREAM_ERROR', message, input.runId));
    input.wl.flush(input.ctx, 500);
    emitStepEnded('error');
    return {
      overflow: false,
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
