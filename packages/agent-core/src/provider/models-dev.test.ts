import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OriginalFetch = globalThis.fetch;
let dir: string;
let prevXdgData: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'models-dev-test-'));
  // Point the platform adapter's data dir at the temp dir so the local
  // cache read/write in get()/fetchAndCache() never touches the real HOME.
  prevXdgData = process.env['XDG_DATA_HOME'];
  process.env['XDG_DATA_HOME'] = dir;
  vi.resetModules();
});

afterEach(() => {
  globalThis.fetch = OriginalFetch;
  vi.restoreAllMocks();
  if (prevXdgData === undefined) delete process.env['XDG_DATA_HOME'];
  else process.env['XDG_DATA_HOME'] = prevXdgData;
  rmSync(dir, { recursive: true, force: true });
});

describe('models-dev single-flight fetch', () => {
  it('concurrent get() cold-starts collapse onto one network fetch', async () => {
    let resolveFetch: ((r: Response) => void) | null = null;
    const payload = { openai: { id: 'openai', name: 'OpenAI', models: {} } };
    const fetchSpy = vi.fn(
      (_url: string, _init?: RequestInit): Promise<Response> =>
        new Promise<Response>((resolve) => {
          resolveFetch = (r) => resolve(r);
        }),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const mod = await import('./models-dev.js');

    // Three concurrent cold-start callers. No local cache exists (empty temp
    // dir), so all three fall through to the network path.
    const a = mod.get();
    const b = mod.get();
    const c = mod.get();

    // Allow the readLocalCache() microtasks to settle so all three reach
    // fetchAndCache() before we assert.
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchSpy).toHaveBeenCalledTimes(1);

    (resolveFetch as ((r: Response) => void) | null)?.(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const [ra, rb, rc] = await Promise.all([a, b, c]);
    expect(ra).toEqual(payload);
    expect(rb).toEqual(payload);
    expect(rc).toEqual(payload);
    // Still exactly one network request shared across all three callers.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('a failed fetch releases the in-flight slot so the next refresh retries', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let call = 0;
    const payload = { openai: { id: 'openai', name: 'OpenAI', models: {} } };
    const fetchSpy = vi.fn((_url: string, _init?: RequestInit): Promise<Response> => {
      call += 1;
      if (call === 1) return Promise.reject(new Error('boom'));
      return Promise.resolve(
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const mod = await import('./models-dev.js');

    // First refresh fails and must not wedge the in-flight slot.
    await mod.refresh();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(mod.getSync()).toBeNull();

    // Second refresh succeeds because the slot was released in finally.
    await mod.refresh();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(mod.getSync()).toEqual(payload);
    expect(warnSpy).toHaveBeenCalled();
  });
});
