// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { createRef, type MutableRefObject } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { FusionChatMainShell, type FusionChatMainShellProps } from './FusionChatMainShell.js';

function renderShell(overrides: Partial<FusionChatMainShellProps> = {}) {
  const splitDragging: MutableRefObject<boolean> = { current: false };
  const baseProps: FusionChatMainShellProps = {
    children: <div data-testid="conversation-content">conversation</div>,
    dockSplitPos: 35,
    editorFullScreen: false,
    editorMode: false,
    editorPane: <div data-testid="editor-pane">editor</div>,
    hasSession: true,
    showDockedSidePanel: true,
    sidePanel: <aside data-testid="docked-side-panel">side</aside>,
    splitContainerRef: createRef<HTMLDivElement>(),
    splitDragging,
    splitPos: 62,
    terminalMaximized: false,
    terminalPosition: 'bottom',
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

  it('关闭 dock 或没有会话时收起 Fusion 侧栏和底部终端', () => {
    renderShell({ hasSession: false, showDockedSidePanel: false });

    expect(screen.getByTestId('conversation-content')).toBeTruthy();
    expect(screen.getByTestId('editor-pane')).toBeTruthy();
    expect(screen.queryByTestId('docked-side-panel')).toBeNull();
    expect(screen.queryByTestId('terminal-dock')).toBeNull();
  });

  it('terminalMaximized 时根节点加修饰类（工作台折叠由 CSS 承接）', () => {
    renderShell({ terminalMaximized: true });

    expect(screen.getByTestId('fusion-chat-main-shell').className).toContain(
      'fusion-chat-main-shell--terminal-maximized',
    );
    // 折叠是 CSS 行为（jsdom 不加载外部样式表），这里锁的是类名契约与结构保留。
    expect(screen.getByTestId('terminal-dock')).toBeTruthy();
  });

  it('非最大化时不加修饰类', () => {
    renderShell();

    expect(screen.getByTestId('fusion-chat-main-shell').className).not.toContain(
      'fusion-chat-main-shell--terminal-maximized',
    );
  });

  it('terminalPosition=left 时加左停靠修饰类，DOM 顺序保持不变（列序交给 CSS order）', () => {
    renderShell({ terminalPosition: 'left' });

    const root = screen.getByTestId('fusion-chat-main-shell');
    expect(root.className).toContain('fusion-chat-main-shell--terminal-left');
    expect(root.className).not.toContain('fusion-chat-main-shell--terminal-right');
    // 终端仍排在 workbench 行之后：左停靠只改 flex order，不重排 JSX（避免终端重挂载）。
    expect(root.firstElementChild?.className).toContain('fusion-chat-main-shell__workbench-row');
    expect(screen.getByTestId('terminal-dock')).toBeTruthy();
  });

  it('terminalPosition=right 时只加右停靠修饰类', () => {
    renderShell({ terminalPosition: 'right' });

    const root = screen.getByTestId('fusion-chat-main-shell');
    expect(root.className).toContain('fusion-chat-main-shell--terminal-right');
    expect(root.className).not.toContain('fusion-chat-main-shell--terminal-left');
  });

  it('terminalPosition=bottom 时不加任何停靠修饰类', () => {
    renderShell();

    const root = screen.getByTestId('fusion-chat-main-shell');
    expect(root.className).not.toContain('fusion-chat-main-shell--terminal-left');
    expect(root.className).not.toContain('fusion-chat-main-shell--terminal-right');
  });
});
