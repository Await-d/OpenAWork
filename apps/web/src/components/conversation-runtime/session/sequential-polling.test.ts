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
});
