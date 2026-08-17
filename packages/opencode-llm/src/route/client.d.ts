import { Context, Effect, Layer, Schema, Stream } from 'effect';
import { type Auth as AuthDef } from './auth.js';
import { Endpoint, type EndpointPatch } from './endpoint.js';
import { RequestExecutor } from './executor.js';
import type { Framing } from './framing.js';
import { HttpTransport } from './transport/index.js';
import type { Transport, TransportRuntime } from './transport/index.js';
import type { Protocol } from './protocol.js';
import type {
  LLMError,
  LLMEvent,
  PreparedRequestOf,
  ProtocolID,
  ProviderOptions,
} from '../schema/index.js';
import {
  GenerationOptions,
  HttpOptions,
  LLMRequest,
  LLMResponse,
  Model,
  ModelLimits,
  ProviderID,
} from '../schema/index.js';
export interface RouteBody<Body> {
  /** Schema for the validated provider-native body sent as the JSON request. */
  readonly schema: Schema.Codec<Body, unknown>;
  /** Build the provider-native body from a common `LLMRequest`. */
  readonly from: (request: LLMRequest) => Effect.Effect<Body, LLMError>;
}
export interface Route<Body, Prepared = unknown> {
  readonly id: string;
  readonly provider?: ProviderID;
  readonly protocol: ProtocolID;
  readonly endpoint: Endpoint<Body>;
  readonly auth: AuthDef;
  readonly transport: Transport<Body, Prepared, unknown>;
  readonly defaults: RouteDefaults;
  readonly body: RouteBody<Body>;
  readonly with: (patch: RoutePatch<Body, Prepared>) => Route<Body, Prepared>;
  readonly model: (input: RouteMappedModelInput) => Model;
  readonly prepareTransport: (body: Body, request: LLMRequest) => Effect.Effect<Prepared, LLMError>;
  readonly streamPrepared: (
    prepared: Prepared,
    request: LLMRequest,
    runtime: TransportRuntime,
  ) => Stream.Stream<LLMEvent, LLMError>;
}
export type AnyRoute = Route<any, any>;
export type HttpOptionsInput = HttpOptions.Input;
export type RouteModelInput = Omit<Model.Input, 'provider' | 'route'>;
export type RouteRoutedModelInput = Omit<Model.Input, 'route'>;
export interface RouteDefaults {
  readonly headers?: Record<string, string>;
  readonly limits?: ModelLimits;
  readonly generation?: GenerationOptions;
  readonly providerOptions?: ProviderOptions;
  readonly http?: HttpOptions;
}
export interface RouteDefaultsInput {
  readonly headers?: Record<string, string>;
  readonly limits?: ModelLimits.Input;
  readonly generation?: GenerationOptions.Input;
  readonly providerOptions?: ProviderOptions;
  readonly http?: HttpOptions.Input;
}
export interface RoutePatch<Body, Prepared> extends RouteDefaultsInput {
  readonly id?: string;
  readonly provider?: string | ProviderID;
  readonly auth?: AuthDef;
  readonly transport?: Transport<Body, Prepared, unknown>;
  readonly endpoint?: EndpointPatch<Body>;
}
type RouteMappedModelInput = RouteModelInput | RouteRoutedModelInput;
export declare const generationOptions: (
  input: GenerationOptions.Input | undefined,
) => GenerationOptions | undefined;
export declare const httpOptions: (input: HttpOptionsInput | undefined) => HttpOptions | undefined;
export interface Interface {
  /**
   * Compile a request through protocol body construction, validation, and HTTP
   * preparation without sending it. Returns the prepared request including the
   * provider-native body.
   *
   * Pass a `Body` type argument to statically expose the route's body
   * shape (e.g. `prepare<OpenAIChatBody>(...)`) — the runtime body is
   * identical, so this is a type-level assertion the caller makes about which
   * route the request will resolve to.
   */
  readonly prepare: <Body = unknown>(
    request: LLMRequest,
  ) => Effect.Effect<PreparedRequestOf<Body>, LLMError>;
  readonly stream: StreamMethod;
  readonly generate: GenerateMethod;
}
export interface StreamMethod {
  (request: LLMRequest): Stream.Stream<LLMEvent, LLMError>;
}
export interface GenerateMethod {
  (request: LLMRequest): Effect.Effect<LLMResponse, LLMError>;
}
declare const Service_base: Context.ServiceClass<Service, '@opencode/LLMClient', Interface>;
export declare class Service extends Service_base {}
export interface MakeInput<Body, Frame, Event, State> {
  /** Route id used in diagnostics and prepared request metadata. */
  readonly id: string;
  /** Provider identity for route-owned model construction. */
  readonly provider?: string | ProviderID;
  /** Semantic API contract — owns body construction, body schema, and parsing. */
  readonly protocol: Protocol<Body, Frame, Event, State>;
  /** Where the request is sent. */
  readonly endpoint: Endpoint<Body>;
  /** Per-request transport auth. Provider facades override this via `route.with(...)`. */
  readonly auth?: AuthDef;
  /** Stream framing — bytes -> frames before `protocol.stream.event` decoding. */
  readonly framing: Framing<Frame>;
  /** Static / per-request headers added before `auth` runs. */
  readonly headers?: (input: { readonly request: LLMRequest }) => Record<string, string>;
  /** Route/request defaults used when compiling requests for this route. */
  readonly defaults?: RouteDefaultsInput;
}
export interface MakeTransportInput<Body, Prepared, Frame, Event, State> {
  /** Route id used in diagnostics and prepared request metadata. */
  readonly id: string;
  /** Provider identity for route-owned model construction. */
  readonly provider?: string | ProviderID;
  /** Semantic API contract — owns body construction, body schema, and parsing. */
  readonly protocol: Protocol<Body, Frame, Event, State>;
  /** Where the request is sent. */
  readonly endpoint: Endpoint<Body>;
  /** Per-request transport auth. Provider facades override this via `route.with(...)`. */
  readonly auth?: AuthDef;
  /** Static / per-request headers added before `auth` runs. */
  readonly headers?: (input: { readonly request: LLMRequest }) => Record<string, string>;
  /** Runnable transport route. */
  readonly transport: Transport<Body, Prepared, Frame>;
  /** Route/request defaults used when compiling requests for this route. */
  readonly defaults?: RouteDefaultsInput;
}
export declare function make<Body, Prepared, Frame, Event, State>(
  input: MakeTransportInput<Body, Prepared, Frame, Event, State>,
): Route<Body, Prepared>;
/**
 * Build a `Route` by composing the four orthogonal pieces of a deployment:
 *
 * - `Protocol` — what is the API I'm speaking?
 * - `Endpoint` — where do I send the request?
 * - `Auth` — how do I authenticate it?
 * - `Framing` — how do I cut the response stream into protocol frames?
 *
 * Plus optional `headers` for cross-cutting deployment concerns (provider
 * version pins, per-deployment quirks).
 *
 * This is the canonical route constructor. If a new route does not fit
 * this four-axis model, add a purpose-built constructor rather than widening
 * the public surface preemptively.
 */
export declare function make<Body, Frame, Event, State>(
  input: MakeInput<Body, Frame, Event, State>,
): Route<Body, HttpTransport.HttpPrepared<Frame>>;
export declare const prepare: <Body = unknown>(
  request: LLMRequest,
) => Effect.Effect<PreparedRequestOf<Body>, LLMError>;
export declare function stream(request: LLMRequest): Stream.Stream<LLMEvent, LLMError>;
export declare function generate(request: LLMRequest): Effect.Effect<LLMResponse, LLMError>;
export declare const streamRequest: (request: LLMRequest) => Stream.Stream<
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
      readonly usage?: import('../schema/events.js').Usage | undefined;
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
      readonly usage?: import('../schema/events.js').Usage | undefined;
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
  LLMError,
  Service
>;
export declare const layer: Layer.Layer<Service, never, RequestExecutor.Service>;
export declare const Route: {
  readonly make: typeof make;
};
export declare const LLMClient: {
  readonly Service: typeof Service;
  readonly layer: Layer.Layer<Service, never, RequestExecutor.Service>;
  readonly prepare: <Body = unknown>(
    request: LLMRequest,
  ) => Effect.Effect<PreparedRequestOf<Body>, LLMError>;
  readonly stream: typeof stream;
  readonly generate: typeof generate;
};
export {};
//# sourceMappingURL=client.d.ts.map
