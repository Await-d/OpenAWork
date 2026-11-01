import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { runAttachEventStream } from '../../routes/attach-event-stream.js';
import type { ReplayEvent } from '../../session/session-run-event-replay.js';
import { RUN_EVENT_MAX_BYTES, RunEventSizeError } from '../../session/run-event-size-budget.js';

const event = (cursor: number): ReplayEvent => ({
  event: { type: 'text_delta', delta: String(cursor) },
  cursor,
  clientRequestId: 'request',
});
function harness() {
  const response = Object.assign(new EventEmitter(), {
    destroyed: false,
    writableEnded: false,
    write: vi.fn((_frame: string) => true),
    end: vi.fn(() => {
      response.writableEnded = true;
    }),
    destroy: vi.fn(() => {
      response.destroyed = true;
    }),
  });
  const request = Object.assign(new EventEmitter(), { aborted: false });
  const encode = (entry: ReplayEvent) =>
    `id: ${entry.cursor}\ndata: ${JSON.stringify(entry.event)}\n\n`;
  return {
    response,
    request,
    input: {
      reply: { raw: response } as unknown as FastifyReply,
      request: { raw: request } as unknown as FastifyRequest,
      after: 0,
      encode,
    },
  };
}
afterEach(() => vi.useRealTimers());

describe('attach event stream pump', () => {
  it('rejects an oversized live event before encoding and reports an error without advancing the cursor', async () => {
    const h = harness();
    const encode = vi.fn(h.input.encode);
    const unsubscribe = vi.fn();
    let emit: ((entry: ReplayEvent) => void) | undefined;
    const pending = runAttachEventStream({
      ...h.input,
      encode,
      createReader: () => () => ({ events: [], nextCursor: 0, more: false }),
      subscribe: (callback) => {
        emit = callback;
        return unsubscribe;
      },
    });
    await Promise.resolve();
    emit?.({
      ...event(1),
      event: { type: 'text_delta', delta: 'x'.repeat(RUN_EVENT_MAX_BYTES + 1) },
    });
    expect(await pending).toMatchObject({ reason: 'event_too_large', lastCursor: 0 });
    expect(encode).not.toHaveBeenCalled();
    expect(h.response.write.mock.calls[0]?.[0]).toContain('ATTACH_EVENT_TOO_LARGE');
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('an oversized replay is not reported as a successful clean EOF', async () => {
    const h = harness();
    const result = await runAttachEventStream({
      ...h.input,
      createReader: () => () => {
        throw new RunEventSizeError();
      },
      endFrame: () => 'event: attach-replay-end\n\n',
    });
    expect(result).toMatchObject({ reason: 'event_too_large', lastCursor: 0 });
    expect(h.response.write.mock.calls.map(([frame]) => frame).join('')).toContain(
      'ATTACH_EVENT_TOO_LARGE',
    );
    expect(h.response.write.mock.calls.map(([frame]) => frame).join('')).not.toContain(
      'attach-replay-end',
    );
  });

  it('yields between replay pages and deduplicates concurrent live events', async () => {
    const h = harness();
    let emit: ((entry: ReplayEvent) => void) | undefined;
    let page = 0;
    const unsubscribe = vi.fn();
    const read = vi.fn(() => {
      page += 1;
      if (page === 1) {
        setImmediate(() => {
          emit?.(event(2));
          emit?.(event(3));
        });
        return { events: [event(1)], nextCursor: 1, more: true };
      }
      return { events: [event(2)], nextCursor: 2, more: false };
    });
    const result = await runAttachEventStream({
      ...h.input,
      createReader: () => read,
      subscribe: (callback) => {
        emit = callback;
        return unsubscribe;
      },
      endsStream: (entry) => entry.cursor === 3,
    });
    expect(h.response.write.mock.calls.map(([frame]) => frame.match(/id: (\d+)/)?.[1])).toEqual([
      '1',
      '2',
      '3',
    ]);
    expect(result).toMatchObject({ reason: 'terminal_event', lastCursor: 3 });
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(h.response.listenerCount('close')).toBe(0);
    expect(h.request.listenerCount('aborted')).toBe(0);
  });

  it('write=false waits for drain without resending or treating it as failure', async () => {
    const h = harness();
    h.response.write.mockReturnValueOnce(false);
    const pending = runAttachEventStream({
      ...h.input,
      createReader: () => () => ({ events: [event(1), event(2)], nextCursor: 2, more: false }),
    });
    expect(h.response.write).toHaveBeenCalledTimes(1);
    h.response.emit('drain');
    expect(await pending).toMatchObject({ reason: 'replay_complete', lastCursor: 2 });
    expect(h.response.write).toHaveBeenCalledTimes(2);
    expect(h.response.listenerCount('drain')).toBe(0);
  });

  it.each(['close', 'error'] as const)(
    'response %s cancels backpressure and unsubscribes without another query',
    async (kind) => {
      const h = harness();
      const unsubscribe = vi.fn();
      h.response.write.mockReturnValue(false);
      const read = vi.fn(() => ({ events: [event(1)], nextCursor: 1, more: true }));
      const pending = runAttachEventStream({
        ...h.input,
        createReader: () => read,
        subscribe: () => unsubscribe,
      });
      h.response.emit(kind);
      const result = await pending;
      expect(result.reason).toBe(kind === 'close' ? 'client_closed' : 'response_error');
      expect(read).toHaveBeenCalledOnce();
      expect(unsubscribe).toHaveBeenCalledOnce();
      expect(h.response.listenerCount('drain')).toBe(0);
      expect(h.response.listenerCount('error')).toBe(0);
    },
  );

  it('drain timeout ends only the stalled subscription', async () => {
    vi.useFakeTimers();
    const h = harness();
    const unsubscribe = vi.fn();
    h.response.write.mockReturnValue(false);
    const pending = runAttachEventStream({
      ...h.input,
      createReader: () => () => ({ events: [event(1)], nextCursor: 1, more: false }),
      subscribe: () => unsubscribe,
    });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await pending).toMatchObject({ reason: 'backpressure_timeout' });
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a replay read exception releases the listener and heartbeat lifecycle', async () => {
    const h = harness();
    const unsubscribe = vi.fn();
    const result = await runAttachEventStream({
      ...h.input,
      subscribe: () => unsubscribe,
      createReader: () => {
        throw new Error('read failed');
      },
    });
    expect(result.reason).toBe('replay_failed');
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(h.response.end).toHaveBeenCalledOnce();
  });

  it('bounds live buffering while replay is blocked on a slow client', async () => {
    const h = harness();
    let emit: ((entry: ReplayEvent) => void) | undefined;
    const unsubscribe = vi.fn();
    h.response.write.mockReturnValue(false);
    const pending = runAttachEventStream({
      ...h.input,
      createReader: () => () => ({ events: [event(1)], nextCursor: 1, more: false }),
      subscribe: (callback) => {
        emit = callback;
        return unsubscribe;
      },
    });
    for (let index = 2; index < 2100; index += 1) emit?.(event(index));
    expect(await pending).toMatchObject({ reason: 'pending_overflow' });
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(h.response.write).toHaveBeenCalledOnce();
  });
});
