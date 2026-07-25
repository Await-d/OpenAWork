// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { TeamInlineOpsCard } from './TeamInlineOpsCard.js';
import type { TeamInlineOpsCardProps } from './TeamInlineOpsCard.js';

afterEach(() => cleanup());

function createProps(overrides?: Partial<TeamInlineOpsCardProps>): TeamInlineOpsCardProps {
  return {
    tone: 'progress',
    title: '部署进行中',
    ...overrides,
  };
}

describe('TeamInlineOpsCard', () => {
  it('渲染标题', () => {
    render(<TeamInlineOpsCard {...createProps()} />);
    expect(screen.getByText('部署进行中')).toBeTruthy();
  });

  it('渲染 body 文本', () => {
    render(<TeamInlineOpsCard {...createProps({ body: '正在构建前端产物' })} />);
    expect(screen.getByText('正在构建前端产物')).toBeTruthy();
  });

  it('渲染 timeLabel', () => {
    render(<TeamInlineOpsCard {...createProps({ timeLabel: '2m 30s' })} />);
    expect(screen.getByText('2m 30s')).toBeTruthy();
  });

  it('渲染 code 区块', () => {
    render(<TeamInlineOpsCard {...createProps({ code: 'exit code 1' })} />);
    expect(screen.getByText('exit code 1')).toBeTruthy();
  });

  it('渲染 doneNote', () => {
    render(<TeamInlineOpsCard {...createProps({ tone: 'done', doneNote: '已完成' })} />);
    expect(screen.getByText('已完成')).toBeTruthy();
  });

  it('点击 action 按钮触发 onClick', () => {
    const onClick = vi.fn();
    render(
      <TeamInlineOpsCard
        {...createProps({
          actions: [{ id: 'retry', label: '重试', onClick }],
        })}
      />,
    );
    fireEvent.click(screen.getByText('重试'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('点击 artifact 按钮触发 onClick', () => {
    const onClick = vi.fn();
    render(
      <TeamInlineOpsCard
        {...createProps({
          artifacts: [{ id: 'log', label: '查看日志', onClick }],
        })}
      />,
    );
    fireEvent.click(screen.getByText('查看日志'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('无 actions / artifacts 时不渲染按钮区', () => {
    const { container } = render(<TeamInlineOpsCard {...createProps()} />);
    const buttons = container.querySelectorAll('button');
    expect(buttons.length).toBe(0);
  });
});
