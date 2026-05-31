/**
 * Robustness: the streaming upstream runner must bound a stalled-but-open
 * upstream socket with an inter-chunk (idle) watchdog.
 *
 * The AI SDK `streamText` only honours `abortSignal`; it has no notion of
 * a stream that connects, emits a first chunk, then stops producing data
 * without closing the connection. Without a watchdog the
 * `for await (fullStream)` loop in `runUpstreamStream` would block
 * forever, wedging the agent turn. `withStreamIdleWatchdog` is the
 * extracted, unit-testable core of that guard.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { withStreamIdleWatchdog } from '../../v2-runtime/upstream/stream-runner.js';

afterEach(() => {
  vi.useRealTimers();
});

/** Async iterable that yields `first`, then never settles (open + idle). */
function hangingAfterFirst<T>(first: T): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<T> {
      let sentFirst = false;
      let returned = false;
      return {
        next(): Promise<IteratorResult<T>> {
          if (returned) return Promise.resolve({ done: true, value: undefined });
          if (!sentFirst) {
            sentFirst = true;
            return Promise.resolve({ done: false, value: first });
          }
          // Never resolves — models an upstream that hangs mid-stream.
          return new Promise<IteratorResult<T>>(() => {});
        },
        return(): Promise<IteratorResult<T>> {
          returned = true;
          return Promise.resolve({ done: true, value: undefined });
        },
      };
    },
  };
}

async function* finiteSource<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) yield item;
}

/**
 * Async iterable that yields `first`, then hangs, and whose `return()` REJECTS
 * (models the AI SDK iterator after the upstream socket was aborted — the
 * abandoned pending `next()` settles with the abort error).
 */
function hangingWithRejectingReturn<T>(first: T): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<T> {
      let sentFirst = false;
      return {
        next(): Promise<IteratorResult<T>> {
          if (!sentFirst) {
            sentFirst = true;
            return Promise.resolve({ done: false, value: first });
          }
          return new Promise<IteratorResult<T>>(() => {});
        },
        return(): Promise<IteratorResult<T>> {
          return Promise.reject(new Error('aborted'));
        },
      };
    },
  };
}

/**
 * Async iterable that yields `first`, then hangs, and whose `return()` NEVER
 * settles (models a misbehaving adapter whose close itself hangs).
 */
function hangingWithHangingReturn<T>(first: T): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<T> {
      let sentFirst = false;
      return {
        next(): Promise<IteratorResult<T>> {
          if (!sentFirst) {
            sentFirst = true;
            return Promise.resolve({ done: false, value: first });
          }
          return new Promise<IteratorResult<T>>(() => {});
        },
        return(): Promise<IteratorResult<T>> {
          return new Promise<IteratorResult<T>>(() => {});
        },
      };
    },
  };
}

describe('withStreamIdleWatchdog', () => {
  it('passes through all chunks when the source completes promptly', async () => {
    const out: number[] = [];
    const onStall = vi.fn();
    for await (const v of withStreamIdleWatchdog(finiteSource([1, 2, 3]), {
      idleTimeoutMs: 1_000,
      onStall,
    })) {
      out.push(v);
    }
    expect(out).toEqual([1, 2, 3]);
    expect(onStall).not.toHaveBeenCalled();
  });

  it('fires onStall, closes the source, and ends iteration when idle exceeds the deadline', async () => {
    vi.useFakeTimers();
    const onStall = vi.fn();
    const source = hangingAfterFirst('first-chunk');
    const iterator = source[Symbol.asyncIterator]();
    const returnSpy = vi.spyOn(iterator, 'return');
    // Re-expose the same iterator so the watchdog drives our spy.
    const wrapped: AsyncIterable<string> = { [Symbol.asyncIterator]: () => iterator };

    const collected: string[] = [];
    const run = (async () => {
      for await (const v of withStreamIdleWatchdog(wrapped, {
        idleTimeoutMs: 5_000,
        onStall,
      })) {
        collected.push(v);
      }
    })();

    // First chunk resolves immediately.
    await vi.advanceTimersByTimeAsync(0);
    // Now nothing arrives; cross the idle deadline.
    await vi.advanceTimersByTimeAsync(5_000);
    await run;

    expect(collected).toEqual(['first-chunk']);
    expect(onStall).toHaveBeenCalledTimes(1);
    expect(returnSpy).toHaveBeenCalledTimes(1);
  });

  it('disables the watchdog when idleTimeoutMs is non-positive', async () => {
    const onStall = vi.fn();
    const out: number[] = [];
    for await (const v of withStreamIdleWatchdog(finiteSource([7, 8]), {
      idleTimeoutMs: 0,
      onStall,
    })) {
      out.push(v);
    }
    expect(out).toEqual([7, 8]);
    expect(onStall).not.toHaveBeenCalled();
  });

  it('ends gracefully (no throw) when the source return() rejects after onStall', async () => {
    // §0.130: after onStall aborts the upstream, the iterator's return() can
    // reject with the abort error. An unguarded await would throw it out of the
    // generator, bypassing the caller's stable STREAM_STALL chunk. The close is
    // now swallowed, so the watchdog still ends gracefully after the one chunk.
    const onStall = vi.fn();
    const collected: string[] = [];
    await expect(
      (async () => {
        for await (const v of withStreamIdleWatchdog(hangingWithRejectingReturn('first-chunk'), {
          idleTimeoutMs: 20,
          onStall,
        })) {
          collected.push(v);
        }
      })(),
    ).resolves.toBeUndefined();
    expect(collected).toEqual(['first-chunk']);
    expect(onStall).toHaveBeenCalledTimes(1);
  });

  it('ends within the close deadline when the source return() itself hangs', async () => {
    // §0.130: a misbehaving adapter whose return() never settles must not
    // re-hang the very turn the watchdog bounds. closeIteratorSafely races the
    // close against its own short deadline, so iteration still ends.
    vi.useFakeTimers();
    const onStall = vi.fn();
    const collected: string[] = [];
    const run = (async () => {
      for await (const v of withStreamIdleWatchdog(hangingWithHangingReturn('first-chunk'), {
        idleTimeoutMs: 5_000,
        onStall,
      })) {
        collected.push(v);
      }
    })();

    // First chunk resolves immediately, then cross the idle deadline.
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5_000);
    // The close itself hangs; advance past the 5s close deadline.
    await vi.advanceTimersByTimeAsync(5_000);
    await run;

    expect(collected).toEqual(['first-chunk']);
    expect(onStall).toHaveBeenCalledTimes(1);
  });
});
