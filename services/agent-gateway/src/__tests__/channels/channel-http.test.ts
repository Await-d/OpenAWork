import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  channelFetch,
  ChannelFetchTimeoutError,
  CHANNEL_POLL_BACKOFF_MAX_MS,
  computeChannelRetryDelayMs,
} from '../../channels/channel-http.js';

describe('channelFetch', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('在超时后 abort 底层请求并抛 ChannelFetchTimeoutError', async () => {
    globalThis.fetch = ((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal) {
          signal.addEventListener('abort', () => {
            const abortErr = new Error('aborted');
            abortErr.name = 'AbortError';
            reject(abortErr);
          });
        }
      })) as typeof fetch;

    await expect(
      channelFetch('https://example.test/hang', { timeoutMs: 20 }),
    ).rejects.toBeInstanceOf(ChannelFetchTimeoutError);
  });

  it('成功响应直接透传，不受超时影响', async () => {
    const expected = new Response('ok', { status: 200 });
    globalThis.fetch = (() => Promise.resolve(expected)) as typeof fetch;

    const res = await channelFetch('https://example.test/ok', { timeoutMs: 1000 });
    expect(res.status).toBe(200);
  });

  it('调用方主动 abort 时按原始 AbortError 抛出，而非超时错误', async () => {
    globalThis.fetch = ((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        signal?.addEventListener('abort', () => {
          const abortErr = new Error('aborted');
          abortErr.name = 'AbortError';
          reject(abortErr);
        });
      })) as typeof fetch;

    const controller = new AbortController();
    const promise = channelFetch('https://example.test/cancel', {
      timeoutMs: 10_000,
      signal: controller.signal,
    });
    controller.abort();

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('透传调用方 signal 的 abort 状态到底层 fetch', async () => {
    const fetchSpy = vi.fn(
      (_url: string, _init?: RequestInit) => Promise.resolve(new Response('noop')),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const controller = new AbortController();
    controller.abort();

    await channelFetch('https://example.test/pre-aborted', {
      timeoutMs: 1000,
      signal: controller.signal,
    }).catch(() => undefined);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const firstCall = fetchSpy.mock.calls[0];
    const passedInit = firstCall ? firstCall[1] : undefined;
    expect(passedInit?.signal?.aborted).toBe(true);
  });
});

describe('computeChannelRetryDelayMs', () => {
  it('随 attempt 指数增长', () => {
    expect(computeChannelRetryDelayMs(1)).toBe(1000);
    expect(computeChannelRetryDelayMs(2)).toBe(2000);
    expect(computeChannelRetryDelayMs(3)).toBe(4000);
  });

  it('封顶到 CHANNEL_POLL_BACKOFF_MAX_MS', () => {
    expect(computeChannelRetryDelayMs(100)).toBe(CHANNEL_POLL_BACKOFF_MAX_MS);
  });

  it('对非法 attempt 退化为首次退避', () => {
    expect(computeChannelRetryDelayMs(0)).toBe(1000);
    expect(computeChannelRetryDelayMs(-5)).toBe(1000);
    expect(computeChannelRetryDelayMs(Number.NaN)).toBe(1000);
  });
});
