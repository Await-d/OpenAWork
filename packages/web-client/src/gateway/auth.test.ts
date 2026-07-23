import { afterEach, describe, expect, it, vi } from 'vitest';

import { login, logout, refreshAccessToken } from './auth.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('gateway auth helpers', () => {
  it('login 成功时返回 TokenPair', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({
          accessToken: 'access',
          refreshToken: 'refresh',
          expiresIn: '3600',
        }),
      } as unknown as Response;
    }) as typeof fetch;

    const result = await login('http://localhost:3000', 'a@example.com', 'secret');
    expect(result.accessToken).toBe('access');
  });

  it('login 失败时会保留后端 error 文案', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        json: async () => ({ error: 'invalid credentials' }),
      } as unknown as Response;
    }) as typeof fetch;

    await expect(login('http://localhost:3000', 'a@example.com', 'secret')).rejects.toThrow(
      'invalid credentials',
    );
  });

  it('refreshAccessToken 网络异常时会转换成中文网络错误', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('Failed to fetch');
    }) as typeof fetch;

    await expect(refreshAccessToken('http://localhost:3000', 'refresh')).rejects.toThrow(
      '网络异常，刷新凭证失败。',
    );
  });

  it('login 会读取 ApiErrorResponse.data.message', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        json: async () => ({
          name: 'BadRequest',
          data: { message: '请求体参数无效。', kind: 'Body' },
        }),
      } as unknown as Response;
    }) as typeof fetch;

    await expect(login('http://localhost:3000', 'a@example.com', 'secret')).rejects.toThrow(
      '请求体参数无效。',
    );
  });

  it('logout 成功时不抛错（best-effort 撤销）', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true }) as unknown as Response);
    globalThis.fetch = fetchMock as typeof fetch;
    await expect(logout('http://localhost:3000', 'access-1')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('logout 在网络异常时吞错（本地登出仍可继续）', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('Failed to fetch');
    }) as typeof fetch;
    await expect(logout('http://localhost:3000', 'access-1')).resolves.toBeUndefined();
  });

  it('logout 在请求挂起时经墙钟超时吞错（不永久 pending）', async () => {
    // 半开连接：fetch 永不主动响应，只在 fetchWithTimeout 注入的 signal 触发时
    // reject。用一个很短的真实超时，验证 logout 在墙钟到点后 settle（resolve，吞错），
    // 而不是永久 pending。超时走 AbortController + setTimeout，兼容 RN polyfill。
    globalThis.fetch = vi.fn((_input: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    }) as unknown as typeof fetch;

    await expect(logout('http://localhost:3000', 'access-1', 20)).resolves.toBeUndefined();
  });
});
