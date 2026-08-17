import { Cause, Context, Effect, Layer, Schema, Stream } from "effect";
import * as Option from "effect/Option";
import { Auth } from "./auth.js";
import { Endpoint } from "./endpoint.js";
import { RequestExecutor } from "./executor.js";
import { HttpTransport } from "./transport/index.js";
import { WebSocketExecutor } from "./transport/index.js";
import { applyCachePolicy } from "../cache-policy.js";
import * as ProviderShared from "../protocols/shared.js";
import { GenerationOptions, HttpOptions, LLMRequest, LLMResponse, Model, ModelLimits, LLMError as LLMErrorClass, PreparedRequest, ProviderID, mergeGenerationOptions, mergeHttpOptions, mergeProviderOptions, } from "../schema/index.js";
const makeRouteModel = (route, mapped) => {
    const provider = route.provider ?? ("provider" in mapped ? mapped.provider : undefined);
    if (!provider)
        throw new Error(`Route.model(${route.id}) requires a provider`);
    if (!endpointBaseURL(route.endpoint))
        throw new Error(`Route.model(${route.id}) requires an endpoint baseURL — configure it on the route first`);
    return Model.make({
        ...mapped,
        provider,
        route,
    });
};
const mergeRouteDefaults = (base, patch) => {
    const headers = mergeHeaders(base?.headers, patch.headers);
    return {
        ...base,
        ...patch,
        headers,
        limits: patch.limits === undefined ? base?.limits : ModelLimits.make(patch.limits),
        generation: mergeGenerationOptions(generationOptions(base?.generation), generationOptions(patch.generation)),
        providerOptions: mergeProviderOptions(base?.providerOptions, patch.providerOptions),
        http: mergeHttpOptions(base?.http, httpOptions(patch.http), headers === undefined ? undefined : new HttpOptions({ headers })),
    };
};
const endpointBaseURL = (endpoint) => typeof endpoint.baseURL === "string" ? endpoint.baseURL : undefined;
const mergeHeaders = (...items) => {
    const entries = items.flatMap((item) => item === undefined ? [] : Object.entries(item).filter((entry) => entry[1] !== undefined));
    if (entries.length === 0)
        return undefined;
    return Object.fromEntries(entries);
};
export const generationOptions = (input) => input === undefined ? undefined : GenerationOptions.make(input);
export const httpOptions = (input) => {
    if (input === undefined)
        return input;
    return HttpOptions.make(input);
};
export class Service extends Context.Service()("@opencode/LLMClient") {
}
const resolveRequestOptions = (request) => {
    const routeDefaults = request.model.route.defaults;
    const modelDefaults = request.model.defaults;
    const generation = mergeGenerationOptions(routeDefaults.generation, modelDefaults?.generation, request.generation);
    return LLMRequest.update(request, {
        generation: generation ?? new GenerationOptions({}),
        providerOptions: mergeProviderOptions(routeDefaults.providerOptions, modelDefaults?.providerOptions, request.providerOptions),
        http: mergeHttpOptions(routeDefaults.http, modelDefaults?.http, request.http),
    });
};
const streamError = (route, message, cause) => {
    const failed = cause.reasons.find(Cause.isFailReason)?.error;
    if (failed instanceof LLMErrorClass)
        return failed;
    return ProviderShared.eventError(route, message, Cause.pretty(cause));
};
function makeFromTransport(input) {
    const protocol = input.protocol;
    const encodeBody = Schema.encodeSync(Schema.fromJsonString(protocol.body.schema));
    const decodeEventEffect = Schema.decodeUnknownEffect(protocol.stream.event);
    const decodeEvent = (route) => (frame) => decodeEventEffect(frame).pipe(Effect.mapError(() => ProviderShared.eventError(input.id, `Invalid ${route} stream event`, typeof frame === "string" ? frame : ProviderShared.encodeJson(frame))));
    const build = (routeInput) => {
        const route = {
            id: routeInput.id,
            provider: routeInput.provider === undefined ? undefined : ProviderID.make(routeInput.provider),
            protocol: protocol.id,
            endpoint: routeInput.endpoint,
            auth: routeInput.auth ?? Auth.none,
            transport: routeInput.transport,
            defaults: routeInput.defaults ?? {},
            body: protocol.body,
            with: (patch) => {
                const { id, provider, auth, transport, endpoint, ...defaults } = patch;
                return build({
                    ...routeInput,
                    id: id ?? routeInput.id,
                    provider: provider ?? routeInput.provider,
                    auth: auth ?? routeInput.auth,
                    endpoint: endpoint ? Endpoint.merge(routeInput.endpoint, endpoint) : routeInput.endpoint,
                    transport: transport ?? routeInput.transport,
                    defaults: mergeRouteDefaults(route.defaults, defaults),
                });
            },
            model: (input) => makeRouteModel(route, input),
            prepareTransport: (body, request) => routeInput.transport.prepare({
                body,
                request,
                endpoint: routeInput.endpoint,
                auth: routeInput.auth ?? Auth.none,
                encodeBody,
                headers: routeInput.headers,
            }),
            streamPrepared: (prepared, request, runtime) => {
                const route = `${request.model.provider}/${request.model.route.id}`;
                const events = routeInput.transport
                    .frames(prepared, request, runtime)
                    .pipe(Stream.mapEffect(decodeEvent(route)), protocol.stream.terminal ? Stream.takeUntil(protocol.stream.terminal) : (stream) => stream);
                return events.pipe(Stream.mapAccumEffect(() => protocol.stream.initial(request), protocol.stream.step, protocol.stream.onHalt ? { onHalt: protocol.stream.onHalt } : undefined), Stream.catchCause((cause) => Stream.fail(streamError(route, `Failed to read ${route} stream`, cause))));
            },
        };
        return route;
    };
    return build({ ...input, defaults: mergeRouteDefaults(undefined, input.defaults ?? {}) });
}
export function make(input) {
    if ("transport" in input)
        return makeFromTransport(input);
    const protocol = input.protocol;
    return makeFromTransport({
        id: input.id,
        provider: input.provider,
        protocol,
        endpoint: input.endpoint,
        auth: input.auth,
        headers: input.headers,
        transport: HttpTransport.httpJson({ framing: input.framing }),
        defaults: input.defaults,
    });
}
// `compile` is the important boundary: it turns a common `LLMRequest` into a
// validated provider body plus transport-private prepared data, but does not
// execute transport.
const compile = Effect.fn("LLM.compile")(function* (request) {
    const resolved = applyCachePolicy(resolveRequestOptions(request));
    const route = resolved.model.route;
    const body = yield* route.body
        .from(resolved)
        .pipe(Effect.flatMap(ProviderShared.validateWith(Schema.decodeUnknownEffect(route.body.schema))));
    const prepared = yield* route.prepareTransport(body, resolved);
    return {
        request: resolved,
        route,
        body,
        prepared,
    };
});
const prepareWith = Effect.fn("LLMClient.prepare")(function* (request) {
    const compiled = yield* compile(request);
    return new PreparedRequest({
        id: compiled.request.id ?? "request",
        route: compiled.route.id,
        protocol: compiled.route.protocol,
        model: compiled.request.model,
        body: compiled.body,
        metadata: { transport: compiled.route.transport.id },
    });
});
const streamRequestWith = (runtime) => (request) => Stream.unwrap(Effect.gen(function* () {
    const compiled = yield* compile(request);
    return compiled.route.streamPrepared(compiled.prepared, compiled.request, runtime);
}));
const generateWith = (stream) => Effect.fn("LLM.generate")(function* (request) {
    const state = yield* stream(request).pipe(Stream.runFold(LLMResponse.empty, LLMResponse.reduce));
    const response = LLMResponse.complete(state);
    if (response)
        return response;
    return yield* ProviderShared.eventError(`${request.model.provider}/${request.model.route.id}`, "Provider stream ended without a terminal finish event");
});
export const prepare = (request) => prepareWith(request);
export function stream(request) {
    return Stream.unwrap(Effect.gen(function* () {
        return (yield* Service).stream(request);
    }));
}
export function generate(request) {
    return Effect.gen(function* () {
        return yield* (yield* Service).generate(request);
    });
}
export const streamRequest = (request) => Stream.unwrap(Effect.gen(function* () {
    return (yield* Service).stream(request);
}));
export const layer = Layer.effect(Service, Effect.gen(function* () {
    const stream = streamRequestWith({
        http: yield* RequestExecutor.Service,
        webSocket: Option.getOrUndefined(yield* Effect.serviceOption(WebSocketExecutor.Service)),
    });
    return Service.of({ prepare: prepareWith, stream, generate: generateWith(stream) });
}));
export const Route = { make };
export const LLMClient = {
    Service,
    layer,
    prepare,
    stream,
    generate,
};
//# sourceMappingURL=client.js.map