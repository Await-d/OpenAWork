// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { TeamTodoDetailStream, type TeamTodoDetailMessage } from './TeamTodoDetailStream.js';

afterEach(() => {
  cleanup();
});

function makeMessages(count: number): TeamTodoDetailMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `m-${index + 1}`,
    role: index % 2 === 0 ? 'assistant' : 'user',
    who: index % 2 === 0 ? '执行' : '你',
    when: `${String(index).padStart(2, '0')}:00`,
    text: `明细消息 ${index + 1}`,
    tags: index % 5 === 0 ? (['tool'] as const) : undefined,
  }));
}

describe('TeamTodoDetailStream', () => {
  it('默认只展示最近 50 条，滚动到顶部后自动加载更早消息', () => {
    const messages = makeMessages(60);
    render(
      <TeamTodoDetailStream
        todo={{
          id: 'todo-1',
          key: 'TODO-001',
          title: '初始化架构',
          status: 'running',
          layerName: '执行层',
          roleName: '执行',
        }}
        messages={messages}
      />,
    );

    expect(screen.getByText('已显示最近 50 / 60 条消息')).toBeTruthy();
    expect(screen.getByText('上滑继续加载更早 10 条')).toBeTruthy();
    expect(screen.queryByText('明细消息 1')).toBeNull();
    expect(screen.getByText('明细消息 11')).toBeTruthy();
    expect(screen.getByText('明细消息 60')).toBeTruthy();

    const log = screen.getByRole('log', { name: '任务明细消息' });
    Object.defineProperty(log, 'scrollHeight', {
      configurable: true,
      value: 1200,
      writable: true,
    });
    Object.defineProperty(log, 'clientHeight', {
      configurable: true,
      value: 320,
      writable: true,
    });
    Object.defineProperty(log, 'scrollTop', {
      configurable: true,
      value: 0,
      writable: true,
    });

    fireEvent.scroll(log, { target: { scrollTop: 0 } });

    expect(screen.getByText('明细消息 1')).toBeTruthy();
    expect(screen.getByText('共 60 条消息')).toBeTruthy();
  });

  it('切换 todo 时重置到最近 50 条窗口', () => {
    const messagesA = makeMessages(60);
    const messagesB = makeMessages(55).map((msg) => ({
      ...msg,
      id: `b-${msg.id}`,
      text: `B ${msg.text}`,
    }));

    const { rerender } = render(
      <TeamTodoDetailStream
        todo={{
          id: 'todo-a',
          key: 'TODO-A',
          title: '任务 A',
          status: 'running',
        }}
        messages={messagesA}
      />,
    );

    const log = screen.getByRole('log', { name: '任务明细消息' });
    Object.defineProperty(log, 'scrollHeight', {
      configurable: true,
      value: 1200,
      writable: true,
    });
    Object.defineProperty(log, 'scrollTop', {
      configurable: true,
      value: 0,
      writable: true,
    });
    fireEvent.scroll(log, { target: { scrollTop: 0 } });
    expect(screen.getByText('明细消息 1')).toBeTruthy();

    rerender(
      <TeamTodoDetailStream
        todo={{
          id: 'todo-b',
          key: 'TODO-B',
          title: '任务 B',
          status: 'pending',
        }}
        messages={messagesB}
      />,
    );

    expect(screen.getByText('已显示最近 50 / 55 条消息')).toBeTruthy();
    expect(screen.queryByText('B 明细消息 1')).toBeNull();
    expect(screen.getByText('B 明细消息 6')).toBeTruthy();
    expect(screen.getByText('B 明细消息 55')).toBeTruthy();
  });

  it('空态与无 todo 文案', () => {
    render(<TeamTodoDetailStream todo={null} messages={[]} />);
    expect(screen.getByText('请选择一个任务查看详情')).toBeTruthy();
    expect(screen.getByText('暂无该任务明细消息')).toBeTruthy();
  });
});
