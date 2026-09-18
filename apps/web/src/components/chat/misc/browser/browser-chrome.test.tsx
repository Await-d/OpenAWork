// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserTabBar } from './browser-chrome.js';
import type { BrowserTab } from './browser-storage.js';

const FIRST_URL = 'https://example.com';
const SECOND_URL = 'http://localhost:3000';

function makeTab(id: string, url: string, title: string): BrowserTab {
  return { id, url, title, history: [url], historyIndex: 0 };
}

function renderTabBar(overrides: Partial<Parameters<typeof BrowserTabBar>[0]> = {}) {
  const handlers = {
    onAddTab: vi.fn(),
    onCloseTab: vi.fn(),
    onSelectTab: vi.fn(),
    onTabContextMenu: vi.fn(),
  };

  render(
    <BrowserTabBar
      tabs={[makeTab('tab-1', FIRST_URL, 'example.com'), makeTab('tab-2', SECOND_URL, 'localhost')]}
      activeTabId="tab-1"
      canAddTab
      {...handlers}
      {...overrides}
    />,
  );

  return handlers;
}

afterEach(() => {
  cleanup();
});

describe('BrowserTabBar', () => {
  it('右键标签上报 tab id 与光标坐标，并拦截原生菜单', () => {
    const handlers = renderTabBar();
    const contextMenuEvent = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 120,
      clientY: 48,
    });

    screen.getByTitle(SECOND_URL).dispatchEvent(contextMenuEvent);

    expect(handlers.onTabContextMenu).toHaveBeenCalledWith('tab-2', 120, 48);
    expect(contextMenuEvent.defaultPrevented).toBe(true);
  });

  it('未提供右键回调时保留浏览器原生菜单', () => {
    renderTabBar({ onTabContextMenu: undefined });
    const contextMenuEvent = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
    });

    screen.getByTitle(FIRST_URL).dispatchEvent(contextMenuEvent);

    expect(contextMenuEvent.defaultPrevented).toBe(false);
  });

  it('中键点击关闭对应标签', () => {
    const handlers = renderTabBar();
    // fireEvent 没有 auxClick helper，直接派发原生事件（React 的 onAuxClick 监听 auxclick）。
    const auxClickEvent = new MouseEvent('auxclick', {
      bubbles: true,
      cancelable: true,
      button: 1,
    });

    screen.getByTitle(FIRST_URL).dispatchEvent(auxClickEvent);

    expect(handlers.onCloseTab).toHaveBeenCalledWith('tab-1');
    expect(auxClickEvent.defaultPrevented).toBe(true);
  });
});
