import { afterEach, describe, expect, it, vi } from 'vitest';

import { createHealthClient, isGatewayHealthy } from './health.js';

const originalFetch = globalThis.fetch;
const originalAbortSignalTimeout = (
  AbortSignal as typeof AbortSignal & { timeout?: typeof AbortSignal.timeout }
).timeout;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalAbortSignalTimeout) {
    (AbortSignal as typeof AbortSignal & { timeout?: typeof AbortSignal.timeout }).timeout =
      originalAbortSignalTimeout;
  } else {
    delete (AbortSignal as typeof AbortSignal & { timeout?: typeof AbortSignal.timeout }).timeout;
  }
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

  it('在无 AbortSignal.timeout 的 RN polyfill 环境下仍可探活成功', async () => {
    // React Native 的 AbortSignal 来自 abort-controller@3，没有 static timeout。
    // 旧实现一调用 AbortSignal.timeout 就 TypeError，被 catch 后恒返回 false。
    delete (AbortSignal as typeof AbortSignal & { timeout?: typeof AbortSignal.timeout }).timeout;

    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
      } as unknown as Response;
    }) as typeof fetch;

    await expect(isGatewayHealthy('http://192.168.1.20:3000')).resolves.toBe(true);
    expect(typeof AbortSignal.timeout).toBe('undefined');
  });

  it('挂起请求在 timeoutMs 后返回 false（不永久 pending）', async () => {
    delete (AbortSignal as typeof AbortSignal & { timeout?: typeof AbortSignal.timeout }).timeout;

    globalThis.fetch = vi.fn((_input: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    }) as unknown as typeof fetch;

    await expect(isGatewayHealthy('http://192.168.1.20:3000', { timeoutMs: 30 })).resolves.toBe(
      false,
    );
  });
});
