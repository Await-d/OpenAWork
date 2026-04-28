import type { FileDiffContent, MessageContent, RunEvent, StreamChunk } from '@openAwork/shared';
import type { WorkflowLogger, createRequestContext } from '@openAwork/logger';
import { validateThinkingBlocks } from '../thinking-block-validator.js';
import { isContextOverflow, type PreparedUpstreamConversationReport } from '../session-message-store.js';
import { toModelMessages, filterCompacted, type UnifiedMessage } from '../message-to-model-messages.js';
import { ProviderAdapter, type FunctionToolDefinition, type PromptCacheConfig } from '../provider-adapter.js';
import { buildAnthropicBetas, formatAnthropicBetaHeader } from '../anthropic-betas.js';
import {
  appendSessionMessageV2,
  updateSessionMessagesStatusByRequestScope,
} from '../message-v2-adapter.js';
import { streamMessagesWithParts } from '../message-store-v2.js';
import { buildModifiedFilesSummaryContent } from '../modified-files-summary.js';
import { persistSessionSnapshot, createRequestSnapshotRef } from '../session-snapshot-store.js';
import { appendSnapshotPart, appendPatchPart } from '../message-v2-adapter.js';
import type { MessageID } from '../message-v2-schema.js';
import { upsertArtifactsFromAssistantMessage } from '../assistant-content-artifacts.js';
import { resolveEofRoundDecision } from './stream-completion.js';
import {
  isUpstreamContextOverflowError,
  readUpstreamError,
  type UpstreamErrorDescriptor,
} from './upstream-error.js';
import {
  createStreamParseState,
  parseUpstreamFrame,
  ResponsesUpstreamEventError,
  type StreamUsageSummary,
} from './stream-protocol.js';
import {
  buildSystemPromptChain,
  type SyntheticRequestContext,
} from './stream-system-prompts.js';
import type { resolveModelRoute } from '../model-router.js';
import type { SessionStreamContext } from './stream.js';
import { createRunEventMeta, createStreamErrorChunk } from './stream.js';
import type { getEnabledTools } from './stream.js';
import { fetchUpstreamStreamWithRetry } from './upstream-stream-retry.js';
import { writeAuditLog } from '../audit-log.js';
import {
  appendReasoningChunk,
  buildReasoningBlockKey,
  closeAllOpenReasoningBlocks,
  extractReasoningEntries,
  extractReasoningTexts,
  markReasoningBlockEnded,
  type ReasoningBlock,
} from '../reasoning-blocks.js';
import {
  appendSessionEvent,
  createStreamSessionEventState,
  persistStreamChunkAsSessionEvents,
} from '../session-entry-store.js';
import { makeSessionEventId } from '../session-event.js';
import { isV2UpstreamForProviderType, isV2UpstreamShadow } from '../v2-runtime/index.js';
import {
  buildAISdkProvider,
  compareV1V2BridgeStructural,
  runUpstreamStream,
  unifiedConversationToModelMessages,
  wrapGatewayToolsForAiSdkDeclarationsOnly,
  type GatewayToolFunctionShape,
} from '../v2-runtime/upstream/index.js';

type WorkflowStepHandle = ReturnType<WorkflowLogger['start']>;
type StreamStopReason =
  | 'end_turn'
  | 'tool_use'
  | 'max_tokens'
  | 'error'
  | 'cancelled'
  | 'tool_permission';

interface StreamAccumulationState {
  assistantThinkingBlocks: ReasoningBlock[];
  assistantText: string;
  toolCalls: Map<string, { toolName: string; inputText: string }>;
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
 * Appends the thinking language hint to the last user message.
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
      msg.content = `${msg.content}\n\n[${hint}]`;
      break;
    }
  }
  return result;
}

/**
 * UnifiedMessage version of injectSyntheticRequestContext.
 * Injects per-request dynamic context into the last user message.
 */
function injectSyntheticRequestContextUnified(
  messages: UnifiedMessage[],
  context: SyntheticRequestContext,
): UnifiedMessage[] {
  const block = buildSyntheticRequestContextBlock(context);
  if (!block) return messages;

  const result: UnifiedMessage[] = messages.map((msg) => ({ ...msg }));
  for (let i = result.length - 1; i >= 0; i--) {
    const msg = result[i]!;
    if (msg.role === 'user') {
      msg.content = `<system-reminder>\n${block}\n</system-reminder>\n\n${msg.content}`;
      break;
    }
  }
  return result;
}

function buildSyntheticRequestContextBlock(input: SyntheticRequestContext): string | null {
  const parts: string[] = [];
  if (input.injectedPrompt && input.injectedPrompt.trim().length > 0) {
    parts.push(input.injectedPrompt);
  }
  if (input.capabilityContext && input.capabilityContext.trim().length > 0) {
    parts.push(input.capabilityContext);
  }
  if (input.companionPrompt && input.companionPrompt.trim().length > 0) {
    parts.push(input.companionPrompt);
  }
  return parts.length > 0 ? parts.join('\n\n---\n\n') : null;
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

function buildUpstreamTransformationReport(input: {
  compactionSummary?: string | null;
  memoryBlock?: string | null;
  outboundBody: Record<string, unknown>;
  outboundMessageCount: number;
  preparedReport?: PreparedUpstreamConversationReport;
  injectedPrompt?: string | null;
  capabilityContext?: string | null;
  lspGuidance?: string | null;
  dialogueModePrompt?: string | null;
  yoloModePrompt?: string | null;
  companionPrompt?: string | null;
  requestOverrides: { body?: Record<string, unknown>; omitBodyKeys?: string[] };
  routeSystemPrompt?: string;
  syntheticContinuationPrompt?: string;
  thinkingApplied: boolean;
  toolOutputReadbackGuidanceInjected: boolean;
  upstreamProtocol: string;
  workspaceCtx: string | null;
}): Record<string, unknown> {
  return {
    prepared: input.preparedReport ?? null,
    protocol: input.upstreamProtocol,
    workspaceContextInjected: true,
    routeSystemPromptInjected: true,
    injectedPromptActive: !!input.injectedPrompt,
    capabilityContextActive: !!input.capabilityContext,
    lspGuidanceActive: !!input.lspGuidance,
    dialogueModeActive: !!input.dialogueModePrompt,
    yoloModeActive: !!input.yoloModePrompt,
    companionPromptActive: !!input.companionPrompt,
    memoryBlockInjected: true,
    compactionSummaryInjected: !!input.compactionSummary,
    toolOutputReadbackGuidanceInjected: true,
    syntheticContinuationInjected: !!input.syntheticContinuationPrompt,
    outboundMessageCount: input.outboundMessageCount,
    requestOverrideBodyKeys: Object.keys(input.requestOverrides.body ?? {}),
    omittedBodyKeys: input.requestOverrides.omitBodyKeys ?? [],
    thinkingConfigApplied: input.thinkingApplied,
    requestBodyKeys: Object.keys(input.outboundBody),
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
  state.toolCalls.set(chunk.toolCallId, {
    toolName: chunk.toolName,
    inputText: `${existing?.inputText ?? ''}${chunk.inputDelta}`,
  });
  // Order-preserving mirror: ensure exactly one tool_call segment per
  // toolCallId, positioned where it first appeared in the wire stream.
  // Subsequent argument deltas update toolCalls map only — segment carries
  // just the identity reference and buildAssistantContent reads the latest
  // input from the map at finalize time.
  if (!state.contentSegments.some(
    (segment) => segment.kind === 'tool_call' && segment.toolCallId === chunk.toolCallId,
  )) {
    state.contentSegments.push({
      kind: 'tool_call',
      toolCallId: chunk.toolCallId,
      toolName: chunk.toolName,
    });
  }
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
  const hasReasoningSegment = state.contentSegments.some(
    (segment) => segment.kind === 'reasoning',
  );
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
      const block = state.assistantThinkingBlocks.find(
        (entry) => entry.key === segment.blockKey,
      );
      const text = segment.text;
      const startedAt = segment.startedAt ?? block?.startedAt;
      const endedAt = segment.endedAt ?? block?.endedAt;
      const shouldAttachMeta = !reasoningMetadataAttached && hasResponsesMeta;
      content.push({
        type: 'reasoning',
        text,
        ...(typeof startedAt === 'number' ? { startedAt } : {}),
        ...(typeof endedAt === 'number' ? { endedAt } : {}),
        ...(shouldAttachMeta && state.reasoningEncryptedContent
          ? { encryptedContent: state.reasoningEncryptedContent }
          : {}),
        ...(shouldAttachMeta && state.reasoningSummary
          ? { summary: state.reasoningSummary }
          : {}),
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

import type { StreamRequest } from './stream.js';

function createIntermediateAssistantRequestId(clientRequestId: string, round: number): string {
  return `${clientRequestId}:assistant:${round}`;
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
  // Layer 1: MessageWithParts[] → UnifiedMessage[] (single conversion entry point)
  const unifiedMessages = toModelMessages(messagesV2, {
    stripOldToolResults: true,
  });

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

  // Layer 2: Declarative system prompt chain + UnifiedMessage[] → ProviderAdapter.render
  const systemChain = buildSystemPromptChain({
    workspaceCtx: input.workspaceCtx,
    routeSystemPrompt: input.route.systemPrompt,
    lspGuidance: input.lspGuidance,
    dialogueModePrompt: input.dialogueModePrompt,
    yoloModePrompt: input.yoloModePrompt,
    thinkingLanguagePrompt,
    dynamicAgentPrompt: input.dynamicAgentPrompt,
    startWorkContext: input.startWorkContext,
    commandContext: input.commandContext,
  });

  // Compose final message list: system prompts + conversation + optional continuation
  const allUnifiedMessages: UnifiedMessage[] = [
    ...systemChain.map((text): UnifiedMessage => ({ role: 'system', content: text })),
    // Memory block as separate system message (for prompt cache optimization)
    { role: 'system', content: input.memoryBlock ?? '<user-memory />\n当前会话无持久化记忆。' },
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

  // Render to upstream request body via ProviderAdapter
  const upstreamPath =
    input.route.upstreamProtocol === 'responses'
      ? '/responses'
      : input.route.upstreamProtocol === 'anthropic_messages'
        ? '/messages'
        : '/chat/completions';
  const promptCache: PromptCacheConfig = {
    providerType: input.route.providerType,
    sessionId: input.sessionId,
  };
  const upstreamBody = ProviderAdapter.render(allUnifiedMessages, {
    protocol: input.route.upstreamProtocol,
    model: input.route.model,
    variant: input.route.variant,
    maxTokens: input.route.maxTokens,
    temperature: input.route.temperature,
    tools: input.enabledTools as FunctionToolDefinition[],
    requestOverrides: input.route.requestOverrides,
    thinking: shouldApplyThinkingConfig
      ? {
          enabled: input.requestData.thinkingEnabled === true,
          effort: input.requestData.reasoningEffort ?? 'medium',
          providerType: input.route.providerType,
          supportsThinking: input.route.supportsThinking,
        }
      : undefined,
    cache: promptCache,
  });
  const transformationReport = buildUpstreamTransformationReport({
    compactionSummary: null,
    memoryBlock: input.memoryBlock,
    outboundBody: upstreamBody,
    outboundMessageCount: allUnifiedMessages.length,
    preparedReport: undefined,
    injectedPrompt: input.injectedPrompt,
    capabilityContext: input.capabilityContext,
    lspGuidance: input.lspGuidance,
    dialogueModePrompt: input.dialogueModePrompt,
    yoloModePrompt: input.yoloModePrompt,
    companionPrompt: input.companionPrompt,
    requestOverrides: input.route.requestOverrides,
    routeSystemPrompt: input.route.systemPrompt,
    syntheticContinuationPrompt: input.syntheticContinuationPrompt,
    thinkingApplied: shouldApplyThinkingConfig,
    toolOutputReadbackGuidanceInjected: true,
    upstreamProtocol: input.route.upstreamProtocol,
    workspaceCtx: input.workspaceCtx,
  });
  writeAuditLog({
    sessionId: input.sessionId,
    category: 'llm',
    sourceName: 'UPSTREAM_TRANSFORM',
    requestId: input.clientRequestId,
    input: {
      model: input.route.model,
      round: input.round,
      transformationReport,
    },
    output: {
      message: 'upstream transformation report',
      protocol: input.route.upstreamProtocol,
      requestBodyKeys: Object.keys(upstreamBody),
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
    usageSummary?: { input?: number; output?: number; reasoning?: number; cache?: { read?: number; write?: number } } | undefined,
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
  const finalizeAssistant = (reason: StreamStopReason) => {
    if (
      reason === 'cancelled' &&
      extractReasoningTexts(state.assistantThinkingBlocks).length === 0 &&
      state.assistantText.trim().length === 0 &&
      state.toolCalls.size === 0 &&
      !state.reasoningEncryptedContent &&
      !state.reasoningSummary
    ) {
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

  // ── Phase B.1 — v2 upstream early return ───────────────────────────
  // When `OPENAWORK_RUNTIME_UPSTREAM=v2` and the route uses a protocol
  // covered by the AI SDK provider factory, drive the round through
  // `runUpstreamStream` instead of the legacy fetch+SSE-parser pipeline.
  //
  // What is wired today:
  //   - Provider construction + ModelMessage bridging from
  //     UnifiedMessage[].
  //   - Per-chunk dispatch reuses the same closures the v1 path uses
  //     (`accumulateChunk`, `writeChunk`, `persistStreamChunkAsSessionEvents`,
  //     `ensureStepStarted`, `finalizeAssistant`, `emitStepEnded`).
  //   - Provider middleware (cache_control breakpoints, anthropic-beta
  //     headers, providerOptions/thinking) runs through the v2 stack.
  //
  // What is intentionally deferred to later phases:
  //   - Responses-API protocol (needs `@ai-sdk/openai`, see PROGRESS.md):
  //     routes whose `upstreamProtocol === 'responses'` always run v1.
  //   - Tool schema deferLoading parity — we *fall back* to v1 when
  //     any enabled tool carries `deferLoading: true` (see the gate
  //     below). Future work could implement schema-stripping on the
  //     v2 side too.
  //
  // Production rollout uses `OPENAWORK_RUNTIME_UPSTREAM_PROVIDERS`
  // (see `v2-runtime/runtime-flag.ts`) to canary by `providerType`,
  // so even with the global flag flipped only the allowlisted
  // providers actually take this branch.
  //
  // On any v2-side construction error we fall through to the legacy
  // v1 path so the user-facing request still succeeds.
  //
  // `deferLoading` opts the entire round into a v1-specific
  // parameter-stripping behaviour (the upstream renderer minimises
  // tool schemas to placeholders). The v2 path hands AI SDK the full
  // JSON Schema, which would diverge from v1 on the wire, so we
  // refuse to take v2 when any tool carries the flag — the round
  // continues on v1 unchanged.
  const v2RouteSupported =
    input.route.upstreamProtocol === 'chat_completions' ||
    input.route.upstreamProtocol === 'anthropic_messages';
  const anyToolDeferred = input.enabledTools.some((tool) => tool.function.deferLoading === true);
  if (
    v2RouteSupported &&
    !anyToolDeferred &&
    isV2UpstreamForProviderType(input.route.providerType)
  ) {
    try {
      const provider = buildAISdkProvider({
        providerType: input.route.providerType ?? 'custom',
        ...(input.route.apiKey ? { apiKey: input.route.apiKey } : {}),
        ...(input.route.apiBaseUrl ? { baseURL: input.route.apiBaseUrl } : {}),
        model: input.route.model,
        supportsThinking: input.route.supportsThinking,
      });
      const modelHandle = provider.languageModel(input.route.model);
      const modelMessages = unifiedConversationToModelMessages(allUnifiedMessages);

      // Phase B.2.b — declarations-only ToolSet for the v2 path. The
      // gateway's `enabledTools` are already JSON-schema'd (the same
      // shape it sends to the upstream wire), so we wrap them without
      // an `execute` and rely on the existing OpenAWork agent loop in
      // `routes/stream.ts` to pick up `tool_call_delta` chunks and
      // drive sandboxed execution out-of-band.
      const v2Tools =
        input.enabledTools.length > 0
          ? wrapGatewayToolsForAiSdkDeclarationsOnly(
              input.enabledTools as unknown as GatewayToolFunctionShape[],
            )
          : undefined;

      input.wl.succeed(stepUpstream, undefined, {
        mode: 'v2',
        toolCount: input.enabledTools.length,
      });
      stepStream = input.wl.start('upstream.stream', undefined, {
        protocol: input.transport,
        upstreamProtocol: input.route.upstreamProtocol,
        round: input.round,
        mode: 'v2',
      });

      let stopReason: StreamStopReason = 'end_turn';
      let doneEmitted = false;
      let v2Usage: StreamUsageSummary | undefined;
      let v2UsageOccurredAt: number | undefined;

      try {
        for await (const chunk of runUpstreamStream({
          model: modelHandle,
          messages: modelMessages,
          signal: input.signal,
          runId: input.runId,
          ...(input.agentId ? { agentId: input.agentId } : {}),
          providerType: input.route.providerType,
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
            // The AI SDK reports tokens as `number | undefined`; fall
            // back to 0 so RunResult.usage stays a stable shape for
            // downstream cost / context-overflow code that already
            // assumes the legacy v1 path's number-typed summary.
            v2Usage = {
              inputTokens: usage.inputTokens ?? 0,
              outputTokens: usage.outputTokens ?? 0,
              totalTokens:
                usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
            };
            v2UsageOccurredAt = Date.now();
          },
        })) {
          input.eventSequence.value += 1;
          const meta = createRunEventMeta(input.runId, input.eventSequence);
          const chunkWithMeta = { ...chunk, ...meta } as StreamChunk;

          if (chunkWithMeta.type === 'done') {
            doneEmitted = true;
            stopReason = chunkWithMeta.stopReason;
            input.writeChunk(chunkWithMeta as RunEvent);
            break;
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
        const message = err instanceof Error ? err.message : String(err);
        if (stepStream && stepStream.status === 'pending') {
          input.wl.fail(stepStream, message, { round: input.round });
        }
        writeAuditLog({
          sessionId: input.sessionId,
          category: 'stream',
          sourceName: 'V2_UPSTREAM_ERROR',
          requestId: input.clientRequestId,
          input: { model: input.route.model, round: input.round },
          output: { message },
          isError: true,
        });
        markFailedRequestScopeMessages();
        appendSessionMessageV2({
          sessionId: input.sessionId,
          userId: input.userId,
          role: 'assistant',
          content: buildErrorContent('V2_UPSTREAM_ERROR', message),
          clientRequestId: input.clientRequestId,
          status: 'error',
        });
        input.writeChunk(createStreamErrorChunk('V2_UPSTREAM_ERROR', message, input.runId));
        input.wl.flush(input.ctx, 502);
        emitStepEnded('error');
        return {
          overflow: false,
          shouldContinue: false,
          shouldStop: true,
          stopReason: 'error',
          statusCode: 502,
          state,
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
          mode: 'v2',
        });
      }
      finalizeAssistant(stopReason);
      emitStepEnded(stopReason);

      const shouldContinue = isToolUseStopReason(stopReason)
        ? state.toolCalls.size > 0
        : false;
      return {
        overflow: false,
        shouldContinue,
        shouldStop: !shouldContinue,
        stopReason,
        statusCode: 200,
        state,
        ...(v2Usage ? { usage: v2Usage } : {}),
        ...(v2UsageOccurredAt !== undefined ? { usageOccurredAt: v2UsageOccurredAt } : {}),
      };
    } catch (err) {
      // Provider construction / bridge failure — log and fall through
      // to the v1 path so the user-facing request still completes.
      writeAuditLog({
        sessionId: input.sessionId,
        category: 'llm',
        sourceName: 'V2_UPSTREAM_FALLBACK',
        requestId: input.clientRequestId,
        input: { providerType: input.route.providerType, model: input.route.model },
        output: { message: err instanceof Error ? err.message : String(err) },
        isError: true,
      });
    }
  }

  // ── Phase B.3.b — bridge-only shadow diff ─────────────────────────
  // When `OPENAWORK_RUNTIME_UPSTREAM_SHADOW=1` is set we audit-log a
  // structural comparison between the legacy `upstreamBody.messages`
  // and the AI SDK `ModelMessage[]` the v2 bridge would have built
  // for this exact request. No second LLM call is fired — the goal
  // is to validate the bridge in production traffic ahead of the
  // real cutover.
  if (isV2UpstreamShadow()) {
    try {
      const v2Messages = unifiedConversationToModelMessages(allUnifiedMessages);
      const v1Messages = (upstreamBody as Record<string, unknown>)['messages'];
      const summary = compareV1V2BridgeStructural(
        Array.isArray(v1Messages) ? (v1Messages as Array<Record<string, unknown>>) : [],
        v2Messages,
      );
      writeAuditLog({
        sessionId: input.sessionId,
        category: 'llm',
        sourceName: 'V2_BRIDGE_DIFF',
        requestId: input.clientRequestId,
        input: {
          providerType: input.route.providerType,
          model: input.route.model,
          protocol: input.route.upstreamProtocol,
        },
        output: {
          matched: summary.matched,
          v1Count: summary.v1Count,
          v2Count: summary.v2Count,
          // Cap diff list to keep audit rows compact; first 8 entries
          // are usually enough to spot the pattern.
          diffs: summary.diffs.slice(0, 8),
          diffsTruncated: summary.diffs.length > 8,
        },
        isError: !summary.matched,
      });
    } catch {
      // Shadow telemetry must never break the v1 path.
    }
  }

  try {
    const anthropicBetas =
      input.route.providerType === 'anthropic'
        ? buildAnthropicBetas({
            model: input.route.model,
            supportsThinking: input.route.supportsThinking,
          })
        : [];
    const isAnthropicNative = input.route.providerType === 'anthropic';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(input.route.apiKey
        ? isAnthropicNative
          ? { 'x-api-key': input.route.apiKey, 'anthropic-version': '2023-06-01' }
          : { Authorization: `Bearer ${input.route.apiKey}` }
        : {}),
      ...(anthropicBetas.length > 0
        ? { 'anthropic-beta': formatAnthropicBetaHeader(anthropicBetas) }
        : {}),
      ...(input.route.requestOverrides.headers ?? {}),
    };

    const upstreamUrl = `${input.route.apiBaseUrl}${upstreamPath}`;
    const bodyJson = JSON.stringify(upstreamBody);

    // Debug: log upstream request details for diagnosing format issues
    const messageSummary = (upstreamBody as Record<string, unknown>).messages
      ? ((upstreamBody as Record<string, unknown>).messages as Array<{
          role: string;
          content?: unknown;
          tool_calls?: unknown[];
        }>)
      : undefined;
    const inputSummary = (upstreamBody as Record<string, unknown>).input
      ? `${((upstreamBody as Record<string, unknown>).input as unknown[]).length} items`
      : undefined;

    const debugStep = input.wl.startChild(stepUpstream, 'upstream.request.debug', undefined, {
      url: upstreamUrl,
      protocol: input.route.upstreamProtocol,
      model: input.route.model,
      providerType: input.route.providerType ?? 'unknown',
      messageCount: messageSummary?.length ?? 0,
      messageRoles: messageSummary?.map((m) => m.role).join(',') ?? 'n/a',
      inputItemCount: inputSummary ?? 'n/a',
      toolsCount: (upstreamBody as Record<string, unknown>).tools
        ? ((upstreamBody as Record<string, unknown>).tools as unknown[]).length
        : 0,
      bodyKeys: Object.keys(upstreamBody).join(','),
      bodySizeBytes: bodyJson.length,
      maxTokens: input.route.maxTokens,
      temperature: input.route.temperature,
      thinkingEnabled: input.requestData.thinkingEnabled ?? false,
      reasoningEffort: input.requestData.reasoningEffort ?? 'n/a',
      hasApiKey: !!input.route.apiKey,
    });
    input.wl.succeed(debugStep, undefined, {
      bodyPreview: bodyJson.slice(0, 500),
    });

    const response = await fetchUpstreamStreamWithRetry({
      url: `${input.route.apiBaseUrl}${upstreamPath}`,
      init: {
        method: 'POST',
        headers,
        body: JSON.stringify(upstreamBody),
      },
      signal: input.signal,
      requireResponseBody: true,
      retryOptions: {
        maxAttempts: (input.requestData.upstreamRetryMaxRetries ?? 3) + 1,
      },
    });

    if (!response.ok || !response.body) {
      const upstreamError = await readUpstreamError(response);
      input.wl.fail(stepUpstream, undefined, {
        status: response.status,
        errorCode: upstreamError.code,
        errorMessage: upstreamError.message?.slice(0, 200),
        errorDetail: upstreamError.technicalDetail?.slice(0, 500),
      });
      const contextOverflow = isUpstreamContextOverflowError({
        response,
        error: upstreamError,
      });
      writeAuditLog({
        sessionId: input.sessionId,
        category: 'llm',
        sourceName: upstreamError.code,
        requestId: input.clientRequestId,
        input: {
          model: input.route.model,
          provider: input.route.apiBaseUrl,
          round: input.round,
        },
        output: {
          message: upstreamError.message,
          status: response.status,
          code: upstreamError.code,
        },
      });
      if (contextOverflow && compactionAutoEnabled) {
        return {
          overflow: true,
          shouldContinue: false,
          shouldStop: false,
          stopReason: 'error',
          statusCode: response.status,
          state,
          upstreamError,
          usage: undefined,
          usageOccurredAt: undefined,
        };
      }
      markFailedRequestScopeMessages();
      appendSessionMessageV2({
        sessionId: input.sessionId,
        userId: input.userId,
        role: 'assistant',
        content: buildErrorContent(upstreamError.code, upstreamError.message),
        clientRequestId: input.clientRequestId,
        status: 'error',
      });
      input.writeChunk({
        ...createStreamErrorChunk(upstreamError.code, upstreamError.message, input.runId),
        status: response.status,
      } as RunEvent);
      input.wl.flush(input.ctx, response.status);
      emitStepEnded('error');
      return {
        overflow: false,
        shouldContinue: false,
        shouldStop: true,
        stopReason: 'error',
        statusCode: response.status,
        state,
        upstreamError,
        usage: undefined,
        usageOccurredAt: undefined,
      };
    }
    input.wl.succeed(stepUpstream, undefined, { status: response.status });

    // Diagnostic: capture upstream response headers for debugging empty body
    writeAuditLog({
      sessionId: input.sessionId,
      category: 'stream',
      sourceName: 'UPSTREAM_RESPONSE_HEADERS',
      requestId: input.clientRequestId,
      input: {
        url: `${input.route.apiBaseUrl}${upstreamPath}`,
        protocol: input.route.upstreamProtocol,
        status: response.status,
      },
      output: {
        contentType: response.headers.get('content-type'),
        contentLength: response.headers.get('content-length'),
        transferEncoding: response.headers.get('transfer-encoding'),
        hasBody: !!response.body,
      },
      isError: false,
    });

    stepStream = input.wl.start('upstream.stream', undefined, {
      protocol: input.transport,
      upstreamProtocol: input.route.upstreamProtocol,
      round: input.round,
    });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const streamState = createStreamParseState(input.runId);
    streamState.nextEventSequence = input.eventSequence.value;
    if (input.agentId) {
      streamState.agentId = input.agentId;
    }
    let buffer = '';
    let stopReason: StreamStopReason = 'end_turn';

    const completeRound = (
      reason: StreamStopReason,
      doneChunk?: {
        type: 'done';
        stopReason: StreamStopReason;
        eventId?: string;
        runId?: string;
        occurredAt?: number;
      },
    ) => {
      stopReason = reason;
      // Propagate reasoning metadata from stream parser to accumulation state
      // so it can be stored in the ReasoningContent part for multi-turn.
      if (streamState.reasoningEncryptedContent) {
        state.reasoningEncryptedContent = streamState.reasoningEncryptedContent;
      }
      if (streamState.reasoningSummary) {
        state.reasoningSummary = streamState.reasoningSummary;
      }
      if (streamState.responseId) {
        state.responseId = streamState.responseId;
      }
      finalizeAssistant(stopReason);
      if (stopReason !== 'tool_use' || state.toolCalls.size === 0) {
        input.writeChunk(
          doneChunk ?? {
            type: 'done',
            stopReason,
            ...createRunEventMeta(input.runId, input.eventSequence),
          },
        );
      }
      if (stepStream) {
        input.wl.succeed(stepStream, undefined, { round: input.round, stopReason });
      }

      const shouldContinue = isToolUseStopReason(stopReason) ? state.toolCalls.size > 0 : false;
      const usage = streamState.usage;
      const overflow =
        !!usage &&
        typeof input.route.contextWindow === 'number' &&
        isContextOverflow(usage, input.route.contextWindow, input.compactionReservedTokens);
      // Phase 2.2 — close the SessionEvent step boundary so the aggregator
      // can finalise the assistant entry. Token usage is mapped where we
      // have it; cost is filled in by downstream usage handlers and is
      // intentionally left at 0 here.
      emitStepEnded(stopReason, {
        input: usage?.inputTokens ?? 0,
        output: usage?.outputTokens ?? 0,
      });
      return {
        overflow,
        shouldContinue,
        shouldStop: !shouldContinue,
        stopReason,
        statusCode: 200,
        state,
        usage,
        usageOccurredAt: usage ? (doneChunk?.occurredAt ?? Date.now()) : undefined,
      };
    };

    const applyParsedChunks = (parsedChunks: StreamChunk[]) => {
      for (const parsedChunk of parsedChunks) {
        input.eventSequence.value = streamState.nextEventSequence;
        if (parsedChunk.type === 'done') {
          return completeRound(parsedChunk.stopReason, parsedChunk);
        }

        accumulateChunk(state, parsedChunk);
        input.writeChunk(parsedChunk);

        // Phase 2.2 — mirror this chunk into the typed SessionEvent log.
        // The first persistable chunk also opens the assistant step.
        ensureStepStarted();
        persistStreamChunkAsSessionEvents({
          sessionId: input.sessionId,
          userId: input.userId,
          clientRequestId: input.clientRequestId,
          chunk: parsedChunk,
          state: streamSessionEventState,
        });
      }

      return null;
    };

    let frameCount = 0;
    let emptyParseCount = 0;
    const processBuffer = () => {
      let normalized = buffer.replace(/\r\n/g, '\n');
      let boundary = normalized.indexOf('\n\n');
      while (boundary !== -1) {
        const frame = normalized.slice(0, boundary);
        buffer = normalized.slice(boundary + 2);
        normalized = buffer.replace(/\r\n/g, '\n');
        boundary = normalized.indexOf('\n\n');

        frameCount++;
        const parsedChunks = parseUpstreamFrame(frame, input.route.upstreamProtocol, streamState);
        if (parsedChunks.length === 0) {
          emptyParseCount++;
        }
        // Log first 3 frames and any frame that produces a done chunk for diagnostics
        if (frameCount <= 3 || parsedChunks.some((c) => c.type === 'done')) {
          writeAuditLog({
            sessionId: input.sessionId,
            category: 'stream',
            sourceName: 'UPSTREAM_FRAME_DEBUG',
            requestId: input.clientRequestId,
            input: {
              frameIndex: frameCount,
              framePreview: frame.slice(0, 500),
              protocol: input.route.upstreamProtocol,
            },
            output: {
              parsedCount: parsedChunks.length,
              parsedTypes: parsedChunks.map((c) => c.type).join(',') || 'empty',
            },
          });
        }
        const result = applyParsedChunks(parsedChunks);
        if (result) {
          return result;
        }
      }

      input.eventSequence.value = streamState.nextEventSequence;
      return null;
    };

    let readCallCount = 0;
    let totalBytesRead = 0;
    while (true) {
      const { done, value } = await reader.read();
      readCallCount++;
      const chunkBytes = value?.byteLength ?? 0;
      totalBytesRead += chunkBytes;
      // Log first 3 reads and the final read
      if (readCallCount <= 3 || done) {
        writeAuditLog({
          sessionId: input.sessionId,
          category: 'stream',
          sourceName: 'UPSTREAM_READER_READ',
          requestId: input.clientRequestId,
          input: {
            readCall: readCallCount,
            chunkBytes,
            done,
            totalBytesRead,
          },
          output: {
            bufferLen: buffer.length + (value ? decoder.decode(value, { stream: true }).length : 0),
            preview: value ? decoder.decode(value.slice(0, 200)) : '(empty)',
          },
          isError: false,
        });
      }
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      try {
        const result = processBuffer();
        if (result) {
          return result;
        }
      } catch (error) {
        const errorCode = error instanceof ResponsesUpstreamEventError ? error.code : 'PARSE_ERROR';
        const errorMessage =
          error instanceof ResponsesUpstreamEventError
            ? error.message
            : 'Failed to parse upstream stream chunk';
        if (stepStream.status === 'pending') {
          input.wl.fail(stepStream, errorMessage, {
            round: input.round,
          });
        }
        writeAuditLog({
          sessionId: input.sessionId,
          category: 'stream',
          sourceName: errorCode,
          requestId: input.clientRequestId,
          input: { model: input.route.model, round: input.round, phase: 'mid-stream' },
          output: { message: errorMessage, code: errorCode },
        });
        markFailedRequestScopeMessages();
        appendSessionMessageV2({
          sessionId: input.sessionId,
          userId: input.userId,
          role: 'assistant',
          content: buildErrorContent(errorCode, errorMessage),
          clientRequestId: input.clientRequestId,
          status: 'error',
        });
        input.writeChunk(createStreamErrorChunk(errorCode, errorMessage, input.runId));
        input.wl.flush(input.ctx, 502);
        emitStepEnded('error');
        return {
          overflow: false,
          shouldContinue: false,
          shouldStop: true,
          stopReason: 'error',
          statusCode: 502,
          state,
          usage: undefined,
          usageOccurredAt: undefined,
        };
      }

      if (done) break;
    }

    try {
      const trailingFrame = buffer.replace(/\r\n/g, '\n').trim();
      if (trailingFrame.length > 0) {
        const trailingResult = applyParsedChunks(
          parseUpstreamFrame(trailingFrame, input.route.upstreamProtocol, streamState),
        );
        if (trailingResult) {
          return trailingResult;
        }
      }
    } catch (error) {
      const errorCode = error instanceof ResponsesUpstreamEventError ? error.code : 'PARSE_ERROR';
      const errorMessage =
        error instanceof ResponsesUpstreamEventError
          ? error.message
          : 'Failed to parse upstream stream chunk';
      if (stepStream.status === 'pending') {
        input.wl.fail(stepStream, errorMessage, {
          round: input.round,
        });
      }
      writeAuditLog({
        sessionId: input.sessionId,
        category: 'stream',
        sourceName: errorCode,
        requestId: input.clientRequestId,
        input: { model: input.route.model, round: input.round, phase: 'trailing-frame' },
        output: { message: errorMessage, code: errorCode },
      });
      markFailedRequestScopeMessages();
      appendSessionMessageV2({
        sessionId: input.sessionId,
        userId: input.userId,
        role: 'assistant',
        content: buildErrorContent(errorCode, errorMessage),
        clientRequestId: input.clientRequestId,
        status: 'error',
      });
      input.writeChunk(createStreamErrorChunk(errorCode, errorMessage, input.runId));
      input.wl.flush(input.ctx, 502);
      emitStepEnded('error');
      return {
        overflow: false,
        shouldContinue: false,
        shouldStop: true,
        stopReason: 'error',
        statusCode: 502,
        state,
        usage: undefined,
        usageOccurredAt: undefined,
      };
    }

    // Diagnostic: log EOF state when no finish reason was seen
    writeAuditLog({
      sessionId: input.sessionId,
      category: 'stream',
      sourceName: 'UPSTREAM_STREAM_EOF',
      requestId: input.clientRequestId,
      input: {
        model: input.route.model,
        protocol: input.route.upstreamProtocol,
        round: input.round,
      },
      output: {
        totalFrames: frameCount,
        emptyParseFrames: emptyParseCount,
        sawFinishReason: streamState.sawFinishReason,
        stopReason: streamState.stopReason,
        toolCallCount: state.toolCalls.size,
        assistantTextLen: state.assistantText.length,
        trailingBufferPreview: buffer.trim().slice(0, 300),
      },
    });
    const eofResolution = resolveEofRoundDecision({
      sawFinishReason: streamState.sawFinishReason,
      stopReason: streamState.stopReason,
      toolCallCount: state.toolCalls.size,
    });
    return completeRound(eofResolution.stopReason);
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
      usage: undefined,
      usageOccurredAt: undefined,
    };
  }
}
