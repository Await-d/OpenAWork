// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatWorkbenchStatusStrip } from './ChatWorkbenchStatusStrip.js';

afterEach(() => {
  cleanup();
});

const DEFAULT_PROPS = {
  activeTerminalCount: 2,
  dialogueModeLabel: '程序员',
  editorMode: true,
  editorPaneTab: 'code',
  messageCount: 18,
  modelLabel: 'gpt-5.5-codex',
  onToggleReviewPanel: () => undefined,
  onToggleTerminalPanel: () => undefined,
  reviewPanelOpened: true,
  sessionId: 'session-alpha-123456',
  taskCount: 4,
  terminalPanelOpened: true,
  workspacePath: '/home/await/project/OpenAWork',
} as const;

describe('ChatWorkbenchStatusStrip', () => {
  it('展示 Chat 工作台摘要和面板状态', () => {
    render(<ChatWorkbenchStatusStrip {...DEFAULT_PROPS} />);

    expect(screen.getByLabelText('Chat 工作台摘要')).toBeTruthy();
    expect(screen.getByText('Chat workbench')).toBeTruthy();
    expect(screen.getByText('会话 session- · OpenAWork')).toBeTruthy();
    expect(screen.getAllByText('程序员模式').length).toBeGreaterThan(0);
    expect(screen.getByText('审查展开')).toBeTruthy();
    expect(screen.getByText('2 个终端运行')).toBeTruthy();
    expect(screen.getByText('gpt-5.5-codex')).toBeTruthy();
    expect(screen.getByText('18 条')).toBeTruthy();
    expect(screen.getByText('4 项')).toBeTruthy();
    expect(screen.getByText('代码面板')).toBeTruthy();
  });

  it('状态条提供审查和终端面板的直接控制入口', () => {
    const onToggleReviewPanel = vi.fn();
    const onToggleTerminalPanel = vi.fn();
    render(
      <ChatWorkbenchStatusStrip
        {...DEFAULT_PROPS}
        onToggleReviewPanel={onToggleReviewPanel}
        onToggleTerminalPanel={onToggleTerminalPanel}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '收起审查面板' }));
    fireEvent.click(screen.getByRole('button', { name: '收起终端面板' }));

    expect(onToggleReviewPanel).toHaveBeenCalledTimes(1);
    expect(onToggleTerminalPanel).toHaveBeenCalledTimes(1);
  });

  it('缺少会话、工作区和模型时展示明确占位', () => {
    render(
      <ChatWorkbenchStatusStrip
        {...DEFAULT_PROPS}
        activeTerminalCount={0}
        editorMode={false}
        modelLabel=""
        reviewPanelOpened={false}
        sessionId={null}
        terminalPanelOpened={false}
        workspacePath={null}
      />,
    );

    expect(screen.getByText('未创建会话 · 未选择工作区')).toBeTruthy();
    expect(screen.getByText('未选择模型')).toBeTruthy();
    expect(screen.getByText('审查折叠')).toBeTruthy();
    expect(screen.getByText('终端折叠')).toBeTruthy();
    expect(screen.getByText('编辑器关闭')).toBeTruthy();
  });
});
