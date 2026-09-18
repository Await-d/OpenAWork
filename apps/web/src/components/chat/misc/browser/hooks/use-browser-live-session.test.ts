// @vitest-environment jsdom
/**
 * `useBrowserLiveSession` 的连接生命周期覆盖。
 *
 * 用假的 `createBrowserLiveClient` 驱动整条通道：握手可用性 → 建连 → 掉线退避
 * 重连，并确认重连成功后重新请求 screencast（hub 只为新 controller 恢复产帧）。
 * 全程不启动真实浏览器 / WebSocket。
 */

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserLiveCallbacks, BrowserLiveStatus } from '@openAwork/web-client';
import {
  BROWSER_LIVE_DISABLED_REASON,
  BROWSER_LIVE_MAX_PENDING_SENDS,
  describeBrowserLiveUnavailable,
  useBrowserLiveSession,
} from './use-browser-live-session.js';
import type { BrowserLiveScreenshotFrame } from './use-browser-live-session.js';
import { useAuthStore } from '../../../../../stores/auth/auth.js';

const mocks = vi.hoisted(() => {
  const getStatus = vi.fn();
  const connect = vi.fn();
  const client = {
    getStatus,
    connect,
    start: vi.fn(),
    stop: vi.fn(),
    screenshot: vi.fn(),
  };
  return { client, getStatus, connect, createBrowserLiveClient: vi.fn(() => client) };
});

vi.mock('@openAwork/web-client', () => ({
  createBrowserLiveClient: mocks.createBrowserLiveClient,
  acquireRefresh: vi.fn(async () => undefined),
}));

const AVAILABLE_STATUS: BrowserLiveStatus = {
  available: true,
  engine: 'chromium',
  screencast: true,
};

interface FakeConnection {
  send: ReturnType<typeof vi.fn>;
  readyState: number;
  close: ReturnType<typeof vi.fn>;
}

interface FakeConnectionEntry {
  callbacks: BrowserLiveCallbacks;
  connection: FakeConnection;
}

function installFakeConnections(): FakeConnectionEntry[] {
  const connections: FakeConnectionEntry[] = [];
  mocks.connect.mockImplementation(
    (input: { token: string; callbacks: BrowserLiveCallbacks }): FakeConnection => {
      const connection: FakeConnection = {
        send: vi.fn(),
        readyState: 1,
        close: vi.fn(),
      };
      connections.push({ callbacks: input.callbacks, connection });
      return connection;
    },
  );
  return connections;
}

/** 首个下行信封（hello）代表网关已挂上消息监听：hook 收到它才会冲刷待发队列。 */
function deliverHello(entry: FakeConnectionEntry | undefined, screencast = false): void {
  entry?.callbacks.onEnvelope({
    ch: 'hello',
    seq: 0,
    ts: 1,
    payload: { available: true, engine: 'chromium', screencast, viewport: null },
  });
}

function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  const holder: { resolve: (value: T) => void } = { resolve: () => undefined };
  const promise = new Promise<T>((resolve) => {
    holder.resolve = resolve;
  });
  return { promise, resolve: (value: T) => holder.resolve(value) };
}

/** 渲染 hook 并冲刷首轮 effect 的微任务。 */
async function renderLiveSession() {
  const rendered = renderHook(() => useBrowserLiveSession({ enabled: true }));
  await act(async () => {
    await Promise.resolve();
  });
  return rendered;
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.createBrowserLiveClient.mockClear();
  mocks.getStatus.mockReset();
  mocks.connect.mockReset();
  useAuthStore.setState({ accessToken: 'live-token', gatewayUrl: 'http://gateway.test' });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  useAuthStore.setState({ accessToken: null });
});

describe('useBrowserLiveSession', () => {
  it('未登录时不建连也不请求状态', async () => {
    useAuthStore.setState({ accessToken: null });
    const { result } = await renderLiveSession();

    expect(mocks.createBrowserLiveClient).not.toHaveBeenCalled();
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(result.current.phase).toBe('idle');
  });

  it('状态不可用时不建连', async () => {
    mocks.getStatus.mockResolvedValue({
      available: false,
      engine: null,
      screencast: false,
      reason: 'disabled',
    } satisfies BrowserLiveStatus);

    const { result } = await renderLiveSession();
    await act(async () => {
      await Promise.resolve();
    });

    expect(mocks.connect).not.toHaveBeenCalled();
    expect(result.current.phase).toBe('idle');
    expect(result.current.availability?.available).toBe(false);
  });

  it.each([
    ['browser-missing', '安装 Chrome/Edge'],
    ['browser-outdated', '重新执行 npx playwright install chromium'],
    ['probe-failed', '稍后重试'],
    [BROWSER_LIVE_DISABLED_REASON, 'OPENAWORK_BROWSER_LIVE=1'],
  ] as const)('reason=%s 时状态不可用、不建连并给出对应中文提示', async (reason, hintFragment) => {
    mocks.getStatus.mockResolvedValue({
      available: false,
      engine: 'chromium',
      screencast: false,
      reason,
    } satisfies BrowserLiveStatus);

    const { result } = await renderLiveSession();
    await act(async () => {
      await Promise.resolve();
    });

    expect(mocks.connect).not.toHaveBeenCalled();
    expect(result.current.phase).toBe('idle');
    expect(result.current.availability).toMatchObject({ available: false, reason });
    expect(result.current.unavailableHint).toContain(hintFragment);
  });

  it('状态可用时不产生不可用提示', async () => {
    mocks.getStatus.mockResolvedValue(AVAILABLE_STATUS);

    const { result } = await renderLiveSession();
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.unavailableHint).toBeNull();
  });

  it('recheckAvailability 强制重新探测可用性', async () => {
    mocks.getStatus.mockResolvedValue({
      available: false,
      engine: null,
      screencast: false,
      reason: 'browser-missing',
    } satisfies BrowserLiveStatus);

    const { result } = await renderLiveSession();
    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.getStatus).toHaveBeenCalledTimes(1);

    mocks.getStatus.mockResolvedValue(AVAILABLE_STATUS);
    act(() => {
      result.current.recheckAvailability();
    });

    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.getStatus).toHaveBeenCalledTimes(2);
    expect(result.current.availability?.available).toBe(true);
  });

  it('可用时建连，open 后进入 connected，hello 后请求 screencast', async () => {
    const status = createDeferred<BrowserLiveStatus>();
    mocks.getStatus.mockReturnValue(status.promise);
    const connections = installFakeConnections();

    const { result } = await renderLiveSession();
    expect(mocks.createBrowserLiveClient).toHaveBeenCalledWith('http://gateway.test');
    expect(mocks.connect).not.toHaveBeenCalled();

    await act(async () => {
      status.resolve(AVAILABLE_STATUS);
    });

    expect(mocks.connect).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe('connecting');
    expect(result.current.availability?.available).toBe(true);

    act(() => {
      connections[0]?.callbacks.onOpen?.();
    });
    expect(result.current.phase).toBe('connected');
    expect(connections[0]?.connection.send).not.toHaveBeenCalled();

    act(() => {
      connections[0]?.callbacks.onEnvelope({
        ch: 'hello',
        seq: 0,
        ts: 1,
        payload: { available: true, engine: 'chromium', screencast: true, viewport: null },
      });
    });

    expect(connections[0]?.connection.send).toHaveBeenCalledWith({
      ch: 'control',
      action: 'screencast.start',
    });
  });

  it('hello 刷新可用性（screencast 能力以会话为准），不支持 screencast 时不请求', async () => {
    mocks.getStatus.mockResolvedValue({
      available: true,
      engine: null,
      screencast: false,
    } satisfies BrowserLiveStatus);
    const connections = installFakeConnections();

    const { result } = await renderLiveSession();
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      connections[0]?.callbacks.onEnvelope({
        ch: 'hello',
        seq: 0,
        ts: 1,
        payload: { available: true, engine: 'firefox', screencast: false, viewport: null },
      });
    });

    expect(result.current.availability?.screencast).toBe(false);
    expect(result.current.availability?.engine).toBe('firefox');
    expect(connections[0]?.connection.send).not.toHaveBeenCalled();
  });

  it('建连前 send 的消息在首个下行信封（hello）后按 FIFO 补发', async () => {
    const status = createDeferred<BrowserLiveStatus>();
    mocks.getStatus.mockReturnValue(status.promise);
    const connections = installFakeConnections();

    const { result } = await renderLiveSession();
    act(() => {
      result.current.send({ ch: 'control', action: 'navigate', url: 'https://example.test/' });
      result.current.send({ ch: 'control', action: 'screencast.start' });
    });
    expect(connections).toHaveLength(0);

    await act(async () => {
      status.resolve(AVAILABLE_STATUS);
    });

    // 网关在 hello 之前仍处于 acquire，尚未处理上行消息：此刻下发会被丢弃，必须继续等待。
    expect(connections).toHaveLength(1);
    expect(connections[0]?.connection.send).not.toHaveBeenCalled();

    act(() => {
      deliverHello(connections[0]);
    });

    expect(connections[0]?.connection.send.mock.calls).toEqual([
      [{ ch: 'control', action: 'navigate', url: 'https://example.test/' }],
      [{ ch: 'control', action: 'screencast.start' }],
    ]);
  });

  it('待发队列有界：溢出时丢弃最旧的消息', async () => {
    const status = createDeferred<BrowserLiveStatus>();
    mocks.getStatus.mockReturnValue(status.promise);
    const connections = installFakeConnections();

    const { result } = await renderLiveSession();
    act(() => {
      for (let index = 0; index <= BROWSER_LIVE_MAX_PENDING_SENDS; index += 1) {
        result.current.send({
          ch: 'control',
          action: 'navigate',
          url: `https://example.test/${index}`,
        });
      }
    });

    await act(async () => {
      status.resolve(AVAILABLE_STATUS);
    });
    act(() => {
      deliverHello(connections[0]);
    });

    const delivered = connections[0]?.connection.send.mock.calls ?? [];
    expect(delivered).toHaveLength(BROWSER_LIVE_MAX_PENDING_SENDS);
    expect(delivered[0]?.[0]).toEqual({
      ch: 'control',
      action: 'navigate',
      url: 'https://example.test/1',
    });
    expect(delivered[delivered.length - 1]?.[0]).toEqual({
      ch: 'control',
      action: 'navigate',
      url: `https://example.test/${BROWSER_LIVE_MAX_PENDING_SENDS}`,
    });
  });

  it('重连窗口内 send 的消息在重连成功后按序补发', async () => {
    mocks.getStatus.mockResolvedValue(AVAILABLE_STATUS);
    const connections = installFakeConnections();

    const { result } = await renderLiveSession();
    await act(async () => {
      await Promise.resolve();
    });
    act(() => {
      connections[0]?.callbacks.onOpen?.();
    });
    act(() => {
      connections[0]?.callbacks.onClose?.({ code: 1006, reason: 'dropped' });
    });

    act(() => {
      result.current.send({ ch: 'control', action: 'navigate', url: 'https://example.test/retry' });
    });
    expect(connections[1]).toBeUndefined();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(connections).toHaveLength(2);
    act(() => {
      deliverHello(connections[1]);
    });

    expect(connections[1]?.connection.send.mock.calls).toEqual([
      [{ ch: 'control', action: 'navigate', url: 'https://example.test/retry' }],
    ]);
  });

  it('close() 清空待发队列，不把旧消息补发到后续连接', async () => {
    mocks.getStatus.mockResolvedValue(AVAILABLE_STATUS);
    const connections = installFakeConnections();

    const { result } = await renderLiveSession();
    await act(async () => {
      await Promise.resolve();
    });
    act(() => {
      connections[0]?.callbacks.onOpen?.();
    });
    act(() => {
      connections[0]?.callbacks.onClose?.({ code: 1006, reason: 'dropped' });
    });

    act(() => {
      result.current.send({ ch: 'control', action: 'navigate', url: 'https://example.test/stale' });
      result.current.close();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(connections).toHaveLength(2);
    act(() => {
      deliverHello(connections[1]);
    });

    expect(connections[1]?.connection.send).not.toHaveBeenCalled();
  });

  it('掉线后按 500ms 退避重连，成功后重发 screencast.start', async () => {
    mocks.getStatus.mockResolvedValue(AVAILABLE_STATUS);
    const connections = installFakeConnections();

    const { result } = await renderLiveSession();
    await act(async () => {
      await Promise.resolve();
    });
    expect(connections).toHaveLength(1);

    act(() => {
      connections[0]?.callbacks.onOpen?.();
    });
    expect(result.current.phase).toBe('connected');

    act(() => {
      connections[0]?.callbacks.onClose?.({ code: 1006, reason: 'dropped' });
    });
    expect(result.current.phase).toBe('reconnecting');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(499);
    });
    expect(connections).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(connections).toHaveLength(2);
    expect(result.current.phase).toBe('reconnecting');

    act(() => {
      connections[1]?.callbacks.onOpen?.();
    });
    expect(result.current.phase).toBe('connected');

    act(() => {
      connections[1]?.callbacks.onEnvelope({
        ch: 'hello',
        seq: 0,
        ts: 1,
        payload: { available: true, engine: 'chromium', screencast: true, viewport: null },
      });
    });

    expect(connections[1]?.connection.send).toHaveBeenCalledWith({
      ch: 'control',
      action: 'screencast.start',
    });
  });

  it('退避到 1s / 2s / 4s，5 次重连用尽后进入 error', async () => {
    mocks.getStatus.mockResolvedValue(AVAILABLE_STATUS);
    const connections = installFakeConnections();

    const { result } = await renderLiveSession();
    await act(async () => {
      await Promise.resolve();
    });

    const delays = [500, 1000, 2000, 4000, 4000];
    let index = 0;
    act(() => {
      connections[index]?.callbacks.onOpen?.();
    });

    for (const delay of delays) {
      act(() => {
        connections[index]?.callbacks.onClose?.({ code: 1006, reason: '' });
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(delay);
      });
      index += 1;
    }

    expect(connections).toHaveLength(6);

    act(() => {
      connections[5]?.callbacks.onClose?.({ code: 1006, reason: 'gone' });
    });

    expect(result.current.phase).toBe('error');
    expect(result.current.lastError).toContain('实时通道已断开');
  });

  it('screenshot 走控制通道并在 screenshot 信封到达后返回内联帧', async () => {
    mocks.getStatus.mockResolvedValue(AVAILABLE_STATUS);
    const connections = installFakeConnections();

    const { result } = await renderLiveSession();
    await act(async () => {
      await Promise.resolve();
    });
    act(() => {
      connections[0]?.callbacks.onOpen?.();
    });

    const pending: Promise<BrowserLiveScreenshotFrame | null> = result.current.screenshot({
      fullPage: true,
    });

    expect(connections[0]?.connection.send).toHaveBeenCalledWith({
      ch: 'control',
      action: 'screenshot',
      fullPage: true,
    });

    await act(async () => {
      connections[0]?.callbacks.onEnvelope({
        ch: 'screenshot',
        seq: 2,
        ts: 2,
        payload: { data: 'AAAA', mimeType: 'image/jpeg', fullPage: true },
      });
    });

    await expect(pending).resolves.toEqual({
      data: 'AAAA',
      mimeType: 'image/jpeg',
      fullPage: true,
    });
  });

  it('subscribe 扇出下行信封，退订后不再收到', async () => {
    mocks.getStatus.mockResolvedValue(AVAILABLE_STATUS);
    const connections = installFakeConnections();

    const { result } = await renderLiveSession();
    await act(async () => {
      await Promise.resolve();
    });

    const seen: string[] = [];
    const unsubscribe = result.current.subscribe((envelope) => {
      seen.push(envelope.ch);
    });

    act(() => {
      connections[0]?.callbacks.onEnvelope({ ch: 'pong', seq: 1, ts: 1, payload: {} });
    });
    expect(seen).toEqual(['pong']);

    unsubscribe();
    act(() => {
      connections[0]?.callbacks.onEnvelope({ ch: 'pong', seq: 2, ts: 2, payload: {} });
    });
    expect(seen).toEqual(['pong']);
  });

  it('close() 后掉线不再重连', async () => {
    mocks.getStatus.mockResolvedValue(AVAILABLE_STATUS);
    const connections = installFakeConnections();

    const { result } = await renderLiveSession();
    await act(async () => {
      await Promise.resolve();
    });
    act(() => {
      connections[0]?.callbacks.onOpen?.();
    });

    act(() => {
      result.current.close();
    });
    expect(result.current.phase).toBe('idle');
    expect(connections[0]?.connection.close).toHaveBeenCalledTimes(1);

    act(() => {
      connections[0]?.callbacks.onClose?.({ code: 1000, reason: '' });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(connections).toHaveLength(1);
    expect(result.current.phase).toBe('idle');
  });
});

describe('describeBrowserLiveUnavailable', () => {
  it('为每个 reason token 给出可操作的中文提示', () => {
    expect(describeBrowserLiveUnavailable('browser-missing')).toContain('安装 Chrome/Edge');
    expect(describeBrowserLiveUnavailable('browser-missing')).toContain(
      'npx playwright install chromium',
    );
    expect(describeBrowserLiveUnavailable('browser-outdated')).toContain(
      '重新执行 npx playwright install chromium',
    );
    expect(describeBrowserLiveUnavailable('probe-failed')).toContain('稍后重试');
  });

  it('disabled-runtime 契约串映射到开关提示而不是通用兜底', () => {
    const hint = describeBrowserLiveUnavailable(BROWSER_LIVE_DISABLED_REASON);

    expect(hint).toContain('OPENAWORK_BROWSER_LIVE=1');
    expect(hint).toContain('DESKTOP_AUTOMATION=1');
    // 近似串不算命中契约：只有网关原样下发的完整串才给开关提示。
    expect(describeBrowserLiveUnavailable('browser live view is disabled')).not.toContain(
      'OPENAWORK_BROWSER_LIVE=1',
    );
  });

  it('未知 reason 只给通用提示，不外泄原始 token', () => {
    const hint = describeBrowserLiveUnavailable('browser-binary-missing');

    expect(hint).not.toContain('browser-binary-missing');
    expect(hint).toContain('iframe 预览');
  });

  it('无 reason 时返回 null', () => {
    expect(describeBrowserLiveUnavailable(null)).toBeNull();
    expect(describeBrowserLiveUnavailable(undefined)).toBeNull();
    expect(describeBrowserLiveUnavailable('')).toBeNull();
  });
});
