// @vitest-environment jsdom

import type { InputImageContent } from '@openAwork/shared';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import HistoryEditDialog from './history-edit-dialog.js';

describe('HistoryEditDialog', () => {
  afterEach(cleanup);

  it('以原位编辑卡片承接历史消息编辑，并将次要操作收纳到更多菜单', () => {
    const onContinueCurrent = vi.fn();
    const onResendCurrent = vi.fn();

    render(
      <HistoryEditDialog
        open
        initialText="历史消息"
        onClose={vi.fn()}
        onContinueCurrent={onContinueCurrent}
        onResendCurrent={onResendCurrent}
      />,
    );

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('history-edit-inline-editor')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '从这里新建会话' })).toBeNull();
    expect(screen.queryByRole('button', { name: '追加到末尾' })).toBeNull();

    fireEvent.change(screen.getByTestId('history-edit-dialog-textarea'), {
      target: { value: '编辑后的历史消息' },
    });
    fireEvent.click(screen.getByRole('button', { name: '编辑并重新发送' }));

    expect(onResendCurrent).toHaveBeenCalledWith('编辑后的历史消息', []);

    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));

    expect(screen.getByRole('button', { name: '追加到末尾' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '追加到末尾' }));

    expect(onContinueCurrent).toHaveBeenCalledWith('编辑后的历史消息', []);
  });

  it('移除全部附件后回传空数组(回归:被删图片不得复活)', () => {
    const onResendCurrent = vi.fn();
    const inputParts: InputImageContent[] = [
      {
        type: 'input_image',
        fileName: 'a.png',
        mimeType: 'image/png',
        imageUrl: 'data:image/png;base64,AAA',
      },
    ];

    render(
      <HistoryEditDialog
        open
        initialText="带图消息"
        inputParts={inputParts}
        onClose={vi.fn()}
        onContinueCurrent={vi.fn()}
        onResendCurrent={onResendCurrent}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '移除 a.png' }));
    fireEvent.click(screen.getByRole('button', { name: '编辑并重新发送' }));

    expect(onResendCurrent).toHaveBeenCalledWith('带图消息', []);
  });

  it('从更多菜单显示新建会话入口', () => {
    const onCreateBranch = vi.fn();

    render(
      <HistoryEditDialog
        open
        initialText="历史消息"
        onClose={vi.fn()}
        onContinueCurrent={vi.fn()}
        onCreateBranch={onCreateBranch}
      />,
    );

    expect(screen.queryByRole('button', { name: '从这里新建会话' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));

    expect(screen.getByRole('button', { name: '从这里新建会话' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '从这里新建会话' }));

    expect(onCreateBranch).toHaveBeenCalledWith('历史消息', []);
  });
});
