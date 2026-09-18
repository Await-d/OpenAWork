// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { RunEvent } from '@openAwork/shared';
import { TeamRunEventsPreview } from './TeamRunEventsPreview.js';

afterEach(() => {
  cleanup();
});

const SAMPLE_EVENTS: RunEvent[] = [
  { type: 'text_delta', delta: '先梳理一下当前进展' },
  { type: 'tool_result', toolCallId: 'tool-1', toolName: 'bash', output: 'ok', isError: false },
];

const NO_ITEM_EVENTS: RunEvent[] = [{ type: 'thinking_start' }];

describe('TeamRunEventsPreview', () => {
  it('事件为空时不渲染任何内容', () => {
    const { container } = render(<TeamRunEventsPreview runEvents={[]} />);

    expect(container.firstChild).toBeNull();
    expect(screen.queryByText('过程时间线')).toBeNull();
  });

  it('事件不产生条目时不渲染任何内容', () => {
    const { container } = render(<TeamRunEventsPreview runEvents={NO_ITEM_EVENTS} />);

    expect(container.firstChild).toBeNull();
  });

  it('默认折叠：只渲染标题、计数徽标与最新条目标题，不渲染条目详情', () => {
    render(<TeamRunEventsPreview runEvents={SAMPLE_EVENTS} />);

    expect(screen.getByText('过程时间线')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByText('工具结果 · bash')).toBeTruthy();
    expect(screen.queryByText('文本生成')).toBeNull();
    expect(screen.queryByText('先梳理一下当前进展')).toBeNull();
    expect(screen.queryByText('已返回 bash 执行结果')).toBeNull();

    const toggle = screen.getByLabelText('展开过程时间线');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.textContent).toBe('展开');
  });

  it('点击切换按钮后渲染条目标题与详情，再次点击恢复折叠', () => {
    render(<TeamRunEventsPreview runEvents={SAMPLE_EVENTS} />);

    fireEvent.click(screen.getByLabelText('展开过程时间线'));

    const expandedToggle = screen.getByLabelText('收起过程时间线');
    expect(expandedToggle.getAttribute('aria-expanded')).toBe('true');
    expect(expandedToggle.textContent).toBe('收起');
    expect(screen.getByText('文本生成')).toBeTruthy();
    expect(screen.getByText('先梳理一下当前进展')).toBeTruthy();
    expect(screen.getByText('已返回 bash 执行结果')).toBeTruthy();

    fireEvent.click(expandedToggle);

    expect(screen.getByLabelText('展开过程时间线').getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('文本生成')).toBeNull();
    expect(screen.queryByText('已返回 bash 执行结果')).toBeNull();
  });
});
