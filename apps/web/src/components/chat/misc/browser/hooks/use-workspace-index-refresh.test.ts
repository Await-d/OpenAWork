// @vitest-environment jsdom
/**
 * useWorkspaceIndexRefresh 轮询行为覆盖。
 *
 * 钉住几件容易坏掉的事：只在启用 + 有可监视的绝对工作区路径时轮询；纯 UI 作用域键
 * （`__session__:` / `__default__`）与相对路径直接跳过；首次读取只建立基线不回调；
 * 版本变化（含变小，对应网关重启）才回调；读取失败静默降级、403 直接停轮询；
 * 卸载后清理定时器。
 */

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../../../../stores/auth/auth.js';
import {
  resolveWorkspaceIndexWatchPath,
  useWorkspaceIndexRefresh,
} from './use-workspace-index-refresh.js';

const mocks = vi.hoisted(() => {
  class HttpError<T = unknown> extends Error {
    constructor(
      message: string,
      public readonly status: number,
      public readonly data?: T,
    ) {
      super(message);
      this.name = 'HttpError';
    }
  }
  return { getFileIndexVersion: vi.fn(), HttpError };
});

vi.mock('@openAwork/web-client', () => ({
  createWorkspaceClient: () => ({ getFileIndexVersion: mocks.getFileIndexVersion }),
  HttpError: mocks.HttpError,
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

  it.each(['__session__:session-a', '__default__', 'relative/dir'])(
    '纯 UI 作用域键 / 相对路径（%s）回退到默认工作区（空 path）',
    async (workspacePath) => {
      mocks.getFileIndexVersion.mockResolvedValue({ root: '/default-ws', version: 1 });
      const onChange = vi.fn();
      renderHook(() => useWorkspaceIndexRefresh({ enabled: true, workspacePath, onChange }));

      await flush();
      // 第三个参数是 SSH 读取身份：无身份时网关按本机路径查索引版本，远端会话
      // 会得到 400 并让本 hook 永久 stop()，因此这里断言身份以空对象下发。
      expect(mocks.getFileIndexVersion).toHaveBeenCalledWith('token-1', '', {});
      expect(onChange).not.toHaveBeenCalled();
    },
  );

  it.each([400, 403])('网关 %i 时停止轮询，不再重复请求', async (status) => {
    mocks.getFileIndexVersion.mockRejectedValue(new mocks.HttpError('rejected', status));
    const onChange = vi.fn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      renderHook(() => useWorkspaceIndexRefresh({ enabled: true, workspacePath: '/ws', onChange }));

      await flush();
      expect(mocks.getFileIndexVersion).toHaveBeenCalledTimes(1);

      await advance(10_000);
      expect(mocks.getFileIndexVersion).toHaveBeenCalledTimes(1);
      expect(onChange).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('500 等非确定性失败继续重试', async () => {
    mocks.getFileIndexVersion.mockRejectedValue(new mocks.HttpError('server error', 500));
    const onChange = vi.fn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      renderHook(() => useWorkspaceIndexRefresh({ enabled: true, workspacePath: '/ws', onChange }));

      await flush();
      await advance();
      expect(mocks.getFileIndexVersion.mock.calls.length).toBeGreaterThan(1);
    } finally {
      warn.mockRestore();
    }
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

  it('冷却期内的多次变化合并成一次尾随刷新（Agent 连续写盘不会逐轮 reload）', async () => {
    mocks.getFileIndexVersion.mockResolvedValue({ root: '/ws', version: 1 });
    const onChange = vi.fn();
    renderHook(() =>
      useWorkspaceIndexRefresh({
        enabled: true,
        workspacePath: '/ws',
        onChange,
        minIntervalMs: 8_000,
      }),
    );

    await flush(); // t=0 建立基线
    mocks.getFileIndexVersion.mockResolvedValue({ root: '/ws', version: 2 });
    await advance(2_500); // t=2500 首次变化 → 立即刷新
    expect(onChange).toHaveBeenCalledTimes(1);

    mocks.getFileIndexVersion.mockResolvedValue({ root: '/ws', version: 3 });
    await advance(2_500); // t=5000 冷却中 → 不刷新
    expect(onChange).toHaveBeenCalledTimes(1);

    // t=10500 尾随刷新补齐（最后一次写盘不会被吞掉）。
    await advance(5_500);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('默认就带冷却间隔（不传 minIntervalMs 也生效）', async () => {
    mocks.getFileIndexVersion.mockResolvedValue({ root: '/ws', version: 1 });
    const onChange = vi.fn();
    renderHook(() => useWorkspaceIndexRefresh({ enabled: true, workspacePath: '/ws', onChange }));

    await flush();
    mocks.getFileIndexVersion.mockResolvedValue({ root: '/ws', version: 2 });
    await advance(2_500);
    expect(onChange).toHaveBeenCalledTimes(1);

    mocks.getFileIndexVersion.mockResolvedValue({ root: '/ws', version: 3 });
    await advance(2_500);
    // 没有冷却的话这里会立刻再刷一次。
    expect(onChange).toHaveBeenCalledTimes(1);

    await advance(5_500);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('冷却中的尾随刷新在卸载时被清理', async () => {
    mocks.getFileIndexVersion.mockResolvedValue({ root: '/ws', version: 1 });
    const onChange = vi.fn();
    const { unmount } = renderHook(() =>
      useWorkspaceIndexRefresh({ enabled: true, workspacePath: '/ws', onChange }),
    );

    await flush();
    mocks.getFileIndexVersion.mockResolvedValue({ root: '/ws', version: 2 });
    await advance(2_500);
    expect(onChange).toHaveBeenCalledTimes(1);

    mocks.getFileIndexVersion.mockResolvedValue({ root: '/ws', version: 3 });
    await advance(2_500);

    unmount();
    await advance(10_000);
    expect(onChange).toHaveBeenCalledTimes(1);
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

describe('resolveWorkspaceIndexWatchPath', () => {
  it.each([
    '/ws',
    '/home/user/project',
    'E:\\01.Projects\\OpenAWork',
    'C:/proj',
    '\\\\host\\share',
  ])('绝对文件系统路径（%s）原样返回', (path) => {
    expect(resolveWorkspaceIndexWatchPath(path)).toBe(path);
  });

  it.each([
    '__session__:b3384f61-c634-4162-ac4c-61fda7ef583a',
    '__default__',
    'relative/dir',
    '',
    '   ',
    null,
    undefined,
  ])('非绝对路径 / 空值（%s）返回空串以回退默认工作区', (path) => {
    expect(resolveWorkspaceIndexWatchPath(path)).toBe('');
  });
});
