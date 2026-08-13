// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router';
import { TitlebarTabStrip } from './TitlebarTabStrip.js';
import { useUIStateStore } from '../../../stores/ui/uiState.js';

const tauriWindowControls = vi.hoisted(() => ({
  close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  minimize: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  toggleMaximize: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => tauriWindowControls,
}));

vi.mock('../../../hooks/workspace/useSessions.js', () => ({
  useSessions: () => ({
    sessions: [
      { id: 'chat-session-1', title: 'Chat 会话一', workspacePath: null },
      { id: 'chat-session-2', title: 'Chat 会话二', workspacePath: null },
    ],
    groupedSessions: [],
    groupedSessionTrees: [],
    sessionCountByWorkspace: new Map(),
    collapsedGroups: new Set(),
    toggleGroupCollapsed: vi.fn(),
    renamingSessionId: null,
    renameValue: '',
    setRenameValue: vi.fn(),
    hoveredSessionId: null,
    setHoveredSessionId: vi.fn(),
    isDeletingSession: false,
    sessionSearch: '',
    setSessionSearch: vi.fn(),
    startRename: vi.fn(),
    commitRename: vi.fn(),
    quickDeleteSession: vi.fn(),
    quickExportSession: vi.fn(),
  }),
}));

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

function installDesktopRuntime(platform: string, userAgent: string): () => void {
  const isTauriDescriptor = Object.getOwnPropertyDescriptor(window, 'isTauri');
  const platformDescriptor = Object.getOwnPropertyDescriptor(navigator, 'platform');
  const userAgentDescriptor = Object.getOwnPropertyDescriptor(navigator, 'userAgent');

  Object.defineProperty(window, 'isTauri', {
    configurable: true,
    writable: true,
    value: true,
  });
  Object.defineProperty(navigator, 'platform', {
    configurable: true,
    value: platform,
  });
  Object.defineProperty(navigator, 'userAgent', {
    configurable: true,
    value: userAgent,
  });

  return () => {
    if (isTauriDescriptor) {
      Object.defineProperty(window, 'isTauri', isTauriDescriptor);
    } else {
      delete (window as Window & { isTauri?: boolean }).isTauri;
    }

    if (platformDescriptor) {
      Object.defineProperty(navigator, 'platform', platformDescriptor);
    }

    if (userAgentDescriptor) {
      Object.defineProperty(navigator, 'userAgent', userAgentDescriptor);
    }
  };
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
  tauriWindowControls.close.mockClear();
  tauriWindowControls.minimize.mockClear();
  tauriWindowControls.toggleMaximize.mockClear();
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
      expect(screen.getByRole('tab', { name: '首页' })).not.toBeNull();
      expect(screen.queryByRole('tablist', { name: 'Chat 会话标签' })).toBeNull();
      expect(screen.queryByRole('button', { name: '工具菜单' })).not.toBeNull();
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
    expect(screen.getByRole('button', { name: '工具菜单' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: '新建会话' })).toBeNull();
  });

  it('关闭当前激活的会话标签后不会被路由同步 effect 重新加回', async () => {
    useUIStateStore.getState().addSessionTab('chat-session-1', 'Chat 会话一');
    useUIStateStore.getState().addSessionTab('chat-session-2', 'Chat 会话二');
    useUIStateStore
      .getState()
      .selectTab(
        useUIStateStore.getState().tabs.find((tab) => tab.sessionId === 'chat-session-1')!.id,
      );

    renderTitlebar('/chat/chat-session-1');

    fireEvent.click(screen.getAllByRole('button', { name: '关闭标签' })[0]!);

    await waitFor(() => {
      expect(screen.getByTestId('location-probe').textContent).toBe('/chat/chat-session-2');
    });

    const tabs = useUIStateStore.getState().tabs;
    expect(tabs).toHaveLength(1);
    expect(tabs[0]!.sessionId).toBe('chat-session-2');
  });

  it('在工具菜单中仍可切换 classic/fusion 布局', () => {
    useUIStateStore.getState().addSessionTab('chat-session-1', 'Chat 会话一');

    renderTitlebar('/chat/chat-session-1');

    fireEvent.click(screen.getByRole('button', { name: '工具菜单' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /经典/ }));

    expect(useUIStateStore.getState().workbenchLayoutMode).toBe('classic');
  });

  it('仅在 macOS Tauri 环境下展示交通灯并触发窗口控制', async () => {
    const restoreDesktopRuntime = installDesktopRuntime('MacIntel', 'Mozilla/5.0 (Macintosh)');

    try {
      renderTitlebar('/chat');

      expect(screen.getByLabelText('窗口控制')).not.toBeNull();

      fireEvent.click(screen.getByRole('button', { name: '最小化窗口' }));
      await waitFor(() => {
        expect(tauriWindowControls.minimize).toHaveBeenCalledTimes(1);
      });

      fireEvent.click(screen.getByRole('button', { name: '切换窗口最大化' }));
      await waitFor(() => {
        expect(tauriWindowControls.toggleMaximize).toHaveBeenCalledTimes(1);
      });

      fireEvent.click(screen.getByRole('button', { name: '关闭窗口' }));
      await waitFor(() => {
        expect(tauriWindowControls.close).toHaveBeenCalledTimes(1);
      });
    } finally {
      restoreDesktopRuntime();
    }
  });

  it('在普通 Web 环境下隐藏交通灯', () => {
    renderTitlebar('/chat');

    expect(screen.queryByLabelText('窗口控制')).toBeNull();
  });
});
