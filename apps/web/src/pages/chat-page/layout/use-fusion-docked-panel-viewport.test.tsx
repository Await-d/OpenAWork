// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useFusionDockedPanelViewport } from './use-fusion-docked-panel-viewport.js';

function installMatchMedia(matches: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(
      (query: string): MediaQueryList => ({
        matches,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(() => true),
      }),
    ),
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useFusionDockedPanelViewport', () => {
  it('宽视口允许 Fusion 右侧面板常驻 dock', () => {
    installMatchMedia(true);

    const { result } = renderHook(() => useFusionDockedPanelViewport());

    expect(result.current).toBe(true);
    expect(window.matchMedia).toHaveBeenCalledWith('(min-width: 1180px)');
  });

  it('中小视口关闭 Fusion 右侧 dock，避免挤压会话区', () => {
    installMatchMedia(false);

    const { result } = renderHook(() => useFusionDockedPanelViewport());

    expect(result.current).toBe(false);
  });
});
