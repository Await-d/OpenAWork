import Fastify from 'fastify';
import { get, type IncomingMessage } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { runAttachEventStream } from '../../routes/attach-event-stream.js';
import type { ReplayEvent } from '../../session/session-run-event-replay.js';

const event = (cursor: number): ReplayEvent => ({
  event: { type: 'text_delta', delta: 'x'.repeat(8192) },
  cursor,
  clientRequestId: 'test',
});

describe('attach real HTTP connection isolation', () => {
  it('a paused SSE reader does not block ordinary HTTP and disconnect releases its subscription', async () => {
    const app = Fastify();
    const unsubscribe = vi.fn();
    let queries = 0;
    let completed: ReturnType<typeof runAttachEventStream> | undefined;
    app.get('/ping', async () => ({ ok: true }));
    app.get('/stream', async (request, reply) => {
      reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream' });
      completed = runAttachEventStream({
        request,
        reply,
        after: 0,
        subscribe: () => unsubscribe,
        createReader: () => (after) => {
          queries += 1;
          return {
            events: Array.from({ length: 128 }, (_, index) => event(after + index + 1)),
            nextCursor: after + 128,
            more: true,
          };
        },
        encode: (entry) => `id: ${entry.cursor}\ndata: ${JSON.stringify(entry.event)}\n\n`,
      });
      await completed;
    });
    const base = await app.listen({ host: '127.0.0.1', port: 0 });
    const request = get(`${base}/stream`);
    request.on('error', () => undefined);
    try {
      const response = await new Promise<IncomingMessage>((resolve, reject) => {
        request.once('response', resolve);
        request.once('error', reject);
      });
      response.pause();
      const ping = await fetch(`${base}/ping`, { signal: AbortSignal.timeout(2000) });
      expect(await ping.json()).toEqual({ ok: true });
      expect(unsubscribe).not.toHaveBeenCalled();
      response.destroy();
      request.destroy();
      await vi.waitFor(() => expect(unsubscribe).toHaveBeenCalledOnce());
      const readsAtClose = queries;
      expect(['client_closed', 'client_aborted']).toContain((await completed)?.reason);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(queries).toBe(readsAtClose);
    } finally {
      request.destroy();
      await app.close();
    }
  });
});
