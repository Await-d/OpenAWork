// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { createRef, type MutableRefObject } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { FusionChatMainShell, type FusionChatMainShellProps } from './FusionChatMainShell.js';

function renderShell(overrides: Partial<FusionChatMainShellProps> = {}) {
  const splitDragging: MutableRefObject<boolean> = { current: false };
  const baseProps: FusionChatMainShellProps = {
    children: <div data-testid="conversation-content">conversation</div>,
    editorFullScreen: false,
    editorMode: false,
    editorPane: <div data-testid="editor-pane">editor</div>,
    hasSession: true,
    isFusionLayout: true,
    showDockedSidePanel: true,
    sidePanel: <aside data-testid="docked-side-panel">side</aside>,
    splitContainerRef: createRef<HTMLDivElement>(),
    splitDragging,
    splitPos: 62,
    terminal: <div data-testid="terminal-dock">terminal</div>,
  };

  return render(<FusionChatMainShell {...baseProps} {...overrides} />);
}

afterEach(() => {
  cleanup();
});

describe('FusionChatMainShell', () => {
  it('fusion 模式下固定会话列并挂载右侧 dock 与底部终端', () => {
    renderShell();

    const split = screen.getByTestId('fusion-chat-main-shell-split');
    const conversationPane = screen.getByTestId('fusion-chat-conversation-pane');
    const conversationFrame = screen.getByTestId('fusion-chat-conversation-frame');

    expect(split.style.getPropertyValue('--split-pos')).toBe('62%');
    expect(conversationPane.className).toContain(
      'fusion-chat-main-shell__conversation-pane--docked',
    );
    expect(conversationFrame.className).toContain(
      'fusion-chat-main-shell__conversation-frame--fusion',
    );
    expect(screen.getByTestId('docked-side-panel')).toBeTruthy();
    expect(screen.getByTestId('terminal-dock')).toBeTruthy();
  });

  it('编辑器全屏时隐藏会话列但保留 split 结构', () => {
    renderShell({ editorFullScreen: true, editorMode: true });

    const conversationPane = screen.getByTestId('fusion-chat-conversation-pane');

    expect(conversationPane.getAttribute('aria-hidden')).toBe('true');
    expect(conversationPane.style.width).toBe('0px');
    expect(conversationPane.style.opacity).toBe('0');
  });

  it('classic 模式只保留会话与编辑器，不渲染 fusion dock 和底部终端', () => {
    renderShell({ isFusionLayout: false });

    expect(screen.getByTestId('conversation-content')).toBeTruthy();
    expect(screen.getByTestId('editor-pane')).toBeTruthy();
    expect(screen.queryByTestId('docked-side-panel')).toBeNull();
    expect(screen.queryByTestId('terminal-dock')).toBeNull();
  });
});
