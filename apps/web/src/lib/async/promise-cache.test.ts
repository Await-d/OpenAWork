/**
 * `createPromiseCache` 覆盖。
 *
 * 重点验证三条不变量——它们是 `use()` 不进入无限 Suspense 循环的前提：
 *   1. 同一 key 在重渲染之间返回**同一个 promise 实例**；
 *   2. `get` 返回时缓存已同步写入，且并发调用只触发一次取数；
 *   3. 失败即失效，不会把 rejection 缓存住。
 */

import { describe, expect, it, vi } from 'vitest';
import { createPromiseCache } from './promise-cache.js';

/** 手动控制结算时机的 promise，用于断言「未结算」状态下的行为。 */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
} {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** 让微任务队列排空（缓存内部用 `Promise.resolve().then` 启动取数）。 */
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('createPromiseCache', () => {
  it('同一 key 返回同一个 promise 实例（这是 use() 不循环的前提）', async () => {
    const cache = createPromiseCache<number>();
    const load = vi.fn(() => Promise.resolve(1));

    const first = cache.get('a', load);
    const second = cache.get('a', load);

    expect(first).toBe(second);
    await expect(first).resolves.toBe(1);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('值结算后仍返回同一个已结算 promise，不重复取数', async () => {
    const cache = createPromiseCache<string>();
    const load = vi.fn(() => Promise.resolve('v'));

    const first = cache.get('k', load);
    await first;

    expect(cache.get('k', load)).toBe(first);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('未结算期间的并发 get 共享同一个在途 promise', async () => {
    const cache = createPromiseCache<number>();
    const d = deferred<number>();
    const load = vi.fn(() => d.promise);

    const a = cache.get('x', load);
    const b = cache.get('x', load);
    expect(a).toBe(b);
    expect(load).not.toHaveBeenCalled(); // 取数被延到微任务，避免渲染期同步副作用

    d.resolve(42);
    await expect(a).resolves.toBe(42);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('不同 key 各自取数，互不干扰', async () => {
    const cache = createPromiseCache<string>();
    const loadA = vi.fn(() => Promise.resolve('a'));
    const loadB = vi.fn(() => Promise.resolve('b'));

    await expect(cache.get('a', loadA)).resolves.toBe('a');
    await expect(cache.get('b', loadB)).resolves.toBe('b');

    expect(loadA).toHaveBeenCalledTimes(1);
    expect(loadB).toHaveBeenCalledTimes(1);
    expect(cache.size).toBe(2);
  });

  it('取数失败时移除条目，使重试能真正重新取数', async () => {
    const cache = createPromiseCache<number>();
    const failing = vi.fn(() => Promise.reject(new Error('boom')));

    const first = cache.get('k', failing);
    await expect(first).rejects.toThrow('boom');
    await flush();
    expect(cache.size).toBe(0);

    const recovering = vi.fn(() => Promise.resolve(7));
    await expect(cache.get('k', recovering)).resolves.toBe(7);
    expect(recovering).toHaveBeenCalledTimes(1);
  });

  it('ttlMs 到期后重新取数', async () => {
    vi.useFakeTimers();
    try {
      const cache = createPromiseCache<number>({ ttlMs: 1000 });
      const load = vi.fn(() => Promise.resolve(1));

      const first = cache.get('k', load);
      await vi.advanceTimersByTimeAsync(0);
      await first;

      expect(cache.get('k', load)).toBe(first);

      await vi.advanceTimersByTimeAsync(1000);

      const second = cache.get('k', load);
      expect(second).not.toBe(first);
      await vi.advanceTimersByTimeAsync(0);
      await expect(second).resolves.toBe(1);
      expect(load).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('peek 只读查询，不触发取数', async () => {
    const cache = createPromiseCache<number>();
    const load = vi.fn(() => Promise.resolve(1));

    expect(cache.peek('missing')).toBeUndefined();
    expect(load).not.toHaveBeenCalled();

    const p = cache.get('k', load);
    expect(cache.peek('k')).toBe(p);
    await p;
  });

  it('prime 让已知值立即可用，且被 get 复用', async () => {
    const cache = createPromiseCache<number>();
    cache.prime('k', 99);

    const load = vi.fn(() => Promise.resolve(0));
    await expect(cache.get('k', load)).resolves.toBe(99);
    expect(load).not.toHaveBeenCalled();
  });

  it('invalidate / clear 移除条目', async () => {
    const cache = createPromiseCache<number>();
    const load = vi.fn(() => Promise.resolve(1));

    await cache.get('a', load);
    await cache.get('b', load);
    expect(cache.size).toBe(2);

    cache.invalidate('a');
    expect(cache.peek('a')).toBeUndefined();
    expect(cache.size).toBe(1);

    cache.clear();
    expect(cache.size).toBe(0);
  });

  it('条目被移除后，原 promise 结算不会把它「复活」', async () => {
    const cache = createPromiseCache<number>();
    const d = deferred<number>();

    const p = cache.get('k', () => d.promise);
    cache.invalidate('k');
    d.resolve(1);
    await p;
    await flush();

    expect(cache.peek('k')).toBeUndefined();
    expect(cache.size).toBe(0);
  });
});
