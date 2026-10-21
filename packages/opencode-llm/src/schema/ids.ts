import { Schema } from 'effect';
import { ProviderMetadata } from '../external-schema-types.js';

export { ProviderMetadata };

/** Stable string identifier for a protocol implementation. */
export const ProtocolID = Schema.String;
export type ProtocolID = Schema.Schema.Type<typeof ProtocolID>;

/** Stable string identifier for the runnable route. */
export const RouteID = Schema.String;
export type RouteID = Schema.Schema.Type<typeof RouteID>;

export const ModelID = Schema.String.pipe(Schema.brand('LLM.ModelID'));
export type ModelID = typeof ModelID.Type;

export const ProviderID = Schema.String.pipe(Schema.brand('LLM.ProviderID'));
export type ProviderID = typeof ProviderID.Type;

export const ResponseID = Schema.String;
export type ResponseID = Schema.Schema.Type<typeof ResponseID>;

export const ContentBlockID = Schema.String;
export type ContentBlockID = Schema.Schema.Type<typeof ContentBlockID>;

export const ToolCallID = Schema.String;
export type ToolCallID = Schema.Schema.Type<typeof ToolCallID>;

export const ReasoningEfforts = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;
/**
 * 供应商自定义的字符串枚举：已知值只用于补全，运行期接受任意字符串
 * （对齐上游 `ReasoningEffort = OpenString<...>` + `Schema.declare`）。
 *
 * 收紧成白名单会让新供应商的 effort 档位在解码期被拒，而调用方无法自救。
 */
export type ReasoningEffort = (typeof ReasoningEfforts)[number] | (string & {});
export const ReasoningEffort = Schema.declare<ReasoningEffort>(
  (value): value is ReasoningEffort => typeof value === 'string',
  { title: 'ReasoningEffort' },
);

export const TextVerbosity = Schema.Literals(['low', 'medium', 'high']);
export type TextVerbosity = Schema.Schema.Type<typeof TextVerbosity>;

export const MessageRole = Schema.Literals(['system', 'user', 'assistant', 'tool']);
export type MessageRole = Schema.Schema.Type<typeof MessageRole>;

export const FinishReason = Schema.Literals([
  'stop',
  'length',
  'tool-calls',
  'content-filter',
  'error',
  'unknown',
]);
export type FinishReason = Schema.Schema.Type<typeof FinishReason>;

export const JsonSchema = Schema.Record(Schema.String, Schema.Unknown);
export type JsonSchema = Schema.Schema.Type<typeof JsonSchema>;
