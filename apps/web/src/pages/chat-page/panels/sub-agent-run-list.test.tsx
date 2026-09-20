// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { SubAgentRunList, type SubAgentRunItem } from './sub-agent-run-list.js';

afterEach(() => {
  cleanup();
});

function makeItem(input: {
  sessionId: string;
  status: SubAgentRunItem['status'];
  title: string;
}): SubAgentRunItem {
  return {
    sessionId: input.sessionId,
    shortSessionId: input.sessionId.slice(0, 6),
    status: input.status,
    taskLabel: input.title,
    title: input.title,
    messageCount: 0,
  };
}

describe('SubAgentRunList 停止按钮', () => {
  it('未提供 onStopSession 时不渲染停止按钮', () => {
    render(
      <SubAgentRunList
        items={[makeItem({ sessionId: 's-1', status: 'running', title: '子任务一' })]}
        selectedSessionId={null}
        onSelectSession={vi.fn()}
      />,
    );

    expect(screen.queryByLabelText('停止子代理 子任务一')).toBeNull();
  });

  it('仅为活跃项渲染停止按钮，终态项不渲染', () => {
    render(
      <SubAgentRunList
        items={[
          makeItem({ sessionId: 's-1', status: 'running', title: '运行中任务' }),
          makeItem({ sessionId: 's-2', status: 'paused', title: '等待中任务' }),
          makeItem({ sessionId: 's-3', status: 'completed', title: '已完成任务' }),
          makeItem({ sessionId: 's-4', status: 'cancelled', title: '已取消任务' }),
        ]}
        selectedSessionId={null}
        onSelectSession={vi.fn()}
        onStopSession={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('停止子代理 运行中任务')).toBeTruthy();
    expect(screen.getByLabelText('停止子代理 等待中任务')).toBeTruthy();
    expect(screen.queryByLabelText('停止子代理 已完成任务')).toBeNull();
    expect(screen.queryByLabelText('停止子代理 已取消任务')).toBeNull();
  });

  it('点击停止只触发 onStopSession，不触发行选中', () => {
    const onSelectSession = vi.fn();
    const onStopSession = vi.fn();
    render(
      <SubAgentRunList
        items={[makeItem({ sessionId: 's-1', status: 'running', title: '子任务一' })]}
        selectedSessionId={null}
        onSelectSession={onSelectSession}
        onStopSession={onStopSession}
      />,
    );

    fireEvent.click(screen.getByLabelText('停止子代理 子任务一'));

    expect(onStopSession).toHaveBeenCalledTimes(1);
    expect(onStopSession).toHaveBeenCalledWith('s-1');
    expect(onSelectSession).not.toHaveBeenCalled();
  });

  it('stoppingSessionIds 命中时禁用并显示停止中', () => {
    render(
      <SubAgentRunList
        items={[makeItem({ sessionId: 's-1', status: 'running', title: '子任务一' })]}
        selectedSessionId={null}
        onSelectSession={vi.fn()}
        onStopSession={vi.fn()}
        stoppingSessionIds={new Set(['s-1'])}
      />,
    );

    const stopButton = screen.getByLabelText('停止子代理 子任务一');
    expect(stopButton.hasAttribute('disabled')).toBe(true);
    expect(stopButton.getAttribute('aria-busy')).toBe('true');
    expect(stopButton.textContent).toBe('停止中');
  });

  it('没有子代理时不渲染列表', () => {
    const { container } = render(
      <SubAgentRunList items={[]} selectedSessionId={null} onSelectSession={vi.fn()} />,
    );

    expect(container.innerHTML).toBe('');
  });
});
