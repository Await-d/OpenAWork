import { Schema } from "effect";
import { ModelID, ProviderID } from "./ids.js";
import type { AnyRoute } from "../route/client.js";
export declare const mergeJsonRecords: (...items: ReadonlyArray<Record<string, unknown> | undefined>) => Record<string, unknown> | undefined;
export declare const AnthropicContextManagement: Schema.Struct<{
    readonly edits: Schema.$Array<Schema.Union<readonly [Schema.Struct<{
        readonly type: Schema.Literal<"clear_thinking_20251015">;
        readonly keep: Schema.optional<Schema.Struct<{
            readonly type: Schema.Literal<"thinking_turns">;
            readonly value: Schema.Number;
        }>>;
    }>, Schema.Struct<{
        readonly type: Schema.Literal<"clear_tool_uses_20250919">;
        readonly trigger: Schema.optional<Schema.Struct<{
            readonly type: Schema.Literal<"input_tokens">;
            readonly value: Schema.Number;
        }>>;
        readonly keep: Schema.optional<Schema.Struct<{
            readonly type: Schema.Literal<"tool_uses">;
            readonly value: Schema.Number;
        }>>;
        readonly clear_at_least: Schema.optional<Schema.Struct<{
            readonly type: Schema.Literal<"input_tokens">;
            readonly value: Schema.Number;
        }>>;
        readonly exclude_tools: Schema.optional<Schema.$Array<Schema.String>>;
    }>]>>;
}>;
export type AnthropicContextManagement = Schema.Schema.Type<typeof AnthropicContextManagement>;
export declare const AnthropicProviderOptions: Schema.StructWithRest<Schema.Struct<{
    readonly contextManagement: Schema.optional<Schema.Struct<{
        readonly edits: Schema.$Array<Schema.Union<readonly [Schema.Struct<{
            readonly type: Schema.Literal<"clear_thinking_20251015">;
            readonly keep: Schema.optional<Schema.Struct<{
                readonly type: Schema.Literal<"thinking_turns">;
                readonly value: Schema.Number;
            }>>;
        }>, Schema.Struct<{
            readonly type: Schema.Literal<"clear_tool_uses_20250919">;
            readonly trigger: Schema.optional<Schema.Struct<{
                readonly type: Schema.Literal<"input_tokens">;
                readonly value: Schema.Number;
            }>>;
            readonly keep: Schema.optional<Schema.Struct<{
                readonly type: Schema.Literal<"tool_uses">;
                readonly value: Schema.Number;
            }>>;
            readonly clear_at_least: Schema.optional<Schema.Struct<{
                readonly type: Schema.Literal<"input_tokens">;
                readonly value: Schema.Number;
            }>>;
            readonly exclude_tools: Schema.optional<Schema.$Array<Schema.String>>;
        }>]>>;
    }>>;
}>, readonly [Schema.$Record<Schema.String, Schema.Unknown>]>;
export type AnthropicProviderOptions = Schema.Schema.Type<typeof AnthropicProviderOptions>;
export declare const ProviderOptions: Schema.StructWithRest<Schema.Struct<{
    readonly anthropic: Schema.optional<Schema.StructWithRest<Schema.Struct<{
        readonly contextManagement: Schema.optional<Schema.Struct<{
            readonly edits: Schema.$Array<Schema.Union<readonly [Schema.Struct<{
                readonly type: Schema.Literal<"clear_thinking_20251015">;
                readonly keep: Schema.optional<Schema.Struct<{
                    readonly type: Schema.Literal<"thinking_turns">;
                    readonly value: Schema.Number;
                }>>;
            }>, Schema.Struct<{
                readonly type: Schema.Literal<"clear_tool_uses_20250919">;
                readonly trigger: Schema.optional<Schema.Struct<{
                    readonly type: Schema.Literal<"input_tokens">;
                    readonly value: Schema.Number;
                }>>;
                readonly keep: Schema.optional<Schema.Struct<{
                    readonly type: Schema.Literal<"tool_uses">;
                    readonly value: Schema.Number;
                }>>;
                readonly clear_at_least: Schema.optional<Schema.Struct<{
                    readonly type: Schema.Literal<"input_tokens">;
                    readonly value: Schema.Number;
                }>>;
                readonly exclude_tools: Schema.optional<Schema.$Array<Schema.String>>;
            }>]>>;
        }>>;
    }>, readonly [Schema.$Record<Schema.String, Schema.Unknown>]>>;
}>, readonly [Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>]>;
export type ProviderOptions = Schema.Schema.Type<typeof ProviderOptions>;
export declare const mergeProviderOptions: (...items: ReadonlyArray<ProviderOptions | undefined>) => ProviderOptions | undefined;
declare const HttpOptions_base: Schema.Class<HttpOptions, Schema.Struct<{
    readonly body: Schema.optional<Schema.$Record<Schema.String, Schema.Unknown>>;
    readonly headers: Schema.optional<Schema.$Record<Schema.String, Schema.String>>;
    readonly query: Schema.optional<Schema.$Record<Schema.String, Schema.String>>;
}>, {}>;
export declare class HttpOptions extends HttpOptions_base {
}
export declare namespace HttpOptions {
    type Input = HttpOptions | ConstructorParameters<typeof HttpOptions>[0];
    /** Normalize HTTP option input into the canonical `HttpOptions` class. */
    const make: (input: Input) => HttpOptions;
}
export declare const mergeHttpOptions: (...items: ReadonlyArray<HttpOptions | undefined>) => HttpOptions | undefined;
declare const GenerationOptions_base: Schema.Class<GenerationOptions, Schema.Struct<{
    readonly maxTokens: Schema.optional<Schema.Number>;
    readonly temperature: Schema.optional<Schema.Number>;
    readonly topP: Schema.optional<Schema.Number>;
    readonly topK: Schema.optional<Schema.Number>;
    readonly frequencyPenalty: Schema.optional<Schema.Number>;
    readonly presencePenalty: Schema.optional<Schema.Number>;
    readonly seed: Schema.optional<Schema.Number>;
    readonly stop: Schema.optional<Schema.$Array<Schema.String>>;
}>, {}>;
export declare class GenerationOptions extends GenerationOptions_base {
}
export declare namespace GenerationOptions {
    type Input = GenerationOptions | ConstructorParameters<typeof GenerationOptions>[0];
    /** Normalize generation option input into the canonical `GenerationOptions` class. */
    const make: (input?: Input) => GenerationOptions;
}
export type GenerationOptionsFields = {
    readonly maxTokens?: number;
    readonly temperature?: number;
    readonly topP?: number;
    readonly topK?: number;
    readonly frequencyPenalty?: number;
    readonly presencePenalty?: number;
    readonly seed?: number;
    readonly stop?: ReadonlyArray<string>;
};
export type GenerationOptionsInput = GenerationOptions | GenerationOptionsFields;
export declare const mergeGenerationOptions: (...items: ReadonlyArray<GenerationOptionsInput | undefined>) => GenerationOptions | undefined;
declare const ModelLimits_base: Schema.Class<ModelLimits, Schema.Struct<{
    readonly context: Schema.optional<Schema.Number>;
    readonly output: Schema.optional<Schema.Number>;
}>, {}>;
export declare class ModelLimits extends ModelLimits_base {
}
export declare namespace ModelLimits {
    type Input = ModelLimits | ConstructorParameters<typeof ModelLimits>[0];
    /** Normalize model limit input into the canonical `ModelLimits` class. */
    const make: (input: Input | undefined) => ModelLimits;
}
declare const ModelDefaults_base: Schema.Class<ModelDefaults, Schema.Struct<{
    readonly limits: Schema.optional<typeof ModelLimits>;
    readonly generation: Schema.optional<typeof GenerationOptions>;
    readonly providerOptions: Schema.optional<Schema.StructWithRest<Schema.Struct<{
        readonly anthropic: Schema.optional<Schema.StructWithRest<Schema.Struct<{
            readonly contextManagement: Schema.optional<Schema.Struct<{
                readonly edits: Schema.$Array<Schema.Union<readonly [Schema.Struct<{
                    readonly type: Schema.Literal<"clear_thinking_20251015">;
                    readonly keep: Schema.optional<Schema.Struct<{
                        readonly type: Schema.Literal<"thinking_turns">;
                        readonly value: Schema.Number;
                    }>>;
                }>, Schema.Struct<{
                    readonly type: Schema.Literal<"clear_tool_uses_20250919">;
                    readonly trigger: Schema.optional<Schema.Struct<{
                        readonly type: Schema.Literal<"input_tokens">;
                        readonly value: Schema.Number;
                    }>>;
                    readonly keep: Schema.optional<Schema.Struct<{
                        readonly type: Schema.Literal<"tool_uses">;
                        readonly value: Schema.Number;
                    }>>;
                    readonly clear_at_least: Schema.optional<Schema.Struct<{
                        readonly type: Schema.Literal<"input_tokens">;
                        readonly value: Schema.Number;
                    }>>;
                    readonly exclude_tools: Schema.optional<Schema.$Array<Schema.String>>;
                }>]>>;
            }>>;
        }>, readonly [Schema.$Record<Schema.String, Schema.Unknown>]>>;
    }>, readonly [Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>]>>;
    readonly http: Schema.optional<typeof HttpOptions>;
}>, {}>;
export declare class ModelDefaults extends ModelDefaults_base {
}
export declare namespace ModelDefaults {
    type Input = ModelDefaults | {
        readonly limits?: ModelLimits.Input;
        readonly generation?: GenerationOptions.Input;
        readonly providerOptions?: ProviderOptions;
        readonly http?: HttpOptions.Input;
    };
    /** Normalize selected-model request defaults without applying precedence. */
    const make: (input: Input) => ModelDefaults;
}
export declare const ModelToolSchemaCompatibility: Schema.Literals<readonly ["gemini", "moonshot"]>;
export type ModelToolSchemaCompatibility = Schema.Schema.Type<typeof ModelToolSchemaCompatibility>;
declare const ModelCompatibility_base: Schema.Class<ModelCompatibility, Schema.Struct<{
    readonly toolSchema: Schema.optional<Schema.Literals<readonly ["gemini", "moonshot"]>>;
}>, {}>;
export declare class ModelCompatibility extends ModelCompatibility_base {
}
export declare namespace ModelCompatibility {
    type Input = ModelCompatibility | ConstructorParameters<typeof ModelCompatibility>[0];
    /** Normalize model/upstream compatibility metadata without projecting requests. */
    const make: (input: Input) => ModelCompatibility;
}
export declare class Model {
    readonly id: ModelID;
    readonly provider: ProviderID;
    readonly route: AnyRoute;
    readonly defaults?: ModelDefaults;
    readonly compatibility?: ModelCompatibility;
    constructor(input: Model.ConstructorInput);
    static make(input: Model.Input): Model;
    static input(model: Model): Model.ConstructorInput;
    static update(model: Model, patch: Partial<Model.Input>): Model;
}
export declare namespace Model {
    type ConstructorInput = {
        readonly id: ModelID;
        readonly provider: ProviderID;
        readonly route: AnyRoute;
        readonly defaults?: ModelDefaults;
        readonly compatibility?: ModelCompatibility;
    };
    type Input = Omit<ConstructorInput, "id" | "provider" | "defaults" | "compatibility"> & {
        readonly id: string | ModelID;
        readonly provider: string | ProviderID;
        readonly defaults?: ModelDefaults.Input;
        readonly compatibility?: ModelCompatibility.Input;
    };
}
export type ModelInput = Model.Input;
export declare const ModelSchema: Schema.declare<Model, Model>;
declare const CacheHint_base: Schema.Class<CacheHint, Schema.Struct<{
    readonly type: Schema.Literals<readonly ["ephemeral", "persistent"]>;
    readonly ttlSeconds: Schema.optional<Schema.Number>;
}>, {}>;
export declare class CacheHint extends CacheHint_base {
}
export declare const CachePolicyObject: Schema.Struct<{
    readonly tools: Schema.optional<Schema.Boolean>;
    readonly system: Schema.optional<Schema.Boolean>;
    readonly messages: Schema.optional<Schema.Union<readonly [Schema.Literal<"latest-user-message">, Schema.Literal<"latest-assistant">, Schema.Struct<{
        readonly tail: Schema.Number;
    }>]>>;
    readonly ttlSeconds: Schema.optional<Schema.Number>;
}>;
export type CachePolicyObject = Schema.Schema.Type<typeof CachePolicyObject>;
export declare const CachePolicy: Schema.Union<readonly [Schema.Literal<"auto">, Schema.Literal<"none">, Schema.Struct<{
    readonly tools: Schema.optional<Schema.Boolean>;
    readonly system: Schema.optional<Schema.Boolean>;
    readonly messages: Schema.optional<Schema.Union<readonly [Schema.Literal<"latest-user-message">, Schema.Literal<"latest-assistant">, Schema.Struct<{
        readonly tail: Schema.Number;
    }>]>>;
    readonly ttlSeconds: Schema.optional<Schema.Number>;
}>]>;
export type CachePolicy = Schema.Schema.Type<typeof CachePolicy>;
export {};
//# sourceMappingURL=options.d.ts.map