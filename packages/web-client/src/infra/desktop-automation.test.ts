import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDesktopAutomationClient } from './desktop-automation.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('createDesktopAutomationClient', () => {
  it('getStatus 成功时返回 enabled', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({ enabled: true }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createDesktopAutomationClient('http://localhost:3000');
    const result = await client.getStatus('token-1');

    expect(result.enabled).toBe(true);
  });

  it('start 失败时会保留后端 error 文案', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 409,
        json: async () => ({ error: 'desktop automation already running' }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createDesktopAutomationClient('http://localhost:3000');

    await expect(client.start('token-1')).rejects.toThrow('desktop automation already running');
  });

  it('click 网络异常时会转换成中文网络错误', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('Failed to fetch');
    }) as typeof fetch;

    const client = createDesktopAutomationClient('http://localhost:3000');

    await expect(client.click('token-1', '#submit')).rejects.toThrow(
      '网络异常，执行桌面自动化点击失败。',
    );
  });

  it('start 会读取 ApiErrorResponse.data.message', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 400,
        json: async () => ({
          name: 'BadRequest',
          data: { message: '请求体参数无效。', kind: 'Body' },
        }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createDesktopAutomationClient('http://localhost:3000');

    await expect(client.start('token-1')).rejects.toThrow('请求体参数无效。');
  });
});
