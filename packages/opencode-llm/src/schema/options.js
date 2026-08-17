import { Schema } from 'effect';
import { JsonSchema, ModelID, ProviderID } from './ids.js';
import { isRecord } from '../utils/record.js';
export const mergeJsonRecords = (...items) => {
  const defined = items.filter((item) => item !== undefined);
  if (defined.length === 0) return undefined;
  if (
    defined.length === 1 &&
    defined[0] &&
    Object.values(defined[0]).every((value) => value !== undefined)
  )
    return defined[0];
  const result = {};
  for (const item of defined) {
    for (const [key, value] of Object.entries(item)) {
      if (value === undefined) continue;
      result[key] =
        isRecord(result[key]) && isRecord(value) ? mergeJsonRecords(result[key], value) : value;
    }
  }
  return Object.keys(result).length === 0 ? undefined : result;
};
const mergeStringRecords = (...items) => {
  const defined = items.filter((item) => item !== undefined);
  if (defined.length === 0) return undefined;
  if (defined.length === 1) return defined[0];
  const result = Object.fromEntries(
    defined.flatMap((item) => Object.entries(item).filter((entry) => entry[1] !== undefined)),
  );
  return Object.keys(result).length === 0 ? undefined : result;
};
const AnthropicInputTokens = Schema.Struct({
  type: Schema.Literal('input_tokens'),
  value: Schema.Number,
});
const AnthropicThinkingTurns = Schema.Struct({
  type: Schema.Literal('thinking_turns'),
  value: Schema.Number,
});
const AnthropicToolUses = Schema.Struct({
  type: Schema.Literal('tool_uses'),
  value: Schema.Number,
});
const AnthropicClearThinkingEdit = Schema.Struct({
  type: Schema.Literal('clear_thinking_20251015'),
  keep: Schema.optional(AnthropicThinkingTurns),
});
const AnthropicClearToolUsesEdit = Schema.Struct({
  type: Schema.Literal('clear_tool_uses_20250919'),
  trigger: Schema.optional(AnthropicInputTokens),
  keep: Schema.optional(AnthropicToolUses),
  clear_at_least: Schema.optional(AnthropicInputTokens),
  exclude_tools: Schema.optional(Schema.Array(Schema.String)),
});
export const AnthropicContextManagement = Schema.Struct({
  edits: Schema.Array(Schema.Union([AnthropicClearThinkingEdit, AnthropicClearToolUsesEdit])),
});
export const AnthropicProviderOptions = Schema.StructWithRest(
  Schema.Struct({
    contextManagement: Schema.optional(AnthropicContextManagement),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
);
export const ProviderOptions = Schema.StructWithRest(
  Schema.Struct({
    anthropic: Schema.optional(AnthropicProviderOptions),
  }),
  [Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Unknown))],
);
export const mergeProviderOptions = (...items) => {
  const result = {};
  for (const item of items) {
    if (!item) continue;
    for (const [provider, options] of Object.entries(item)) {
      const merged = mergeJsonRecords(result[provider], options);
      if (merged) result[provider] = merged;
    }
  }
  return Object.keys(result).length === 0 ? undefined : result;
};
export class HttpOptions extends Schema.Class('LLM.HttpOptions')({
  body: Schema.optional(JsonSchema),
  headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  query: Schema.optional(Schema.Record(Schema.String, Schema.String)),
}) {}
(function (HttpOptions) {
  /** Normalize HTTP option input into the canonical `HttpOptions` class. */
  HttpOptions.make = (input) => (input instanceof HttpOptions ? input : new HttpOptions(input));
})(HttpOptions || (HttpOptions = {}));
export const mergeHttpOptions = (...items) => {
  const body = mergeJsonRecords(...items.map((item) => item?.body));
  const headers = mergeStringRecords(...items.map((item) => item?.headers));
  const query = mergeStringRecords(...items.map((item) => item?.query));
  if (!body && !headers && !query) return undefined;
  return new HttpOptions({ body, headers, query });
};
export class GenerationOptions extends Schema.Class('LLM.GenerationOptions')({
  maxTokens: Schema.optional(Schema.Number),
  temperature: Schema.optional(Schema.Number),
  topP: Schema.optional(Schema.Number),
  topK: Schema.optional(Schema.Number),
  frequencyPenalty: Schema.optional(Schema.Number),
  presencePenalty: Schema.optional(Schema.Number),
  seed: Schema.optional(Schema.Number),
  stop: Schema.optional(Schema.Array(Schema.String)),
}) {}
(function (GenerationOptions) {
  /** Normalize generation option input into the canonical `GenerationOptions` class. */
  GenerationOptions.make = (input = {}) =>
    input instanceof GenerationOptions ? input : new GenerationOptions(input);
})(GenerationOptions || (GenerationOptions = {}));
const latestGeneration = (items, key) => {
  // findLast polyfill for older TypeScript versions
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item?.[key] !== undefined) return item[key];
  }
  return undefined;
};
export const mergeGenerationOptions = (...items) => {
  const result = new GenerationOptions({
    maxTokens: latestGeneration(items, 'maxTokens'),
    temperature: latestGeneration(items, 'temperature'),
    topP: latestGeneration(items, 'topP'),
    topK: latestGeneration(items, 'topK'),
    frequencyPenalty: latestGeneration(items, 'frequencyPenalty'),
    presencePenalty: latestGeneration(items, 'presencePenalty'),
    seed: latestGeneration(items, 'seed'),
    stop: latestGeneration(items, 'stop'),
  });
  return Object.values(result).some((value) => value !== undefined) ? result : undefined;
};
export class ModelLimits extends Schema.Class('LLM.ModelLimits')({
  context: Schema.optional(Schema.Number),
  output: Schema.optional(Schema.Number),
}) {}
(function (ModelLimits) {
  /** Normalize model limit input into the canonical `ModelLimits` class. */
  ModelLimits.make = (input) =>
    input instanceof ModelLimits ? input : new ModelLimits(input ?? {});
})(ModelLimits || (ModelLimits = {}));
export class ModelDefaults extends Schema.Class('LLM.ModelDefaults')({
  limits: Schema.optional(ModelLimits),
  generation: Schema.optional(GenerationOptions),
  providerOptions: Schema.optional(ProviderOptions),
  http: Schema.optional(HttpOptions),
}) {}
(function (ModelDefaults) {
  /** Normalize selected-model request defaults without applying precedence. */
  ModelDefaults.make = (input) => {
    if (input instanceof ModelDefaults) return input;
    return new ModelDefaults({
      limits: input.limits === undefined ? undefined : ModelLimits.make(input.limits),
      generation:
        input.generation === undefined ? undefined : GenerationOptions.make(input.generation),
      providerOptions: input.providerOptions,
      http: input.http === undefined ? undefined : HttpOptions.make(input.http),
    });
  };
})(ModelDefaults || (ModelDefaults = {}));
export const ModelToolSchemaCompatibility = Schema.Literals(['gemini', 'moonshot']);
export class ModelCompatibility extends Schema.Class('LLM.ModelCompatibility')({
  toolSchema: Schema.optional(ModelToolSchemaCompatibility),
}) {}
(function (ModelCompatibility) {
  /** Normalize model/upstream compatibility metadata without projecting requests. */
  ModelCompatibility.make = (input) =>
    input instanceof ModelCompatibility ? input : new ModelCompatibility(input);
})(ModelCompatibility || (ModelCompatibility = {}));
export class Model {
  id;
  provider;
  route;
  defaults;
  compatibility;
  constructor(input) {
    this.id = input.id;
    this.provider = input.provider;
    this.route = input.route;
    this.defaults = input.defaults;
    this.compatibility = input.compatibility;
  }
  static make(input) {
    return new Model({
      id: ModelID.make(input.id),
      provider: ProviderID.make(input.provider),
      route: input.route,
      defaults: input.defaults === undefined ? undefined : ModelDefaults.make(input.defaults),
      compatibility:
        input.compatibility === undefined
          ? undefined
          : ModelCompatibility.make(input.compatibility),
    });
  }
  static input(model) {
    return {
      id: model.id,
      provider: model.provider,
      route: model.route,
      defaults: model.defaults,
      compatibility: model.compatibility,
    };
  }
  static update(model, patch) {
    if (Object.keys(patch).length === 0) return model;
    return Model.make({
      ...Model.input(model),
      ...patch,
    });
  }
}
export const ModelSchema = Schema.declare((value) => value instanceof Model, {
  expected: 'LLM.Model',
});
export class CacheHint extends Schema.Class('LLM.CacheHint')({
  type: Schema.Literals(['ephemeral', 'persistent']),
  ttlSeconds: Schema.optional(Schema.Number),
}) {}
// Auto-placement policy for prompt caching. The protocol-neutral lowering step
// reads this and injects `CacheHint`s at the configured boundaries; the
// per-protocol body builders then translate those hints into wire markers as
// usual. `"auto"` is the recommended default for agent loops — it places one
// breakpoint at the last tool definition, one at the last system part, and one
// at the latest user message. The combination of provider invalidation
// hierarchy (tools → system → messages) and Anthropic/Bedrock's 20-block
// lookback means three trailing breakpoints reliably cover the static prefix.
//
// Pass `"none"` to opt out entirely (the legacy behavior). Pass the granular
// object form to override individual choices.
export const CachePolicyObject = Schema.Struct({
  tools: Schema.optional(Schema.Boolean),
  system: Schema.optional(Schema.Boolean),
  messages: Schema.optional(
    Schema.Union([
      Schema.Literal('latest-user-message'),
      Schema.Literal('latest-assistant'),
      Schema.Struct({ tail: Schema.Number }),
    ]),
  ),
  ttlSeconds: Schema.optional(Schema.Number),
});
export const CachePolicy = Schema.Union([
  Schema.Literal('auto'),
  Schema.Literal('none'),
  CachePolicyObject,
]);
//# sourceMappingURL=options.js.map
