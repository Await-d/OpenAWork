import { Effect, JsonSchema, Schema } from 'effect';
import {
  GenerationOptions,
  HttpOptions,
  LLMError,
  LLMRequest,
  LLMResponse,
  Message,
  type ModelInput as SchemaModelInput,
  SystemPart,
  ToolChoice,
  ToolDefinition,
  type ContentPart,
  ToolResultPart,
} from './schema/index.js';
import { type ToolSchema } from './tool.js';
export type ModelInput = SchemaModelInput;
export type MessageInput = Message.Input;
export type ToolChoiceInput = ToolChoice.Input;
export type ToolChoiceMode = ToolChoice.Mode;
export type ToolResultInput = Parameters<typeof ToolResultPart.make>[0];
/** Input accepted by `LLM.request`, normalized into the canonical `LLMRequest` class. */
export type RequestInput = Omit<
  ConstructorParameters<typeof LLMRequest>[0],
  'system' | 'messages' | 'tools' | 'toolChoice' | 'generation' | 'http' | 'providerOptions'
> & {
  readonly system?: string | SystemPart | ReadonlyArray<SystemPart>;
  readonly prompt?: string | ContentPart | ReadonlyArray<ContentPart>;
  readonly messages?: ReadonlyArray<Message | MessageInput>;
  readonly tools?: ReadonlyArray<ToolDefinition.Input>;
  readonly toolChoice?: ToolChoiceInput;
  readonly generation?: GenerationOptions.Input;
  readonly providerOptions?: ConstructorParameters<typeof LLMRequest>[0]['providerOptions'];
  readonly http?: HttpOptions.Input;
};
export declare const generate: typeof import('./route/client.js').generate;
export declare const stream: typeof import('./route/client.js').stream;
export declare const requestInput: (input: LLMRequest) => RequestInput;
export declare const request: (input: RequestInput) => LLMRequest;
export declare const updateRequest: (input: LLMRequest, patch: Partial<RequestInput>) => LLMRequest;
type GenerateObjectBase = Omit<RequestInput, 'tools' | 'toolChoice' | 'responseFormat'>;
export declare class GenerateObjectResponse<T> {
  readonly object: T;
  readonly response: LLMResponse;
  constructor(object: T, response: LLMResponse);
  get events(): readonly (
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
        readonly reason: 'length' | 'error' | 'unknown' | 'stop' | 'tool-calls' | 'content-filter';
        readonly usage?: import('./schema/events.js').Usage | undefined;
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
        readonly reason: 'length' | 'error' | 'unknown' | 'stop' | 'tool-calls' | 'content-filter';
        readonly usage?: import('./schema/events.js').Usage | undefined;
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
      }
  )[];
  get usage(): import('./schema/events.js').Usage | undefined;
}
export interface GenerateObjectOptions<S extends ToolSchema<any>> extends GenerateObjectBase {
  readonly schema: S;
}
export interface GenerateObjectDynamicOptions extends GenerateObjectBase {
  /** Raw JSON Schema object describing the expected output shape. */
  readonly jsonSchema: JsonSchema.JsonSchema;
}
/**
 * Run a model and decode its output against `schema`. Works on every protocol
 * because it forces a synthetic tool call internally — provider-native JSON
 * modes are intentionally avoided so behaviour is uniform.
 *
 * Two input modes:
 *
 * 1. `schema: EffectSchema<T>` — `.object` is decoded and typed as `T`.
 *    Decode failures surface as `LLMError`.
 * 2. `jsonSchema: JsonSchema.JsonSchema` — `.object` is `unknown`. Use when
 *    the schema is only available at runtime (MCP, plugin manifests). Caller validates.
 */
export declare function generateObject<S extends ToolSchema<any>>(
  options: GenerateObjectOptions<S>,
): Effect.Effect<GenerateObjectResponse<Schema.Schema.Type<S>>, LLMError>;
export declare function generateObject(
  options: GenerateObjectDynamicOptions,
): Effect.Effect<GenerateObjectResponse<unknown>, LLMError>;
export {};
//# sourceMappingURL=llm.d.ts.map
