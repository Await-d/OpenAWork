// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startSequentialPolling } from './sequential-polling.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('startSequentialPolling', () => {
  it('取消轮询时吞掉请求层包装后的取消错误', async () => {
    vi.useFakeTimers();
    const run = vi.fn(
      (signal: AbortSignal) =>
        new Promise<void>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => reject(new Error('signal is aborted without reason')),
            { once: true },
          );
        }),
    );

    const polling = startSequentialPolling({ intervalMs: 3_000, run });
    polling.cancel();
    await Promise.resolve();

    expect(run).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('单拍失败不再向外抛出，并按指数退避重试（成功即复位）', async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const run = vi.fn(async () => {
      attempts += 1;
      if (attempts <= 2) {
        throw new Error(`boom-${attempts}`);
      }
    });

    const polling = startSequentialPolling({ intervalMs: 1_000, run });
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);

    // 失败 1 次后按 1×2^0 = 1s 排下一拍
    await vi.advanceTimersByTimeAsync(1_000);
    expect(run).toHaveBeenCalledTimes(2);

    // 失败 2 次后按 1×2^1 = 2s 排下一拍
    await vi.advanceTimersByTimeAsync(2_000);
    expect(run).toHaveBeenCalledTimes(3);

    // 成功后复位回 1s
    await vi.advanceTimersByTimeAsync(1_000);
    expect(run).toHaveBeenCalledTimes(4);

    polling.cancel();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('连续失败时退避封顶到 15s（默认上限）', async () => {
    vi.useFakeTimers();
    const run = vi.fn(async () => {
      throw new Error('boom');
    });

    const polling = startSequentialPolling({ intervalMs: 1_000, run });
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(4_000);
    await vi.advanceTimersByTimeAsync(8_000);
    expect(run).toHaveBeenCalledTimes(5);

    // 下一拍应被封顶在 15s（而非 16s）
    await vi.advanceTimersByTimeAsync(14_999);
    expect(run).toHaveBeenCalledTimes(5);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(6);

    polling.cancel();
    expect(vi.getTimerCount()).toBe(0);
  });
});
