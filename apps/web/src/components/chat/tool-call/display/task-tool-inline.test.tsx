// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@openAwork/shared-ui', () => ({
  ToolKindIcon: () => <span data-testid="tool-kind-icon" />,
  resolveToolCallCardDisplayData: () => ({
    taskMeta: { agentType: 'general', extraOutput: { foo: { bar: 1 } }, outputStatus: 'completed' },
    taskSummary: { title: '子代理任务' },
    summary: '子代理任务',
    displayToolName: 'task',
    showInputField: true,
    hasDetails: true,
  }),
  tokens: {
    color: {
      danger: 'var(--color-danger)',
      info: 'var(--color-info)',
      muted: 'var(--color-muted)',
      success: 'var(--color-success)',
      warning: 'var(--color-warning)',
    },
  },
}));

import { TaskToolInline } from './task-tool-inline.js';

afterEach(() => {
  cleanup();
});

describe('TaskToolInline 内联提示', () => {
  it('剩余字段为对象时不展示原始 JSON，而是给出字段名摘要', () => {
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
});
