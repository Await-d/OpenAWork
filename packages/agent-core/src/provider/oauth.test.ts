import { afterEach, describe, expect, it, vi } from 'vitest';
import { OAuthFlowManagerImpl } from './oauth.js';
import type { OAuthConfig } from './types.js';

const OriginalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = OriginalFetch;
  vi.restoreAllMocks();
});

const config: OAuthConfig = {
  enabled: true,
  clientId: 'client-1',
  tokenUrl: 'https://auth.test/token',
  revokeUrl: 'https://auth.test/revoke',
};

describe('OAuthFlowManagerImpl token endpoints', () => {
  it('refreshToken 给底层 fetch 传入超时 AbortSignal 并解析新 token', async () => {
    const fetchSpy = vi.fn(
      (_url: string, _init?: RequestInit): Promise<Response> =>
        Promise.resolve(
          new Response(JSON.stringify({ access_token: 'new-a', refresh_token: 'new-r' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        ),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const mgr = new OAuthFlowManagerImpl();
    const result = await mgr.refreshToken(config, { accessToken: 'old', refreshToken: 'r1' });
    expect(result.accessToken).toBe('new-a');
    const init = fetchSpy.mock.calls[0]?.[1];
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('refreshToken 在非 2xx 时抛出带状态码的错误', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(new Response('nope', { status: 400 }))) as typeof fetch;
    const mgr = new OAuthFlowManagerImpl();
    await expect(
      mgr.refreshToken(config, { accessToken: 'old', refreshToken: 'r1' }),
    ).rejects.toThrow(/400/);
  });

  it('revokeToken 给底层 fetch 传入超时 AbortSignal', async () => {
    const fetchSpy = vi.fn(
      (_url: string, _init?: RequestInit): Promise<Response> =>
        Promise.resolve(new Response(null, { status: 200 })),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const mgr = new OAuthFlowManagerImpl();
    await mgr.revokeToken(config, { accessToken: 'a1', refreshToken: 'r1' });
    expect(fetchSpy).toHaveBeenCalled();
    for (const call of fetchSpy.mock.calls) {
      const init = call[1] as RequestInit | undefined;
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
  });
});
