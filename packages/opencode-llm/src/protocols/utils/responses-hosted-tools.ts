/**
 * OpenAI Responses 的 hosted（服务端执行）工具条目（对齐上游
 * `packages/ai@v2.0.28` 的 `utils/responses-hosted-tools.ts`）。
 *
 * 这些条目由上游执行、只在历史里回放，本地不构造；单独成文件是为了把
 * `openai-responses.ts` 的 schema 区从 1400 行里拆出来。
 */

import { Schema } from 'effect';
import type { ToolResultPart } from '../../schema/index.js';
import { JsonObject, optionalNull, ProviderShared } from '../shared.js';

export const OpenAIResponsesHostedToolItem = Schema.Union([
  Schema.StructWithRest(
    Schema.Struct({
      type: Schema.tag('computer_call'),
      id: Schema.String,
      status: Schema.optional(Schema.String),
      call_id: Schema.optional(Schema.String),
      action: optionalNull(JsonObject),
      pending_safety_checks: Schema.optional(Schema.Array(JsonObject)),
    }),
    [Schema.Record(Schema.String, Schema.Unknown)],
  ),
  Schema.StructWithRest(
    Schema.Struct({
      type: Schema.tag('web_search_call'),
      id: Schema.String,
      status: Schema.optional(Schema.String),
      action: optionalNull(JsonObject),
    }),
    [Schema.Record(Schema.String, Schema.Unknown)],
  ),
  Schema.StructWithRest(
    Schema.Struct({
      type: Schema.tag('web_search_preview_call'),
      id: Schema.String,
      status: Schema.optional(Schema.String),
      action: optionalNull(JsonObject),
    }),
    [Schema.Record(Schema.String, Schema.Unknown)],
  ),
  Schema.StructWithRest(
    Schema.Struct({
      type: Schema.tag('image_generation_call'),
      id: Schema.String,
      status: Schema.optional(Schema.String),
      result: optionalNull(Schema.String),
      output_format: Schema.optional(Schema.Literals(['png', 'jpeg', 'webp'])),
      revised_prompt: optionalNull(Schema.String),
    }),
    [Schema.Record(Schema.String, Schema.Unknown)],
  ),
]);
export type OpenAIResponsesHostedToolItem = Schema.Schema.Type<
  typeof OpenAIResponsesHostedToolItem
>;

export const hostedToolItemID = (part: ToolResultPart) => {
  const openai = part.providerMetadata?.openai;
  return ProviderShared.isRecord(openai) &&
    typeof openai.itemId === 'string' &&
    openai.itemId.length > 0
    ? openai.itemId
    : undefined;
};

// The stream recorder stores the whole hosted item as the tool result value, so
// it can be replayed verbatim when the server has no stored copy (`store:false`).
export const restoreHostedToolItem = (item: unknown): OpenAIResponsesHostedToolItem | undefined =>
  Schema.is(OpenAIResponsesHostedToolItem)(item) ? item : undefined;
