import { afterEach, describe, expect, it, vi } from 'vitest';

import { createCapabilitiesClient } from './capabilities.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('createCapabilitiesClient', () => {
  it('appends sessionId when provided', async () => {
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      calls.push(typeof input === 'string' ? input : input.toString());
      return {
        ok: true,
        json: async () => ({ capabilities: [] }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createCapabilitiesClient('http://localhost:3000');
    await client.list('token-123', 'session-abc');

    expect(calls).toEqual(['http://localhost:3000/capabilities?sessionId=session-abc']);
  });

  it('omits sessionId when not provided', async () => {
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      calls.push(typeof input === 'string' ? input : input.toString());
      return {
        ok: true,
        json: async () => ({ capabilities: [] }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createCapabilitiesClient('http://localhost:3000');
    await client.list('token-123');

    expect(calls).toEqual(['http://localhost:3000/capabilities']);
  });
});
