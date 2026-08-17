import { Effect } from "effect";
import { LLMError, LLMEvent } from "../../schema/index.js";
import { eventError, parseToolInput } from "../shared.js";
/** Create empty accumulator state for one provider stream. */
export const empty = () => ({});
const withTool = (tools, key, tool) => {
    return { ...tools, [key]: tool };
};
const withoutTool = (tools, key) => {
    const next = { ...tools };
    delete next[key];
    return next;
};
const inputStart = (tool) => LLMEvent.toolInputStart({
    id: tool.id,
    name: tool.name,
    providerMetadata: tool.providerMetadata,
});
const inputDelta = (tool, text) => LLMEvent.toolInputDelta({
    id: tool.id,
    name: tool.name,
    text,
});
const toolCall = (route, tool, inputOverride) => parseToolInput(route, tool.name, inputOverride ?? tool.input).pipe(Effect.map((input) => LLMEvent.toolCall({
    id: tool.id,
    name: tool.name,
    input,
    providerExecuted: tool.providerExecuted ? true : undefined,
    providerMetadata: tool.providerMetadata,
})));
/** Store the updated tool and produce the optional public delta event. */
const appendTool = (tools, key, tool, text) => {
    const events = [];
    if (!tools[key])
        events.push(inputStart(tool));
    if (text.length > 0)
        events.push(inputDelta(tool, text));
    return {
        tools: withTool(tools, key, tool),
        tool,
        events,
    };
};
export const isError = (result) => result instanceof LLMError;
/**
 * Register a tool call whose start event arrived before any argument deltas.
 * Used by Anthropic `content_block_start`, Bedrock `contentBlockStart`, and
 * OpenAI Responses `response.output_item.added`.
 */
export const start = (tools, key, tool) => withTool(tools, key, { ...tool, input: tool.input ?? "" });
/**
 * Append a streamed argument delta, starting the tool if this provider encodes
 * identity on the first delta instead of a separate start event. OpenAI Chat has
 * this shape: `tool_calls[].index` is the stream key, and `id` / `name` may only
 * appear on the first delta for that index.
 */
export const appendOrStart = (route, tools, key, delta, missingToolMessage) => {
    const current = tools[key];
    const id = delta.id ?? current?.id;
    const name = delta.name ?? current?.name;
    if (!id || !name)
        return eventError(route, missingToolMessage);
    const tool = {
        id,
        name,
        input: `${current?.input ?? ""}${delta.text}`,
        providerExecuted: current?.providerExecuted,
        providerMetadata: current?.providerMetadata,
    };
    if (current && delta.text.length === 0 && current.id === id && current.name === name)
        return { tools, tool: current, events: [] };
    return appendTool(tools, key, tool, delta.text);
};
/**
 * Append argument text to a tool that must already have been started. This keeps
 * protocols honest when their stream grammar promises a start event before any
 * argument delta.
 */
export const appendExisting = (route, tools, key, text, missingToolMessage) => {
    const current = tools[key];
    if (!current)
        return eventError(route, missingToolMessage);
    if (text.length === 0)
        return { tools, tool: current, events: [] };
    return appendTool(tools, key, { ...current, input: `${current.input}${text}` }, text);
};
/**
 * Finalize one pending tool call: parse the accumulated raw JSON, remove it
 * from state, and return the optional public `tool-call` event. Missing keys are
 * a no-op because some providers emit stop events for non-tool content blocks.
 */
export const finish = (route, tools, key) => Effect.gen(function* () {
    const tool = tools[key];
    if (!tool)
        return { tools };
    return {
        tools: withoutTool(tools, key),
        events: [
            LLMEvent.toolInputEnd({ id: tool.id, name: tool.name, providerMetadata: tool.providerMetadata }),
            yield* toolCall(route, tool),
        ],
    };
});
/**
 * Finalize one pending tool call with an authoritative final input string.
 * OpenAI Responses can send accumulated deltas and then repeat the completed
 * arguments on `response.output_item.done`; the final value wins.
 */
export const finishWithInput = (route, tools, key, input) => Effect.gen(function* () {
    const tool = tools[key];
    if (!tool)
        return { tools };
    return {
        tools: withoutTool(tools, key),
        events: [
            LLMEvent.toolInputEnd({ id: tool.id, name: tool.name, providerMetadata: tool.providerMetadata }),
            yield* toolCall(route, tool, input),
        ],
    };
});
/**
 * Finalize every pending tool call at once. OpenAI Chat has this shape: it does
 * not emit per-tool stop events, so all accumulated calls finish when the choice
 * receives a terminal `finish_reason`.
 */
export const finishAll = (route, tools) => Effect.gen(function* () {
    const pending = Object.values(tools).filter((tool) => tool !== undefined);
    return {
        tools: empty(),
        events: yield* Effect.forEach(pending, (tool) => toolCall(route, tool).pipe(Effect.map((call) => [
            LLMEvent.toolInputEnd({ id: tool.id, name: tool.name, providerMetadata: tool.providerMetadata }),
            call,
        ]))).pipe(Effect.map((events) => events.flat())),
    };
});
export * as ToolStream from "./tool-stream.js";
//# sourceMappingURL=tool-stream.js.map