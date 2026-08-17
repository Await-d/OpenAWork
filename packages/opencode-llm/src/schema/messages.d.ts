import { Schema } from "effect";
import { ToolContent, ToolFileContent, ToolTextContent } from "../external-schema-types.js";
import { CacheHint, GenerationOptions, HttpOptions } from "./options.js";
declare const systemPartSchema: Schema.Struct<{
    readonly type: Schema.Literal<"text">;
    readonly text: Schema.String;
    readonly cache: Schema.optional<typeof CacheHint>;
    readonly metadata: Schema.optional<Schema.$Record<Schema.String, Schema.Unknown>>;
}>;
export type SystemPart = Schema.Schema.Type<typeof systemPartSchema>;
export declare const SystemPart: Schema.Struct<{
    readonly type: Schema.Literal<"text">;
    readonly text: Schema.String;
    readonly cache: Schema.optional<typeof CacheHint>;
    readonly metadata: Schema.optional<Schema.$Record<Schema.String, Schema.Unknown>>;
}> & {
    make: (text: string) => SystemPart;
    content: (input?: string | SystemPart | ReadonlyArray<SystemPart>) => any[];
};
export declare const TextPart: Schema.Struct<{
    readonly type: Schema.Literal<"text">;
    readonly text: Schema.String;
    readonly cache: Schema.optional<typeof CacheHint>;
    readonly metadata: Schema.optional<Schema.$Record<Schema.String, Schema.Unknown>>;
    readonly providerMetadata: Schema.optional<Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>>;
}>;
export type TextPart = Schema.Schema.Type<typeof TextPart>;
export declare const MediaPart: Schema.Struct<{
    readonly type: Schema.Literal<"media">;
    readonly mediaType: Schema.String;
    readonly data: Schema.Union<readonly [Schema.String, Schema.Uint8Array]>;
    readonly filename: Schema.optional<Schema.String>;
    readonly metadata: Schema.optional<Schema.$Record<Schema.String, Schema.Unknown>>;
}>;
export type MediaPart = Schema.Schema.Type<typeof MediaPart>;
export { ToolContent, ToolFileContent, ToolTextContent };
declare const ToolResultValueSchema: Schema.Union<readonly [Schema.Struct<{
    readonly type: Schema.Literal<"json">;
    readonly value: Schema.Unknown;
}>, Schema.Struct<{
    readonly type: Schema.Literal<"text">;
    readonly value: Schema.Unknown;
}>, Schema.Struct<{
    readonly type: Schema.Literal<"error">;
    readonly value: Schema.Unknown;
}>, Schema.Struct<{
    readonly type: Schema.Literal<"content">;
    readonly value: Schema.$Array<Schema.Union<readonly [Schema.Struct<{
        readonly type: Schema.Literal<"text">;
        readonly text: Schema.String;
    }>, Schema.Struct<{
        readonly type: Schema.Literal<"file">;
        readonly uri: Schema.String;
        readonly mime: Schema.String;
        readonly name: Schema.optional<any>;
    }>]>>;
}>]>;
export type ToolResultValue = Schema.Schema.Type<typeof ToolResultValueSchema>;
export declare const ToolResultValue: Schema.Union<readonly [Schema.Struct<{
    readonly type: Schema.Literal<"json">;
    readonly value: Schema.Unknown;
}>, Schema.Struct<{
    readonly type: Schema.Literal<"text">;
    readonly value: Schema.Unknown;
}>, Schema.Struct<{
    readonly type: Schema.Literal<"error">;
    readonly value: Schema.Unknown;
}>, Schema.Struct<{
    readonly type: Schema.Literal<"content">;
    readonly value: Schema.$Array<Schema.Union<readonly [Schema.Struct<{
        readonly type: Schema.Literal<"text">;
        readonly text: Schema.String;
    }>, Schema.Struct<{
        readonly type: Schema.Literal<"file">;
        readonly uri: Schema.String;
        readonly mime: Schema.String;
        readonly name: Schema.optional<any>;
    }>]>>;
}>]> & {
    is: (value: unknown) => value is ToolResultValue;
    make: (value: unknown, type?: ToolResultValue["type"]) => ToolResultValue;
};
export interface ToolOutput {
    readonly structured: unknown;
    readonly content: ReadonlyArray<ToolContent>;
}
export declare const ToolOutput: Schema.Struct<{
    readonly structured: Schema.Unknown;
    readonly content: Schema.$Array<Schema.Union<readonly [Schema.Struct<{
        readonly type: Schema.Literal<"text">;
        readonly text: Schema.String;
    }>, Schema.Struct<{
        readonly type: Schema.Literal<"file">;
        readonly uri: Schema.String;
        readonly mime: Schema.String;
        readonly name: Schema.optional<any>;
    }>]>>;
}> & {
    make: (structured: unknown, content?: ReadonlyArray<ToolContent>) => ToolOutput;
    fromResultValue: (result: ToolResultValue) => ToolOutput | undefined;
    toResultValue: (output: ToolOutput) => ToolResultValue;
};
export declare const ToolCallPart: Schema.Struct<{
    readonly type: Schema.Literal<"tool-call">;
    readonly id: Schema.String;
    readonly name: Schema.String;
    readonly input: Schema.Unknown;
    readonly providerExecuted: Schema.optional<Schema.Boolean>;
    readonly metadata: Schema.optional<Schema.$Record<Schema.String, Schema.Unknown>>;
    readonly providerMetadata: Schema.optional<Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>>;
}> & {
    make: (input: Omit<ToolCallPart, "type">) => ToolCallPart;
};
export type ToolCallPart = Schema.Schema.Type<typeof ToolCallPart>;
export declare const ToolResultPart: Schema.Struct<{
    readonly type: Schema.Literal<"tool-result">;
    readonly id: Schema.String;
    readonly name: Schema.String;
    readonly result: Schema.Union<readonly [Schema.Struct<{
        readonly type: Schema.Literal<"json">;
        readonly value: Schema.Unknown;
    }>, Schema.Struct<{
        readonly type: Schema.Literal<"text">;
        readonly value: Schema.Unknown;
    }>, Schema.Struct<{
        readonly type: Schema.Literal<"error">;
        readonly value: Schema.Unknown;
    }>, Schema.Struct<{
        readonly type: Schema.Literal<"content">;
        readonly value: Schema.$Array<Schema.Union<readonly [Schema.Struct<{
            readonly type: Schema.Literal<"text">;
            readonly text: Schema.String;
        }>, Schema.Struct<{
            readonly type: Schema.Literal<"file">;
            readonly uri: Schema.String;
            readonly mime: Schema.String;
            readonly name: Schema.optional<any>;
        }>]>>;
    }>]> & {
        is: (value: unknown) => value is ToolResultValue;
        make: (value: unknown, type?: ToolResultValue["type"]) => ToolResultValue;
    };
    readonly providerExecuted: Schema.optional<Schema.Boolean>;
    readonly cache: Schema.optional<typeof CacheHint>;
    readonly metadata: Schema.optional<Schema.$Record<Schema.String, Schema.Unknown>>;
    readonly providerMetadata: Schema.optional<Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>>;
}> & {
    make: (input: Omit<ToolResultPart, "type" | "result"> & {
        readonly result: unknown;
        readonly resultType?: ToolResultValue["type"];
    }) => ToolResultPart;
};
export type ToolResultPart = Schema.Schema.Type<typeof ToolResultPart>;
export declare const ReasoningPart: Schema.Struct<{
    readonly type: Schema.Literal<"reasoning">;
    readonly text: Schema.String;
    readonly encrypted: Schema.optional<Schema.String>;
    readonly metadata: Schema.optional<Schema.$Record<Schema.String, Schema.Unknown>>;
    readonly providerMetadata: Schema.optional<Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>>;
}>;
export type ReasoningPart = Schema.Schema.Type<typeof ReasoningPart>;
export declare const ContentPart: Schema.toTaggedUnion<"type", readonly [Schema.Struct<{
    readonly type: Schema.Literal<"text">;
    readonly text: Schema.String;
    readonly cache: Schema.optional<typeof CacheHint>;
    readonly metadata: Schema.optional<Schema.$Record<Schema.String, Schema.Unknown>>;
    readonly providerMetadata: Schema.optional<Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>>;
}>, Schema.Struct<{
    readonly type: Schema.Literal<"media">;
    readonly mediaType: Schema.String;
    readonly data: Schema.Union<readonly [Schema.String, Schema.Uint8Array]>;
    readonly filename: Schema.optional<Schema.String>;
    readonly metadata: Schema.optional<Schema.$Record<Schema.String, Schema.Unknown>>;
}>, Schema.Struct<{
    readonly type: Schema.Literal<"tool-call">;
    readonly id: Schema.String;
    readonly name: Schema.String;
    readonly input: Schema.Unknown;
    readonly providerExecuted: Schema.optional<Schema.Boolean>;
    readonly metadata: Schema.optional<Schema.$Record<Schema.String, Schema.Unknown>>;
    readonly providerMetadata: Schema.optional<Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>>;
}> & {
    make: (input: Omit<ToolCallPart, "type">) => ToolCallPart;
}, Schema.Struct<{
    readonly type: Schema.Literal<"tool-result">;
    readonly id: Schema.String;
    readonly name: Schema.String;
    readonly result: Schema.Union<readonly [Schema.Struct<{
        readonly type: Schema.Literal<"json">;
        readonly value: Schema.Unknown;
    }>, Schema.Struct<{
        readonly type: Schema.Literal<"text">;
        readonly value: Schema.Unknown;
    }>, Schema.Struct<{
        readonly type: Schema.Literal<"error">;
        readonly value: Schema.Unknown;
    }>, Schema.Struct<{
        readonly type: Schema.Literal<"content">;
        readonly value: Schema.$Array<Schema.Union<readonly [Schema.Struct<{
            readonly type: Schema.Literal<"text">;
            readonly text: Schema.String;
        }>, Schema.Struct<{
            readonly type: Schema.Literal<"file">;
            readonly uri: Schema.String;
            readonly mime: Schema.String;
            readonly name: Schema.optional<any>;
        }>]>>;
    }>]> & {
        is: (value: unknown) => value is ToolResultValue;
        make: (value: unknown, type?: ToolResultValue["type"]) => ToolResultValue;
    };
    readonly providerExecuted: Schema.optional<Schema.Boolean>;
    readonly cache: Schema.optional<typeof CacheHint>;
    readonly metadata: Schema.optional<Schema.$Record<Schema.String, Schema.Unknown>>;
    readonly providerMetadata: Schema.optional<Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>>;
}> & {
    make: (input: Omit<ToolResultPart, "type" | "result"> & {
        readonly result: unknown;
        readonly resultType?: ToolResultValue["type"];
    }) => ToolResultPart;
}, Schema.Struct<{
    readonly type: Schema.Literal<"reasoning">;
    readonly text: Schema.String;
    readonly encrypted: Schema.optional<Schema.String>;
    readonly metadata: Schema.optional<Schema.$Record<Schema.String, Schema.Unknown>>;
    readonly providerMetadata: Schema.optional<Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>>;
}>]>;
export type ContentPart = Schema.Schema.Type<typeof ContentPart>;
declare const Message_base: Schema.Class<Message, Schema.Struct<{
    readonly id: Schema.optional<Schema.String>;
    readonly role: Schema.Literals<readonly ["system", "user", "assistant", "tool"]>;
    readonly content: Schema.$Array<Schema.toTaggedUnion<"type", readonly [Schema.Struct<{
        readonly type: Schema.Literal<"text">;
        readonly text: Schema.String;
        readonly cache: Schema.optional<typeof CacheHint>;
        readonly metadata: Schema.optional<Schema.$Record<Schema.String, Schema.Unknown>>;
        readonly providerMetadata: Schema.optional<Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>>;
    }>, Schema.Struct<{
        readonly type: Schema.Literal<"media">;
        readonly mediaType: Schema.String;
        readonly data: Schema.Union<readonly [Schema.String, Schema.Uint8Array]>;
        readonly filename: Schema.optional<Schema.String>;
        readonly metadata: Schema.optional<Schema.$Record<Schema.String, Schema.Unknown>>;
    }>, Schema.Struct<{
        readonly type: Schema.Literal<"tool-call">;
        readonly id: Schema.String;
        readonly name: Schema.String;
        readonly input: Schema.Unknown;
        readonly providerExecuted: Schema.optional<Schema.Boolean>;
        readonly metadata: Schema.optional<Schema.$Record<Schema.String, Schema.Unknown>>;
        readonly providerMetadata: Schema.optional<Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>>;
    }> & {
        make: (input: Omit<ToolCallPart, "type">) => ToolCallPart;
    }, Schema.Struct<{
        readonly type: Schema.Literal<"tool-result">;
        readonly id: Schema.String;
        readonly name: Schema.String;
        readonly result: Schema.Union<readonly [Schema.Struct<{
            readonly type: Schema.Literal<"json">;
            readonly value: Schema.Unknown;
        }>, Schema.Struct<{
            readonly type: Schema.Literal<"text">;
            readonly value: Schema.Unknown;
        }>, Schema.Struct<{
            readonly type: Schema.Literal<"error">;
            readonly value: Schema.Unknown;
        }>, Schema.Struct<{
            readonly type: Schema.Literal<"content">;
            readonly value: Schema.$Array<Schema.Union<readonly [Schema.Struct<{
                readonly type: Schema.Literal<"text">;
                readonly text: Schema.String;
            }>, Schema.Struct<{
                readonly type: Schema.Literal<"file">;
                readonly uri: Schema.String;
                readonly mime: Schema.String;
                readonly name: Schema.optional<any>;
            }>]>>;
        }>]> & {
            is: (value: unknown) => value is ToolResultValue;
            make: (value: unknown, type?: ToolResultValue["type"]) => ToolResultValue;
        };
        readonly providerExecuted: Schema.optional<Schema.Boolean>;
        readonly cache: Schema.optional<typeof CacheHint>;
        readonly metadata: Schema.optional<Schema.$Record<Schema.String, Schema.Unknown>>;
        readonly providerMetadata: Schema.optional<Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>>;
    }> & {
        make: (input: Omit<ToolResultPart, "type" | "result"> & {
            readonly result: unknown;
            readonly resultType?: ToolResultValue["type"];
        }) => ToolResultPart;
    }, Schema.Struct<{
        readonly type: Schema.Literal<"reasoning">;
        readonly text: Schema.String;
        readonly encrypted: Schema.optional<Schema.String>;
        readonly metadata: Schema.optional<Schema.$Record<Schema.String, Schema.Unknown>>;
        readonly providerMetadata: Schema.optional<Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>>;
    }>]>>;
    readonly metadata: Schema.optional<Schema.$Record<Schema.String, Schema.Unknown>>;
    readonly native: Schema.optional<Schema.$Record<Schema.String, Schema.Unknown>>;
}>, {}>;
export declare class Message extends Message_base {
}
export declare namespace Message {
    type ContentInput = string | ContentPart | ReadonlyArray<ContentPart>;
    type SystemContentInput = string | TextPart | ReadonlyArray<TextPart>;
    type Input = Omit<ConstructorParameters<typeof Message>[0], "content"> & {
        readonly content: ContentInput;
    };
    const text: (value: string) => ContentPart;
    const content: (input: ContentInput) => any[];
    const make: (input: Message | Input) => Message;
    const user: (content: ContentInput) => Message;
    const assistant: (content: ContentInput) => Message;
    /**
     * Add an operator-authored instruction at this chronological point in the
     * conversation. This is distinct from the initial `LLMRequest.system`
     * prompt. Keep raw retrieved, tool, and web content out of privileged system
     * updates; pass that untrusted content through ordinary user/tool channels.
     */
    const system: (content: SystemContentInput) => Message;
    const tool: (result: ToolResultPart | Parameters<typeof ToolResultPart.make>[0]) => Message;
}
declare const ToolDefinition_base: Schema.Class<ToolDefinition, Schema.Struct<{
    readonly name: Schema.String;
    readonly description: Schema.String;
    readonly inputSchema: Schema.$Record<Schema.String, Schema.Unknown>;
    readonly outputSchema: Schema.optional<Schema.$Record<Schema.String, Schema.Unknown>>;
    readonly cache: Schema.optional<typeof CacheHint>;
    readonly metadata: Schema.optional<Schema.$Record<Schema.String, Schema.Unknown>>;
    readonly native: Schema.optional<Schema.$Record<Schema.String, Schema.Unknown>>;
}>, {}>;
export declare class ToolDefinition extends ToolDefinition_base {
}
export declare namespace ToolDefinition {
    type Input = ToolDefinition | ConstructorParameters<typeof ToolDefinition>[0];
    /** Normalize tool definition input into the canonical `ToolDefinition` class. */
    const make: (input: Input) => ToolDefinition;
}
declare const ToolChoice_base: Schema.Class<ToolChoice, Schema.Struct<{
    readonly type: Schema.Literals<readonly ["auto", "none", "required", "tool"]>;
    readonly name: Schema.optional<Schema.String>;
}>, {}>;
export declare class ToolChoice extends ToolChoice_base {
}
export declare namespace ToolChoice {
    type Mode = Exclude<ToolChoice["type"], "tool">;
    type Input = ToolChoice | ConstructorParameters<typeof ToolChoice>[0] | ToolDefinition | string;
    /** Select a specific named tool. */
    const named: (value: string) => ToolChoice;
    /** Normalize ergonomic tool-choice inputs into the canonical `ToolChoice` class. */
    const make: (input: Input) => ToolChoice;
}
export declare const ResponseFormat: Schema.toTaggedUnion<"type", readonly [Schema.Struct<{
    readonly type: Schema.Literal<"text">;
}>, Schema.Struct<{
    readonly type: Schema.Literal<"json">;
    readonly schema: Schema.$Record<Schema.String, Schema.Unknown>;
}>, Schema.Struct<{
    readonly type: Schema.Literal<"tool">;
    readonly tool: typeof ToolDefinition;
}>]>;
export type ResponseFormat = Schema.Schema.Type<typeof ResponseFormat>;
declare const LLMRequest_base: Schema.Class<LLMRequest, Schema.Struct<{
    readonly id: Schema.optional<Schema.String>;
    readonly model: Schema.declare<import("./options.js").Model, import("./options.js").Model>;
    readonly system: Schema.$Array<Schema.Struct<{
        readonly type: Schema.Literal<"text">;
        readonly text: Schema.String;
        readonly cache: Schema.optional<typeof CacheHint>;
        readonly metadata: Schema.optional<Schema.$Record<Schema.String, Schema.Unknown>>;
    }> & {
        make: (text: string) => SystemPart;
        content: (input?: string | SystemPart | ReadonlyArray<SystemPart>) => any[];
    }>;
    readonly messages: Schema.$Array<typeof Message>;
    readonly tools: Schema.$Array<typeof ToolDefinition>;
    readonly toolChoice: Schema.optional<typeof ToolChoice>;
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
    readonly responseFormat: Schema.optional<Schema.toTaggedUnion<"type", readonly [Schema.Struct<{
        readonly type: Schema.Literal<"text">;
    }>, Schema.Struct<{
        readonly type: Schema.Literal<"json">;
        readonly schema: Schema.$Record<Schema.String, Schema.Unknown>;
    }>, Schema.Struct<{
        readonly type: Schema.Literal<"tool">;
        readonly tool: typeof ToolDefinition;
    }>]>>;
    readonly cache: Schema.optional<Schema.Union<readonly [Schema.Literal<"auto">, Schema.Literal<"none">, Schema.Struct<{
        readonly tools: Schema.optional<Schema.Boolean>;
        readonly system: Schema.optional<Schema.Boolean>;
        readonly messages: Schema.optional<Schema.Union<readonly [Schema.Literal<"latest-user-message">, Schema.Literal<"latest-assistant">, Schema.Struct<{
            readonly tail: Schema.Number;
        }>]>>;
        readonly ttlSeconds: Schema.optional<Schema.Number>;
    }>]>>;
    readonly metadata: Schema.optional<Schema.$Record<Schema.String, Schema.Unknown>>;
}>, {}>;
export declare class LLMRequest extends LLMRequest_base {
}
export declare namespace LLMRequest {
    type Input = ConstructorParameters<typeof LLMRequest>[0];
    const input: (request: LLMRequest) => Input;
    const update: (request: LLMRequest, patch: Partial<Input>) => LLMRequest;
}
//# sourceMappingURL=messages.d.ts.map