import { afterEach, describe, expect, it, vi } from 'vitest';

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
