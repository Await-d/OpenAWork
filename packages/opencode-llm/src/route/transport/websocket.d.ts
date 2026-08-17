import { Context, Effect, Layer, Stream } from "effect";
import { Headers } from "effect/unstable/http";
import { LLMError } from "../../schema/index.js";
import type { Transport } from "./index.js";
export interface WebSocketRequest {
    readonly url: string;
    readonly headers: Headers.Headers;
}
export interface WebSocketConnection {
    readonly sendText: (message: string) => Effect.Effect<void, LLMError>;
    readonly messages: Stream.Stream<string | Uint8Array, LLMError>;
    readonly close: Effect.Effect<void, never>;
}
export interface Interface {
    readonly open: (input: WebSocketRequest) => Effect.Effect<WebSocketConnection, LLMError>;
}
declare const Service_base: Context.ServiceClass<Service, "@opencode/LLM/WebSocketExecutor", Interface>;
export declare class Service extends Service_base {
}
export declare const open: (input: WebSocketRequest) => Effect.Effect<WebSocketConnection, LLMError, never>;
export declare const layer: Layer.Layer<Service>;
export declare const fromWebSocket: (ws: globalThis.WebSocket, input: WebSocketRequest) => Effect.Effect<WebSocketConnection, LLMError>;
export declare const messageText: (message: string | Uint8Array, decoder: TextDecoder) => string;
export interface JsonPrepared {
    readonly url: string;
    readonly headers: Headers.Headers;
    readonly message: string;
}
export interface JsonInput<Body, Message> {
    readonly toMessage: (body: Body | Record<string, unknown>) => Effect.Effect<Message, LLMError>;
    readonly encodeMessage: (message: Message) => string;
}
export type JsonPatch<Body, Message> = Partial<JsonInput<Body, Message>>;
export interface JsonTransport<Body, Message> extends Transport<Body, JsonPrepared, string> {
    readonly with: (patch: JsonPatch<Body, Message>) => JsonTransport<Body, Message>;
}
export declare const json: <Body, Message>(input: JsonInput<Body, Message>) => JsonTransport<Body, Message>;
export declare const jsonTransport: {
    readonly id: "websocket-json";
    readonly with: <Body, Message>(input: JsonInput<Body, Message>) => JsonTransport<Body, Message>;
};
export declare const WebSocketExecutor: {
    readonly Service: typeof Service;
    readonly layer: Layer.Layer<Service, never, never>;
    readonly open: (input: WebSocketRequest) => Effect.Effect<WebSocketConnection, LLMError, never>;
    readonly fromWebSocket: (ws: globalThis.WebSocket, input: WebSocketRequest) => Effect.Effect<WebSocketConnection, LLMError>;
    readonly messageText: (message: string | Uint8Array, decoder: TextDecoder) => string;
};
export declare const WebSocketTransport: {
    readonly json: <Body, Message>(input: JsonInput<Body, Message>) => JsonTransport<Body, Message>;
    readonly jsonTransport: {
        readonly id: "websocket-json";
        readonly with: <Body, Message>(input: JsonInput<Body, Message>) => JsonTransport<Body, Message>;
    };
};
export {};
//# sourceMappingURL=websocket.d.ts.map