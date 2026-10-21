import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HttpError } from '../session/sessions.js';
import { withTokenRefresh } from './token-refresh.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('withTokenRefresh', () => {
  it('无 access token 时抛出中文 401 错误', async () => {
    const store = {
      getAccessToken: () => null,
      getRefreshToken: () => null,
      setTokens: vi.fn(),
      clearAuth: vi.fn(),
    };

    try {
      await withTokenRefresh('http://localhost:3000', store, async () => 'ok');
      throw new Error('expected withTokenRefresh to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).status).toBe(401);
      expect((error as Error).message).toBe('当前未登录或访问令牌已失效。');
    }
  });
});

describe('acquireRefresh', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('并发调用只触发一次底层刷新请求', async () => {
    const { acquireRefresh } = await import('./token-refresh.js');
    const { refreshAccessToken } = await import('./auth.js');

    const refreshSpy = vi
      .spyOn(await import('./auth.js'), 'refreshAccessToken')
      .mockImplementation(async () => {
        // 模拟网络延迟，确保并发窗口
        await new Promise((r) => setTimeout(r, 50));
        return { accessToken: 'new-access', refreshToken: 'new-refresh', expiresIn: '15m' };
      });

    void refreshSpy;
    void refreshAccessToken;

    const store = {
      getAccessToken: () => 'old-access',
      getRefreshToken: () => 'old-refresh',
      setTokens: vi.fn(),
      clearAuth: vi.fn(),
    };

    // 并发 3 次调用
    const results = await Promise.all([
      acquireRefresh('http://localhost:3000', store),
      acquireRefresh('http://localhost:3000', store),
      acquireRefresh('http://localhost:3000', store),
    ]);

    // 三个调用都应该返回同一个新 token
    expect(results[0]).toBe('new-access');
    expect(results[1]).toBe('new-access');
    expect(results[2]).toBe('new-access');
    // setTokens 只应被调用一次（单飞）
    expect(store.setTokens).toHaveBeenCalledTimes(1);
  });

  it('无 refresh token 时返回 null 并清除认证', async () => {
    const { acquireRefresh } = await import('./token-refresh.js');

    const store = {
      getAccessToken: () => 'access',
      getRefreshToken: () => null,
      setTokens: vi.fn(),
      clearAuth: vi.fn(),
    };

    const result = await acquireRefresh('http://localhost:3000', store);
    expect(result).toBeNull();
    expect(store.clearAuth).toHaveBeenCalledOnce();
  });

  it('瞬态刷新失败保留登录态并抛出原始错误（不再清 auth）', async () => {
    const { acquireRefresh } = await import('./token-refresh.js');

    vi.spyOn(await import('./auth.js'), 'refreshAccessToken').mockRejectedValue(
      new Error('网络异常，刷新凭证失败。'),
    );

    const store = {
      getAccessToken: () => 'old-access',
      getRefreshToken: () => 'old-refresh',
      setTokens: vi.fn(),
      clearAuth: vi.fn(),
    };

    await expect(acquireRefresh('http://localhost:3000', store)).rejects.toThrow(
      '网络异常，刷新凭证失败。',
    );
    expect(store.clearAuth).not.toHaveBeenCalled();
    expect(store.setTokens).not.toHaveBeenCalled();
  });

  it('refresh token 被服务端拒绝（401）时清除登录态并返回 null', async () => {
    const { acquireRefresh } = await import('./token-refresh.js');
    const authModule = await import('./auth.js');

    vi.spyOn(authModule, 'refreshAccessToken').mockRejectedValue(
      new authModule.AuthRequestRejectedError('Invalid or expired refresh token', 401),
    );

    const store = {
      getAccessToken: () => 'old-access',
      getRefreshToken: () => 'old-refresh',
      setTokens: vi.fn(),
      clearAuth: vi.fn(),
    };

    await expect(acquireRefresh('http://localhost:3000', store)).resolves.toBeNull();
    expect(store.clearAuth).toHaveBeenCalledOnce();
    expect(store.setTokens).not.toHaveBeenCalled();
  });

  it('瞬态失败后单飞 promise 复位，下一次调用会重新发起刷新', async () => {
    const { acquireRefresh } = await import('./token-refresh.js');

    const refreshSpy = vi
      .spyOn(await import('./auth.js'), 'refreshAccessToken')
      .mockRejectedValueOnce(new Error('网络异常，刷新凭证失败。'))
      .mockResolvedValueOnce({
        accessToken: 'fresh-access',
        refreshToken: 'fresh-refresh',
        expiresIn: '15m',
      });

    const store = {
      getAccessToken: () => 'old-access',
      getRefreshToken: () => 'old-refresh',
      setTokens: vi.fn(),
      clearAuth: vi.fn(),
    };

    await expect(acquireRefresh('http://localhost:3000', store)).rejects.toThrow(
      '网络异常，刷新凭证失败。',
    );
    await expect(acquireRefresh('http://localhost:3000', store)).resolves.toBe('fresh-access');
    expect(refreshSpy).toHaveBeenCalledTimes(2);
    expect(store.clearAuth).not.toHaveBeenCalled();
  });

  it('401 被动刷新遇瞬态失败时抛出瞬态错误，而不是「登录态已过期」', async () => {
    const { withTokenRefresh } = await import('./token-refresh.js');
    const { HttpError } = await import('../session/sessions.js');

    vi.spyOn(await import('./auth.js'), 'refreshAccessToken').mockRejectedValue(
      new Error('网络异常，刷新凭证失败。'),
    );

    const store = {
      getAccessToken: () => 'stale-access',
      getRefreshToken: () => 'old-refresh',
      setTokens: vi.fn(),
      clearAuth: vi.fn(),
    };

    await expect(
      withTokenRefresh('http://localhost:3000', store, async () => {
        throw new HttpError('unauthorized', 401);
      }),
    ).rejects.toThrow('网络异常，刷新凭证失败。');
    expect(store.clearAuth).not.toHaveBeenCalled();
  });
});
