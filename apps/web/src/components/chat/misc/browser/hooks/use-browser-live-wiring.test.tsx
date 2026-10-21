// @vitest-environment jsdom
/**
 * 接线层的事件归属：控制台 / 网络 / 异常都必须按**页面代次**过滤。
 *
 * 快速切标签时旧页面的最后几条事件会晚到，只按「当前激活标签」归属就会记到新标签
 * 上——用户看到的是「新标签里冒出上一个页面的日志」。
 */

import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserLiveEnvelope } from '@openAwork/shared';

import { useBrowserLiveWiring } from './use-browser-live-wiring.js';

/** 每个用例一个可手动派发信封的假会话。 */
const sessionMocks = vi.hoisted(() => {
  const listeners = new Set<(envelope: unknown) => void>();
  return {
    listeners,
    reset: () => listeners.clear(),
    emit: (envelope: unknown) => {
      for (const listener of [...listeners]) listener(envelope);
    },
  };
});

vi.mock('./use-browser-live-session.js', () => ({
  useBrowserLiveSession: () => ({
    availability: null,
    phase: 'connected',
    lastError: null,
    unavailableHint: null,
    send: () => undefined,
    screenshot: () => Promise.resolve(null),
    close: () => undefined,
    recheckAvailability: () => undefined,
    subscribe: (listener: (envelope: unknown) => void) => {
      sessionMocks.listeners.add(listener);
      return () => {
        sessionMocks.listeners.delete(listener);
      };
    },
  }),
}));

vi.mock('@openAwork/web-client', () => ({
  createBrowserLiveClient: () => ({
    getStatus: vi.fn(),
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    screenshot: vi.fn(),
    installBrowser: vi.fn(),
    getInstallStatus: vi.fn(),
  }),
}));

vi.mock('../../../../../stores/auth/auth.js', () => ({
  useAuthStore: (selector: (state: { accessToken: null; gatewayUrl: string }) => unknown) =>
    selector({ accessToken: null, gatewayUrl: 'http://localhost:3000' }),
}));

function consoleEnvelope(generation?: number): BrowserLiveEnvelope {
  return {
    ch: 'console',
    seq: 1,
    ts: 0,
    payload: {
      level: 'log',
      text: 'hello',
      timestamp: 0,
      ...(generation !== undefined ? { generation } : {}),
    },
  } as BrowserLiveEnvelope;
}

function networkEnvelope(generation?: number): BrowserLiveEnvelope {
  return {
    ch: 'network',
    seq: 2,
    ts: 0,
    payload: {
      phase: 'request',
      requestId: 'req-1',
      method: 'GET',
      url: 'https://example.test/x',
      ...(generation !== undefined ? { generation } : {}),
    },
  } as BrowserLiveEnvelope;
}

beforeEach(() => {
  sessionMocks.reset();
});

afterEach(() => {
  cleanup();
});

describe('useBrowserLiveWiring 事件归属', () => {
  it('低于门槛的日志与请求被丢弃（旧页面事件晚到）', () => {
    const appendLog = vi.fn();
    const upsertNetwork = vi.fn();
    const minGenerationRef = { current: 5 };
    renderHook(() => useBrowserLiveWiring({ appendLog, upsertNetwork, minGenerationRef }));

    sessionMocks.emit(consoleEnvelope(4));
    sessionMocks.emit(networkEnvelope(4));

    expect(appendLog).not.toHaveBeenCalled();
    expect(upsertNetwork).not.toHaveBeenCalled();
  });

  it('达到门槛的事件正常记录', () => {
    const appendLog = vi.fn();
    const upsertNetwork = vi.fn();
    const minGenerationRef = { current: 5 };
    renderHook(() => useBrowserLiveWiring({ appendLog, upsertNetwork, minGenerationRef }));

    sessionMocks.emit(consoleEnvelope(5));
    sessionMocks.emit(networkEnvelope(5));

    expect(appendLog).toHaveBeenCalledTimes(1);
    expect(upsertNetwork).toHaveBeenCalledTimes(1);
  });

  it('未设置门槛或事件不带代次时不过滤（老网关行为不变）', () => {
    const appendLog = vi.fn();
    const upsertNetwork = vi.fn();
    renderHook(() =>
      useBrowserLiveWiring({ appendLog, upsertNetwork, minGenerationRef: { current: null } }),
    );

    // 门槛未知：即便事件带代次也照常记录。
    sessionMocks.emit(consoleEnvelope(1));
    // 门槛已知但事件不带代次：无法判定，按原行为记录。
    sessionMocks.emit(networkEnvelope());

    expect(appendLog).toHaveBeenCalledTimes(1);
    expect(upsertNetwork).toHaveBeenCalledTimes(1);
  });
});
