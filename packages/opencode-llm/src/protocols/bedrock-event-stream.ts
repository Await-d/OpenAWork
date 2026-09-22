import { EventStreamCodec } from '@smithy/eventstream-codec';
import { fromUtf8, toUtf8 } from '@smithy/util-utf8';
import { Effect, Encoding, Stream } from 'effect';
import type { Framing } from '../route/framing.js';
import { ProviderShared } from './shared.js';

// Bedrock streams responses using the AWS event stream binary protocol — each
// frame is `[length:4][headers-length:4][prelude-crc:4][headers][payload][crc:4]`.
// We use `@smithy/eventstream-codec` to validate framing and CRCs, then
// reconstruct the JSON wrapping by `:event-type` so the chunk schema can match.
const eventCodec = new EventStreamCodec(toUtf8, fromUtf8);
const utf8 = new TextDecoder();

// Cursor-tracking buffer state. Bytes accumulate in `buffer`; `offset` is the
// read position. Reading by `subarray` is zero-copy. We only allocate a fresh
// buffer when a new network chunk arrives and we need to append.
interface FrameBufferState {
  readonly buffer: Uint8Array;
  readonly offset: number;
}

const initialFrameBuffer: FrameBufferState = { buffer: new Uint8Array(0), offset: 0 };

// The framer consumes either a network chunk or the end-of-stream sentinel.
// The sentinel lets us detect a truncated final frame (a provider that closes
// mid-frame) instead of silently treating the short read as a complete stream.
type FrameInput = { readonly _tag: 'Chunk'; readonly bytes: Uint8Array } | { readonly _tag: 'End' };

const endOfStream: FrameInput = { _tag: 'End' };

const appendChunk = (state: FrameBufferState, chunk: Uint8Array): FrameBufferState => {
  const remaining = state.buffer.length - state.offset;
  // Compact: drop the consumed prefix and append the new chunk in one alloc.
  // This bounds buffer growth to at most one network chunk past the live
  // window, regardless of stream length.
  const next = new Uint8Array(remaining + chunk.length);
  next.set(state.buffer.subarray(state.offset), 0);
  next.set(chunk, remaining);
  return { buffer: next, offset: 0 };
};

const consumeFrames = (route: string) => (state: FrameBufferState, input: FrameInput) =>
  Effect.gen(function* () {
    if (input._tag === 'End') {
      const remaining = state.buffer.subarray(state.offset);
      if (remaining.length > 0)
        return yield* ProviderShared.incompleteStreamError(
          route,
          `Incomplete Bedrock Converse event-stream frame: ${remaining.length} buffered bytes remain at end of stream`,
          Encoding.encodeBase64(remaining),
        );
      return [state, [] as object[]] as const;
    }
    let cursor = appendChunk(state, input.bytes);
    const out: object[] = [];
    while (cursor.buffer.length - cursor.offset >= 4) {
      const view = cursor.buffer.subarray(cursor.offset);
      const totalLength = new DataView(view.buffer, view.byteOffset, view.byteLength).getUint32(
        0,
        false,
      );
      if (view.length < totalLength) break;

      const decoded = yield* Effect.try({
        try: () => eventCodec.decode(view.subarray(0, totalLength)),
        catch: (error) =>
          ProviderShared.eventError(
            route,
            `Failed to decode Bedrock Converse event-stream frame: ${
              error instanceof Error ? error.message : String(error)
            }`,
            Encoding.encodeBase64(view.subarray(0, totalLength)),
            error,
          ),
      });
      cursor = { buffer: cursor.buffer, offset: cursor.offset + totalLength };

      const payload = utf8.decode(decoded.body);
      // Original headers + payload, kept on every emitted frame so a later
      // chunk-schema decode failure can report the wire body instead of only the
      // reconstructed object. The chunk schema ignores the extra key.
      const rawBody = ProviderShared.encodeJson({ headers: decoded.headers, body: payload });
      const messageType = decoded.headers[':message-type']?.value;
      // A `:message-type: error` frame carries its code/message in headers and
      // has no JSON payload. Dropping it used to make a failed Bedrock turn look
      // like a clean, empty completion, so surface it as a provider error.
      if (messageType === 'error') {
        const code = decoded.headers[':error-code']?.value;
        const message = decoded.headers[':error-message']?.value;
        return yield* ProviderShared.eventError(
          route,
          [code, message]
            .filter((value): value is string => typeof value === 'string')
            .join(': ') || 'Bedrock Converse event-stream error',
          rawBody,
        );
      }
      const eventType =
        messageType === 'event'
          ? decoded.headers[':event-type']?.value
          : messageType === 'exception'
            ? decoded.headers[':exception-type']?.value
            : undefined;
      if (typeof eventType !== 'string') continue;
      if (!payload) continue;
      // The AWS event stream pads short payloads with a `p` field. Drop it
      // before handing the object to the chunk schema. JSON decode goes
      // through the shared Schema-driven codec to satisfy the package rule
      // against ad-hoc `JSON.parse` calls.
      const parsed = (yield* ProviderShared.parseJson(
        route,
        payload,
        'Failed to parse Bedrock Converse event-stream payload',
      )) as Record<string, unknown>;
      delete parsed.p;
      out.push(
        messageType === 'exception'
          ? { exception: { type: eventType, details: parsed }, rawBody }
          : { [eventType]: parsed, rawBody },
      );
    }
    return [cursor, out] as const;
  });

/**
 * AWS event-stream framing for Bedrock Converse. Each frame is decoded by
 * `@smithy/eventstream-codec` (length + header + payload + CRC) and rewrapped
 * under its `:event-type` header so the chunk schema can match the JSON
 * payload directly.
 */
export const framing = (route: string): Framing<object> => ({
  id: 'aws-event-stream',
  frame: (bytes) =>
    bytes.pipe(
      Stream.map((chunk): FrameInput => ({ _tag: 'Chunk', bytes: chunk })),
      Stream.concat(Stream.succeed(endOfStream)),
      Stream.mapAccumEffect(() => initialFrameBuffer, consumeFrames(route)),
    ),
});

export * as BedrockEventStream from './bedrock-event-stream.js';
