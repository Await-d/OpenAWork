// @vitest-environment jsdom
/**
 * `useBrowserLiveNavigation` 的导航同步语义。
 *
 * 用假 session 驱动，不需要真实 WS / 浏览器：钉住「同一 URL 只导航一次」、
 * 「非 http(s) 地址跳过」、「刷新信号触发 reload」与「未启用时完全惰性」。
 */

import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserLiveClientMessage } from '@openAwork/shared';
import { useBrowserLiveNavigation } from './use-browser-live-navigation.js';
import type { BrowserLiveSession } from './use-browser-live-session.js';

function makeSession(): BrowserLiveSession & { send: ReturnType<typeof vi.fn> } {
  const send = vi.fn((_message: BrowserLiveClientMessage): void => undefined);
  return {
    availability: null,
    phase: 'idle',
    lastError: null,
    unavailableHint: null,
    send,
    screenshot: vi.fn(async () => null),
    close: vi.fn(),
    recheckAvailability: vi.fn(),
    subscribe: vi.fn(() => () => undefined),
  };
}

interface HookProps {
  session: BrowserLiveSession;
  enabled: boolean;
  url: string;
  refreshKey: number;
}

function renderNavigation(initial: HookProps) {
  return renderHook((props: HookProps) => useBrowserLiveNavigation(props), {
    initialProps: initial,
  });
}

afterEach(() => {
  cleanup();
});

describe('useBrowserLiveNavigation', () => {
  it('首次进入把当前 URL 下发给远端', () => {
    const session = makeSession();
    renderNavigation({ session, enabled: true, url: 'https://example.test/app', refreshKey: 0 });

    expect(session.send).toHaveBeenCalledTimes(1);
    expect(session.send).toHaveBeenCalledWith({
      ch: 'control',
      action: 'navigate',
      url: 'https://example.test/app',
    });
  });

  it('同一 URL 不重复导航，地址变更才重新下发', () => {
    const session = makeSession();
    const view = renderNavigation({
      session,
      enabled: true,
      url: 'https://example.test/app',
      refreshKey: 0,
    });

    view.rerender({
      session,
      enabled: true,
      url: 'https://example.test/app',
      refreshKey: 0,
    });
    expect(session.send).toHaveBeenCalledTimes(1);

    view.rerender({
      session,
      enabled: true,
      url: 'https://example.test/other',
      refreshKey: 0,
    });
    expect(session.send).toHaveBeenCalledTimes(2);
    expect(session.send).toHaveBeenLastCalledWith({
      ch: 'control',
      action: 'navigate',
      url: 'https://example.test/other',
    });
  });

  it('about:blank 等非 http(s) 地址不下发导航', () => {
    const session = makeSession();
    const view = renderNavigation({
      session,
      enabled: true,
      url: 'about:blank',
      refreshKey: 0,
    });

    expect(session.send).not.toHaveBeenCalled();

    // 占位页不导航，但地址一旦变成可导航值必须补发。
    view.rerender({ session, enabled: true, url: 'http://localhost:5173', refreshKey: 0 });
    expect(session.send).toHaveBeenCalledTimes(1);
  });

  it('刷新信号变化触发 reload，未变化不重复下发', () => {
    const session = makeSession();
    const view = renderNavigation({
      session,
      enabled: true,
      url: 'https://example.test/app',
      refreshKey: 0,
    });

    view.rerender({ session, enabled: true, url: 'https://example.test/app', refreshKey: 0 });
    expect(session.send).toHaveBeenCalledTimes(1);

    view.rerender({ session, enabled: true, url: 'https://example.test/app', refreshKey: 1 });
    expect(session.send).toHaveBeenCalledTimes(2);
    expect(session.send).toHaveBeenLastCalledWith({ ch: 'control', action: 'reload' });
  });

  it('未启用时完全惰性', () => {
    const session = makeSession();
    const view = renderNavigation({
      session,
      enabled: false,
      url: 'https://example.test/app',
      refreshKey: 0,
    });

    expect(session.send).not.toHaveBeenCalled();

    view.rerender({ session, enabled: false, url: 'https://example.test/other', refreshKey: 1 });
    expect(session.send).not.toHaveBeenCalled();
  });

  it('启用后补发当前地址（启用前的变化不丢）', () => {
    const session = makeSession();
    const view = renderNavigation({
      session,
      enabled: false,
      url: 'https://example.test/app',
      refreshKey: 0,
    });

    view.rerender({ session, enabled: true, url: 'https://example.test/app', refreshKey: 0 });
    expect(session.send).toHaveBeenCalledWith({
      ch: 'control',
      action: 'navigate',
      url: 'https://example.test/app',
    });
  });
});
