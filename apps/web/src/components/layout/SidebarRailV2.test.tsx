// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { useUIStateStore } from '../../stores/ui/uiState.js';
import { SidebarRailV2 } from './SidebarRailV2.js';

function resetUiState(): void {
  useUIStateStore.setState({
    savedWorkspacePaths: ['/home/await/project/OpenAWork', '/home/await/project/MarketAgent'],
    selectedWorkspacePath: '/home/await/project/OpenAWork',
  });
}

function renderRail(props: Partial<Parameters<typeof SidebarRailV2>[0]> = {}) {
  return render(
    <MemoryRouter initialEntries={['/chat/session-1']}>
      <SidebarRailV2 accessToken={null} gatewayUrl="http://localhost:3000" {...props} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  cleanup();
  resetUiState();
});

afterEach(() => {
  cleanup();
  resetUiState();
});

describe('SidebarRailV2', () => {
  it('项目头像是可聚焦按钮，并支持 hover/focus 触发 peek', () => {
    const onProjectHover = vi.fn();

    renderRail({ onProjectHover });

    const openAWorkButton = screen.getByRole('button', { name: /切换工作区 OP/ });
    expect(openAWorkButton.getAttribute('aria-pressed')).toBe('true');

    fireEvent.focus(openAWorkButton);
    fireEvent.blur(openAWorkButton);
    fireEvent.mouseEnter(openAWorkButton);
    fireEvent.mouseLeave(openAWorkButton);

    expect(onProjectHover).toHaveBeenNthCalledWith(1, '/home/await/project/OpenAWork');
    expect(onProjectHover).toHaveBeenNthCalledWith(2, null);
    expect(onProjectHover).toHaveBeenNthCalledWith(3, '/home/await/project/OpenAWork');
    expect(onProjectHover).toHaveBeenNthCalledWith(4, null);
  });

  it('点击项目头像切换工作区并通知父级', () => {
    const onSelectWorkspace = vi.fn();

    renderRail({ onSelectWorkspace });

    fireEvent.click(screen.getByRole('button', { name: /切换工作区 MA/ }));

    expect(useUIStateStore.getState().selectedWorkspacePath).toBe(
      '/home/await/project/MarketAgent',
    );
    expect(onSelectWorkspace).toHaveBeenCalledWith('/home/await/project/MarketAgent');
  });
});
