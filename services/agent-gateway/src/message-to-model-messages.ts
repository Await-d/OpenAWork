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
}

export interface AssistantReasoning {
  text?: string;
  encryptedContent?: string;
  summary?: string;
  /** Response ID from Responses API, used as previous_response_id for caching. */
  responseId?: string;
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
  content: string;
}

export type UnifiedMessage =
  | SystemMessage
  | UserMessageUnified
  | AssistantMessageUnified
  | ToolResultMessage;

export interface ToModelMessagesOptions {
  /** Replace old tool_result content with placeholder (replaces microcompactByAge) */
  stripOldToolResults?: boolean;
  /** Age threshold in ms for stripping old tool results (default: 10 min) */
  oldToolResultAgeMs?: number;
  /** Current time override for testing */
  now?: number;
}

const DEFAULT_OLD_TOOL_RESULT_AGE_MS = 10 * 60 * 1000; // 10 minutes

const COMPACTED_TOOL_RESULT_PLACEHOLDER = '[Old tool result content cleared]';

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

  for (const msg of iterateNewestFirst(input)) {
    result.push(msg);

    // Once tail retention has been requested, keep walking backwards
    // until we include the message whose id matches `retain`, then stop.
    if (retain) {
      if (msg.info.id === retain) break;
      continue;
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
  const now = options?.now ?? Date.now();
  const ageThreshold = options?.oldToolResultAgeMs ?? DEFAULT_OLD_TOOL_RESULT_AGE_MS;

  const pushToolResult = (toolCallId: string, content: string, attachments?: FilePart[]) => {
    if (emittedToolResultIds.has(toolCallId)) return;
    emittedToolResultIds.add(toolCallId);
    result.push({ role: 'tool', toolCallId, content });

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
      // Skip error-status messages (failed upstream responses should not replay in recovery)
      if (msg.info.status === 'error') {
        continue;
      }
      // Skip messages with structured error field but no valid content
      if (msg.info.error && !hasValidAssistantParts(msg.parts)) {
        continue;
      }

      const { text, toolCalls, reasoning } = buildAssistantParts(
        msg.parts,
        msg.info,
        options?.stripOldToolResults === true ? { now, ageThreshold } : undefined,
      );

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
        if (part.state.status === 'completed') {
          const completedPart = part as ToolPart & {
            state: {
              status: 'completed';
              output: string;
              time: { start: number; end: number; compacted?: number };
              attachments?: FilePart[];
            };
          };
          const output = resolveToolOutput(
            completedPart,
            options?.stripOldToolResults === true ? { now, ageThreshold } : undefined,
          );
          // Skip attachments when the tool result has been compacted to
          // a placeholder — replaying images alongside a stub provides no
          // value and only inflates the prompt.
          const attachments =
            output === COMPACTED_TOOL_RESULT_PLACEHOLDER
              ? undefined
              : completedPart.state.attachments;
          pushToolResult(part.callID, output, attachments);
        } else if (part.state.status === 'error') {
          const errorPart = part as ToolPart & {
            state: { status: 'error'; error: string; metadata?: Record<string, unknown> };
          };
          const errorOutput = resolveToolErrorOutput(errorPart);
          if (errorOutput) {
            pushToolResult(part.callID, errorOutput);
          }
        } else if (part.state.status === 'pending' || part.state.status === 'running') {
          // Pending/running tool calls need a synthetic error result
          // to prevent dangling tool_use blocks (Anthropic requires every
          // tool_use to have a corresponding tool_result)
          pushToolResult(part.callID, '[Tool execution was interrupted]');
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
  _stripOptions?: { now: number; ageThreshold: number },
): AssistantBuildResult {
  // Text
  const text = parts
    .filter((p): p is TextPart => p.type === 'text')
    .map((p) => p.text)
    .join('\n')
    .trim();

  // Tool calls
  const toolCalls: AssistantToolCall[] = parts
    .filter((p): p is ToolPart => p.type === 'tool')
    .map((part) => ({
      id: part.callID,
      name: part.tool,
      arguments: resolveToolArguments(part),
    }));

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

  const reasoning: AssistantReasoning | undefined =
    trimmedReasoningText.length > 0 || responseId || encryptedContent || summary
      ? {
          ...(trimmedReasoningText.length > 0 ? { text: trimmedReasoningText } : {}),
          ...(responseId ? { responseId } : {}),
          ...(encryptedContent ? { encryptedContent } : {}),
          ...(summary ? { summary } : {}),
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
  _stripOptions?: { now: number; ageThreshold: number },
): string {
  if (part.state.time.compacted) {
    return COMPACTED_TOOL_RESULT_PLACEHOLDER;
  }

  if (_stripOptions) {
    const age = _stripOptions.now - (part.state.time.start ?? 0);
    if (age > _stripOptions.ageThreshold) {
      return COMPACTED_TOOL_RESULT_PLACEHOLDER;
    }
  }

  const output = part.state.output;
  return capModelString(output, MAX_TOOL_OUTPUT_CHARS, TOOL_OUTPUT_TRUNCATION_NOTICE);
}

function resolveToolErrorOutput(part: ToolPart & { state: { status: 'error' } }): string | null {
  // If the tool was interrupted, use the partial output if available
  const interrupted = part.state.metadata?.interrupted === true;
  if (interrupted) {
    const output = part.state.metadata?.output;
    if (typeof output === 'string') {
      return capModelString(output, MAX_TOOL_OUTPUT_CHARS, TOOL_OUTPUT_TRUNCATION_NOTICE);
    }
  }
  // Otherwise, return the error text as the tool result
  return part.state.error
    ? capModelString(part.state.error, MAX_TOOL_OUTPUT_CHARS, TOOL_OUTPUT_TRUNCATION_NOTICE)
    : null;
}
