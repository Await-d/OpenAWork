import { Cause, Context, Effect, Layer, Queue, Stream } from 'effect';
import { LLMError, TransportReason } from '../../schema/index.js';
import * as HttpTransport from './http.js';
import { redactTransportText, redactTransportUrl } from './redaction.js';
export class Service extends Context.Service()('@opencode/LLM/WebSocketExecutor') {}
const transportError = (method, message, input = {}) =>
  new LLMError({
    module: 'WebSocketExecutor',
    method,
    reason: new TransportReason({
      message: redactTransportText(message, input.url),
      url: input.url === undefined ? undefined : redactTransportUrl(input.url),
      kind: input.kind,
    }),
  });
const eventMessage = (event) => {
  if ('message' in event && typeof event.message === 'string') return event.message;
  return event.type;
};
const binaryMessage = (data) => {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data))
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return undefined;
};
const waitOpen = (ws, input) => {
  if (ws.readyState === globalThis.WebSocket.OPEN) return Effect.void;
  if (
    ws.readyState === globalThis.WebSocket.CLOSING ||
    ws.readyState === globalThis.WebSocket.CLOSED
  ) {
    return Effect.fail(
      transportError('open', `WebSocket closed before opening (state ${ws.readyState})`, {
        url: input.url,
        kind: 'open',
      }),
    );
  }
  return Effect.callback((resume, signal) => {
    const cleanup = () => {
      ws.removeEventListener('open', onOpen);
      ws.removeEventListener('error', onError);
      ws.removeEventListener('close', onClose);
      signal.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      cleanup();
      if (
        ws.readyState !== globalThis.WebSocket.CLOSED &&
        ws.readyState !== globalThis.WebSocket.CLOSING
      )
        ws.close(1000);
    };
    const onOpen = () => {
      cleanup();
      resume(Effect.void);
    };
    const onError = (event) => {
      cleanup();
      resume(
        Effect.fail(
          transportError('open', `Failed to open WebSocket: ${eventMessage(event)}`, {
            url: input.url,
            kind: 'open',
          }),
        ),
      );
    };
    const onClose = (event) => {
      cleanup();
      resume(
        Effect.fail(
          transportError('open', `WebSocket closed before opening with code ${event.code}`, {
            url: input.url,
            kind: 'open',
          }),
        ),
      );
    };
    ws.addEventListener('open', onOpen, { once: true });
    ws.addEventListener('error', onError, { once: true });
    ws.addEventListener('close', onClose, { once: true });
    signal.addEventListener('abort', onAbort, { once: true });
  });
};
const webSocketUrl = (value) =>
  Effect.try({
    try: () => {
      const url = new URL(value);
      if (url.protocol === 'https:') {
        url.protocol = 'wss:';
        return url.toString();
      }
      if (url.protocol === 'http:') {
        url.protocol = 'ws:';
        return url.toString();
      }
      throw new Error(`Unsupported WebSocket URL protocol ${url.protocol}`);
    },
    catch: (error) =>
      transportError('prepare', error instanceof Error ? error.message : 'Invalid WebSocket URL', {
        url: value,
        kind: 'websocket',
      }),
  });
export const open = (input) =>
  Effect.try({
    try: () => new globalThis.WebSocket(input.url, { headers: input.headers }),
    catch: (error) =>
      transportError(
        'open',
        error instanceof Error ? error.message : 'Failed to construct WebSocket',
        {
          url: input.url,
          kind: 'open',
        },
      ),
  }).pipe(Effect.flatMap((ws) => fromWebSocket(ws, input)));
export const layer = Layer.succeed(Service, Service.of({ open }));
export const fromWebSocket = (ws, input) =>
  Effect.gen(function* () {
    yield* waitOpen(ws, input);
    const messages = yield* Queue.bounded(128);
    const onMessage = (event) => {
      if (typeof event.data === 'string') return Queue.offerUnsafe(messages, event.data);
      const binary = binaryMessage(event.data);
      if (binary) return Queue.offerUnsafe(messages, binary);
      Queue.failCauseUnsafe(
        messages,
        Cause.fail(
          transportError('message', 'Unsupported WebSocket message payload', {
            url: input.url,
            kind: 'message',
          }),
        ),
      );
    };
    const onError = (event) => {
      Queue.failCauseUnsafe(
        messages,
        Cause.fail(
          transportError('message', `WebSocket error: ${eventMessage(event)}`, {
            url: input.url,
            kind: 'message',
          }),
        ),
      );
    };
    const onClose = (event) => {
      if (event.code === 1000 || event.code === 1005) return Queue.endUnsafe(messages);
      Queue.failCauseUnsafe(
        messages,
        Cause.fail(
          transportError('message', `WebSocket closed with code ${event.code}`, {
            url: input.url,
            kind: 'close',
          }),
        ),
      );
    };
    const cleanup = Effect.sync(() => {
      ws.removeEventListener('message', onMessage);
      ws.removeEventListener('error', onError);
      ws.removeEventListener('close', onClose);
    }).pipe(Effect.andThen(Queue.shutdown(messages)));
    ws.addEventListener('message', onMessage);
    ws.addEventListener('error', onError);
    ws.addEventListener('close', onClose);
    return {
      sendText: (message) =>
        Effect.try({
          try: () => ws.send(message),
          catch: (error) =>
            transportError(
              'sendText',
              error instanceof Error ? error.message : 'Failed to send WebSocket message',
              {
                url: input.url,
                kind: 'write',
              },
            ),
        }),
      messages: Stream.fromQueue(messages),
      close: cleanup.pipe(
        Effect.andThen(
          Effect.sync(() => {
            if (
              ws.readyState === globalThis.WebSocket.CLOSED ||
              ws.readyState === globalThis.WebSocket.CLOSING
            )
              return;
            ws.close(1000);
          }),
        ),
      ),
    };
  });
export const messageText = (message, decoder) =>
  typeof message === 'string' ? message : decoder.decode(message);
export const json = (input) => ({
  id: 'websocket-json',
  with: (patch) => json({ ...input, ...patch }),
  prepare: (prepareInput) =>
    Effect.gen(function* () {
      const parts = yield* HttpTransport.jsonRequestParts({
        ...prepareInput,
      });
      return {
        url: yield* webSocketUrl(parts.url),
        headers: parts.headers,
        message: input.encodeMessage(yield* input.toMessage(parts.jsonBody)),
      };
    }),
  frames: (prepared, _request, runtime) => {
    const webSocket = runtime.webSocket;
    if (!webSocket) {
      return Stream.fail(
        transportError('json', 'WebSocket JSON transport requires WebSocketExecutor.Service', {
          url: prepared.url,
          kind: 'websocket',
        }),
      );
    }
    const decoder = new TextDecoder();
    return Stream.unwrap(
      Effect.gen(function* () {
        const connection = yield* Effect.acquireRelease(
          webSocket.open({ url: prepared.url, headers: prepared.headers }),
          (connection) => connection.close,
        );
        yield* connection.sendText(prepared.message);
        return connection.messages.pipe(Stream.map((message) => messageText(message, decoder)));
      }),
    );
  },
});
export const jsonTransport = {
  id: 'websocket-json',
  with: json,
};
export const WebSocketExecutor = {
  Service,
  layer,
  open,
  fromWebSocket,
  messageText,
};
export const WebSocketTransport = {
  json,
  jsonTransport,
};
//# sourceMappingURL=websocket.js.map
