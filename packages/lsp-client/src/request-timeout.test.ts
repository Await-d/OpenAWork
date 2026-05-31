import { describe, expect, it, vi } from 'vitest';
import { withTimeout, REQUEST_TIMEOUT_MS } from './client.js';

/**
 * Robustness: LSP requests (hover/definition/references/...) race the
 * underlying `connection.sendRequest` against a wall-clock ceiling so a
 * language server that connects but never answers cannot leave the
 * promise — and the awaiting tool call — pending forever. These tests
 * pin the `withTimeout` contract the request helper relies on.
 */
describe('withTimeout (LSP per-request hang guard)', () => {
  it('一个永不 settle 的请求会在 ms 后以超时 reject', async () => {
    vi.useFakeTimers();
    try {
      const hung = new Promise<string>(() => {
        // never settles — models a deadlocked language server
      });
      const raced = withTimeout(hung, 1_000);
      const assertion = expect(raced).rejects.toThrow(/Timeout after 1000ms/);
      await vi.advanceTimersByTimeAsync(1_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('请求在超时前 resolve 时透传原值，且不会因超时 reject', async () => {
    vi.useFakeTimers();
    try {
      const raced = withTimeout(Promise.resolve('ok'), 1_000);
      await expect(raced).resolves.toBe('ok');
      // Advancing past the deadline must not produce an unhandled rejection:
      // the timer was cleared on settle.
      await vi.advanceTimersByTimeAsync(2_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('请求在超时前 reject 时透传原始错误（而非超时错误）', async () => {
    vi.useFakeTimers();
    try {
      const raced = withTimeout(Promise.reject(new Error('connection closed')), 1_000);
      await expect(raced).rejects.toThrow(/connection closed/);
      await vi.advanceTimersByTimeAsync(2_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('暴露的默认请求超时为正数（供 hover/definition 等复用）', () => {
    expect(REQUEST_TIMEOUT_MS).toBeGreaterThan(0);
  });
});
