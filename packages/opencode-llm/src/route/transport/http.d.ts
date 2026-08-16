import { Effect } from "effect";
import { Headers, HttpClientRequest } from "effect/unstable/http";
import { type Framing as FramingDef } from "../framing.js";
import type { Transport, TransportPrepareInput } from "./index.js";
export type JsonRequestInput<Body> = TransportPrepareInput<Body>;
export interface JsonRequestParts<Body = unknown> {
    readonly url: string;
    readonly jsonBody: Body | Record<string, unknown>;
    readonly bodyText: string;
    readonly headers: Headers.Headers;
}
export interface HttpPrepared<Frame> {
    readonly request: HttpClientRequest.HttpClientRequest;
    readonly framing: FramingDef<Frame>;
}
export declare const jsonRequestParts: <Body>(input: JsonRequestInput<Body>) => Effect.Effect<{
    url: string;
    jsonBody: Record<string, unknown> | Body;
    bodyText: string;
    headers: Headers.Headers;
}, import("../../schema/errors.js").LLMError, never>;
export interface HttpJsonInput<_Body, Frame> {
    readonly framing: FramingDef<Frame>;
}
export type HttpJsonPatch<Body, Frame> = Partial<HttpJsonInput<Body, Frame>>;
export interface HttpJsonTransport<Body, Frame> extends Transport<Body, HttpPrepared<Frame>, Frame> {
    readonly with: (patch: HttpJsonPatch<Body, Frame>) => HttpJsonTransport<Body, Frame>;
}
export declare const httpJson: <Body, Frame>(input: HttpJsonInput<Body, Frame>) => HttpJsonTransport<Body, Frame>;
export declare const sseJson: {
    readonly id: "http-json/sse";
    readonly with: <Body>() => HttpJsonTransport<Body, string>;
};
//# sourceMappingURL=http.d.ts.map