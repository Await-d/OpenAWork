// @vitest-environment jsdom
import React, { useRef, useState } from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useComposerCallbacks } from './use-composer-callbacks.js';

afterEach(() => {
  cleanup();
});

describe('useComposerCallbacks', () => {
  function renderHarness(
    input = '继续跟进这个问题',
    overrides: Partial<Parameters<typeof useComposerCallbacks>[0]> = {},
  ) {
    const navigateInputHistory = vi.fn(() => true);
    const exitInputHistoryBrowsing = vi.fn();
    const enqueueComposerMessage = vi.fn(async () => true);
    const sendMessage = vi.fn(async () => true);

    function Harness() {
      const [value, setValue] = useState(input);
      const textareaRef = useRef<HTMLTextAreaElement | null>(null);
      const callbacks = useComposerCallbacks({
        composerMenu: null,
        setComposerMenu: () => undefined,
        input: value,
        setInput: setValue,
        textareaRef,
        slashCommandItems: [],
        mentionItems: [],
        stopCapability: 'none',
        streaming: false,
        canStopCurrentSessionStream: false,
        remoteSessionBusyState: null,
        stopActiveMessage: () => undefined,
        enqueueComposerMessage,
        sendMessage,
        appendFiles: () => undefined,
        navigateInputHistory,
        isBrowsingInputHistory: false,
        exitInputHistoryBrowsing,
        ...overrides,
      });

      return (
        <textarea
          ref={textareaRef}
          value={value}
          onChange={callbacks.handleInputChange}
          onKeyDown={callbacks.handleKeyDown}
        />
      );
    }

    const view = render(<Harness />);

    return {
      exitInputHistoryBrowsing,
      enqueueComposerMessage,
      navigateInputHistory,
      sendMessage,
      textarea: view.getByRole('textbox'),
    };
  }

  it('忙碌态按 Enter 会排队，而不是直接发送', () => {
    const { enqueueComposerMessage, sendMessage, textarea } = renderHarness('继续跟进这个问题', {
      remoteSessionBusyState: 'running',
    });

    fireEvent.keyDown(textarea, { key: 'Enter' });

    expect(enqueueComposerMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('完整 slash 命令在菜单打开时按 Enter 会直接发送，而不是再次补全', () => {
    const setComposerMenu = vi.fn();
    const { sendMessage, textarea } = renderHarness('/compact', {
      composerMenu: {
        type: 'slash',
        query: 'compact',
        start: 0,
        end: 8,
        selectedIndex: 0,
      },
      setComposerMenu,
      slashCommandItems: [
        {
          id: 'slash-compact',
          kind: 'slash',
          source: 'command',
          type: 'insert',
          label: '/compact',
          description: '压缩当前会话上下文',
          badgeLabel: '命令',
          insertText: '/compact ',
          onSelect: async () => undefined,
        },
      ],
    });

    fireEvent.keyDown(textarea, { key: 'Enter' });

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(setComposerMenu).toHaveBeenCalledWith(null);
  });

  it('单行输入按 ArrowUp 会进入历史浏览', () => {
    const { navigateInputHistory, textarea } = renderHarness('继续跟进这个问题');

    fireEvent.keyDown(textarea, { key: 'ArrowUp' });

    expect(navigateInputHistory).toHaveBeenCalledWith('older');
  });

  it('历史浏览态按 ArrowDown 会回到更新的记录', () => {
    const { navigateInputHistory, textarea } = renderHarness('旧记录', {
      isBrowsingInputHistory: true,
    });

    fireEvent.keyDown(textarea, { key: 'ArrowDown' });

    expect(navigateInputHistory).toHaveBeenCalledWith('newer');
  });

  it('多行输入且光标不在首行时，ArrowUp 不抢占原生移动', () => {
    const { navigateInputHistory, textarea } = renderHarness('第一行\n第二行');
    if (!(textarea instanceof HTMLTextAreaElement)) {
      throw new TypeError('Expected textarea element.');
    }
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);

    fireEvent.keyDown(textarea, { key: 'ArrowUp' });

    expect(navigateInputHistory).not.toHaveBeenCalled();
  });

  it('带修饰键的 ArrowUp 不触发输入历史浏览', () => {
    const { navigateInputHistory, textarea } = renderHarness('继续跟进这个问题');

    fireEvent.keyDown(textarea, { key: 'ArrowUp', altKey: true });

    expect(navigateInputHistory).not.toHaveBeenCalled();
  });
});
