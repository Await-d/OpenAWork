// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InlineEditor } from '@openAwork/shared-ui';

afterEach(() => {
  cleanup();
});

describe('InlineEditor', () => {
  it('双击后按 Enter 保存修剪后的值', async () => {
    const onSave = vi.fn<(value: string) => void>();

    render(<InlineEditor label="会话标题" value="旧标题" onSave={onSave} />);

    fireEvent.doubleClick(screen.getByRole('button', { name: '会话标题: 旧标题' }));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '  新标题  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(onSave).toHaveBeenCalledWith('新标题'));
  });

  it('按 Esc 取消编辑且不保存', () => {
    const onSave = vi.fn<(value: string) => void>();

    render(<InlineEditor label="会话标题" value="旧标题" onSave={onSave} />);

    fireEvent.doubleClick(screen.getByRole('button', { name: '会话标题: 旧标题' }));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '新标题' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '会话标题: 旧标题' })).toBeTruthy();
  });

  it('失焦时保存非空值', async () => {
    const onSave = vi.fn<(value: string) => void>();

    render(<InlineEditor label="工作区名称" value="Alpha" onSave={onSave} />);

    fireEvent.doubleClick(screen.getByRole('button', { name: '工作区名称: Alpha' }));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Beta' } });
    fireEvent.blur(input);

    await waitFor(() => expect(onSave).toHaveBeenCalledWith('Beta'));
  });
});
