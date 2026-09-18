// @vitest-environment jsdom
/**
 * 输入合并队列：合并窗口、单飞保序（含延迟响应）、失败不丢字。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TerminalInputQueue, TERMINAL_INPUT_MERGE_MS } from './terminal-input-queue.js';

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
}

function createDeferred(): Deferred {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function flushMicrotasks(): Promise<void> {
  return Promise.resolve().then(() => undefined);
}

describe('TerminalInputQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('合并窗口内的连续按键只发一次', async () => {
    const write = vi.fn<(data: string) => Promise<void>>(async () => undefined);
    const queue = new TerminalInputQueue({ write, onError: vi.fn() });

    queue.push('l');
    queue.push('s');
    queue.push('\r');

    expect(write).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(TERMINAL_INPUT_MERGE_MS - 1);
    expect(write).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith('ls\r');
    expect(queue.hasPending).toBe(false);
  });

  it('跨窗口的输入保持先后顺序', async () => {
    const write = vi.fn<(data: string) => Promise<void>>(async () => undefined);
    const queue = new TerminalInputQueue({ write, onError: vi.fn() });

    queue.push('a');
    await vi.advanceTimersByTimeAsync(TERMINAL_INPUT_MERGE_MS);
    queue.push('b');
    await vi.advanceTimersByTimeAsync(TERMINAL_INPUT_MERGE_MS);

    expect(write.mock.calls.map((call) => call[0])).toEqual(['a', 'b']);
  });

  it('在飞期间的输入排队等待，慢响应不会导致乱序', async () => {
    const first = createDeferred();
    const write = vi.fn<(data: string) => Promise<void>>(() => first.promise);
    const queue = new TerminalInputQueue({ write, onError: vi.fn() });

    queue.push('a');
    await vi.advanceTimersByTimeAsync(TERMINAL_INPUT_MERGE_MS);
    expect(write).toHaveBeenCalledTimes(1);

    queue.push('b');
    queue.push('c');
    await vi.advanceTimersByTimeAsync(TERMINAL_INPUT_MERGE_MS * 5);
    // 第一个请求还没落地：不得并发出第二个请求。
    expect(write).toHaveBeenCalledTimes(1);
    expect(queue.pendingLength).toBe(2);

    write.mockImplementation(async () => undefined);
    first.resolve();
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(TERMINAL_INPUT_MERGE_MS);

    expect(write.mock.calls.map((call) => call[0])).toEqual(['a', 'bc']);
  });

  it('写入失败时上报错误、把数据放回队首、并与后续输入合并重试', async () => {
    const error = new Error('写入终端输入失败');
    const write = vi
      .fn<(data: string) => Promise<void>>()
      .mockRejectedValueOnce(error)
      .mockResolvedValue(undefined);
    const onError = vi.fn();
    const queue = new TerminalInputQueue({ write, onError });

    queue.push('echo hi');
    await vi.advanceTimersByTimeAsync(TERMINAL_INPUT_MERGE_MS);

    expect(onError).toHaveBeenCalledWith(error, 'echo hi');
    expect(queue.pendingLength).toBe(7);

    // 失败后不自动重试，避免后端 5xx 时打成请求风暴。
    await vi.advanceTimersByTimeAsync(TERMINAL_INPUT_MERGE_MS * 10);
    expect(write).toHaveBeenCalledTimes(1);

    queue.push('\r');
    await vi.advanceTimersByTimeAsync(TERMINAL_INPUT_MERGE_MS);

    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls.map((call) => call[0])).toEqual(['echo hi', 'echo hi\r']);
    expect(queue.hasPending).toBe(false);
  });

  it('非 Error 拒绝值也会归一化成 Error 上报', async () => {
    const onError = vi.fn();
    const queue = new TerminalInputQueue({
      write: vi.fn(async () => {
        throw 'string failure';
      }),
      onError,
    });

    queue.push('x');
    await vi.advanceTimersByTimeAsync(TERMINAL_INPUT_MERGE_MS);

    expect(onError).toHaveBeenCalledTimes(1);
    const [reported] = onError.mock.calls[0] ?? [];
    expect(reported).toBeInstanceOf(Error);
  });

  it('dispose 会立即发出缓冲，且之后不再接受输入', async () => {
    const write = vi.fn<(data: string) => Promise<void>>(async () => undefined);
    const queue = new TerminalInputQueue({ write, onError: vi.fn() });

    queue.push('git status');
    queue.dispose();

    expect(write).toHaveBeenCalledWith('git status');

    queue.push('ignored');
    await vi.advanceTimersByTimeAsync(TERMINAL_INPUT_MERGE_MS * 2);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('空字符串输入不产生请求', async () => {
    const write = vi.fn<(data: string) => Promise<void>>(async () => undefined);
    const queue = new TerminalInputQueue({ write, onError: vi.fn() });

    queue.push('');
    await vi.advanceTimersByTimeAsync(TERMINAL_INPUT_MERGE_MS * 2);

    expect(write).not.toHaveBeenCalled();
  });
});
