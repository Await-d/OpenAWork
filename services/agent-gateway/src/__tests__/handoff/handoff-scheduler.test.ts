/**
 * 260515-team-phase-b · T-05 单元测试
 *
 * 覆盖 InProcessScheduler 的 9 个 D40 方法。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  InProcessScheduler,
  __resetBackgroundTaskSchedulerForTesting,
  type SchedulerEvent,
} from '../../handoff/runner/scheduler.js';

let scheduler: InProcessScheduler;
let events: SchedulerEvent[];
let unsubscribe: () => void;

beforeEach(() => {
  __resetBackgroundTaskSchedulerForTesting();
  scheduler = new InProcessScheduler();
  events = [];
  unsubscribe = scheduler.subscribe((event) => events.push(event));
});

afterEach(() => {
  unsubscribe();
});

function defer(): { promise: Promise<void>; resolve: () => void; reject: (err: Error) => void } {
  let resolve!: () => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(): Promise<void> {
  await new Promise((r) => setImmediate(r));
}

describe('schedule + getStatus', () => {
  it('schedule 立即返回 pending 然后异步进入 running 与 completed', async () => {
    const d = defer();
    scheduler.schedule({ id: 't1', run: () => d.promise });
    expect(scheduler.getStatus('t1')?.status).toBe('running'); // run() 是同步开始
    d.resolve();
    await flushMicrotasks();
    expect(scheduler.getStatus('t1')?.status).toBe('completed');
    expect(events.map((e) => e.type)).toEqual(['enqueued', 'started', 'completed']);
  });

  it('重复 schedule 同一 id 是 noop', () => {
    scheduler.schedule({ id: 'dup', run: async () => {} });
    const second = scheduler.schedule({ id: 'dup', run: async () => {} });
    expect(second.id).toBe('dup');
    // 只产生一个 enqueued 事件
    expect(events.filter((e) => e.type === 'enqueued')).toHaveLength(1);
  });
});

describe('cancel', () => {
  it('运行中 cancel 触发 abort + cancelled 事件', async () => {
    const d = defer();
    let cancelled = false;
    scheduler.schedule({
      id: 't',
      run: (signal) =>
        new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => {
            cancelled = true;
            resolve();
          });
          void d.promise.then(() => resolve());
        }),
    });
    expect(scheduler.cancel('t')).toBe(true);
    await flushMicrotasks();
    expect(cancelled).toBe(true);
    expect(scheduler.getStatus('t')?.status).toBe('cancelled');
    expect(events.find((e) => e.type === 'cancelled')).toBeDefined();
  });

  it('已 completed 的不能再 cancel', async () => {
    const d = defer();
    scheduler.schedule({ id: 'done', run: () => d.promise });
    d.resolve();
    await flushMicrotasks();
    expect(scheduler.cancel('done')).toBe(false);
  });
});

describe('pause / resume', () => {
  it('pause 正在 running 的任务，状态变 paused，原 run abort', async () => {
    let aborted = false;
    scheduler.schedule({
      id: 'p',
      run: (signal) =>
        new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => {
            aborted = true;
            resolve();
          });
        }),
    });
    expect(scheduler.pause('p')).toBe(true);
    await flushMicrotasks();
    expect(aborted).toBe(true);
    expect(scheduler.getStatus('p')?.status).toBe('paused');
    expect(events.find((e) => e.type === 'paused')).toBeDefined();
  });

  it('resume 一个被 pause 的运行中任务会重新启动', async () => {
    let runCount = 0;
    const secondRun = { resolve: null as null | (() => void) };
    scheduler.schedule({
      id: 'r',
      run: (signal) =>
        new Promise<void>((resolve) => {
          runCount += 1;
          if (runCount === 1) {
            signal.addEventListener('abort', () => resolve(), { once: true });
            return;
          }
          secondRun.resolve = resolve;
        }),
    });
    scheduler.pause('r');
    await flushMicrotasks();
    expect(scheduler.resume('r')).toBe(true);
    await flushMicrotasks();
    expect(runCount).toBe(2);
    if (typeof secondRun.resolve !== 'function') {
      throw new Error('第二次运行的 resolver 未建立');
    }
    secondRun.resolve();
    await flushMicrotasks();
    expect(scheduler.getStatus('r')?.status).toBe('completed');
    expect(events.find((e) => e.type === 'resumed')).toBeDefined();
  });

  it('对非 paused 状态 resume 返回 false', () => {
    scheduler.schedule({ id: 'r2', run: async () => {} });
    expect(scheduler.resume('r2')).toBe(false);
  });
});

describe('pauseAll / resumeAll', () => {
  it('pauseAll 把活跃任务全部 paused，resumeAll 全部 resumed', async () => {
    scheduler.schedule({
      id: 'a',
      run: (signal) =>
        new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => resolve());
        }),
    });
    scheduler.schedule({
      id: 'b',
      run: (signal) =>
        new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => resolve());
        }),
    });
    expect(scheduler.pauseAll()).toBe(2);
    await flushMicrotasks();
    expect(scheduler.getStatus('a')?.status).toBe('paused');
    expect(scheduler.getStatus('b')?.status).toBe('paused');

    expect(scheduler.resumeAll()).toBe(2);
  });

  it('pauseAll 后新 schedule 的任务不立即启动', () => {
    scheduler.pauseAll();
    scheduler.schedule({ id: 'late', run: async () => {} });
    // globalPaused，schedule 不会立刻 run，状态还是 pending
    expect(scheduler.getStatus('late')?.status).toBe('pending');
  });
});

describe('listActive', () => {
  it('返回 pending / running / paused 的任务，不返回终止态', async () => {
    const d = defer();
    scheduler.schedule({ id: 'live', run: () => d.promise });
    scheduler.schedule({
      id: 'paused',
      run: (signal) =>
        new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => resolve());
        }),
    });
    scheduler.pause('paused');
    await flushMicrotasks();

    const active = scheduler.listActive();
    expect(active.map((a) => a.id).sort()).toEqual(['live', 'paused']);
  });
});

describe('subscribe', () => {
  it('unsubscribe 后不再收到事件', () => {
    const localEvents: SchedulerEvent[] = [];
    const unsub = scheduler.subscribe((e) => localEvents.push(e));
    scheduler.schedule({ id: 's', run: async () => {} });
    expect(localEvents.length).toBeGreaterThan(0);
    unsub();
    const before = localEvents.length;
    scheduler.schedule({ id: 's2', run: async () => {} });
    expect(localEvents.length).toBe(before);
  });

  it('监听器抛错不影响其他监听器', () => {
    scheduler.subscribe(() => {
      throw new Error('boom');
    });
    let received = 0;
    scheduler.subscribe(() => {
      received += 1;
    });
    scheduler.schedule({ id: 'x', run: async () => {} });
    expect(received).toBeGreaterThan(0);
  });
});
