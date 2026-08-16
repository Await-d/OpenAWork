import { Effect, Schema } from "effect";
import { ToolDefinition, ToolFailure, ToolOutput } from "./schema/index.js";
export function make(config) {
    if ("jsonSchema" in config) {
        return {
            description: config.description,
            parameters: Schema.Unknown,
            success: Schema.Unknown,
            execute: config.execute,
            toModelOutput: config.toModelOutput,
            toStructuredOutput: config.toStructuredOutput,
            _decode: Effect.succeed,
            _encode: Effect.succeed,
            _project: (parameters, callID, output) => project(config.toModelOutput, config.toStructuredOutput, parameters, callID, output),
            _legacyResult: config.toModelOutput === undefined && config.toStructuredOutput === undefined,
            _definition: new ToolDefinition({
                name: "",
                description: config.description,
                inputSchema: config.jsonSchema,
                outputSchema: config.outputSchema,
            }),
        };
    }
    return {
        description: config.description,
        parameters: config.parameters,
        success: config.success,
        execute: config.execute,
        toModelOutput: config.toModelOutput,
        toStructuredOutput: config.toStructuredOutput,
        _decode: Schema.decodeUnknownEffect(config.parameters),
        _encode: Schema.encodeEffect(config.success),
        _project: (parameters, callID, output) => project(config.toModelOutput, config.toStructuredOutput, parameters, callID, output),
        _legacyResult: false,
        _definition: new ToolDefinition({
            name: "",
            description: config.description,
            inputSchema: toJsonSchema(config.parameters),
            outputSchema: toJsonSchema(config.success),
        }),
    };
}
/**
 * Convert a tools record into the `ToolDefinition[]` shape that
 * `LLMRequest.tools` expects.
 *
 * Tool names come from the record keys, so the per-tool cached
 * `_definition` is rebuilt with the correct name here. The JSON Schema body
 * is reused.
 */
export const toDefinitions = (tools) => Object.entries(tools).map(([name, item]) => new ToolDefinition({
    name,
    description: item._definition.description,
    inputSchema: item._definition.inputSchema,
    outputSchema: item._definition.outputSchema,
}));
const toJsonSchema = (schema) => {
    const document = Schema.toJsonSchemaDocument(schema);
    if (Object.keys(document.definitions).length === 0)
        return document.schema;
    return { ...document.schema, $defs: document.definitions };
};
const project = (toModelOutput, toStructuredOutput, parameters, callID, output) => ToolOutput.make(toStructuredOutput?.(output) ?? output, toModelOutput?.({ callID, parameters, output }) ??
    (typeof output === "string" ? [{ type: "text", text: output }] : []));
export { ToolFailure };
export * as Tool from "./tool.js";
//# sourceMappingURL=tool.js.map