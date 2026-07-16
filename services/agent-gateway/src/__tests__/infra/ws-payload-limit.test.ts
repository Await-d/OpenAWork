import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import {
  DEFAULT_WS_MAX_PAYLOAD_BYTES,
  resolveWsMaxPayloadBytes,
} from '../../infra/ws-payload-limit.js';

const ENV_KEY = 'OPENAWORK_WS_MAX_PAYLOAD_BYTES';

describe('resolveWsMaxPayloadBytes', () => {
  let original: string | undefined;

  beforeEach(() => {
    original = process.env[ENV_KEY];
    delete process.env[ENV_KEY];
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = original;
    }
  });

  it('returns the 16 MiB default when the override is unset', () => {
    expect(resolveWsMaxPayloadBytes()).toBe(DEFAULT_WS_MAX_PAYLOAD_BYTES);
    expect(DEFAULT_WS_MAX_PAYLOAD_BYTES).toBe(16 * 1024 * 1024);
  });

  it('honors a positive override (floored)', () => {
    process.env[ENV_KEY] = '2097152.9';
    expect(resolveWsMaxPayloadBytes()).toBe(2_097_152);
  });

  it('treats non-positive / non-finite overrides as ws-uncapped (0 = disabled)', () => {
    process.env[ENV_KEY] = '0';
    expect(resolveWsMaxPayloadBytes()).toBe(0);
    process.env[ENV_KEY] = '-5';
    expect(resolveWsMaxPayloadBytes()).toBe(0);
    process.env[ENV_KEY] = 'not-a-number';
    expect(resolveWsMaxPayloadBytes()).toBe(0);
  });

  it('falls back to the default for an empty / whitespace override', () => {
    process.env[ENV_KEY] = '   ';
    expect(resolveWsMaxPayloadBytes()).toBe(DEFAULT_WS_MAX_PAYLOAD_BYTES);
  });
});

interface InjectedClient {
  send: (data: string) => void;
  on: (event: 'message' | 'close', cb: (arg: unknown) => void) => void;
}

type WebsocketCapableApp = FastifyInstance & {
  injectWS: (path?: string) => Promise<unknown>;
};

type WebsocketRouteRegistrar = {
  get: (
    path: string,
    opts: { websocket: true },
    handler: (socket: {
      send: (data: string) => void;
      on: (event: string, cb: (data: Buffer) => void) => void;
    }) => void,
  ) => FastifyInstance;
};

describe('@fastify/websocket maxPayload wiring', () => {
  let app: WebsocketCapableApp;
  const cap = 1024;

  beforeEach(async () => {
    app = Fastify() as WebsocketCapableApp;
    // Mirror index.ts: register with an explicit inbound-frame ceiling.
    await app.register(websocket, { options: { maxPayload: cap } });
    (app as WebsocketRouteRegistrar).get(
      '/ws-echo',
      { websocket: true },
      (socket: { send: (d: string) => void; on: (e: string, cb: (d: Buffer) => void) => void }) => {
        socket.on('message', (raw: Buffer) => {
          socket.send(raw.toString());
        });
      },
    );
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('echoes a frame that fits under the configured maxPayload', async () => {
    const client = (await app.injectWS('/ws-echo')) as unknown as InjectedClient;
    const echoed = await new Promise<string>((resolve) => {
      client.on('message', (data) => resolve(String(data)));
      client.send('hello');
    });
    expect(echoed).toBe('hello');
  });

  it('closes the socket with code 1009 when a frame exceeds maxPayload', async () => {
    const client = (await app.injectWS('/ws-echo')) as unknown as InjectedClient;
    const closeCode = await new Promise<number>((resolve) => {
      client.on('close', (code) => resolve(Number(code)));
      // Over the 1024-byte ceiling: ws rejects with close code 1009 (message too big).
      client.send('x'.repeat(cap + 1));
    });
    expect(closeCode).toBe(1009);
  });
});
