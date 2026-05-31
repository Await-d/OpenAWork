import { describe, expect, it, vi } from 'vitest';
import { InMemoryTokenStore } from './token-store.js';
import type { OAuthClient } from './client.js';
import type {
  OAuthClientRegistration,
  OAuthServerMetadata,
  OAuthTokenResponse,
  StoredToken,
} from './types.js';

const metadata = {} as OAuthServerMetadata;
const registration = {} as OAuthClientRegistration;

function expiredToken(): StoredToken {
  return {
    skillId: 'skill-1',
    serverId: 'server-1',
    accessToken: 'old-access',
    refreshToken: 'rotating-refresh-1',
    expiresAt: Date.now() - 1000,
    scope: 'a',
  };
}

describe('InMemoryTokenStore.autoRefresh concurrency', () => {
  it('并发刷新合并为单次 refreshToken 调用，两个调用拿到同一新 token', async () => {
    const store = new InMemoryTokenStore();
    store.save(expiredToken());

    let calls = 0;
    let resolveRefresh: (r: OAuthTokenResponse) => void = () => undefined;
    const client: OAuthClient = {
      refreshToken: vi.fn((_m, _r, _rt: string) => {
        calls += 1;
        return new Promise<OAuthTokenResponse>((resolve) => {
          resolveRefresh = resolve;
        });
      }),
    } as unknown as OAuthClient;

    const p1 = store.autoRefresh('skill-1', 'server-1', client, metadata, registration);
    const p2 = store.autoRefresh('skill-1', 'server-1', client, metadata, registration);

    resolveRefresh({
      access_token: 'new-access',
      token_type: 'Bearer',
      refresh_token: 'rotating-refresh-2',
      expires_in: 3600,
    });

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(calls).toBe(1);
    expect(r1?.accessToken).toBe('new-access');
    expect(r2?.accessToken).toBe('new-access');
    expect(r1).toEqual(r2);
  });

  it('刷新完成后，inflight 清空，下一次过期会再次刷新', async () => {
    const store = new InMemoryTokenStore();
    store.save(expiredToken());

    const client: OAuthClient = {
      refreshToken: vi.fn(
        (_m, _r, _rt: string): Promise<OAuthTokenResponse> =>
          Promise.resolve({
            access_token: 'a2',
            token_type: 'Bearer',
            refresh_token: 'r2',
            expires_in: -10,
          }),
      ),
    } as unknown as OAuthClient;

    const first = await store.autoRefresh('skill-1', 'server-1', client, metadata, registration);
    expect(first?.accessToken).toBe('a2');
    // expires_in 为负 → 仍过期 → 第二次会再刷新
    const second = await store.autoRefresh('skill-1', 'server-1', client, metadata, registration);
    expect(second?.accessToken).toBe('a2');
    expect((client.refreshToken as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });

  it('未过期时直接返回当前 token，不刷新', async () => {
    const store = new InMemoryTokenStore();
    store.save({ ...expiredToken(), expiresAt: Date.now() + 3_600_000 });
    const client: OAuthClient = {
      refreshToken: vi.fn(),
    } as unknown as OAuthClient;
    const r = await store.autoRefresh('skill-1', 'server-1', client, metadata, registration);
    expect(r?.accessToken).toBe('old-access');
    expect((client.refreshToken as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });
});
