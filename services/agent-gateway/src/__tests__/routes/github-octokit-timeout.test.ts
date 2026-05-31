import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGitHubTimeoutFetch, GITHUB_API_TIMEOUT_MS } from '../../github/router.js';

/**
 * §0.154: the GitHub write-back path builds two Octokit v22 (native-fetch)
 * clients. Octokit v22 has no `request.timeout`, so a connects-but-hangs
 * GitHub API would leave `performWriteBack` (run inside a fire-and-forget
 * `.then()`) pending forever. The fix injects a `request.fetch` that merges
 * `AbortSignal.timeout` with any caller signal. These tests pin the wrapper's
 * behaviour without a live network.
 */
describe('createGitHubTimeoutFetch (§0.154)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('默认超时常量为 30s', () => {
    expect(GITHUB_API_TIMEOUT_MS).toBe(30_000);
  });

  it('转发到底层 fetch 并附带一个 AbortSignal', async () => {
    const underlying = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('ok', { status: 200 }));
    const wrapped = createGitHubTimeoutFetch(30_000);

    await wrapped('https://api.github.com/x');

    expect(underlying).toHaveBeenCalledTimes(1);
    const init = underlying.mock.calls[0]![1];
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('超时触发时合并信号 abort（不永久 pending）', async () => {
    // Underlying fetch never resolves on its own; it only rejects when the
    // injected signal aborts — exactly the connects-but-hangs shape. A tiny
    // real timeout keeps the test deterministic and fast (vitest fake timers
    // do not hook `AbortSignal.timeout`).
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    );
    const wrapped = createGitHubTimeoutFetch(20);
    await expect(wrapped('https://api.github.com/slow')).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('调用方信号 abort 时合并信号也 abort', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    );
    const wrapped = createGitHubTimeoutFetch(60_000);
    const caller = new AbortController();
    const pending = wrapped('https://api.github.com/x', { signal: caller.signal });
    caller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
