import { describe, expect, it, vi } from 'vitest';
import { createPreviewConcurrencyGate } from './preview-concurrency-gate.js';

const KEY = 'user-1::/workspace/demo';

function createGate(overrides: Partial<Parameters<typeof createPreviewConcurrencyGate>[0]> = {}) {
  return createPreviewConcurrencyGate({
    limit: 2,
    maxQueue: 2,
    acquireTimeoutMs: 50,
    ...overrides,
  });
}

describe('createPreviewConcurrencyGate', () => {
  it('未达上限时立即放行', async () => {
    const gate = createGate();
    const first = await gate.acquire(KEY);
    const second = await gate.acquire(KEY);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(gate.inFlight(KEY)).toBe(2);
  });

  it('不同 key 互不影响', async () => {
    const gate = createGate();
    await gate.acquire(KEY);
    await gate.acquire(KEY);

    const other = await gate.acquire('user-2::/workspace/demo');
    expect(other.ok).toBe(true);
  });

  it('超过上限时排队，前一个释放后才放行', async () => {
    const gate = createGate();
    const first = await gate.acquire(KEY);
    await gate.acquire(KEY);

    let settled = false;
    const queued = gate.acquire(KEY).then((result) => {
      settled = true;
      return result;
    });

    // 还没释放：必须仍在排队
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(gate.queued(KEY)).toBe(1);

    first.release?.();
    const result = await queued;
    expect(result.ok).toBe(true);
    expect(gate.inFlight(KEY)).toBe(2);
  });

  it('队列满时直接判定不可用，并给出 retryAfterMs', async () => {
    const gate = createGate({ maxQueue: 1 });
    await gate.acquire(KEY);
    await gate.acquire(KEY);

    const pending = gate.acquire(KEY); // 占满队列
    await Promise.resolve();
    expect(gate.queued(KEY)).toBe(1);

    const rejected = await gate.acquire(KEY);
    expect(rejected.ok).toBe(false);
    expect(rejected.retryAfterMs).toBeGreaterThan(0);

    // 清理：让挂起用例结束
    void pending.catch(() => undefined);
  });

  it('排队超时后把等待者摘出队列，不占槽位', async () => {
    vi.useFakeTimers();
    try {
      const gate = createGate({ acquireTimeoutMs: 30 });
      await gate.acquire(KEY);
      await gate.acquire(KEY);

      const pending = gate.acquire(KEY);
      expect(gate.queued(KEY)).toBe(1);

      vi.advanceTimersByTime(40);
      const result = await pending;
      expect(result.ok).toBe(false);
      expect(gate.queued(KEY)).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('并发归零且队列为空时删除 key，空闲不残留条目', async () => {
    const gate = createGate();
    const first = await gate.acquire(KEY);
    const second = await gate.acquire(KEY);
    expect(gate.size()).toBe(1);

    first.release?.();
    expect(gate.size()).toBe(1);
    second.release?.();
    expect(gate.size()).toBe(0);
  });

  it('release 之后槽位可被下一位等待者占用', async () => {
    const gate = createGate({ limit: 1, maxQueue: 1 });
    const held = await gate.acquire(KEY);
    const queued = gate.acquire(KEY);
    await Promise.resolve();

    held.release?.();
    const result = await queued;
    expect(result.ok).toBe(true);

    result.release?.();
    expect(gate.size()).toBe(0);
  });

  it('maxKeys 兜底：key 洪泛下不会无界增长', async () => {
    const gate = createGate({ maxKeys: 2 });
    await gate.acquire('a');
    await gate.acquire('b');
    const third = await gate.acquire('c');

    expect(gate.size()).toBeLessThanOrEqual(2);
    // 全是在途请求时应拒新 key，而不是驱逐在途请求。
    expect(third.ok).toBe(false);
  });

  it('不会因 key 淘汰而让在途请求的等待者永远挂起', async () => {
    const gate = createGate({ limit: 1, maxQueue: 1, maxKeys: 1 });
    const held = await gate.acquire('a');
    const pending = gate.acquire('a'); // a 的队列里有个等待者
    await Promise.resolve();
    expect(gate.queued('a')).toBe(1);

    // 洪泛另一个 key：若实现驱逐了 'a'，pending 将永不 settle。
    const other = await gate.acquire('b');
    expect(other.ok).toBe(false);

    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    held.release?.();
    await pending;
    expect(settled).toBe(true);
  });

  it('reset 清空全部状态', async () => {
    const gate = createGate();
    await gate.acquire(KEY);
    await gate.acquire(KEY);
    expect(gate.inFlight(KEY)).toBe(2);

    gate.reset();
    expect(gate.inFlight(KEY)).toBe(0);
    expect(gate.size()).toBe(0);
  });
});
