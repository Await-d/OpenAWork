import { Schema } from 'effect';
import { ToolContent, ToolFileContent, ToolTextContent } from '../external-schema-types.js';
import { JsonSchema, MessageRole, ProviderMetadata } from './ids.js';
import {
  CacheHint,
  CachePolicy,
  GenerationOptions,
  HttpOptions,
  ModelSchema,
  ProviderOptions,
} from './options.js';
import { isRecord } from '../utils/record.js';
const systemPartSchema = Schema.Struct({
  type: Schema.Literal('text'),
  text: Schema.String,
  cache: Schema.optional(CacheHint),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}).annotate({ identifier: 'LLM.SystemPart' });
const makeSystemPart = (text) => ({ type: 'text', text });
export const SystemPart = Object.assign(systemPartSchema, {
  make: makeSystemPart,
  content: (input) => {
    if (input === undefined) return [];
    return typeof input === 'string'
      ? [makeSystemPart(input)]
      : Array.isArray(input)
        ? [...input]
        : [input];
  },
});
export const TextPart = Schema.Struct({
  type: Schema.Literal('text'),
  text: Schema.String,
  cache: Schema.optional(CacheHint),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  providerMetadata: Schema.optional(ProviderMetadata),
}).annotate({ identifier: 'LLM.Content.Text' });
export const MediaPart = Schema.Struct({
  type: Schema.Literal('media'),
  mediaType: Schema.String,
  data: Schema.Union([Schema.String, Schema.Uint8Array]),
  filename: Schema.optional(Schema.String),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}).annotate({ identifier: 'LLM.Content.Media' });
export { ToolContent, ToolFileContent, ToolTextContent };
// Define the schema first
const ToolResultValueSchema = Schema.Union([
  Schema.Struct({
    type: Schema.Literal('json'),
    value: Schema.Unknown,
  }),
  Schema.Struct({
    type: Schema.Literal('text'),
    value: Schema.Unknown,
  }),
  Schema.Struct({
    type: Schema.Literal('error'),
    value: Schema.Unknown,
  }),
  Schema.Struct({
    type: Schema.Literal('content'),
    value: Schema.Array(ToolContent),
  }),
]).annotate({ identifier: 'LLM.ToolResult' });
// Type guard using the type
const isToolResultValue = (value) =>
  isRecord(value) &&
  (value.type === 'text' ||
    value.type === 'json' ||
    value.type === 'error' ||
    value.type === 'content') &&
  'value' in value;
// Export with additional methods
export const ToolResultValue = Object.assign(ToolResultValueSchema, {
  is: isToolResultValue,
  make: (value, type = 'json') => {
    if (isToolResultValue(value)) return value;
    if (type === 'content') return { type, value: Array.isArray(value) ? value : [] };
    return { type, value };
  },
});
export const ToolOutput = Object.assign(
  Schema.Struct({
    structured: Schema.Unknown,
    content: Schema.Array(ToolContent),
  }).annotate({ identifier: 'LLM.ToolOutput' }),
  {
    make: (structured, content = []) => ({ structured, content }),
    fromResultValue: (result) => {
      switch (result.type) {
        case 'json':
          return { structured: result.value, content: [] };
        case 'text':
          return {
            structured: {},
            content: [{ type: 'text', text: toolResultText(result.value) }],
          };
        case 'content':
          return { structured: {}, content: result.value };
        case 'error':
          return undefined;
      }
    },
    toResultValue: (output) => {
      if (output.content.length === 0) return { type: 'json', value: output.structured };
      if (output.content.length === 1 && output.content[0]?.type === 'text')
        return { type: 'text', value: output.content[0].text };
      return { type: 'content', value: output.content };
    },
  },
);
const toolResultText = (value) => {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
};
export const ToolCallPart = Object.assign(
  Schema.Struct({
    type: Schema.Literal('tool-call'),
    id: Schema.String,
    name: Schema.String,
    input: Schema.Unknown,
    providerExecuted: Schema.optional(Schema.Boolean),
    metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
    providerMetadata: Schema.optional(ProviderMetadata),
  }).annotate({ identifier: 'LLM.Content.ToolCall' }),
  {
    make: (input) => ({ type: 'tool-call', ...input }),
  },
);
export const ToolResultPart = Object.assign(
  Schema.Struct({
    type: Schema.Literal('tool-result'),
    id: Schema.String,
    name: Schema.String,
    result: ToolResultValue,
    providerExecuted: Schema.optional(Schema.Boolean),
    cache: Schema.optional(CacheHint),
    metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
    providerMetadata: Schema.optional(ProviderMetadata),
  }).annotate({ identifier: 'LLM.Content.ToolResult' }),
  {
    make: (input) => ({
      type: 'tool-result',
      id: input.id,
      name: input.name,
      result: ToolResultValue.make(input.result, input.resultType),
      providerExecuted: input.providerExecuted,
      cache: input.cache,
      metadata: input.metadata,
      providerMetadata: input.providerMetadata,
    }),
  },
);
export const ReasoningPart = Schema.Struct({
  type: Schema.Literal('reasoning'),
  text: Schema.String,
  encrypted: Schema.optional(Schema.String),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  providerMetadata: Schema.optional(ProviderMetadata),
}).annotate({ identifier: 'LLM.Content.Reasoning' });
export const ContentPart = Schema.Union([
  TextPart,
  MediaPart,
  ToolCallPart,
  ToolResultPart,
  ReasoningPart,
]).pipe(Schema.toTaggedUnion('type'));
export class Message extends Schema.Class('LLM.Message')({
  id: Schema.optional(Schema.String),
  role: MessageRole,
  content: Schema.Array(ContentPart),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  native: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}) {}
(function (Message) {
  Message.text = (value) => ({ type: 'text', text: value });
  Message.content = (input) =>
    typeof input === 'string' ? [Message.text(input)] : Array.isArray(input) ? [...input] : [input];
  Message.make = (input) => {
    if (input instanceof Message) return input;
    return new Message({ ...input, content: Message.content(input.content) });
  };
  Message.user = (content) => Message.make({ role: 'user', content });
  Message.assistant = (content) => Message.make({ role: 'assistant', content });
  /**
   * Add an operator-authored instruction at this chronological point in the
   * conversation. This is distinct from the initial `LLMRequest.system`
   * prompt. Keep raw retrieved, tool, and web content out of privileged system
   * updates; pass that untrusted content through ordinary user/tool channels.
   */
  Message.system = (content) => Message.make({ role: 'system', content });
  Message.tool = (result) =>
    Message.make({
      role: 'tool',
      content: ['type' in result ? result : ToolResultPart.make(result)],
    });
})(Message || (Message = {}));
export class ToolDefinition extends Schema.Class('LLM.ToolDefinition')({
  name: Schema.String,
  description: Schema.String,
  inputSchema: JsonSchema,
  outputSchema: Schema.optional(JsonSchema),
  cache: Schema.optional(CacheHint),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  native: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}) {}
(function (ToolDefinition) {
  /** Normalize tool definition input into the canonical `ToolDefinition` class. */
  ToolDefinition.make = (input) =>
    input instanceof ToolDefinition ? input : new ToolDefinition(input);
})(ToolDefinition || (ToolDefinition = {}));
export class ToolChoice extends Schema.Class('LLM.ToolChoice')({
  type: Schema.Literals(['auto', 'none', 'required', 'tool']),
  name: Schema.optional(Schema.String),
}) {}
(function (ToolChoice) {
  const isMode = (value) => value === 'auto' || value === 'none' || value === 'required';
  /** Select a specific named tool. */
  ToolChoice.named = (value) => new ToolChoice({ type: 'tool', name: value });
  /** Normalize ergonomic tool-choice inputs into the canonical `ToolChoice` class. */
  ToolChoice.make = (input) => {
    if (input instanceof ToolChoice) return input;
    if (input instanceof ToolDefinition) return ToolChoice.named(input.name);
    if (typeof input === 'string')
      return isMode(input) ? new ToolChoice({ type: input }) : ToolChoice.named(input);
    return new ToolChoice(input);
  };
})(ToolChoice || (ToolChoice = {}));
export const ResponseFormat = Schema.Union([
  Schema.Struct({ type: Schema.Literal('text') }),
  Schema.Struct({ type: Schema.Literal('json'), schema: JsonSchema }),
  Schema.Struct({ type: Schema.Literal('tool'), tool: ToolDefinition }),
]).pipe(Schema.toTaggedUnion('type'));
export class LLMRequest extends Schema.Class('LLM.Request')({
  id: Schema.optional(Schema.String),
  model: ModelSchema,
  system: Schema.Array(SystemPart),
  messages: Schema.Array(Message),
  tools: Schema.Array(ToolDefinition),
  toolChoice: Schema.optional(ToolChoice),
  generation: Schema.optional(GenerationOptions),
  providerOptions: Schema.optional(ProviderOptions),
  http: Schema.optional(HttpOptions),
  responseFormat: Schema.optional(ResponseFormat),
  cache: Schema.optional(CachePolicy),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}) {}
(function (LLMRequest) {
  LLMRequest.input = (request) => ({
    id: request.id,
    model: request.model,
    system: request.system,
    messages: request.messages,
    tools: request.tools,
    toolChoice: request.toolChoice,
    generation: request.generation,
    providerOptions: request.providerOptions,
    http: request.http,
    responseFormat: request.responseFormat,
    cache: request.cache,
    metadata: request.metadata,
  });
  LLMRequest.update = (request, patch) => {
    if (Object.keys(patch).length === 0) return request;
    return new LLMRequest({
      ...LLMRequest.input(request),
      ...patch,
      model: patch.model ?? request.model,
    });
  };
})(LLMRequest || (LLMRequest = {}));
//# sourceMappingURL=messages.js.map
