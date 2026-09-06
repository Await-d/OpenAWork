/**
 * Microcompact — Lightweight per-round tool output clearing.
 *
 * Modeled after Claude Code's `services/compact/microCompact.ts`.
 *
 * Runs before every upstream API call to clear stale tool_result outputs,
 * reducing token usage without any LLM call. This delays the need for
 * full compaction and keeps the context window lean.
 *
 * Three trigger modes:
 * 1. Count-based: When compactable tool_results exceed `triggerThreshold`,
 *    clear all but the most recent `keepRecent`.
 * 2. Time-based: When the gap since the last assistant message exceeds
 *    `timeGapThresholdMinutes` (cache is cold anyway), clear aggressively.
 * 3. Budget-based: Replace older outputs until retained characters fit the budget.
 *
 * Operates on UnifiedMessage[] at render time — does NOT mutate DB data.
 * This ensures the same DB state always produces the same output within
 * a single round (prompt-cache stability), while still saving tokens.
 */

import type { UnifiedMessage } from '../message/message-to-model-messages.js';
import { buildToolOutputReferenceIdentity } from '../message/tool-output-reference.js';
import {
  DEFAULT_TOOL_CONTEXT_POLICY,
  resolveToolContextPolicy,
  type ToolContextPolicyInput,
} from './tool-context-policy.js';

// ─── Configuration ───────────────────────────────────────────────────────────

export interface MicrocompactConfig {
  /** Enable/disable microcompact entirely. */
  enabled: boolean;
  /** Total retained tool output character budget; latest result remains available. */
  maxOutputChars: number;
  /** Trigger threshold: compact when compactable tool_results exceed this count. */
  triggerThreshold: number;
  /** Number of most-recent compactable tool_results to keep intact. */
  keepRecent: number;
  /** Whether the time-based trigger is enabled. */
  timeBasedEnabled: boolean;
  /** Time-based trigger: minutes since last assistant message. */
  timeGapThresholdMinutes: number;
  /** Number of recent compactable results kept by the time-based trigger. */
  timeBasedKeepRecent: number;
  /** Tool names whose results are eligible for clearing. */
  compactableTools: ReadonlySet<string>;
  /** Tool names whose results must never be cleared. */
  protectedTools: ReadonlySet<string>;
}

export const DEFAULT_COMPACTABLE_TOOLS: ReadonlySet<string> = new Set();

export const DEFAULT_PROTECTED_TOOLS: ReadonlySet<string> = new Set();

export const DEFAULT_MICROCOMPACT_CONFIG: MicrocompactConfig = {
  enabled: true,
  maxOutputChars: DEFAULT_TOOL_CONTEXT_POLICY.maxTotalToolCostChars,
  triggerThreshold: 20,
  keepRecent: 8,
  timeBasedEnabled: false,
  timeGapThresholdMinutes: 60,
  timeBasedKeepRecent: 5,
  compactableTools: DEFAULT_COMPACTABLE_TOOLS,
  protectedTools: DEFAULT_PROTECTED_TOOLS,
};

// ─── Result Type ─────────────────────────────────────────────────────────────

export interface MicrocompactResult {
  /** Whether any clearing was performed. */
  applied: boolean;
  /** Number of tool_results cleared. */
  clearedCount: number;
  /** Estimated tokens saved. */
  tokensSaved: number;
  /** Trigger reason. */
  trigger: 'count' | 'time' | 'budget' | 'none';
  readonly metrics: ToolContextMetrics;
}

export interface ToolContextMetrics {
  readonly afterChars: number;
  readonly beforeChars: number;
  readonly estimatedAfterTokens: number;
  readonly imagesOmitted: number;
  readonly largestResultChars: number;
}

function buildMetrics(input: {
  readonly afterChars: number;
  readonly beforeChars: number;
  readonly imagesOmitted?: number;
  readonly largestResultChars: number;
}): ToolContextMetrics {
  return {
    afterChars: input.afterChars,
    beforeChars: input.beforeChars,
    estimatedAfterTokens: Math.ceil(input.afterChars / DEFAULT_TOOL_CONTEXT_POLICY.charsPerToken),
    imagesOmitted: input.imagesOmitted ?? 0,
    largestResultChars: input.largestResultChars,
  };
}

// ─── Placeholder ─────────────────────────────────────────────────────────────

const MICROCOMPACT_CLEARED_PLACEHOLDER = '[Old tool result content cleared]';

// ─── Core Logic ──────────────────────────────────────────────────────────────

const TOOL_ATTACHMENT_MESSAGE = '[Tool returned the following attachments]';

interface ToolResultCandidate {
  /** Index in the messages array. */
  messageIndex: number;
  /** Tool name (from the preceding tool_call or the tool message itself). */
  toolName: string;
  /** Tool text plus the model-token-equivalent image cost. */
  outputLength: number;
  imageCostChars: number;
  attachmentMessageIndex?: number;
  reference: string;
}

/**
 * Collect all compactable tool_result entries from the message list.
 * Returns them in encounter order (oldest first).
 */
function collectCompactableToolResults(
  messages: UnifiedMessage[],
  config: MicrocompactConfig,
): ToolResultCandidate[] {
  const candidates: ToolResultCandidate[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg || msg.role !== 'tool') continue;

    const toolName = msg.toolName ?? '';
    // Skip if tool is protected
    if (config.protectedTools.has(toolName)) continue;
    // Only compact tools in the compactable set (if set is non-empty)
    if (config.compactableTools.size > 0 && !config.compactableTools.has(toolName)) continue;

    const attachmentMessageIndex = messages.findIndex(
      (candidate) =>
        candidate.role === 'user' &&
        candidate.syntheticKind === 'tool-attachments' &&
        candidate.sourceToolCallId === msg.toolCallId,
    );
    const attachmentCandidate = messages[attachmentMessageIndex];
    const attachment = attachmentCandidate?.role === 'user' ? attachmentCandidate : undefined;
    const legacyNext = messages[i + 1];
    const linkedAttachment =
      attachment ??
      (legacyNext?.role === 'user' && legacyNext.content === TOOL_ATTACHMENT_MESSAGE
        ? legacyNext
        : undefined);
    const imageCount = linkedAttachment?.images?.length ?? 0;
    const imageUrlChars = linkedAttachment?.images?.reduce(
      (sum, image) => sum + (image.imageUrl?.length ?? 0),
      0,
    );
    const imageCostChars = Math.max(
      imageCount *
        DEFAULT_TOOL_CONTEXT_POLICY.estimatedImageTokens *
        DEFAULT_TOOL_CONTEXT_POLICY.charsPerToken,
      imageUrlChars ?? 0,
    );
    const outputLength = msg.content.length + imageCostChars;
    // Skip already-cleared results
    if (outputLength <= MICROCOMPACT_CLEARED_PLACEHOLDER.length + 10) continue;

    if (msg.content.startsWith('[tool_output_reference] {"microcompacted":true,')) continue;
    const reference = `[tool_output_reference] ${JSON.stringify({
      microcompacted: true,
      ...buildToolOutputReferenceIdentity(msg.toolCallId),
      retrievalTool: 'read_tool_output',
      preview: msg.content.slice(0, 80),
      ...(imageCount > 0 ? { omittedImageCount: imageCount } : {}),
    })}`;
    candidates.push({
      messageIndex: i,
      toolName,
      outputLength,
      imageCostChars,
      reference,
      ...(attachmentMessageIndex >= 0 ? { attachmentMessageIndex } : {}),
    });
  }

  return candidates;
}

/**
 * The caller provides the persisted timestamp of the last assistant message.
 */
function shouldTimeBasedTrigger(
  config: MicrocompactConfig,
  lastAssistantTimestamp: number | undefined,
): boolean {
  if (
    !config.timeBasedEnabled ||
    lastAssistantTimestamp === undefined ||
    !Number.isFinite(lastAssistantTimestamp)
  ) {
    return false;
  }
  const gapMs = Date.now() - lastAssistantTimestamp;
  const gapMinutes = gapMs / 60_000;
  return gapMinutes >= config.timeGapThresholdMinutes;
}

/**
 * Apply microcompact to a UnifiedMessage array.
 *
 * Does NOT mutate the input — returns a new array with cleared tool outputs.
 *
 * @param messages - The conversation messages (after filterCompacted + toModelMessages)
 * @param configOverrides - Optional partial config overrides
 * @param context - Optional context for time-based triggering
 */
export function microcompactMessages(
  messages: UnifiedMessage[],
  configOverrides?: Partial<MicrocompactConfig>,
  context?: { lastAssistantTimestamp?: number } & ToolContextPolicyInput,
): MicrocompactResult & { messages: UnifiedMessage[] } {
  const config: MicrocompactConfig = {
    ...DEFAULT_MICROCOMPACT_CONFIG,
    maxOutputChars: resolveToolContextPolicy(context).maxTotalToolCostChars,
    ...configOverrides,
  };

  const candidates = collectCompactableToolResults(messages, config);
  const beforeChars = candidates.reduce((sum, candidate) => sum + candidate.outputLength, 0);
  const largestResultChars = Math.max(0, ...candidates.map((candidate) => candidate.outputLength));
  const unchangedMetrics = buildMetrics({
    afterChars: beforeChars,
    beforeChars,
    largestResultChars,
  });

  if (!config.enabled) {
    return {
      applied: false,
      clearedCount: 0,
      tokensSaved: 0,
      trigger: 'none',
      messages,
      metrics: unchangedMetrics,
    };
  }

  if (candidates.length === 0) {
    return {
      applied: false,
      clearedCount: 0,
      tokensSaved: 0,
      trigger: 'none',
      messages,
      metrics: unchangedMetrics,
    };
  }

  // ── Determine trigger mode ──

  let trigger: MicrocompactResult['trigger'] = 'none';
  let keepCount = candidates.length;

  if (shouldTimeBasedTrigger(config, context?.lastAssistantTimestamp)) {
    trigger = 'time';
    keepCount = config.timeBasedKeepRecent;
  } else if (candidates.length > config.triggerThreshold) {
    trigger = 'count';
    keepCount = config.keepRecent;
  }

  // ── Determine which candidates to clear ──

  const keepSet = new Set(candidates.slice(-Math.max(1, keepCount)).map((c) => c.messageIndex));
  const clearIndices = new Set(
    candidates
      .filter(
        (candidate) =>
          !keepSet.has(candidate.messageIndex) &&
          candidate.reference.length < candidate.outputLength,
      )
      .map((candidate) => candidate.messageIndex),
  );
  let retainedChars = candidates.reduce(
    (sum, candidate) =>
      sum +
      (clearIndices.has(candidate.messageIndex)
        ? candidate.reference.length
        : candidate.outputLength),
    0,
  );
  const omitAttachmentAfter = new Set<number>();
  for (const candidate of candidates) {
    if (retainedChars <= config.maxOutputChars) break;
    const isLatest = candidate === candidates.at(-1);
    if (isLatest && candidate.imageCostChars > 0) {
      omitAttachmentAfter.add(candidate.messageIndex);
      retainedChars -= candidate.imageCostChars;
      if (trigger === 'none') trigger = 'budget';
      continue;
    }
    if (
      isLatest ||
      clearIndices.has(candidate.messageIndex) ||
      candidate.reference.length >= candidate.outputLength
    )
      continue;
    clearIndices.add(candidate.messageIndex);
    retainedChars -= candidate.outputLength - candidate.reference.length;
    if (trigger === 'none') trigger = 'budget';
  }
  const toClear = candidates.filter((candidate) => clearIndices.has(candidate.messageIndex));

  if (toClear.length === 0 && omitAttachmentAfter.size === 0) {
    return {
      applied: false,
      clearedCount: 0,
      tokensSaved: 0,
      trigger,
      messages,
      metrics: unchangedMetrics,
    };
  }

  // ── Apply clearing (immutable) ──

  const references = new Map(
    toClear.map((candidate) => [candidate.messageIndex, candidate.reference]),
  );
  const attachmentIndicesToRemove = new Set(
    candidates.flatMap((candidate) =>
      candidate.attachmentMessageIndex !== undefined &&
      (clearIndices.has(candidate.messageIndex) || omitAttachmentAfter.has(candidate.messageIndex))
        ? [candidate.attachmentMessageIndex]
        : [],
    ),
  );
  let tokensSaved = 0;

  const newMessages = messages.flatMap((msg, index): UnifiedMessage[] => {
    if (
      (attachmentIndicesToRemove.has(index) ||
        clearIndices.has(index - 1) ||
        omitAttachmentAfter.has(index - 1)) &&
      msg.role === 'user' &&
      (msg.syntheticKind === 'tool-attachments' || msg.content === TOOL_ATTACHMENT_MESSAGE) &&
      msg.images &&
      msg.images.length > 0
    )
      return [];
    if (!clearIndices.has(index)) return [msg];
    if (msg.role !== 'tool') return [msg];

    const reference = references.get(index);
    if (!reference) return [msg];
    tokensSaved += Math.max(0, Math.ceil((msg.content.length - reference.length) / 4));
    return [{ ...msg, content: reference }];
  });

  return {
    applied: true,
    clearedCount: toClear.length,
    tokensSaved,
    trigger,
    messages: newMessages,
    metrics: buildMetrics({
      afterChars: retainedChars,
      beforeChars,
      imagesOmitted: attachmentIndicesToRemove.size,
      largestResultChars,
    }),
  };
}
