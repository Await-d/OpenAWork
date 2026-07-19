// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LayoutModeSwitch } from './LayoutModeSwitch.js';
import { useUIStateStore } from '../../../stores/ui/uiState.js';

function resetUiState(): void {
  useUIStateStore.setState({ workbenchLayoutMode: 'fusion' });
}

beforeEach(() => {
  cleanup();
  resetUiState();
});

afterEach(() => {
  cleanup();
  resetUiState();
});

describe('LayoutModeSwitch', () => {
  it('使用 token 化 class 切换 classic/fusion 布局状态', () => {
    render(<LayoutModeSwitch />);

    const group = screen.getByRole('group', { name: '布局版本切换' });
    expect(group.classList.contains('layout-mode-switch')).toBe(true);
    expect(group.getAttribute('style')).toBeNull();

    const classicButton = screen.getByRole('button', { name: '经典' });
    const fusionButton = screen.getByRole('button', { name: '融合' });
    expect(classicButton.classList.contains('layout-mode-switch__button')).toBe(true);
    expect(classicButton.getAttribute('style')).toBeNull();
    expect(fusionButton.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(classicButton);

    expect(useUIStateStore.getState().workbenchLayoutMode).toBe('classic');
    expect(classicButton.getAttribute('aria-pressed')).toBe('true');
    expect(fusionButton.getAttribute('aria-pressed')).toBe('false');
  });
});
