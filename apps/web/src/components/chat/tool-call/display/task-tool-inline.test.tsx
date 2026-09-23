// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const resolveDisplayData = vi.fn();

vi.mock('@openAwork/shared-ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openAwork/shared-ui')>();
  return {
    ...actual,
    ToolKindIcon: () => <span data-testid="tool-kind-icon" />,
    resolveToolCallCardDisplayData: (input: unknown) => resolveDisplayData(input),
  };
});

import { TaskToolInline } from './task-tool-inline.js';

beforeEach(() => {
  resolveDisplayData.mockReset();
});

afterEach(() => {
  cleanup();
});

function queryCard(container: HTMLElement): HTMLElement {
  const card = container.querySelector<HTMLElement>('[data-chat-task-inline="true"]');
  expect(card).not.toBeNull();
  return card as HTMLElement;
}

describe('TaskToolInline 内联提示', () => {
  it('剩余字段为对象时不展示原始 JSON，而是给出字段名摘要', () => {
    resolveDisplayData.mockReturnValue({
      taskMeta: {
        agentType: 'general',
        extraOutput: { foo: { bar: 1 } },
        outputStatus: 'completed',
        readonly: false,
        hasAdditionalInputFields: false,
      },
      taskSummary: { title: '子代理任务' },
      summary: '子代理任务',
      displayToolName: 'task',
      showInputField: true,
      hasDetails: true,
    });

    const { container } = render(
      <TaskToolInline
        toolName="task"
        input={{ prompt: 'x' }}
        output={{ foo: { bar: 1 } }}
        status="completed"
      />,
    );

    const footer = container.querySelector('.chat-task-inline-footer');
    expect(footer?.textContent).toBe('字段：foo');
    expect(footer?.textContent).not.toContain('{');
  });

  it('精简分支（无 taskMeta）在输出能解析出子会话 id 时也可点击', () => {
    resolveDisplayData.mockReturnValue({
      taskMeta: undefined,
      taskSummary: undefined,
      summary: '代理委派',
      displayToolName: 'call_omo_agent',
      showInputField: false,
      hasDetails: false,
    });
    const onOpenChildSession = vi.fn();

    const { container } = render(
      <TaskToolInline
        toolName="call_omo_agent"
        input={{ prompt: '跑一下', subagent_type: 'explore' }}
        output={'<subagent sessionID="ses_child_9" state="completed">done</subagent>'}
        status="completed"
        onOpenChildSession={onOpenChildSession}
      />,
    );

    const card = queryCard(container);
    expect(card.tagName).toBe('BUTTON');
    expect(card.getAttribute('data-clickable')).toBe('true');
    expect(card.querySelector('.chat-task-inline-hint')?.textContent).toBe('点击查看');

    fireEvent.click(card);
    expect(onOpenChildSession).toHaveBeenCalledWith('ses_child_9');
  });

  it('富信息分支从文本输出解析子会话 id 并回传点击', () => {
    resolveDisplayData.mockReturnValue({
      taskMeta: { agentType: 'explore', readonly: false, hasAdditionalInputFields: false },
      taskSummary: { title: '调查 foo' },
      summary: '调查 foo',
      displayToolName: '子代理任务',
      showInputField: true,
      hasDetails: true,
    });
    const onOpenChildSession = vi.fn();

    const { container } = render(
      <TaskToolInline
        toolName="subagent"
        input={{ prompt: '调查 foo', subagent_type: 'explore' }}
        output={'后台 agent 任务已成功启动。\n\n会话 ID：ses_child_7\n状态：running'}
        status="running"
        onOpenChildSession={onOpenChildSession}
      />,
    );

    const card = queryCard(container);
    expect(card.getAttribute('data-clickable')).toBe('true');
    expect(container.querySelector('.chat-task-inline-footer')?.textContent).toBe(
      '会话 ses_child_7',
    );

    fireEvent.click(card);
    expect(onOpenChildSession).toHaveBeenCalledWith('ses_child_7');
  });

  it('resume 输入的 requestedSessionId 可打开预览并展示选中态', () => {
    resolveDisplayData.mockReturnValue({
      taskMeta: {
        agentType: 'oracle',
        requestedSessionId: 'ses_child_4',
        readonly: false,
        hasAdditionalInputFields: false,
      },
      taskSummary: { title: '继续审查' },
      summary: '继续审查',
      displayToolName: '子代理任务',
      showInputField: true,
      hasDetails: true,
    });
    const onOpenChildSession = vi.fn();

    const { container } = render(
      <TaskToolInline
        toolName="subagent"
        input={{ prompt: '继续', session_id: 'ses_child_4' }}
        selectedChildSessionId="ses_child_4"
        onOpenChildSession={onOpenChildSession}
      />,
    );

    const card = queryCard(container);
    expect(card.getAttribute('data-selected')).toBe('true');
    expect(container.querySelector('.chat-task-inline-hint')?.textContent).toBe('正在查看');

    fireEvent.click(card);
    expect(onOpenChildSession).toHaveBeenCalledWith('ses_child_4');
  });

  it('runtimeSnapshot 携带子会话 id 时同样可点击', () => {
    resolveDisplayData.mockReturnValue({
      taskMeta: { agentType: 'explore', readonly: false, hasAdditionalInputFields: false },
      taskSummary: { title: '调查 foo' },
      summary: '调查 foo',
      displayToolName: '子代理任务',
      showInputField: true,
      hasDetails: true,
    });
    const onOpenChildSession = vi.fn();

    const { container } = render(
      <TaskToolInline
        toolName="subagent"
        input={{ prompt: '调查 foo' }}
        runtimeSnapshot={{
          sessionId: 'ses_child_11',
          status: 'running',
          taskId: 'task_11',
          title: '调查 foo',
          updatedAt: 0,
        }}
        onOpenChildSession={onOpenChildSession}
      />,
    );

    fireEvent.click(queryCard(container));
    expect(onOpenChildSession).toHaveBeenCalledWith('ses_child_11');
  });

  it('没有子会话 id 时保持不可点击', () => {
    resolveDisplayData.mockReturnValue({
      taskMeta: { agentType: 'explore', readonly: false, hasAdditionalInputFields: false },
      taskSummary: { title: '无输出任务' },
      summary: '无输出任务',
      displayToolName: '子代理任务',
      showInputField: true,
      hasDetails: true,
    });
    const onOpenChildSession = vi.fn();

    const { container } = render(
      <TaskToolInline
        toolName="subagent"
        input={{ prompt: '无输出' }}
        onOpenChildSession={onOpenChildSession}
      />,
    );

    const card = queryCard(container);
    expect(card.tagName).toBe('DIV');
    expect(card.getAttribute('data-clickable')).toBe('false');
    expect(container.querySelector('.chat-task-inline-hint')).toBeNull();
  });
});
