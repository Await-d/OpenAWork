import { describe, expect, it } from 'vitest';
import {
  readFetchBody,
  readFetchSignal,
  withMockFetch,
} from '../../verification/task-verification-helpers.js';

describe('task verification fetch-body fixtures', () => {
  it('reads a Uint8Array body passed through fetch init', async () => {
    const payload = JSON.stringify({ messages: [{ role: 'user', content: 'resume' }] });
    const body = await readFetchBody('https://unit-test.invalid', {
      method: 'POST',
      body: new TextEncoder().encode(payload),
    });

    expect(body).toBe(payload);
  });

  it('reads a Request body when Effect fetch supplies the request directly', async () => {
    const payload = JSON.stringify({ messages: [{ role: 'user', content: 'resume' }] });
    const request = new Request('https://unit-test.invalid', {
      method: 'POST',
      body: payload,
    });

    await expect(readFetchBody(request)).resolves.toBe(payload);
  });

  it('preserves a direct Request AbortSignal for delayed response fixtures', () => {
    const controller = new AbortController();
    const request = new Request('https://unit-test.invalid', {
      method: 'POST',
      body: '{}',
      signal: controller.signal,
    });

    expect(readFetchSignal(request)).toBe(request.signal);
  });

  it('keeps a captured Effect fetch delegate pointed at the current mock', async () => {
    let capturedFetch: typeof fetch | undefined;

    await withMockFetch(
      async () => new Response('first'),
      async () => {
        capturedFetch = globalThis.fetch;
      },
    );
    await withMockFetch(
      async () => new Response('second'),
      async () => {
        expect(capturedFetch).toBeDefined();
        if (!capturedFetch) {
          throw new Error('expected an Effect fetch delegate');
        }
        await expect(capturedFetch('https://unit-test.invalid')).resolves.toHaveProperty(
          'status',
          200,
        );
        await expect((await capturedFetch('https://unit-test.invalid')).text()).resolves.toBe(
          'second',
        );
      },
    );
  });
});
