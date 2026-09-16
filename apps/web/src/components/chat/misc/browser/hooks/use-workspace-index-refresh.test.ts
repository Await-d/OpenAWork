// @vitest-environment jsdom
/**
 * useWorkspaceIndexRefresh 轮询行为覆盖。
 *
 * 钉住几件容易坏掉的事：只在启用 + 有工作区路径时轮询；首次读取只建立基线不回调；
 * 版本变化（含变小，对应网关重启）才回调；读取失败静默降级；卸载后清理定时器。
 */

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../../../../stores/auth/auth.js';
import { useWorkspaceIndexRefresh } from './use-workspace-index-refresh.js';

const mocks = vi.hoisted(() => ({
  getFileIndexVersion: vi.fn(),
}));

vi.mock('@openAwork/web-client', () => ({
  createWorkspaceClient: () => ({ getFileIndexVersion: mocks.getFileIndexVersion }),
}));

/** 刷新微任务队列，让上一次 poll 的 promise 结算。 */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** 前进一个轮询周期并结算其 promise。 */
async function advance(ms = 2500): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.getFileIndexVersion.mockReset();
  useAuthStore.setState({ accessToken: 'token-1', gatewayUrl: 'http://gw.test' });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  useAuthStore.setState({ accessToken: null });
});

describe('useWorkspaceIndexRefresh', () => {
  it('首次读取只建立基线，版本变化后才触发 onChange', async () => {
    mocks.getFileIndexVersion.mockResolvedValue({ root: '/ws', version: 1 });
    const onChange = vi.fn();
    renderHook(() => useWorkspaceIndexRefresh({ enabled: true, workspacePath: '/ws', onChange }));

    await flush();
    expect(mocks.getFileIndexVersion).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();

    await advance();
    expect(mocks.getFileIndexVersion).toHaveBeenCalledTimes(2);
    expect(onChange).not.toHaveBeenCalled();

    mocks.getFileIndexVersion.mockResolvedValue({ root: '/ws', version: 2 });
    await advance();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('版本变小时同样视为变化（网关重启场景）', async () => {
    mocks.getFileIndexVersion.mockResolvedValue({ root: '/ws', version: 5 });
    const onChange = vi.fn();
    renderHook(() => useWorkspaceIndexRefresh({ enabled: true, workspacePath: '/ws', onChange }));

    await flush();
    expect(onChange).not.toHaveBeenCalled();

    mocks.getFileIndexVersion.mockResolvedValue({ root: '/ws', version: 1 });
    await advance();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('禁用时不轮询', async () => {
    const onChange = vi.fn();
    renderHook(() => useWorkspaceIndexRefresh({ enabled: false, workspacePath: '/ws', onChange }));

    await advance(10_000);
    expect(mocks.getFileIndexVersion).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('workspacePath 为空时不轮询', async () => {
    const onChange = vi.fn();
    renderHook(() => useWorkspaceIndexRefresh({ enabled: true, workspacePath: '   ', onChange }));

    await advance(10_000);
    expect(mocks.getFileIndexVersion).not.toHaveBeenCalled();
  });

  it('读取失败时静默降级且不抛出', async () => {
    mocks.getFileIndexVersion.mockRejectedValue(new Error('boom'));
    const onChange = vi.fn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      renderHook(() => useWorkspaceIndexRefresh({ enabled: true, workspacePath: '/ws', onChange }));

      await flush();
      await advance();
      expect(onChange).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('卸载后清理定时器，不再发起请求', async () => {
    mocks.getFileIndexVersion.mockResolvedValue({ root: '/ws', version: 1 });
    const onChange = vi.fn();
    const { unmount } = renderHook(() =>
      useWorkspaceIndexRefresh({ enabled: true, workspacePath: '/ws', onChange }),
    );

    await flush();
    const callsBeforeUnmount = mocks.getFileIndexVersion.mock.calls.length;

    unmount();
    await advance(10_000);

    expect(mocks.getFileIndexVersion.mock.calls.length).toBe(callsBeforeUnmount);
  });
});
