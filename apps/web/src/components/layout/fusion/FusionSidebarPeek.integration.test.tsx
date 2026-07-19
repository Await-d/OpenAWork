// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUIStateStore } from '../../../stores/ui/uiState.js';
import {
  MARKET_PATH,
  prepareFusionSidebarMocks,
  renderFusionSidebar,
  resetFusionSidebarUiState,
} from './FusionSidebar.test-utils.js';

beforeEach(() => {
  cleanup();
  prepareFusionSidebarMocks(false);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  resetFusionSidebarUiState(false);
});

describe('FusionSidebar 折叠预览', () => {
  it('折叠态 hover 工作区头像时展示对应工作区的会话预览', () => {
    renderFusionSidebar();

    fireEvent.mouseEnter(screen.getByRole('button', { name: /切换工作区 MA/ }));

    expect(screen.getByRole('complementary', { name: '工作区会话预览' })).not.toBeNull();
    expect(screen.getByText('MarketAgent')).not.toBeNull();
    expect(screen.getByText(MARKET_PATH)).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Market roadmap' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'OpenAWork plan' })).toBeNull();
  });

  it('离开工作区头像后延迟关闭预览，重新进入预览会取消关闭', () => {
    vi.useFakeTimers();
    renderFusionSidebar();

    const marketButton = screen.getByRole('button', { name: /切换工作区 MA/ });
    fireEvent.mouseEnter(marketButton);
    const peek = screen.getByRole('complementary', { name: '工作区会话预览' });

    fireEvent.mouseLeave(marketButton);
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(screen.getByRole('complementary', { name: '工作区会话预览' })).not.toBeNull();

    fireEvent.mouseEnter(peek);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByRole('complementary', { name: '工作区会话预览' })).not.toBeNull();

    fireEvent.mouseLeave(peek);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.queryByRole('complementary', { name: '工作区会话预览' })).toBeNull();
  });

  it('从预览选择会话后展开 Panel 并进入对应 Chat 会话', async () => {
    renderFusionSidebar();

    fireEvent.mouseEnter(screen.getByRole('button', { name: /切换工作区 MA/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Market roadmap' }));

    expect(useUIStateStore.getState().leftSidebarOpen).toBe(true);
    expect(screen.queryByRole('complementary', { name: '工作区会话预览' })).toBeNull();
    await waitFor(() => {
      expect(screen.getByTestId('location-probe').textContent).toBe('/chat/market-session');
    });
  });
});
