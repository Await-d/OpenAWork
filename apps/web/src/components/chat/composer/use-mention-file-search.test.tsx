// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MentionSearchResult } from '../../conversation-runtime/messages/support.js';
import type { MentionFileSearchFn, UseMentionFileSearchInput } from './use-mention-file-search.js';
import { useMentionFileSearch } from './use-mention-file-search.js';

const EMPTY_RESULT: MentionSearchResult = { files: [], directories: [] };

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function createDeferred<T>() {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function renderMentionSearch(initialProps: UseMentionFileSearchInput) {
  return renderHook((props: UseMentionFileSearchInput) => useMentionFileSearch(props), {
    initialProps,
  });
}

async function flushDebounce(ms = 120) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
    await Promise.resolve();
  });
}

describe('useMentionFileSearch', () => {
  it('快速切换 query 只对最后一个 query 发起一次请求', async () => {
    vi.useFakeTimers();
    const search = vi.fn<MentionFileSearchFn>(async () => EMPTY_RESULT);

    const { rerender } = renderMentionSearch({ enabled: true, query: 'a', search });
    rerender({ enabled: true, query: 'ab', search });
    rerender({ enabled: true, query: 'apps', search });
    await flushDebounce();

    expect(search).toHaveBeenCalledTimes(1);
    expect(search.mock.calls[0]?.[0]).toBe('apps');
  });

  it('query 变化时 abort 上一个请求的 signal', async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const search = vi.fn<MentionFileSearchFn>((_query, signal) => {
      signals.push(signal);
      return new Promise(() => undefined);
    });

    const { rerender } = renderMentionSearch({ enabled: true, query: 'a', search });
    await flushDebounce();
    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(false);

    rerender({ enabled: true, query: 'ab', search });
    expect(signals[0]?.aborted).toBe(true);

    await flushDebounce();
    expect(signals).toHaveLength(2);
    expect(signals[1]?.aborted).toBe(false);
  });

  it('新请求在途时保留上一次结果', async () => {
    vi.useFakeTimers();
    const first = createDeferred<MentionSearchResult>();
    const second = createDeferred<MentionSearchResult>();
    const search = vi
      .fn<MentionFileSearchFn>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    const { result, rerender } = renderMentionSearch({ enabled: true, query: 'a', search });
    await flushDebounce();
    first.resolve({ files: ['a.ts'], directories: [] });
    await act(async () => {
      await first.promise;
    });
    expect(result.current.result).toEqual({ files: ['a.ts'], directories: [] });
    expect(result.current.loading).toBe(false);

    rerender({ enabled: true, query: 'ab', search });
    await flushDebounce();

    expect(search).toHaveBeenCalledTimes(2);
    expect(result.current.result).toEqual({ files: ['a.ts'], directories: [] });
    expect(result.current.loading).toBe(true);
  });

  it('请求失败时保留上一次结果、清除 loading 并暴露错误文案', async () => {
    vi.useFakeTimers();
    const first = createDeferred<MentionSearchResult>();
    const failed = createDeferred<MentionSearchResult>();
    const search = vi
      .fn<MentionFileSearchFn>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => failed.promise);

    const { result, rerender } = renderMentionSearch({ enabled: true, query: 'a', search });
    await flushDebounce();
    first.resolve({ files: ['keep.ts'], directories: [] });
    await act(async () => {
      await first.promise;
    });

    rerender({ enabled: true, query: 'b', search });
    await flushDebounce();
    failed.reject(new Error('检索失败'));
    await act(async () => {
      await failed.promise.catch(() => undefined);
    });

    expect(search).toHaveBeenCalledTimes(2);
    expect(result.current.result).toEqual({ files: ['keep.ts'], directories: [] });
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe('检索失败');
  });

  it('失败抛出空 message 时使用中文兜底错误文案', async () => {
    vi.useFakeTimers();
    const search = vi.fn<MentionFileSearchFn>(async () => {
      throw new Error('');
    });

    const { result } = renderMentionSearch({ enabled: true, query: 'a', search });
    await flushDebounce();

    expect(result.current.error).toBe('检索工作区文件失败，请稍后重试。');
  });

  it('后续请求成功时清除之前的错误', async () => {
    vi.useFakeTimers();
    const failed = createDeferred<MentionSearchResult>();
    const recovered = createDeferred<MentionSearchResult>();
    const search = vi
      .fn<MentionFileSearchFn>()
      .mockImplementationOnce(() => failed.promise)
      .mockImplementationOnce(() => recovered.promise);

    const { result, rerender } = renderMentionSearch({ enabled: true, query: 'a', search });
    await flushDebounce();
    failed.reject(new Error('检索失败'));
    await act(async () => {
      await failed.promise.catch(() => undefined);
    });
    expect(result.current.error).toBe('检索失败');

    rerender({ enabled: true, query: 'ab', search });
    await flushDebounce();
    recovered.resolve({ files: ['a.ts'], directories: [] });
    await act(async () => {
      await recovered.promise;
    });

    expect(result.current.error).toBeNull();
    expect(result.current.result).toEqual({ files: ['a.ts'], directories: [] });
  });

  it('旧 query 的迟到响应不会覆盖新结果', async () => {
    vi.useFakeTimers();
    const slow = createDeferred<MentionSearchResult>();
    const fast = createDeferred<MentionSearchResult>();
    const search = vi
      .fn<MentionFileSearchFn>()
      .mockImplementationOnce(() => slow.promise)
      .mockImplementationOnce(() => fast.promise);

    const { result, rerender } = renderMentionSearch({ enabled: true, query: 'old', search });
    await flushDebounce();
    rerender({ enabled: true, query: 'new', search });
    await flushDebounce();

    fast.resolve({ files: ['new.ts'], directories: [] });
    await act(async () => {
      await fast.promise;
    });
    expect(result.current.result).toEqual({ files: ['new.ts'], directories: [] });

    slow.resolve({ files: ['old.ts'], directories: [] });
    await act(async () => {
      await slow.promise;
    });
    expect(result.current.result).toEqual({ files: ['new.ts'], directories: [] });
  });

  it('过期 query 的失败不会设置错误', async () => {
    vi.useFakeTimers();
    const slow = createDeferred<MentionSearchResult>();
    const fast = createDeferred<MentionSearchResult>();
    const search = vi
      .fn<MentionFileSearchFn>()
      .mockImplementationOnce(() => slow.promise)
      .mockImplementationOnce(() => fast.promise);

    const { result, rerender } = renderMentionSearch({ enabled: true, query: 'old', search });
    await flushDebounce();
    rerender({ enabled: true, query: 'new', search });
    await flushDebounce();

    fast.resolve({ files: ['new.ts'], directories: [] });
    await act(async () => {
      await fast.promise;
    });

    slow.reject(new Error('旧查询失败'));
    await act(async () => {
      await slow.promise.catch(() => undefined);
    });

    expect(result.current.error).toBeNull();
    expect(result.current.result).toEqual({ files: ['new.ts'], directories: [] });
  });

  it('被中止的请求 rejection 不会设置错误', async () => {
    vi.useFakeTimers();
    const search = vi.fn<MentionFileSearchFn>(
      (_query, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }),
    );

    const { result, rerender } = renderMentionSearch({ enabled: true, query: 'a', search });
    await flushDebounce();
    rerender({ enabled: true, query: 'ab', search });
    await flushDebounce();

    expect(search).toHaveBeenCalledTimes(2);
    expect(result.current.error).toBeNull();
  });

  it('enabled:false / query:null / 缺少 search 时都不发请求', async () => {
    vi.useFakeTimers();
    const search = vi.fn<MentionFileSearchFn>(async () => EMPTY_RESULT);
    const { result, rerender } = renderMentionSearch({ enabled: false, query: 'a', search });
    await flushDebounce();
    expect(search).not.toHaveBeenCalled();
    expect(result.current).toEqual({
      result: null,
      loading: false,
      hasAnyEntries: false,
      error: null,
    });

    rerender({ enabled: true, query: null, search });
    await flushDebounce();
    expect(search).not.toHaveBeenCalled();

    rerender({ enabled: true, query: 'a', search: undefined });
    await flushDebounce();
    expect(search).not.toHaveBeenCalled();
    expect(result.current.result).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('hasAnyEntries 在出现过非空结果后保持为 true', async () => {
    vi.useFakeTimers();
    const search = vi
      .fn<MentionFileSearchFn>()
      .mockResolvedValueOnce({ files: ['a.ts'], directories: [] })
      .mockResolvedValueOnce(EMPTY_RESULT);

    const { result, rerender } = renderMentionSearch({ enabled: true, query: 'a', search });
    await flushDebounce();
    expect(result.current.hasAnyEntries).toBe(true);

    rerender({ enabled: true, query: 'zzz', search });
    await flushDebounce();
    expect(result.current.result).toEqual(EMPTY_RESULT);
    expect(result.current.hasAnyEntries).toBe(true);

    rerender({ enabled: false, query: 'zzz', search });
    expect(result.current).toEqual({
      result: null,
      loading: false,
      hasAnyEntries: true,
      error: null,
    });
  });

  it('search 身份变化（工作区切换）时 hasAnyEntries 重置为 false', async () => {
    vi.useFakeTimers();
    const searchA = vi.fn<MentionFileSearchFn>(async () => ({
      files: ['a.ts'],
      directories: [],
    }));
    const searchB = vi.fn<MentionFileSearchFn>(async () => EMPTY_RESULT);

    const { result, rerender } = renderMentionSearch({
      enabled: true,
      query: 'a',
      search: searchA,
    });
    await flushDebounce();
    expect(result.current.hasAnyEntries).toBe(true);

    rerender({ enabled: true, query: 'a', search: searchB });
    expect(result.current.hasAnyEntries).toBe(false);

    await flushDebounce();
    expect(result.current.result).toEqual(EMPTY_RESULT);
    expect(result.current.hasAnyEntries).toBe(false);
  });
});
