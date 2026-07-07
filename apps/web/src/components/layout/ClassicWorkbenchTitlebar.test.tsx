// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router';
import { ClassicWorkbenchTitlebar } from './ClassicWorkbenchTitlebar.js';
import { useUIStateStore } from '../../stores/ui/uiState.js';

function resetUiState(): void {
  useUIStateStore.setState({
    lastChatPath: '/chat/classic-session',
    workbenchLayoutMode: 'classic',
  });
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-probe">{`${location.pathname}${location.search}`}</div>;
}

function renderClassicTitlebar(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <ClassicWorkbenchTitlebar />
      <LocationProbe />
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

describe('ClassicWorkbenchTitlebar', () => {
  it('classic 布局下提供 Chat/Team 模式切换与 fusion 入口，但不渲染 Chat 会话标签', () => {
    renderClassicTitlebar('/team/workspace-alpha');

    expect(screen.getByRole('banner', { name: '经典布局工作台切换栏' })).not.toBeNull();
    expect(screen.getByRole('group', { name: '工作台模式' })).not.toBeNull();
    expect(screen.getByRole('group', { name: '布局版本切换' })).not.toBeNull();
    expect(screen.queryByRole('tablist', { name: 'Chat 会话标签' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Chat' }));
    expect(screen.getByTestId('location-probe').textContent).toBe('/chat/classic-session');

    fireEvent.click(screen.getByRole('button', { name: '融合' }));
    expect(useUIStateStore.getState().workbenchLayoutMode).toBe('fusion');
  });
});
