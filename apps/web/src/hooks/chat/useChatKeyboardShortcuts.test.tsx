// @vitest-environment jsdom
/**
 * 全局快捷键与终端作用域的交互契约：
 *  - Ctrl/⌘+` 切换终端面板：普通焦点、以及**终端面板内**（xterm 隐藏 textarea）
 *    都要生效；xterm 不理会 `defaultPrevented`（仍会把按键送去 pty），因此必须
 *    在捕获阶段 `stopPropagation` 才能真正接管。
 *  - 其余快捷键在终端作用域内放行（交给终端自己的按键矩阵，如 Ctrl+K = clear-buffer）。
 *  - 在其它输入框（聊天输入框）里不触发（保持既有行为）。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';
import { useChatKeyboardShortcuts } from './useChatKeyboardShortcuts.js';

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

function press(target: EventTarget, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

function createTerminalScope(): HTMLTextAreaElement {
  const scope = document.createElement('div');
  scope.setAttribute('data-terminal-scope', '');
  const textarea = document.createElement('textarea');
  textarea.className = 'xterm-helper-textarea';
  scope.appendChild(textarea);
  document.body.appendChild(scope);
  return textarea;
}

describe('useChatKeyboardShortcuts · Ctrl+` 与终端作用域', () => {
  it('普通焦点下切换终端面板', () => {
    const onToggleTerminalPanel = vi.fn();
    renderHook(() => useChatKeyboardShortcuts({ onToggleTerminalPanel }));

    const event = press(document.body, { key: '`', ctrlKey: true });

    expect(onToggleTerminalPanel).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('终端面板内同样切换，并在捕获阶段阻断向 xterm 的传播', () => {
    const onToggleTerminalPanel = vi.fn();
    renderHook(() => useChatKeyboardShortcuts({ onToggleTerminalPanel }));
    const textarea = createTerminalScope();
    const onTargetKeyDown = vi.fn();
    textarea.addEventListener('keydown', onTargetKeyDown);

    const event = press(textarea, { key: '`', ctrlKey: true });

    expect(onToggleTerminalPanel).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    // stopPropagation 生效：事件不会继续传播到 xterm 的输入面。
    expect(onTargetKeyDown).not.toHaveBeenCalled();
  });

  it('聊天输入框内不触发（保持既有行为）', () => {
    const onToggleTerminalPanel = vi.fn();
    renderHook(() => useChatKeyboardShortcuts({ onToggleTerminalPanel }));
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);

    press(textarea, { key: '`', ctrlKey: true });

    expect(onToggleTerminalPanel).not.toHaveBeenCalled();
  });

  it('终端作用域内 Ctrl+K 放行（交给终端的 clear-buffer）', () => {
    const onCommandPalette = vi.fn();
    renderHook(() => useChatKeyboardShortcuts({ onCommandPalette }));
    const textarea = createTerminalScope();

    const event = press(textarea, { key: 'k', ctrlKey: true });

    expect(onCommandPalette).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});
