/**
 * Single conversion entry point: MessageWithParts[] → UnifiedMessage[]
 *
 * Replaces the multi-layer manual conversion chain:
 *   DB → NormalizedConversationMessage → UpstreamChatMessage → sanitize → normalize(回转) → RequestBody
 *
 * With a 2-layer pipeline:
 *   DB → MessageWithParts → UnifiedMessage → ProviderAdapter.render → RequestBody
 *
 * Modeled after opencode's toModelMessagesEffect() which uses a single
 * convertToModelMessages() call as the standardization entry point.
 */

import type {
  MessageWithParts,
  MessagePart,
  TextPart,
  ReasoningPart,
  ToolPart,
  AssistantMessage,
  CompactionPart,
  FilePart,
} from './message-v2-schema.js';
import { parseCompactionMarkerText } from '../compaction/compaction-marker.js';
import { truncateToolOutput } from '../tools/tool-output-truncator.js';

// ─── Unified Message Type ───
// Single intermediate representation, analogous to AI SDK's ModelMessage.
// All upstream protocol rendering reads from this type only.

export interface SystemMessage {
  role: 'system';
  content: string;
}

export interface UserMessageUnified {
  role: 'user';
  content: string;
  images?: Array<{
    artifactId?: string;
    detail?: 'auto' | 'high' | 'low' | 'original';
    fileId?: string;
    fileName?: string;
    imageUrl?: string;
    mimeType?: string;
  }>;
}

export interface AssistantToolCall {
  id: string;
  name: string;
  arguments: string;
  /**
   * Provider-attached metadata round-tripped from the originating
   * `tool-call.providerMetadata` payload. The OpenAI Responses API
   * surfaces an `openai.itemId` (`fc_xxx`) here that is *separate*
   * from the call_id surfaced as `id`; replaying it on subsequent
   * rounds via `providerOptions.openai.itemId` is what keeps the
   * upstream prompt-cache prefix byte-stable across turns.
   *
   * Different-model replay still drops this (mirroring how reasoning
   * metadata is dropped) since `fc_xxx` is provider-scoped — see the
   * `differentModel` guard in the renderer.
   */
  providerMetadata?: Record<string, Record<string, unknown>>;
}

/**
 * Per-block reasoning entry. Carries the verbatim text and any
 * provider-specific opaque payload (e.g. Anthropic extended-thinking
 * `signature`) needed to replay the block on subsequent turns.
 */
export interface AssistantReasoningBlock {
  text: string;
  /** Anthropic extended-thinking signature for this block. */
  signature?: string;
}

export interface AssistantReasoning {
  text?: string;
  encryptedContent?: string;
  summary?: string;
  /** Response ID from Responses API, used as previous_response_id for caching. */
  responseId?: string;
  /**
   * Per-block reasoning entries — used when the upstream produced
   * multiple reasoning blocks (e.g. Anthropic adaptive thinking) and we
   * need to preserve per-block metadata (notably `signature`) instead of
   * collapsing into a single aggregated `text`. When present, renderers
   * that care about per-block fidelity should use `blocks`; renderers
   * that only need the aggregated transcript can fall back to `text`.
   */
  blocks?: AssistantReasoningBlock[];
}

export interface AssistantMessageUnified {
  role: 'assistant';
  content: string | null;
  toolCalls?: AssistantToolCall[];
  reasoning?: AssistantReasoning;
}

export interface ToolResultMessage {
  role: 'tool';
  toolCallId: string;
  toolName?: string;
  isError?: boolean;
  content: string;
}

export type UnifiedMessage =
  SystemMessage | UserMessageUnified | AssistantMessageUnified | ToolResultMessage;

/**
 * Conversion options. Intentionally narrow — this matches opencode's
 * `toModelMessagesEffect(input, model, options?)` shape and *deliberately*
 * does NOT include any wall-clock-based stripping toggle.
 *
 * The previous OpenAWork-only `stripOldToolResults` flag rewrote any tool
 * output older than 10 minutes (computed against `Date.now()` at the moment
 * of upstream send) into a placeholder. That mutation was non-deterministic
 * across rounds: the same DB row produced different bytes on round N vs
 * round N+1 just because the wall clock advanced past the 10-minute
 * boundary, which silently invalidated Anthropic / OpenAI prompt-cache
 * prefixes mid-conversation. opencode never strips on render; instead it
 * mutates `part.state.time.compacted` once during `SessionCompaction.prune`
 * and lets `resolveToolOutput` consult that persistent flag on every
 * subsequent render. We follow the same model: every render of the same DB
 * state returns byte-identical bytes, period.
 */
export interface ToModelMessagesOptions {
  /**
   * Current upstream `(providerID, modelID)`. When supplied, assistant
   * turns produced by a *different* provider/model have their reasoning
   * metadata (signature / encryptedContent / summary) dropped, mirroring
   * opencode `toModelMessagesEffect`'s `differentModel` branch
   * (message-v2.ts:840). Without this, signed Anthropic thinking blocks
   * from a previous Claude model would be replayed against e.g. an
   * OpenAI model and the upstream would reject the unknown signature.
   */
  readonly currentModel?: { providerID: string; modelID: string };
}

const COMPACTED_TOOL_RESULT_PLACEHOLDER = '[Old tool result content cleared]';
const LEGACY_COMPACTION_MARKER_SOURCES = ['openAwork', 'openawork_internal'] as const;
const LEGACY_COMPACTION_MARKER_TYPE = 'compaction_marker';

interface LegacyCompactionMarker {
  summary: string;
  tailStartMessageId?: string;
}

function parseLegacyCompactionMarkerText(value: string) {
  for (const source of LEGACY_COMPACTION_MARKER_SOURCES) {
    const parsed = parseCompactionMarkerText(value, {
      source,
      markerType: LEGACY_COMPACTION_MARKER_TYPE,
    });
    if (parsed) {
      return parsed;
    }
  }
  return null;
}

function readLegacyCompactionMarker(message: MessageWithParts): LegacyCompactionMarker | null {
  if (message.info.role !== 'assistant' || message.parts.length === 0) {
    return null;
  }

  const textParts = message.parts.filter((part): part is TextPart => part.type === 'text');
  if (textParts.length !== message.parts.length || textParts.length === 0) {
    return null;
  }

  let marker: LegacyCompactionMarker | null = null;
  for (const part of textParts) {
    const parsed = parseLegacyCompactionMarkerText(part.text);
    if (!parsed) {
      return null;
    }

    marker = {
      summary: parsed.summary,
      ...(parsed.tailStartMessageId ? { tailStartMessageId: parsed.tailStartMessageId } : {}),
    };
  }

  return marker;
}

function isModelContextArtifactMessage(message: MessageWithParts): boolean {
  if (message.info.role !== 'assistant') {
    return false;
  }

  const clientRequestId = message.info.clientRequestId;
  return (
    typeof clientRequestId === 'string' &&
    (clientRequestId.startsWith('assistant_event:') || clientRequestId.startsWith('command-card:'))
  );
}

/**
 * Hard cap on tool output characters sent to LLM.
 * Prevents stored oversized outputs from overflowing the context window.
 * ~50k tokens ≈ ~200k chars.
 */
const MAX_TOOL_OUTPUT_CHARS = 200_000;
const MAX_TOOL_ARGUMENT_CHARS = 50_000;

const TOOL_OUTPUT_TRUNCATION_NOTICE =
  '\n\n[工具输出已截断 — 完整内容已保留，可使用 read_tool_output 查看。]';
const TOOL_ARGUMENT_TRUNCATION_NOTICE = '\n\n[工具调用参数已截断 — 参数过大，已省略后续内容。]';

/**
 * Filter out messages before the most recent compaction boundary.
 * Modeled after opencode's filterCompacted(): scan from newest to oldest,
 * stop at the first completed compaction marker, and discard everything
 * before it. This prevents sending stale pre-compaction messages that
 * would duplicate the compaction summary and waste tokens.
 *
 * Tail retention (opencode message-v2.ts:1058-1083):
 *   When the matched CompactionPart carries `tailStartID`, instead of
 *   cutting strictly at the compaction user message, keep collecting
 *   messages backwards until we reach the message whose id equals
 *   `tailStartID`. The compaction summary itself is still retained in
 *   the result, but the verbatim tail context (since `tailStartID`)
 *   survives, mirroring opencode's "keep recent messages" behavior.
 *
 * opencode logic outline:
 *   - Iterate messages in reverse (newest first)
 *   - Track "completed" compaction parents (assistant with summary+finish+no error)
 *   - On a user message that has a compaction part and is completed:
 *       * If the part has tailStartID, set retain=tailStartID and keep
 *         iterating until the message with that id is included, then break.
 *       * Otherwise break immediately.
 *   - Reverse result back to chronological order
 *
 * Input forms:
 *   - `MessageWithParts[]` (chronological / time-ascending): the function
 *     iterates the array in reverse internally.
 *   - `Iterable<MessageWithParts>` (newest-first generator): the function
 *     consumes it directly. Designed for streaming readers like
 *     `streamMessagesWithParts()` so we can short-circuit before pulling
 *     the entire history out of SQLite.
 */
function* iterateNewestFirst(
  input: MessageWithParts[] | Iterable<MessageWithParts>,
): Generator<MessageWithParts, void, unknown> {
  if (Array.isArray(input)) {
    for (let i = input.length - 1; i >= 0; i--) {
      yield input[i]!;
    }
    return;
  }
  yield* input;
}

export function filterCompacted(
  input: MessageWithParts[] | Iterable<MessageWithParts>,
): MessageWithParts[] {
  const result: MessageWithParts[] = [];
  const completedCompactionParentIds = new Set<string>();
  let retain: string | undefined;
  let boundaryKind: 'legacy' | 'v2' | undefined;
  let boundaryMessageId: string | undefined;

  for (const msg of iterateNewestFirst(input)) {
    result.push(msg);

    // Once tail retention has been requested, keep walking backwards
    // until we include the message whose id matches `retain`, then stop.
    if (retain) {
      if (msg.info.id === retain) break;
      continue;
    }

    // Backward compatibility: manual /compact currently persists a legacy
    // assistant text marker instead of a V2 CompactionPart. Treat it as the
    // latest boundary and retain the explicit recent tail when present.
    const legacyMarker = readLegacyCompactionMarker(msg);
    if (legacyMarker) {
      boundaryKind = 'legacy';
      boundaryMessageId = msg.info.id;
      if (legacyMarker.tailStartMessageId) {
        retain = legacyMarker.tailStartMessageId;
        if (msg.info.id === retain) break;
        continue;
      }
      break;
    }

    // Detect completed compaction boundary:
    // An assistant message with summary=true, finish defined, and no error
    // marks its parentID as a completed compaction point.
    if (
      msg.info.role === 'assistant' &&
      'summary' in msg.info &&
      msg.info.summary === true &&
      'finish' in msg.info &&
      msg.info.finish !== undefined &&
      !msg.info.error
    ) {
      const parentId = 'parentID' in msg.info ? msg.info.parentID : undefined;
      if (parentId) {
        completedCompactionParentIds.add(parentId);
      }
      continue;
    }

    // If this is a user message with a compaction part and its parent
    // has a completed summary, we've found the boundary.
    if (msg.info.role === 'user' && completedCompactionParentIds.has(msg.info.id)) {
      const compactionPart = msg.parts.find((p): p is CompactionPart => p.type === 'compaction');
      if (!compactionPart) continue;
      boundaryKind = 'v2';
      boundaryMessageId = msg.info.id;
      if (compactionPart.tailStartID) {
        retain = compactionPart.tailStartID;
        // If the boundary message itself is already the tail start, stop now.
        if (msg.info.id === retain) break;
        continue;
      }
      break;
    }
  }

  // Reverse back to chronological (time-ascending) order
  result.reverse();

  // Legacy markers are appended after the messages they summarize. Move the
  // marker before its retained tail so toModelMessages emits summary first,
  // then the verbatim recent context, matching the V2 compaction ordering.
  if (boundaryKind === 'legacy') {
    let legacyMarkerIndex = boundaryMessageId
      ? result.findIndex((message) => message.info.id === boundaryMessageId)
      : -1;
    if (legacyMarkerIndex < 0) {
      for (let i = result.length - 1; i >= 0; i -= 1) {
        if (readLegacyCompactionMarker(result[i]!)) {
          legacyMarkerIndex = i;
          break;
        }
      }
    }

    if (legacyMarkerIndex >= 0) {
      const legacyMarker = readLegacyCompactionMarker(result[legacyMarkerIndex]!);
      const tailIndex = legacyMarker?.tailStartMessageId
        ? result.findIndex((message) => message.info.id === legacyMarker.tailStartMessageId)
        : -1;
      if (legacyMarker && tailIndex >= 0 && tailIndex <= legacyMarkerIndex) {
        return [
          ...result.slice(legacyMarkerIndex, legacyMarkerIndex + 1),
          ...result.slice(tailIndex, legacyMarkerIndex),
          ...result.slice(legacyMarkerIndex + 1),
        ];
      }
      // If the retained-tail anchor is missing or malformed, still honor the
      // compaction boundary instead of replaying the entire pre-compaction log.
      return result.slice(legacyMarkerIndex);
    }
  }

  let compactionIndex = -1;
  for (let i = result.length - 1; i >= 0; i--) {
    const msg = result[i]!;
    if (
      msg.info.role === 'user' &&
      msg.parts.some(
        (p): p is CompactionPart => p.type === 'compaction' && p.tailStartID !== undefined,
      )
    ) {
      compactionIndex = i;
      break;
    }
  }
  const compaction = compactionIndex >= 0 ? result[compactionIndex] : undefined;
  const part = compaction?.parts.find(
    (p): p is CompactionPart => p.type === 'compaction' && p.tailStartID !== undefined,
  );
  const summaryIndex = compaction
    ? result.findIndex(
        (msg, index) =>
          index > compactionIndex &&
          msg.info.role === 'assistant' &&
          msg.info.summary === true &&
          msg.info.parentID === compaction.info.id,
      )
    : -1;
  const tailIndex = part?.tailStartID
    ? result.findIndex((msg) => msg.info.id === part.tailStartID)
    : -1;
  if (tailIndex >= 0 && tailIndex < compactionIndex && summaryIndex > compactionIndex) {
    return [
      ...result.slice(compactionIndex, summaryIndex + 1),
      ...result.slice(tailIndex, compactionIndex),
      ...result.slice(summaryIndex + 1),
    ];
  }
  return result;
}

/**
 * Convert MessageWithParts[] to UnifiedMessage[].
 * This is the single standardization entry point — all upstream rendering
 * should consume UnifiedMessage[], never the raw DB types.
 */
export function toModelMessages(
  input: MessageWithParts[],
  options?: ToModelMessagesOptions,
): UnifiedMessage[] {
  const result: UnifiedMessage[] = [];
  const emittedToolResultIds = new Set<string>();

  const pushToolResult = (
    toolCallId: string,
    toolName: string,
    content: string,
    attachments?: FilePart[],
    isError?: boolean,
  ) => {
    if (emittedToolResultIds.has(toolCallId)) return;
    emittedToolResultIds.add(toolCallId);
    result.push({
      role: 'tool',
      toolCallId,
      toolName,
      content,
      ...(isError ? { isError: true } : {}),
    });

    // opencode parity: when a tool returns image attachments, follow the
    // tool result with a synthetic user message carrying the images.
    // opencode chooses inline-vs-synthetic based on provider capability,
    // but the synthetic-user-message form works for every provider that
    // accepts user-side images, so we emit it unconditionally.
    const images = collectAttachmentImages(attachments);
    if (images.length > 0) {
      result.push({
        role: 'user',
        content: '[Tool returned the following attachments]',
        images,
      });
    }
  };

  for (const msg of input) {
    if (msg.parts.length === 0) continue;

    if (msg.info.role === 'user') {
      const { text, images } = buildUserInput(msg.parts);
      if (text.length > 0 || images.length > 0) {
        result.push({ role: 'user', content: text, ...(images.length > 0 ? { images } : {}) });
      }
      continue;
    }

    if (msg.info.role === 'assistant') {
      const legacyMarker = readLegacyCompactionMarker(msg);
      if (legacyMarker) {
        if (legacyMarker.summary.trim().length > 0) {
          result.push({
            role: 'user',
            content: 'What did we do so far?',
          });
          result.push({
            role: 'assistant',
            content: legacyMarker.summary,
          });
        }
        continue;
      }

      // Display-only assistant event cards and command result cards are
      // persisted for transcript recovery, but they are not conversation
      // context. Sending them upstream wastes tokens and can replay long
      // compaction summaries as ordinary assistant content.
      if (isModelContextArtifactMessage(msg)) {
        continue;
      }

      // Skip error-status messages (failed upstream responses should not replay in recovery)
      if (msg.info.status === 'error') {
        continue;
      }
      // Skip messages with structured error field but no valid content
      if (msg.info.error && !hasValidAssistantParts(msg.parts)) {
        continue;
      }

      // opencode parity: when the assistant turn was produced by a
      // different provider/model than the one we are about to call,
      // drop the reasoning metadata (signature/encryptedContent/summary)
      // so we do not replay an opaque payload an unrelated model cannot
      // understand. Falsy currentModel disables the check.
      const differentModel = Boolean(
        options?.currentModel &&
        msg.info.providerID &&
        msg.info.modelID &&
        (options.currentModel.providerID !== msg.info.providerID ||
          options.currentModel.modelID !== msg.info.modelID),
      );
      const { text, toolCalls, reasoning } = buildAssistantParts(msg.parts, msg.info, {
        differentModel,
      });

      if (text.length > 0 || toolCalls.length > 0 || reasoning) {
        result.push({
          role: 'assistant',
          content: text.length > 0 ? text : null,
          ...(toolCalls.length > 0 ? { toolCalls } : {}),
          ...(reasoning ? { reasoning } : {}),
        });
      }

      // Emit tool results from this assistant message's tool parts
      for (const part of msg.parts) {
        if (part.type !== 'tool') continue;
        // Skip tool parts with empty names — they were also filtered
        // from the assistant's toolCalls array above, so emitting a
        // orphaned tool_result here would cause a mismatch.
        if (part.tool.length === 0) continue;
        if (part.state.status === 'completed') {
          const completedPart = part as ToolPart & {
            state: {
              status: 'completed';
              output: string;
              time: { start: number; end: number; compacted?: number };
              attachments?: FilePart[];
            };
          };
          const output = resolveToolOutput(completedPart);
          // Skip attachments when the tool result has been compacted to
          // a placeholder — replaying images alongside a stub provides no
          // value and only inflates the prompt.
          const attachments =
            output === COMPACTED_TOOL_RESULT_PLACEHOLDER
              ? undefined
              : completedPart.state.attachments;
          pushToolResult(part.callID, part.tool, output, attachments);
        } else if (part.state.status === 'error') {
          const errorPart = part as ToolPart & {
            state: { status: 'error'; error: string; metadata?: Record<string, unknown> };
          };
          const errorOutput = resolveToolErrorOutput(errorPart);
          if (errorOutput) {
            pushToolResult(part.callID, part.tool, errorOutput, undefined, true);
          }
        } else if (part.state.status === 'pending' || part.state.status === 'running') {
          // Pending/running tool calls need a synthetic error result
          // to prevent dangling tool_use blocks (Anthropic requires every
          // tool_use to have a corresponding tool_result)
          pushToolResult(
            part.callID,
            part.tool,
            '[Tool execution was interrupted]',
            undefined,
            true,
          );
        }
      }
      continue;
    }

    if (msg.info.role === 'system') {
      const text = msg.parts
        .filter((p): p is TextPart => p.type === 'text')
        .map((p) => p.text)
        .join('\n')
        .trim();
      if (text.length > 0) {
        result.push({ role: 'system', content: text });
      }
    }
  }

  return result;
}

// ─── Helpers ───

type UnifiedImageBlock = NonNullable<UserMessageUnified['images']>[number];

/**
 * Filter `ToolStateCompleted.attachments` down to the `input_image`
 * file parts and project them into the same image-block shape used by
 * `UserMessageUnified.images`. Non-image attachments are dropped here
 * because the renderers' user-image fast paths only know how to embed
 * images; richer mime types are surfaced through the textual tool
 * output instead.
 */
function collectAttachmentImages(attachments: FilePart[] | undefined): UnifiedImageBlock[] {
  const images: UnifiedImageBlock[] = [];
  if (!attachments || attachments.length === 0) {
    return images;
  }
  for (const att of attachments) {
    if (att.type !== 'file') continue;
    if (att.inputType && att.inputType !== 'input_image') continue;
    // Anthropic-side attachments may omit `inputType` and rely on mime;
    // accept image/* mime types as image attachments.
    if (!att.inputType && !(att.mime && att.mime.startsWith('image/'))) continue;
    images.push({
      ...(att.artifactId ? { artifactId: att.artifactId } : {}),
      ...(att.detail ? { detail: att.detail } : {}),
      ...(att.fileId ? { fileId: att.fileId } : {}),
      ...(att.filename ? { fileName: att.filename } : {}),
      ...(att.url ? { imageUrl: att.url } : {}),
      ...(att.mime ? { mimeType: att.mime } : {}),
    });
  }
  return images;
}

function buildUserInput(parts: MessagePart[]): {
  images: Array<{
    artifactId?: string;
    detail?: 'auto' | 'high' | 'low' | 'original';
    fileId?: string;
    fileName?: string;
    imageUrl?: string;
    mimeType?: string;
  }>;
  text: string;
} {
  // Match opencode's toModelMessagesEffect: each part type maps to text.
  // compaction → "What did we do so far?" (opencode message-v2.ts:676-681)
  // subtask → "The following tool was executed by the user" (opencode message-v2.ts:682-686)
  // text → raw text (unless ignored)
  const segments: string[] = [];
  const images: Array<{
    artifactId?: string;
    detail?: 'auto' | 'high' | 'low' | 'original';
    fileId?: string;
    fileName?: string;
    imageUrl?: string;
    mimeType?: string;
  }> = [];
  for (const p of parts) {
    if (p.type === 'text' && !p.ignored) {
      segments.push(p.text);
    } else if (p.type === 'file' && p.inputType === 'input_image') {
      images.push({
        ...(p.artifactId ? { artifactId: p.artifactId } : {}),
        ...(p.detail ? { detail: p.detail } : {}),
        ...(p.fileId ? { fileId: p.fileId } : {}),
        ...(p.filename ? { fileName: p.filename } : {}),
        ...(p.url ? { imageUrl: p.url } : {}),
        ...(p.mime ? { mimeType: p.mime } : {}),
      });
    } else if (p.type === 'compaction') {
      segments.push('What did we do so far?');
    } else if (p.type === 'subtask') {
      segments.push('The following tool was executed by the user');
    }
  }
  return { text: segments.join('\n').trim(), images };
}

function hasValidAssistantParts(parts: MessagePart[]): boolean {
  return parts.some((p) => {
    if (p.type === 'text' && p.text.trim().length > 0) return true;
    if (p.type === 'tool') return true;
    if (p.type === 'reasoning' && p.text.trim().length > 0) return true;
    return false;
  });
}

interface AssistantBuildResult {
  text: string;
  toolCalls: AssistantToolCall[];
  reasoning: AssistantReasoning | undefined;
}

function buildAssistantParts(
  parts: MessagePart[],
  _info: AssistantMessage,
  options?: { differentModel?: boolean },
): AssistantBuildResult {
  // Text
  const text = parts
    .filter((p): p is TextPart => p.type === 'text')
    .map((p) => p.text)
    .join('\n')
    .trim();

  // Tool calls — filter out parts with empty tool names to prevent
  // API-level validation errors (some providers occasionally emit a
  // tool-input-start without a toolName, which cascades into an empty
  // `name` field in the serialized request).
  const differentModelForTools = Boolean(options?.differentModel);
  const toolCalls: AssistantToolCall[] = parts
    .filter((p): p is ToolPart => p.type === 'tool')
    .filter((part) => part.tool.length > 0)
    .map((part) => {
      // Round-trip provider-scoped metadata (most importantly
      // `openai.itemId`) when replaying against the same provider.
      // We strip it on `differentModel` for the same reason we drop
      // reasoning signatures: an opaque provider-issued id has no
      // meaning to a foreign model and would either be ignored or
      // rejected, while still bloating the prefix.
      const persisted =
        !differentModelForTools &&
        part.metadata &&
        typeof part.metadata['providerMetadata'] === 'object' &&
        part.metadata['providerMetadata'] !== null
          ? (part.metadata['providerMetadata'] as Record<string, Record<string, unknown>>)
          : undefined;
      return {
        id: part.callID,
        name: part.tool,
        arguments: resolveToolArguments(part),
        ...(persisted && Object.keys(persisted).length > 0 ? { providerMetadata: persisted } : {}),
      };
    });

  // Reasoning
  const reasoningParts = parts.filter((p): p is ReasoningPart => p.type === 'reasoning');
  const trimmedReasoningText = reasoningParts
    .map((p) => p.text.trim())
    .filter((t) => t.length > 0)
    .join('\n\n');

  // Extract responseId from the first reasoning part that has one
  const responseId = reasoningParts.find((p) => p.responseId)?.responseId;

  // Extract Responses API metadata (encryptedContent / summary) stored in part.metadata
  const encryptedContent = reasoningParts
    .map((p) => p.metadata?.['encryptedContent'])
    .find((v): v is string => typeof v === 'string' && v.length > 0);
  const summary = reasoningParts
    .map((p) => p.metadata?.['summary'])
    .find((v): v is string => typeof v === 'string' && v.length > 0);

  // Per-block reasoning. Anthropic extended-thinking signatures are
  // attached per-block under `metadata.anthropic.signature` (or
  // `metadata.bedrock.signature` for Bedrock-hosted Claude); collapse
  // them into per-block entries so the bridge to ModelMessage can emit
  // distinct ReasoningPart entries each carrying their own provider
  // metadata. We only emit the `blocks` array when at least one signed
  // block is present, otherwise the existing aggregated `text` path is
  // sufficient and equivalent.
  const reasoningBlocks: AssistantReasoningBlock[] = [];
  let hasSignedBlock = false;
  for (const part of reasoningParts) {
    const trimmed = part.text.trim();
    if (trimmed.length === 0) continue;
    const sigDirect = part.metadata?.['signature'];
    const sigAnthropic = (part.metadata?.['anthropic'] as { signature?: unknown } | undefined)
      ?.signature;
    const sigBedrock = (part.metadata?.['bedrock'] as { signature?: unknown } | undefined)
      ?.signature;
    const signature =
      typeof sigDirect === 'string' && sigDirect.length > 0
        ? sigDirect
        : typeof sigAnthropic === 'string' && sigAnthropic.length > 0
          ? sigAnthropic
          : typeof sigBedrock === 'string' && sigBedrock.length > 0
            ? sigBedrock
            : undefined;
    if (signature) hasSignedBlock = true;
    reasoningBlocks.push({ text: trimmed, ...(signature ? { signature } : {}) });
  }

  // opencode parity (message-v2.ts:879, 959-966): when replaying a
  // reasoning turn against a *different* model, strip the opaque
  // metadata (signature / encryptedContent / summary / responseId) so
  // we do not send a Claude signature to GPT or vice-versa. The
  // reasoning text is still carried verbatim.
  const differentModel = Boolean(options?.differentModel);

  const reasoning: AssistantReasoning | undefined =
    trimmedReasoningText.length > 0 ||
    (!differentModel && (responseId || encryptedContent || summary))
      ? {
          ...(trimmedReasoningText.length > 0 ? { text: trimmedReasoningText } : {}),
          ...(!differentModel && responseId ? { responseId } : {}),
          ...(!differentModel && encryptedContent ? { encryptedContent } : {}),
          ...(!differentModel && summary ? { summary } : {}),
          ...(!differentModel && hasSignedBlock && reasoningBlocks.length > 0
            ? { blocks: reasoningBlocks }
            : {}),
        }
      : undefined;

  return { text, toolCalls, reasoning };
}

function resolveToolArguments(part: ToolPart): string {
  const rawArguments =
    part.state.status === 'pending' ? part.state.raw : safeStringifyForModel(part.state.input);
  return capModelString(rawArguments, MAX_TOOL_ARGUMENT_CHARS, TOOL_ARGUMENT_TRUNCATION_NOTICE);
}

function safeStringifyForModel(value: unknown): string {
  const seen = new WeakSet<object>();
  try {
    const serialized = JSON.stringify(value, (_key: string, current: unknown) => {
      if (typeof current === 'bigint') return current.toString();
      if (current && typeof current === 'object') {
        if (seen.has(current)) return '[Circular]';
        seen.add(current);
      }
      return current;
    });
    return serialized ?? String(value);
  } catch {
    return String(value);
  }
}

function capModelString(value: string, maxChars: number, notice: string): string {
  if (value.length <= maxChars) return value;
  return value.slice(0, maxChars) + notice;
}

function resolveToolOutput(
  part: ToolPart & {
    state: {
      status: 'completed';
      output: string;
      time: { start: number; end: number; compacted?: number };
    };
  },
): string {
  // Persistent compaction flag — set by future `SessionCompaction.prune`
  // (opencode parity). Once a tool part has been pruned, every subsequent
  // render returns the same placeholder so the upstream prefix stays
  // byte-identical across rounds (Anthropic / OpenAI prompt-cache friendly).
  if (part.state.time.compacted) {
    return COMPACTED_TOOL_RESULT_PLACEHOLDER;
  }

  const output = part.state.output;
  return truncateToolOutput(
    part.tool,
    capModelString(output, MAX_TOOL_OUTPUT_CHARS, TOOL_OUTPUT_TRUNCATION_NOTICE),
  );
}

function resolveToolErrorOutput(part: ToolPart & { state: { status: 'error' } }): string | null {
  // If the tool was interrupted, use the partial output if available
  const interrupted = part.state.metadata?.interrupted === true;
  if (interrupted) {
    const output = part.state.metadata?.output;
    if (typeof output === 'string') {
      return truncateToolOutput(
        part.tool,
        capModelString(output, MAX_TOOL_OUTPUT_CHARS, TOOL_OUTPUT_TRUNCATION_NOTICE),
      );
    }
  }
  // Otherwise, return the error text as the tool result
  return part.state.error
    ? truncateToolOutput(
        part.tool,
        capModelString(part.state.error, MAX_TOOL_OUTPUT_CHARS, TOOL_OUTPUT_TRUNCATION_NOTICE),
      )
    : null;
}
