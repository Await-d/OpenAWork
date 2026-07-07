// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatTerminalToggle } from './ChatTerminalToggle.js';
import { useUIStateStore } from '../../../stores/ui/uiState.js';

function resetUiState(): void {
  useUIStateStore.setState({
    terminalPanelOpened: false,
  });
}

beforeEach(() => {
  cleanup();
  resetUiState();
});

afterEach(() => {
  cleanup();
  resetUiState();
});

describe('ChatTerminalToggle', () => {
  it('在 fusion 布局下切换全局终端面板状态', () => {
    render(
      <ChatTerminalToggle
        isFusionLayout={true}
        terminalPanelOpened={false}
        quickTerminalOpen={false}
        onToggleTerminalPanelOpened={useUIStateStore.getState().toggleTerminalPanelOpened}
        onSetQuickTerminalOpen={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '打开快捷终端面板' }));

    expect(useUIStateStore.getState().terminalPanelOpened).toBe(true);
  });

  it('在 classic 布局下继续切换 workspace 快捷终端状态', () => {
    const onSetQuickTerminalOpen = vi.fn();

    render(
      <ChatTerminalToggle
        isFusionLayout={false}
        terminalPanelOpened={false}
        quickTerminalOpen={false}
        onToggleTerminalPanelOpened={useUIStateStore.getState().toggleTerminalPanelOpened}
        onSetQuickTerminalOpen={onSetQuickTerminalOpen}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '打开快捷终端面板' }));

    expect(onSetQuickTerminalOpen).toHaveBeenCalledWith(true);
    expect(useUIStateStore.getState().terminalPanelOpened).toBe(false);
  });
});
