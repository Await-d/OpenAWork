// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useFusionChatLayout } from './use-fusion-chat-layout.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useFusionChatLayout', () => {
  it('Fusion 终端首次出现运行实例时自动展开，归零后自动收起', async () => {
    const setReviewPanelOpened = vi.fn();
    const setSidePanelActiveTab = vi.fn();
    const setTerminalPanelOpened = vi.fn();

    const { rerender } = renderHook(
      (props: { readonly terminalPanelOpened: boolean; readonly terminalRunningCount: number }) =>
        useFusionChatLayout({
          canDockSidePanel: true,
          currentSessionId: 'session-1',
          editorFullScreen: false,
          editorMode: false,
          enabled: true,
          isNarrowViewport: false,
          reviewPanelOpened: true,
          setReviewPanelOpened,
          setSidePanelActiveTab,
          setTerminalPanelOpened,
          sidePanelActiveTab: 'review',
          terminalPanelOpened: props.terminalPanelOpened,
          terminalRunningCount: props.terminalRunningCount,
        }),
      {
        initialProps: {
          terminalPanelOpened: false,
          terminalRunningCount: 1,
        },
      },
    );

    await waitFor(() => {
      expect(setTerminalPanelOpened).toHaveBeenCalledWith(true);
    });

    rerender({
      terminalPanelOpened: true,
      terminalRunningCount: 0,
    });

    await waitFor(() => {
      expect(setTerminalPanelOpened).toHaveBeenCalledWith(false);
    });
  });

  it('Fusion 审查面板未展开或不在 review tab 时强制切回 review 并展开', () => {
    const setReviewPanelOpened = vi.fn();
    const setSidePanelActiveTab = vi.fn();
    const setTerminalPanelOpened = vi.fn();

    const { result } = renderHook(() =>
      useFusionChatLayout({
        canDockSidePanel: true,
        currentSessionId: 'session-1',
        editorFullScreen: false,
        editorMode: false,
        enabled: true,
        isNarrowViewport: false,
        reviewPanelOpened: false,
        setReviewPanelOpened,
        setSidePanelActiveTab,
        setTerminalPanelOpened,
        sidePanelActiveTab: 'context',
        terminalPanelOpened: false,
        terminalRunningCount: 0,
      }),
    );

    result.current.toggleReviewPanel();

    expect(setSidePanelActiveTab).toHaveBeenCalledWith('review');
    expect(setReviewPanelOpened).toHaveBeenCalledWith(true);
  });

  it('Fusion 审查面板已在 review tab 时再次触发会收起', () => {
    const setReviewPanelOpened = vi.fn();
    const setSidePanelActiveTab = vi.fn();
    const setTerminalPanelOpened = vi.fn();

    const { result } = renderHook(() =>
      useFusionChatLayout({
        canDockSidePanel: true,
        currentSessionId: 'session-1',
        editorFullScreen: false,
        editorMode: false,
        enabled: true,
        isNarrowViewport: false,
        reviewPanelOpened: true,
        setReviewPanelOpened,
        setSidePanelActiveTab,
        setTerminalPanelOpened,
        sidePanelActiveTab: 'review',
        terminalPanelOpened: true,
        terminalRunningCount: 1,
      }),
    );

    result.current.toggleReviewPanel();

    expect(setSidePanelActiveTab).not.toHaveBeenCalled();
    expect(setReviewPanelOpened).toHaveBeenCalledWith(false);
  });

  it('禁用时仅关闭副作用，不回传 Classic 根布局', () => {
    const setReviewPanelOpened = vi.fn();
    const setSidePanelActiveTab = vi.fn();
    const setTerminalPanelOpened = vi.fn();

    const { result } = renderHook(() =>
      useFusionChatLayout({
        canDockSidePanel: true,
        currentSessionId: 'session-1',
        editorFullScreen: false,
        editorMode: false,
        enabled: false,
        isNarrowViewport: false,
        reviewPanelOpened: true,
        setReviewPanelOpened,
        setSidePanelActiveTab,
        setTerminalPanelOpened,
        sidePanelActiveTab: 'review',
        terminalPanelOpened: false,
        terminalRunningCount: 1,
      }),
    );

    expect(result.current.pageRootClassName).toBe('page-root page-root-fusion-col');
    expect(result.current.conversationLayoutState).toEqual({
      centerContent: true,
      contentMaxWidth: 720,
    });
    expect(setTerminalPanelOpened).not.toHaveBeenCalled();
  });
});
