// @vitest-environment jsdom
/**
 * QuestionPromptCard 交互回归（非聊天页 / 团队页用的全局问答卡片）：
 * - 所有问题回答前「提交回答」禁用；按 Enter 不触发提交。
 * - 全部回答后「提交回答」启用；点击 / 按 Enter 都触发 onSubmit。
 * - 焦点在输入框时按 Enter 不触发整体提交。
 * - 多选问题展示「可多选」标签。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import QuestionPromptCard from './QuestionPromptCard.js';
import type { PendingQuestionRequest } from '@openAwork/web-client';

function makeRequest(multiple = false): PendingQuestionRequest {
  return {
    requestId: 'q-1',
    sessionId: 'sess-1',
    toolName: 'AskUserQuestion',
    title: '需要你确认',
    status: 'pending',
    createdAt: '2026-05-31T00:00:00.000Z',
    questions: [
      {
        header: multiple ? 'MULTI' : 'H',
        question: '选一个',
        multiple,
        options: [
          { label: '选项1', description: '描述1' },
          { label: '选项2', description: '描述2' },
        ],
      },
    ],
  };
}

afterEach(() => {
  cleanup();
});

describe('QuestionPromptCard', () => {
  it('未回答时「提交回答」禁用且 Enter 不触发', () => {
    const onSubmit = vi.fn();
    render(
      <QuestionPromptCard
        answers={[[]]}
        request={makeRequest()}
        onDismiss={vi.fn()}
        onSubmit={onSubmit}
        onToggleOption={vi.fn()}
      />,
    );
    const submit = screen.getByRole('button', { name: '提交回答' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('全部回答后点击「提交回答」触发 onSubmit', () => {
    const onSubmit = vi.fn();
    render(
      <QuestionPromptCard
        answers={[['选项1']]}
        request={makeRequest()}
        onDismiss={vi.fn()}
        onSubmit={onSubmit}
        onToggleOption={vi.fn()}
      />,
    );
    const submit = screen.getByRole('button', { name: '提交回答' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('全部回答后按 Enter 触发 onSubmit', () => {
    const onSubmit = vi.fn();
    render(
      <QuestionPromptCard
        answers={[['选项1']]}
        request={makeRequest()}
        onDismiss={vi.fn()}
        onSubmit={onSubmit}
        onToggleOption={vi.fn()}
      />,
    );
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('焦点在输入框时按 Enter 不触发整体提交', () => {
    const onSubmit = vi.fn();
    render(
      <QuestionPromptCard
        answers={[['选项1']]}
        request={makeRequest()}
        onDismiss={vi.fn()}
        onSubmit={onSubmit}
        onToggleOption={vi.fn()}
      />,
    );
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSubmit).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });

  it('提交中状态按 Enter 不重复触发', () => {
    const onSubmit = vi.fn();
    render(
      <QuestionPromptCard
        answers={[['选项1']]}
        pendingAction="answered"
        request={makeRequest()}
        onDismiss={vi.fn()}
        onSubmit={onSubmit}
        onToggleOption={vi.fn()}
      />,
    );
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('多选问题显示「可多选」标签，单选不显示', () => {
    const { rerender } = render(
      <QuestionPromptCard
        answers={[[]]}
        request={makeRequest(true)}
        onDismiss={vi.fn()}
        onSubmit={vi.fn()}
        onToggleOption={vi.fn()}
      />,
    );
    expect(screen.getByText('可多选')).toBeTruthy();

    rerender(
      <QuestionPromptCard
        answers={[[]]}
        request={makeRequest(false)}
        onDismiss={vi.fn()}
        onSubmit={vi.fn()}
        onToggleOption={vi.fn()}
      />,
    );
    expect(screen.queryByText('可多选')).toBeNull();
  });

  it('单选用 radio（圆形）指示器、多选用 checkbox（方形）指示器', () => {
    const { container, rerender } = render(
      <QuestionPromptCard
        answers={[[]]}
        request={makeRequest(false)}
        onDismiss={vi.fn()}
        onSubmit={vi.fn()}
        onToggleOption={vi.fn()}
      />,
    );
    expect(container.querySelectorAll('[data-select-mode="single"]').length).toBeGreaterThan(0);
    expect(container.querySelector('[data-select-mode="multiple"]')).toBeNull();

    rerender(
      <QuestionPromptCard
        answers={[[]]}
        request={makeRequest(true)}
        onDismiss={vi.fn()}
        onSubmit={vi.fn()}
        onToggleOption={vi.fn()}
      />,
    );
    expect(container.querySelectorAll('[data-select-mode="multiple"]').length).toBeGreaterThan(0);
    expect(container.querySelector('[data-select-mode="single"]')).toBeNull();
  });
});
