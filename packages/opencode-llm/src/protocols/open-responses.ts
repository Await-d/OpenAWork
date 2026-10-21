/**
 * OpenAI Responses 的请求体 schema（对齐上游 `packages/ai@v2.0.28` 的
 * `protocols/open-responses.ts`）。
 *
 * 从 `openai-responses.ts` 拆出：主文件同时装着 schema、请求降级与流解析三块，
 * 已越过仓库的单文件行数预警线。拆开后 schema 是纯声明，不依赖协议逻辑。
 */

import { Schema } from 'effect';
import { JsonObject, optionalArray, optionalNull } from './shared.js';
import { OpenAIOptions } from './utils/openai-options.js';
import * as ResponsesHostedTools from './utils/responses-hosted-tools.js';
import type { Lifecycle } from './utils/lifecycle.js';
import type { ToolStream } from './utils/tool-stream.js';

// =============================================================================
// Request Body Schema
// =============================================================================
const OpenAIResponsesInputText = Schema.Struct({
  type: Schema.tag('input_text'),
  text: Schema.String,
});
const OpenAIResponsesInputImage = Schema.Struct({
  type: Schema.tag('input_image'),
  image_url: Schema.String,
});
const OpenAIResponsesInputContent = Schema.Union([
  OpenAIResponsesInputText,
  OpenAIResponsesInputImage,
]);
type OpenAIResponsesInputContent = Schema.Schema.Type<typeof OpenAIResponsesInputContent>;

const OpenAIResponsesOutputText = Schema.Struct({
  type: Schema.tag('output_text'),
  text: Schema.String,
});

const OpenAIResponsesReasoningSummaryText = Schema.Struct({
  type: Schema.tag('summary_text'),
  text: Schema.String,
});

const OpenAIResponsesReasoningItem = Schema.Struct({
  type: Schema.tag('reasoning'),
  id: Schema.optionalKey(Schema.String),
  summary: Schema.Array(OpenAIResponsesReasoningSummaryText),
  encrypted_content: optionalNull(Schema.String),
});

const OpenAIResponsesItemReference = Schema.Struct({
  type: Schema.tag('item_reference'),
  id: Schema.String,
});

// `function_call_output.output` accepts either a plain string or an ordered
// array of content items so tools can return images in addition to text.
// https://platform.openai.com/docs/api-reference/responses/object
const OpenAIResponsesFunctionCallOutputContent = Schema.Union([
  OpenAIResponsesInputText,
  OpenAIResponsesInputImage,
]);

const OpenAIResponsesFunctionCallOutput = Schema.Union([
  Schema.String,
  Schema.Array(OpenAIResponsesFunctionCallOutputContent),
]);

// Hosted (provider-executed) items that OpenAI accepts back as `input`. With
// `store: false` there is no server-side item to reference, so the recorded item
// itself must be replayed to keep hosted-tool context across turns.
export const OpenAIResponsesInputItem = Schema.Union([
  Schema.Struct({ role: Schema.tag('system'), content: Schema.String }),
  Schema.Struct({ role: Schema.tag('user'), content: Schema.Array(OpenAIResponsesInputContent) }),
  Schema.Struct({
    role: Schema.tag('assistant'),
    content: Schema.Array(OpenAIResponsesOutputText),
  }),
  OpenAIResponsesReasoningItem,
  OpenAIResponsesItemReference,
  ResponsesHostedTools.OpenAIResponsesHostedToolItem,
  Schema.Struct({
    type: Schema.tag('function_call'),
    call_id: Schema.String,
    name: Schema.String,
    arguments: Schema.String,
  }),
  Schema.Struct({
    type: Schema.tag('function_call_output'),
    call_id: Schema.String,
    output: OpenAIResponsesFunctionCallOutput,
  }),
]);
export type OpenAIResponsesInputItem = Schema.Schema.Type<typeof OpenAIResponsesInputItem>;

// Mutable counterpart of the schema reasoning item so `lowerMessages` can fold
// multiple streamed summary parts into the same item before flushing.
export type OpenAIResponsesReasoningInput = {
  type: 'reasoning';
  id: string;
  summary: Array<{ type: 'summary_text'; text: string }>;
  encrypted_content?: string | null;
};
export type OpenAIResponsesReasoningReplay = OpenAIResponsesReasoningInput;

export const OpenAIResponsesFunctionTool = Schema.Struct({
  type: Schema.tag('function'),
  name: Schema.String,
  description: Schema.String,
  parameters: JsonObject,
  strict: Schema.optional(Schema.Boolean),
});
export type OpenAIResponsesFunctionTool = Schema.Schema.Type<typeof OpenAIResponsesFunctionTool>;

/**
 * 官方 hosted 的 `image_generation` 工具（`tools: [{ type: 'image_generation' }]`）。
 * 与 function 工具的关键差异：`model` 指**被调用的生图模型**，与顶层主模型无关；
 * 其余参数对应生图协议本身（quality 含 2.5 起新增的 `xhigh` / `max`）。
 */
export const OpenAIResponsesImageGenerationTool = Schema.Struct({
  type: Schema.tag('image_generation'),
  model: Schema.String,
  action: Schema.optional(Schema.Literals(['auto', 'generate', 'edit'])),
  background: Schema.optional(Schema.Literals(['auto', 'opaque', 'transparent'])),
  moderation: Schema.optional(Schema.Literals(['auto', 'low'])),
  output_compression: Schema.optional(Schema.Number),
  output_format: Schema.optional(Schema.Literals(['png', 'jpeg', 'webp'])),
  partial_images: Schema.optional(Schema.Number),
  quality: Schema.optional(Schema.Literals(['auto', 'low', 'medium', 'high', 'xhigh', 'max'])),
  size: Schema.optional(Schema.String),
});
export type OpenAIResponsesImageGenerationTool = Schema.Schema.Type<
  typeof OpenAIResponsesImageGenerationTool
>;

/**
 * `tools` 数组元素：本地 function 工具 + hosted 的 `image_generation`。
 * 做成 union 后，hosted 条目的响应侧早已支持（见 responses-hosted-tools.ts），
 * 请求侧此前只认 `type: 'function'`，导致这条协议路径根本无法声明生图工具。
 */
export const OpenAIResponsesTool = Schema.Union([
  OpenAIResponsesFunctionTool,
  OpenAIResponsesImageGenerationTool,
]);
export type OpenAIResponsesTool = Schema.Schema.Type<typeof OpenAIResponsesTool>;

const OpenAIResponsesToolChoice = Schema.Union([
  Schema.Literals(['auto', 'none', 'required']),
  Schema.Struct({ type: Schema.tag('function'), name: Schema.String }),
]);

// Fields shared between the HTTP body and the WebSocket `response.create`
// message. The HTTP body adds `stream: true`; the WebSocket message adds
// `type: "response.create"`. Defining the shared shape once keeps the two
// transports in sync without a destructure-and-strip dance.
const OpenAIResponsesCoreFields = {
  model: Schema.String,
  input: Schema.Array(OpenAIResponsesInputItem),
  instructions: Schema.optional(Schema.String),
  tools: optionalArray(OpenAIResponsesTool),
  tool_choice: Schema.optional(OpenAIResponsesToolChoice),
  store: Schema.optional(Schema.Boolean),
  service_tier: Schema.optional(OpenAIOptions.OpenAIServiceTier),
  prompt_cache_key: Schema.optional(Schema.String),
  include: optionalArray(OpenAIOptions.OpenAIResponseIncludable),
  reasoning: Schema.optional(
    Schema.Struct({
      effort: Schema.optional(OpenAIOptions.OpenAIReasoningEffort),
      summary: Schema.optional(Schema.Literal('auto')),
    }),
  ),
  text: Schema.optional(
    Schema.Struct({
      verbosity: Schema.optional(OpenAIOptions.OpenAITextVerbosity),
    }),
  ),
  max_output_tokens: Schema.optional(Schema.Number),
  temperature: Schema.optional(Schema.Number),
  top_p: Schema.optional(Schema.Number),
  // 对齐参考库：由 `parallelToolCalls` / `ToolChoice.disableParallelToolUse` 推导。
  parallel_tool_calls: Schema.optional(Schema.Boolean),
  // 对齐参考库：单次响应内工具调用上限（providerOptions.openai.maxToolCalls）。
  max_tool_calls: Schema.optional(Schema.Number),
};

export const OpenAIResponsesBody = Schema.Struct({
  ...OpenAIResponsesCoreFields,
  stream: Schema.Literal(true),
});
export type OpenAIResponsesBody = Schema.Schema.Type<typeof OpenAIResponsesBody>;

export const OpenAIResponsesWebSocketMessage = Schema.StructWithRest(
  Schema.Struct({
    type: Schema.tag('response.create'),
    ...OpenAIResponsesCoreFields,
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
);
export type OpenAIResponsesWebSocketMessage = Schema.Schema.Type<
  typeof OpenAIResponsesWebSocketMessage
>;
export const encodeWebSocketMessage = Schema.encodeSync(
  Schema.fromJsonString<typeof OpenAIResponsesWebSocketMessage>(OpenAIResponsesWebSocketMessage),
);

export const OpenAIResponsesUsage = Schema.Struct({
  input_tokens: optionalNull(Schema.Number),
  input_tokens_details: optionalNull(Schema.Struct({ cached_tokens: optionalNull(Schema.Number) })),
  output_tokens: optionalNull(Schema.Number),
  output_tokens_details: optionalNull(
    Schema.Struct({ reasoning_tokens: optionalNull(Schema.Number) }),
  ),
  total_tokens: optionalNull(Schema.Number),
});
export type OpenAIResponsesUsage = Schema.Schema.Type<typeof OpenAIResponsesUsage>;

export const OpenAIResponsesStreamItem = Schema.StructWithRest(
  Schema.Struct({
    type: Schema.String,
    id: optionalNull(Schema.String),
    call_id: optionalNull(Schema.String),
    name: optionalNull(Schema.String),
    arguments: optionalNull(Schema.String),
    // Hosted (provider-executed) tool fields. Each hosted tool item carries its
    // own subset of these — we capture them generically so we can surface the
    // call's typed input portion and round-trip the full result payload without
    // hand-rolling a per-tool schema.
    status: optionalNull(Schema.String),
    action: optionalNull(Schema.Unknown),
    queries: optionalNull(Schema.Unknown),
    results: optionalNull(Schema.Unknown),
    code: optionalNull(Schema.String),
    container_id: optionalNull(Schema.String),
    outputs: optionalNull(Schema.Unknown),
    // `image_generation_call` returns its bytes as base64 in `result`.
    result: optionalNull(Schema.String),
    output_format: optionalNull(Schema.String),
    server_label: optionalNull(Schema.String),
    output: optionalNull(Schema.Unknown),
    error: optionalNull(Schema.Unknown),
    encrypted_content: optionalNull(Schema.String),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
);
export type OpenAIResponsesStreamItem = Schema.Schema.Type<typeof OpenAIResponsesStreamItem>;

// OpenAI Responses surfaces provider failures in two related shapes. The
// streaming `error` event carries the details at the top level
// (`{ type: "error", code, message, param, sequence_number }`), while
// `response.failed` carries them under `response.error`. We capture both so
// the parser can surface a useful provider-error message in either path.
const OpenAIResponsesErrorPayload = Schema.StructWithRest(
  Schema.Struct({
    code: optionalNull(Schema.String),
    message: optionalNull(Schema.String),
    param: optionalNull(Schema.String),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
);

export const OpenAIResponsesEvent = Schema.StructWithRest(
  Schema.Struct({
    type: Schema.String,
    delta: optionalNull(Schema.String),
    // `output_text.done` / `reasoning_*.done` carry the authoritative complete
    // text; `function_call_arguments.done` carries the authoritative arguments.
    text: optionalNull(Schema.String),
    arguments: optionalNull(Schema.String),
    item_id: optionalNull(Schema.String),
    summary_index: optionalNull(Schema.Number),
    item: optionalNull(OpenAIResponsesStreamItem),
    response: optionalNull(
      Schema.StructWithRest(
        Schema.Struct({
          id: optionalNull(Schema.String),
          service_tier: optionalNull(Schema.String),
          incomplete_details: optionalNull(Schema.Struct({ reason: optionalNull(Schema.String) })),
          usage: optionalNull(OpenAIResponsesUsage),
          error: optionalNull(OpenAIResponsesErrorPayload),
          // Completed responses repeat the final output items here; used to
          // recover tool calls whose `output_item.done` was omitted.
          output: optionalNull(Schema.Array(Schema.Unknown)),
        }),
        [Schema.Record(Schema.String, Schema.Unknown)],
      ),
    ),
    error: optionalNull(OpenAIResponsesErrorPayload),
    code: optionalNull(Schema.String),
    message: optionalNull(Schema.String),
    param: optionalNull(Schema.String),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
);
export type OpenAIResponsesEvent = Schema.Schema.Type<typeof OpenAIResponsesEvent>;

export interface ParserState {
  readonly tools: ToolStream.State<string>;
  readonly hasFunctionCall: boolean;
  readonly lifecycle: Lifecycle.State;
  readonly reasoningItems: Readonly<Record<string, ReasoningStreamItem>>;
  readonly store: boolean | undefined;
}

export type ReasoningSummaryStatus = 'active' | 'can-conclude' | 'concluded';

export interface ReasoningStreamItem {
  readonly encryptedContent: string | null | undefined;
  readonly activeSummaryIndex?: number;
  // Keyed by OpenAI's numeric `summary_index`. JS object keys coerce to
  // strings, but typing the map as `Record<number, ...>` documents intent
  // and matches the wire field.
  readonly summaryParts: Readonly<Record<number, ReasoningSummaryStatus>>;
}
