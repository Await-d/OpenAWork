// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router';
import { useUIStateStore } from '../../../stores/ui/uiState.js';
import { SidebarRailV2 } from './SidebarRailV2.js';

const preloadRouteModuleByPath = vi.hoisted(() => vi.fn());

vi.mock('../../../routes/preloadable-route-modules.js', () => ({
  preloadRouteModuleByPath,
}));

function resetUiState(): void {
  useUIStateStore.setState({
    savedWorkspacePaths: ['/home/await/project/OpenAWork', '/home/await/project/MarketAgent'],
    selectedWorkspacePath: '/home/await/project/OpenAWork',
  });
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-probe">{`${location.pathname}${location.search}`}</div>;
}

function renderRail(
  props: Partial<Parameters<typeof SidebarRailV2>[0]> = {},
  initialPath = '/chat/session-1',
) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <SidebarRailV2 accessToken={null} gatewayUrl="http://localhost:3000" {...props} />
      <LocationProbe />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  cleanup();
  preloadRouteModuleByPath.mockClear();
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

  it('点击添加工作区按钮会打开工作区选择器', () => {
    const onOpenWorkspacePicker = vi.fn();

    renderRail({ onOpenWorkspacePicker });

    fireEvent.click(screen.getByRole('button', { name: '添加工作区' }));

    expect(onOpenWorkspacePicker).toHaveBeenCalledTimes(1);
  });

  it('对话和团队入口使用点击切换路由', () => {
    renderRail({}, '/settings');

    fireEvent.click(screen.getByRole('button', { name: '对话' }));
    expect(screen.getByTestId('location-probe').textContent).toBe('/chat');
    expect(preloadRouteModuleByPath).toHaveBeenCalledWith('/chat');

    fireEvent.click(screen.getByRole('button', { name: '团队' }));
    expect(screen.getByTestId('location-probe').textContent).toBe('/team');
    expect(preloadRouteModuleByPath).toHaveBeenCalledWith('/team');
  });

  it('Panel 收起时点击对话或团队图标重新展开 Panel', () => {
    useUIStateStore.setState({ leftSidebarOpen: false });

    renderRail({}, '/settings');

    fireEvent.click(screen.getByRole('button', { name: '对话' }));
    expect(useUIStateStore.getState().leftSidebarOpen).toBe(true);

    useUIStateStore.setState({ leftSidebarOpen: false });

    fireEvent.click(screen.getByRole('button', { name: '团队' }));
    expect(useUIStateStore.getState().leftSidebarOpen).toBe(true);
  });

  it('Panel 收起时点击项目头像重新展开 Panel', () => {
    useUIStateStore.setState({ leftSidebarOpen: false });

    renderRail({}, '/chat/session-1');

    fireEvent.click(screen.getByRole('button', { name: /切换工作区 MA/ }));
    expect(useUIStateStore.getState().leftSidebarOpen).toBe(true);
  });
});
