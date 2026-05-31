import { afterEach, describe, expect, it, vi } from 'vitest';

import { createHealthClient, isGatewayHealthy } from './health.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('createHealthClient', () => {
  it('健康检查成功时返回 true', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
      } as unknown as Response;
    }) as typeof fetch;

    const client = createHealthClient('http://localhost:3000');

    await expect(client.check()).resolves.toBe(true);
  });

  it('HTTP 非 2xx 时返回 false', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
      } as unknown as Response;
    }) as typeof fetch;

    const client = createHealthClient('http://localhost:3000');

    await expect(client.check()).resolves.toBe(false);
  });

  it('网络异常时返回 false', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('socket reset');
    }) as typeof fetch;

    await expect(isGatewayHealthy('http://localhost:3000')).resolves.toBe(false);
  });
});
