import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { TelemetryManager } from './telemetry-manager.js';

const OriginalFetch = globalThis.fetch;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'telemetry-test-'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  globalThis.fetch = OriginalFetch;
  rmSync(dir, { recursive: true, force: true });
});

function makeManager() {
  return new TelemetryManager({
    enabled: true,
    endpoint: 'https://telemetry.test/v1/events',
    flushIntervalMs: 1_000_000, // effectively manual flush
    installIdPath: join(dir, 'install-id'),
  });
}

describe('TelemetryManager send timeout', () => {
  it('flush 时给底层 fetch 传入 AbortSignal', async () => {
    const fetchSpy = vi.fn((_url: string, _init?: RequestInit): Promise<Response> =>
      Promise.resolve(new Response(null, { status: 200 })),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const mgr = makeManager();
    mgr.track('app_start', {});
    await mgr.flush();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const init = fetchSpy.mock.calls[0]?.[1];
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    await mgr.shutdown();
  });

  it('send 失败（含超时 abort）时 flush 吞错不抛，且队列已清空', async () => {
    // Simulate the abort/transport failure path directly so the test stays
    // fast; the real timeout simply produces this same AbortError rejection.
    const fetchSpy = vi.fn((_url: string, _init?: RequestInit): Promise<Response> => {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      return Promise.reject(err);
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const mgr = makeManager();
    mgr.track('app_start', {});
    await expect(mgr.flush()).resolves.toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    // 队列已 splice，二次 flush 无事可做（不再调用 fetch）。
    await expect(mgr.flush()).resolves.toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('overlapping flush calls share the in-flight send (no double-splice race)', async () => {
    // The bug this guards against: two concurrent flushes used to splice the
    // *same* queue, so the second call got [] and uploaded nothing while the
    // first call's events were silently held in flight (and dropped on send
    // failure). With the single-flight guard, the second call must observe
    // the same in-flight promise and the queue must be drained exactly once.
    let resolveSend: (() => void) | null = null;
    const fetchSpy = vi.fn(
      (_url: string, _init?: RequestInit): Promise<Response> =>
        new Promise<Response>((resolve) => {
          resolveSend = () => resolve(new Response(null, { status: 200 }));
        }),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const mgr = makeManager();
    mgr.track('app_start', { id: 1 });
    mgr.track('tool_call', { id: 2 });

    // Kick off two overlapping flushes: the first starts the send, the
    // second must observe the in-flight promise and not call fetch again.
    const a = mgr.flush();
    const b = mgr.flush();

    // Both pending, only one fetch in flight.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const init = fetchSpy.mock.calls[0]?.[1];
    const body = JSON.parse(init?.body as string) as { events: unknown[] };
    expect(body.events).toHaveLength(2);

    // Resolve the send and wait for both flush promises to settle.
    (resolveSend as (() => void) | null)?.();
    await Promise.all([a, b]);

    // Still exactly one fetch — the second flush did not re-send.
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // A subsequent flush after the in-flight one drained finds an empty
    // queue and is a no-op.
    await mgr.flush();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('shutdown drains in-flight send and then re-flushes events tracked during it', async () => {
    // Two consecutive flush()es happen here (the in-flight one + the
    // second one shutdown() kicks off after draining), so we collect every
    // resolver instead of overwriting a single var.
    const resolvers: Array<() => void> = [];
    const fetchSpy = vi.fn(
      (_url: string, _init?: RequestInit): Promise<Response> =>
        new Promise<Response>((resolve) => {
          resolvers.push(() => resolve(new Response(null, { status: 200 })));
        }),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const mgr = makeManager();
    mgr.track('app_start', { id: 1 });

    // Start a flush, then track another event while the first is still in
    // flight. shutdown() must wait for the in-flight send to finish AND
    // then push the second event in a follow-up send.
    void mgr.flush();
    mgr.track('tool_call', { id: 2 });

    const shutdownPromise = mgr.shutdown();
    // First send still pending.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    // Resolve the in-flight send so shutdown() can proceed to its second
    // flush; once that fetch fires we resolve it too.
    resolvers[0]?.();
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
    resolvers[1]?.();
    await shutdownPromise;

    // Second send fired with the event tracked during the first send.
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const init2 = fetchSpy.mock.calls[1]?.[1];
    const body2 = JSON.parse(init2?.body as string) as { events: { properties: { id: number } }[] };
    expect(body2.events).toHaveLength(1);
    expect(body2.events[0]?.properties.id).toBe(2);
  });
});
