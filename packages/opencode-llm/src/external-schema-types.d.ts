import { Schema } from "effect";
export declare const ProviderMetadata: Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>;
export type ProviderMetadata = Schema.Schema.Type<typeof ProviderMetadata>;
export interface ToolTextContent extends Schema.Schema.Type<typeof ToolTextContent> {
}
export declare const ToolTextContent: Schema.Struct<{
    readonly type: Schema.Literal<"text">;
    readonly text: Schema.String;
}>;
export interface ToolFileContent extends Schema.Schema.Type<typeof ToolFileContent> {
}
export declare const ToolFileContent: Schema.Struct<{
    readonly type: Schema.Literal<"file">;
    readonly uri: Schema.String;
    readonly mime: Schema.String;
    readonly name: Schema.optional<any>;
}>;
export declare const ToolContent: Schema.Union<readonly [Schema.Struct<{
    readonly type: Schema.Literal<"text">;
    readonly text: Schema.String;
}>, Schema.Struct<{
    readonly type: Schema.Literal<"file">;
    readonly uri: Schema.String;
    readonly mime: Schema.String;
    readonly name: Schema.optional<any>;
}>]>;
export type ToolContent = Schema.Schema.Type<typeof ToolContent>;
//# sourceMappingURL=external-schema-types.d.ts.map