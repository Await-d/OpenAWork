import { afterEach, describe, expect, it, vi } from 'vitest';

import { getPairingQr, loginWithDesktopDefault, loginWithPairingToken } from './pairing.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('pairing gateway helpers', () => {
  it('getPairingQr 成功时返回二维码载荷', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({
          dataUrl: 'data:image/png;base64,abc',
          expiresAt: 1,
          hostUrl: 'http://localhost:3000',
          qrData: 'pairing-token',
        }),
      } as unknown as Response;
    }) as typeof fetch;

    const result = await getPairingQr('http://localhost:3000');
    expect(result.qrData).toBe('pairing-token');
  });

  it('getPairingQr 失败时会保留后端 error 文案', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        json: async () => ({ error: 'pairing unavailable' }),
      } as unknown as Response;
    }) as typeof fetch;

    await expect(getPairingQr('http://localhost:3000')).rejects.toThrow('pairing unavailable');
  });

  it('loginWithDesktopDefault 网络异常时会转换成中文网络错误', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('Failed to fetch');
    }) as typeof fetch;

    await expect(loginWithDesktopDefault('http://localhost:3000', 'desktop-token')).rejects.toThrow(
      '网络异常，桌面默认登录失败。',
    );
  });

  it('loginWithPairingToken 失败时会保留后端 error 文案', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        json: async () => ({ error: 'pairing token expired' }),
      } as unknown as Response;
    }) as typeof fetch;

    await expect(loginWithPairingToken('http://localhost:3000', 'pairing-token')).rejects.toThrow(
      'pairing token expired',
    );
  });

  it('getPairingQr 会读取 ApiErrorResponse.data.message', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        json: async () => ({
          name: 'BadRequest',
          data: { message: '请求参数无效。', kind: 'Query' },
        }),
      } as unknown as Response;
    }) as typeof fetch;

    await expect(getPairingQr('http://localhost:3000')).rejects.toThrow('请求参数无效。');
  });
});
