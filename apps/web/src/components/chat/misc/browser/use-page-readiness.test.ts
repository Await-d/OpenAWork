// @vitest-environment jsdom
/**
 * `usePageReadiness` 覆盖。
 *
 * 关注三件事：
 *   1. 只有环回 / 私有网段地址才探测（外部站点不该产生网络请求）；
 *   2. 服务未起时会按退避重试，而不是一次失败就放弃；
 *   3. 首次就绪只通知一次 `onReady`，避免每轮重试都重载页面。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { isProbeableUrl, usePageReadiness } from './use-page-readiness.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('isProbeableUrl', () => {
  it('接受环回与私有网段地址', () => {
    expect(isProbeableUrl('http://localhost:5173')).toBe(true);
    expect(isProbeableUrl('http://127.0.0.1:3000/')).toBe(true);
    expect(isProbeableUrl('https://192.168.1.20:8080')).toBe(true);
    expect(isProbeableUrl('http://10.0.0.5:4000')).toBe(true);
    expect(isProbeableUrl('http://172.20.3.4:3000')).toBe(true);
  });

  it('拒绝外部站点与非 http 协议', () => {
    expect(isProbeableUrl('https://example.com')).toBe(false);
    expect(isProbeableUrl('about:blank')).toBe(false);
    expect(isProbeableUrl('file:///tmp/index.html')).toBe(false);
    expect(isProbeableUrl('')).toBe(false);
  });
});

describe('usePageReadiness', () => {
  it('探测成功后进入 ready 并只通知一次 onReady', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 200 })),
    );
    const onReady = vi.fn();

    const { result } = renderHook(() =>
      usePageReadiness({ url: 'http://localhost:5173', onReady }),
    );

    await waitFor(() => expect(result.current.state).toBe('ready'));
    expect(result.current.monitored).toBe(true);
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it('服务未起时按退避重试直到成功', async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      if (calls < 3) throw new TypeError('connection refused');
      return new Response(null, { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() =>
      usePageReadiness({
        url: 'http://127.0.0.1:3000',
        baseDelayMs: 5,
        maxDelayMs: 10,
      }),
    );

    await waitFor(() => expect(result.current.state).toBe('ready'));
    expect(calls).toBe(3);
  });

  it('重试用尽后落到 unreachable 并停止请求', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('connection refused');
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() =>
      usePageReadiness({
        url: 'http://localhost:9999',
        maxAttempts: 3,
        baseDelayMs: 1,
        maxDelayMs: 2,
      }),
    );

    await waitFor(() => expect(result.current.state).toBe('unreachable'));
    expect(result.current.attempt).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('外部站点不探测', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => usePageReadiness({ url: 'https://example.com' }));

    expect(result.current.monitored).toBe(false);
    expect(result.current.state).toBe('idle');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('enabled=false 时完全不探测（Tauri webview 模式）', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() =>
      usePageReadiness({ url: 'http://localhost:5173', enabled: false }),
    );

    expect(result.current.monitored).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('retry() 可以从 unreachable 重新发起探测', async () => {
    let fail = true;
    const fetchMock = vi.fn(async () => {
      if (fail) throw new TypeError('connection refused');
      return new Response(null, { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() =>
      usePageReadiness({
        url: 'http://localhost:9999',
        maxAttempts: 2,
        baseDelayMs: 1,
        maxDelayMs: 2,
      }),
    );

    await waitFor(() => expect(result.current.state).toBe('unreachable'));

    fail = false;
    result.current.retry();

    await waitFor(() => expect(result.current.state).toBe('ready'));
  });
});
