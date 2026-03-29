import type { StreamChunk, StreamDoneChunk } from '@openAwork/shared';
import { buildGatewayToolDefinitions as buildToolDefinitions } from '../tool-definitions.js';
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
    tool_calls?: UpstreamToolCallDelta[];
  };
  finish_reason?: string | null;
}

interface UpstreamEvent {
  choices?: UpstreamChoice[];
}

interface ResponsesOutputItem {
  id?: string;
  type?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
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
    output?: ResponsesOutputItem[];
    incomplete_details?: {
      reason?: string;
    };
  };
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
    sawFinishReason: false,
    stopReason: 'end_turn',
    toolCalls: new Map(),
  };
}

export function buildGatewayToolDefinitions() {
  return buildToolDefinitions();
}

export function parseUpstreamFrame(
  frame: string,
  protocol: UpstreamProtocol,
  state: StreamParseState,
): StreamChunk[] {
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
    return [
      {
        type: 'done',
        stopReason: state.stopReason,
        ...createChunkMeta(state),
      },
    ];
  }

  const event = JSON.parse(data) as UpstreamEvent;
  const chunks: StreamChunk[] = [];

  for (const choice of event.choices ?? []) {
    if (choice.finish_reason) {
      state.sawFinishReason = true;
      state.stopReason = mapStopReason(choice.finish_reason);
    }

    const delta = choice.delta;
    if (!delta) continue;

    const textDelta = extractUpstreamTextDelta(delta.content);
    if (textDelta.length > 0) {
      chunks.push({ type: 'text_delta', delta: textDelta, ...createChunkMeta(state) });
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
    case 'response.output_text.delta': {
      const payload = JSON.parse(data) as { delta?: string };
      return typeof payload.delta === 'string' && payload.delta.length > 0
        ? [{ type: 'text_delta', delta: payload.delta, ...createChunkMeta(state) }]
        : [];
    }
    case 'response.reasoning_summary_text.delta': {
      const payload = JSON.parse(data) as ResponsesReasoningSummaryDeltaEvent;
      return typeof payload.delta === 'string' && payload.delta.length > 0
        ? [
            {
              type: 'thinking_delta',
              delta: payload.delta,
              itemId: payload.item_id ?? payload.itemID,
              outputIndex: payload.output_index,
              summaryIndex: payload.summary_index,
              ...createChunkMeta(state),
            },
          ]
        : [];
    }
    case 'response.reasoning_text.delta': {
      const payload = JSON.parse(data) as ResponsesReasoningSummaryDeltaEvent;
      return typeof payload.delta === 'string' && payload.delta.length > 0
        ? [
            {
              type: 'thinking_delta',
              delta: payload.delta,
              itemId: payload.item_id ?? payload.itemID,
              outputIndex: payload.output_index,
              summaryIndex: payload.summary_index,
              ...createChunkMeta(state),
            },
          ]
        : [];
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
      state.sawFinishReason = true;
      if (state.stopReason !== 'tool_use' && responseContainsFunctionCall(payload)) {
        state.stopReason = 'tool_use';
      }
      return [{ type: 'done', stopReason: state.stopReason, ...createChunkMeta(state) }];
    }
    case 'response.incomplete': {
      const payload = JSON.parse(data) as ResponsesCompletedEvent;
      state.sawFinishReason = true;
      state.stopReason = mapResponsesStopReason(
        payload.response?.incomplete_details?.reason,
        responseContainsFunctionCall(payload) || state.stopReason === 'tool_use',
      );
      return [{ type: 'done', stopReason: state.stopReason, ...createChunkMeta(state) }];
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

function createChunkMeta(state: StreamParseState): {
  eventId: string;
  runId: string;
  occurredAt: number;
} {
  const eventId = `${state.runId}:evt:${state.nextEventSequence}`;
  state.nextEventSequence += 1;
  return {
    eventId,
    runId: state.runId,
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
