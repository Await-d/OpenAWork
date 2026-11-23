import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useChatPageShortcuts } from './use-chat-page-shortcuts.js';

function setup(enabled = true, dialogueModeEnabled = true) {
  const copy = vi.fn();
  const changeMode = vi.fn();
  const toggleReview = vi.fn();
  const selectAll = vi.fn();
  const messages = [
    { id: 'assistant-a', role: 'assistant' as const, content: '回复', timestamp: 1 },
  ];
  const deps = {
    enabled,
    messages,
    dialogueMode: 'coding' as const,
    dialogueModeEnabled,
    onDialogueModeChange: changeMode,
    onCopyMessage: copy,
    multiSelectEnabled: false,
    enableMultiSelect: vi.fn(),
    disableMultiSelect: vi.fn(),
    selectAll,
    scrollRegionRef: { current: null },
    isFusionLayout: true,
    toggleReviewPanel: toggleReview,
    setRightOpen: vi.fn(),
    onCommandPalette: vi.fn(),
    onSearch: vi.fn(),
    onOpenTemplates: vi.fn(),
    onToggleTerminalPanel: vi.fn(),
    onNewSession: vi.fn(),
  };
  const hook = renderHook(() => useChatPageShortcuts(deps));
  return { ...hook, deps, copy, changeMode, toggleReview };
}

function key(key: string, extra: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra });
  act(() => {
    document.body.dispatchEvent(event);
  });
  return event;
}

describe('useChatPageShortcuts', () => {
  it('复用现有快捷键并复制最后一条助手回复，卸载后移除监听', () => {
    const { copy, deps, unmount } = setup();
    key('C', { ctrlKey: true, shiftKey: true });
    expect(copy).toHaveBeenCalledExactlyOnceWith(deps.messages[0]);
    unmount();
    key('C', { ctrlKey: true, shiftKey: true });
    expect(copy).toHaveBeenCalledTimes(1);
  });

  it('fusion 右栏快捷键只切换 review 面板', () => {
    const { toggleReview, deps } = setup();
    key('\\', { ctrlKey: true });
    expect(toggleReview).toHaveBeenCalledTimes(1);
    expect(deps.setRightOpen).not.toHaveBeenCalled();
  });

  it('不拦截 Enter 或在非活跃页面执行动作', () => {
    const { deps } = setup(false);
    expect(key('Enter').defaultPrevented).toBe(false);
    key('f', { ctrlKey: true });
    expect(deps.onSearch).not.toHaveBeenCalled();
  });

  it('输入框中不执行搜索快捷键', () => {
    const { deps } = setup();
    const input = document.createElement('textarea');
    document.body.append(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }));
    expect(deps.onSearch).not.toHaveBeenCalled();
    input.remove();
  });

  it('对话模式可切换时 Cmd+/ 触发切换', () => {
    const { changeMode } = setup();
    key('/', { ctrlKey: true });
    expect(changeMode).toHaveBeenCalledTimes(1);
  });

  it('来源会话（dialogueModeEnabled=false）下 Cmd+/ 不改模式', () => {
    const { changeMode, deps } = setup(true, false);
    const event = key('/', { ctrlKey: true });

    expect(changeMode).not.toHaveBeenCalled();
    // 该键仍被消费（不落到浏览器默认行为），只是没有对应动作。
    expect(event.defaultPrevented).toBe(true);
    // 其余快捷键不受影响。
    key('C', { ctrlKey: true, shiftKey: true });
    expect(deps.onCopyMessage).toHaveBeenCalledTimes(1);
  });
});
