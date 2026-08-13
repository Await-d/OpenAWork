// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUIStateStore } from '../../../stores/ui/uiState.js';
import {
  getFusionSidebarMocks,
  prepareFusionSidebarMocks,
  renderFusionSidebar,
  resetFusionSidebarUiState,
} from './FusionSidebar.test-utils.js';

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
  prepareFusionSidebarMocks(true);
});

afterEach(() => {
  cleanup();
  resetFusionSidebarUiState(false);
});

describe('FusionSidebar 展开 Panel', () => {
  it('点击新建会话会回到 Chat 首页', async () => {
    renderFusionSidebar('/chat/open-session');

    fireEvent.click(screen.getByRole('button', { name: '新建会话' }));

    expect(useUIStateStore.getState().chatView).toBe('home');
    await waitFor(() => {
      expect(screen.getByTestId('location-probe').textContent).toBe('/chat');
    });
    expect(getFusionSidebarMocks().preloadRouteModuleByPath).toHaveBeenCalledWith('/chat');
  });

  it('选择团队会话时保留 Team 工作台上下文', async () => {
    renderFusionSidebar('/team');

    fireEvent.click(screen.getByRole('button', { name: 'Alpha kickoff' }));

    const signal = useUIStateStore.getState().teamSelectSessionSignal;
    expect(signal?.teamWorkspaceId).toBe('workspace-alpha');
    expect(signal?.sessionId).toBe('team-session-1');
    await waitFor(() => {
      expect(screen.getByTestId('location-probe').textContent).toBe('/team/workspace-alpha');
    });
    expect(getFusionSidebarMocks().preloadRouteModuleByPath).toHaveBeenCalledWith('/team');
  });

  it('团队没有工作区或会话时仍展示团队分区', () => {
    getFusionSidebarMocks().useTeamSidebarSessions.mockReturnValue({
      error: null,
      loading: false,
      refresh: () => undefined,
      sessions: [],
      workspaceGroups: [],
      workspaces: [],
    });

    renderFusionSidebar('/team');

    expect(screen.getByText('暂无团队工作空间')).not.toBeNull();
  });

  it('点击会话行收起 Panel 后，焦点不会残留在 aria-hidden 容器内', () => {
    renderFusionSidebar('/chat/open-session');

    // 将焦点放到 Panel 内的会话按钮上
    const sessionButton = screen.getByRole('button', { name: 'OpenAWork plan' });
    sessionButton.focus();
    expect(document.activeElement).toBe(sessionButton);

    // 通过"收起面板"按钮关闭 Panel（openChatSession 不再关闭 Panel，
    // Panel 收起必须由用户主动点击收起按钮触发）
    fireEvent.click(screen.getByRole('button', { name: '收起面板' }));

    expect(useUIStateStore.getState().leftSidebarOpen).toBe(false);
    const hiddenPanel = document.querySelector('[data-fusion-sidebar-panel="true"]');
    expect(hiddenPanel).not.toBeNull();
    expect(hiddenPanel?.getAttribute('aria-hidden')).toBe('true');
    expect(hiddenPanel?.contains(document.activeElement)).toBe(false);
  });

  it('紧凑视口下通过抽屉承载 Panel，并支持打开后关闭', () => {
    const restoreMatchMedia = installMatchMedia(640);
    prepareFusionSidebarMocks(false);

    try {
      renderFusionSidebar('/chat/open-session');

      expect(screen.getByRole('button', { name: '展开会话侧栏' })).not.toBeNull();
      expect(screen.queryByRole('dialog', { name: '会话侧栏' })).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: '展开会话侧栏' }));

      expect(screen.getByRole('dialog', { name: '会话侧栏' })).not.toBeNull();
      expect(screen.getByRole('button', { name: '关闭会话侧栏' })).not.toBeNull();

      fireEvent.click(screen.getByRole('button', { name: '关闭会话侧栏' }));

      expect(screen.queryByRole('dialog', { name: '会话侧栏' })).toBeNull();
      expect(screen.getByRole('button', { name: '展开会话侧栏' })).not.toBeNull();
    } finally {
      restoreMatchMedia();
    }
  });
});
