/**
 * Unit coverage for `BackgroundScheduler`.
 *
 * Verifies the four invariants documented in the module header:
 *   1. Non-overlapping execution (next tick skipped while previous run
 *      is still in-flight).
 *   2. Failure-tolerant (exception inside run() doesn't kill the loop).
 *   3. Clean shutdown (stopAll cancels timers AND awaits in-flight work).
 *   4. Idempotent register/unregister.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackgroundScheduler } from '../../runtime/background-scheduler.js';

describe('BackgroundScheduler', () => {
  let scheduler: BackgroundScheduler;

  beforeEach(() => {
    vi.useFakeTimers();
    scheduler = new BackgroundScheduler();
  });

  afterEach(async () => {
    await scheduler.stopAll();
    vi.useRealTimers();
  });

  it('runs the task at intervalMs cadence using initialDelayMs as the first tick', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    scheduler.register({
      name: 'demo',
      intervalMs: 1000,
      initialDelayMs: 200,
      run,
    });

    // No tick yet.
    expect(run).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(200);
    expect(run).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(2000);
    expect(run).toHaveBeenCalledTimes(4);
  });

  it('skips overlapping ticks: a long-running task does not pile up', async () => {
    const queue: Array<() => void> = [];
    const run = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        queue.push(resolve);
      });
    });

    scheduler.register({
      name: 'slow',
      intervalMs: 100,
      initialDelayMs: 100,
      run,
    });

    await vi.advanceTimersByTimeAsync(100); // first tick fires, blocks
    expect(run).toHaveBeenCalledTimes(1);

    // Several would-be ticks pass while the first is still running.
    await vi.advanceTimersByTimeAsync(400);
    expect(run).toHaveBeenCalledTimes(1); // still just the one

    // Drain the first in-flight call so the next tick can fire.
    queue.shift()?.();
    await vi.advanceTimersByTimeAsync(100);
    expect(run).toHaveBeenCalledTimes(2);

    // Cleanup: drain any remaining queued resolvers so afterEach()'s
    // stopAll() doesn't wait on a never-resolving in-flight promise.
    while (queue.length > 0) queue.shift()?.();
  });

  it('continues scheduling after a task throws', async () => {
    const onError = vi.fn();
    let counter = 0;
    const run = vi.fn(async () => {
      counter += 1;
      if (counter === 1) throw new Error('boom on first tick');
    });

    scheduler.register({
      name: 'fragile',
      intervalMs: 100,
      initialDelayMs: 100,
      run,
      onError,
    });

    await vi.advanceTimersByTimeAsync(100);
    expect(run).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(100);
    expect(run).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(1); // second run succeeded
  });

  it('stopAll cancels future ticks and awaits in-flight execution', async () => {
    const queue: Array<() => void> = [];
    const finished = vi.fn();
    const run = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        queue.push(resolve);
      });
      finished();
    });

    scheduler.register({
      name: 'inflight',
      intervalMs: 100,
      initialDelayMs: 100,
      run,
    });

    await vi.advanceTimersByTimeAsync(100);
    expect(run).toHaveBeenCalledTimes(1);
    expect(finished).not.toHaveBeenCalled();

    // Kick off stopAll but don't await yet.
    const stopPromise = scheduler.stopAll();

    // Release in-flight work so stopAll can settle.
    queue.shift()?.();
    await stopPromise;

    expect(finished).toHaveBeenCalledTimes(1);

    // Even after a generous wait, no new ticks fire.
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('register() is idempotent: a second register with the same name is a no-op', () => {
    const runA = vi.fn();
    const runB = vi.fn();
    scheduler.register({ name: 'dup', intervalMs: 1000, run: runA });
    scheduler.register({ name: 'dup', intervalMs: 1000, run: runB });
    expect(scheduler.listTaskNames()).toEqual(['dup']);
  });

  it('rejects intervalMs <= 0 at registration time', () => {
    expect(() => scheduler.register({ name: 'bad', intervalMs: 0, run: async () => {} })).toThrow();
    expect(() =>
      scheduler.register({ name: 'bad', intervalMs: -100, run: async () => {} }),
    ).toThrow();
  });

  it('unregister() cancels future ticks for the named task', async () => {
    const run = vi.fn();
    scheduler.register({
      name: 'unreg-me',
      intervalMs: 100,
      initialDelayMs: 100,
      run,
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(run).toHaveBeenCalledTimes(1);

    scheduler.unregister('unreg-me');
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('in-flight task finally does not clobber a replacement registered under the same name', async () => {
    // Regression for Issue A of the review: without the identity guard
    // in tick()'s finally, the OLD in-flight task's cleanup would
    // overwrite the NEW entry's initialDelayMs timer with intervalMs,
    // swallowing the freshly-registered task's start delay and
    // leaking the old timer handle.
    const queue: Array<() => void> = [];
    const oldRun = vi.fn(async () => {
      await new Promise<void>((resolve) => queue.push(resolve));
    });
    const newRun = vi.fn(async () => {});

    scheduler.register({
      name: 'replaced',
      intervalMs: 100,
      initialDelayMs: 100,
      run: oldRun,
    });

    // Fire the old task's first tick; it blocks on the queue.
    await vi.advanceTimersByTimeAsync(100);
    expect(oldRun).toHaveBeenCalledTimes(1);

    // User swaps the task under the same name while old is in-flight.
    scheduler.unregister('replaced');
    scheduler.register({
      name: 'replaced',
      intervalMs: 1000, // deliberately different so we can detect clobber
      initialDelayMs: 50,
      run: newRun,
    });

    // Let the new task's 50ms initial delay fire.
    await vi.advanceTimersByTimeAsync(50);
    expect(newRun).toHaveBeenCalledTimes(1);

    // Now release the OLD task. Its finally runs; the fix prevents it
    // from overwriting the new entry's timer. If the regression came
    // back, oldRun's finally would re-arm the new entry and we'd see
    // another newRun tick at intervalMs=1000 instead of waiting.
    queue.shift()?.();
    await vi.advanceTimersByTimeAsync(100);
    // Still exactly one new-run invocation — clobber would have
    // scheduled a second at the old entry's 100ms intervalMs.
    expect(newRun).toHaveBeenCalledTimes(1);

    // New task fires again at its own 1000ms cadence, uninterrupted.
    await vi.advanceTimersByTimeAsync(1000);
    expect(newRun).toHaveBeenCalledTimes(2);
  });
});
