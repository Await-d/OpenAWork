import { afterEach, describe, expect, it, vi } from 'vitest';
import { OAuthClientImpl } from './client.js';

const OriginalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = OriginalFetch;
  vi.restoreAllMocks();
});

function makeClient() {
  return new OAuthClientImpl({
    serverMetadataUrl: 'https://auth.test/.well-known/oauth-authorization-server',
    redirectUri: 'https://app.test/callback',
    scopes: ['read'],
  });
}

describe('OAuthClientImpl HTTP timeouts', () => {
  it('discoverMetadata 给底层 fetch 传入超时 AbortSignal', async () => {
    const fetchSpy = vi.fn(
      (_url: string, _init?: RequestInit): Promise<Response> =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              issuer: 'https://auth.test',
              authorization_endpoint: 'https://auth.test/authorize',
              token_endpoint: 'https://auth.test/token',
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        ),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await makeClient().discoverMetadata();
    const init = fetchSpy.mock.calls[0]?.[1];
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('discoverMetadata 非 2xx 抛出带状态码的错误', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(new Response('nope', { status: 500 }))) as typeof fetch;
    await expect(makeClient().discoverMetadata()).rejects.toThrow(/500/);
  });
});
