// @vitest-environment jsdom
/**
 * useChatSidebarLayout — 侧栏开合持久化回归测试
 *
 * leftSidebarOpen 是用户的显式持久化偏好：挂载（含刷新 / 路由重进）不得覆盖它。
 * 历史版本在 hook 挂载时做过「宽屏强制展开」的自愈，导致用户收起面板后一刷新
 * 就被静默重新展开（「关闭状态被忘掉」）；本组测试锁住该回归。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useChatSidebarLayout } from './use-chat-sidebar-layout.js';
import { useUIStateStore } from '../../../stores/ui/uiState.js';

const NARROW_QUERY = '(max-width: 960px)';

function resetUiStateStore(leftSidebarOpen: boolean): void {
  useUIStateStore.setState({ leftSidebarOpen });
}

/** 固定值的 matchMedia 桩：jsdom 未实现 matchMedia，需自行安装。 */
function installStaticMatchMedia(matches: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: query === NARROW_QUERY ? matches : false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

/** 可控 matchMedia 桩：测试运行中切换断点。 */
function installControllableMatchMedia(): { setMatches: (next: boolean) => void } {
  let matches = false;
  const listeners = new Set<() => void>();
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      get matches() {
        return matches;
      },
      media: query,
      onchange: null,
      addEventListener: (_type: string, listener: () => void) => {
        listeners.add(listener);
      },
      removeEventListener: (_type: string, listener: () => void) => {
        listeners.delete(listener);
      },
      addListener: (listener: () => void) => {
        listeners.add(listener);
      },
      removeListener: (listener: () => void) => {
        listeners.delete(listener);
      },
      dispatchEvent: () => false,
    }),
  });
  return {
    setMatches: (next: boolean) => {
      matches = next;
      for (const listener of listeners) {
        listener();
      }
    },
  };
}

beforeEach(() => {
  // jsdom 默认 1024px：落在宽屏断点。
  installStaticMatchMedia(false);
});

afterEach(() => {
  cleanup();
});

describe('useChatSidebarLayout — 挂载不覆盖持久化开关', () => {
  it('宽屏 + 已收起：挂载后保持收起（回归：自愈曾在挂载时强制展开）', () => {
    resetUiStateStore(false);
    const { result } = renderHook(() => useChatSidebarLayout());

    expect(result.current.leftSidebarOpen).toBe(false);
  });

  it('宽屏 + 已展开：挂载后保持展开', () => {
    resetUiStateStore(true);
    const { result } = renderHook(() => useChatSidebarLayout());

    expect(result.current.leftSidebarOpen).toBe(true);
  });

  it('窄屏 + 已展开：挂载后保持展开', () => {
    installStaticMatchMedia(true);
    resetUiStateStore(true);
    const { result } = renderHook(() => useChatSidebarLayout());

    expect(result.current.isNarrowViewport).toBe(true);
    expect(result.current.leftSidebarOpen).toBe(true);
  });

  it('运行中视口跨入窄屏：isNarrowViewport 正常更新（响应式未被破坏）', () => {
    const media = installControllableMatchMedia();
    resetUiStateStore(true);
    const { result } = renderHook(() => useChatSidebarLayout());

    expect(result.current.isNarrowViewport).toBe(false);

    act(() => {
      media.setMatches(true);
    });

    expect(result.current.isNarrowViewport).toBe(true);
    expect(result.current.shouldOverlaySidebar).toBe(true);
  });
});
