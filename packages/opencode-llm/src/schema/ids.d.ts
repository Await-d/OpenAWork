import { Schema } from 'effect';
import { ProviderMetadata } from '../external-schema-types.js';
export { ProviderMetadata };
/** Stable string identifier for a protocol implementation. */
export declare const ProtocolID: Schema.String;
export type ProtocolID = Schema.Schema.Type<typeof ProtocolID>;
/** Stable string identifier for the runnable route. */
export declare const RouteID: Schema.String;
export type RouteID = Schema.Schema.Type<typeof RouteID>;
export declare const ModelID: Schema.brand<Schema.String, 'LLM.ModelID'>;
export type ModelID = typeof ModelID.Type;
export declare const ProviderID: Schema.brand<Schema.String, 'LLM.ProviderID'>;
export type ProviderID = typeof ProviderID.Type;
export declare const ResponseID: Schema.String;
export type ResponseID = Schema.Schema.Type<typeof ResponseID>;
export declare const ContentBlockID: Schema.String;
export type ContentBlockID = Schema.Schema.Type<typeof ContentBlockID>;
export declare const ToolCallID: Schema.String;
export type ToolCallID = Schema.Schema.Type<typeof ToolCallID>;
export declare const ReasoningEfforts: readonly [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
];
export declare const ReasoningEffort: Schema.Literals<
  readonly ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
>;
export type ReasoningEffort = Schema.Schema.Type<typeof ReasoningEffort>;
export declare const TextVerbosity: Schema.Literals<readonly ['low', 'medium', 'high']>;
export type TextVerbosity = Schema.Schema.Type<typeof TextVerbosity>;
export declare const MessageRole: Schema.Literals<readonly ['system', 'user', 'assistant', 'tool']>;
export type MessageRole = Schema.Schema.Type<typeof MessageRole>;
export declare const FinishReason: Schema.Literals<
  readonly ['stop', 'length', 'tool-calls', 'content-filter', 'error', 'unknown']
>;
export type FinishReason = Schema.Schema.Type<typeof FinishReason>;
export declare const JsonSchema: Schema.$Record<Schema.String, Schema.Unknown>;
export type JsonSchema = Schema.Schema.Type<typeof JsonSchema>;
//# sourceMappingURL=ids.d.ts.map
