import { Duration, Effect, Layer, Stream } from 'effect';
import * as OpenCodeLLM from '@openAwork/opencode-llm';
import type { RequestOverrides } from '@openAwork/agent-core';
import type {
  StreamChunk,
  StreamDoneChunk,
  StreamErrorChunk,
  StreamToolResultChunk,
} from '@openAwork/shared';
import type { Message, SystemPart, ToolDefinition } from '@openAwork/opencode-llm';
import { dispatchChatParams } from '../../runtime/plugin-host.js';
import {
  buildBaseProviderOptions,
  buildProviderOptions,
  mergeProviderOptions,
  type ThinkingConfig,
  type ExtendedThinkingConfig,
} from './provider-options.js';
import type { UpstreamProtocolKind } from './native-model.js';
import { applyProviderMessageTransforms, sanitizeSurrogates } from './message-transforms.js';

type NativeToolSet = Record<string, ToolDefinition>;

export interface RunUpstreamStreamInput {
  readonly model: OpenCodeLLM.Model;
  readonly modelId?: string;
  readonly messages: Message[];
  readonly tools?: NativeToolSet;
  readonly runId?: string;
  readonly agentId?: string;
  readonly sessionId?: string;
  readonly signal?: AbortSignal;
  readonly idleTimeoutMs?: number;
  readonly system?: string | SystemPart | SystemPart[];
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  readonly topP?: number;
  readonly frequencyPenalty?: number;
  readonly presencePenalty?: number;
  readonly requestOverrides?: RequestOverrides;
  readonly providerType?: string;
  readonly openaiFastMode?: boolean;
  readonly upstreamProtocol?: UpstreamProtocolKind;
  readonly thinking?: ThinkingConfig | ExtendedThinkingConfig;
  readonly litellmProxy?: boolean;
  readonly maxRetries?: number;
  readonly onFinish?: (info: {
    readonly finishReason: string | undefined;
    readonly providerMetadata?: OpenCodeLLM.ProviderMetadata;
    readonly usage: {
      readonly inputTokens: number | undefined;
      readonly outputTokens: number | undefined;
      readonly totalTokens: number | undefined;
      readonly reasoningTokens?: number | undefined;
      readonly cachedInputTokens?: number | undefined;
      readonly inputTokenDetails?: {
        readonly cacheReadTokens?: number | undefined;
        readonly cacheWriteTokens?: number | undefined;
      };
      readonly outputTokenDetails?: { readonly reasoningTokens?: number | undefined };
    };
  }) => void;
  readonly onDiagnostics?: (info: {
    readonly textDeltaCount: number;
    readonly reasoningDeltaCount: number;
    readonly toolCallDeltaCount: number;
    readonly sawDone: boolean;
    readonly sawError: boolean;
    readonly stalled: boolean;
    readonly openaiServiceTier?: string;
  }) => void;
}

export type RunUpstreamStreamEvent = StreamChunk | StreamToolResultChunk;
export type NativeUpstreamStream = Stream.Stream<RunUpstreamStreamEvent, never>;

export function sortToolsByName(tools: NativeToolSet | undefined): NativeToolSet | undefined {
  if (!tools) return undefined;
  const entries = Object.entries(tools).sort(([left], [right]) => left.localeCompare(right));
  return Object.fromEntries(entries);
}

const FINISH_REASON_TO_STOP: Record<string, StreamDoneChunk['stopReason']> = {
  stop: 'end_turn',
  length: 'max_tokens',
  'tool-calls': 'tool_use',
  'content-filter': 'error',
  error: 'error',
  other: 'end_turn',
  unknown: 'end_turn',
};

function mapFinishReason(value: string | undefined): StreamDoneChunk['stopReason'] {
  return value === undefined ? 'end_turn' : (FINISH_REASON_TO_STOP[value] ?? 'end_turn');
}

function hasToolCallsInHistory(messages: readonly Message[]): boolean {
  return messages.some((message) =>
    message.content.some((part) => part.type === 'tool-call' || part.type === 'tool-result'),
  );
}

function shouldInjectNoopStub(input: {
  readonly litellmProxy?: boolean;
  readonly providerType?: string;
}): boolean {
  if (typeof input.litellmProxy === 'boolean') return input.litellmProxy;
  const provider = input.providerType?.toLowerCase() ?? '';
  return (
    provider.includes('litellm') ||
    provider.includes('bedrock') ||
    provider.includes('github-copilot')
  );
}

const NOOP_TOOL_DEFINITION = OpenCodeLLM.ToolDefinition.make({
  name: '_noop',
  description: '请勿调用此工具。它仅为 API 兼容性而存在，绝不应被调用。',
  inputSchema: {
    type: 'object',
    properties: { reason: { type: 'string', description: '未使用' } },
  },
});

const nativeStreamLayer = OpenCodeLLM.LLMClient.layer.pipe(
  Layer.provide(OpenCodeLLM.RequestExecutor.fetchLayer),
);

function shouldOmit(
  keys: readonly string[] | undefined,
  ...candidates: readonly string[]
): boolean {
  return keys !== undefined && candidates.some((candidate) => keys.includes(candidate));
}

interface RunnerState {
  readonly runId?: string;
  readonly agentId?: string;
  doneEmitted: boolean;
  finishCallbackEmitted: boolean;
  thinkingItemId?: string;
  thinkingEncryptedContent?: string;
  thinkingSignature?: string;
  readonly toolNamesById: Map<string, string>;
}

interface DiagnosticsState {
  textDeltaCount: number;
  reasoningDeltaCount: number;
  toolCallDeltaCount: number;
  sawDone: boolean;
  sawError: boolean;
  stalled: boolean;
  openaiServiceTier?: string;
}

function providerMetadataText(
  metadata: OpenCodeLLM.ProviderMetadata | undefined,
  provider: string,
  ...keys: readonly string[]
): string | undefined {
  const values = metadata?.[provider];
  if (!values) return undefined;
  for (const key of keys) {
    const value = values[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'unknown upstream error';
}

function outputValue(event: OpenCodeLLM.ToolResult): unknown {
  if (event.output !== undefined) return event.output.structured;
  return event.result.value;
}

function diagnosticsSnapshot(diagnostics: DiagnosticsState): {
  readonly textDeltaCount: number;
  readonly reasoningDeltaCount: number;
  readonly toolCallDeltaCount: number;
  readonly sawDone: boolean;
  readonly sawError: boolean;
  readonly stalled: boolean;
  readonly openaiServiceTier?: string;
} {
  return { ...diagnostics };
}

function makeSignalEffect(
  signal: AbortSignal | undefined,
  onAbort: () => void,
): Effect.Effect<void> {
  if (!signal) return Effect.never;
  return Effect.callback<void>((resume) => {
    const abort = () => {
      onAbort();
      resume(Effect.void);
    };
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
    return Effect.sync(() => signal.removeEventListener('abort', abort));
  });
}

function reportFinish(
  input: RunUpstreamStreamInput,
  state: RunnerState,
  reason: string | undefined,
  usage: OpenCodeLLM.Usage | undefined,
  providerMetadata: OpenCodeLLM.ProviderMetadata | undefined,
): void {
  if (state.finishCallbackEmitted || !input.onFinish || usage === undefined) return;
  state.finishCallbackEmitted = true;
  try {
    input.onFinish({
      finishReason: reason,
      ...(providerMetadata === undefined ? {} : { providerMetadata }),
      usage: {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
        reasoningTokens: usage.reasoningTokens,
        cachedInputTokens: usage.cacheReadInputTokens,
        inputTokenDetails: {
          cacheReadTokens: usage.cacheReadInputTokens,
          cacheWriteTokens: usage.cacheWriteInputTokens,
        },
        outputTokenDetails: { reasoningTokens: usage.reasoningTokens },
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[stream-runner] onFinish callback failed', message);
  }
}

function makeMapper(
  input: RunUpstreamStreamInput,
  state: RunnerState,
  diagnostics: DiagnosticsState,
): (event: OpenCodeLLM.LLMEvent) => readonly RunUpstreamStreamEvent[] {
  const meta = (extra: Record<string, unknown>) => ({
    ...(state.runId === undefined ? {} : { runId: state.runId }),
    ...(state.agentId === undefined ? {} : { agentId: state.agentId }),
    occurredAt: Date.now(),
    ...extra,
  });

  return (event) => {
    switch (event.type) {
      case 'step-start':
      case 'text-start':
      case 'text-end':
      case 'tool-input-end':
        return [];
      case 'text-delta':
        diagnostics.textDeltaCount += 1;
        input.onDiagnostics?.(diagnosticsSnapshot(diagnostics));
        return [{ type: 'text_delta', delta: event.text, ...meta({}) }];
      case 'reasoning-start':
        state.thinkingItemId = event.id;
        state.thinkingEncryptedContent =
          providerMetadataText(
            event.providerMetadata,
            'openai',
            'reasoningEncryptedContent',
            'encryptedContent',
          ) ??
          providerMetadataText(
            event.providerMetadata,
            'responses',
            'reasoningEncryptedContent',
            'encryptedContent',
          );
        return [{ type: 'thinking_start', itemId: event.id, ...meta({}) }];
      case 'reasoning-delta': {
        diagnostics.reasoningDeltaCount += 1;
        const signature =
          providerMetadataText(event.providerMetadata, 'anthropic', 'signature') ??
          providerMetadataText(event.providerMetadata, 'bedrock', 'signature');
        if (signature !== undefined) state.thinkingSignature = signature;
        input.onDiagnostics?.(diagnosticsSnapshot(diagnostics));
        return [{ type: 'thinking_delta', delta: event.text, itemId: event.id, ...meta({}) }];
      }
      case 'reasoning-end': {
        const signature =
          state.thinkingSignature ??
          providerMetadataText(event.providerMetadata, 'anthropic', 'signature') ??
          providerMetadataText(event.providerMetadata, 'bedrock', 'signature');
        const encryptedContent =
          state.thinkingEncryptedContent ??
          providerMetadataText(
            event.providerMetadata,
            'openai',
            'reasoningEncryptedContent',
            'encryptedContent',
          );
        state.thinkingSignature = undefined;
        state.thinkingEncryptedContent = undefined;
        state.thinkingItemId = undefined;
        const providerMetadata =
          signature === undefined && encryptedContent === undefined
            ? undefined
            : {
                ...(signature === undefined ? {} : { signature }),
                ...(encryptedContent === undefined ? {} : { encryptedContent }),
              };
        return [
          {
            type: 'thinking_end',
            itemId: event.id,
            ...(providerMetadata === undefined ? {} : { providerMetadata }),
            ...meta({}),
          },
        ];
      }
      case 'tool-input-start':
        state.toolNamesById.set(event.id, event.name);
        diagnostics.toolCallDeltaCount += 1;
        input.onDiagnostics?.(diagnosticsSnapshot(diagnostics));
        return [
          {
            type: 'tool_call_delta',
            toolCallId: event.id,
            toolName: event.name,
            inputDelta: '',
            ...meta({}),
          },
        ];
      case 'tool-input-delta':
        state.toolNamesById.set(event.id, event.name);
        diagnostics.toolCallDeltaCount += 1;
        input.onDiagnostics?.(diagnosticsSnapshot(diagnostics));
        return [
          {
            type: 'tool_call_delta',
            toolCallId: event.id,
            toolName: event.name,
            inputDelta: event.text,
            ...meta({}),
          },
        ];
      case 'tool-call': {
        const toolName = event.name || state.toolNamesById.get(event.id) || '';
        if (toolName.length === 0) return [];
        const hadInputDeltas = state.toolNamesById.has(event.id);
        state.toolNamesById.set(event.id, toolName);
        const metadata = event.providerMetadata;
        const inputDelta =
          typeof event.input === 'string' ? event.input : (JSON.stringify(event.input) ?? '');
        const closer =
          metadata === undefined || Object.keys(metadata).length === 0
            ? undefined
            : {
                type: 'tool_call_delta' as const,
                toolCallId: event.id,
                toolName,
                inputDelta: '',
                providerMetadata: metadata,
                ...meta({}),
              };
        const output = hadInputDeltas
          ? closer === undefined
            ? []
            : [closer]
          : [
              {
                type: 'tool_call_delta' as const,
                toolCallId: event.id,
                toolName,
                inputDelta: '',
                ...meta({}),
              },
              ...(inputDelta.length === 0
                ? []
                : [
                    {
                      type: 'tool_call_delta' as const,
                      toolCallId: event.id,
                      toolName,
                      inputDelta,
                      ...meta({}),
                    },
                  ]),
              ...(closer === undefined ? [] : [closer]),
            ];
        diagnostics.toolCallDeltaCount += output.length;
        input.onDiagnostics?.(diagnosticsSnapshot(diagnostics));
        return output;
      }
      case 'tool-result':
        return [
          {
            type: 'tool_result',
            toolCallId: event.id,
            toolName: event.name,
            output: outputValue(event),
            isError: event.result.type === 'error',
            ...meta({}),
          },
        ];
      case 'tool-error':
        diagnostics.sawError = true;
        input.onDiagnostics?.(diagnosticsSnapshot(diagnostics));
        return [
          {
            type: 'error',
            code: 'TOOL_ERROR',
            message: event.message,
            ...meta({}),
          },
        ];
      case 'step-finish': {
        const serviceTier = providerMetadataText(
          event.providerMetadata,
          'openai',
          'serviceTier',
          'service_tier',
        );
        if (serviceTier !== undefined) diagnostics.openaiServiceTier = serviceTier;
        reportFinish(input, state, event.reason, event.usage, event.providerMetadata);
        return [];
      }
      case 'finish': {
        const serviceTier = providerMetadataText(
          event.providerMetadata,
          'openai',
          'serviceTier',
          'service_tier',
        );
        if (serviceTier !== undefined) diagnostics.openaiServiceTier = serviceTier;
        reportFinish(input, state, event.reason, event.usage, event.providerMetadata);
        if (state.doneEmitted) return [];
        state.doneEmitted = true;
        diagnostics.sawDone = true;
        input.onDiagnostics?.(diagnosticsSnapshot(diagnostics));
        return [{ type: 'done', stopReason: mapFinishReason(event.reason), ...meta({}) }];
      }
      case 'provider-error':
        diagnostics.sawError = true;
        input.onDiagnostics?.(diagnosticsSnapshot(diagnostics));
        return [
          {
            type: 'error',
            code: 'MODEL_ERROR',
            status: 502,
            message: event.message,
            ...meta({}),
          },
        ];
      default: {
        const _exhaustive: never = event;
        void _exhaustive;
        return [];
      }
    }
  };
}

function buildGeneration(
  input: RunUpstreamStreamInput,
): OpenCodeLLM.GenerationOptions.Input | undefined {
  const omit = input.requestOverrides?.omitBodyKeys;
  const temperature = input.requestOverrides?.temperature ?? input.temperature;
  const maxTokens = input.requestOverrides?.maxTokens ?? input.maxOutputTokens;
  const topP = input.requestOverrides?.topP ?? input.topP;
  const frequencyPenalty = input.requestOverrides?.frequencyPenalty ?? input.frequencyPenalty;
  const presencePenalty = input.requestOverrides?.presencePenalty ?? input.presencePenalty;
  const generation: {
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    frequencyPenalty?: number;
    presencePenalty?: number;
  } = {};
  if (typeof temperature === 'number' && !shouldOmit(omit, 'temperature'))
    generation.temperature = temperature;
  if (
    typeof maxTokens === 'number' &&
    !shouldOmit(omit, 'max_tokens', 'max_output_tokens', 'maxOutputTokens')
  ) {
    generation.maxTokens = maxTokens;
  }
  if (typeof topP === 'number' && !shouldOmit(omit, 'top_p', 'topP')) generation.topP = topP;
  if (
    typeof frequencyPenalty === 'number' &&
    !shouldOmit(omit, 'frequency_penalty', 'frequencyPenalty')
  ) {
    generation.frequencyPenalty = frequencyPenalty;
  }
  if (
    typeof presencePenalty === 'number' &&
    !shouldOmit(omit, 'presence_penalty', 'presencePenalty')
  ) {
    generation.presencePenalty = presencePenalty;
  }
  return Object.keys(generation).length === 0 ? undefined : generation;
}

export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 600_000;

export function runUpstreamStream(input: RunUpstreamStreamInput): NativeUpstreamStream {
  const state: RunnerState = {
    ...(input.runId === undefined ? {} : { runId: input.runId }),
    ...(input.agentId === undefined ? {} : { agentId: input.agentId }),
    doneEmitted: false,
    finishCallbackEmitted: false,
    toolNamesById: new Map<string, string>(),
  };
  const diagnostics: DiagnosticsState = {
    textDeltaCount: 0,
    reasoningDeltaCount: 0,
    toolCallDeltaCount: 0,
    sawDone: false,
    sawError: false,
    stalled: false,
  };
  const modelId = input.modelId ?? input.model.id;
  const transformedMessages = applyProviderMessageTransforms(input.messages, {
    providerType: input.providerType,
    model: modelId,
  });
  const system =
    input.system === undefined || typeof input.system === 'string'
      ? input.system === undefined
        ? undefined
        : sanitizeSurrogates(input.system)
      : (Array.isArray(input.system) ? input.system : [input.system]).map((part) => ({
          ...part,
          text: sanitizeSurrogates(part.text),
        }));
  const incomingTools = input.tools;
  const needsStub =
    (incomingTools === undefined || Object.keys(incomingTools).length === 0) &&
    hasToolCallsInHistory(transformedMessages) &&
    shouldInjectNoopStub({ litellmProxy: input.litellmProxy, providerType: input.providerType });
  const effectiveTools = needsStub
    ? { _noop: NOOP_TOOL_DEFINITION }
    : sortToolsByName(incomingTools);
  const diagnosticsReport = () => input.onDiagnostics?.(diagnosticsSnapshot(diagnostics));
  const mapper = makeMapper(input, state, diagnostics);
  const generation = buildGeneration(input);
  const thinkingProviderOptions = buildProviderOptions({
    ...(input.thinking === undefined ? {} : { thinking: input.thinking }),
    ...(input.providerType === undefined ? {} : { providerType: input.providerType }),
    ...(input.upstreamProtocol === undefined ? {} : { upstreamProtocol: input.upstreamProtocol }),
    model: modelId,
  });
  const providerOptions = mergeProviderOptions(
    buildBaseProviderOptions({
      model: modelId,
      providerType: input.providerType,
      sessionId: input.sessionId,
      openaiFastMode: input.openaiFastMode,
    }),
    thinkingProviderOptions,
  );
  const chatParamsOutput: {
    temperature?: number;
    topP?: number;
    maxOutputTokens?: number;
    options: Record<string, unknown>;
  } = { options: {} };
  const initialGeneration = generation;
  if (initialGeneration?.temperature !== undefined)
    chatParamsOutput.temperature = initialGeneration.temperature;
  if (initialGeneration?.topP !== undefined) chatParamsOutput.topP = initialGeneration.topP;
  if (initialGeneration?.maxTokens !== undefined)
    chatParamsOutput.maxOutputTokens = initialGeneration.maxTokens;
  if (initialGeneration?.frequencyPenalty !== undefined)
    chatParamsOutput.options['frequencyPenalty'] = initialGeneration.frequencyPenalty;
  if (initialGeneration?.presencePenalty !== undefined)
    chatParamsOutput.options['presencePenalty'] = initialGeneration.presencePenalty;
  const cancelled = { value: false };
  const source = Stream.unwrap(
    Effect.promise(() =>
      dispatchChatParams({ sessionID: input.sessionId ?? '', modelId }, chatParamsOutput),
    ).pipe(
      Effect.map(() => {
        const resolvedGeneration: OpenCodeLLM.GenerationOptions.Input = {
          ...(chatParamsOutput.temperature === undefined
            ? {}
            : { temperature: chatParamsOutput.temperature }),
          ...(chatParamsOutput.maxOutputTokens === undefined
            ? {}
            : { maxTokens: chatParamsOutput.maxOutputTokens }),
          ...(chatParamsOutput.topP === undefined ? {} : { topP: chatParamsOutput.topP }),
          ...(typeof chatParamsOutput.options['frequencyPenalty'] === 'number'
            ? { frequencyPenalty: chatParamsOutput.options['frequencyPenalty'] }
            : {}),
          ...(typeof chatParamsOutput.options['presencePenalty'] === 'number'
            ? { presencePenalty: chatParamsOutput.options['presencePenalty'] }
            : {}),
        };
        const body = input.requestOverrides?.body;
        const headers = input.requestOverrides?.headers;
        const http =
          body === undefined && headers === undefined
            ? undefined
            : {
                ...(body === undefined ? {} : { body }),
                ...(headers === undefined ? {} : { headers }),
              };
        const request = OpenCodeLLM.LLM.request({
          model: input.model,
          ...(system === undefined ? {} : { system }),
          messages: transformedMessages,
          tools: effectiveTools === undefined ? [] : Object.values(effectiveTools),
          ...(Object.keys(resolvedGeneration).length === 0
            ? {}
            : { generation: resolvedGeneration }),
          ...(providerOptions === undefined ? {} : { providerOptions }),
          ...(http === undefined ? {} : { http }),
        });
        return OpenCodeLLM.LLMClient.stream(request).pipe(Stream.provide(nativeStreamLayer));
      }),
    ),
  );
  let translated: NativeUpstreamStream = source.pipe(
    Stream.flatMap((event) => Stream.fromIterable(mapper(event))),
    Stream.catch((error) => {
      diagnostics.sawError = true;
      state.doneEmitted = true;
      diagnosticsReport();
      const chunk: StreamErrorChunk & { readonly status: number } = {
        type: 'error',
        code: 'MODEL_ERROR',
        status: 502,
        message: errorMessage(error),
        ...(input.runId === undefined ? {} : { runId: input.runId }),
        ...(input.agentId === undefined ? {} : { agentId: input.agentId }),
        occurredAt: Date.now(),
      };
      return Stream.succeed(chunk);
    }),
  );
  const idleTimeoutMs = input.idleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS;
  if (Number.isFinite(idleTimeoutMs) && idleTimeoutMs > 0) {
    translated = translated.pipe(Stream.timeout(Duration.millis(idleTimeoutMs)));
  }
  if (input.signal !== undefined) {
    const abortChunk: StreamErrorChunk = {
      type: 'error',
      code: 'ABORTED',
      message: 'upstream stream aborted',
      ...(input.runId === undefined ? {} : { runId: input.runId }),
      occurredAt: Date.now(),
    };
    const abortStream = Stream.fromEffect(
      makeSignalEffect(input.signal, () => {
        cancelled.value = true;
      }).pipe(Effect.as(abortChunk)),
    );
    translated = Stream.merge(translated, abortStream, { haltStrategy: 'either' });
  }
  return translated.pipe(
    Stream.concat(
      Stream.unwrap(
        Effect.sync(() =>
          Stream.fromIterable(
            (() => {
              if (cancelled.value) {
                diagnostics.sawError = true;
                diagnosticsReport();
                return [];
              }
              if (!state.doneEmitted) {
                diagnostics.stalled = true;
                diagnostics.sawError = true;
                diagnosticsReport();
                return [
                  {
                    type: 'error' as const,
                    code: 'STREAM_STALL',
                    message: `upstream stream stalled (no data for ${idleTimeoutMs}ms)`,
                    ...(input.runId === undefined ? {} : { runId: input.runId }),
                    occurredAt: Date.now(),
                  } satisfies StreamErrorChunk,
                ];
              }
              diagnosticsReport();
              return [];
            })(),
          ),
        ),
      ),
    ),
    Stream.filter(
      (chunk) => chunk.type !== 'error' || chunk.code !== 'STREAM_STALL' || !state.doneEmitted,
    ),
  );
}
