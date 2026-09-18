// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useFusionChatLayout } from './use-fusion-chat-layout.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useFusionChatLayout', () => {
  it('Fusion 终端不再自动展开，但自动打开的终端归零后会自动收起', async () => {
    const setEditorFullScreen = vi.fn();
    const setEditorMode = vi.fn();
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
          setEditorFullScreen,
          setEditorMode,
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

    // 终端启动时不再自动打开
    await waitFor(() => {
      expect(setTerminalPanelOpened).not.toHaveBeenCalledWith(true);
    });

    // 用户手动打开终端面板后，当终端归零时会自动关闭（如果是自动打开的）
    rerender({
      terminalPanelOpened: true,
      terminalRunningCount: 0,
    });

    // 因为面板不是自动打开的，所以不会自动关闭
    expect(setTerminalPanelOpened).not.toHaveBeenCalledWith(false);
  });

  it('Fusion 审查面板未展开或不在 review tab 时强制切回 review 并展开', () => {
    const setEditorFullScreen = vi.fn();
    const setEditorMode = vi.fn();
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
        setEditorFullScreen,
        setEditorMode,
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
    const setEditorFullScreen = vi.fn();
    const setEditorMode = vi.fn();
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
        setEditorFullScreen,
        setEditorMode,
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

  it('放大态下触发审查入口会退出全屏并把内容收回到会话面板', () => {
    const setEditorFullScreen = vi.fn();
    const setEditorMode = vi.fn();
    const setReviewPanelOpened = vi.fn();
    const setSidePanelActiveTab = vi.fn();
    const setTerminalPanelOpened = vi.fn();

    const { result } = renderHook(() =>
      useFusionChatLayout({
        canDockSidePanel: true,
        currentSessionId: 'session-1',
        editorFullScreen: true,
        editorMode: true,
        enabled: true,
        isNarrowViewport: false,
        reviewPanelOpened: true,
        setEditorFullScreen,
        setEditorMode,
        setReviewPanelOpened,
        setSidePanelActiveTab,
        setTerminalPanelOpened,
        sidePanelActiveTab: 'code',
        terminalPanelOpened: false,
        terminalRunningCount: 0,
      }),
    );

    result.current.toggleReviewPanel();

    expect(setEditorFullScreen).toHaveBeenCalledWith(false);
    expect(setEditorMode).toHaveBeenCalledWith(false);
    expect(setSidePanelActiveTab).toHaveBeenCalledWith('review');
    expect(setReviewPanelOpened).toHaveBeenCalledWith(true);
  });

  it('禁用时仅关闭副作用，不回传 Classic 根布局', () => {
    const setEditorFullScreen = vi.fn();
    const setEditorMode = vi.fn();
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
        setEditorFullScreen,
        setEditorMode,
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
      contentMaxWidth: 820,
    });
    expect(setTerminalPanelOpened).not.toHaveBeenCalled();
  });
});
