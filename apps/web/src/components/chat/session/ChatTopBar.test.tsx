// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatTopBar, type ChatTopBarProps } from './ChatTopBar.js';

function renderTopBar(props: Partial<ChatTopBarProps> = {}) {
  return render(
    <ChatTopBar
      {...props}
      dialogueMode={props.dialogueMode ?? 'coding'}
      onChangeDialogueMode={props.onChangeDialogueMode ?? (() => undefined)}
      yoloMode={props.yoloMode ?? false}
      onToggleYolo={props.onToggleYolo ?? (() => undefined)}
      editorMode={props.editorMode ?? false}
      onToggleEditorMode={props.onToggleEditorMode ?? (() => undefined)}
      rightOpen={props.rightOpen ?? false}
      onToggleRightOpen={props.onToggleRightOpen ?? (() => undefined)}
    />,
  );
}

afterEach(() => {
  cleanup();
});

describe('ChatTopBar — 工作区绑定 chip', () => {
  it('未提供 workspaceBinding 时不渲染 chip', () => {
    renderTopBar();

    expect(screen.queryByTestId('chat-top-bar-workspace-binding')).toBeNull();
  });

  it('新建会话（提供 onSelect）渲染为可点击 chip，点击触发调整回调', () => {
    const onSelect = vi.fn();
    renderTopBar({
      workspaceBinding: {
        label: 'OpenAWork',
        fullPath: '/home/await/project/OpenAWork',
        onSelect,
      },
    });

    const chip = screen.getByTestId('chat-top-bar-workspace-binding');
    expect(chip.getAttribute('data-interactive')).toBe('true');
    expect(chip.textContent).toContain('OpenAWork');
    expect(chip.getAttribute('title')).toContain('调整绑定工作区');

    fireEvent.click(chip);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('未绑定工作区的新会话提供「选择要绑定的工作区」入口', () => {
    const onSelect = vi.fn();
    renderTopBar({ workspaceBinding: { label: '未指定工作区', fullPath: null, onSelect } });

    const chip = screen.getByRole('button', { name: '选择要绑定的工作区' });
    fireEvent.click(chip);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('对话开始后（无 onSelect）chip 转为只读锁定态，不再触发调整', () => {
    renderTopBar({
      workspaceBinding: { label: 'OpenAWork', fullPath: '/home/await/project/OpenAWork' },
    });

    const chip = screen.getByTestId('chat-top-bar-workspace-binding');
    expect(chip.getAttribute('data-interactive')).toBe('false');
    expect(chip.getAttribute('title')).toContain('绑定已锁定');
    expect(screen.queryByRole('button', { name: /调整绑定工作区/ })).toBeNull();
  });
});
