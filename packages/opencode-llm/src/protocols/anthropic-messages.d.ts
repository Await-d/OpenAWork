import { Schema } from 'effect';
import { Route } from '../route/client.js';
import { Protocol } from '../route/protocol.js';
import { Lifecycle } from './utils/lifecycle.js';
import { ToolStream } from './utils/tool-stream.js';
export declare const DEFAULT_BASE_URL = 'https://api.anthropic.com/v1';
export declare const PATH = '/messages';
declare const AnthropicMessagesBody: Schema.Struct<{
  model: Schema.String;
  system: Schema.optional<
    Schema.$Array<
      Schema.Struct<{
        readonly type: Schema.tag<'text'>;
        readonly text: Schema.String;
        readonly cache_control: Schema.optional<
          Schema.Struct<{
            readonly type: Schema.tag<'ephemeral'>;
            readonly ttl: Schema.optional<Schema.Literals<readonly ['5m', '1h']>>;
          }>
        >;
      }>
    >
  >;
  messages: Schema.$Array<
    Schema.toTaggedUnion<
      'role',
      readonly [
        Schema.Struct<{
          readonly role: Schema.Literal<'user'>;
          readonly content: Schema.$Array<
            Schema.Union<
              readonly [
                Schema.Struct<{
                  readonly type: Schema.tag<'text'>;
                  readonly text: Schema.String;
                  readonly cache_control: Schema.optional<
                    Schema.Struct<{
                      readonly type: Schema.tag<'ephemeral'>;
                      readonly ttl: Schema.optional<Schema.Literals<readonly ['5m', '1h']>>;
                    }>
                  >;
                }>,
                Schema.Struct<{
                  readonly type: Schema.tag<'image'>;
                  readonly source: Schema.Struct<{
                    readonly type: Schema.tag<'base64'>;
                    readonly media_type: Schema.String;
                    readonly data: Schema.String;
                  }>;
                  readonly cache_control: Schema.optional<
                    Schema.Struct<{
                      readonly type: Schema.tag<'ephemeral'>;
                      readonly ttl: Schema.optional<Schema.Literals<readonly ['5m', '1h']>>;
                    }>
                  >;
                }>,
                Schema.Struct<{
                  readonly type: Schema.tag<'tool_result'>;
                  readonly tool_use_id: Schema.String;
                  readonly content: Schema.Union<
                    readonly [
                      Schema.String,
                      Schema.$Array<
                        Schema.Union<
                          readonly [
                            Schema.Struct<{
                              readonly type: Schema.tag<'text'>;
                              readonly text: Schema.String;
                              readonly cache_control: Schema.optional<
                                Schema.Struct<{
                                  readonly type: Schema.tag<'ephemeral'>;
                                  readonly ttl: Schema.optional<
                                    Schema.Literals<readonly ['5m', '1h']>
                                  >;
                                }>
                              >;
                            }>,
                            Schema.Struct<{
                              readonly type: Schema.tag<'image'>;
                              readonly source: Schema.Struct<{
                                readonly type: Schema.tag<'base64'>;
                                readonly media_type: Schema.String;
                                readonly data: Schema.String;
                              }>;
                              readonly cache_control: Schema.optional<
                                Schema.Struct<{
                                  readonly type: Schema.tag<'ephemeral'>;
                                  readonly ttl: Schema.optional<
                                    Schema.Literals<readonly ['5m', '1h']>
                                  >;
                                }>
                              >;
                            }>,
                          ]
                        >
                      >,
                    ]
                  >;
                  readonly is_error: Schema.optional<Schema.Boolean>;
                  readonly cache_control: Schema.optional<
                    Schema.Struct<{
                      readonly type: Schema.tag<'ephemeral'>;
                      readonly ttl: Schema.optional<Schema.Literals<readonly ['5m', '1h']>>;
                    }>
                  >;
                }>,
              ]
            >
          >;
        }>,
        Schema.Struct<{
          readonly role: Schema.Literal<'assistant'>;
          readonly content: Schema.$Array<
            Schema.Union<
              readonly [
                Schema.Struct<{
                  readonly type: Schema.tag<'text'>;
                  readonly text: Schema.String;
                  readonly cache_control: Schema.optional<
                    Schema.Struct<{
                      readonly type: Schema.tag<'ephemeral'>;
                      readonly ttl: Schema.optional<Schema.Literals<readonly ['5m', '1h']>>;
                    }>
                  >;
                }>,
                Schema.Struct<{
                  readonly type: Schema.tag<'thinking'>;
                  readonly thinking: Schema.String;
                  readonly signature: Schema.optional<Schema.String>;
                  readonly cache_control: Schema.optional<
                    Schema.Struct<{
                      readonly type: Schema.tag<'ephemeral'>;
                      readonly ttl: Schema.optional<Schema.Literals<readonly ['5m', '1h']>>;
                    }>
                  >;
                }>,
                Schema.Struct<{
                  readonly type: Schema.tag<'tool_use'>;
                  readonly id: Schema.String;
                  readonly name: Schema.String;
                  readonly input: Schema.Unknown;
                  readonly cache_control: Schema.optional<
                    Schema.Struct<{
                      readonly type: Schema.tag<'ephemeral'>;
                      readonly ttl: Schema.optional<Schema.Literals<readonly ['5m', '1h']>>;
                    }>
                  >;
                }>,
                Schema.Struct<{
                  readonly type: Schema.tag<'server_tool_use'>;
                  readonly id: Schema.String;
                  readonly name: Schema.String;
                  readonly input: Schema.Unknown;
                  readonly cache_control: Schema.optional<
                    Schema.Struct<{
                      readonly type: Schema.tag<'ephemeral'>;
                      readonly ttl: Schema.optional<Schema.Literals<readonly ['5m', '1h']>>;
                    }>
                  >;
                }>,
                Schema.Struct<{
                  readonly type: Schema.Literals<
                    readonly [
                      'web_search_tool_result',
                      'code_execution_tool_result',
                      'web_fetch_tool_result',
                    ]
                  >;
                  readonly tool_use_id: Schema.String;
                  readonly content: Schema.Unknown;
                  readonly cache_control: Schema.optional<
                    Schema.Struct<{
                      readonly type: Schema.tag<'ephemeral'>;
                      readonly ttl: Schema.optional<Schema.Literals<readonly ['5m', '1h']>>;
                    }>
                  >;
                }>,
              ]
            >
          >;
        }>,
        Schema.Struct<{
          readonly role: Schema.Literal<'system'>;
          readonly content: Schema.$Array<
            Schema.Struct<{
              readonly type: Schema.tag<'text'>;
              readonly text: Schema.String;
              readonly cache_control: Schema.optional<
                Schema.Struct<{
                  readonly type: Schema.tag<'ephemeral'>;
                  readonly ttl: Schema.optional<Schema.Literals<readonly ['5m', '1h']>>;
                }>
              >;
            }>
          >;
        }>,
      ]
    >
  >;
  tools: Schema.optional<
    Schema.$Array<
      Schema.Struct<{
        readonly name: Schema.String;
        readonly description: Schema.String;
        readonly input_schema: Schema.$Record<Schema.String, Schema.Unknown>;
        readonly cache_control: Schema.optional<
          Schema.Struct<{
            readonly type: Schema.tag<'ephemeral'>;
            readonly ttl: Schema.optional<Schema.Literals<readonly ['5m', '1h']>>;
          }>
        >;
      }>
    >
  >;
  tool_choice: Schema.optional<
    Schema.Union<
      readonly [
        Schema.Struct<{
          readonly type: Schema.Literals<readonly ['auto', 'any']>;
        }>,
        Schema.Struct<{
          readonly type: Schema.tag<'tool'>;
          readonly name: Schema.String;
        }>,
      ]
    >
  >;
  stream: Schema.Literal<true>;
  max_tokens: Schema.Number;
  temperature: Schema.optional<Schema.Number>;
  top_p: Schema.optional<Schema.Number>;
  top_k: Schema.optional<Schema.Number>;
  stop_sequences: Schema.optional<Schema.$Array<Schema.String>>;
  thinking: Schema.optional<
    Schema.Struct<{
      readonly type: Schema.tag<'enabled'>;
      readonly budget_tokens: Schema.Number;
    }>
  >;
  context_management: Schema.optional<
    Schema.Struct<{
      readonly edits: Schema.$Array<
        Schema.Union<
          readonly [
            Schema.Struct<{
              readonly type: Schema.Literal<'clear_thinking_20251015'>;
              readonly keep: Schema.optional<
                Schema.Struct<{
                  readonly type: Schema.Literal<'thinking_turns'>;
                  readonly value: Schema.Number;
                }>
              >;
            }>,
            Schema.Struct<{
              readonly type: Schema.Literal<'clear_tool_uses_20250919'>;
              readonly trigger: Schema.optional<
                Schema.Struct<{
                  readonly type: Schema.Literal<'input_tokens'>;
                  readonly value: Schema.Number;
                }>
              >;
              readonly keep: Schema.optional<
                Schema.Struct<{
                  readonly type: Schema.Literal<'tool_uses'>;
                  readonly value: Schema.Number;
                }>
              >;
              readonly clear_at_least: Schema.optional<
                Schema.Struct<{
                  readonly type: Schema.Literal<'input_tokens'>;
                  readonly value: Schema.Number;
                }>
              >;
              readonly exclude_tools: Schema.optional<Schema.$Array<Schema.String>>;
            }>,
          ]
        >
      >;
    }>
  >;
}>;
export type AnthropicMessagesBody = Schema.Schema.Type<typeof AnthropicMessagesBody>;
/**
 * The Anthropic Messages protocol — request body construction, body schema,
 * and the streaming-event state machine. Used by native Anthropic Cloud and
 * (once registered) Vertex Anthropic / Bedrock-hosted Anthropic passthrough.
 */
export declare const protocol: Protocol<
  {
    readonly model: string;
    readonly messages: readonly (
      | {
          readonly role: 'user';
          readonly content: readonly (
            | {
                readonly type: 'text';
                readonly text: string;
                readonly cache_control?:
                  | {
                      readonly type: 'ephemeral';
                      readonly ttl?: '1h' | '5m' | undefined;
                    }
                  | undefined;
              }
            | {
                readonly type: 'image';
                readonly source: {
                  readonly type: 'base64';
                  readonly media_type: string;
                  readonly data: string;
                };
                readonly cache_control?:
                  | {
                      readonly type: 'ephemeral';
                      readonly ttl?: '1h' | '5m' | undefined;
                    }
                  | undefined;
              }
            | {
                readonly type: 'tool_result';
                readonly tool_use_id: string;
                readonly content:
                  | string
                  | readonly (
                      | {
                          readonly type: 'text';
                          readonly text: string;
                          readonly cache_control?:
                            | {
                                readonly type: 'ephemeral';
                                readonly ttl?: '1h' | '5m' | undefined;
                              }
                            | undefined;
                        }
                      | {
                          readonly type: 'image';
                          readonly source: {
                            readonly type: 'base64';
                            readonly media_type: string;
                            readonly data: string;
                          };
                          readonly cache_control?:
                            | {
                                readonly type: 'ephemeral';
                                readonly ttl?: '1h' | '5m' | undefined;
                              }
                            | undefined;
                        }
                    )[];
                readonly is_error?: boolean | undefined;
                readonly cache_control?:
                  | {
                      readonly type: 'ephemeral';
                      readonly ttl?: '1h' | '5m' | undefined;
                    }
                  | undefined;
              }
          )[];
        }
      | {
          readonly role: 'assistant';
          readonly content: readonly (
            | {
                readonly type: 'text';
                readonly text: string;
                readonly cache_control?:
                  | {
                      readonly type: 'ephemeral';
                      readonly ttl?: '1h' | '5m' | undefined;
                    }
                  | undefined;
              }
            | {
                readonly type: 'tool_use';
                readonly id: string;
                readonly name: string;
                readonly input: unknown;
                readonly cache_control?:
                  | {
                      readonly type: 'ephemeral';
                      readonly ttl?: '1h' | '5m' | undefined;
                    }
                  | undefined;
              }
            | {
                readonly type: 'server_tool_use';
                readonly id: string;
                readonly name: string;
                readonly input: unknown;
                readonly cache_control?:
                  | {
                      readonly type: 'ephemeral';
                      readonly ttl?: '1h' | '5m' | undefined;
                    }
                  | undefined;
              }
            | {
                readonly type:
                  'web_search_tool_result' | 'code_execution_tool_result' | 'web_fetch_tool_result';
                readonly tool_use_id: string;
                readonly content: unknown;
                readonly cache_control?:
                  | {
                      readonly type: 'ephemeral';
                      readonly ttl?: '1h' | '5m' | undefined;
                    }
                  | undefined;
              }
            | {
                readonly type: 'thinking';
                readonly thinking: string;
                readonly signature?: string | undefined;
                readonly cache_control?:
                  | {
                      readonly type: 'ephemeral';
                      readonly ttl?: '1h' | '5m' | undefined;
                    }
                  | undefined;
              }
          )[];
        }
      | {
          readonly role: 'system';
          readonly content: readonly {
            readonly type: 'text';
            readonly text: string;
            readonly cache_control?:
              | {
                  readonly type: 'ephemeral';
                  readonly ttl?: '1h' | '5m' | undefined;
                }
              | undefined;
          }[];
        }
    )[];
    readonly stream: true;
    readonly max_tokens: number;
    readonly system?:
      | readonly {
          readonly type: 'text';
          readonly text: string;
          readonly cache_control?:
            | {
                readonly type: 'ephemeral';
                readonly ttl?: '1h' | '5m' | undefined;
              }
            | undefined;
        }[]
      | undefined;
    readonly tools?:
      | readonly {
          readonly name: string;
          readonly description: string;
          readonly input_schema: {
            readonly [x: string]: unknown;
          };
          readonly cache_control?:
            | {
                readonly type: 'ephemeral';
                readonly ttl?: '1h' | '5m' | undefined;
              }
            | undefined;
        }[]
      | undefined;
    readonly tool_choice?:
      | {
          readonly type: 'auto' | 'any';
        }
      | {
          readonly type: 'tool';
          readonly name: string;
        }
      | undefined;
    readonly temperature?: number | undefined;
    readonly top_p?: number | undefined;
    readonly top_k?: number | undefined;
    readonly stop_sequences?: readonly string[] | undefined;
    readonly thinking?:
      | {
          readonly type: 'enabled';
          readonly budget_tokens: number;
        }
      | undefined;
    readonly context_management?:
      | {
          readonly edits: readonly (
            | {
                readonly type: 'clear_thinking_20251015';
                readonly keep?:
                  | {
                      readonly type: 'thinking_turns';
                      readonly value: number;
                    }
                  | undefined;
              }
            | {
                readonly type: 'clear_tool_uses_20250919';
                readonly trigger?:
                  | {
                      readonly type: 'input_tokens';
                      readonly value: number;
                    }
                  | undefined;
                readonly keep?:
                  | {
                      readonly type: 'tool_uses';
                      readonly value: number;
                    }
                  | undefined;
                readonly clear_at_least?:
                  | {
                      readonly type: 'input_tokens';
                      readonly value: number;
                    }
                  | undefined;
                readonly exclude_tools?: readonly string[] | undefined;
              }
          )[];
        }
      | undefined;
  },
  string,
  {
    readonly type: string;
    readonly index?: number | undefined;
    readonly message?:
      | {
          readonly usage?:
            | {
                readonly input_tokens?: number | undefined;
                readonly output_tokens?: number | undefined;
                readonly cache_creation_input_tokens?: number | null | undefined;
                readonly cache_read_input_tokens?: number | null | undefined;
              }
            | undefined;
        }
      | undefined;
    readonly content_block?:
      | {
          readonly type: string;
          readonly id?: string | undefined;
          readonly name?: string | undefined;
          readonly text?: string | undefined;
          readonly thinking?: string | undefined;
          readonly signature?: string | undefined;
          readonly input?: unknown;
          readonly tool_use_id?: string | undefined;
          readonly content?: unknown;
        }
      | undefined;
    readonly delta?:
      | {
          readonly type?: string | undefined;
          readonly text?: string | undefined;
          readonly thinking?: string | undefined;
          readonly partial_json?: string | undefined;
          readonly signature?: string | undefined;
          readonly stop_reason?: string | null | undefined;
          readonly stop_sequence?: string | null | undefined;
        }
      | undefined;
    readonly usage?:
      | {
          readonly input_tokens?: number | undefined;
          readonly output_tokens?: number | undefined;
          readonly cache_creation_input_tokens?: number | null | undefined;
          readonly cache_read_input_tokens?: number | null | undefined;
        }
      | undefined;
    readonly error?:
      | {
          readonly type?: string | undefined;
          readonly message?: string | undefined;
        }
      | undefined;
  },
  {
    tools: Partial<Record<number, ToolStream.PendingTool>>;
    lifecycle: Lifecycle.State;
  }
>;
export declare const route: Route<
  {
    readonly model: string;
    readonly messages: readonly (
      | {
          readonly role: 'user';
          readonly content: readonly (
            | {
                readonly type: 'text';
                readonly text: string;
                readonly cache_control?:
                  | {
                      readonly type: 'ephemeral';
                      readonly ttl?: '1h' | '5m' | undefined;
                    }
                  | undefined;
              }
            | {
                readonly type: 'image';
                readonly source: {
                  readonly type: 'base64';
                  readonly media_type: string;
                  readonly data: string;
                };
                readonly cache_control?:
                  | {
                      readonly type: 'ephemeral';
                      readonly ttl?: '1h' | '5m' | undefined;
                    }
                  | undefined;
              }
            | {
                readonly type: 'tool_result';
                readonly tool_use_id: string;
                readonly content:
                  | string
                  | readonly (
                      | {
                          readonly type: 'text';
                          readonly text: string;
                          readonly cache_control?:
                            | {
                                readonly type: 'ephemeral';
                                readonly ttl?: '1h' | '5m' | undefined;
                              }
                            | undefined;
                        }
                      | {
                          readonly type: 'image';
                          readonly source: {
                            readonly type: 'base64';
                            readonly media_type: string;
                            readonly data: string;
                          };
                          readonly cache_control?:
                            | {
                                readonly type: 'ephemeral';
                                readonly ttl?: '1h' | '5m' | undefined;
                              }
                            | undefined;
                        }
                    )[];
                readonly is_error?: boolean | undefined;
                readonly cache_control?:
                  | {
                      readonly type: 'ephemeral';
                      readonly ttl?: '1h' | '5m' | undefined;
                    }
                  | undefined;
              }
          )[];
        }
      | {
          readonly role: 'assistant';
          readonly content: readonly (
            | {
                readonly type: 'text';
                readonly text: string;
                readonly cache_control?:
                  | {
                      readonly type: 'ephemeral';
                      readonly ttl?: '1h' | '5m' | undefined;
                    }
                  | undefined;
              }
            | {
                readonly type: 'tool_use';
                readonly id: string;
                readonly name: string;
                readonly input: unknown;
                readonly cache_control?:
                  | {
                      readonly type: 'ephemeral';
                      readonly ttl?: '1h' | '5m' | undefined;
                    }
                  | undefined;
              }
            | {
                readonly type: 'server_tool_use';
                readonly id: string;
                readonly name: string;
                readonly input: unknown;
                readonly cache_control?:
                  | {
                      readonly type: 'ephemeral';
                      readonly ttl?: '1h' | '5m' | undefined;
                    }
                  | undefined;
              }
            | {
                readonly type:
                  'web_search_tool_result' | 'code_execution_tool_result' | 'web_fetch_tool_result';
                readonly tool_use_id: string;
                readonly content: unknown;
                readonly cache_control?:
                  | {
                      readonly type: 'ephemeral';
                      readonly ttl?: '1h' | '5m' | undefined;
                    }
                  | undefined;
              }
            | {
                readonly type: 'thinking';
                readonly thinking: string;
                readonly signature?: string | undefined;
                readonly cache_control?:
                  | {
                      readonly type: 'ephemeral';
                      readonly ttl?: '1h' | '5m' | undefined;
                    }
                  | undefined;
              }
          )[];
        }
      | {
          readonly role: 'system';
          readonly content: readonly {
            readonly type: 'text';
            readonly text: string;
            readonly cache_control?:
              | {
                  readonly type: 'ephemeral';
                  readonly ttl?: '1h' | '5m' | undefined;
                }
              | undefined;
          }[];
        }
    )[];
    readonly stream: true;
    readonly max_tokens: number;
    readonly system?:
      | readonly {
          readonly type: 'text';
          readonly text: string;
          readonly cache_control?:
            | {
                readonly type: 'ephemeral';
                readonly ttl?: '1h' | '5m' | undefined;
              }
            | undefined;
        }[]
      | undefined;
    readonly tools?:
      | readonly {
          readonly name: string;
          readonly description: string;
          readonly input_schema: {
            readonly [x: string]: unknown;
          };
          readonly cache_control?:
            | {
                readonly type: 'ephemeral';
                readonly ttl?: '1h' | '5m' | undefined;
              }
            | undefined;
        }[]
      | undefined;
    readonly tool_choice?:
      | {
          readonly type: 'auto' | 'any';
        }
      | {
          readonly type: 'tool';
          readonly name: string;
        }
      | undefined;
    readonly temperature?: number | undefined;
    readonly top_p?: number | undefined;
    readonly top_k?: number | undefined;
    readonly stop_sequences?: readonly string[] | undefined;
    readonly thinking?:
      | {
          readonly type: 'enabled';
          readonly budget_tokens: number;
        }
      | undefined;
    readonly context_management?:
      | {
          readonly edits: readonly (
            | {
                readonly type: 'clear_thinking_20251015';
                readonly keep?:
                  | {
                      readonly type: 'thinking_turns';
                      readonly value: number;
                    }
                  | undefined;
              }
            | {
                readonly type: 'clear_tool_uses_20250919';
                readonly trigger?:
                  | {
                      readonly type: 'input_tokens';
                      readonly value: number;
                    }
                  | undefined;
                readonly keep?:
                  | {
                      readonly type: 'tool_uses';
                      readonly value: number;
                    }
                  | undefined;
                readonly clear_at_least?:
                  | {
                      readonly type: 'input_tokens';
                      readonly value: number;
                    }
                  | undefined;
                readonly exclude_tools?: readonly string[] | undefined;
              }
          )[];
        }
      | undefined;
  },
  import('../route/transport/http.js').HttpPrepared<string>
>;
export * as AnthropicMessages from './anthropic-messages.js';
//# sourceMappingURL=anthropic-messages.d.ts.map
