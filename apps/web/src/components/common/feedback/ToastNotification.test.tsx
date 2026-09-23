// @vitest-environment jsdom

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastContainer, toast } from './ToastNotification.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ToastNotification action', () => {
  it('无 action 时不渲染操作按钮', () => {
    render(<ToastContainer />);
    act(() => {
      toast('已回退到所选消息', 'success');
    });
    expect(screen.getByText('已回退到所选消息')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '查看文件变更' })).toBeNull();
  });

  it('带 action 时渲染按钮，点击触发回调并关闭该 toast', async () => {
    const onClick = vi.fn();
    render(<ToastContainer />);
    act(() => {
      toast('已回退到所选消息', 'success', undefined, {
        action: { label: '查看文件变更', onClick },
      });
    });

    const actionButton = screen.getByRole('button', { name: '查看文件变更' });
    act(() => {
      actionButton.click();
    });
    expect(onClick).toHaveBeenCalledTimes(1);

    // 退出动画 180ms 后条目被移除
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 260));
    });
    expect(screen.queryByText('已回退到所选消息')).toBeNull();
  });
});
