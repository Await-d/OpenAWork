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
  it('切换 Fusion 全局终端面板状态', () => {
    render(
      <ChatTerminalToggle
        terminalPanelOpened={false}
        onToggleTerminalPanel={useUIStateStore.getState().toggleTerminalPanelOpened}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '打开快捷终端面板' }));

    expect(useUIStateStore.getState().terminalPanelOpened).toBe(true);
  });

  it('把当前终端展开态透传给按钮', () => {
    const onToggleTerminalPanel = vi.fn();

    render(
      <ChatTerminalToggle
        terminalPanelOpened={true}
        onToggleTerminalPanel={onToggleTerminalPanel}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '收起快捷终端面板' }));

    expect(onToggleTerminalPanel).toHaveBeenCalledTimes(1);
  });
});
