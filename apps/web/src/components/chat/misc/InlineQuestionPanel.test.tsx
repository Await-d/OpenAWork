// @vitest-environment jsdom
/**
 * InlineQuestionPanel 交互回归：
 * - 选择前「确认」按钮处于禁用态（必须先选才能提交）。
 * - 选中某个选项后「确认」启用，点击会触发 onSubmit('answered' 由父层决定)。
 * - 即使问题/选项很多，确认/跳过按钮也始终渲染在 DOM 中（移出滚动区，避免被挤到
 *   折叠区以下导致「选了之后看不到提交按钮」）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { InlineQuestionPanel } from './InlineQuestionPanel.js';
import type { PendingQuestionRequest } from '@openAwork/web-client';

function makeRequest(optionCount = 2): PendingQuestionRequest {
  return {
    requestId: 'q-1',
    sessionId: 'sess-1',
    toolName: 'AskUserQuestion',
    title: '需要你确认',
    status: 'pending',
    createdAt: '2026-05-31T00:00:00.000Z',
    questions: [
      {
        header: 'H',
        question: '选一个',
        multiple: false,
        options: Array.from({ length: optionCount }, (_, i) => ({
          label: `选项${i + 1}`,
          description: `描述${i + 1}`,
        })),
      },
    ],
  };
}

function makeMultiSelectRequest(): PendingQuestionRequest {
  return {
    requestId: 'q-multi',
    sessionId: 'sess-1',
    toolName: 'AskUserQuestion',
    title: '可多选问题',
    status: 'pending',
    createdAt: '2026-05-31T00:00:00.000Z',
    questions: [
      {
        header: 'MULTI',
        question: '可以选多个',
        multiple: true,
        options: [
          { label: 'A', description: 'a' },
          { label: 'B', description: 'b' },
        ],
      },
    ],
  };
}

function makeMultiQuestionRequest(): PendingQuestionRequest {
  return {
    requestId: 'q-many',
    sessionId: 'sess-1',
    toolName: 'AskUserQuestion',
    title: '多问题',
    status: 'pending',
    createdAt: '2026-05-31T00:00:00.000Z',
    questions: [
      {
        header: 'Q1',
        question: '第一题',
        multiple: false,
        options: [
          { label: 'A1', description: 'a1' },
          { label: 'B1', description: 'b1' },
        ],
      },
      {
        header: 'Q2',
        question: '第二题',
        multiple: false,
        options: [
          { label: 'A2', description: 'a2' },
          { label: 'B2', description: 'b2' },
        ],
      },
    ],
  };
}

afterEach(() => {
  cleanup();
});

describe('InlineQuestionPanel', () => {
  it('选择前「确认」按钮禁用', () => {
    render(
      <InlineQuestionPanel
        answers={[[]]}
        customInputs={['']}
        request={makeRequest()}
        onDismiss={vi.fn()}
        onSubmit={vi.fn()}
        onToggleOption={vi.fn()}
        onCustomInputChange={vi.fn()}
      />,
    );
    const submit = screen.getByRole('button', { name: '确认' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it('选中选项会调用 onToggleOption', () => {
    const onToggleOption = vi.fn();
    render(
      <InlineQuestionPanel
        answers={[[]]}
        customInputs={['']}
        request={makeRequest()}
        onDismiss={vi.fn()}
        onSubmit={vi.fn()}
        onToggleOption={onToggleOption}
        onCustomInputChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('选项1'));
    expect(onToggleOption).toHaveBeenCalledWith(0, '选项1', false);
  });

  it('已选中答案时「确认」启用且点击触发 onSubmit', () => {
    const onSubmit = vi.fn();
    render(
      <InlineQuestionPanel
        answers={[['选项1']]}
        customInputs={['']}
        request={makeRequest()}
        onDismiss={vi.fn()}
        onSubmit={onSubmit}
        onToggleOption={vi.fn()}
        onCustomInputChange={vi.fn()}
      />,
    );
    const submit = screen.getByRole('button', { name: '确认' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('选项很多时确认/跳过按钮仍渲染在 DOM（不被滚动区吞掉）', () => {
    render(
      <InlineQuestionPanel
        answers={[['选项1']]}
        customInputs={['']}
        request={makeRequest(20)}
        onDismiss={vi.fn()}
        onSubmit={vi.fn()}
        onToggleOption={vi.fn()}
        onCustomInputChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: '确认' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '跳过' })).toBeTruthy();
  });

  it('提交中状态下按钮显示「提交中…」并禁用', () => {
    render(
      <InlineQuestionPanel
        answers={[['选项1']]}
        customInputs={['']}
        pendingAction="answered"
        request={makeRequest()}
        onDismiss={vi.fn()}
        onSubmit={vi.fn()}
        onToggleOption={vi.fn()}
        onCustomInputChange={vi.fn()}
      />,
    );
    const submit = screen.getByRole('button', { name: '提交中…' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it('多选问题显示「可多选」标签', () => {
    render(
      <InlineQuestionPanel
        answers={[[]]}
        customInputs={['']}
        request={makeMultiSelectRequest()}
        onDismiss={vi.fn()}
        onSubmit={vi.fn()}
        onToggleOption={vi.fn()}
        onCustomInputChange={vi.fn()}
      />,
    );
    expect(screen.getByText('可多选')).toBeTruthy();
  });

  it('单选问题不显示「可多选」标签', () => {
    render(
      <InlineQuestionPanel
        answers={[[]]}
        customInputs={['']}
        request={makeRequest()}
        onDismiss={vi.fn()}
        onSubmit={vi.fn()}
        onToggleOption={vi.fn()}
        onCustomInputChange={vi.fn()}
      />,
    );
    expect(screen.queryByText('可多选')).toBeNull();
  });

  it('单选问题选项用 radio（圆形）指示器', () => {
    const { container } = render(
      <InlineQuestionPanel
        answers={[[]]}
        customInputs={['']}
        request={makeRequest()}
        onDismiss={vi.fn()}
        onSubmit={vi.fn()}
        onToggleOption={vi.fn()}
        onCustomInputChange={vi.fn()}
      />,
    );
    expect(container.querySelectorAll('[data-select-mode="single"]').length).toBeGreaterThan(0);
    expect(container.querySelector('[data-select-mode="multiple"]')).toBeNull();
  });

  it('多选问题选项用 checkbox（方形）指示器', () => {
    const { container } = render(
      <InlineQuestionPanel
        answers={[[]]}
        customInputs={['']}
        request={makeMultiSelectRequest()}
        onDismiss={vi.fn()}
        onSubmit={vi.fn()}
        onToggleOption={vi.fn()}
        onCustomInputChange={vi.fn()}
      />,
    );
    expect(container.querySelectorAll('[data-select-mode="multiple"]').length).toBeGreaterThan(0);
    expect(container.querySelector('[data-select-mode="single"]')).toBeNull();
  });

  it('已选中答案时按 Enter 触发 onSubmit', () => {
    const onSubmit = vi.fn();
    render(
      <InlineQuestionPanel
        answers={[['选项1']]}
        customInputs={['']}
        request={makeRequest()}
        onDismiss={vi.fn()}
        onSubmit={onSubmit}
        onToggleOption={vi.fn()}
        onCustomInputChange={vi.fn()}
      />,
    );
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('未选择时按 Enter 不触发 onSubmit', () => {
    const onSubmit = vi.fn();
    render(
      <InlineQuestionPanel
        answers={[[]]}
        customInputs={['']}
        request={makeRequest()}
        onDismiss={vi.fn()}
        onSubmit={onSubmit}
        onToggleOption={vi.fn()}
        onCustomInputChange={vi.fn()}
      />,
    );
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('焦点在输入框时按 Enter 不触发整体提交', () => {
    const onSubmit = vi.fn();
    render(
      <InlineQuestionPanel
        answers={[['选项1']]}
        customInputs={['']}
        request={makeRequest()}
        onDismiss={vi.fn()}
        onSubmit={onSubmit}
        onToggleOption={vi.fn()}
        onCustomInputChange={vi.fn()}
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
      <InlineQuestionPanel
        answers={[['选项1']]}
        customInputs={['']}
        pendingAction="answered"
        request={makeRequest()}
        onDismiss={vi.fn()}
        onSubmit={onSubmit}
        onToggleOption={vi.fn()}
        onCustomInputChange={vi.fn()}
      />,
    );
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('多问题：仅回答部分时「确认」仍禁用（必须全部回答）', () => {
    render(
      <InlineQuestionPanel
        answers={[['A1'], []]}
        customInputs={['', '']}
        request={makeMultiQuestionRequest()}
        onDismiss={vi.fn()}
        onSubmit={vi.fn()}
        onToggleOption={vi.fn()}
        onCustomInputChange={vi.fn()}
      />,
    );
    const submit = screen.getByRole('button', { name: '确认' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    // 头部进度显示 1/2
    expect(screen.getByText('1/2')).toBeTruthy();
  });

  it('多问题：全部回答后「确认」启用', () => {
    render(
      <InlineQuestionPanel
        answers={[['A1'], ['B2']]}
        customInputs={['', '']}
        request={makeMultiQuestionRequest()}
        onDismiss={vi.fn()}
        onSubmit={vi.fn()}
        onToggleOption={vi.fn()}
        onCustomInputChange={vi.fn()}
      />,
    );
    const submit = screen.getByRole('button', { name: '确认' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    expect(screen.getByText('2/2')).toBeTruthy();
  });
});
