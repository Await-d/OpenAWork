import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScheduleManagerImpl } from './index.js';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('ScheduleManagerImpl runTask error isolation', () => {
  it('interval 任务 handler 持续 reject 时不抛未捕获异常，且继续按周期触发', async () => {
    vi.useFakeTimers();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let calls = 0;
    const handler = vi.fn(async () => {
      calls += 1;
      throw new Error('task boom');
    });

    const mgr = new ScheduleManagerImpl();
    mgr.start();
    mgr.add({ name: 't1', kind: 'interval', expression: '1000', handler, enabled: true });

    await vi.advanceTimersByTimeAsync(1000);
    const afterFirst = calls;
    expect(afterFirst).toBeGreaterThanOrEqual(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toBeGreaterThan(afterFirst);
    expect(errorSpy).toHaveBeenCalled();

    mgr.stop();
  });

  it('once 任务 handler reject 时仍完成清理（禁用 + 不再触发）', async () => {
    vi.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z') });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const handler = vi.fn(async () => {
      throw new Error('once boom');
    });

    const mgr = new ScheduleManagerImpl();
    mgr.start();
    const target = Date.now() + 500;
    mgr.add({
      name: 't-once',
      kind: 'once',
      expression: new Date(target).toISOString(),
      handler,
      enabled: true,
    });

    await vi.advanceTimersByTimeAsync(500);
    expect(handler).toHaveBeenCalledTimes(1);

    // 再推进时间不应再次触发（once 已禁用清理）。
    await vi.advanceTimersByTimeAsync(5000);
    expect(handler).toHaveBeenCalledTimes(1);
    mgr.stop();
  });
});

describe('ScheduleManagerImpl runTask reentrancy guard', () => {
  it('interval handler 慢于 interval 时不会堆叠重入：第二次 tick 在第一次未完成时被丢弃', async () => {
    vi.useFakeTimers();
    let started = 0;
    let finished = 0;
    let release!: () => void;
    let blocker = new Promise<void>((resolve) => {
      release = resolve;
    });
    const handler = vi.fn(async () => {
      started += 1;
      await blocker;
      finished += 1;
    });

    const mgr = new ScheduleManagerImpl();
    mgr.start();
    // interval=100ms 但 handler 永不返回直到我们手动 release
    mgr.add({ name: 'reentry', kind: 'interval', expression: '100', handler, enabled: true });

    // 推进 100ms：第一次 tick → 进入 handler，started=1
    await vi.advanceTimersByTimeAsync(100);
    expect(started).toBe(1);
    expect(finished).toBe(0);

    // 再推进 500ms（5 个 interval），但 handler 还没释放：started 必须仍是 1
    // 没有 reentrancy guard 的话这里会变成 6（1 + 5 个堆叠 tick）
    await vi.advanceTimersByTimeAsync(500);
    expect(started).toBe(1);
    expect(finished).toBe(0);

    // 释放 handler，让第一次 tick 完成
    release();
    blocker = new Promise<void>((resolve) => {
      release = resolve;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(finished).toBe(1);

    // 现在第二次 tick 应当能正常进入：再推进一个 interval
    await vi.advanceTimersByTimeAsync(100);
    expect(started).toBe(2);

    release();
    mgr.stop();
  });

  it('handler 抛错后 in-flight slot 必须释放（finally 兜底）', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let calls = 0;
    const handler = vi.fn(async () => {
      calls += 1;
      throw new Error('boom');
    });

    const mgr = new ScheduleManagerImpl();
    mgr.start();
    mgr.add({ name: 'throwing', kind: 'interval', expression: '100', handler, enabled: true });

    // 第一次 tick
    await vi.advanceTimersByTimeAsync(100);
    expect(calls).toBe(1);

    // 第二次 tick：如果 in-flight slot 没在 finally 释放，这里会被永久跳过
    await vi.advanceTimersByTimeAsync(100);
    expect(calls).toBe(2);

    // 第三次确认稳态
    await vi.advanceTimersByTimeAsync(100);
    expect(calls).toBe(3);

    mgr.stop();
  });
});
