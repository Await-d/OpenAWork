import type { StreamChunk, StreamDoneChunk, ToolSearchStatus } from '@openAwork/shared';
import { buildGatewayToolDefinitions as buildDefaultGatewayToolDefinitions } from '../tool-definitions.js';
import type { UpstreamProtocol } from './upstream-protocol.js';

type StopReason = StreamDoneChunk['stopReason'];

interface UpstreamToolFunctionDelta {
  name?: string;
  arguments?: string;
}

interface UpstreamToolCallDelta {
  index?: number;
  id?: string;
  function?: UpstreamToolFunctionDelta;
}

interface UpstreamChoice {
  delta?: {
    content?: unknown;
    function_call?: UpstreamToolFunctionDelta;
    reasoning_content?: unknown;
    tool_calls?: UpstreamToolCallDelta[];
  };
  finish_reason?: string | null;
}

interface UpstreamEvent {
  choices?: UpstreamChoice[];
  usage?: unknown;
}

interface ResponsesOutputItem {
  id?: string;
  type?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  encrypted_content?: string;
  summary?: unknown;
}

interface ResponsesOutputItemEvent {
  output_index?: number;
  item?: ResponsesOutputItem;
}

interface ResponsesArgumentsDeltaEvent {
  output_index?: number;
  delta?: string;
  arguments?: string;
}

interface ResponsesReasoningSummaryDeltaEvent {
  delta?: string;
  item_id?: string;
  itemID?: string;
  output_index?: number;
  summary_index?: number;
}

interface ResponsesErrorEvent {
  error?: {
    code?: string;
    message?: string;
  };
}

interface ResponsesCompletedEvent {
  response?: {
    id?: string;
    output?: ResponsesOutputItem[];
    usage?: unknown;
    incomplete_details?: {
      reason?: string;
    };
  };
}

export interface StreamUsageSummary {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

interface ToolCallState {
  toolCallId?: string;
  toolName?: string;
  inputText: string;
}

export interface StreamParseState {
  runId: string;
  nextEventSequence: number;
  sawFinishReason: boolean;
  stopReason: StopReason;
  toolCalls: Map<number, ToolCallState>;
  usage?: StreamUsageSummary;
  /** Encrypted reasoning content from Responses API, needed for multi-turn. */
  reasoningEncryptedContent?: string;
  /** Reasoning summary text from Responses API. */
  reasoningSummary?: string;
  /** Response ID from Responses API, used as previous_response_id for caching. */
  responseId?: string;
  /** Agent ID for the current stream round (for per-agent color rendering). */
  agentId?: string;
  /**
   * OpenAI Chat Completions / DeepSeek-style providers emit a single ongoing
   * thinking stream (no per-item metadata). We keep a flag here to know when
   * to emit `thinking_end` at the boundary into text/tool/finish.
   */
  hasActiveThinking?: boolean;
  /**
   * Anthropic Messages: which content_block indices are thinking blocks, so
   * we can emit `thinking_end` at the matching `content_block_stop`.
   */
  anthropicThinkingBlockIndices?: Set<number>;
  /**
   * Composite block keys for which `thinking_start` has already been emitted
   * in the current upstream connection. Mirrors `appendReasoningChunk`'s key
   * scheme so Anthropic / Responses API per-block start events can be deduped.
   */
  thinkingStartedKeys?: Set<string>;
}

export class ResponsesUpstreamEventError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ResponsesUpstreamEventError';
    this.code = code;
  }
}

export function createStreamParseState(runId = 'run-local'): StreamParseState {
  return {
    runId,
    nextEventSequence: 1,
    reasoningEncryptedContent: undefined,
    reasoningSummary: undefined,
    responseId: undefined,
    sawFinishReason: false,
    stopReason: 'end_turn',
    toolCalls: new Map(),
    usage: undefined,
    hasActiveThinking: false,
    anthropicThinkingBlockIndices: new Set(),
    thinkingStartedKeys: new Set(),
  };
}

/**
 * Build the composite key used to deduplicate `thinking_start` events for
 * per-block streams (Anthropic, OpenAI Responses API). Mirrors the key scheme
 * used by `appendReasoningChunk`, falling back to `legacy:0` when no identity
 * fields are present (e.g. OpenAI Chat Completions).
 */
function buildThinkingStartKey(input: {
  itemId?: string;
  outputIndex?: number;
  summaryIndex?: number;
}): string {
  if (typeof input.itemId === 'string' && input.itemId.trim().length > 0) {
    return `item:${input.itemId}:output:${input.outputIndex ?? -1}:summary:${input.summaryIndex ?? -1}`;
  }
  if (typeof input.outputIndex === 'number' || typeof input.summaryIndex === 'number') {
    return `indexed:${input.outputIndex ?? -1}:summary:${input.summaryIndex ?? -1}`;
  }
  return 'legacy:0';
}

/**
 * Conditionally emit a `thinking_start` chunk if this is the first delta we've
 * seen for the resolved block key. Returns the chunks the caller should prepend
 * to its outgoing batch (empty when the start was already announced).
 */
function maybeEmitThinkingStart(
  state: StreamParseState,
  identity: { itemId?: string; outputIndex?: number; summaryIndex?: number },
): StreamChunk[] {
  if (!state.thinkingStartedKeys) {
    state.thinkingStartedKeys = new Set();
  }
  const key = buildThinkingStartKey(identity);
  if (state.thinkingStartedKeys.has(key)) {
    return [];
  }
  state.thinkingStartedKeys.add(key);
  return [
    {
      type: 'thinking_start',
      ...(identity.itemId ? { itemId: identity.itemId } : {}),
      ...(typeof identity.outputIndex === 'number' ? { outputIndex: identity.outputIndex } : {}),
      ...(typeof identity.summaryIndex === 'number' ? { summaryIndex: identity.summaryIndex } : {}),
      ...createChunkMeta(state),
    },
  ];
}

export function buildGatewayToolDefinitions() {
  return buildDefaultGatewayToolDefinitions();
}

export function parseUpstreamFrame(
  frame: string,
  protocol: UpstreamProtocol,
  state: StreamParseState,
): StreamChunk[] {
  if (protocol === 'anthropic_messages') {
    return parseAnthropicMessagesFrame(frame, state);
  }
  if (protocol === 'responses') {
    return parseResponsesFrame(frame, state);
  }

  return frame
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .flatMap((line) => parseUpstreamDataLine(line.slice(5).trimStart(), state));
}

export function parseUpstreamDataLine(data: string, state: StreamParseState): StreamChunk[] {
  if (data === '[DONE]') {
    state.sawFinishReason = true;
    if (state.stopReason === 'end_turn' && state.toolCalls.size > 0) {
      state.stopReason = 'tool_use';
    }
    const chunks: StreamChunk[] = [];
    if (state.hasActiveThinking) {
      chunks.push({ type: 'thinking_end', ...createChunkMeta(state) });
      state.hasActiveThinking = false;
    }
    chunks.push({
      type: 'done',
      stopReason: state.stopReason,
      ...createChunkMeta(state),
    });
    return chunks;
  }

  const event = JSON.parse(data) as UpstreamEvent;
  const usage = parseStreamUsage(event.usage);
  if (usage) {
    state.usage = usage;
  }
  const chunks: StreamChunk[] = [];

  for (const choice of event.choices ?? []) {
    if (choice.finish_reason) {
      state.sawFinishReason = true;
      state.stopReason = mapStopReason(choice.finish_reason);
    }

    const delta = choice.delta;
    if (!delta) continue;

    const { text: textDelta, thinking: contentThinkingDelta } =
      extractUpstreamTextAndThinkingDeltas(delta.content);
    const reasoningDelta = extractUpstreamReasoningContentDelta(delta.reasoning_content);
    const hasIncomingThinking = contentThinkingDelta.length > 0 || reasoningDelta.length > 0;
    const willStartTextOrTool =
      textDelta.length > 0 ||
      Boolean(delta.function_call) ||
      (delta.tool_calls?.length ?? 0) > 0;

    if (state.hasActiveThinking && !hasIncomingThinking && willStartTextOrTool) {
      chunks.push({ type: 'thinking_end', ...createChunkMeta(state) });
      state.hasActiveThinking = false;
    }

    if (textDelta.length > 0) {
      chunks.push({ type: 'text_delta', delta: textDelta, ...createChunkMeta(state) });
    }
    if (contentThinkingDelta.length > 0) {
      chunks.push(...maybeEmitThinkingStart(state, {}));
      chunks.push({
        type: 'thinking_delta',
        delta: contentThinkingDelta,
        ...createChunkMeta(state),
      });
      state.hasActiveThinking = true;
    }

    if (reasoningDelta.length > 0) {
      chunks.push(...maybeEmitThinkingStart(state, {}));
      chunks.push({ type: 'thinking_delta', delta: reasoningDelta, ...createChunkMeta(state) });
      state.hasActiveThinking = true;
    }

    if (delta.function_call) {
      state.stopReason = 'tool_use';
      const legacyToolState = state.toolCalls.get(0) ?? { inputText: '' };
      const nextLegacyToolState: ToolCallState = {
        toolCallId: legacyToolState.toolCallId ?? `${state.runId}:function_call:0`,
        toolName: delta.function_call.name ?? legacyToolState.toolName,
        inputText: `${legacyToolState.inputText}${delta.function_call.arguments ?? ''}`,
      };
      state.toolCalls.set(0, nextLegacyToolState);

      const inputDelta = delta.function_call.arguments ?? '';
      if (
        nextLegacyToolState.toolCallId &&
        nextLegacyToolState.toolName &&
        (inputDelta.length > 0 || delta.function_call.name)
      ) {
        chunks.push({
          type: 'tool_call_delta',
          toolCallId: nextLegacyToolState.toolCallId,
          toolName: nextLegacyToolState.toolName,
          inputDelta,
          ...createChunkMeta(state),
        });
      }
    }

    for (const toolCall of delta.tool_calls ?? []) {
      state.stopReason = 'tool_use';
      const index = toolCall.index ?? 0;
      const existing = state.toolCalls.get(index) ?? { inputText: '' };
      const next: ToolCallState = {
        toolCallId: toolCall.id ?? existing.toolCallId,
        toolName: toolCall.function?.name ?? existing.toolName,
        inputText: `${existing.inputText}${toolCall.function?.arguments ?? ''}`,
      };
      state.toolCalls.set(index, next);

      const inputDelta = toolCall.function?.arguments ?? '';
      if (!next.toolCallId || !next.toolName) continue;
      if (inputDelta.length === 0 && !(toolCall.id || toolCall.function?.name)) continue;

      chunks.push({
        type: 'tool_call_delta',
        toolCallId: next.toolCallId,
        toolName: next.toolName,
        inputDelta,
        ...createChunkMeta(state),
      });
    }
  }

  return chunks;
}

function extractUpstreamTextDelta(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => extractUpstreamTextDelta(item)).join('');
  }

  if (!value || typeof value !== 'object') {
    return '';
  }

  const record = value as Record<string, unknown>;
  const candidates = [record['text'], record['content'], record['markdown'], record['value']];
  return candidates.map((item) => extractUpstreamTextDelta(item)).join('');
}

function isThinkingContentBlock(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    record['type'] === 'thinking' ||
    record['type'] === 'reasoning' ||
    record['type'] === 'thought' ||
    record['type'] === 'thoughts' ||
    record['thought'] === true
  );
}

function extractThinkingTextFromBlock(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return '';
  }

  const record = value as Record<string, unknown>;
  if (typeof record['thought'] === 'string') {
    return record['thought'];
  }

  if (typeof record['thinking'] === 'string') {
    return record['thinking'];
  }

  if (typeof record['reasoning'] === 'string') {
    return record['reasoning'];
  }

  if (typeof record['text'] === 'string') {
    return record['text'];
  }

  return '';
}

function extractUpstreamTextAndThinkingDeltas(content: unknown): {
  text: string;
  thinking: string;
} {
  if (typeof content === 'string') {
    return { text: content, thinking: '' };
  }

  if (!Array.isArray(content)) {
    if (!content || typeof content !== 'object') {
      return { text: '', thinking: '' };
    }

    if (isThinkingContentBlock(content)) {
      return { text: '', thinking: extractThinkingTextFromBlock(content) };
    }

    return { text: extractUpstreamTextDelta(content), thinking: '' };
  }

  let text = '';
  let thinking = '';
  for (const item of content) {
    if (isThinkingContentBlock(item)) {
      thinking += extractThinkingTextFromBlock(item);
    } else {
      text += extractUpstreamTextDelta(item);
    }
  }
  return { text, thinking };
}

function extractUpstreamReasoningContentDelta(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === 'string' ? item : '')).join('');
  }

  return '';
}

// ─── Anthropic Messages API SSE Parser ───

interface AnthropicContentBlock {
  type?: string;
  id?: string;
  name?: string;
  text?: string;
  partial_json?: string;
}

interface AnthropicMessageStartEvent {
  type?: string;
  message?: {
    id?: string;
    usage?: unknown;
  };
}

interface AnthropicMessageDeltaEvent {
  type?: string;
  delta?: {
    stop_reason?: string;
  };
  usage?: unknown;
}

function parseAnthropicMessagesFrame(frame: string, state: StreamParseState): StreamChunk[] {
  const lines = frame.split('\n');
  const eventName = lines
    .find((line) => line.startsWith('event:'))
    ?.slice(6)
    .trim();
  const data = lines
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n')
    .trim();

  if (!eventName || data.length === 0) {
    return [];
  }

  if (data === '[DONE]') {
    state.sawFinishReason = true;
    return [
      {
        type: 'done',
        stopReason: state.stopReason,
        ...createChunkMeta(state),
      },
    ];
  }

  switch (eventName) {
    case 'message_start': {
      const payload = JSON.parse(data) as AnthropicMessageStartEvent;
      const usage = parseStreamUsage(payload.message?.usage);
      if (usage) {
        state.usage = usage;
      }
      return [];
    }
    case 'content_block_start': {
      const payload = JSON.parse(data) as { index?: number; content_block?: AnthropicContentBlock };
      const block = payload.content_block;
      if (block?.type === 'tool_use' && block.id && block.name) {
        const index = payload.index ?? 0;
        state.toolCalls.set(index, {
          toolCallId: block.id,
          toolName: block.name,
          inputText: '',
        });
        state.stopReason = 'tool_use';
        return [
          {
            type: 'tool_call_delta',
            toolCallId: block.id,
            toolName: block.name,
            inputDelta: '',
            ...createChunkMeta(state),
          },
        ];
      }
      if (block?.type === 'thinking') {
        const index = payload.index ?? 0;
        state.anthropicThinkingBlockIndices?.add(index);
        // Announce per-block start eagerly so downstream UIs can render the
        // empty thinking placeholder before the first delta arrives.
        return maybeEmitThinkingStart(state, { outputIndex: index });
      }
      return [];
    }
    case 'content_block_delta': {
      const payload = JSON.parse(data) as {
        index?: number;
        delta?: { type?: string; text?: string; partial_json?: string; thinking?: string };
      };
      const delta = payload.delta;
      if (!delta) return [];

      if (delta.type === 'text_delta' && delta.text) {
        return [{ type: 'text_delta', delta: delta.text, ...createChunkMeta(state) }];
      }

      if (delta.type === 'thinking_delta' && delta.thinking) {
        const index = payload.index ?? 0;
        return [
          ...maybeEmitThinkingStart(state, { outputIndex: index }),
          {
            type: 'thinking_delta',
            delta: delta.thinking,
            outputIndex: index,
            ...createChunkMeta(state),
          },
        ];
      }

      if (delta.type === 'input_json_delta' && delta.partial_json) {
        const index = payload.index ?? 0;
        const existing = state.toolCalls.get(index) ?? { inputText: '' };
        const next: ToolCallState = {
          toolCallId: existing.toolCallId,
          toolName: existing.toolName,
          inputText: `${existing.inputText}${delta.partial_json}`,
        };
        state.toolCalls.set(index, next);
        if (next.toolCallId && next.toolName) {
          return [
            {
              type: 'tool_call_delta',
              toolCallId: next.toolCallId,
              toolName: next.toolName,
              inputDelta: delta.partial_json,
              ...createChunkMeta(state),
            },
          ];
        }
      }
      return [];
    }
    case 'content_block_stop': {
      const payload = JSON.parse(data) as { index?: number };
      const index = payload.index ?? 0;
      if (state.anthropicThinkingBlockIndices?.has(index)) {
        state.anthropicThinkingBlockIndices.delete(index);
        return [
          {
            type: 'thinking_end',
            outputIndex: index,
            ...createChunkMeta(state),
          },
        ];
      }
      return [];
    }
    case 'message_delta': {
      const payload = JSON.parse(data) as AnthropicMessageDeltaEvent;
      const usage = parseStreamUsage(payload.usage);
      if (usage) {
        state.usage = usage;
      }
      if (payload.delta?.stop_reason) {
        state.sawFinishReason = true;
        state.stopReason = mapStopReason(payload.delta.stop_reason);
        if (state.stopReason === 'end_turn' && state.toolCalls.size > 0) {
          state.stopReason = 'tool_use';
        }
      }
      return [];
    }
    case 'message_stop': {
      state.sawFinishReason = true;
      const chunks: StreamChunk[] = [];
      if (state.anthropicThinkingBlockIndices && state.anthropicThinkingBlockIndices.size > 0) {
        for (const pendingIndex of Array.from(state.anthropicThinkingBlockIndices).sort(
          (a, b) => a - b,
        )) {
          chunks.push({
            type: 'thinking_end',
            outputIndex: pendingIndex,
            ...createChunkMeta(state),
          });
        }
        state.anthropicThinkingBlockIndices.clear();
      }
      chunks.push({
        type: 'done',
        stopReason: state.stopReason,
        ...createChunkMeta(state),
      });
      return chunks;
    }
    case 'ping': {
      return [];
    }
    case 'error': {
      const payload = JSON.parse(data) as { error?: { type?: string; message?: string } };
      throw new ResponsesUpstreamEventError(
        payload.error?.type ?? 'MODEL_ERROR',
        payload.error?.message ?? 'Anthropic upstream error',
      );
    }
    default:
      return [];
  }
}

function parseResponsesFrame(frame: string, state: StreamParseState): StreamChunk[] {
  const lines = frame.split('\n');
  const eventName = lines
    .find((line) => line.startsWith('event:'))
    ?.slice(6)
    .trim();
  const data = lines
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n')
    .trim();

  if (!eventName || data.length === 0) {
    return [];
  }

  if (data === '[DONE]') {
    state.sawFinishReason = true;
    return [
      {
        type: 'done',
        stopReason: state.stopReason,
        ...createChunkMeta(state),
      },
    ];
  }

  switch (eventName) {
    case 'response.created': {
      const payload = JSON.parse(data) as { response?: { id?: string } };
      if (payload.response?.id) {
        state.responseId = payload.response.id;
      }
      return [];
    }
    case 'response.output_text.delta': {
      const payload = JSON.parse(data) as { delta?: string };
      return typeof payload.delta === 'string' && payload.delta.length > 0
        ? [{ type: 'text_delta', delta: payload.delta, ...createChunkMeta(state) }]
        : [];
    }
    case 'response.reasoning_summary_text.delta': {
      const payload = JSON.parse(data) as ResponsesReasoningSummaryDeltaEvent;
      if (typeof payload.delta !== 'string' || payload.delta.length === 0) return [];
      const identity = {
        itemId: payload.item_id ?? payload.itemID,
        outputIndex: payload.output_index,
        summaryIndex: payload.summary_index,
      };
      return [
        ...maybeEmitThinkingStart(state, identity),
        {
          type: 'thinking_delta',
          delta: payload.delta,
          ...identity,
          ...createChunkMeta(state),
        },
      ];
    }
    case 'response.reasoning_summary_text.done':
    case 'response.reasoning_text.done': {
      const payload = JSON.parse(data) as ResponsesReasoningSummaryDeltaEvent;
      return [
        {
          type: 'thinking_end',
          itemId: payload.item_id ?? payload.itemID,
          outputIndex: payload.output_index,
          summaryIndex: payload.summary_index,
          ...createChunkMeta(state),
        },
      ];
    }
    case 'response.reasoning_text.delta': {
      const payload = JSON.parse(data) as ResponsesReasoningSummaryDeltaEvent;
      if (typeof payload.delta !== 'string' || payload.delta.length === 0) return [];
      const identity = {
        itemId: payload.item_id ?? payload.itemID,
        outputIndex: payload.output_index,
        summaryIndex: payload.summary_index,
      };
      return [
        ...maybeEmitThinkingStart(state, identity),
        {
          type: 'thinking_delta',
          delta: payload.delta,
          ...identity,
          ...createChunkMeta(state),
        },
      ];
    }
    case 'response.output_item.added':
    case 'response.output_item.done': {
      return parseResponsesOutputItemEvent(eventName, data, state);
    }
    case 'response.function_call_arguments.delta': {
      return parseResponsesFunctionArgumentsDelta(data, state);
    }
    case 'response.function_call_arguments.done': {
      return parseResponsesFunctionArgumentsDone(data, state);
    }
    case 'response.completed': {
      const payload = JSON.parse(data) as ResponsesCompletedEvent;
      const usage = parseStreamUsage(payload.response?.usage);
      if (usage) {
        state.usage = usage;
      }
      // Capture response.id if not already set by response.created event.
      if (payload.response?.id && !state.responseId) {
        state.responseId = payload.response.id;
      }
      // Extract encrypted reasoning content from output items for multi-turn.
      const reasoningItem = payload.response?.output?.find(
        (item) => item.type === 'reasoning',
      );
      if (reasoningItem) {
        if (reasoningItem.encrypted_content) {
          state.reasoningEncryptedContent = reasoningItem.encrypted_content;
        }
        // Extract summary text if available
        const summaryArr = reasoningItem.summary;
        if (Array.isArray(summaryArr)) {
          const textParts = summaryArr
            .filter((s: unknown) => typeof s === 'object' && s !== null && 'text' in (s as Record<string, unknown>))
            .map((s: Record<string, unknown>) => (s as { text: string }).text);
          if (textParts.length > 0) {
            state.reasoningSummary = textParts.join('\n');
          }
        }
      }
      state.sawFinishReason = true;
      if (state.stopReason !== 'tool_use' && responseContainsFunctionCall(payload)) {
        state.stopReason = 'tool_use';
      }
      return [{ type: 'done', stopReason: state.stopReason, ...createChunkMeta(state) }];
    }
    case 'response.incomplete': {
      const payload = JSON.parse(data) as ResponsesCompletedEvent;
      const usage = parseStreamUsage(payload.response?.usage);
      if (usage) {
        state.usage = usage;
      }
      state.sawFinishReason = true;
      state.stopReason = mapResponsesStopReason(
        payload.response?.incomplete_details?.reason,
        responseContainsFunctionCall(payload) || state.stopReason === 'tool_use',
      );
      return [{ type: 'done', stopReason: state.stopReason, ...createChunkMeta(state) }];
    }
    case 'response.failed': {
      const payload = JSON.parse(data) as ResponsesCompletedEvent;
      const usage = parseStreamUsage(payload.response?.usage);
      if (usage) {
        state.usage = usage;
      }
      state.sawFinishReason = true;
      state.stopReason = 'error';
      return [{ type: 'done', stopReason: state.stopReason, ...createChunkMeta(state) }];
    }
    case 'response.tool_search_call.in_progress':
    case 'response.tool_search_call.searching':
    case 'response.tool_search_call.completed': {
      const toolSearchStatus = eventName.split('.').pop() as ToolSearchStatus;
      return [
        {
          type: 'tool_search',
          status: toolSearchStatus,
          ...createChunkMeta(state),
        },
      ];
    }
    case 'response.error':
    case 'error': {
      const payload = JSON.parse(data) as ResponsesErrorEvent;
      throw new ResponsesUpstreamEventError(
        payload.error?.code ?? 'MODEL_ERROR',
        payload.error?.message ?? 'Responses upstream error',
      );
    }
    default:
      return [];
  }
}

function parseResponsesOutputItemEvent(
  eventName: string,
  data: string,
  state: StreamParseState,
): StreamChunk[] {
  const payload = JSON.parse(data) as ResponsesOutputItemEvent;
  const index = payload.output_index ?? 0;
  const item = payload.item;
  if (item?.type !== 'function_call') {
    return [];
  }

  const existing = state.toolCalls.get(index) ?? { inputText: '' };
  const toolCallId =
    item.call_id ?? existing.toolCallId ?? item.id ?? `${state.runId}:response:${index}`;
  const toolName = item.name ?? existing.toolName;
  const argumentsText = typeof item.arguments === 'string' ? item.arguments : existing.inputText;
  const toolIdentityChanged = existing.toolCallId !== toolCallId || existing.toolName !== toolName;
  state.toolCalls.set(index, { toolCallId, toolName, inputText: argumentsText });
  state.stopReason = 'tool_use';

  if (!toolCallId || !toolName) {
    return [];
  }

  const delta = toolIdentityChanged
    ? argumentsText
    : argumentsText.slice(existing.inputText.length);
  return delta.length > 0 || eventName === 'response.output_item.added' || toolIdentityChanged
    ? [
        {
          type: 'tool_call_delta',
          toolCallId,
          toolName,
          inputDelta: delta,
          ...createChunkMeta(state),
        },
      ]
    : [];
}

function parseResponsesFunctionArgumentsDelta(
  data: string,
  state: StreamParseState,
): StreamChunk[] {
  const payload = JSON.parse(data) as ResponsesArgumentsDeltaEvent;
  const index = payload.output_index ?? 0;
  const existing = state.toolCalls.get(index) ?? { inputText: '' };
  const delta = payload.delta ?? '';
  const next: ToolCallState = {
    toolCallId: existing.toolCallId ?? `${state.runId}:response:${index}`,
    toolName: existing.toolName,
    inputText: `${existing.inputText}${delta}`,
  };
  state.toolCalls.set(index, next);
  state.stopReason = 'tool_use';

  if (!next.toolCallId || !next.toolName || delta.length === 0) {
    return [];
  }

  return [
    {
      type: 'tool_call_delta',
      toolCallId: next.toolCallId,
      toolName: next.toolName,
      inputDelta: delta,
      ...createChunkMeta(state),
    },
  ];
}

function parseResponsesFunctionArgumentsDone(data: string, state: StreamParseState): StreamChunk[] {
  const payload = JSON.parse(data) as ResponsesArgumentsDeltaEvent;
  const index = payload.output_index ?? 0;
  const existing = state.toolCalls.get(index) ?? { inputText: '' };
  const argumentsText = payload.arguments ?? existing.inputText;
  const delta = argumentsText.slice(existing.inputText.length);
  const next: ToolCallState = {
    toolCallId: existing.toolCallId ?? `${state.runId}:response:${index}`,
    toolName: existing.toolName,
    inputText: argumentsText,
  };
  state.toolCalls.set(index, next);
  state.stopReason = 'tool_use';

  if (!next.toolCallId || !next.toolName || delta.length === 0) {
    return [];
  }

  return [
    {
      type: 'tool_call_delta',
      toolCallId: next.toolCallId,
      toolName: next.toolName,
      inputDelta: delta,
      ...createChunkMeta(state),
    },
  ];
}

function responseContainsFunctionCall(payload: ResponsesCompletedEvent): boolean {
  return payload.response?.output?.some((item) => item.type === 'function_call') ?? false;
}

function parseStreamUsage(value: unknown): StreamUsageSummary | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const inputTokens = readNonNegativeInteger(record['input_tokens'] ?? record['prompt_tokens']);
  const outputTokens = readNonNegativeInteger(
    record['output_tokens'] ?? record['completion_tokens'],
  );

  if (inputTokens === undefined && outputTokens === undefined) {
    return undefined;
  }

  const safeInputTokens = inputTokens ?? 0;
  const safeOutputTokens = outputTokens ?? 0;
  const totalTokens =
    readNonNegativeInteger(record['total_tokens']) ?? safeInputTokens + safeOutputTokens;

  return {
    inputTokens: safeInputTokens,
    outputTokens: safeOutputTokens,
    totalTokens,
  };
}

function readNonNegativeInteger(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }

  return Math.max(0, Math.trunc(value));
}

function createChunkMeta(state: StreamParseState): {
  eventId: string;
  runId: string;
  agentId?: string;
  occurredAt: number;
} {
  const eventId = `${state.runId}:evt:${state.nextEventSequence}`;
  state.nextEventSequence += 1;
  return {
    eventId,
    runId: state.runId,
    ...(state.agentId ? { agentId: state.agentId } : {}),
    occurredAt: Date.now(),
  };
}

function mapStopReason(raw: string): StopReason {
  switch (raw) {
    case 'tool_use':
    case 'tool_calls':
    case 'tool_call':
    case 'function_call':
      return 'tool_use';
    case 'length':
      return 'max_tokens';
    case 'content_filter':
      return 'error';
    case 'stop':
    default:
      return 'end_turn';
  }
}

function mapResponsesStopReason(reason: string | undefined, hasToolCalls: boolean): StopReason {
  if (hasToolCalls) {
    return 'tool_use';
  }

  switch (reason) {
    case 'max_output_tokens':
      return 'max_tokens';
    case 'content_filter':
      return 'error';
    default:
      return 'end_turn';
  }
}
