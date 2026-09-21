// @vitest-environment jsdom
/**
 * 会话侧栏后台重新验证控制器：
 *  - 仅在浏览器标签页可见时按 `SESSION_LIST_REVALIDATE_INTERVAL_MS` 轮询；
 *  - 「上一拍完成后」再排下一拍（单飞，不叠请求）；
 *  - 隐藏即停；恢复可见 / 窗口聚焦 / 网络恢复立刻补一拍；
 *  - 卸载清定时器，不再补拍。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import {
  SESSION_LIST_REVALIDATE_INTERVAL_MS,
  useSessionListRevalidation,
} from './use-session-list-revalidation.js';
import { subscribeSessionListRefresh } from '../../../utils/session/session-list-events.js';

let listenerCalls = 0;
let unsubscribe: (() => void) | null = null;

/** 推进假定时器，并让已 resolve 的 Promise 回调跑完（完成感知的刷新发生在微任务里）。 */
async function flush(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function setDocumentVisibility(value: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value });
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  listenerCalls = 0;
  unsubscribe = subscribeSessionListRefresh(() => {
    listenerCalls += 1;
  });
});

afterEach(() => {
  cleanup();
  unsubscribe?.();
  unsubscribe = null;
  vi.useRealTimers();
  Reflect.deleteProperty(document, 'visibilityState');
});

describe('useSessionListRevalidation', () => {
  it('enabled=false：不轮询，也不留定时器', async () => {
    renderHook(() => useSessionListRevalidation(false));

    await flush(SESSION_LIST_REVALIDATE_INTERVAL_MS * 3);

    expect(listenerCalls).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('enabled=true：挂载不立刻取数，之后每 30s 且仅一拍', async () => {
    renderHook(() => useSessionListRevalidation(true));

    await flush();
    expect(listenerCalls).toBe(0);

    await flush(SESSION_LIST_REVALIDATE_INTERVAL_MS);
    expect(listenerCalls).toBe(1);

    await flush(SESSION_LIST_REVALIDATE_INTERVAL_MS);
    expect(listenerCalls).toBe(2);
  });

  it('标签页隐藏时停止轮询，恢复可见立刻补一拍', async () => {
    renderHook(() => useSessionListRevalidation(true));
    await flush();
    expect(listenerCalls).toBe(0);

    setDocumentVisibility('hidden');
    await flush(SESSION_LIST_REVALIDATE_INTERVAL_MS * 3);
    expect(listenerCalls).toBe(0);

    setDocumentVisibility('visible');
    await flush();
    expect(listenerCalls).toBe(1);
  });

  it('focus 与 online 各立刻补一拍', async () => {
    renderHook(() => useSessionListRevalidation(true));
    await flush();
    expect(listenerCalls).toBe(0);

    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await flush();
    expect(listenerCalls).toBe(1);

    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    await flush();
    expect(listenerCalls).toBe(2);
  });

  it('卸载：清掉定时器，不再补拍', async () => {
    const view = renderHook(() => useSessionListRevalidation(true));
    await flush(SESSION_LIST_REVALIDATE_INTERVAL_MS);
    expect(listenerCalls).toBe(1);

    view.unmount();
    expect(vi.getTimerCount()).toBe(0);

    await flush(SESSION_LIST_REVALIDATE_INTERVAL_MS * 3);
    expect(listenerCalls).toBe(1);
  });
});
