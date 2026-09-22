import { Effect, Option } from 'effect';
import { LLMError, LLMEvent, type ProviderMetadata, type ToolCall } from '../../schema/index.js';
import { eventError, parseToolInput, type ToolAccumulator } from '../shared.js';
import { parse } from './partial-json.js';

type StreamKey = string | number;
const parsePartialInput = Option.liftThrowable(parse);

/**
 * One pending streamed tool call. Providers emit the tool identity and JSON
 * argument text across separate chunks; `input` is the raw JSON string collected
 * so far, not the parsed object.
 */
export interface PendingTool extends ToolAccumulator {
  readonly providerExecuted?: boolean;
  readonly providerMetadata?: ProviderMetadata;
}

/**
 * Sparse parser state keyed by the provider's stream-local tool identifier.
 *
 * This key is not the final tool-call id (`call_...`). It is the id/index the
 * provider uses while streaming a partial call: OpenAI Chat / Anthropic /
 * Bedrock use numeric content indexes, while OpenAI Responses uses string
 * `item_id`s. The generic keeps each protocol internally consistent.
 */
export type State<K extends StreamKey> = Partial<Record<K, PendingTool>>;

/**
 * Result of adding argument text to one pending tool call. It returns both the
 * next `tools` state and the updated `tool` because parsers often need the
 * current id/name immediately. `events` contains lifecycle and delta events
 * produced by the append; metadata-only deltas update identity without output.
 */
export interface AppendOutcome<K extends StreamKey> {
  readonly tools: State<K>;
  readonly tool: PendingTool;
  readonly events: ReadonlyArray<LLMEvent>;
}

/** Create empty accumulator state for one provider stream. */
export const empty = <K extends StreamKey>(): State<K> => ({});

const withTool = <K extends StreamKey>(tools: State<K>, key: K, tool: PendingTool): State<K> => {
  return { ...tools, [key]: tool };
};

const withoutTool = <K extends StreamKey>(tools: State<K>, key: K): State<K> => {
  const next = { ...tools };
  delete next[key];
  return next;
};

const inputStart = (tool: PendingTool) =>
  LLMEvent.toolInputStart({
    id: tool.id,
    name: tool.name,
    providerMetadata: tool.providerMetadata,
  });

const inputDelta = (tool: PendingTool, text: string) =>
  LLMEvent.toolInputDelta({
    id: tool.id,
    name: tool.name,
    text,
  });

/**
 * Finalize one pending tool call's argument JSON. Providers sometimes emit
 * arguments that are not strictly valid JSON (a raw control character inside a
 * string, a stray backslash) even though the call itself is complete. Failing
 * the whole stream for a locally-executed tool is wasteful: the tool would
 * simply have rejected the input and let the model self-correct. Fall back to a
 * best-effort partial parse, and finally to `{}`, so the round survives.
 *
 * Provider-executed (hosted) tool calls stay strict: their input is passed
 * straight back to the provider on the next turn, so a lossy recovery would be
 * silently wrong rather than locally recoverable.
 */
const toolCall = (
  route: string,
  tool: PendingTool,
  inputOverride?: string,
): Effect.Effect<ToolCall, LLMError> => {
  const raw = inputOverride ?? tool.input;
  return parseToolInput(route, tool.name, raw).pipe(
    Effect.catch((error) =>
      tool.providerExecuted
        ? Effect.fail(error)
        : Effect.succeed(
            Option.getOrElse(
              Option.map(parsePartialInput(raw), (input) => input ?? {}),
              () => ({}),
            ),
          ),
    ),
    Effect.map((input): ToolCall =>
      LLMEvent.toolCall({
        id: tool.id,
        name: tool.name,
        input,
        providerExecuted: tool.providerExecuted ? true : undefined,
        providerMetadata: tool.providerMetadata,
      }),
    ),
  );
};

/** Store the updated tool and produce the optional public delta event. */
const appendTool = <K extends StreamKey>(
  tools: State<K>,
  key: K,
  tool: PendingTool,
  text: string,
): AppendOutcome<K> => {
  const events: LLMEvent[] = [];
  if (!tools[key]) events.push(inputStart(tool));
  if (text.length > 0) events.push(inputDelta(tool, text));
  return {
    tools: withTool(tools, key, tool),
    tool,
    events,
  };
};

export const isError = <K extends StreamKey>(
  result: AppendOutcome<K> | LLMError,
): result is LLMError => result instanceof LLMError;

/**
 * Register a tool call whose start event arrived before any argument deltas.
 * Used by Anthropic `content_block_start`, Bedrock `contentBlockStart`, and
 * OpenAI Responses `response.output_item.added`.
 */
export const start = <K extends StreamKey>(
  tools: State<K>,
  key: K,
  tool: Omit<PendingTool, 'input'> & { readonly input?: string },
) => withTool(tools, key, { ...tool, input: tool.input ?? '' });

/**
 * Append a streamed argument delta, starting the tool if this provider encodes
 * identity on the first delta instead of a separate start event. OpenAI Chat has
 * this shape: `tool_calls[].index` is the stream key, and `id` / `name` may only
 * appear on the first delta for that index.
 */
export const appendOrStart = <K extends StreamKey>(
  route: string,
  tools: State<K>,
  key: K,
  delta: { readonly id?: string; readonly name?: string; readonly text: string },
  missingToolMessage: string,
): AppendOutcome<K> | LLMError => {
  const current = tools[key];
  // An already-registered identity is frozen: later deltas may repeat a
  // different/blank id, and re-keying mid-call would split one tool call into
  // two downstream. A blank delta id/name means "unchanged".
  const id = current?.id ?? (delta.id?.trim() ? delta.id.trim() : undefined);
  const name = current?.name ?? (delta.name?.trim() ? delta.name.trim() : undefined);
  if (!id || !name) return eventError(route, missingToolMessage);

  const tool = {
    id,
    name,
    input: `${current?.input ?? ''}${delta.text}`,
    providerExecuted: current?.providerExecuted,
    providerMetadata: current?.providerMetadata,
  };
  if (current && delta.text.length === 0 && current.id === id && current.name === name)
    return { tools, tool: current, events: [] };
  return appendTool(tools, key, tool, delta.text);
};

/**
 * Append argument text to a started tool. Returns `undefined` when no tool is
 * open under `key`, for protocols that intentionally ignore deltas without a
 * matching open block (Bedrock can emit a late delta after `contentBlockStop`,
 * or a delta for an index that never started).
 */
export const append = <K extends StreamKey>(
  tools: State<K>,
  key: K,
  text: string,
): AppendOutcome<K> | undefined => {
  const current = tools[key];
  if (!current) return undefined;
  if (text.length === 0) return { tools, tool: current, events: [] };
  return appendTool(tools, key, { ...current, input: `${current.input}${text}` }, text);
};

/**
 * Append argument text to a tool that must already have been started. This keeps
 * protocols honest when their stream grammar promises a start event before any
 * argument delta.
 */
export const appendExisting = <K extends StreamKey>(
  route: string,
  tools: State<K>,
  key: K,
  text: string,
  missingToolMessage: string,
): AppendOutcome<K> | LLMError => append(tools, key, text) ?? eventError(route, missingToolMessage);

/**
 * Finalize one pending tool call: parse the accumulated raw JSON, remove it
 * from state, and return the optional public `tool-call` event. Missing keys are
 * a no-op because some providers emit stop events for non-tool content blocks.
 */
export const finish = <K extends StreamKey>(route: string, tools: State<K>, key: K) =>
  Effect.gen(function* () {
    const tool = tools[key];
    if (!tool) return { tools };
    return {
      tools: withoutTool(tools, key),
      events: [
        LLMEvent.toolInputEnd({
          id: tool.id,
          name: tool.name,
          providerMetadata: tool.providerMetadata,
        }),
        yield* toolCall(route, tool),
      ],
    };
  });

/**
 * Finalize one pending tool call with an authoritative final input string.
 * OpenAI Responses can send accumulated deltas and then repeat the completed
 * arguments on `response.output_item.done`; the final value wins.
 */
export const finishWithInput = <K extends StreamKey>(
  route: string,
  tools: State<K>,
  key: K,
  input: string,
) =>
  Effect.gen(function* () {
    const tool = tools[key];
    if (!tool) return { tools };
    return {
      tools: withoutTool(tools, key),
      events: [
        LLMEvent.toolInputEnd({
          id: tool.id,
          name: tool.name,
          providerMetadata: tool.providerMetadata,
        }),
        yield* toolCall(route, tool, input),
      ],
    };
  });

/**
 * Finalize every pending tool call at once. OpenAI Chat has this shape: it does
 * not emit per-tool stop events, so all accumulated calls finish when the choice
 * receives a terminal `finish_reason`.
 */
export const finishAll = <K extends StreamKey>(route: string, tools: State<K>) =>
  Effect.gen(function* () {
    const pending = Object.values<PendingTool | undefined>(tools).filter(
      (tool): tool is PendingTool => tool !== undefined,
    );
    return {
      tools: empty<K>(),
      events: yield* Effect.forEach(pending, (tool) =>
        toolCall(route, tool).pipe(
          Effect.map((call) => [
            LLMEvent.toolInputEnd({
              id: tool.id,
              name: tool.name,
              providerMetadata: tool.providerMetadata,
            }),
            call,
          ]),
        ),
      ).pipe(Effect.map((events) => events.flat())),
    };
  });

export * as ToolStream from './tool-stream.js';
