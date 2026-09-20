// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { BatchStopSubAgentsControl } from './batch-stop-sub-agents-control.js';

afterEach(() => {
  cleanup();
});

describe('BatchStopSubAgentsControl', () => {
  it('activeCount 为 0 时不渲染任何内容', () => {
    const { container } = render(
      <BatchStopSubAgentsControl activeCount={0} stopping={false} onConfirm={vi.fn()} />,
    );

    expect(container.innerHTML).toBe('');
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByTestId('batch-stop-sub-agents-trigger')).toBeNull();
  });

  it('按活动数量渲染可点击的触发器', () => {
    render(<BatchStopSubAgentsControl activeCount={3} stopping={false} onConfirm={vi.fn()} />);

    const trigger = screen.getByTestId('batch-stop-sub-agents-trigger') as HTMLButtonElement;
    expect(trigger).toBeInstanceOf(HTMLButtonElement);
    expect(trigger.getAttribute('type')).toBe('button');
    expect(trigger.disabled).toBe(false);
    expect(trigger.textContent).toContain('停止全部子代理（3）');
    expect(screen.getByRole('button', { name: '停止全部子代理（3）' })).toBe(trigger);
  });

  it('点击触发器打开确认弹窗并展示确认文案', () => {
    render(<BatchStopSubAgentsControl activeCount={2} stopping={false} onConfirm={vi.fn()} />);

    fireEvent.click(screen.getByTestId('batch-stop-sub-agents-trigger'));

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('停止全部子代理')).toBeTruthy();
    expect(screen.getByText('将停止 2 个正在运行的子代理，此操作不可撤销。')).toBeTruthy();
    expect(screen.getByRole('button', { name: '取消' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '确认停止' })).toBeTruthy();
  });

  it('确认后调用 onConfirm 一次并关闭弹窗', () => {
    const onConfirm = vi.fn();
    render(<BatchStopSubAgentsControl activeCount={4} stopping={false} onConfirm={onConfirm} />);

    fireEvent.click(screen.getByTestId('batch-stop-sub-agents-trigger'));
    fireEvent.click(screen.getByTestId('batch-stop-sub-agents-confirm'));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('取消只关闭弹窗，不触发 onConfirm', () => {
    const onConfirm = vi.fn();
    render(<BatchStopSubAgentsControl activeCount={1} stopping={false} onConfirm={onConfirm} />);

    fireEvent.click(screen.getByTestId('batch-stop-sub-agents-trigger'));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Esc 关闭弹窗且不触发 onConfirm', () => {
    const onConfirm = vi.fn();
    render(<BatchStopSubAgentsControl activeCount={2} stopping={false} onConfirm={onConfirm} />);

    fireEvent.click(screen.getByTestId('batch-stop-sub-agents-trigger'));
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('stopping 为 true 时禁用触发器并展示停止中状态', () => {
    render(<BatchStopSubAgentsControl activeCount={2} stopping onConfirm={vi.fn()} />);

    const trigger = screen.getByTestId('batch-stop-sub-agents-trigger') as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);
    expect(trigger.textContent).toContain('正在停止…');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('请求在途时禁用弹窗内的确认按钮', () => {
    const onConfirm = vi.fn();
    const { rerender } = render(
      <BatchStopSubAgentsControl activeCount={2} stopping={false} onConfirm={onConfirm} />,
    );

    fireEvent.click(screen.getByTestId('batch-stop-sub-agents-trigger'));
    rerender(<BatchStopSubAgentsControl activeCount={2} stopping onConfirm={onConfirm} />);

    const confirm = screen.getByTestId('batch-stop-sub-agents-confirm') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    expect((screen.getByRole('button', { name: '取消' }) as HTMLButtonElement).disabled).toBe(
      false,
    );

    fireEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
