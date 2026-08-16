// Local schema types to replace @opencode-ai/schema/llm
// Adapted for Effect 4.0 beta compatibility
import { Schema } from 'effect';

// Helper function - simplified for Effect 4.0 beta
const optional = <const S extends Schema.Top>(schema: S) => Schema.optional(schema);

// ProviderMetadata type
export const ProviderMetadata = Schema.Record(
  Schema.String,
  Schema.Record(Schema.String, Schema.Unknown),
).pipe(Schema.annotate({ identifier: 'LLM.ProviderMetadata' }));
export type ProviderMetadata = Schema.Schema.Type<typeof ProviderMetadata>;

// Tool content types
export interface ToolTextContent extends Schema.Schema.Type<typeof ToolTextContent> {}
export const ToolTextContent = Schema.Struct({
  type: Schema.Literal('text'),
  text: Schema.String,
}).pipe(Schema.annotate({ identifier: 'Tool.TextContent' }));

export interface ToolFileContent extends Schema.Schema.Type<typeof ToolFileContent> {}
export const ToolFileContent = Schema.Struct({
  type: Schema.Literal('file'),
  uri: Schema.String,
  mime: Schema.String,
  name: optional(Schema.String),
}).pipe(Schema.annotate({ identifier: 'Tool.FileContent' }));

// Tool content union - Effect 4.0 beta uses array syntax
export const ToolContent = Schema.Union([ToolTextContent, ToolFileContent] as const).pipe(
  Schema.annotate({ identifier: 'LLM.ToolContent' }),
);
export type ToolContent = Schema.Schema.Type<typeof ToolContent>;
