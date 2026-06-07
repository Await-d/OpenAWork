// @vitest-environment jsdom

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import HistoryEditDialog from './history-edit-dialog.js';

describe('HistoryEditDialog', () => {
  it('未传 onCreateBranch 时不显示新建会话入口', () => {
    render(
      <HistoryEditDialog
        open
        initialText="历史消息"
        onClose={vi.fn()}
        onContinueCurrent={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: '从这里新建会话' })).toBeNull();
    expect(
      screen.getByText(
        '这是历史消息。你可以编辑后重新发送（截断后续消息），或把补充内容直接追加到当前会话末尾。',
      ),
    ).toBeTruthy();
  });

  it('传入 onCreateBranch 时仍显示新建会话入口', () => {
    render(
      <HistoryEditDialog
        open
        initialText="历史消息"
        onClose={vi.fn()}
        onContinueCurrent={vi.fn()}
        onCreateBranch={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: '从这里新建会话' })).toBeTruthy();
  });
});
