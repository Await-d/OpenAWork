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
});
