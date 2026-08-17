import { Schema } from 'effect';
/**
 * Construct a `Protocol` from its body and stream pieces:
 *
 * - `body.schema` infers the provider-native request body shape.
 * - `body.from` ties the common `LLMRequest` to the provider body.
 * - `stream.event` infers the decoded streaming event and the wire frame.
 * - `stream.initial`, `stream.step`, and `stream.onHalt` infer the parser state.
 *
 * Provider implementations should usually call `Protocol.make({ ... })`
 * without explicit type arguments; the schemas and parser functions are the
 * source of truth. The constructor remains as the public seam for future
 * cross-cutting concerns such as tracing or instrumentation.
 */
export const make = (input) => input;
export const jsonEvent = (schema) => Schema.fromJsonString(schema);
export * as Protocol from './protocol.js';
//# sourceMappingURL=protocol.js.map
