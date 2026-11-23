// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { InlineEditor } from '../index.js';

afterEach(cleanup);

describe('InlineEditor — IME 组合态', () => {
  it('组合态下的 Enter 不保存（交给输入法确认候选词）', async () => {
    const onSave = vi.fn<(value: string) => void>();

    render(<InlineEditor label="会话标题" value="旧标题" onSave={onSave} />);

    fireEvent.doubleClick(screen.getByRole('button', { name: '会话标题: 旧标题' }));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '半成品' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });

    // 仍在编辑态，且没有提交
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox')).toBeTruthy();
  });

  it('keyCode 229 的 Enter 同样不保存（Chromium 处理中标记）', () => {
    const onSave = vi.fn<(value: string) => void>();

    render(<InlineEditor label="会话标题" value="旧标题" onSave={onSave} />);

    fireEvent.doubleClick(screen.getByRole('button', { name: '会话标题: 旧标题' }));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '半成品' } });
    fireEvent.keyDown(input, { key: 'Process', keyCode: 229 });

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox')).toBeTruthy();
  });

  it('非组合态的普通 Enter 保存修剪后的值', async () => {
    const onSave = vi.fn<(value: string) => void>();

    render(<InlineEditor label="会话标题" value="旧标题" onSave={onSave} />);

    fireEvent.doubleClick(screen.getByRole('button', { name: '会话标题: 旧标题' }));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '  新标题  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(onSave).toHaveBeenCalledWith('新标题'));
  });
});
