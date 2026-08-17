import { Schema } from 'effect';
import { ContentBlockID, FinishReason, ProviderMetadata, ToolCallID } from './ids.js';
import { Message, ToolOutput, ToolResultValue } from './messages.js';
declare const Usage_base: Schema.Class<
  Usage,
  Schema.Struct<{
    readonly inputTokens: Schema.optional<Schema.Number>;
    readonly outputTokens: Schema.optional<Schema.Number>;
    readonly nonCachedInputTokens: Schema.optional<Schema.Number>;
    readonly cacheReadInputTokens: Schema.optional<Schema.Number>;
    readonly cacheWriteInputTokens: Schema.optional<Schema.Number>;
    readonly reasoningTokens: Schema.optional<Schema.Number>;
    readonly totalTokens: Schema.optional<Schema.Number>;
    readonly providerMetadata: Schema.optional<
      Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
    >;
  }>,
  {}
>;
/**
 * Token usage reported by an LLM provider.
 *
 * **Inclusive totals** (match AI SDK / OpenAI / LangChain convention — a
 * reader from any of those ecosystems sees the number they expect):
 *
 * - `inputTokens` — total prompt tokens, *including* cached reads/writes.
 * - `outputTokens` — total output tokens, *including* reasoning.
 * - `totalTokens` — provider-supplied total, or `inputTokens + outputTokens`.
 *
 * **Non-overlapping breakdown** (every field is independently meaningful;
 * consumers never have to subtract):
 *
 * - `nonCachedInputTokens` — the "fresh" portion of the prompt.
 * - `cacheReadInputTokens` — input tokens served from cache.
 * - `cacheWriteInputTokens` — input tokens written to cache.
 * - `reasoningTokens` — subset of `outputTokens` spent on hidden reasoning.
 *
 * **Invariant**: `nonCachedInputTokens + cacheReadInputTokens +
 * cacheWriteInputTokens = inputTokens`, and `reasoningTokens ≤ outputTokens`.
 * Each protocol mapper computes whichever side it doesn't get natively,
 * with `Math.max(0, …)` clamping for defense against provider bugs. Because
 * every breakdown field is stored independently, downstream consumers can
 * read whatever they need (cost-by-category, context-pressure, AI-SDK-style
 * inclusive total) without ever subtracting — eliminating the underflow
 * class of bug where a clamped difference would silently store the wrong
 * value.
 *
 * **Semantics by provider**:
 *
 * - OpenAI Chat / Responses / Gemini / Bedrock: provider reports inclusive
 *   `inputTokens` and an inclusive `outputTokens`; mapper subtracts to
 *   derive the breakdown.
 * - Anthropic: provider reports the breakdown natively (`input_tokens` is
 *   non-cached only); mapper sums to derive the inclusive `inputTokens`.
 *   Anthropic does *not* break extended-thinking out of `output_tokens`, so
 *   `reasoningTokens` is `undefined` and `outputTokens` carries the
 *   combined total — a documented limitation of the Anthropic API.
 *
 * `providerMetadata` always carries the provider's raw usage payload —
 * keyed by provider name (`{ openai: ... }`, `{ anthropic: ... }`, etc.)
 * — for fields we don't normalize and for billing-level audit trails.
 * Matches the same escape-hatch field on `LLMEvent`.
 */
export declare class Usage extends Usage_base {
  /**
   * Visible output tokens — `outputTokens` minus `reasoningTokens`, clamped
   * to zero. The one place subtraction happens in this contract; the clamp
   * means a provider reporting `reasoningTokens > outputTokens` produces a
   * harmless zero rather than a negative that crashes downstream schemas.
   */
  get visibleOutputTokens(): number;
  static from(input: UsageInput): Usage;
}
export type UsageInput = Usage | ConstructorParameters<typeof Usage>[0];
export declare const StepStart: Schema.Struct<{
  readonly type: Schema.tag<'step-start'>;
  readonly index: Schema.Number;
}>;
export type StepStart = Schema.Schema.Type<typeof StepStart>;
export declare const TextStart: Schema.Struct<{
  readonly type: Schema.tag<'text-start'>;
  readonly id: Schema.String;
  readonly providerMetadata: Schema.optional<
    Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
  >;
}>;
export type TextStart = Schema.Schema.Type<typeof TextStart>;
export declare const TextDelta: Schema.Struct<{
  readonly type: Schema.tag<'text-delta'>;
  readonly id: Schema.String;
  readonly text: Schema.String;
  readonly providerMetadata: Schema.optional<
    Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
  >;
}>;
export type TextDelta = Schema.Schema.Type<typeof TextDelta>;
export declare const TextEnd: Schema.Struct<{
  readonly type: Schema.tag<'text-end'>;
  readonly id: Schema.String;
  readonly providerMetadata: Schema.optional<
    Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
  >;
}>;
export type TextEnd = Schema.Schema.Type<typeof TextEnd>;
export declare const ReasoningStart: Schema.Struct<{
  readonly type: Schema.tag<'reasoning-start'>;
  readonly id: Schema.String;
  readonly providerMetadata: Schema.optional<
    Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
  >;
}>;
export type ReasoningStart = Schema.Schema.Type<typeof ReasoningStart>;
export declare const ReasoningDelta: Schema.Struct<{
  readonly type: Schema.tag<'reasoning-delta'>;
  readonly id: Schema.String;
  readonly text: Schema.String;
  readonly providerMetadata: Schema.optional<
    Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
  >;
}>;
export type ReasoningDelta = Schema.Schema.Type<typeof ReasoningDelta>;
export declare const ReasoningEnd: Schema.Struct<{
  readonly type: Schema.tag<'reasoning-end'>;
  readonly id: Schema.String;
  readonly providerMetadata: Schema.optional<
    Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
  >;
}>;
export type ReasoningEnd = Schema.Schema.Type<typeof ReasoningEnd>;
export declare const ToolInputStart: Schema.Struct<{
  readonly type: Schema.tag<'tool-input-start'>;
  readonly id: Schema.String;
  readonly name: Schema.String;
  readonly providerMetadata: Schema.optional<
    Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
  >;
}>;
export type ToolInputStart = Schema.Schema.Type<typeof ToolInputStart>;
export declare const ToolInputDelta: Schema.Struct<{
  readonly type: Schema.tag<'tool-input-delta'>;
  readonly id: Schema.String;
  readonly name: Schema.String;
  readonly text: Schema.String;
}>;
export type ToolInputDelta = Schema.Schema.Type<typeof ToolInputDelta>;
export declare const ToolInputEnd: Schema.Struct<{
  readonly type: Schema.tag<'tool-input-end'>;
  readonly id: Schema.String;
  readonly name: Schema.String;
  readonly providerMetadata: Schema.optional<
    Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
  >;
}>;
export type ToolInputEnd = Schema.Schema.Type<typeof ToolInputEnd>;
export declare const ToolCall: Schema.Struct<{
  readonly type: Schema.tag<'tool-call'>;
  readonly id: Schema.String;
  readonly name: Schema.String;
  readonly input: Schema.Unknown;
  readonly providerExecuted: Schema.optional<Schema.Boolean>;
  readonly providerMetadata: Schema.optional<
    Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
  >;
}>;
export type ToolCall = Schema.Schema.Type<typeof ToolCall>;
export declare const ToolResult: Schema.Struct<{
  readonly type: Schema.tag<'tool-result'>;
  readonly id: Schema.String;
  readonly name: Schema.String;
  readonly result: Schema.Union<
    readonly [
      Schema.Struct<{
        readonly type: Schema.Literal<'json'>;
        readonly value: Schema.Unknown;
      }>,
      Schema.Struct<{
        readonly type: Schema.Literal<'text'>;
        readonly value: Schema.Unknown;
      }>,
      Schema.Struct<{
        readonly type: Schema.Literal<'error'>;
        readonly value: Schema.Unknown;
      }>,
      Schema.Struct<{
        readonly type: Schema.Literal<'content'>;
        readonly value: Schema.$Array<
          Schema.Union<
            readonly [
              Schema.Struct<{
                readonly type: Schema.Literal<'text'>;
                readonly text: Schema.String;
              }>,
              Schema.Struct<{
                readonly type: Schema.Literal<'file'>;
                readonly uri: Schema.String;
                readonly mime: Schema.String;
                readonly name: Schema.optional<any>;
              }>,
            ]
          >
        >;
      }>,
    ]
  > & {
    is: (value: unknown) => value is ToolResultValue;
    make: (value: unknown, type?: ToolResultValue['type']) => ToolResultValue;
  };
  readonly output: Schema.optional<
    Schema.Struct<{
      readonly structured: Schema.Unknown;
      readonly content: Schema.$Array<
        Schema.Union<
          readonly [
            Schema.Struct<{
              readonly type: Schema.Literal<'text'>;
              readonly text: Schema.String;
            }>,
            Schema.Struct<{
              readonly type: Schema.Literal<'file'>;
              readonly uri: Schema.String;
              readonly mime: Schema.String;
              readonly name: Schema.optional<any>;
            }>,
          ]
        >
      >;
    }> & {
      make: (
        structured: unknown,
        content?: ReadonlyArray<import('./messages.js').ToolContent>,
      ) => ToolOutput;
      fromResultValue: (result: ToolResultValue) => ToolOutput | undefined;
      toResultValue: (output: ToolOutput) => ToolResultValue;
    }
  >;
  readonly providerExecuted: Schema.optional<Schema.Boolean>;
  readonly providerMetadata: Schema.optional<
    Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
  >;
}>;
export type ToolResult = Schema.Schema.Type<typeof ToolResult>;
export declare const ToolError: Schema.Struct<{
  readonly type: Schema.tag<'tool-error'>;
  readonly id: Schema.String;
  readonly name: Schema.String;
  readonly message: Schema.String;
  readonly error: Schema.optional<Schema.Defect>;
  readonly providerMetadata: Schema.optional<
    Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
  >;
}>;
export type ToolError = Schema.Schema.Type<typeof ToolError>;
export declare const StepFinish: Schema.Struct<{
  readonly type: Schema.tag<'step-finish'>;
  readonly index: Schema.Number;
  readonly reason: Schema.Literals<
    readonly ['stop', 'length', 'tool-calls', 'content-filter', 'error', 'unknown']
  >;
  readonly usage: Schema.optional<typeof Usage>;
  readonly providerMetadata: Schema.optional<
    Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
  >;
}>;
export type StepFinish = Schema.Schema.Type<typeof StepFinish>;
export declare const Finish: Schema.Struct<{
  readonly type: Schema.tag<'finish'>;
  readonly reason: Schema.Literals<
    readonly ['stop', 'length', 'tool-calls', 'content-filter', 'error', 'unknown']
  >;
  readonly usage: Schema.optional<typeof Usage>;
  readonly providerMetadata: Schema.optional<
    Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
  >;
}>;
export type Finish = Schema.Schema.Type<typeof Finish>;
export declare const ProviderErrorEvent: Schema.Struct<{
  readonly type: Schema.tag<'provider-error'>;
  readonly message: Schema.String;
  readonly classification: Schema.optional<Schema.Literal<'context-overflow'>>;
  readonly retryable: Schema.optional<Schema.Boolean>;
  readonly providerMetadata: Schema.optional<
    Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
  >;
}>;
export type ProviderErrorEvent = Schema.Schema.Type<typeof ProviderErrorEvent>;
declare const llmEventTagged: Schema.toTaggedUnion<
  'type',
  readonly [
    Schema.Struct<{
      readonly type: Schema.tag<'step-start'>;
      readonly index: Schema.Number;
    }>,
    Schema.Struct<{
      readonly type: Schema.tag<'text-start'>;
      readonly id: Schema.String;
      readonly providerMetadata: Schema.optional<
        Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
      >;
    }>,
    Schema.Struct<{
      readonly type: Schema.tag<'text-delta'>;
      readonly id: Schema.String;
      readonly text: Schema.String;
      readonly providerMetadata: Schema.optional<
        Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
      >;
    }>,
    Schema.Struct<{
      readonly type: Schema.tag<'text-end'>;
      readonly id: Schema.String;
      readonly providerMetadata: Schema.optional<
        Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
      >;
    }>,
    Schema.Struct<{
      readonly type: Schema.tag<'reasoning-start'>;
      readonly id: Schema.String;
      readonly providerMetadata: Schema.optional<
        Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
      >;
    }>,
    Schema.Struct<{
      readonly type: Schema.tag<'reasoning-delta'>;
      readonly id: Schema.String;
      readonly text: Schema.String;
      readonly providerMetadata: Schema.optional<
        Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
      >;
    }>,
    Schema.Struct<{
      readonly type: Schema.tag<'reasoning-end'>;
      readonly id: Schema.String;
      readonly providerMetadata: Schema.optional<
        Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
      >;
    }>,
    Schema.Struct<{
      readonly type: Schema.tag<'tool-input-start'>;
      readonly id: Schema.String;
      readonly name: Schema.String;
      readonly providerMetadata: Schema.optional<
        Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
      >;
    }>,
    Schema.Struct<{
      readonly type: Schema.tag<'tool-input-delta'>;
      readonly id: Schema.String;
      readonly name: Schema.String;
      readonly text: Schema.String;
    }>,
    Schema.Struct<{
      readonly type: Schema.tag<'tool-input-end'>;
      readonly id: Schema.String;
      readonly name: Schema.String;
      readonly providerMetadata: Schema.optional<
        Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
      >;
    }>,
    Schema.Struct<{
      readonly type: Schema.tag<'tool-call'>;
      readonly id: Schema.String;
      readonly name: Schema.String;
      readonly input: Schema.Unknown;
      readonly providerExecuted: Schema.optional<Schema.Boolean>;
      readonly providerMetadata: Schema.optional<
        Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
      >;
    }>,
    Schema.Struct<{
      readonly type: Schema.tag<'tool-result'>;
      readonly id: Schema.String;
      readonly name: Schema.String;
      readonly result: Schema.Union<
        readonly [
          Schema.Struct<{
            readonly type: Schema.Literal<'json'>;
            readonly value: Schema.Unknown;
          }>,
          Schema.Struct<{
            readonly type: Schema.Literal<'text'>;
            readonly value: Schema.Unknown;
          }>,
          Schema.Struct<{
            readonly type: Schema.Literal<'error'>;
            readonly value: Schema.Unknown;
          }>,
          Schema.Struct<{
            readonly type: Schema.Literal<'content'>;
            readonly value: Schema.$Array<
              Schema.Union<
                readonly [
                  Schema.Struct<{
                    readonly type: Schema.Literal<'text'>;
                    readonly text: Schema.String;
                  }>,
                  Schema.Struct<{
                    readonly type: Schema.Literal<'file'>;
                    readonly uri: Schema.String;
                    readonly mime: Schema.String;
                    readonly name: Schema.optional<any>;
                  }>,
                ]
              >
            >;
          }>,
        ]
      > & {
        is: (value: unknown) => value is ToolResultValue;
        make: (value: unknown, type?: ToolResultValue['type']) => ToolResultValue;
      };
      readonly output: Schema.optional<
        Schema.Struct<{
          readonly structured: Schema.Unknown;
          readonly content: Schema.$Array<
            Schema.Union<
              readonly [
                Schema.Struct<{
                  readonly type: Schema.Literal<'text'>;
                  readonly text: Schema.String;
                }>,
                Schema.Struct<{
                  readonly type: Schema.Literal<'file'>;
                  readonly uri: Schema.String;
                  readonly mime: Schema.String;
                  readonly name: Schema.optional<any>;
                }>,
              ]
            >
          >;
        }> & {
          make: (
            structured: unknown,
            content?: ReadonlyArray<import('./messages.js').ToolContent>,
          ) => ToolOutput;
          fromResultValue: (result: ToolResultValue) => ToolOutput | undefined;
          toResultValue: (output: ToolOutput) => ToolResultValue;
        }
      >;
      readonly providerExecuted: Schema.optional<Schema.Boolean>;
      readonly providerMetadata: Schema.optional<
        Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
      >;
    }>,
    Schema.Struct<{
      readonly type: Schema.tag<'tool-error'>;
      readonly id: Schema.String;
      readonly name: Schema.String;
      readonly message: Schema.String;
      readonly error: Schema.optional<Schema.Defect>;
      readonly providerMetadata: Schema.optional<
        Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
      >;
    }>,
    Schema.Struct<{
      readonly type: Schema.tag<'step-finish'>;
      readonly index: Schema.Number;
      readonly reason: Schema.Literals<
        readonly ['stop', 'length', 'tool-calls', 'content-filter', 'error', 'unknown']
      >;
      readonly usage: Schema.optional<typeof Usage>;
      readonly providerMetadata: Schema.optional<
        Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
      >;
    }>,
    Schema.Struct<{
      readonly type: Schema.tag<'finish'>;
      readonly reason: Schema.Literals<
        readonly ['stop', 'length', 'tool-calls', 'content-filter', 'error', 'unknown']
      >;
      readonly usage: Schema.optional<typeof Usage>;
      readonly providerMetadata: Schema.optional<
        Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
      >;
    }>,
    Schema.Struct<{
      readonly type: Schema.tag<'provider-error'>;
      readonly message: Schema.String;
      readonly classification: Schema.optional<Schema.Literal<'context-overflow'>>;
      readonly retryable: Schema.optional<Schema.Boolean>;
      readonly providerMetadata: Schema.optional<
        Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
      >;
    }>,
  ]
>;
type WithID<
  Event extends {
    readonly id: unknown;
  },
  ID,
> = Omit<Event, 'type' | 'id'> & {
  readonly id: ID | string;
};
type WithUsage<
  Event extends {
    readonly usage?: Usage;
  },
> = Omit<Event, 'type' | 'usage'> & {
  readonly usage?: UsageInput;
};
/**
 * camelCase aliases for `LLMEvent.guards` (provided by `Schema.toTaggedUnion`).
 * Lets consumers write `events.filter(LLMEvent.is.toolCall)` instead of
 * `events.filter(LLMEvent.guards["tool-call"])`.
 */
export declare const LLMEvent: Schema.Union<
  readonly [
    Schema.Struct<{
      readonly type: Schema.tag<'step-start'>;
      readonly index: Schema.Number;
    }>,
    Schema.Struct<{
      readonly type: Schema.tag<'text-start'>;
      readonly id: Schema.String;
      readonly providerMetadata: Schema.optional<
        Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
      >;
    }>,
    Schema.Struct<{
      readonly type: Schema.tag<'text-delta'>;
      readonly id: Schema.String;
      readonly text: Schema.String;
      readonly providerMetadata: Schema.optional<
        Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
      >;
    }>,
    Schema.Struct<{
      readonly type: Schema.tag<'text-end'>;
      readonly id: Schema.String;
      readonly providerMetadata: Schema.optional<
        Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
      >;
    }>,
    Schema.Struct<{
      readonly type: Schema.tag<'reasoning-start'>;
      readonly id: Schema.String;
      readonly providerMetadata: Schema.optional<
        Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
      >;
    }>,
    Schema.Struct<{
      readonly type: Schema.tag<'reasoning-delta'>;
      readonly id: Schema.String;
      readonly text: Schema.String;
      readonly providerMetadata: Schema.optional<
        Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
      >;
    }>,
    Schema.Struct<{
      readonly type: Schema.tag<'reasoning-end'>;
      readonly id: Schema.String;
      readonly providerMetadata: Schema.optional<
        Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
      >;
    }>,
    Schema.Struct<{
      readonly type: Schema.tag<'tool-input-start'>;
      readonly id: Schema.String;
      readonly name: Schema.String;
      readonly providerMetadata: Schema.optional<
        Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
      >;
    }>,
    Schema.Struct<{
      readonly type: Schema.tag<'tool-input-delta'>;
      readonly id: Schema.String;
      readonly name: Schema.String;
      readonly text: Schema.String;
    }>,
    Schema.Struct<{
      readonly type: Schema.tag<'tool-input-end'>;
      readonly id: Schema.String;
      readonly name: Schema.String;
      readonly providerMetadata: Schema.optional<
        Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
      >;
    }>,
    Schema.Struct<{
      readonly type: Schema.tag<'tool-call'>;
      readonly id: Schema.String;
      readonly name: Schema.String;
      readonly input: Schema.Unknown;
      readonly providerExecuted: Schema.optional<Schema.Boolean>;
      readonly providerMetadata: Schema.optional<
        Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
      >;
    }>,
    Schema.Struct<{
      readonly type: Schema.tag<'tool-result'>;
      readonly id: Schema.String;
      readonly name: Schema.String;
      readonly result: Schema.Union<
        readonly [
          Schema.Struct<{
            readonly type: Schema.Literal<'json'>;
            readonly value: Schema.Unknown;
          }>,
          Schema.Struct<{
            readonly type: Schema.Literal<'text'>;
            readonly value: Schema.Unknown;
          }>,
          Schema.Struct<{
            readonly type: Schema.Literal<'error'>;
            readonly value: Schema.Unknown;
          }>,
          Schema.Struct<{
            readonly type: Schema.Literal<'content'>;
            readonly value: Schema.$Array<
              Schema.Union<
                readonly [
                  Schema.Struct<{
                    readonly type: Schema.Literal<'text'>;
                    readonly text: Schema.String;
                  }>,
                  Schema.Struct<{
                    readonly type: Schema.Literal<'file'>;
                    readonly uri: Schema.String;
                    readonly mime: Schema.String;
                    readonly name: Schema.optional<any>;
                  }>,
                ]
              >
            >;
          }>,
        ]
      > & {
        is: (value: unknown) => value is ToolResultValue;
        make: (value: unknown, type?: ToolResultValue['type']) => ToolResultValue;
      };
      readonly output: Schema.optional<
        Schema.Struct<{
          readonly structured: Schema.Unknown;
          readonly content: Schema.$Array<
            Schema.Union<
              readonly [
                Schema.Struct<{
                  readonly type: Schema.Literal<'text'>;
                  readonly text: Schema.String;
                }>,
                Schema.Struct<{
                  readonly type: Schema.Literal<'file'>;
                  readonly uri: Schema.String;
                  readonly mime: Schema.String;
                  readonly name: Schema.optional<any>;
                }>,
              ]
            >
          >;
        }> & {
          make: (
            structured: unknown,
            content?: ReadonlyArray<import('./messages.js').ToolContent>,
          ) => ToolOutput;
          fromResultValue: (result: ToolResultValue) => ToolOutput | undefined;
          toResultValue: (output: ToolOutput) => ToolResultValue;
        }
      >;
      readonly providerExecuted: Schema.optional<Schema.Boolean>;
      readonly providerMetadata: Schema.optional<
        Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
      >;
    }>,
    Schema.Struct<{
      readonly type: Schema.tag<'tool-error'>;
      readonly id: Schema.String;
      readonly name: Schema.String;
      readonly message: Schema.String;
      readonly error: Schema.optional<Schema.Defect>;
      readonly providerMetadata: Schema.optional<
        Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
      >;
    }>,
    Schema.Struct<{
      readonly type: Schema.tag<'step-finish'>;
      readonly index: Schema.Number;
      readonly reason: Schema.Literals<
        readonly ['stop', 'length', 'tool-calls', 'content-filter', 'error', 'unknown']
      >;
      readonly usage: Schema.optional<typeof Usage>;
      readonly providerMetadata: Schema.optional<
        Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
      >;
    }>,
    Schema.Struct<{
      readonly type: Schema.tag<'finish'>;
      readonly reason: Schema.Literals<
        readonly ['stop', 'length', 'tool-calls', 'content-filter', 'error', 'unknown']
      >;
      readonly usage: Schema.optional<typeof Usage>;
      readonly providerMetadata: Schema.optional<
        Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
      >;
    }>,
    Schema.Struct<{
      readonly type: Schema.tag<'provider-error'>;
      readonly message: Schema.String;
      readonly classification: Schema.optional<Schema.Literal<'context-overflow'>>;
      readonly retryable: Schema.optional<Schema.Boolean>;
      readonly providerMetadata: Schema.optional<
        Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
      >;
    }>,
  ]
> & {
  readonly cases: {
    'step-start': Schema.Struct<{
      readonly type: Schema.tag<'step-start'>;
      readonly index: Schema.Number;
    }>;
    'text-start': Schema.Struct<{
      readonly type: Schema.tag<'text-start'>;
      readonly id: Schema.String;
      readonly providerMetadata: Schema.optional<
        Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
      >;
    }>;
    'text-delta': Schema.Struct<{
      readonly type: Schema.tag<'text-delta'>;
      readonly id: Schema.String;
      readonly text: Schema.String;
      readonly providerMetadata: Schema.optional<
        Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
      >;
    }>;
    'text-end': Schema.Struct<{
      readonly type: Schema.tag<'text-end'>;
      readonly id: Schema.String;
      readonly providerMetadata: Schema.optional<
        Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
      >;
    }>;
    'reasoning-start': Schema.Struct<{
      readonly type: Schema.tag<'reasoning-start'>;
      readonly id: Schema.String;
      readonly providerMetadata: Schema.optional<
        Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
      >;
    }>;
    'reasoning-delta': Schema.Struct<{
      readonly type: Schema.tag<'reasoning-delta'>;
      readonly id: Schema.String;
      readonly text: Schema.String;
      readonly providerMetadata: Schema.optional<
        Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
      >;
    }>;
    'reasoning-end': Schema.Struct<{
      readonly type: Schema.tag<'reasoning-end'>;
      readonly id: Schema.String;
      readonly providerMetadata: Schema.optional<
        Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
      >;
    }>;
    'tool-input-start': Schema.Struct<{
      readonly type: Schema.tag<'tool-input-start'>;
      readonly id: Schema.String;
      readonly name: Schema.String;
      readonly providerMetadata: Schema.optional<
        Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
      >;
    }>;
    'tool-input-delta': Schema.Struct<{
      readonly type: Schema.tag<'tool-input-delta'>;
      readonly id: Schema.String;
      readonly name: Schema.String;
      readonly text: Schema.String;
    }>;
    'tool-input-end': Schema.Struct<{
      readonly type: Schema.tag<'tool-input-end'>;
      readonly id: Schema.String;
      readonly name: Schema.String;
      readonly providerMetadata: Schema.optional<
        Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
      >;
    }>;
    'tool-call': Schema.Struct<{
      readonly type: Schema.tag<'tool-call'>;
      readonly id: Schema.String;
      readonly name: Schema.String;
      readonly input: Schema.Unknown;
      readonly providerExecuted: Schema.optional<Schema.Boolean>;
      readonly providerMetadata: Schema.optional<
        Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
      >;
    }>;
    'tool-result': Schema.Struct<{
      readonly type: Schema.tag<'tool-result'>;
      readonly id: Schema.String;
      readonly name: Schema.String;
      readonly result: Schema.Union<
        readonly [
          Schema.Struct<{
            readonly type: Schema.Literal<'json'>;
            readonly value: Schema.Unknown;
          }>,
          Schema.Struct<{
            readonly type: Schema.Literal<'text'>;
            readonly value: Schema.Unknown;
          }>,
          Schema.Struct<{
            readonly type: Schema.Literal<'error'>;
            readonly value: Schema.Unknown;
          }>,
          Schema.Struct<{
            readonly type: Schema.Literal<'content'>;
            readonly value: Schema.$Array<
              Schema.Union<
                readonly [
                  Schema.Struct<{
                    readonly type: Schema.Literal<'text'>;
                    readonly text: Schema.String;
                  }>,
                  Schema.Struct<{
                    readonly type: Schema.Literal<'file'>;
                    readonly uri: Schema.String;
                    readonly mime: Schema.String;
                    readonly name: Schema.optional<any>;
                  }>,
                ]
              >
            >;
          }>,
        ]
      > & {
        is: (value: unknown) => value is ToolResultValue;
        make: (value: unknown, type?: ToolResultValue['type']) => ToolResultValue;
      };
      readonly output: Schema.optional<
        Schema.Struct<{
          readonly structured: Schema.Unknown;
          readonly content: Schema.$Array<
            Schema.Union<
              readonly [
                Schema.Struct<{
                  readonly type: Schema.Literal<'text'>;
                  readonly text: Schema.String;
                }>,
                Schema.Struct<{
                  readonly type: Schema.Literal<'file'>;
                  readonly uri: Schema.String;
                  readonly mime: Schema.String;
                  readonly name: Schema.optional<any>;
                }>,
              ]
            >
          >;
        }> & {
          make: (
            structured: unknown,
            content?: ReadonlyArray<import('./messages.js').ToolContent>,
          ) => ToolOutput;
          fromResultValue: (result: ToolResultValue) => ToolOutput | undefined;
          toResultValue: (output: ToolOutput) => ToolResultValue;
        }
      >;
      readonly providerExecuted: Schema.optional<Schema.Boolean>;
      readonly providerMetadata: Schema.optional<
        Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
      >;
    }>;
    'tool-error': Schema.Struct<{
      readonly type: Schema.tag<'tool-error'>;
      readonly id: Schema.String;
      readonly name: Schema.String;
      readonly message: Schema.String;
      readonly error: Schema.optional<Schema.Defect>;
      readonly providerMetadata: Schema.optional<
        Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
      >;
    }>;
    'step-finish': Schema.Struct<{
      readonly type: Schema.tag<'step-finish'>;
      readonly index: Schema.Number;
      readonly reason: Schema.Literals<
        readonly ['stop', 'length', 'tool-calls', 'content-filter', 'error', 'unknown']
      >;
      readonly usage: Schema.optional<typeof Usage>;
      readonly providerMetadata: Schema.optional<
        Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
      >;
    }>;
    finish: Schema.Struct<{
      readonly type: Schema.tag<'finish'>;
      readonly reason: Schema.Literals<
        readonly ['stop', 'length', 'tool-calls', 'content-filter', 'error', 'unknown']
      >;
      readonly usage: Schema.optional<typeof Usage>;
      readonly providerMetadata: Schema.optional<
        Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
      >;
    }>;
    'provider-error': Schema.Struct<{
      readonly type: Schema.tag<'provider-error'>;
      readonly message: Schema.String;
      readonly classification: Schema.optional<Schema.Literal<'context-overflow'>>;
      readonly retryable: Schema.optional<Schema.Boolean>;
      readonly providerMetadata: Schema.optional<
        Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
      >;
    }>;
  };
  readonly isAnyOf: <const Keys>(keys: readonly Keys[]) => (
    value:
      | {
          readonly type: 'step-start';
          readonly index: number;
        }
      | {
          readonly type: 'text-start';
          readonly id: string;
          readonly providerMetadata?:
            | {
                readonly [x: string]: {
                  readonly [x: string]: unknown;
                };
              }
            | undefined;
        }
      | {
          readonly type: 'text-delta';
          readonly id: string;
          readonly text: string;
          readonly providerMetadata?:
            | {
                readonly [x: string]: {
                  readonly [x: string]: unknown;
                };
              }
            | undefined;
        }
      | {
          readonly type: 'text-end';
          readonly id: string;
          readonly providerMetadata?:
            | {
                readonly [x: string]: {
                  readonly [x: string]: unknown;
                };
              }
            | undefined;
        }
      | {
          readonly type: 'reasoning-start';
          readonly id: string;
          readonly providerMetadata?:
            | {
                readonly [x: string]: {
                  readonly [x: string]: unknown;
                };
              }
            | undefined;
        }
      | {
          readonly type: 'reasoning-delta';
          readonly id: string;
          readonly text: string;
          readonly providerMetadata?:
            | {
                readonly [x: string]: {
                  readonly [x: string]: unknown;
                };
              }
            | undefined;
        }
      | {
          readonly type: 'reasoning-end';
          readonly id: string;
          readonly providerMetadata?:
            | {
                readonly [x: string]: {
                  readonly [x: string]: unknown;
                };
              }
            | undefined;
        }
      | {
          readonly type: 'tool-input-start';
          readonly id: string;
          readonly name: string;
          readonly providerMetadata?:
            | {
                readonly [x: string]: {
                  readonly [x: string]: unknown;
                };
              }
            | undefined;
        }
      | {
          readonly type: 'tool-input-delta';
          readonly id: string;
          readonly name: string;
          readonly text: string;
        }
      | {
          readonly type: 'tool-input-end';
          readonly id: string;
          readonly name: string;
          readonly providerMetadata?:
            | {
                readonly [x: string]: {
                  readonly [x: string]: unknown;
                };
              }
            | undefined;
        }
      | {
          readonly type: 'tool-call';
          readonly id: string;
          readonly name: string;
          readonly input: unknown;
          readonly providerExecuted?: boolean | undefined;
          readonly providerMetadata?:
            | {
                readonly [x: string]: {
                  readonly [x: string]: unknown;
                };
              }
            | undefined;
        }
      | {
          readonly type: 'tool-result';
          readonly id: string;
          readonly name: string;
          readonly result:
            | {
                readonly type: 'json';
                readonly value: unknown;
              }
            | {
                readonly type: 'text';
                readonly value: unknown;
              }
            | {
                readonly type: 'error';
                readonly value: unknown;
              }
            | {
                readonly type: 'content';
                readonly value: readonly (
                  | {
                      readonly type: 'text';
                      readonly text: string;
                    }
                  | {
                      readonly type: 'file';
                      readonly uri: string;
                      readonly mime: string;
                      readonly name?: any;
                    }
                )[];
              };
          readonly output?:
            | {
                readonly structured: unknown;
                readonly content: readonly (
                  | {
                      readonly type: 'text';
                      readonly text: string;
                    }
                  | {
                      readonly type: 'file';
                      readonly uri: string;
                      readonly mime: string;
                      readonly name?: any;
                    }
                )[];
              }
            | undefined;
          readonly providerExecuted?: boolean | undefined;
          readonly providerMetadata?:
            | {
                readonly [x: string]: {
                  readonly [x: string]: unknown;
                };
              }
            | undefined;
        }
      | {
          readonly type: 'tool-error';
          readonly id: string;
          readonly name: string;
          readonly message: string;
          readonly error?: unknown;
          readonly providerMetadata?:
            | {
                readonly [x: string]: {
                  readonly [x: string]: unknown;
                };
              }
            | undefined;
        }
      | {
          readonly type: 'step-finish';
          readonly index: number;
          readonly reason:
            'length' | 'error' | 'unknown' | 'stop' | 'tool-calls' | 'content-filter';
          readonly usage?: Usage | undefined;
          readonly providerMetadata?:
            | {
                readonly [x: string]: {
                  readonly [x: string]: unknown;
                };
              }
            | undefined;
        }
      | {
          readonly type: 'finish';
          readonly reason:
            'length' | 'error' | 'unknown' | 'stop' | 'tool-calls' | 'content-filter';
          readonly usage?: Usage | undefined;
          readonly providerMetadata?:
            | {
                readonly [x: string]: {
                  readonly [x: string]: unknown;
                };
              }
            | undefined;
        }
      | {
          readonly type: 'provider-error';
          readonly message: string;
          readonly classification?: 'context-overflow' | undefined;
          readonly retryable?: boolean | undefined;
          readonly providerMetadata?:
            | {
                readonly [x: string]: {
                  readonly [x: string]: unknown;
                };
              }
            | undefined;
        },
  ) => value is
    | Extract<
        {
          readonly type: 'step-start';
          readonly index: number;
        },
        {
          readonly type: Keys;
        }
      >
    | Extract<
        {
          readonly type: 'text-start';
          readonly id: string;
          readonly providerMetadata?:
            | {
                readonly [x: string]: {
                  readonly [x: string]: unknown;
                };
              }
            | undefined;
        },
        {
          readonly type: Keys;
        }
      >
    | Extract<
        {
          readonly type: 'text-delta';
          readonly id: string;
          readonly text: string;
          readonly providerMetadata?:
            | {
                readonly [x: string]: {
                  readonly [x: string]: unknown;
                };
              }
            | undefined;
        },
        {
          readonly type: Keys;
        }
      >
    | Extract<
        {
          readonly type: 'text-end';
          readonly id: string;
          readonly providerMetadata?:
            | {
                readonly [x: string]: {
                  readonly [x: string]: unknown;
                };
              }
            | undefined;
        },
        {
          readonly type: Keys;
        }
      >
    | Extract<
        {
          readonly type: 'reasoning-start';
          readonly id: string;
          readonly providerMetadata?:
            | {
                readonly [x: string]: {
                  readonly [x: string]: unknown;
                };
              }
            | undefined;
        },
        {
          readonly type: Keys;
        }
      >
    | Extract<
        {
          readonly type: 'reasoning-delta';
          readonly id: string;
          readonly text: string;
          readonly providerMetadata?:
            | {
                readonly [x: string]: {
                  readonly [x: string]: unknown;
                };
              }
            | undefined;
        },
        {
          readonly type: Keys;
        }
      >
    | Extract<
        {
          readonly type: 'reasoning-end';
          readonly id: string;
          readonly providerMetadata?:
            | {
                readonly [x: string]: {
                  readonly [x: string]: unknown;
                };
              }
            | undefined;
        },
        {
          readonly type: Keys;
        }
      >
    | Extract<
        {
          readonly type: 'tool-input-start';
          readonly id: string;
          readonly name: string;
          readonly providerMetadata?:
            | {
                readonly [x: string]: {
                  readonly [x: string]: unknown;
                };
              }
            | undefined;
        },
        {
          readonly type: Keys;
        }
      >
    | Extract<
        {
          readonly type: 'tool-input-delta';
          readonly id: string;
          readonly name: string;
          readonly text: string;
        },
        {
          readonly type: Keys;
        }
      >
    | Extract<
        {
          readonly type: 'tool-input-end';
          readonly id: string;
          readonly name: string;
          readonly providerMetadata?:
            | {
                readonly [x: string]: {
                  readonly [x: string]: unknown;
                };
              }
            | undefined;
        },
        {
          readonly type: Keys;
        }
      >
    | Extract<
        {
          readonly type: 'tool-call';
          readonly id: string;
          readonly name: string;
          readonly input: unknown;
          readonly providerExecuted?: boolean | undefined;
          readonly providerMetadata?:
            | {
                readonly [x: string]: {
                  readonly [x: string]: unknown;
                };
              }
            | undefined;
        },
        {
          readonly type: Keys;
        }
      >
    | Extract<
        {
          readonly type: 'tool-result';
          readonly id: string;
          readonly name: string;
          readonly result:
            | {
                readonly type: 'json';
                readonly value: unknown;
              }
            | {
                readonly type: 'text';
                readonly value: unknown;
              }
            | {
                readonly type: 'error';
                readonly value: unknown;
              }
            | {
                readonly type: 'content';
                readonly value: readonly (
                  | {
                      readonly type: 'text';
                      readonly text: string;
                    }
                  | {
                      readonly type: 'file';
                      readonly uri: string;
                      readonly mime: string;
                      readonly name?: any;
                    }
                )[];
              };
          readonly output?:
            | {
                readonly structured: unknown;
                readonly content: readonly (
                  | {
                      readonly type: 'text';
                      readonly text: string;
                    }
                  | {
                      readonly type: 'file';
                      readonly uri: string;
                      readonly mime: string;
                      readonly name?: any;
                    }
                )[];
              }
            | undefined;
          readonly providerExecuted?: boolean | undefined;
          readonly providerMetadata?:
            | {
                readonly [x: string]: {
                  readonly [x: string]: unknown;
                };
              }
            | undefined;
        },
        {
          readonly type: Keys;
        }
      >
    | Extract<
        {
          readonly type: 'tool-error';
          readonly id: string;
          readonly name: string;
          readonly message: string;
          readonly error?: unknown;
          readonly providerMetadata?:
            | {
                readonly [x: string]: {
                  readonly [x: string]: unknown;
                };
              }
            | undefined;
        },
        {
          readonly type: Keys;
        }
      >
    | Extract<
        {
          readonly type: 'step-finish';
          readonly index: number;
          readonly reason:
            'length' | 'error' | 'unknown' | 'stop' | 'tool-calls' | 'content-filter';
          readonly usage?: Usage | undefined;
          readonly providerMetadata?:
            | {
                readonly [x: string]: {
                  readonly [x: string]: unknown;
                };
              }
            | undefined;
        },
        {
          readonly type: Keys;
        }
      >
    | Extract<
        {
          readonly type: 'finish';
          readonly reason:
            'length' | 'error' | 'unknown' | 'stop' | 'tool-calls' | 'content-filter';
          readonly usage?: Usage | undefined;
          readonly providerMetadata?:
            | {
                readonly [x: string]: {
                  readonly [x: string]: unknown;
                };
              }
            | undefined;
        },
        {
          readonly type: Keys;
        }
      >
    | Extract<
        {
          readonly type: 'provider-error';
          readonly message: string;
          readonly classification?: 'context-overflow' | undefined;
          readonly retryable?: boolean | undefined;
          readonly providerMetadata?:
            | {
                readonly [x: string]: {
                  readonly [x: string]: unknown;
                };
              }
            | undefined;
        },
        {
          readonly type: Keys;
        }
      >;
  readonly guards: {
    'step-start': (u: unknown) => u is {
      readonly type: 'step-start';
      readonly index: number;
    };
    'text-start': (u: unknown) => u is {
      readonly type: 'text-start';
      readonly id: string;
      readonly providerMetadata?:
        | {
            readonly [x: string]: {
              readonly [x: string]: unknown;
            };
          }
        | undefined;
    };
    'text-delta': (u: unknown) => u is {
      readonly type: 'text-delta';
      readonly id: string;
      readonly text: string;
      readonly providerMetadata?:
        | {
            readonly [x: string]: {
              readonly [x: string]: unknown;
            };
          }
        | undefined;
    };
    'text-end': (u: unknown) => u is {
      readonly type: 'text-end';
      readonly id: string;
      readonly providerMetadata?:
        | {
            readonly [x: string]: {
              readonly [x: string]: unknown;
            };
          }
        | undefined;
    };
    'reasoning-start': (u: unknown) => u is {
      readonly type: 'reasoning-start';
      readonly id: string;
      readonly providerMetadata?:
        | {
            readonly [x: string]: {
              readonly [x: string]: unknown;
            };
          }
        | undefined;
    };
    'reasoning-delta': (u: unknown) => u is {
      readonly type: 'reasoning-delta';
      readonly id: string;
      readonly text: string;
      readonly providerMetadata?:
        | {
            readonly [x: string]: {
              readonly [x: string]: unknown;
            };
          }
        | undefined;
    };
    'reasoning-end': (u: unknown) => u is {
      readonly type: 'reasoning-end';
      readonly id: string;
      readonly providerMetadata?:
        | {
            readonly [x: string]: {
              readonly [x: string]: unknown;
            };
          }
        | undefined;
    };
    'tool-input-start': (u: unknown) => u is {
      readonly type: 'tool-input-start';
      readonly id: string;
      readonly name: string;
      readonly providerMetadata?:
        | {
            readonly [x: string]: {
              readonly [x: string]: unknown;
            };
          }
        | undefined;
    };
    'tool-input-delta': (u: unknown) => u is {
      readonly type: 'tool-input-delta';
      readonly id: string;
      readonly name: string;
      readonly text: string;
    };
    'tool-input-end': (u: unknown) => u is {
      readonly type: 'tool-input-end';
      readonly id: string;
      readonly name: string;
      readonly providerMetadata?:
        | {
            readonly [x: string]: {
              readonly [x: string]: unknown;
            };
          }
        | undefined;
    };
    'tool-call': (u: unknown) => u is {
      readonly type: 'tool-call';
      readonly id: string;
      readonly name: string;
      readonly input: unknown;
      readonly providerExecuted?: boolean | undefined;
      readonly providerMetadata?:
        | {
            readonly [x: string]: {
              readonly [x: string]: unknown;
            };
          }
        | undefined;
    };
    'tool-result': (u: unknown) => u is {
      readonly type: 'tool-result';
      readonly id: string;
      readonly name: string;
      readonly result:
        | {
            readonly type: 'json';
            readonly value: unknown;
          }
        | {
            readonly type: 'text';
            readonly value: unknown;
          }
        | {
            readonly type: 'error';
            readonly value: unknown;
          }
        | {
            readonly type: 'content';
            readonly value: readonly (
              | {
                  readonly type: 'text';
                  readonly text: string;
                }
              | {
                  readonly type: 'file';
                  readonly uri: string;
                  readonly mime: string;
                  readonly name?: any;
                }
            )[];
          };
      readonly output?:
        | {
            readonly structured: unknown;
            readonly content: readonly (
              | {
                  readonly type: 'text';
                  readonly text: string;
                }
              | {
                  readonly type: 'file';
                  readonly uri: string;
                  readonly mime: string;
                  readonly name?: any;
                }
            )[];
          }
        | undefined;
      readonly providerExecuted?: boolean | undefined;
      readonly providerMetadata?:
        | {
            readonly [x: string]: {
              readonly [x: string]: unknown;
            };
          }
        | undefined;
    };
    'tool-error': (u: unknown) => u is {
      readonly type: 'tool-error';
      readonly id: string;
      readonly name: string;
      readonly message: string;
      readonly error?: unknown;
      readonly providerMetadata?:
        | {
            readonly [x: string]: {
              readonly [x: string]: unknown;
            };
          }
        | undefined;
    };
    'step-finish': (u: unknown) => u is {
      readonly type: 'step-finish';
      readonly index: number;
      readonly reason: 'length' | 'error' | 'unknown' | 'stop' | 'tool-calls' | 'content-filter';
      readonly usage?: Usage | undefined;
      readonly providerMetadata?:
        | {
            readonly [x: string]: {
              readonly [x: string]: unknown;
            };
          }
        | undefined;
    };
    finish: (u: unknown) => u is {
      readonly type: 'finish';
      readonly reason: 'length' | 'error' | 'unknown' | 'stop' | 'tool-calls' | 'content-filter';
      readonly usage?: Usage | undefined;
      readonly providerMetadata?:
        | {
            readonly [x: string]: {
              readonly [x: string]: unknown;
            };
          }
        | undefined;
    };
    'provider-error': (u: unknown) => u is {
      readonly type: 'provider-error';
      readonly message: string;
      readonly classification?: 'context-overflow' | undefined;
      readonly retryable?: boolean | undefined;
      readonly providerMetadata?:
        | {
            readonly [x: string]: {
              readonly [x: string]: unknown;
            };
          }
        | undefined;
    };
  };
  readonly match: {
    <
      Cases extends {
        'step-start': (value: { readonly type: 'step-start'; readonly index: number }) => any;
        'text-start': (value: {
          readonly type: 'text-start';
          readonly id: string;
          readonly providerMetadata?:
            | {
                readonly [x: string]: {
                  readonly [x: string]: unknown;
                };
              }
            | undefined;
        }) => any;
        'text-delta': (value: {
          readonly type: 'text-delta';
          readonly id: string;
          readonly text: string;
          readonly providerMetadata?:
            | {
                readonly [x: string]: {
                  readonly [x: string]: unknown;
                };
              }
            | undefined;
        }) => any;
        'text-end': (value: {
          readonly type: 'text-end';
          readonly id: string;
          readonly providerMetadata?:
            | {
                readonly [x: string]: {
                  readonly [x: string]: unknown;
                };
              }
            | undefined;
        }) => any;
        'reasoning-start': (value: {
          readonly type: 'reasoning-start';
          readonly id: string;
          readonly providerMetadata?:
            | {
                readonly [x: string]: {
                  readonly [x: string]: unknown;
                };
              }
            | undefined;
        }) => any;
        'reasoning-delta': (value: {
          readonly type: 'reasoning-delta';
          readonly id: string;
          readonly text: string;
          readonly providerMetadata?:
            | {
                readonly [x: string]: {
                  readonly [x: string]: unknown;
                };
              }
            | undefined;
        }) => any;
        'reasoning-end': (value: {
          readonly type: 'reasoning-end';
          readonly id: string;
          readonly providerMetadata?:
            | {
                readonly [x: string]: {
                  readonly [x: string]: unknown;
                };
              }
            | undefined;
        }) => any;
        'tool-input-start': (value: {
          readonly type: 'tool-input-start';
          readonly id: string;
          readonly name: string;
          readonly providerMetadata?:
            | {
                readonly [x: string]: {
                  readonly [x: string]: unknown;
                };
              }
            | undefined;
        }) => any;
        'tool-input-delta': (value: {
          readonly type: 'tool-input-delta';
          readonly id: string;
          readonly name: string;
          readonly text: string;
        }) => any;
        'tool-input-end': (value: {
          readonly type: 'tool-input-end';
          readonly id: string;
          readonly name: string;
          readonly providerMetadata?:
            | {
                readonly [x: string]: {
                  readonly [x: string]: unknown;
                };
              }
            | undefined;
        }) => any;
        'tool-call': (value: {
          readonly type: 'tool-call';
          readonly id: string;
          readonly name: string;
          readonly input: unknown;
          readonly providerExecuted?: boolean | undefined;
          readonly providerMetadata?:
            | {
                readonly [x: string]: {
                  readonly [x: string]: unknown;
                };
              }
            | undefined;
        }) => any;
        'tool-result': (value: {
          readonly type: 'tool-result';
          readonly id: string;
          readonly name: string;
          readonly result:
            | {
                readonly type: 'json';
                readonly value: unknown;
              }
            | {
                readonly type: 'text';
                readonly value: unknown;
              }
            | {
                readonly type: 'error';
                readonly value: unknown;
              }
            | {
                readonly type: 'content';
                readonly value: readonly (
                  | {
                      readonly type: 'text';
                      readonly text: string;
                    }
                  | {
                      readonly type: 'file';
                      readonly uri: string;
                      readonly mime: string;
                      readonly name?: any;
                    }
                )[];
              };
          readonly output?:
            | {
                readonly structured: unknown;
                readonly content: readonly (
                  | {
                      readonly type: 'text';
                      readonly text: string;
                    }
                  | {
                      readonly type: 'file';
                      readonly uri: string;
                      readonly mime: string;
                      readonly name?: any;
                    }
                )[];
              }
            | undefined;
          readonly providerExecuted?: boolean | undefined;
          readonly providerMetadata?:
            | {
                readonly [x: string]: {
                  readonly [x: string]: unknown;
                };
              }
            | undefined;
        }) => any;
        'tool-error': (value: {
          readonly type: 'tool-error';
          readonly id: string;
          readonly name: string;
          readonly message: string;
          readonly error?: unknown;
          readonly providerMetadata?:
            | {
                readonly [x: string]: {
                  readonly [x: string]: unknown;
                };
              }
            | undefined;
        }) => any;
        'step-finish': (value: {
          readonly type: 'step-finish';
          readonly index: number;
          readonly reason:
            'length' | 'error' | 'unknown' | 'stop' | 'tool-calls' | 'content-filter';
          readonly usage?: Usage | undefined;
          readonly providerMetadata?:
            | {
                readonly [x: string]: {
                  readonly [x: string]: unknown;
                };
              }
            | undefined;
        }) => any;
        finish: (value: {
          readonly type: 'finish';
          readonly reason:
            'length' | 'error' | 'unknown' | 'stop' | 'tool-calls' | 'content-filter';
          readonly usage?: Usage | undefined;
          readonly providerMetadata?:
            | {
                readonly [x: string]: {
                  readonly [x: string]: unknown;
                };
              }
            | undefined;
        }) => any;
        'provider-error': (value: {
          readonly type: 'provider-error';
          readonly message: string;
          readonly classification?: 'context-overflow' | undefined;
          readonly retryable?: boolean | undefined;
          readonly providerMetadata?:
            | {
                readonly [x: string]: {
                  readonly [x: string]: unknown;
                };
              }
            | undefined;
        }) => any;
      },
    >(
      value:
        | {
            readonly type: 'step-start';
            readonly index: number;
          }
        | {
            readonly type: 'text-start';
            readonly id: string;
            readonly providerMetadata?:
              | {
                  readonly [x: string]: {
                    readonly [x: string]: unknown;
                  };
                }
              | undefined;
          }
        | {
            readonly type: 'text-delta';
            readonly id: string;
            readonly text: string;
            readonly providerMetadata?:
              | {
                  readonly [x: string]: {
                    readonly [x: string]: unknown;
                  };
                }
              | undefined;
          }
        | {
            readonly type: 'text-end';
            readonly id: string;
            readonly providerMetadata?:
              | {
                  readonly [x: string]: {
                    readonly [x: string]: unknown;
                  };
                }
              | undefined;
          }
        | {
            readonly type: 'reasoning-start';
            readonly id: string;
            readonly providerMetadata?:
              | {
                  readonly [x: string]: {
                    readonly [x: string]: unknown;
                  };
                }
              | undefined;
          }
        | {
            readonly type: 'reasoning-delta';
            readonly id: string;
            readonly text: string;
            readonly providerMetadata?:
              | {
                  readonly [x: string]: {
                    readonly [x: string]: unknown;
                  };
                }
              | undefined;
          }
        | {
            readonly type: 'reasoning-end';
            readonly id: string;
            readonly providerMetadata?:
              | {
                  readonly [x: string]: {
                    readonly [x: string]: unknown;
                  };
                }
              | undefined;
          }
        | {
            readonly type: 'tool-input-start';
            readonly id: string;
            readonly name: string;
            readonly providerMetadata?:
              | {
                  readonly [x: string]: {
                    readonly [x: string]: unknown;
                  };
                }
              | undefined;
          }
        | {
            readonly type: 'tool-input-delta';
            readonly id: string;
            readonly name: string;
            readonly text: string;
          }
        | {
            readonly type: 'tool-input-end';
            readonly id: string;
            readonly name: string;
            readonly providerMetadata?:
              | {
                  readonly [x: string]: {
                    readonly [x: string]: unknown;
                  };
                }
              | undefined;
          }
        | {
            readonly type: 'tool-call';
            readonly id: string;
            readonly name: string;
            readonly input: unknown;
            readonly providerExecuted?: boolean | undefined;
            readonly providerMetadata?:
              | {
                  readonly [x: string]: {
                    readonly [x: string]: unknown;
                  };
                }
              | undefined;
          }
        | {
            readonly type: 'tool-result';
            readonly id: string;
            readonly name: string;
            readonly result:
              | {
                  readonly type: 'json';
                  readonly value: unknown;
                }
              | {
                  readonly type: 'text';
                  readonly value: unknown;
                }
              | {
                  readonly type: 'error';
                  readonly value: unknown;
                }
              | {
                  readonly type: 'content';
                  readonly value: readonly (
                    | {
                        readonly type: 'text';
                        readonly text: string;
                      }
                    | {
                        readonly type: 'file';
                        readonly uri: string;
                        readonly mime: string;
                        readonly name?: any;
                      }
                  )[];
                };
            readonly output?:
              | {
                  readonly structured: unknown;
                  readonly content: readonly (
                    | {
                        readonly type: 'text';
                        readonly text: string;
                      }
                    | {
                        readonly type: 'file';
                        readonly uri: string;
                        readonly mime: string;
                        readonly name?: any;
                      }
                  )[];
                }
              | undefined;
            readonly providerExecuted?: boolean | undefined;
            readonly providerMetadata?:
              | {
                  readonly [x: string]: {
                    readonly [x: string]: unknown;
                  };
                }
              | undefined;
          }
        | {
            readonly type: 'tool-error';
            readonly id: string;
            readonly name: string;
            readonly message: string;
            readonly error?: unknown;
            readonly providerMetadata?:
              | {
                  readonly [x: string]: {
                    readonly [x: string]: unknown;
                  };
                }
              | undefined;
          }
        | {
            readonly type: 'step-finish';
            readonly index: number;
            readonly reason:
              'length' | 'error' | 'unknown' | 'stop' | 'tool-calls' | 'content-filter';
            readonly usage?: Usage | undefined;
            readonly providerMetadata?:
              | {
                  readonly [x: string]: {
                    readonly [x: string]: unknown;
                  };
                }
              | undefined;
          }
        | {
            readonly type: 'finish';
            readonly reason:
              'length' | 'error' | 'unknown' | 'stop' | 'tool-calls' | 'content-filter';
            readonly usage?: Usage | undefined;
            readonly providerMetadata?:
              | {
                  readonly [x: string]: {
                    readonly [x: string]: unknown;
                  };
                }
              | undefined;
          }
        | {
            readonly type: 'provider-error';
            readonly message: string;
            readonly classification?: 'context-overflow' | undefined;
            readonly retryable?: boolean | undefined;
            readonly providerMetadata?:
              | {
                  readonly [x: string]: {
                    readonly [x: string]: unknown;
                  };
                }
              | undefined;
          },
      cases: Cases,
    ): Cases[keyof Cases] extends (value: any) => infer R ? import('effect/Unify').Unify<R> : never;
    <
      Cases extends {
        'step-start': (value: { readonly type: 'step-start'; readonly index: number }) => any;
        'text-start': (value: {
          readonly type: 'text-start';
          readonly id: string;
          readonly providerMetadata?:
            | {
                readonly [x: string]: {
                  readonly [x: string]: unknown;
                };
              }
            | undefined;
        }) => any;
        'text-delta': (value: {
          readonly type: 'text-delta';
          readonly id: string;
          readonly text: string;
          readonly providerMetadata?:
            | {
                readonly [x: string]: {
                  readonly [x: string]: unknown;
                };
              }
            | undefined;
        }) => any;
        'text-end': (value: {
          readonly type: 'text-end';
          readonly id: string;
          readonly providerMetadata?:
            | {
                readonly [x: string]: {
                  readonly [x: string]: unknown;
                };
              }
            | undefined;
        }) => any;
        'reasoning-start': (value: {
          readonly type: 'reasoning-start';
          readonly id: string;
          readonly providerMetadata?:
            | {
                readonly [x: string]: {
                  readonly [x: string]: unknown;
                };
              }
            | undefined;
        }) => any;
        'reasoning-delta': (value: {
          readonly type: 'reasoning-delta';
          readonly id: string;
          readonly text: string;
          readonly providerMetadata?:
            | {
                readonly [x: string]: {
                  readonly [x: string]: unknown;
                };
              }
            | undefined;
        }) => any;
        'reasoning-end': (value: {
          readonly type: 'reasoning-end';
          readonly id: string;
          readonly providerMetadata?:
            | {
                readonly [x: string]: {
                  readonly [x: string]: unknown;
                };
              }
            | undefined;
        }) => any;
        'tool-input-start': (value: {
          readonly type: 'tool-input-start';
          readonly id: string;
          readonly name: string;
          readonly providerMetadata?:
            | {
                readonly [x: string]: {
                  readonly [x: string]: unknown;
                };
              }
            | undefined;
        }) => any;
        'tool-input-delta': (value: {
          readonly type: 'tool-input-delta';
          readonly id: string;
          readonly name: string;
          readonly text: string;
        }) => any;
        'tool-input-end': (value: {
          readonly type: 'tool-input-end';
          readonly id: string;
          readonly name: string;
          readonly providerMetadata?:
            | {
                readonly [x: string]: {
                  readonly [x: string]: unknown;
                };
              }
            | undefined;
        }) => any;
        'tool-call': (value: {
          readonly type: 'tool-call';
          readonly id: string;
          readonly name: string;
          readonly input: unknown;
          readonly providerExecuted?: boolean | undefined;
          readonly providerMetadata?:
            | {
                readonly [x: string]: {
                  readonly [x: string]: unknown;
                };
              }
            | undefined;
        }) => any;
        'tool-result': (value: {
          readonly type: 'tool-result';
          readonly id: string;
          readonly name: string;
          readonly result:
            | {
                readonly type: 'json';
                readonly value: unknown;
              }
            | {
                readonly type: 'text';
                readonly value: unknown;
              }
            | {
                readonly type: 'error';
                readonly value: unknown;
              }
            | {
                readonly type: 'content';
                readonly value: readonly (
                  | {
                      readonly type: 'text';
                      readonly text: string;
                    }
                  | {
                      readonly type: 'file';
                      readonly uri: string;
                      readonly mime: string;
                      readonly name?: any;
                    }
                )[];
              };
          readonly output?:
            | {
                readonly structured: unknown;
                readonly content: readonly (
                  | {
                      readonly type: 'text';
                      readonly text: string;
                    }
                  | {
                      readonly type: 'file';
                      readonly uri: string;
                      readonly mime: string;
                      readonly name?: any;
                    }
                )[];
              }
            | undefined;
          readonly providerExecuted?: boolean | undefined;
          readonly providerMetadata?:
            | {
                readonly [x: string]: {
                  readonly [x: string]: unknown;
                };
              }
            | undefined;
        }) => any;
        'tool-error': (value: {
          readonly type: 'tool-error';
          readonly id: string;
          readonly name: string;
          readonly message: string;
          readonly error?: unknown;
          readonly providerMetadata?:
            | {
                readonly [x: string]: {
                  readonly [x: string]: unknown;
                };
              }
            | undefined;
        }) => any;
        'step-finish': (value: {
          readonly type: 'step-finish';
          readonly index: number;
          readonly reason:
            'length' | 'error' | 'unknown' | 'stop' | 'tool-calls' | 'content-filter';
          readonly usage?: Usage | undefined;
          readonly providerMetadata?:
            | {
                readonly [x: string]: {
                  readonly [x: string]: unknown;
                };
              }
            | undefined;
        }) => any;
        finish: (value: {
          readonly type: 'finish';
          readonly reason:
            'length' | 'error' | 'unknown' | 'stop' | 'tool-calls' | 'content-filter';
          readonly usage?: Usage | undefined;
          readonly providerMetadata?:
            | {
                readonly [x: string]: {
                  readonly [x: string]: unknown;
                };
              }
            | undefined;
        }) => any;
        'provider-error': (value: {
          readonly type: 'provider-error';
          readonly message: string;
          readonly classification?: 'context-overflow' | undefined;
          readonly retryable?: boolean | undefined;
          readonly providerMetadata?:
            | {
                readonly [x: string]: {
                  readonly [x: string]: unknown;
                };
              }
            | undefined;
        }) => any;
      },
    >(
      cases: Cases,
    ): (
      value:
        | {
            readonly type: 'step-start';
            readonly index: number;
          }
        | {
            readonly type: 'text-start';
            readonly id: string;
            readonly providerMetadata?:
              | {
                  readonly [x: string]: {
                    readonly [x: string]: unknown;
                  };
                }
              | undefined;
          }
        | {
            readonly type: 'text-delta';
            readonly id: string;
            readonly text: string;
            readonly providerMetadata?:
              | {
                  readonly [x: string]: {
                    readonly [x: string]: unknown;
                  };
                }
              | undefined;
          }
        | {
            readonly type: 'text-end';
            readonly id: string;
            readonly providerMetadata?:
              | {
                  readonly [x: string]: {
                    readonly [x: string]: unknown;
                  };
                }
              | undefined;
          }
        | {
            readonly type: 'reasoning-start';
            readonly id: string;
            readonly providerMetadata?:
              | {
                  readonly [x: string]: {
                    readonly [x: string]: unknown;
                  };
                }
              | undefined;
          }
        | {
            readonly type: 'reasoning-delta';
            readonly id: string;
            readonly text: string;
            readonly providerMetadata?:
              | {
                  readonly [x: string]: {
                    readonly [x: string]: unknown;
                  };
                }
              | undefined;
          }
        | {
            readonly type: 'reasoning-end';
            readonly id: string;
            readonly providerMetadata?:
              | {
                  readonly [x: string]: {
                    readonly [x: string]: unknown;
                  };
                }
              | undefined;
          }
        | {
            readonly type: 'tool-input-start';
            readonly id: string;
            readonly name: string;
            readonly providerMetadata?:
              | {
                  readonly [x: string]: {
                    readonly [x: string]: unknown;
                  };
                }
              | undefined;
          }
        | {
            readonly type: 'tool-input-delta';
            readonly id: string;
            readonly name: string;
            readonly text: string;
          }
        | {
            readonly type: 'tool-input-end';
            readonly id: string;
            readonly name: string;
            readonly providerMetadata?:
              | {
                  readonly [x: string]: {
                    readonly [x: string]: unknown;
                  };
                }
              | undefined;
          }
        | {
            readonly type: 'tool-call';
            readonly id: string;
            readonly name: string;
            readonly input: unknown;
            readonly providerExecuted?: boolean | undefined;
            readonly providerMetadata?:
              | {
                  readonly [x: string]: {
                    readonly [x: string]: unknown;
                  };
                }
              | undefined;
          }
        | {
            readonly type: 'tool-result';
            readonly id: string;
            readonly name: string;
            readonly result:
              | {
                  readonly type: 'json';
                  readonly value: unknown;
                }
              | {
                  readonly type: 'text';
                  readonly value: unknown;
                }
              | {
                  readonly type: 'error';
                  readonly value: unknown;
                }
              | {
                  readonly type: 'content';
                  readonly value: readonly (
                    | {
                        readonly type: 'text';
                        readonly text: string;
                      }
                    | {
                        readonly type: 'file';
                        readonly uri: string;
                        readonly mime: string;
                        readonly name?: any;
                      }
                  )[];
                };
            readonly output?:
              | {
                  readonly structured: unknown;
                  readonly content: readonly (
                    | {
                        readonly type: 'text';
                        readonly text: string;
                      }
                    | {
                        readonly type: 'file';
                        readonly uri: string;
                        readonly mime: string;
                        readonly name?: any;
                      }
                  )[];
                }
              | undefined;
            readonly providerExecuted?: boolean | undefined;
            readonly providerMetadata?:
              | {
                  readonly [x: string]: {
                    readonly [x: string]: unknown;
                  };
                }
              | undefined;
          }
        | {
            readonly type: 'tool-error';
            readonly id: string;
            readonly name: string;
            readonly message: string;
            readonly error?: unknown;
            readonly providerMetadata?:
              | {
                  readonly [x: string]: {
                    readonly [x: string]: unknown;
                  };
                }
              | undefined;
          }
        | {
            readonly type: 'step-finish';
            readonly index: number;
            readonly reason:
              'length' | 'error' | 'unknown' | 'stop' | 'tool-calls' | 'content-filter';
            readonly usage?: Usage | undefined;
            readonly providerMetadata?:
              | {
                  readonly [x: string]: {
                    readonly [x: string]: unknown;
                  };
                }
              | undefined;
          }
        | {
            readonly type: 'finish';
            readonly reason:
              'length' | 'error' | 'unknown' | 'stop' | 'tool-calls' | 'content-filter';
            readonly usage?: Usage | undefined;
            readonly providerMetadata?:
              | {
                  readonly [x: string]: {
                    readonly [x: string]: unknown;
                  };
                }
              | undefined;
          }
        | {
            readonly type: 'provider-error';
            readonly message: string;
            readonly classification?: 'context-overflow' | undefined;
            readonly retryable?: boolean | undefined;
            readonly providerMetadata?:
              | {
                  readonly [x: string]: {
                    readonly [x: string]: unknown;
                  };
                }
              | undefined;
          },
    ) => Cases[keyof Cases] extends (value: any) => infer R
      ? import('effect/Unify').Unify<R>
      : never;
  };
} & {
  stepStart: (
    input: {
      readonly index: number;
      readonly type?: 'step-start' | undefined;
    },
    options?: Schema.MakeOptions,
  ) => {
    readonly type: 'step-start';
    readonly index: number;
  };
  textStart: (input: WithID<TextStart, ContentBlockID>) => {
    readonly type: 'text-start';
    readonly id: string;
    readonly providerMetadata?:
      | {
          readonly [x: string]: {
            readonly [x: string]: unknown;
          };
        }
      | undefined;
  };
  textDelta: (input: WithID<TextDelta, ContentBlockID>) => {
    readonly type: 'text-delta';
    readonly id: string;
    readonly text: string;
    readonly providerMetadata?:
      | {
          readonly [x: string]: {
            readonly [x: string]: unknown;
          };
        }
      | undefined;
  };
  textEnd: (input: WithID<TextEnd, ContentBlockID>) => {
    readonly type: 'text-end';
    readonly id: string;
    readonly providerMetadata?:
      | {
          readonly [x: string]: {
            readonly [x: string]: unknown;
          };
        }
      | undefined;
  };
  reasoningStart: (input: WithID<ReasoningStart, ContentBlockID>) => {
    readonly type: 'reasoning-start';
    readonly id: string;
    readonly providerMetadata?:
      | {
          readonly [x: string]: {
            readonly [x: string]: unknown;
          };
        }
      | undefined;
  };
  reasoningDelta: (input: WithID<ReasoningDelta, ContentBlockID>) => {
    readonly type: 'reasoning-delta';
    readonly id: string;
    readonly text: string;
    readonly providerMetadata?:
      | {
          readonly [x: string]: {
            readonly [x: string]: unknown;
          };
        }
      | undefined;
  };
  reasoningEnd: (input: WithID<ReasoningEnd, ContentBlockID>) => {
    readonly type: 'reasoning-end';
    readonly id: string;
    readonly providerMetadata?:
      | {
          readonly [x: string]: {
            readonly [x: string]: unknown;
          };
        }
      | undefined;
  };
  toolInputStart: (input: WithID<ToolInputStart, ToolCallID>) => {
    readonly type: 'tool-input-start';
    readonly id: string;
    readonly name: string;
    readonly providerMetadata?:
      | {
          readonly [x: string]: {
            readonly [x: string]: unknown;
          };
        }
      | undefined;
  };
  toolInputDelta: (input: WithID<ToolInputDelta, ToolCallID>) => {
    readonly type: 'tool-input-delta';
    readonly id: string;
    readonly name: string;
    readonly text: string;
  };
  toolInputEnd: (input: WithID<ToolInputEnd, ToolCallID>) => {
    readonly type: 'tool-input-end';
    readonly id: string;
    readonly name: string;
    readonly providerMetadata?:
      | {
          readonly [x: string]: {
            readonly [x: string]: unknown;
          };
        }
      | undefined;
  };
  toolCall: (input: WithID<ToolCall, ToolCallID>) => {
    readonly type: 'tool-call';
    readonly id: string;
    readonly name: string;
    readonly input: unknown;
    readonly providerExecuted?: boolean | undefined;
    readonly providerMetadata?:
      | {
          readonly [x: string]: {
            readonly [x: string]: unknown;
          };
        }
      | undefined;
  };
  toolResult: (input: WithID<ToolResult, ToolCallID>) => {
    readonly type: 'tool-result';
    readonly id: string;
    readonly name: string;
    readonly result:
      | {
          readonly type: 'json';
          readonly value: unknown;
        }
      | {
          readonly type: 'text';
          readonly value: unknown;
        }
      | {
          readonly type: 'error';
          readonly value: unknown;
        }
      | {
          readonly type: 'content';
          readonly value: readonly (
            | {
                readonly type: 'text';
                readonly text: string;
              }
            | {
                readonly type: 'file';
                readonly uri: string;
                readonly mime: string;
                readonly name?: any;
              }
          )[];
        };
    readonly output?:
      | {
          readonly structured: unknown;
          readonly content: readonly (
            | {
                readonly type: 'text';
                readonly text: string;
              }
            | {
                readonly type: 'file';
                readonly uri: string;
                readonly mime: string;
                readonly name?: any;
              }
          )[];
        }
      | undefined;
    readonly providerExecuted?: boolean | undefined;
    readonly providerMetadata?:
      | {
          readonly [x: string]: {
            readonly [x: string]: unknown;
          };
        }
      | undefined;
  };
  toolError: (input: WithID<ToolError, ToolCallID>) => {
    readonly type: 'tool-error';
    readonly id: string;
    readonly name: string;
    readonly message: string;
    readonly error?: unknown;
    readonly providerMetadata?:
      | {
          readonly [x: string]: {
            readonly [x: string]: unknown;
          };
        }
      | undefined;
  };
  stepFinish: (input: WithUsage<StepFinish>) => {
    readonly type: 'step-finish';
    readonly index: number;
    readonly reason: 'length' | 'error' | 'unknown' | 'stop' | 'tool-calls' | 'content-filter';
    readonly usage?: Usage | undefined;
    readonly providerMetadata?:
      | {
          readonly [x: string]: {
            readonly [x: string]: unknown;
          };
        }
      | undefined;
  };
  finish: (input: WithUsage<Finish>) => {
    readonly type: 'finish';
    readonly reason: 'length' | 'error' | 'unknown' | 'stop' | 'tool-calls' | 'content-filter';
    readonly usage?: Usage | undefined;
    readonly providerMetadata?:
      | {
          readonly [x: string]: {
            readonly [x: string]: unknown;
          };
        }
      | undefined;
  };
  providerError: (
    input: {
      readonly message: string;
      readonly type?: 'provider-error' | undefined;
      readonly classification?: 'context-overflow' | undefined;
      readonly retryable?: boolean | undefined;
      readonly providerMetadata?:
        | {
            readonly [x: string]: {
              readonly [x: string]: unknown;
            };
          }
        | undefined;
    },
    options?: Schema.MakeOptions,
  ) => {
    readonly type: 'provider-error';
    readonly message: string;
    readonly classification?: 'context-overflow' | undefined;
    readonly retryable?: boolean | undefined;
    readonly providerMetadata?:
      | {
          readonly [x: string]: {
            readonly [x: string]: unknown;
          };
        }
      | undefined;
  };
  is: {
    stepStart: (u: unknown) => u is {
      readonly type: 'step-start';
      readonly index: number;
    };
    textStart: (u: unknown) => u is {
      readonly type: 'text-start';
      readonly id: string;
      readonly providerMetadata?:
        | {
            readonly [x: string]: {
              readonly [x: string]: unknown;
            };
          }
        | undefined;
    };
    textDelta: (u: unknown) => u is {
      readonly type: 'text-delta';
      readonly id: string;
      readonly text: string;
      readonly providerMetadata?:
        | {
            readonly [x: string]: {
              readonly [x: string]: unknown;
            };
          }
        | undefined;
    };
    textEnd: (u: unknown) => u is {
      readonly type: 'text-end';
      readonly id: string;
      readonly providerMetadata?:
        | {
            readonly [x: string]: {
              readonly [x: string]: unknown;
            };
          }
        | undefined;
    };
    reasoningStart: (u: unknown) => u is {
      readonly type: 'reasoning-start';
      readonly id: string;
      readonly providerMetadata?:
        | {
            readonly [x: string]: {
              readonly [x: string]: unknown;
            };
          }
        | undefined;
    };
    reasoningDelta: (u: unknown) => u is {
      readonly type: 'reasoning-delta';
      readonly id: string;
      readonly text: string;
      readonly providerMetadata?:
        | {
            readonly [x: string]: {
              readonly [x: string]: unknown;
            };
          }
        | undefined;
    };
    reasoningEnd: (u: unknown) => u is {
      readonly type: 'reasoning-end';
      readonly id: string;
      readonly providerMetadata?:
        | {
            readonly [x: string]: {
              readonly [x: string]: unknown;
            };
          }
        | undefined;
    };
    toolInputStart: (u: unknown) => u is {
      readonly type: 'tool-input-start';
      readonly id: string;
      readonly name: string;
      readonly providerMetadata?:
        | {
            readonly [x: string]: {
              readonly [x: string]: unknown;
            };
          }
        | undefined;
    };
    toolInputDelta: (u: unknown) => u is {
      readonly type: 'tool-input-delta';
      readonly id: string;
      readonly name: string;
      readonly text: string;
    };
    toolInputEnd: (u: unknown) => u is {
      readonly type: 'tool-input-end';
      readonly id: string;
      readonly name: string;
      readonly providerMetadata?:
        | {
            readonly [x: string]: {
              readonly [x: string]: unknown;
            };
          }
        | undefined;
    };
    toolCall: (u: unknown) => u is {
      readonly type: 'tool-call';
      readonly id: string;
      readonly name: string;
      readonly input: unknown;
      readonly providerExecuted?: boolean | undefined;
      readonly providerMetadata?:
        | {
            readonly [x: string]: {
              readonly [x: string]: unknown;
            };
          }
        | undefined;
    };
    toolResult: (u: unknown) => u is {
      readonly type: 'tool-result';
      readonly id: string;
      readonly name: string;
      readonly result:
        | {
            readonly type: 'json';
            readonly value: unknown;
          }
        | {
            readonly type: 'text';
            readonly value: unknown;
          }
        | {
            readonly type: 'error';
            readonly value: unknown;
          }
        | {
            readonly type: 'content';
            readonly value: readonly (
              | {
                  readonly type: 'text';
                  readonly text: string;
                }
              | {
                  readonly type: 'file';
                  readonly uri: string;
                  readonly mime: string;
                  readonly name?: any;
                }
            )[];
          };
      readonly output?:
        | {
            readonly structured: unknown;
            readonly content: readonly (
              | {
                  readonly type: 'text';
                  readonly text: string;
                }
              | {
                  readonly type: 'file';
                  readonly uri: string;
                  readonly mime: string;
                  readonly name?: any;
                }
            )[];
          }
        | undefined;
      readonly providerExecuted?: boolean | undefined;
      readonly providerMetadata?:
        | {
            readonly [x: string]: {
              readonly [x: string]: unknown;
            };
          }
        | undefined;
    };
    toolError: (u: unknown) => u is {
      readonly type: 'tool-error';
      readonly id: string;
      readonly name: string;
      readonly message: string;
      readonly error?: unknown;
      readonly providerMetadata?:
        | {
            readonly [x: string]: {
              readonly [x: string]: unknown;
            };
          }
        | undefined;
    };
    stepFinish: (u: unknown) => u is {
      readonly type: 'step-finish';
      readonly index: number;
      readonly reason: 'length' | 'error' | 'unknown' | 'stop' | 'tool-calls' | 'content-filter';
      readonly usage?: Usage | undefined;
      readonly providerMetadata?:
        | {
            readonly [x: string]: {
              readonly [x: string]: unknown;
            };
          }
        | undefined;
    };
    finish: (u: unknown) => u is {
      readonly type: 'finish';
      readonly reason: 'length' | 'error' | 'unknown' | 'stop' | 'tool-calls' | 'content-filter';
      readonly usage?: Usage | undefined;
      readonly providerMetadata?:
        | {
            readonly [x: string]: {
              readonly [x: string]: unknown;
            };
          }
        | undefined;
    };
    providerError: (u: unknown) => u is {
      readonly type: 'provider-error';
      readonly message: string;
      readonly classification?: 'context-overflow' | undefined;
      readonly retryable?: boolean | undefined;
      readonly providerMetadata?:
        | {
            readonly [x: string]: {
              readonly [x: string]: unknown;
            };
          }
        | undefined;
    };
  };
};
export type LLMEvent = Schema.Schema.Type<typeof llmEventTagged>;
declare const PreparedRequest_base: Schema.Class<
  PreparedRequest,
  Schema.Struct<{
    readonly id: Schema.String;
    readonly route: Schema.String;
    readonly protocol: Schema.String;
    readonly model: Schema.declare<import('./options.js').Model, import('./options.js').Model>;
    readonly body: Schema.Unknown;
    readonly metadata: Schema.optional<Schema.$Record<Schema.String, Schema.Unknown>>;
  }>,
  {}
>;
export declare class PreparedRequest extends PreparedRequest_base {}
/**
 * A `PreparedRequest` whose `body` is typed as `Body`. Use with the generic
 * on `LLMClient.prepare<Body>(...)` when the caller knows which route their
 * request will resolve to and wants its native shape statically exposed
 * (debug UIs, request previews, plan rendering).
 *
 * The runtime body is identical — the route still emits `body: unknown` — so
 * this is a type-level assertion the caller makes about what they expect to
 * find. The prepare runtime does not validate the assertion.
 */
export type PreparedRequestOf<Body> = Omit<PreparedRequest, 'body'> & {
  readonly body: Body;
};
interface ContentAssembly {
  readonly contentIndex: number;
  readonly text: string;
  readonly providerMetadata?: ProviderMetadata;
}
interface ToolInputAssembly {
  readonly name: string;
  readonly text: string;
  readonly providerMetadata?: ProviderMetadata;
}
interface ResponseState {
  readonly events: ReadonlyArray<LLMEvent>;
  readonly message: Message;
  readonly usage?: Usage;
  readonly finishReason?: FinishReason;
  readonly textParts: Readonly<Record<string, ContentAssembly>>;
  readonly reasoningParts: Readonly<Record<string, ContentAssembly>>;
  readonly toolInputs: Readonly<Record<string, ToolInputAssembly>>;
}
declare const LLMResponse_base: Schema.Class<
  LLMResponse,
  Schema.Struct<{
    readonly message: typeof Message;
    readonly events: Schema.$Array<
      Schema.Union<
        readonly [
          Schema.Struct<{
            readonly type: Schema.tag<'step-start'>;
            readonly index: Schema.Number;
          }>,
          Schema.Struct<{
            readonly type: Schema.tag<'text-start'>;
            readonly id: Schema.String;
            readonly providerMetadata: Schema.optional<
              Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
            >;
          }>,
          Schema.Struct<{
            readonly type: Schema.tag<'text-delta'>;
            readonly id: Schema.String;
            readonly text: Schema.String;
            readonly providerMetadata: Schema.optional<
              Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
            >;
          }>,
          Schema.Struct<{
            readonly type: Schema.tag<'text-end'>;
            readonly id: Schema.String;
            readonly providerMetadata: Schema.optional<
              Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
            >;
          }>,
          Schema.Struct<{
            readonly type: Schema.tag<'reasoning-start'>;
            readonly id: Schema.String;
            readonly providerMetadata: Schema.optional<
              Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
            >;
          }>,
          Schema.Struct<{
            readonly type: Schema.tag<'reasoning-delta'>;
            readonly id: Schema.String;
            readonly text: Schema.String;
            readonly providerMetadata: Schema.optional<
              Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
            >;
          }>,
          Schema.Struct<{
            readonly type: Schema.tag<'reasoning-end'>;
            readonly id: Schema.String;
            readonly providerMetadata: Schema.optional<
              Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
            >;
          }>,
          Schema.Struct<{
            readonly type: Schema.tag<'tool-input-start'>;
            readonly id: Schema.String;
            readonly name: Schema.String;
            readonly providerMetadata: Schema.optional<
              Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
            >;
          }>,
          Schema.Struct<{
            readonly type: Schema.tag<'tool-input-delta'>;
            readonly id: Schema.String;
            readonly name: Schema.String;
            readonly text: Schema.String;
          }>,
          Schema.Struct<{
            readonly type: Schema.tag<'tool-input-end'>;
            readonly id: Schema.String;
            readonly name: Schema.String;
            readonly providerMetadata: Schema.optional<
              Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
            >;
          }>,
          Schema.Struct<{
            readonly type: Schema.tag<'tool-call'>;
            readonly id: Schema.String;
            readonly name: Schema.String;
            readonly input: Schema.Unknown;
            readonly providerExecuted: Schema.optional<Schema.Boolean>;
            readonly providerMetadata: Schema.optional<
              Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
            >;
          }>,
          Schema.Struct<{
            readonly type: Schema.tag<'tool-result'>;
            readonly id: Schema.String;
            readonly name: Schema.String;
            readonly result: Schema.Union<
              readonly [
                Schema.Struct<{
                  readonly type: Schema.Literal<'json'>;
                  readonly value: Schema.Unknown;
                }>,
                Schema.Struct<{
                  readonly type: Schema.Literal<'text'>;
                  readonly value: Schema.Unknown;
                }>,
                Schema.Struct<{
                  readonly type: Schema.Literal<'error'>;
                  readonly value: Schema.Unknown;
                }>,
                Schema.Struct<{
                  readonly type: Schema.Literal<'content'>;
                  readonly value: Schema.$Array<
                    Schema.Union<
                      readonly [
                        Schema.Struct<{
                          readonly type: Schema.Literal<'text'>;
                          readonly text: Schema.String;
                        }>,
                        Schema.Struct<{
                          readonly type: Schema.Literal<'file'>;
                          readonly uri: Schema.String;
                          readonly mime: Schema.String;
                          readonly name: Schema.optional<any>;
                        }>,
                      ]
                    >
                  >;
                }>,
              ]
            > & {
              is: (value: unknown) => value is ToolResultValue;
              make: (value: unknown, type?: ToolResultValue['type']) => ToolResultValue;
            };
            readonly output: Schema.optional<
              Schema.Struct<{
                readonly structured: Schema.Unknown;
                readonly content: Schema.$Array<
                  Schema.Union<
                    readonly [
                      Schema.Struct<{
                        readonly type: Schema.Literal<'text'>;
                        readonly text: Schema.String;
                      }>,
                      Schema.Struct<{
                        readonly type: Schema.Literal<'file'>;
                        readonly uri: Schema.String;
                        readonly mime: Schema.String;
                        readonly name: Schema.optional<any>;
                      }>,
                    ]
                  >
                >;
              }> & {
                make: (
                  structured: unknown,
                  content?: ReadonlyArray<import('./messages.js').ToolContent>,
                ) => ToolOutput;
                fromResultValue: (result: ToolResultValue) => ToolOutput | undefined;
                toResultValue: (output: ToolOutput) => ToolResultValue;
              }
            >;
            readonly providerExecuted: Schema.optional<Schema.Boolean>;
            readonly providerMetadata: Schema.optional<
              Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
            >;
          }>,
          Schema.Struct<{
            readonly type: Schema.tag<'tool-error'>;
            readonly id: Schema.String;
            readonly name: Schema.String;
            readonly message: Schema.String;
            readonly error: Schema.optional<Schema.Defect>;
            readonly providerMetadata: Schema.optional<
              Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
            >;
          }>,
          Schema.Struct<{
            readonly type: Schema.tag<'step-finish'>;
            readonly index: Schema.Number;
            readonly reason: Schema.Literals<
              readonly ['stop', 'length', 'tool-calls', 'content-filter', 'error', 'unknown']
            >;
            readonly usage: Schema.optional<typeof Usage>;
            readonly providerMetadata: Schema.optional<
              Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
            >;
          }>,
          Schema.Struct<{
            readonly type: Schema.tag<'finish'>;
            readonly reason: Schema.Literals<
              readonly ['stop', 'length', 'tool-calls', 'content-filter', 'error', 'unknown']
            >;
            readonly usage: Schema.optional<typeof Usage>;
            readonly providerMetadata: Schema.optional<
              Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
            >;
          }>,
          Schema.Struct<{
            readonly type: Schema.tag<'provider-error'>;
            readonly message: Schema.String;
            readonly classification: Schema.optional<Schema.Literal<'context-overflow'>>;
            readonly retryable: Schema.optional<Schema.Boolean>;
            readonly providerMetadata: Schema.optional<
              Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
            >;
          }>,
        ]
      > & {
        readonly cases: {
          'step-start': Schema.Struct<{
            readonly type: Schema.tag<'step-start'>;
            readonly index: Schema.Number;
          }>;
          'text-start': Schema.Struct<{
            readonly type: Schema.tag<'text-start'>;
            readonly id: Schema.String;
            readonly providerMetadata: Schema.optional<
              Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
            >;
          }>;
          'text-delta': Schema.Struct<{
            readonly type: Schema.tag<'text-delta'>;
            readonly id: Schema.String;
            readonly text: Schema.String;
            readonly providerMetadata: Schema.optional<
              Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
            >;
          }>;
          'text-end': Schema.Struct<{
            readonly type: Schema.tag<'text-end'>;
            readonly id: Schema.String;
            readonly providerMetadata: Schema.optional<
              Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
            >;
          }>;
          'reasoning-start': Schema.Struct<{
            readonly type: Schema.tag<'reasoning-start'>;
            readonly id: Schema.String;
            readonly providerMetadata: Schema.optional<
              Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
            >;
          }>;
          'reasoning-delta': Schema.Struct<{
            readonly type: Schema.tag<'reasoning-delta'>;
            readonly id: Schema.String;
            readonly text: Schema.String;
            readonly providerMetadata: Schema.optional<
              Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
            >;
          }>;
          'reasoning-end': Schema.Struct<{
            readonly type: Schema.tag<'reasoning-end'>;
            readonly id: Schema.String;
            readonly providerMetadata: Schema.optional<
              Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
            >;
          }>;
          'tool-input-start': Schema.Struct<{
            readonly type: Schema.tag<'tool-input-start'>;
            readonly id: Schema.String;
            readonly name: Schema.String;
            readonly providerMetadata: Schema.optional<
              Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
            >;
          }>;
          'tool-input-delta': Schema.Struct<{
            readonly type: Schema.tag<'tool-input-delta'>;
            readonly id: Schema.String;
            readonly name: Schema.String;
            readonly text: Schema.String;
          }>;
          'tool-input-end': Schema.Struct<{
            readonly type: Schema.tag<'tool-input-end'>;
            readonly id: Schema.String;
            readonly name: Schema.String;
            readonly providerMetadata: Schema.optional<
              Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
            >;
          }>;
          'tool-call': Schema.Struct<{
            readonly type: Schema.tag<'tool-call'>;
            readonly id: Schema.String;
            readonly name: Schema.String;
            readonly input: Schema.Unknown;
            readonly providerExecuted: Schema.optional<Schema.Boolean>;
            readonly providerMetadata: Schema.optional<
              Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
            >;
          }>;
          'tool-result': Schema.Struct<{
            readonly type: Schema.tag<'tool-result'>;
            readonly id: Schema.String;
            readonly name: Schema.String;
            readonly result: Schema.Union<
              readonly [
                Schema.Struct<{
                  readonly type: Schema.Literal<'json'>;
                  readonly value: Schema.Unknown;
                }>,
                Schema.Struct<{
                  readonly type: Schema.Literal<'text'>;
                  readonly value: Schema.Unknown;
                }>,
                Schema.Struct<{
                  readonly type: Schema.Literal<'error'>;
                  readonly value: Schema.Unknown;
                }>,
                Schema.Struct<{
                  readonly type: Schema.Literal<'content'>;
                  readonly value: Schema.$Array<
                    Schema.Union<
                      readonly [
                        Schema.Struct<{
                          readonly type: Schema.Literal<'text'>;
                          readonly text: Schema.String;
                        }>,
                        Schema.Struct<{
                          readonly type: Schema.Literal<'file'>;
                          readonly uri: Schema.String;
                          readonly mime: Schema.String;
                          readonly name: Schema.optional<any>;
                        }>,
                      ]
                    >
                  >;
                }>,
              ]
            > & {
              is: (value: unknown) => value is ToolResultValue;
              make: (value: unknown, type?: ToolResultValue['type']) => ToolResultValue;
            };
            readonly output: Schema.optional<
              Schema.Struct<{
                readonly structured: Schema.Unknown;
                readonly content: Schema.$Array<
                  Schema.Union<
                    readonly [
                      Schema.Struct<{
                        readonly type: Schema.Literal<'text'>;
                        readonly text: Schema.String;
                      }>,
                      Schema.Struct<{
                        readonly type: Schema.Literal<'file'>;
                        readonly uri: Schema.String;
                        readonly mime: Schema.String;
                        readonly name: Schema.optional<any>;
                      }>,
                    ]
                  >
                >;
              }> & {
                make: (
                  structured: unknown,
                  content?: ReadonlyArray<import('./messages.js').ToolContent>,
                ) => ToolOutput;
                fromResultValue: (result: ToolResultValue) => ToolOutput | undefined;
                toResultValue: (output: ToolOutput) => ToolResultValue;
              }
            >;
            readonly providerExecuted: Schema.optional<Schema.Boolean>;
            readonly providerMetadata: Schema.optional<
              Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
            >;
          }>;
          'tool-error': Schema.Struct<{
            readonly type: Schema.tag<'tool-error'>;
            readonly id: Schema.String;
            readonly name: Schema.String;
            readonly message: Schema.String;
            readonly error: Schema.optional<Schema.Defect>;
            readonly providerMetadata: Schema.optional<
              Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
            >;
          }>;
          'step-finish': Schema.Struct<{
            readonly type: Schema.tag<'step-finish'>;
            readonly index: Schema.Number;
            readonly reason: Schema.Literals<
              readonly ['stop', 'length', 'tool-calls', 'content-filter', 'error', 'unknown']
            >;
            readonly usage: Schema.optional<typeof Usage>;
            readonly providerMetadata: Schema.optional<
              Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
            >;
          }>;
          finish: Schema.Struct<{
            readonly type: Schema.tag<'finish'>;
            readonly reason: Schema.Literals<
              readonly ['stop', 'length', 'tool-calls', 'content-filter', 'error', 'unknown']
            >;
            readonly usage: Schema.optional<typeof Usage>;
            readonly providerMetadata: Schema.optional<
              Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
            >;
          }>;
          'provider-error': Schema.Struct<{
            readonly type: Schema.tag<'provider-error'>;
            readonly message: Schema.String;
            readonly classification: Schema.optional<Schema.Literal<'context-overflow'>>;
            readonly retryable: Schema.optional<Schema.Boolean>;
            readonly providerMetadata: Schema.optional<
              Schema.$Record<Schema.String, Schema.$Record<Schema.String, Schema.Unknown>>
            >;
          }>;
        };
        readonly isAnyOf: <const Keys>(keys: readonly Keys[]) => (
          value:
            | {
                readonly type: 'step-start';
                readonly index: number;
              }
            | {
                readonly type: 'text-start';
                readonly id: string;
                readonly providerMetadata?:
                  | {
                      readonly [x: string]: {
                        readonly [x: string]: unknown;
                      };
                    }
                  | undefined;
              }
            | {
                readonly type: 'text-delta';
                readonly id: string;
                readonly text: string;
                readonly providerMetadata?:
                  | {
                      readonly [x: string]: {
                        readonly [x: string]: unknown;
                      };
                    }
                  | undefined;
              }
            | {
                readonly type: 'text-end';
                readonly id: string;
                readonly providerMetadata?:
                  | {
                      readonly [x: string]: {
                        readonly [x: string]: unknown;
                      };
                    }
                  | undefined;
              }
            | {
                readonly type: 'reasoning-start';
                readonly id: string;
                readonly providerMetadata?:
                  | {
                      readonly [x: string]: {
                        readonly [x: string]: unknown;
                      };
                    }
                  | undefined;
              }
            | {
                readonly type: 'reasoning-delta';
                readonly id: string;
                readonly text: string;
                readonly providerMetadata?:
                  | {
                      readonly [x: string]: {
                        readonly [x: string]: unknown;
                      };
                    }
                  | undefined;
              }
            | {
                readonly type: 'reasoning-end';
                readonly id: string;
                readonly providerMetadata?:
                  | {
                      readonly [x: string]: {
                        readonly [x: string]: unknown;
                      };
                    }
                  | undefined;
              }
            | {
                readonly type: 'tool-input-start';
                readonly id: string;
                readonly name: string;
                readonly providerMetadata?:
                  | {
                      readonly [x: string]: {
                        readonly [x: string]: unknown;
                      };
                    }
                  | undefined;
              }
            | {
                readonly type: 'tool-input-delta';
                readonly id: string;
                readonly name: string;
                readonly text: string;
              }
            | {
                readonly type: 'tool-input-end';
                readonly id: string;
                readonly name: string;
                readonly providerMetadata?:
                  | {
                      readonly [x: string]: {
                        readonly [x: string]: unknown;
                      };
                    }
                  | undefined;
              }
            | {
                readonly type: 'tool-call';
                readonly id: string;
                readonly name: string;
                readonly input: unknown;
                readonly providerExecuted?: boolean | undefined;
                readonly providerMetadata?:
                  | {
                      readonly [x: string]: {
                        readonly [x: string]: unknown;
                      };
                    }
                  | undefined;
              }
            | {
                readonly type: 'tool-result';
                readonly id: string;
                readonly name: string;
                readonly result:
                  | {
                      readonly type: 'json';
                      readonly value: unknown;
                    }
                  | {
                      readonly type: 'text';
                      readonly value: unknown;
                    }
                  | {
                      readonly type: 'error';
                      readonly value: unknown;
                    }
                  | {
                      readonly type: 'content';
                      readonly value: readonly (
                        | {
                            readonly type: 'text';
                            readonly text: string;
                          }
                        | {
                            readonly type: 'file';
                            readonly uri: string;
                            readonly mime: string;
                            readonly name?: any;
                          }
                      )[];
                    };
                readonly output?:
                  | {
                      readonly structured: unknown;
                      readonly content: readonly (
                        | {
                            readonly type: 'text';
                            readonly text: string;
                          }
                        | {
                            readonly type: 'file';
                            readonly uri: string;
                            readonly mime: string;
                            readonly name?: any;
                          }
                      )[];
                    }
                  | undefined;
                readonly providerExecuted?: boolean | undefined;
                readonly providerMetadata?:
                  | {
                      readonly [x: string]: {
                        readonly [x: string]: unknown;
                      };
                    }
                  | undefined;
              }
            | {
                readonly type: 'tool-error';
                readonly id: string;
                readonly name: string;
                readonly message: string;
                readonly error?: unknown;
                readonly providerMetadata?:
                  | {
                      readonly [x: string]: {
                        readonly [x: string]: unknown;
                      };
                    }
                  | undefined;
              }
            | {
                readonly type: 'step-finish';
                readonly index: number;
                readonly reason:
                  'length' | 'error' | 'unknown' | 'stop' | 'tool-calls' | 'content-filter';
                readonly usage?: Usage | undefined;
                readonly providerMetadata?:
                  | {
                      readonly [x: string]: {
                        readonly [x: string]: unknown;
                      };
                    }
                  | undefined;
              }
            | {
                readonly type: 'finish';
                readonly reason:
                  'length' | 'error' | 'unknown' | 'stop' | 'tool-calls' | 'content-filter';
                readonly usage?: Usage | undefined;
                readonly providerMetadata?:
                  | {
                      readonly [x: string]: {
                        readonly [x: string]: unknown;
                      };
                    }
                  | undefined;
              }
            | {
                readonly type: 'provider-error';
                readonly message: string;
                readonly classification?: 'context-overflow' | undefined;
                readonly retryable?: boolean | undefined;
                readonly providerMetadata?:
                  | {
                      readonly [x: string]: {
                        readonly [x: string]: unknown;
                      };
                    }
                  | undefined;
              },
        ) => value is
          | Extract<
              {
                readonly type: 'step-start';
                readonly index: number;
              },
              {
                readonly type: Keys;
              }
            >
          | Extract<
              {
                readonly type: 'text-start';
                readonly id: string;
                readonly providerMetadata?:
                  | {
                      readonly [x: string]: {
                        readonly [x: string]: unknown;
                      };
                    }
                  | undefined;
              },
              {
                readonly type: Keys;
              }
            >
          | Extract<
              {
                readonly type: 'text-delta';
                readonly id: string;
                readonly text: string;
                readonly providerMetadata?:
                  | {
                      readonly [x: string]: {
                        readonly [x: string]: unknown;
                      };
                    }
                  | undefined;
              },
              {
                readonly type: Keys;
              }
            >
          | Extract<
              {
                readonly type: 'text-end';
                readonly id: string;
                readonly providerMetadata?:
                  | {
                      readonly [x: string]: {
                        readonly [x: string]: unknown;
                      };
                    }
                  | undefined;
              },
              {
                readonly type: Keys;
              }
            >
          | Extract<
              {
                readonly type: 'reasoning-start';
                readonly id: string;
                readonly providerMetadata?:
                  | {
                      readonly [x: string]: {
                        readonly [x: string]: unknown;
                      };
                    }
                  | undefined;
              },
              {
                readonly type: Keys;
              }
            >
          | Extract<
              {
                readonly type: 'reasoning-delta';
                readonly id: string;
                readonly text: string;
                readonly providerMetadata?:
                  | {
                      readonly [x: string]: {
                        readonly [x: string]: unknown;
                      };
                    }
                  | undefined;
              },
              {
                readonly type: Keys;
              }
            >
          | Extract<
              {
                readonly type: 'reasoning-end';
                readonly id: string;
                readonly providerMetadata?:
                  | {
                      readonly [x: string]: {
                        readonly [x: string]: unknown;
                      };
                    }
                  | undefined;
              },
              {
                readonly type: Keys;
              }
            >
          | Extract<
              {
                readonly type: 'tool-input-start';
                readonly id: string;
                readonly name: string;
                readonly providerMetadata?:
                  | {
                      readonly [x: string]: {
                        readonly [x: string]: unknown;
                      };
                    }
                  | undefined;
              },
              {
                readonly type: Keys;
              }
            >
          | Extract<
              {
                readonly type: 'tool-input-delta';
                readonly id: string;
                readonly name: string;
                readonly text: string;
              },
              {
                readonly type: Keys;
              }
            >
          | Extract<
              {
                readonly type: 'tool-input-end';
                readonly id: string;
                readonly name: string;
                readonly providerMetadata?:
                  | {
                      readonly [x: string]: {
                        readonly [x: string]: unknown;
                      };
                    }
                  | undefined;
              },
              {
                readonly type: Keys;
              }
            >
          | Extract<
              {
                readonly type: 'tool-call';
                readonly id: string;
                readonly name: string;
                readonly input: unknown;
                readonly providerExecuted?: boolean | undefined;
                readonly providerMetadata?:
                  | {
                      readonly [x: string]: {
                        readonly [x: string]: unknown;
                      };
                    }
                  | undefined;
              },
              {
                readonly type: Keys;
              }
            >
          | Extract<
              {
                readonly type: 'tool-result';
                readonly id: string;
                readonly name: string;
                readonly result:
                  | {
                      readonly type: 'json';
                      readonly value: unknown;
                    }
                  | {
                      readonly type: 'text';
                      readonly value: unknown;
                    }
                  | {
                      readonly type: 'error';
                      readonly value: unknown;
                    }
                  | {
                      readonly type: 'content';
                      readonly value: readonly (
                        | {
                            readonly type: 'text';
                            readonly text: string;
                          }
                        | {
                            readonly type: 'file';
                            readonly uri: string;
                            readonly mime: string;
                            readonly name?: any;
                          }
                      )[];
                    };
                readonly output?:
                  | {
                      readonly structured: unknown;
                      readonly content: readonly (
                        | {
                            readonly type: 'text';
                            readonly text: string;
                          }
                        | {
                            readonly type: 'file';
                            readonly uri: string;
                            readonly mime: string;
                            readonly name?: any;
                          }
                      )[];
                    }
                  | undefined;
                readonly providerExecuted?: boolean | undefined;
                readonly providerMetadata?:
                  | {
                      readonly [x: string]: {
                        readonly [x: string]: unknown;
                      };
                    }
                  | undefined;
              },
              {
                readonly type: Keys;
              }
            >
          | Extract<
              {
                readonly type: 'tool-error';
                readonly id: string;
                readonly name: string;
                readonly message: string;
                readonly error?: unknown;
                readonly providerMetadata?:
                  | {
                      readonly [x: string]: {
                        readonly [x: string]: unknown;
                      };
                    }
                  | undefined;
              },
              {
                readonly type: Keys;
              }
            >
          | Extract<
              {
                readonly type: 'step-finish';
                readonly index: number;
                readonly reason:
                  'length' | 'error' | 'unknown' | 'stop' | 'tool-calls' | 'content-filter';
                readonly usage?: Usage | undefined;
                readonly providerMetadata?:
                  | {
                      readonly [x: string]: {
                        readonly [x: string]: unknown;
                      };
                    }
                  | undefined;
              },
              {
                readonly type: Keys;
              }
            >
          | Extract<
              {
                readonly type: 'finish';
                readonly reason:
                  'length' | 'error' | 'unknown' | 'stop' | 'tool-calls' | 'content-filter';
                readonly usage?: Usage | undefined;
                readonly providerMetadata?:
                  | {
                      readonly [x: string]: {
                        readonly [x: string]: unknown;
                      };
                    }
                  | undefined;
              },
              {
                readonly type: Keys;
              }
            >
          | Extract<
              {
                readonly type: 'provider-error';
                readonly message: string;
                readonly classification?: 'context-overflow' | undefined;
                readonly retryable?: boolean | undefined;
                readonly providerMetadata?:
                  | {
                      readonly [x: string]: {
                        readonly [x: string]: unknown;
                      };
                    }
                  | undefined;
              },
              {
                readonly type: Keys;
              }
            >;
        readonly guards: {
          'step-start': (u: unknown) => u is {
            readonly type: 'step-start';
            readonly index: number;
          };
          'text-start': (u: unknown) => u is {
            readonly type: 'text-start';
            readonly id: string;
            readonly providerMetadata?:
              | {
                  readonly [x: string]: {
                    readonly [x: string]: unknown;
                  };
                }
              | undefined;
          };
          'text-delta': (u: unknown) => u is {
            readonly type: 'text-delta';
            readonly id: string;
            readonly text: string;
            readonly providerMetadata?:
              | {
                  readonly [x: string]: {
                    readonly [x: string]: unknown;
                  };
                }
              | undefined;
          };
          'text-end': (u: unknown) => u is {
            readonly type: 'text-end';
            readonly id: string;
            readonly providerMetadata?:
              | {
                  readonly [x: string]: {
                    readonly [x: string]: unknown;
                  };
                }
              | undefined;
          };
          'reasoning-start': (u: unknown) => u is {
            readonly type: 'reasoning-start';
            readonly id: string;
            readonly providerMetadata?:
              | {
                  readonly [x: string]: {
                    readonly [x: string]: unknown;
                  };
                }
              | undefined;
          };
          'reasoning-delta': (u: unknown) => u is {
            readonly type: 'reasoning-delta';
            readonly id: string;
            readonly text: string;
            readonly providerMetadata?:
              | {
                  readonly [x: string]: {
                    readonly [x: string]: unknown;
                  };
                }
              | undefined;
          };
          'reasoning-end': (u: unknown) => u is {
            readonly type: 'reasoning-end';
            readonly id: string;
            readonly providerMetadata?:
              | {
                  readonly [x: string]: {
                    readonly [x: string]: unknown;
                  };
                }
              | undefined;
          };
          'tool-input-start': (u: unknown) => u is {
            readonly type: 'tool-input-start';
            readonly id: string;
            readonly name: string;
            readonly providerMetadata?:
              | {
                  readonly [x: string]: {
                    readonly [x: string]: unknown;
                  };
                }
              | undefined;
          };
          'tool-input-delta': (u: unknown) => u is {
            readonly type: 'tool-input-delta';
            readonly id: string;
            readonly name: string;
            readonly text: string;
          };
          'tool-input-end': (u: unknown) => u is {
            readonly type: 'tool-input-end';
            readonly id: string;
            readonly name: string;
            readonly providerMetadata?:
              | {
                  readonly [x: string]: {
                    readonly [x: string]: unknown;
                  };
                }
              | undefined;
          };
          'tool-call': (u: unknown) => u is {
            readonly type: 'tool-call';
            readonly id: string;
            readonly name: string;
            readonly input: unknown;
            readonly providerExecuted?: boolean | undefined;
            readonly providerMetadata?:
              | {
                  readonly [x: string]: {
                    readonly [x: string]: unknown;
                  };
                }
              | undefined;
          };
          'tool-result': (u: unknown) => u is {
            readonly type: 'tool-result';
            readonly id: string;
            readonly name: string;
            readonly result:
              | {
                  readonly type: 'json';
                  readonly value: unknown;
                }
              | {
                  readonly type: 'text';
                  readonly value: unknown;
                }
              | {
                  readonly type: 'error';
                  readonly value: unknown;
                }
              | {
                  readonly type: 'content';
                  readonly value: readonly (
                    | {
                        readonly type: 'text';
                        readonly text: string;
                      }
                    | {
                        readonly type: 'file';
                        readonly uri: string;
                        readonly mime: string;
                        readonly name?: any;
                      }
                  )[];
                };
            readonly output?:
              | {
                  readonly structured: unknown;
                  readonly content: readonly (
                    | {
                        readonly type: 'text';
                        readonly text: string;
                      }
                    | {
                        readonly type: 'file';
                        readonly uri: string;
                        readonly mime: string;
                        readonly name?: any;
                      }
                  )[];
                }
              | undefined;
            readonly providerExecuted?: boolean | undefined;
            readonly providerMetadata?:
              | {
                  readonly [x: string]: {
                    readonly [x: string]: unknown;
                  };
                }
              | undefined;
          };
          'tool-error': (u: unknown) => u is {
            readonly type: 'tool-error';
            readonly id: string;
            readonly name: string;
            readonly message: string;
            readonly error?: unknown;
            readonly providerMetadata?:
              | {
                  readonly [x: string]: {
                    readonly [x: string]: unknown;
                  };
                }
              | undefined;
          };
          'step-finish': (u: unknown) => u is {
            readonly type: 'step-finish';
            readonly index: number;
            readonly reason:
              'length' | 'error' | 'unknown' | 'stop' | 'tool-calls' | 'content-filter';
            readonly usage?: Usage | undefined;
            readonly providerMetadata?:
              | {
                  readonly [x: string]: {
                    readonly [x: string]: unknown;
                  };
                }
              | undefined;
          };
          finish: (u: unknown) => u is {
            readonly type: 'finish';
            readonly reason:
              'length' | 'error' | 'unknown' | 'stop' | 'tool-calls' | 'content-filter';
            readonly usage?: Usage | undefined;
            readonly providerMetadata?:
              | {
                  readonly [x: string]: {
                    readonly [x: string]: unknown;
                  };
                }
              | undefined;
          };
          'provider-error': (u: unknown) => u is {
            readonly type: 'provider-error';
            readonly message: string;
            readonly classification?: 'context-overflow' | undefined;
            readonly retryable?: boolean | undefined;
            readonly providerMetadata?:
              | {
                  readonly [x: string]: {
                    readonly [x: string]: unknown;
                  };
                }
              | undefined;
          };
        };
        readonly match: {
          <
            Cases extends {
              'step-start': (value: { readonly type: 'step-start'; readonly index: number }) => any;
              'text-start': (value: {
                readonly type: 'text-start';
                readonly id: string;
                readonly providerMetadata?:
                  | {
                      readonly [x: string]: {
                        readonly [x: string]: unknown;
                      };
                    }
                  | undefined;
              }) => any;
              'text-delta': (value: {
                readonly type: 'text-delta';
                readonly id: string;
                readonly text: string;
                readonly providerMetadata?:
                  | {
                      readonly [x: string]: {
                        readonly [x: string]: unknown;
                      };
                    }
                  | undefined;
              }) => any;
              'text-end': (value: {
                readonly type: 'text-end';
                readonly id: string;
                readonly providerMetadata?:
                  | {
                      readonly [x: string]: {
                        readonly [x: string]: unknown;
                      };
                    }
                  | undefined;
              }) => any;
              'reasoning-start': (value: {
                readonly type: 'reasoning-start';
                readonly id: string;
                readonly providerMetadata?:
                  | {
                      readonly [x: string]: {
                        readonly [x: string]: unknown;
                      };
                    }
                  | undefined;
              }) => any;
              'reasoning-delta': (value: {
                readonly type: 'reasoning-delta';
                readonly id: string;
                readonly text: string;
                readonly providerMetadata?:
                  | {
                      readonly [x: string]: {
                        readonly [x: string]: unknown;
                      };
                    }
                  | undefined;
              }) => any;
              'reasoning-end': (value: {
                readonly type: 'reasoning-end';
                readonly id: string;
                readonly providerMetadata?:
                  | {
                      readonly [x: string]: {
                        readonly [x: string]: unknown;
                      };
                    }
                  | undefined;
              }) => any;
              'tool-input-start': (value: {
                readonly type: 'tool-input-start';
                readonly id: string;
                readonly name: string;
                readonly providerMetadata?:
                  | {
                      readonly [x: string]: {
                        readonly [x: string]: unknown;
                      };
                    }
                  | undefined;
              }) => any;
              'tool-input-delta': (value: {
                readonly type: 'tool-input-delta';
                readonly id: string;
                readonly name: string;
                readonly text: string;
              }) => any;
              'tool-input-end': (value: {
                readonly type: 'tool-input-end';
                readonly id: string;
                readonly name: string;
                readonly providerMetadata?:
                  | {
                      readonly [x: string]: {
                        readonly [x: string]: unknown;
                      };
                    }
                  | undefined;
              }) => any;
              'tool-call': (value: {
                readonly type: 'tool-call';
                readonly id: string;
                readonly name: string;
                readonly input: unknown;
                readonly providerExecuted?: boolean | undefined;
                readonly providerMetadata?:
                  | {
                      readonly [x: string]: {
                        readonly [x: string]: unknown;
                      };
                    }
                  | undefined;
              }) => any;
              'tool-result': (value: {
                readonly type: 'tool-result';
                readonly id: string;
                readonly name: string;
                readonly result:
                  | {
                      readonly type: 'json';
                      readonly value: unknown;
                    }
                  | {
                      readonly type: 'text';
                      readonly value: unknown;
                    }
                  | {
                      readonly type: 'error';
                      readonly value: unknown;
                    }
                  | {
                      readonly type: 'content';
                      readonly value: readonly (
                        | {
                            readonly type: 'text';
                            readonly text: string;
                          }
                        | {
                            readonly type: 'file';
                            readonly uri: string;
                            readonly mime: string;
                            readonly name?: any;
                          }
                      )[];
                    };
                readonly output?:
                  | {
                      readonly structured: unknown;
                      readonly content: readonly (
                        | {
                            readonly type: 'text';
                            readonly text: string;
                          }
                        | {
                            readonly type: 'file';
                            readonly uri: string;
                            readonly mime: string;
                            readonly name?: any;
                          }
                      )[];
                    }
                  | undefined;
                readonly providerExecuted?: boolean | undefined;
                readonly providerMetadata?:
                  | {
                      readonly [x: string]: {
                        readonly [x: string]: unknown;
                      };
                    }
                  | undefined;
              }) => any;
              'tool-error': (value: {
                readonly type: 'tool-error';
                readonly id: string;
                readonly name: string;
                readonly message: string;
                readonly error?: unknown;
                readonly providerMetadata?:
                  | {
                      readonly [x: string]: {
                        readonly [x: string]: unknown;
                      };
                    }
                  | undefined;
              }) => any;
              'step-finish': (value: {
                readonly type: 'step-finish';
                readonly index: number;
                readonly reason:
                  'length' | 'error' | 'unknown' | 'stop' | 'tool-calls' | 'content-filter';
                readonly usage?: Usage | undefined;
                readonly providerMetadata?:
                  | {
                      readonly [x: string]: {
                        readonly [x: string]: unknown;
                      };
                    }
                  | undefined;
              }) => any;
              finish: (value: {
                readonly type: 'finish';
                readonly reason:
                  'length' | 'error' | 'unknown' | 'stop' | 'tool-calls' | 'content-filter';
                readonly usage?: Usage | undefined;
                readonly providerMetadata?:
                  | {
                      readonly [x: string]: {
                        readonly [x: string]: unknown;
                      };
                    }
                  | undefined;
              }) => any;
              'provider-error': (value: {
                readonly type: 'provider-error';
                readonly message: string;
                readonly classification?: 'context-overflow' | undefined;
                readonly retryable?: boolean | undefined;
                readonly providerMetadata?:
                  | {
                      readonly [x: string]: {
                        readonly [x: string]: unknown;
                      };
                    }
                  | undefined;
              }) => any;
            },
          >(
            value:
              | {
                  readonly type: 'step-start';
                  readonly index: number;
                }
              | {
                  readonly type: 'text-start';
                  readonly id: string;
                  readonly providerMetadata?:
                    | {
                        readonly [x: string]: {
                          readonly [x: string]: unknown;
                        };
                      }
                    | undefined;
                }
              | {
                  readonly type: 'text-delta';
                  readonly id: string;
                  readonly text: string;
                  readonly providerMetadata?:
                    | {
                        readonly [x: string]: {
                          readonly [x: string]: unknown;
                        };
                      }
                    | undefined;
                }
              | {
                  readonly type: 'text-end';
                  readonly id: string;
                  readonly providerMetadata?:
                    | {
                        readonly [x: string]: {
                          readonly [x: string]: unknown;
                        };
                      }
                    | undefined;
                }
              | {
                  readonly type: 'reasoning-start';
                  readonly id: string;
                  readonly providerMetadata?:
                    | {
                        readonly [x: string]: {
                          readonly [x: string]: unknown;
                        };
                      }
                    | undefined;
                }
              | {
                  readonly type: 'reasoning-delta';
                  readonly id: string;
                  readonly text: string;
                  readonly providerMetadata?:
                    | {
                        readonly [x: string]: {
                          readonly [x: string]: unknown;
                        };
                      }
                    | undefined;
                }
              | {
                  readonly type: 'reasoning-end';
                  readonly id: string;
                  readonly providerMetadata?:
                    | {
                        readonly [x: string]: {
                          readonly [x: string]: unknown;
                        };
                      }
                    | undefined;
                }
              | {
                  readonly type: 'tool-input-start';
                  readonly id: string;
                  readonly name: string;
                  readonly providerMetadata?:
                    | {
                        readonly [x: string]: {
                          readonly [x: string]: unknown;
                        };
                      }
                    | undefined;
                }
              | {
                  readonly type: 'tool-input-delta';
                  readonly id: string;
                  readonly name: string;
                  readonly text: string;
                }
              | {
                  readonly type: 'tool-input-end';
                  readonly id: string;
                  readonly name: string;
                  readonly providerMetadata?:
                    | {
                        readonly [x: string]: {
                          readonly [x: string]: unknown;
                        };
                      }
                    | undefined;
                }
              | {
                  readonly type: 'tool-call';
                  readonly id: string;
                  readonly name: string;
                  readonly input: unknown;
                  readonly providerExecuted?: boolean | undefined;
                  readonly providerMetadata?:
                    | {
                        readonly [x: string]: {
                          readonly [x: string]: unknown;
                        };
                      }
                    | undefined;
                }
              | {
                  readonly type: 'tool-result';
                  readonly id: string;
                  readonly name: string;
                  readonly result:
                    | {
                        readonly type: 'json';
                        readonly value: unknown;
                      }
                    | {
                        readonly type: 'text';
                        readonly value: unknown;
                      }
                    | {
                        readonly type: 'error';
                        readonly value: unknown;
                      }
                    | {
                        readonly type: 'content';
                        readonly value: readonly (
                          | {
                              readonly type: 'text';
                              readonly text: string;
                            }
                          | {
                              readonly type: 'file';
                              readonly uri: string;
                              readonly mime: string;
                              readonly name?: any;
                            }
                        )[];
                      };
                  readonly output?:
                    | {
                        readonly structured: unknown;
                        readonly content: readonly (
                          | {
                              readonly type: 'text';
                              readonly text: string;
                            }
                          | {
                              readonly type: 'file';
                              readonly uri: string;
                              readonly mime: string;
                              readonly name?: any;
                            }
                        )[];
                      }
                    | undefined;
                  readonly providerExecuted?: boolean | undefined;
                  readonly providerMetadata?:
                    | {
                        readonly [x: string]: {
                          readonly [x: string]: unknown;
                        };
                      }
                    | undefined;
                }
              | {
                  readonly type: 'tool-error';
                  readonly id: string;
                  readonly name: string;
                  readonly message: string;
                  readonly error?: unknown;
                  readonly providerMetadata?:
                    | {
                        readonly [x: string]: {
                          readonly [x: string]: unknown;
                        };
                      }
                    | undefined;
                }
              | {
                  readonly type: 'step-finish';
                  readonly index: number;
                  readonly reason:
                    'length' | 'error' | 'unknown' | 'stop' | 'tool-calls' | 'content-filter';
                  readonly usage?: Usage | undefined;
                  readonly providerMetadata?:
                    | {
                        readonly [x: string]: {
                          readonly [x: string]: unknown;
                        };
                      }
                    | undefined;
                }
              | {
                  readonly type: 'finish';
                  readonly reason:
                    'length' | 'error' | 'unknown' | 'stop' | 'tool-calls' | 'content-filter';
                  readonly usage?: Usage | undefined;
                  readonly providerMetadata?:
                    | {
                        readonly [x: string]: {
                          readonly [x: string]: unknown;
                        };
                      }
                    | undefined;
                }
              | {
                  readonly type: 'provider-error';
                  readonly message: string;
                  readonly classification?: 'context-overflow' | undefined;
                  readonly retryable?: boolean | undefined;
                  readonly providerMetadata?:
                    | {
                        readonly [x: string]: {
                          readonly [x: string]: unknown;
                        };
                      }
                    | undefined;
                },
            cases: Cases,
          ): Cases[keyof Cases] extends (value: any) => infer R
            ? import('effect/Unify').Unify<R>
            : never;
          <
            Cases extends {
              'step-start': (value: { readonly type: 'step-start'; readonly index: number }) => any;
              'text-start': (value: {
                readonly type: 'text-start';
                readonly id: string;
                readonly providerMetadata?:
                  | {
                      readonly [x: string]: {
                        readonly [x: string]: unknown;
                      };
                    }
                  | undefined;
              }) => any;
              'text-delta': (value: {
                readonly type: 'text-delta';
                readonly id: string;
                readonly text: string;
                readonly providerMetadata?:
                  | {
                      readonly [x: string]: {
                        readonly [x: string]: unknown;
                      };
                    }
                  | undefined;
              }) => any;
              'text-end': (value: {
                readonly type: 'text-end';
                readonly id: string;
                readonly providerMetadata?:
                  | {
                      readonly [x: string]: {
                        readonly [x: string]: unknown;
                      };
                    }
                  | undefined;
              }) => any;
              'reasoning-start': (value: {
                readonly type: 'reasoning-start';
                readonly id: string;
                readonly providerMetadata?:
                  | {
                      readonly [x: string]: {
                        readonly [x: string]: unknown;
                      };
                    }
                  | undefined;
              }) => any;
              'reasoning-delta': (value: {
                readonly type: 'reasoning-delta';
                readonly id: string;
                readonly text: string;
                readonly providerMetadata?:
                  | {
                      readonly [x: string]: {
                        readonly [x: string]: unknown;
                      };
                    }
                  | undefined;
              }) => any;
              'reasoning-end': (value: {
                readonly type: 'reasoning-end';
                readonly id: string;
                readonly providerMetadata?:
                  | {
                      readonly [x: string]: {
                        readonly [x: string]: unknown;
                      };
                    }
                  | undefined;
              }) => any;
              'tool-input-start': (value: {
                readonly type: 'tool-input-start';
                readonly id: string;
                readonly name: string;
                readonly providerMetadata?:
                  | {
                      readonly [x: string]: {
                        readonly [x: string]: unknown;
                      };
                    }
                  | undefined;
              }) => any;
              'tool-input-delta': (value: {
                readonly type: 'tool-input-delta';
                readonly id: string;
                readonly name: string;
                readonly text: string;
              }) => any;
              'tool-input-end': (value: {
                readonly type: 'tool-input-end';
                readonly id: string;
                readonly name: string;
                readonly providerMetadata?:
                  | {
                      readonly [x: string]: {
                        readonly [x: string]: unknown;
                      };
                    }
                  | undefined;
              }) => any;
              'tool-call': (value: {
                readonly type: 'tool-call';
                readonly id: string;
                readonly name: string;
                readonly input: unknown;
                readonly providerExecuted?: boolean | undefined;
                readonly providerMetadata?:
                  | {
                      readonly [x: string]: {
                        readonly [x: string]: unknown;
                      };
                    }
                  | undefined;
              }) => any;
              'tool-result': (value: {
                readonly type: 'tool-result';
                readonly id: string;
                readonly name: string;
                readonly result:
                  | {
                      readonly type: 'json';
                      readonly value: unknown;
                    }
                  | {
                      readonly type: 'text';
                      readonly value: unknown;
                    }
                  | {
                      readonly type: 'error';
                      readonly value: unknown;
                    }
                  | {
                      readonly type: 'content';
                      readonly value: readonly (
                        | {
                            readonly type: 'text';
                            readonly text: string;
                          }
                        | {
                            readonly type: 'file';
                            readonly uri: string;
                            readonly mime: string;
                            readonly name?: any;
                          }
                      )[];
                    };
                readonly output?:
                  | {
                      readonly structured: unknown;
                      readonly content: readonly (
                        | {
                            readonly type: 'text';
                            readonly text: string;
                          }
                        | {
                            readonly type: 'file';
                            readonly uri: string;
                            readonly mime: string;
                            readonly name?: any;
                          }
                      )[];
                    }
                  | undefined;
                readonly providerExecuted?: boolean | undefined;
                readonly providerMetadata?:
                  | {
                      readonly [x: string]: {
                        readonly [x: string]: unknown;
                      };
                    }
                  | undefined;
              }) => any;
              'tool-error': (value: {
                readonly type: 'tool-error';
                readonly id: string;
                readonly name: string;
                readonly message: string;
                readonly error?: unknown;
                readonly providerMetadata?:
                  | {
                      readonly [x: string]: {
                        readonly [x: string]: unknown;
                      };
                    }
                  | undefined;
              }) => any;
              'step-finish': (value: {
                readonly type: 'step-finish';
                readonly index: number;
                readonly reason:
                  'length' | 'error' | 'unknown' | 'stop' | 'tool-calls' | 'content-filter';
                readonly usage?: Usage | undefined;
                readonly providerMetadata?:
                  | {
                      readonly [x: string]: {
                        readonly [x: string]: unknown;
                      };
                    }
                  | undefined;
              }) => any;
              finish: (value: {
                readonly type: 'finish';
                readonly reason:
                  'length' | 'error' | 'unknown' | 'stop' | 'tool-calls' | 'content-filter';
                readonly usage?: Usage | undefined;
                readonly providerMetadata?:
                  | {
                      readonly [x: string]: {
                        readonly [x: string]: unknown;
                      };
                    }
                  | undefined;
              }) => any;
              'provider-error': (value: {
                readonly type: 'provider-error';
                readonly message: string;
                readonly classification?: 'context-overflow' | undefined;
                readonly retryable?: boolean | undefined;
                readonly providerMetadata?:
                  | {
                      readonly [x: string]: {
                        readonly [x: string]: unknown;
                      };
                    }
                  | undefined;
              }) => any;
            },
          >(
            cases: Cases,
          ): (
            value:
              | {
                  readonly type: 'step-start';
                  readonly index: number;
                }
              | {
                  readonly type: 'text-start';
                  readonly id: string;
                  readonly providerMetadata?:
                    | {
                        readonly [x: string]: {
                          readonly [x: string]: unknown;
                        };
                      }
                    | undefined;
                }
              | {
                  readonly type: 'text-delta';
                  readonly id: string;
                  readonly text: string;
                  readonly providerMetadata?:
                    | {
                        readonly [x: string]: {
                          readonly [x: string]: unknown;
                        };
                      }
                    | undefined;
                }
              | {
                  readonly type: 'text-end';
                  readonly id: string;
                  readonly providerMetadata?:
                    | {
                        readonly [x: string]: {
                          readonly [x: string]: unknown;
                        };
                      }
                    | undefined;
                }
              | {
                  readonly type: 'reasoning-start';
                  readonly id: string;
                  readonly providerMetadata?:
                    | {
                        readonly [x: string]: {
                          readonly [x: string]: unknown;
                        };
                      }
                    | undefined;
                }
              | {
                  readonly type: 'reasoning-delta';
                  readonly id: string;
                  readonly text: string;
                  readonly providerMetadata?:
                    | {
                        readonly [x: string]: {
                          readonly [x: string]: unknown;
                        };
                      }
                    | undefined;
                }
              | {
                  readonly type: 'reasoning-end';
                  readonly id: string;
                  readonly providerMetadata?:
                    | {
                        readonly [x: string]: {
                          readonly [x: string]: unknown;
                        };
                      }
                    | undefined;
                }
              | {
                  readonly type: 'tool-input-start';
                  readonly id: string;
                  readonly name: string;
                  readonly providerMetadata?:
                    | {
                        readonly [x: string]: {
                          readonly [x: string]: unknown;
                        };
                      }
                    | undefined;
                }
              | {
                  readonly type: 'tool-input-delta';
                  readonly id: string;
                  readonly name: string;
                  readonly text: string;
                }
              | {
                  readonly type: 'tool-input-end';
                  readonly id: string;
                  readonly name: string;
                  readonly providerMetadata?:
                    | {
                        readonly [x: string]: {
                          readonly [x: string]: unknown;
                        };
                      }
                    | undefined;
                }
              | {
                  readonly type: 'tool-call';
                  readonly id: string;
                  readonly name: string;
                  readonly input: unknown;
                  readonly providerExecuted?: boolean | undefined;
                  readonly providerMetadata?:
                    | {
                        readonly [x: string]: {
                          readonly [x: string]: unknown;
                        };
                      }
                    | undefined;
                }
              | {
                  readonly type: 'tool-result';
                  readonly id: string;
                  readonly name: string;
                  readonly result:
                    | {
                        readonly type: 'json';
                        readonly value: unknown;
                      }
                    | {
                        readonly type: 'text';
                        readonly value: unknown;
                      }
                    | {
                        readonly type: 'error';
                        readonly value: unknown;
                      }
                    | {
                        readonly type: 'content';
                        readonly value: readonly (
                          | {
                              readonly type: 'text';
                              readonly text: string;
                            }
                          | {
                              readonly type: 'file';
                              readonly uri: string;
                              readonly mime: string;
                              readonly name?: any;
                            }
                        )[];
                      };
                  readonly output?:
                    | {
                        readonly structured: unknown;
                        readonly content: readonly (
                          | {
                              readonly type: 'text';
                              readonly text: string;
                            }
                          | {
                              readonly type: 'file';
                              readonly uri: string;
                              readonly mime: string;
                              readonly name?: any;
                            }
                        )[];
                      }
                    | undefined;
                  readonly providerExecuted?: boolean | undefined;
                  readonly providerMetadata?:
                    | {
                        readonly [x: string]: {
                          readonly [x: string]: unknown;
                        };
                      }
                    | undefined;
                }
              | {
                  readonly type: 'tool-error';
                  readonly id: string;
                  readonly name: string;
                  readonly message: string;
                  readonly error?: unknown;
                  readonly providerMetadata?:
                    | {
                        readonly [x: string]: {
                          readonly [x: string]: unknown;
                        };
                      }
                    | undefined;
                }
              | {
                  readonly type: 'step-finish';
                  readonly index: number;
                  readonly reason:
                    'length' | 'error' | 'unknown' | 'stop' | 'tool-calls' | 'content-filter';
                  readonly usage?: Usage | undefined;
                  readonly providerMetadata?:
                    | {
                        readonly [x: string]: {
                          readonly [x: string]: unknown;
                        };
                      }
                    | undefined;
                }
              | {
                  readonly type: 'finish';
                  readonly reason:
                    'length' | 'error' | 'unknown' | 'stop' | 'tool-calls' | 'content-filter';
                  readonly usage?: Usage | undefined;
                  readonly providerMetadata?:
                    | {
                        readonly [x: string]: {
                          readonly [x: string]: unknown;
                        };
                      }
                    | undefined;
                }
              | {
                  readonly type: 'provider-error';
                  readonly message: string;
                  readonly classification?: 'context-overflow' | undefined;
                  readonly retryable?: boolean | undefined;
                  readonly providerMetadata?:
                    | {
                        readonly [x: string]: {
                          readonly [x: string]: unknown;
                        };
                      }
                    | undefined;
                },
          ) => Cases[keyof Cases] extends (value: any) => infer R
            ? import('effect/Unify').Unify<R>
            : never;
        };
      } & {
        stepStart: (
          input: {
            readonly index: number;
            readonly type?: 'step-start' | undefined;
          },
          options?: Schema.MakeOptions,
        ) => {
          readonly type: 'step-start';
          readonly index: number;
        };
        textStart: (input: WithID<TextStart, ContentBlockID>) => {
          readonly type: 'text-start';
          readonly id: string;
          readonly providerMetadata?:
            | {
                readonly [x: string]: {
                  readonly [x: string]: unknown;
                };
              }
            | undefined;
        };
        textDelta: (input: WithID<TextDelta, ContentBlockID>) => {
          readonly type: 'text-delta';
          readonly id: string;
          readonly text: string;
          readonly providerMetadata?:
            | {
                readonly [x: string]: {
                  readonly [x: string]: unknown;
                };
              }
            | undefined;
        };
        textEnd: (input: WithID<TextEnd, ContentBlockID>) => {
          readonly type: 'text-end';
          readonly id: string;
          readonly providerMetadata?:
            | {
                readonly [x: string]: {
                  readonly [x: string]: unknown;
                };
              }
            | undefined;
        };
        reasoningStart: (input: WithID<ReasoningStart, ContentBlockID>) => {
          readonly type: 'reasoning-start';
          readonly id: string;
          readonly providerMetadata?:
            | {
                readonly [x: string]: {
                  readonly [x: string]: unknown;
                };
              }
            | undefined;
        };
        reasoningDelta: (input: WithID<ReasoningDelta, ContentBlockID>) => {
          readonly type: 'reasoning-delta';
          readonly id: string;
          readonly text: string;
          readonly providerMetadata?:
            | {
                readonly [x: string]: {
                  readonly [x: string]: unknown;
                };
              }
            | undefined;
        };
        reasoningEnd: (input: WithID<ReasoningEnd, ContentBlockID>) => {
          readonly type: 'reasoning-end';
          readonly id: string;
          readonly providerMetadata?:
            | {
                readonly [x: string]: {
                  readonly [x: string]: unknown;
                };
              }
            | undefined;
        };
        toolInputStart: (input: WithID<ToolInputStart, ToolCallID>) => {
          readonly type: 'tool-input-start';
          readonly id: string;
          readonly name: string;
          readonly providerMetadata?:
            | {
                readonly [x: string]: {
                  readonly [x: string]: unknown;
                };
              }
            | undefined;
        };
        toolInputDelta: (input: WithID<ToolInputDelta, ToolCallID>) => {
          readonly type: 'tool-input-delta';
          readonly id: string;
          readonly name: string;
          readonly text: string;
        };
        toolInputEnd: (input: WithID<ToolInputEnd, ToolCallID>) => {
          readonly type: 'tool-input-end';
          readonly id: string;
          readonly name: string;
          readonly providerMetadata?:
            | {
                readonly [x: string]: {
                  readonly [x: string]: unknown;
                };
              }
            | undefined;
        };
        toolCall: (input: WithID<ToolCall, ToolCallID>) => {
          readonly type: 'tool-call';
          readonly id: string;
          readonly name: string;
          readonly input: unknown;
          readonly providerExecuted?: boolean | undefined;
          readonly providerMetadata?:
            | {
                readonly [x: string]: {
                  readonly [x: string]: unknown;
                };
              }
            | undefined;
        };
        toolResult: (input: WithID<ToolResult, ToolCallID>) => {
          readonly type: 'tool-result';
          readonly id: string;
          readonly name: string;
          readonly result:
            | {
                readonly type: 'json';
                readonly value: unknown;
              }
            | {
                readonly type: 'text';
                readonly value: unknown;
              }
            | {
                readonly type: 'error';
                readonly value: unknown;
              }
            | {
                readonly type: 'content';
                readonly value: readonly (
                  | {
                      readonly type: 'text';
                      readonly text: string;
                    }
                  | {
                      readonly type: 'file';
                      readonly uri: string;
                      readonly mime: string;
                      readonly name?: any;
                    }
                )[];
              };
          readonly output?:
            | {
                readonly structured: unknown;
                readonly content: readonly (
                  | {
                      readonly type: 'text';
                      readonly text: string;
                    }
                  | {
                      readonly type: 'file';
                      readonly uri: string;
                      readonly mime: string;
                      readonly name?: any;
                    }
                )[];
              }
            | undefined;
          readonly providerExecuted?: boolean | undefined;
          readonly providerMetadata?:
            | {
                readonly [x: string]: {
                  readonly [x: string]: unknown;
                };
              }
            | undefined;
        };
        toolError: (input: WithID<ToolError, ToolCallID>) => {
          readonly type: 'tool-error';
          readonly id: string;
          readonly name: string;
          readonly message: string;
          readonly error?: unknown;
          readonly providerMetadata?:
            | {
                readonly [x: string]: {
                  readonly [x: string]: unknown;
                };
              }
            | undefined;
        };
        stepFinish: (input: WithUsage<StepFinish>) => {
          readonly type: 'step-finish';
          readonly index: number;
          readonly reason:
            'length' | 'error' | 'unknown' | 'stop' | 'tool-calls' | 'content-filter';
          readonly usage?: Usage | undefined;
          readonly providerMetadata?:
            | {
                readonly [x: string]: {
                  readonly [x: string]: unknown;
                };
              }
            | undefined;
        };
        finish: (input: WithUsage<Finish>) => {
          readonly type: 'finish';
          readonly reason:
            'length' | 'error' | 'unknown' | 'stop' | 'tool-calls' | 'content-filter';
          readonly usage?: Usage | undefined;
          readonly providerMetadata?:
            | {
                readonly [x: string]: {
                  readonly [x: string]: unknown;
                };
              }
            | undefined;
        };
        providerError: (
          input: {
            readonly message: string;
            readonly type?: 'provider-error' | undefined;
            readonly classification?: 'context-overflow' | undefined;
            readonly retryable?: boolean | undefined;
            readonly providerMetadata?:
              | {
                  readonly [x: string]: {
                    readonly [x: string]: unknown;
                  };
                }
              | undefined;
          },
          options?: Schema.MakeOptions,
        ) => {
          readonly type: 'provider-error';
          readonly message: string;
          readonly classification?: 'context-overflow' | undefined;
          readonly retryable?: boolean | undefined;
          readonly providerMetadata?:
            | {
                readonly [x: string]: {
                  readonly [x: string]: unknown;
                };
              }
            | undefined;
        };
        is: {
          stepStart: (u: unknown) => u is {
            readonly type: 'step-start';
            readonly index: number;
          };
          textStart: (u: unknown) => u is {
            readonly type: 'text-start';
            readonly id: string;
            readonly providerMetadata?:
              | {
                  readonly [x: string]: {
                    readonly [x: string]: unknown;
                  };
                }
              | undefined;
          };
          textDelta: (u: unknown) => u is {
            readonly type: 'text-delta';
            readonly id: string;
            readonly text: string;
            readonly providerMetadata?:
              | {
                  readonly [x: string]: {
                    readonly [x: string]: unknown;
                  };
                }
              | undefined;
          };
          textEnd: (u: unknown) => u is {
            readonly type: 'text-end';
            readonly id: string;
            readonly providerMetadata?:
              | {
                  readonly [x: string]: {
                    readonly [x: string]: unknown;
                  };
                }
              | undefined;
          };
          reasoningStart: (u: unknown) => u is {
            readonly type: 'reasoning-start';
            readonly id: string;
            readonly providerMetadata?:
              | {
                  readonly [x: string]: {
                    readonly [x: string]: unknown;
                  };
                }
              | undefined;
          };
          reasoningDelta: (u: unknown) => u is {
            readonly type: 'reasoning-delta';
            readonly id: string;
            readonly text: string;
            readonly providerMetadata?:
              | {
                  readonly [x: string]: {
                    readonly [x: string]: unknown;
                  };
                }
              | undefined;
          };
          reasoningEnd: (u: unknown) => u is {
            readonly type: 'reasoning-end';
            readonly id: string;
            readonly providerMetadata?:
              | {
                  readonly [x: string]: {
                    readonly [x: string]: unknown;
                  };
                }
              | undefined;
          };
          toolInputStart: (u: unknown) => u is {
            readonly type: 'tool-input-start';
            readonly id: string;
            readonly name: string;
            readonly providerMetadata?:
              | {
                  readonly [x: string]: {
                    readonly [x: string]: unknown;
                  };
                }
              | undefined;
          };
          toolInputDelta: (u: unknown) => u is {
            readonly type: 'tool-input-delta';
            readonly id: string;
            readonly name: string;
            readonly text: string;
          };
          toolInputEnd: (u: unknown) => u is {
            readonly type: 'tool-input-end';
            readonly id: string;
            readonly name: string;
            readonly providerMetadata?:
              | {
                  readonly [x: string]: {
                    readonly [x: string]: unknown;
                  };
                }
              | undefined;
          };
          toolCall: (u: unknown) => u is {
            readonly type: 'tool-call';
            readonly id: string;
            readonly name: string;
            readonly input: unknown;
            readonly providerExecuted?: boolean | undefined;
            readonly providerMetadata?:
              | {
                  readonly [x: string]: {
                    readonly [x: string]: unknown;
                  };
                }
              | undefined;
          };
          toolResult: (u: unknown) => u is {
            readonly type: 'tool-result';
            readonly id: string;
            readonly name: string;
            readonly result:
              | {
                  readonly type: 'json';
                  readonly value: unknown;
                }
              | {
                  readonly type: 'text';
                  readonly value: unknown;
                }
              | {
                  readonly type: 'error';
                  readonly value: unknown;
                }
              | {
                  readonly type: 'content';
                  readonly value: readonly (
                    | {
                        readonly type: 'text';
                        readonly text: string;
                      }
                    | {
                        readonly type: 'file';
                        readonly uri: string;
                        readonly mime: string;
                        readonly name?: any;
                      }
                  )[];
                };
            readonly output?:
              | {
                  readonly structured: unknown;
                  readonly content: readonly (
                    | {
                        readonly type: 'text';
                        readonly text: string;
                      }
                    | {
                        readonly type: 'file';
                        readonly uri: string;
                        readonly mime: string;
                        readonly name?: any;
                      }
                  )[];
                }
              | undefined;
            readonly providerExecuted?: boolean | undefined;
            readonly providerMetadata?:
              | {
                  readonly [x: string]: {
                    readonly [x: string]: unknown;
                  };
                }
              | undefined;
          };
          toolError: (u: unknown) => u is {
            readonly type: 'tool-error';
            readonly id: string;
            readonly name: string;
            readonly message: string;
            readonly error?: unknown;
            readonly providerMetadata?:
              | {
                  readonly [x: string]: {
                    readonly [x: string]: unknown;
                  };
                }
              | undefined;
          };
          stepFinish: (u: unknown) => u is {
            readonly type: 'step-finish';
            readonly index: number;
            readonly reason:
              'length' | 'error' | 'unknown' | 'stop' | 'tool-calls' | 'content-filter';
            readonly usage?: Usage | undefined;
            readonly providerMetadata?:
              | {
                  readonly [x: string]: {
                    readonly [x: string]: unknown;
                  };
                }
              | undefined;
          };
          finish: (u: unknown) => u is {
            readonly type: 'finish';
            readonly reason:
              'length' | 'error' | 'unknown' | 'stop' | 'tool-calls' | 'content-filter';
            readonly usage?: Usage | undefined;
            readonly providerMetadata?:
              | {
                  readonly [x: string]: {
                    readonly [x: string]: unknown;
                  };
                }
              | undefined;
          };
          providerError: (u: unknown) => u is {
            readonly type: 'provider-error';
            readonly message: string;
            readonly classification?: 'context-overflow' | undefined;
            readonly retryable?: boolean | undefined;
            readonly providerMetadata?:
              | {
                  readonly [x: string]: {
                    readonly [x: string]: unknown;
                  };
                }
              | undefined;
          };
        };
      }
    >;
    readonly usage: Schema.optional<typeof Usage>;
    readonly finishReason: Schema.Literals<
      readonly ['stop', 'length', 'tool-calls', 'content-filter', 'error', 'unknown']
    >;
  }>,
  {}
>;
export declare class LLMResponse extends LLMResponse_base {
  /** Concatenated assistant text assembled from streamed `text-delta` events. */
  get text(): string;
  /** Concatenated reasoning text assembled from streamed `reasoning-delta` events. */
  get reasoning(): string;
  /** Completed tool calls emitted by the provider. */
  get toolCalls(): {
    readonly type: 'tool-call';
    readonly id: string;
    readonly name: string;
    readonly input: unknown;
    readonly providerExecuted?: boolean | undefined;
    readonly providerMetadata?:
      | {
          readonly [x: string]: {
            readonly [x: string]: unknown;
          };
        }
      | undefined;
  }[];
}
export declare namespace LLMResponse {
  type State = ResponseState;
  type Output =
    | LLMResponse
    | {
        readonly events: ReadonlyArray<LLMEvent>;
        readonly usage?: Usage;
      };
  /** Initial reducer state for assembling one provider attempt. */
  const empty: () => ResponseState;
  /** Purely fold one provider-neutral event into the attempt assembly state. */
  const reduce: (state: ResponseState, event: LLMEvent) => ResponseState;
  /** Return a completed response only after a terminal finish or provider error. */
  const complete: (state: State) => LLMResponse | undefined;
  /** Convenience reducer for callers that already have a collected event list. */
  const fromEvents: (events: ReadonlyArray<LLMEvent>) => LLMResponse | undefined;
  /** Concatenate assistant text from a response or collected event list. */
  const text: (response: Output) => string;
  /** Return response usage, falling back to the latest usage-bearing event. */
  const usage: (response: Output) => Usage | undefined;
  /** Return completed tool calls from a response or collected event list. */
  const toolCalls: (response: Output) => {
    readonly type: 'tool-call';
    readonly id: string;
    readonly name: string;
    readonly input: unknown;
    readonly providerExecuted?: boolean | undefined;
    readonly providerMetadata?:
      | {
          readonly [x: string]: {
            readonly [x: string]: unknown;
          };
        }
      | undefined;
  }[];
  /** Concatenate reasoning text from a response or collected event list. */
  const reasoning: (response: Output) => string;
}
export {};
//# sourceMappingURL=events.d.ts.map
