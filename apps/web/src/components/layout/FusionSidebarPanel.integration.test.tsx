// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useUIStateStore } from '../../stores/ui/uiState.js';
import {
  getFusionSidebarMocks,
  prepareFusionSidebarMocks,
  renderFusionSidebar,
  resetFusionSidebarUiState,
} from './FusionSidebar.test-utils.js';

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
});
