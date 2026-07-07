// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router';
import { TitlebarTabStrip } from './TitlebarTabStrip.js';
import { useUIStateStore } from '../../stores/ui/uiState.js';

function resetUiState(): void {
  useUIStateStore.setState({
    activeTabId: null,
    lastChatPath: null,
    tabs: [],
    workbenchLayoutMode: 'fusion',
  });
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-probe">{`${location.pathname}${location.search}`}</div>;
}

function renderTitlebar(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <TitlebarTabStrip />
      <LocationProbe />
    </MemoryRouter>,
  );
}

function installMatchMedia(width: number): () => void {
  const originalMatchMedia = window.matchMedia;

  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => {
      const maxWidth = /max-width:\s*(\d+)px/.exec(query)?.[1];
      const matches = maxWidth ? width <= Number(maxWidth) : false;

      return {
        matches,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      };
    }),
  });

  return () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: originalMatchMedia,
    });
  };
}

beforeEach(() => {
  cleanup();
  resetUiState();
});

afterEach(() => {
  cleanup();
  resetUiState();
});

describe('TitlebarTabStrip', () => {
  it('在 Team workspace 路由下展示 Team 层级摘要并隐藏 Chat 会话标签', () => {
    useUIStateStore.getState().addSessionTab('chat-session-1', 'Chat 会话一');

    renderTitlebar('/team/workspace-alpha?sessionId=team-session-1');

    expect(screen.getByLabelText('Team 工作台层级').textContent).toContain('workspace-alpha');
    expect(screen.getByLabelText('Team 页面内导航提示').textContent).toContain(
      '会话与文件在页内切换',
    );
    expect(screen.queryByLabelText('Team 工作区分区')).toBeNull();
    expect(screen.queryByText('文件树')).toBeNull();
    expect(screen.queryByText('治理')).toBeNull();
    expect(screen.queryByRole('tablist', { name: 'Chat 会话标签' })).toBeNull();
    expect(screen.queryByText('Chat 会话一')).toBeNull();
    expect(screen.getByRole('tab', { name: '首页' })).not.toBeNull();
    expect(screen.getByRole('button', { name: '工具菜单' })).not.toBeNull();
  });

  it('在窄屏 Team 路由下把全局模式与 Team 上下文拆成两层', () => {
    const restoreMatchMedia = installMatchMedia(375);
    try {
      useUIStateStore.getState().addSessionTab('chat-session-1', 'Chat 会话一');

      renderTitlebar('/team/workspace-alpha');

      expect(screen.getByLabelText('全局工作台控制')).not.toBeNull();
      expect(screen.getByLabelText('Team 工作台上下文')).not.toBeNull();
      expect(screen.getByLabelText('Team 工作台层级').textContent).toContain('worksp…');
      expect(screen.getByRole('button', { name: '新建' })).not.toBeNull();
      expect(screen.getByRole('tab', { name: '首页' })).not.toBeNull();
      expect(screen.getByRole('button', { name: '当前布局：融合，切换布局版本' })).not.toBeNull();
      expect(screen.queryByRole('tablist', { name: 'Chat 会话标签' })).toBeNull();
    } finally {
      restoreMatchMedia();
    }
  });

  it('从 Team 顶部首页按钮回到 Chat 首页', () => {
    useUIStateStore.setState({ lastChatPath: '/chat/chat-session-2' });

    renderTitlebar('/team/workspace-alpha');

    fireEvent.click(screen.getByRole('tab', { name: '首页' }));

    expect(screen.getByTestId('location-probe').textContent).toBe('/chat');
  });

  it('在 Chat 路由下保留会话标签，并常驻展示当前布局入口', () => {
    useUIStateStore.getState().addSessionTab('chat-session-1', 'Chat 会话一');

    renderTitlebar('/chat/chat-session-1');

    expect(screen.getByRole('tablist', { name: 'Chat 会话标签' })).not.toBeNull();
    expect(screen.getByText('Chat 会话一')).not.toBeNull();
    expect(screen.getByRole('button', { name: '当前布局：融合，切换布局版本' })).not.toBeNull();
    expect(screen.getByRole('button', { name: '工具菜单' })).not.toBeNull();
  });

  it('顶部布局入口展示 classic/fusion 说明并可切回旧版布局', () => {
    useUIStateStore.getState().addSessionTab('chat-session-1', 'Chat 会话一');

    renderTitlebar('/chat/chat-session-1');

    fireEvent.click(screen.getByRole('button', { name: '当前布局：融合，切换布局版本' }));

    expect(screen.getByRole('menu', { name: '布局版本切换' })).not.toBeNull();
    expect(screen.getByText('旧版侧栏、会话标签与传统工作台展示')).not.toBeNull();
    fireEvent.click(screen.getByRole('menuitemradio', { name: /经典/ }));

    expect(useUIStateStore.getState().workbenchLayoutMode).toBe('classic');
  });

  it('在工具菜单中仍可切换 classic/fusion 布局', () => {
    useUIStateStore.getState().addSessionTab('chat-session-1', 'Chat 会话一');

    renderTitlebar('/chat/chat-session-1');

    fireEvent.click(screen.getByRole('button', { name: '工具菜单' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: '经典' }));

    expect(useUIStateStore.getState().workbenchLayoutMode).toBe('classic');
  });
});
