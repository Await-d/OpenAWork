import type { Message, MessageContent } from '@openAwork/shared';
import {
  mergePersistedCompactionMemory,
  readLastCompactionLlmSummary,
  readPersistedCompactionMemory,
  renderPersistedCompactionMemory,
  type CompactionSummaryFields,
  type CompactionTrigger,
  type PersistedCompactionMemory,
} from '../compaction/compaction-metadata.js';
import {
  extractToolResultContentsFromMessage,
  listStoredToolResults,
  normalizeToolArgumentsForStorage,
  stringifyToolResultOutput,
} from '../tools/tool-result-contract.js';
import {
  isCompactionMarkerMessageWithOptions,
  readLatestCompactionMarkerWithOptions,
} from '../compaction/compaction-marker.js';

// `NormalizedConversationMessage` was historically defined in
// `./normalized-conversation.ts` together with the v1 wire shape
// (`UpstreamChatMessage`). After the v2-only cutover only the
// normalized intermediate type is still needed — the rest of the
// pipeline is owned by `UnifiedMessage` (in `message-to-model-messages.ts`)
// which is structurally compatible with this shape. The type is
// inlined here so we can delete the legacy module.
export type NormalizedConversationMessage =
  | { role: 'system' | 'user'; content: string }
  | {
      role: 'assistant';
      content: string | null;
      toolCalls?: Array<{ id: string; name: string; arguments: string }>;
      reasoning?: {
        text?: string;
        encryptedContent?: string;
        summary?: string;
        responseId?: string;
      };
    }
  | { role: 'tool'; toolCallId: string; content: string };

const MAX_INLINE_TOOL_OUTPUT_BYTES = 8 * 1024;
const MAX_EXTRACTED_TOOL_TEXT_CHARS = 8_000;
const INTERNAL_ASSISTANT_EVENT_SOURCE = 'openawork_internal';
const INTERNAL_CLIENT_REQUEST_ID_KEY = '__openAworkClientRequestId';
const COMPACTION_MARKER_TYPE = 'compaction_marker';

export interface PreparedUpstreamConversationReport {
  /** 被 artifact 过滤掉的消息数（message 级） */
  artifactFilteredCount: number;
  /** assistant content 中的 tool_call 数（content 级） */
  assistantToolCallCount: number;
  /** 被过滤掉的 assistant UI event text 数（content 级） */
  assistantUiEventFilteredCount: number;
  /** 是否注入了 compaction summary system message（布尔） */
  compactSummaryInjected: boolean;
  /** 被 compaction boundary 裁掉的 message 数（message 级） */
  boundaryTrimmedMessageCount: number;
  /** compaction boundary 之后剩余的历史消息数（message 级） */
  historySinceBoundaryCount: number;
  /** 原始输入消息数（message 级） */
  inputMessageCount: number;
  /** 被注入到 assistant 上下文中的 modified_files_summary 条目数（content 级） */
  modifiedFilesSummaryInjectedCount: number;
  /** artifact 过滤后的消息数（message 级） */
  normalizedMessageCount: number;
  /** 被 reference 化的大 tool_result 数（content 级） */
  referencedToolOutputCount: number;
  /** safe window 裁掉的消息数（message 级） */
  safeWindowTrimmedMessageCount: number;
  /** 最终参与 buildNormalizedConversationFromHistory 的历史消息数（message 级） */
  selectedHistoryCount: number;
  /** tool_result content 数（content 级） */
  toolResultCount: number;
}

export interface PreparedUpstreamConversation {
  normalizedMessages: NormalizedConversationMessage[];
  compactionSummary: string | null;
  report?: PreparedUpstreamConversationReport;
}

export interface BuildPreparedUpstreamConversationOptions {
  contextWindow?: number;
  llmCompactionSummary?: string;
  maxMessages?: number;
  metadataJson?: string;
  persistedMemory?: PersistedCompactionMemory | null;
}

export interface ResolvedCompactionContext {
  marker: CompactionMarkerRecord | null;
  markerPresent: boolean;
  persistedMemory: PersistedCompactionMemory | null;
  summary?: string;
  summarySource: 'fallback' | 'marker' | 'none';
}

export interface DurableCompactionSummary {
  newlySummarizedMessages: number;
  persistedMemory: PersistedCompactionMemory;
  signature: string;
  structuredSummary: string;
  totalRepresentedMessages: number;
}

export interface CompactionMarkerRecord {
  omittedMessages?: number;
  persistedMemory?: PersistedCompactionMemory | null;
  signature?: string;
  summary: string;
  trigger: string;
}

export function isAssistantUiEventText(value: string): boolean {
  const normalized = value.trim();
  if (!normalized.startsWith('{') || !normalized.endsWith('}')) {
    return false;
  }

  try {
    const parsed = JSON.parse(normalized) as { source?: unknown; type?: unknown };
    return parsed.type === 'assistant_event' && parsed.source === INTERNAL_ASSISTANT_EVENT_SOURCE;
  } catch {
    return false;
  }
}

function isAssistantUiEventMessage(message: Message): boolean {
  if (message.role !== 'assistant' || message.content.length === 0) {
    return false;
  }

  return message.content.every(
    (content) => content.type === 'text' && isAssistantUiEventTextForMessage(content.text, message),
  );
}

function isAssistantUiEventTextForMessage(value: string, message: Message): boolean {
  if (isAssistantUiEventText(value)) {
    return true;
  }

  const clientRequestId = (message as Message & { [INTERNAL_CLIENT_REQUEST_ID_KEY]?: unknown })[
    INTERNAL_CLIENT_REQUEST_ID_KEY
  ];
  if (typeof clientRequestId !== 'string') {
    return false;
  }

  if (
    !clientRequestId.startsWith('assistant_event:') &&
    !clientRequestId.startsWith('task-reminder:')
  ) {
    return false;
  }

  const normalized = value.trim();
  if (!normalized.startsWith('{') || !normalized.endsWith('}')) {
    return false;
  }

  try {
    const parsed = JSON.parse(normalized) as { type?: unknown };
    return parsed.type === 'assistant_event';
  } catch {
    return false;
  }
}

function isCompactionMarkerMessage(message: Message): boolean {
  return isCompactionMarkerMessageWithOptions(message, {
    source: INTERNAL_ASSISTANT_EVENT_SOURCE,
    markerType: COMPACTION_MARKER_TYPE,
  });
}

function readLatestCompactionMarker(messages: Message[]): CompactionMarkerRecord | null {
  return readLatestCompactionMarkerWithOptions(messages, {
    source: INTERNAL_ASSISTANT_EVENT_SOURCE,
    markerType: COMPACTION_MARKER_TYPE,
  });
}

export function hasCompactionMarker(messages: Message[]): boolean {
  return readLatestCompactionMarker(messages) !== null;
}

export function resolveCompactionContext(input: {
  llmCompactionSummary?: string;
  messages: Message[];
  metadataJson?: string;
  persistedMemory?: PersistedCompactionMemory | null;
}): ResolvedCompactionContext {
  const marker = readLatestCompactionMarker(input.messages);
  if (marker) {
    const summary = marker.summary.trim().length > 0 ? marker.summary : undefined;
    return {
      marker,
      markerPresent: true,
      persistedMemory: marker.persistedMemory ?? null,
      ...(summary ? { summary } : {}),
      summarySource: summary ? 'marker' : 'none',
    };
  }

  const fallbackSummary =
    input.llmCompactionSummary ??
    (input.metadataJson ? readLastCompactionLlmSummary(input.metadataJson) : undefined);
  const fallbackMemory =
    input.persistedMemory ??
    (input.metadataJson ? readPersistedCompactionMemory(input.metadataJson) : null);

  return {
    marker: null,
    markerPresent: false,
    persistedMemory: fallbackMemory,
    ...(fallbackSummary && fallbackSummary.trim().length > 0
      ? { summary: fallbackSummary, summarySource: 'fallback' as const }
      : { summarySource: 'none' as const }),
  };
}

function isCommandCardPayload(value: string): boolean {
  const normalized = value.trim();
  if (!normalized.startsWith('{') || !normalized.endsWith('}')) {
    return false;
  }

  try {
    const parsed = JSON.parse(normalized) as { type?: unknown; payload?: unknown };
    return (
      typeof parsed.type === 'string' &&
      typeof parsed.payload === 'object' &&
      parsed.payload !== null
    );
  } catch {
    return false;
  }
}

function isCommandCardMessage(message: Message): boolean {
  if (message.role !== 'assistant' || message.content.length === 0) {
    return false;
  }

  const clientRequestId = (message as Message & { [INTERNAL_CLIENT_REQUEST_ID_KEY]?: unknown })[
    INTERNAL_CLIENT_REQUEST_ID_KEY
  ];
  if (typeof clientRequestId !== 'string' || !clientRequestId.startsWith('command-card:')) {
    return false;
  }

  return message.content.every(
    (content) => content.type === 'text' && isCommandCardPayload(content.text),
  );
}

function isContextArtifactMessage(message: Message): boolean {
  return (
    isAssistantUiEventMessage(message) ||
    isCommandCardMessage(message) ||
    isCompactionMarkerMessage(message)
  );
}

export function filterVisibleSessionMessages(messages: Message[]): Message[] {
  return messages.filter((message) => !isCompactionMarkerMessage(message));
}

/**
 * Microcompact: replace tool_result content for messages older than the threshold.
 * This is a lightweight token-reduction step that runs before every API round,
 * clearing stale tool outputs while keeping recent ones intact.
 * Returns a new array (does not mutate input).
 *
 * @deprecated In the new pipeline (toModelMessages + ProviderAdapter),
 * tool result stripping is handled at output time via the `stripOldToolResults`
 * option, which does not mutate the DB source data. This function is kept
 * for backward compatibility with the old pipeline path.
 */
export const MICROCOMPACT_AGE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Token budget thresholds for `pruneToolResultsByTokenBudget`. Mirrors
 * opencode's `PRUNE_PROTECT` / `PRUNE_MINIMUM` (`session/compaction.ts`).
 *
 * The walker preserves the most-recent `PRUNE_PROTECT` tokens worth of
 * tool_result outputs verbatim and only rewrites older ones once at
 * least `PRUNE_MINIMUM` tokens of older content have accumulated —
 * preventing churn on small histories.
 */
export const PRUNE_PROTECT_TOKENS = 40_000;
export const PRUNE_MINIMUM_TOKENS = 20_000;

/**
 * Tool names whose outputs should never be pruned regardless of age
 * or token budget. Matches opencode's `PRUNE_PROTECTED_TOOLS`.
 */
export const PRUNE_PROTECTED_TOOLS: ReadonlySet<string> = new Set(['skill']);

const PRUNED_TOOL_RESULT_PLACEHOLDER = '[Old tool result content cleared by token-budget prune]';

function approximateTokens(value: string): number {
  return Math.ceil(value.length / 4);
}

/**
 * Token-budget-aware prune over `tool_result` outputs.
 *
 * Walks messages from newest to oldest, accumulating an estimate of
 * tokens consumed by tool_result outputs. Once the running total
 * exceeds `protectTokens`, every older tool_result whose `toolName`
 * is not in `protectedTools` has its `output` replaced with a short
 * placeholder. Returns a new array; does **not** mutate the input.
 *
 * Mirrors opencode's `session/compaction.ts:prune()` but operates on
 * the in-memory message list at request time instead of mutating
 * persisted parts. This keeps DB content intact while still saving
 * tokens on the wire.
 */
export function pruneToolResultsByTokenBudget(
  messages: Message[],
  options: {
    protectTokens?: number;
    minimumTokens?: number;
    protectedTools?: ReadonlySet<string>;
  } = {},
): Message[] {
  const protectTokens = options.protectTokens ?? PRUNE_PROTECT_TOKENS;
  const minimumTokens = options.minimumTokens ?? PRUNE_MINIMUM_TOKENS;
  const protectedTools = options.protectedTools ?? PRUNE_PROTECTED_TOOLS;

  // Map tool_call IDs to their tool names so the prune step knows
  // which results belong to a protected tool.
  const toolNameByCallId = new Map<string, string>();
  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    for (const content of message.content) {
      if (content.type === 'tool_call') {
        toolNameByCallId.set(content.toolCallId, content.toolName);
      }
    }
  }

  // First pass: walk newest → oldest, mark tool_result keys to prune.
  let runningTokens = 0;
  let prunedTokens = 0;
  const toPrune = new Set<string>();
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex--) {
    const message = messages[messageIndex];
    if (!message) continue;
    for (let contentIndex = message.content.length - 1; contentIndex >= 0; contentIndex--) {
      const content = message.content[contentIndex];
      if (!content || content.type !== 'tool_result') continue;
      const toolName = toolNameByCallId.get(content.toolCallId);
      if (toolName && protectedTools.has(toolName)) continue;
      const outputText = typeof content.output === 'string' ? content.output : '';
      const tokens = approximateTokens(outputText);
      runningTokens += tokens;
      if (runningTokens <= protectTokens) continue;
      prunedTokens += tokens;
      toPrune.add(`${messageIndex}:${contentIndex}`);
    }
  }

  // No-op when we would not free enough tokens to be worthwhile.
  if (prunedTokens < minimumTokens || toPrune.size === 0) return messages;

  return messages.map((message, messageIndex) => ({
    ...message,
    content: message.content.map((content, contentIndex) => {
      if (content.type !== 'tool_result') return content;
      if (!toPrune.has(`${messageIndex}:${contentIndex}`)) return content;
      return { ...content, output: PRUNED_TOOL_RESULT_PLACEHOLDER };
    }),
  }));
}

export function microcompactByAge(
  messages: Message[],
  options: { ageThresholdMs?: number; now?: number } = {},
): Message[] {
  const threshold = options.ageThresholdMs ?? MICROCOMPACT_AGE_THRESHOLD_MS;
  const now = options.now ?? Date.now();
  const placeholder = '[Old tool result content cleared by microcompact]';

  return messages.map((message) => {
    const age = now - message.createdAt;
    if (age < threshold) return message;

    return {
      ...message,
      content: message.content.map((content) => {
        if (content.type !== 'tool_result') return content;
        return { ...content, output: placeholder };
      }),
    };
  });
}

export function buildPreparedUpstreamConversation(
  messages: Message[],
  options: number | BuildPreparedUpstreamConversationOptions = 12,
): PreparedUpstreamConversation {
  const maxMessages = typeof options === 'number' ? options : (options.maxMessages ?? 12);
  const contextWindow =
    typeof options === 'number' ? undefined : (options.contextWindow ?? 128_000);
  const compactionContext = resolveCompactionContext({
    messages,
    ...(typeof options === 'number'
      ? {}
      : {
          llmCompactionSummary: options.llmCompactionSummary,
          metadataJson: options.metadataJson,
          persistedMemory: options.persistedMemory,
        }),
  });
  // Only filter out UI events and command cards — compaction markers are kept
  // so that filterCompactedMessages can use them as boundaries
  const filteredMessages = messages.filter(
    (message) => !isAssistantUiEventMessage(message) && !isCommandCardMessage(message),
  );
  const historySinceBoundary = filterCompactedMessages(
    filteredMessages,
    compactionContext.persistedMemory,
    compactionContext.summary,
  );
  const history =
    contextWindow && contextWindow > 0
      ? historySinceBoundary
      : selectSafeConversationWindow(historySinceBoundary, maxMessages);
  // P3: Microcompact — clear old tool_result content to save tokens
  // Time-based first (cheap, ages-out long-idle outputs), then the
  // opencode-style token-budget prune that protects the freshest
  // PRUNE_PROTECT_TOKENS worth of tool_result outputs and rewrites
  // older ones — but only when the savings exceed PRUNE_MINIMUM_TOKENS
  // so very short conversations are unaffected.
  const microcompactedHistory = pruneToolResultsByTokenBudget(microcompactByAge(history));
  const normalizedMessages = buildNormalizedConversationFromHistory(microcompactedHistory);
  const compactSummaryInjected = compactionContext.summarySource === 'fallback';

  // If there is a compaction summary but no compaction marker in the message
  // list (e.g. marker was filtered or summary comes from metadataJson), inject
  // the summary as a user+assistant pair at the beginning of the conversation
  // flow, following the opencode pattern.
  const hasMarkerInHistory = microcompactedHistory.some((msg) => isCompactionMarkerMessage(msg));
  const finalNormalizedMessages = [...normalizedMessages];
  if (compactSummaryInjected && !hasMarkerInHistory && compactionContext.summary) {
    finalNormalizedMessages.unshift(
      { role: 'user', content: 'What did we do so far?' },
      { role: 'assistant', content: compactionContext.summary },
    );
  }
  const report = buildPreparedUpstreamConversationReport({
    compactSummaryInjected,
    history,
    historySinceBoundary,
    inputMessages: messages,
    normalizedMessages: filteredMessages,
  });

  return {
    normalizedMessages: finalNormalizedMessages,
    // Compaction summary is now injected into the conversation flow as
    // user+assistant message pair (opencode pattern), not as a system message.
    compactionSummary: null,
    report,
  };
}

function buildPreparedUpstreamConversationReport(input: {
  compactSummaryInjected: boolean;
  history: Message[];
  historySinceBoundary: Message[];
  inputMessages: Message[];
  normalizedMessages: Message[];
}): PreparedUpstreamConversationReport {
  const storedToolResults = listStoredToolResults(input.history);
  const assistantToolCallCount = input.history.reduce((count, message) => {
    if (message.role !== 'assistant') {
      return count;
    }

    return count + message.content.filter((content) => content.type === 'tool_call').length;
  }, 0);
  const assistantUiEventFilteredCount = input.history.reduce((count, message) => {
    if (message.role !== 'assistant') {
      return count;
    }

    return (
      count +
      message.content.filter(
        (content) =>
          content.type === 'text' && isAssistantUiEventTextForMessage(content.text, message),
      ).length
    );
  }, 0);
  const modifiedFilesSummaryInjectedCount = input.history.reduce((count, message) => {
    return (
      count + message.content.filter((content) => content.type === 'modified_files_summary').length
    );
  }, 0);
  const toolResultCount = storedToolResults.length;
  const referencedToolOutputCount = storedToolResults.filter((result) =>
    shouldReferenceToolOutput(result.output),
  ).length;

  return {
    inputMessageCount: input.inputMessages.length,
    normalizedMessageCount: input.normalizedMessages.length,
    artifactFilteredCount: input.inputMessages.length - input.normalizedMessages.length,
    historySinceBoundaryCount: input.historySinceBoundary.length,
    boundaryTrimmedMessageCount:
      input.normalizedMessages.length - input.historySinceBoundary.length,
    selectedHistoryCount: input.history.length,
    safeWindowTrimmedMessageCount: input.historySinceBoundary.length - input.history.length,
    compactSummaryInjected: input.compactSummaryInjected,
    assistantUiEventFilteredCount,
    modifiedFilesSummaryInjectedCount,
    toolResultCount,
    referencedToolOutputCount,
    assistantToolCallCount,
  };
}

export function isContextOverflow(
  usage: {
    inputTokens: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  },
  contextWindow: number,
  reserved?: number,
  /** Model's max output token limit from preset. When provided, mirrors
   *  opencode's `usable = context - maxOutputTokens` formula exactly. */
  modelMaxOutputTokens?: number,
): boolean {
  if (contextWindow <= 0) {
    return false;
  }

  // Mirrors opencode's overflow.ts:
  //   maxOutputTokens = min(model.limit.output, OUTPUT_TOKEN_MAX=32_000)
  //   reserved = config.compaction?.reserved ?? min(COMPACTION_BUFFER=20_000, maxOutputTokens)
  //   usable = model.limit.input
  //     ? max(0, model.limit.input - reserved)
  //     : max(0, context - maxOutputTokens)
  //   isOverflow = totalTokens >= usable
  //
  // When `reserved` is explicitly provided (user's compaction.reserved setting),
  // it acts as the buffer directly (matching opencode's cfg.compaction.reserved path).
  // Otherwise we derive from model output limit.
  const OUTPUT_TOKEN_MAX = 32_000;
  const _COMPACTION_BUFFER = 20_000;
  const effectiveMaxOutput = Math.min(modelMaxOutputTokens ?? OUTPUT_TOKEN_MAX, OUTPUT_TOKEN_MAX);

  let usable: number;
  if (reserved !== undefined) {
    // User-configured reserved: subtract directly from contextWindow
    usable = Math.max(0, contextWindow - reserved);
  } else {
    // Default path: usable = context - maxOutputTokens (opencode formula)
    usable = Math.max(0, contextWindow - effectiveMaxOutput);
  }

  // opencode counts total = input + output + cache.read + cache.write
  const totalTokens =
    usage.inputTokens +
    (usage.outputTokens ?? 0) +
    (usage.cacheReadTokens ?? 0) +
    (usage.cacheWriteTokens ?? 0);
  return totalTokens >= usable;
}

/** Proactive compaction threshold: trigger before overflow.
 * Uses a larger buffer so compaction runs while there is still room
 * for the next API round. Mirrors oh-my-opencode's 70% warning threshold
 * (CONTEXT_WARNING_THRESHOLD = 0.70). */
export const PROACTIVE_COMPACTION_BUFFER_TOKENS = 30_000;

export function isContextNearOverflow(
  usage: {
    inputTokens: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  },
  contextWindow: number,
  reserved?: number,
  modelMaxOutputTokens?: number,
): boolean {
  if (contextWindow <= 0) {
    return false;
  }

  // Proactive threshold mirrors oh-my-opencode's CONTEXT_WARNING_THRESHOLD = 0.70:
  // trigger compaction when usage reaches 70-75% of usable context.
  const OUTPUT_TOKEN_MAX = 32_000;
  const effectiveMaxOutput = Math.min(modelMaxOutputTokens ?? OUTPUT_TOKEN_MAX, OUTPUT_TOKEN_MAX);

  let usable: number;
  if (reserved !== undefined) {
    usable = Math.max(0, contextWindow - reserved);
  } else {
    usable = Math.max(0, contextWindow - effectiveMaxOutput);
  }

  const buffer =
    reserved ?? Math.max(PROACTIVE_COMPACTION_BUFFER_TOKENS, Math.floor(usable * 0.25));
  const totalTokens =
    usage.inputTokens +
    (usage.outputTokens ?? 0) +
    (usage.cacheReadTokens ?? 0) +
    (usage.cacheWriteTokens ?? 0);
  return totalTokens >= usable - buffer;
}

export function buildNormalizedConversationFromHistory(
  messages: Message[],
): NormalizedConversationMessage[] {
  const normalizedMessages: NormalizedConversationMessage[] = [];
  const emittedToolResultIds = new Set<string>();

  const pushToolResult = (content: Extract<MessageContent, { type: 'tool_result' }>) => {
    if (emittedToolResultIds.has(content.toolCallId)) {
      return;
    }
    emittedToolResultIds.add(content.toolCallId);
    normalizedMessages.push({
      role: 'tool',
      toolCallId: content.toolCallId,
      content: serializeToolOutput({
        isError: content.isError,
        output: content.output,
        rawOutput: content.rawOutput,
        toolCallId: content.toolCallId,
      }),
    });
  };

  messages.forEach((message) => {
    // Handle compaction marker: convert to opencode-style user+assistant pair
    // In opencode, a compaction boundary is:
    //   user message with compaction part → "What did we do so far?"
    //   assistant message with summary: true → the actual summary text
    if (isCompactionMarkerMessage(message)) {
      const markerRecord = readLatestCompactionMarker([message]);
      if (markerRecord && markerRecord.summary.trim().length > 0) {
        // Inject as user+assistant pair in conversation flow
        normalizedMessages.push({
          role: 'user',
          content: 'What did we do so far?',
        });
        normalizedMessages.push({
          role: 'assistant',
          content: markerRecord.summary,
        });
      }
      return;
    }

    const toolResults = extractToolResultContentsFromMessage(message);

    const textContent = message.content
      .filter(
        (content): content is Extract<MessageContent, { type: 'text' }> =>
          content.type === 'text' &&
          (message.role !== 'assistant' ||
            !isAssistantUiEventTextForMessage(content.text, message)),
      )
      .map((content) => content.text)
      .join('\n')
      .trim();

    if (message.role === 'assistant') {
      const toolCalls = message.content.flatMap((content) => {
        if (content.type !== 'tool_call') return [];
        return [
          {
            id: content.toolCallId,
            type: 'function' as const,
            function: {
              name: content.toolName,
              arguments: normalizeToolArgumentsForStorage(content.rawArguments ?? content.input),
            },
          },
        ];
      });
      // Extract reasoning content for Responses API multi-turn support.
      const reasoningContents = message.content.filter(
        (content): content is Extract<MessageContent, { type: 'reasoning' }> =>
          content.type === 'reasoning',
      );
      const trimmedReasoningText = reasoningContents
        .map((content) => content.text.trim())
        .filter((text) => text.length > 0)
        .join('\n\n');
      const reasoningEncryptedContent = reasoningContents.find(
        (content) =>
          typeof content.encryptedContent === 'string' && content.encryptedContent.length > 0,
      )?.encryptedContent;
      const reasoningSummary = [
        ...new Set(
          reasoningContents
            .map((content) => content.summary?.trim() ?? '')
            .filter((summary) => summary.length > 0),
        ),
      ].join('\n\n');
      const reasoning =
        reasoningContents.length > 0 &&
        (trimmedReasoningText.length > 0 ||
          Boolean(reasoningEncryptedContent) ||
          reasoningSummary.length > 0)
          ? {
              text: trimmedReasoningText,
              ...(reasoningEncryptedContent ? { encryptedContent: reasoningEncryptedContent } : {}),
              ...(reasoningSummary.length > 0 ? { summary: reasoningSummary } : {}),
            }
          : undefined;

      if (toolCalls.length > 0 || textContent.length > 0 || reasoning) {
        normalizedMessages.push({
          role: 'assistant',
          content: textContent.length > 0 ? textContent : null,
          ...(toolCalls.length > 0
            ? {
                toolCalls: toolCalls.map((toolCall) => ({
                  id: toolCall.id,
                  name: toolCall.function.name,
                  arguments: toolCall.function.arguments,
                })),
              }
            : {}),
          ...(reasoning ? { reasoning } : {}),
        });
      }
    }

    if ((message.role === 'user' || message.role === 'system') && textContent.length > 0) {
      normalizedMessages.push({ role: message.role, content: textContent });
    }

    toolResults.forEach((content) => pushToolResult(content));
  });

  return normalizedMessages;
}

export function buildStructuredCompactionSummary(input: {
  messages: Message[];
  recentMessagesKept: number;
  trigger: 'automatic' | 'manual';
}): string {
  const fields = buildCompactionSummaryFields(input.messages);

  return [
    `Structured summary of earlier conversation history (${input.trigger} compaction).`,
    `- Summarized messages: ${input.messages.length}`,
    `- Recent verbatim messages kept: ${input.recentMessagesKept}`,
    '',
    formatSummarySection('User goals', fields.userGoals),
    '',
    formatSummarySection('Assistant progress and decisions', fields.assistantProgress),
    '',
    formatSummarySection('Tool activity', fields.toolActivity),
    '',
    formatSummarySection('Files referenced', fields.filesReferenced),
    '',
    formatSummarySection(
      'Latest summarized user request',
      fields.latestUserRequest ? [fields.latestUserRequest] : [],
    ),
  ]
    .join('\n')
    .trim();
}

export function buildCompactionSummaryFields(messages: Message[]): CompactionSummaryFields {
  const normalizedMessages = messages.filter((message) => !isContextArtifactMessage(message));
  const latestUserRequest = collectCompactSummaryLines(
    normalizedMessages
      .filter((message) => message.role === 'user')
      .slice(-1)
      .map((message) => summarizeCompactMessage(message)),
    1,
  )[0];

  return {
    userGoals: collectCompactSummaryLines(
      normalizedMessages
        .filter((message) => message.role === 'user')
        .map((message) => summarizeCompactMessage(message)),
      3,
    ),
    assistantProgress: collectCompactSummaryLines(
      normalizedMessages
        .filter((message) => message.role === 'assistant')
        .map((message) => summarizeCompactMessage(message)),
      4,
    ),
    toolActivity: collectToolActivitySummary(normalizedMessages),
    filesReferenced: collectModifiedFilesForSummary(normalizedMessages),
    ...(latestUserRequest ? { latestUserRequest } : {}),
  };
}

export function buildDurableCompactionSummary(input: {
  existingMemory?: PersistedCompactionMemory | null;
  messages: Message[];
  recentMessagesKept: number;
  trigger: CompactionTrigger;
}): DurableCompactionSummary | null {
  const normalizedMessages = input.messages.filter((message) => !isContextArtifactMessage(message));
  if (normalizedMessages.length === 0) {
    return null;
  }

  const { deltaMessages, effectiveExistingMemory } = resolveCompactionDeltaMessages(
    normalizedMessages,
    input.existingMemory ?? null,
  );
  const coveredUntilMessageId =
    deltaMessages.at(-1)?.id ??
    effectiveExistingMemory?.coveredUntilMessageId ??
    normalizedMessages.at(-1)?.id;

  if (!coveredUntilMessageId) {
    return null;
  }

  const signature = buildCompactionSignature({
    coveredUntilMessageId,
    previousCoveredUntilMessageId: effectiveExistingMemory?.coveredUntilMessageId,
    recentMessagesKept: input.recentMessagesKept,
    representedMessages: normalizedMessages.length,
  });
  const newlySummarizedMessages =
    deltaMessages.length > 0
      ? deltaMessages.length
      : effectiveExistingMemory
        ? 0
        : normalizedMessages.length;
  const persistedMemory =
    deltaMessages.length > 0 || !effectiveExistingMemory
      ? mergePersistedCompactionMemory(effectiveExistingMemory, {
          coveredUntilMessageId,
          fields: buildCompactionSummaryFields(
            deltaMessages.length > 0 ? deltaMessages : normalizedMessages,
          ),
          newlySummarizedMessages,
          signature,
          trigger: input.trigger,
        })
      : effectiveExistingMemory;

  return {
    newlySummarizedMessages,
    persistedMemory,
    signature,
    structuredSummary: renderPersistedCompactionMemory({
      memory: persistedMemory,
      omittedMessages: normalizedMessages.length,
      recentMessagesKept: input.recentMessagesKept,
      trigger: input.trigger,
    }),
    totalRepresentedMessages: normalizedMessages.length,
  };
}

function resolveCompactionDeltaMessages(
  messages: Message[],
  existingMemory: PersistedCompactionMemory | null,
): {
  deltaMessages: Message[];
  effectiveExistingMemory: PersistedCompactionMemory | null;
} {
  if (!existingMemory) {
    return { deltaMessages: messages, effectiveExistingMemory: null };
  }

  const coveredIndex = messages.findIndex(
    (message) => message.id === existingMemory.coveredUntilMessageId,
  );
  if (coveredIndex === -1) {
    return { deltaMessages: messages, effectiveExistingMemory: null };
  }

  return {
    deltaMessages: messages.slice(coveredIndex + 1),
    effectiveExistingMemory: existingMemory,
  };
}

function buildCompactionSignature(input: {
  coveredUntilMessageId: string;
  previousCoveredUntilMessageId?: string;
  recentMessagesKept: number;
  representedMessages: number;
}): string {
  return [
    input.previousCoveredUntilMessageId ?? 'none',
    input.coveredUntilMessageId,
    String(input.representedMessages),
    String(input.recentMessagesKept),
  ].join(':');
}

function summarizeCompactMessage(message: Message): string {
  const textParts = message.content
    .flatMap((content) => {
      if (content.type === 'text') return [content.text];
      if (content.type === 'modified_files_summary') {
        return [`${content.title}: ${content.summary}`];
      }
      return [];
    })
    .join('\n')
    .trim();

  if (textParts.length > 0) {
    return normalizeCompactText(textParts, 220);
  }

  if (message.role === 'tool') {
    const toolSummaries = message.content.flatMap((content) => {
      if (content.type !== 'tool_result') return [];
      const toolName = content.toolName ?? content.toolCallId;
      return [content.isError ? `${toolName} (error)` : `${toolName} (ok)`];
    });
    return normalizeCompactText(toolSummaries.join(', '), 220);
  }

  return normalizeCompactText(extractMessageText(message), 220);
}

function collectCompactSummaryLines(items: string[], limit: number): string[] {
  const deduped = new Set<string>();
  const lines: string[] = [];
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const value = items[index]?.trim();
    if (!value || deduped.has(value)) {
      continue;
    }
    deduped.add(value);
    lines.unshift(value);
    if (lines.length >= limit) {
      break;
    }
  }
  return lines;
}

function collectToolActivitySummary(messages: Message[]): string[] {
  const aggregated = new Map<string, { errors: number; successes: number }>();

  listStoredToolResults(messages).forEach((content) => {
    const toolName = content.toolName ?? content.toolCallId;
    const current = aggregated.get(toolName) ?? { errors: 0, successes: 0 };
    if (content.isError) {
      current.errors += 1;
    } else {
      current.successes += 1;
    }
    aggregated.set(toolName, current);
  });

  return Array.from(aggregated.entries())
    .slice(0, 5)
    .map(([toolName, counts]) => {
      const parts = [] as string[];
      if (counts.successes > 0) {
        parts.push(`ok×${counts.successes}`);
      }
      if (counts.errors > 0) {
        parts.push(`error×${counts.errors}`);
      }
      return `${toolName}: ${parts.join(', ')}`;
    });
}

function collectModifiedFilesForSummary(messages: Message[]): string[] {
  const files = new Set<string>();
  messages.forEach((message) => {
    message.content.forEach((content) => {
      if (content.type !== 'modified_files_summary') {
        return;
      }
      content.files.forEach((file) => {
        files.add(file.file);
      });
    });
  });
  return Array.from(files).slice(0, 6);
}

function formatSummarySection(title: string, lines: string[]): string {
  if (lines.length === 0) {
    return `${title}:\n- None recorded.`;
  }
  return `${title}:\n${lines.map((line) => `- ${line}`).join('\n')}`;
}

function normalizeCompactText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function normalizeExtractedToolText(output: unknown): string {
  const serialized = stringifyToolResultOutput(output);
  if (serialized.length <= MAX_EXTRACTED_TOOL_TEXT_CHARS) {
    return serialized;
  }
  return `${serialized.slice(0, MAX_EXTRACTED_TOOL_TEXT_CHARS - 1)}…`;
}

export function extractMessageText(message: Message | undefined): string {
  if (!message) return '';
  return message.content
    .map((content) => {
      if (content.type === 'text') return content.text;
      if (content.type === 'tool_call') {
        return `${content.toolName}: ${normalizeExtractedToolText(content.input)}`;
      }
      if (content.type === 'tool_result') {
        return normalizeExtractedToolText(content.output);
      }
      if (content.type === 'reasoning') {
        return content.text;
      }
      if (content.type === 'modified_files_summary') {
        return `${content.title}: ${content.summary}`;
      }
      return '';
    })
    .join('\n')
    .trim();
}

function serializeToolOutput(input: {
  isError: boolean;
  output: unknown;
  rawOutput?: string;
  toolCallId: string;
}): string {
  const serialized = input.rawOutput ?? stringifyToolOutputValue(input.output);
  const sizeBytes = Buffer.byteLength(serialized, 'utf8');
  if (!shouldReferenceToolOutput(input.output, serialized, sizeBytes)) {
    return input.isError ? `[tool_error] ${serialized}` : serialized;
  }

  const meta = buildLargeToolOutputReference({
    toolCallId: input.toolCallId,
    isError: input.isError,
  });

  return `[tool_output_reference] 完整输出已保存在会话记录中，未裁剪；为避免上下文膨胀，本轮仅向模型提供结构化引用。${JSON.stringify(meta)}`;
}

function stringifyToolOutputValue(output: unknown): string {
  return stringifyToolResultOutput(output);
}

function shouldReferenceToolOutput(
  output: unknown,
  serialized = stringifyToolOutputValue(output),
  sizeBytes = Buffer.byteLength(serialized, 'utf8'),
): boolean {
  return sizeBytes > MAX_INLINE_TOOL_OUTPUT_BYTES;
}

function buildLargeToolOutputReference(input: {
  toolCallId: string;
  isError: boolean;
}): Record<string, unknown> {
  return {
    kind: 'tool_output_reference',
    fullOutputPreserved: true,
    storage: 'session_message',
    retrievalTool: 'read_tool_output',
    toolCallId: input.toolCallId,
    isError: input.isError,
  };
}

function selectSafeConversationWindow(messages: Message[], maxMessages: number): Message[] {
  if (messages.length <= maxMessages) return messages;

  const selected: Message[] = [];
  const pendingToolCallIds = new Set<string>();
  let includedCount = 0;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    const toolCallIds = extractToolCallIds(message);
    const toolResultIds = extractToolResultIds(message);
    const needsPairing = toolCallIds.some((toolCallId) => pendingToolCallIds.has(toolCallId));
    const shouldInclude = includedCount < maxMessages || needsPairing || toolResultIds.length > 0;
    if (!shouldInclude) {
      if (includedCount >= maxMessages && pendingToolCallIds.size === 0) break;
      continue;
    }

    selected.push(message);
    includedCount += 1;
    toolResultIds.forEach((toolCallId) => {
      pendingToolCallIds.add(toolCallId);
    });
    toolCallIds.forEach((toolCallId) => {
      pendingToolCallIds.delete(toolCallId);
    });

    if (includedCount >= maxMessages && pendingToolCallIds.size === 0) {
      break;
    }
  }

  return ensureLatestUserMessage(selected.reverse(), messages);
}

/**
 * Filter messages using the opencode filterCompacted pattern.
 *
 * In opencode, messages are stored newest-first. filterCompacted iterates
 * forward (newest→oldest), collecting messages until it hits a compaction
 * boundary, then reverses to chronological order.
 *
 * In OpenAWork, messages are chronological (oldest first). So we find the
 * boundary and return it plus everything after it — keeping only the messages
 * after the most recent compaction boundary.
 *
 * Boundary detection supports two modes:
 * 1. Compaction marker in message list (opencode pattern) — find the last
 *    compaction marker assistant message and keep it + everything after.
 * 2. Persisted memory coveredUntilMessageId (legacy fallback) — when no
 *    marker exists in the message list, use the coveredUntilMessageId from
 *    persisted compaction memory to slice.
 */
function filterCompactedMessages(
  messages: Message[],
  persistedMemory: PersistedCompactionMemory | null,
  llmCompactionSummary: string | undefined,
): Message[] {
  if (messages.length === 0) {
    return messages;
  }

  // Mode 1: Find the last compaction marker in message list (opencode pattern)
  // This works regardless of whether llmCompactionSummary is provided —
  // if a marker exists in the message list, it IS the boundary.
  let boundaryIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (isCompactionMarkerMessage(messages[i]!)) {
      boundaryIndex = i;
      break;
    }
  }

  if (boundaryIndex >= 0) {
    return messages.slice(boundaryIndex);
  }

  // Mode 2: Legacy fallback — use persistedMemory.coveredUntilMessageId
  // Only applies when there's no marker in the message list but we have
  // summary info from metadataJson
  if (!llmCompactionSummary || llmCompactionSummary.trim().length === 0) {
    return messages;
  }

  const coveredUntilMessageId = persistedMemory?.coveredUntilMessageId;
  if (coveredUntilMessageId) {
    const coveredIndex = messages.findIndex((message) => message.id === coveredUntilMessageId);
    if (coveredIndex >= 0) {
      return messages.slice(coveredIndex + 1);
    }
  }

  return messages;
}

function ensureLatestUserMessage(selected: Message[], allMessages: Message[]): Message[] {
  if (selected.some((message) => message.role === 'user')) {
    return selected;
  }

  for (let index = allMessages.length - 1; index >= 0; index -= 1) {
    const candidate = allMessages[index];
    if (candidate?.role !== 'user') {
      continue;
    }

    return [candidate, ...selected];
  }

  return selected;
}

function _buildModifiedFilesSummaryContext(content: MessageContent): string[] {
  if (content.type !== 'modified_files_summary') {
    return [];
  }

  const fileLines = content.files.map((file) => {
    const status = file.status ?? 'modified';
    return `- ${status}: ${file.file}`;
  });

  return [[`${content.title}: ${content.summary}`, ...fileLines].join('\n')];
}

function extractToolCallIds(message: Message): string[] {
  return message.content.flatMap((content) =>
    content.type === 'tool_call' ? [content.toolCallId] : [],
  );
}

function extractToolResultIds(message: Message): string[] {
  return message.content.flatMap((content) =>
    content.type === 'tool_result' ? [content.toolCallId] : [],
  );
}
