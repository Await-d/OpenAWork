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
      onToggleYolo={props.onToggleYolo}
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

/** YOLO 场景的必填 props 基线：默认不传 onToggleYolo，用于验证只读 chip 分支。 */
function yoloDefaults(yoloMode: boolean): ChatTopBarProps {
  return {
    dialogueMode: 'coding',
    onChangeDialogueMode: () => undefined,
    yoloMode,
    editorMode: false,
    onToggleEditorMode: () => undefined,
    rightOpen: false,
    onToggleRightOpen: () => undefined,
  };
}

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

describe('ChatTopBar — YOLO 入口', () => {
  it('未提供 onToggleYolo 且已开启 YOLO 时渲染只读 chip，而不是按钮', () => {
    render(<ChatTopBar {...yoloDefaults(true)} />);

    const chip = screen.getByTestId('chat-top-bar-yolo-chip');
    expect(chip.tagName).toBe('SPAN');
    expect(chip.getAttribute('data-readonly')).toBe('true');
    expect(chip.getAttribute('title')).toBe('YOLO 模式已开启（在输入框中切换）');
    expect(chip.textContent).toContain('YOLO');
    expect(screen.queryByRole('button', { name: 'YOLO' })).toBeNull();
  });

  it('未提供 onToggleYolo 且未开启 YOLO 时不渲染任何内容', () => {
    render(<ChatTopBar {...yoloDefaults(false)} />);

    expect(screen.queryByTestId('chat-top-bar-yolo-chip')).toBeNull();
    expect(screen.queryByText('YOLO')).toBeNull();
  });

  it('提供 onToggleYolo 时保留原有可点击按钮行为', () => {
    const onToggleYolo = vi.fn();
    render(<ChatTopBar {...yoloDefaults(true)} onToggleYolo={onToggleYolo} />);

    const button = screen.getByRole('button', { name: 'YOLO' });
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByTestId('chat-top-bar-yolo-chip')).toBeNull();

    fireEvent.click(button);
    expect(onToggleYolo).toHaveBeenCalledTimes(1);
  });

  it('hideYoloToggle 同时隐藏按钮与只读 chip', () => {
    const onToggleYolo = vi.fn();
    render(<ChatTopBar {...yoloDefaults(true)} onToggleYolo={onToggleYolo} hideYoloToggle />);
    expect(screen.queryByRole('button', { name: 'YOLO' })).toBeNull();

    cleanup();
    render(<ChatTopBar {...yoloDefaults(true)} hideYoloToggle />);
    expect(screen.queryByTestId('chat-top-bar-yolo-chip')).toBeNull();
  });
});

describe('ChatTopBar — 审批方式档位标识', () => {
  it('permissionMode="auto-edit" 渲染中性（aux）只读 chip，不使用琥珀警示色', () => {
    renderTopBar({ permissionMode: 'auto-edit' });

    const chip = screen.getByTestId('chat-top-bar-auto-edit-chip');
    expect(chip.tagName).toBe('SPAN');
    expect(chip.getAttribute('data-readonly')).toBe('true');
    expect(chip.getAttribute('data-tone')).toBe('info');
    expect(chip.getAttribute('title')).toBe('编辑自动（在输入框中切换）');
    expect(chip.textContent).toContain('编辑自动');
    expect(chip.getAttribute('style') ?? '').not.toContain('--warning');
    expect(screen.queryByTestId('chat-top-bar-yolo-chip')).toBeNull();
  });

  it('permissionMode="yolo" 渲染琥珀只读 chip', () => {
    renderTopBar({ permissionMode: 'yolo' });

    const chip = screen.getByTestId('chat-top-bar-yolo-chip');
    expect(chip.getAttribute('title')).toBe('YOLO 模式已开启（在输入框中切换）');
    expect(screen.queryByTestId('chat-top-bar-auto-edit-chip')).toBeNull();
  });

  it('permissionMode="ask" 不渲染任何只读标识', () => {
    renderTopBar({ permissionMode: 'ask' });

    expect(screen.queryByTestId('chat-top-bar-yolo-chip')).toBeNull();
    expect(screen.queryByTestId('chat-top-bar-auto-edit-chip')).toBeNull();
  });

  it('未提供 permissionMode 时，legacy yoloMode 布尔仍渲染琥珀 chip', () => {
    renderTopBar({ yoloMode: true });

    expect(screen.getByTestId('chat-top-bar-yolo-chip')).toBeTruthy();
    expect(screen.queryByTestId('chat-top-bar-auto-edit-chip')).toBeNull();
  });

  it('hideYoloToggle 同时隐藏 auto-edit 只读 chip', () => {
    renderTopBar({ permissionMode: 'auto-edit', hideYoloToggle: true });

    expect(screen.queryByTestId('chat-top-bar-auto-edit-chip')).toBeNull();
  });
});

describe('ChatTopBar — 确认转换按钮', () => {
  it('澄清模式且提供回调时渲染按钮，点击触发确认', () => {
    const onConfirmClarifySwitch = vi.fn();
    renderTopBar({ dialogueMode: 'clarify', onConfirmClarifySwitch });

    const button = screen.getByTestId('dialogue-mode-switch-button');
    expect(button.textContent).toContain('确认转换');
    expect(button.getAttribute('aria-label')).toContain('切换到编程模式');

    fireEvent.click(button);
    expect(onConfirmClarifySwitch).toHaveBeenCalledTimes(1);
  });

  it('非澄清模式不渲染按钮', () => {
    renderTopBar({ dialogueMode: 'coding', onConfirmClarifySwitch: vi.fn() });
    expect(screen.queryByTestId('dialogue-mode-switch-button')).toBeNull();

    cleanup();
    renderTopBar({ dialogueMode: 'programmer', onConfirmClarifySwitch: vi.fn() });
    expect(screen.queryByTestId('dialogue-mode-switch-button')).toBeNull();
  });

  it('未提供回调时不渲染按钮（team 等场景）', () => {
    renderTopBar({ dialogueMode: 'clarify' });
    expect(screen.queryByTestId('dialogue-mode-switch-button')).toBeNull();
  });

  it('请求进行中进入 pending 态：禁用且不可重复点击', () => {
    const onConfirmClarifySwitch = vi.fn();
    renderTopBar({ dialogueMode: 'clarify', onConfirmClarifySwitch, clarifySwitchPending: true });

    const button = screen.getByTestId('dialogue-mode-switch-button');
    expect(button.getAttribute('data-pending')).toBe('true');
    expect((button as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(button);
    expect(onConfirmClarifySwitch).not.toHaveBeenCalled();
  });
});
