import type { JsonSchema, ModelToolSchemaCompatibility } from "../../schema/index.js";
export declare const ToolSchemaProjection: {
    readonly gemini: (schema: JsonSchema) => JsonSchema;
    readonly modelCompatibility: (schema: JsonSchema, compatibility: ModelToolSchemaCompatibility | undefined) => JsonSchema;
    readonly moonshot: (schema: JsonSchema) => JsonSchema;
    readonly openAI: (schema: JsonSchema) => JsonSchema;
};
//# sourceMappingURL=tool-schema.d.ts.map