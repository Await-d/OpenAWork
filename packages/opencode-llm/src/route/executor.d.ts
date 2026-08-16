import { Context, Effect, Layer } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";
import { LLMError } from "../schema/index.js";
export interface Interface {
    readonly execute: (request: HttpClientRequest.HttpClientRequest) => Effect.Effect<HttpClientResponse.HttpClientResponse, LLMError>;
}
declare const Service_base: Context.ServiceClass<Service, "@opencode/LLM/RequestExecutor", Interface>;
export declare class Service extends Service_base {
}
export declare const layer: Layer.Layer<Service, never, HttpClient.HttpClient>;
export declare const fetchLayer: Layer.Layer<Service, never, never>;
export * as RequestExecutor from "./executor.js";
//# sourceMappingURL=executor.d.ts.map