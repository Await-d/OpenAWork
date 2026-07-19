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
    renderFusionSidebar('/team/workspace-alpha');

    fireEvent.click(screen.getByRole('button', { name: '新建会话' }));

    expect(useUIStateStore.getState().chatView).toBe('home');
    await waitFor(() => {
      expect(screen.getByTestId('location-probe').textContent).toBe('/chat');
    });
    expect(getFusionSidebarMocks().preloadRouteModuleByPath).toHaveBeenCalledWith('/chat');
  });

  it('工作区头像切换后 Panel 只展示当前工作区会话', () => {
    renderFusionSidebar('/chat/open-session');

    expect(screen.getByRole('button', { name: 'OpenAWork plan' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Market roadmap' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /切换工作区 MA/ }));

    expect(useUIStateStore.getState().selectedWorkspacePath).toBe(
      '/home/await/project/MarketAgent',
    );
    expect(screen.getByRole('button', { name: 'Market roadmap' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'OpenAWork plan' })).toBeNull();
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

    renderFusionSidebar('/chat/open-session');

    expect(screen.getByText('团队工作空间')).not.toBeNull();
    expect(screen.getByText('暂无团队工作空间')).not.toBeNull();
    expect(screen.getByTitle('新建团队工作区')).not.toBeNull();
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
