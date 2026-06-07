// @vitest-environment jsdom

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import RetryModeDialog from './retry-mode-dialog.js';

describe('RetryModeDialog', () => {
  it('未传 onRetryBranch 时不显示新建会话重试入口', () => {
    render(
      <RetryModeDialog
        open
        messagePreview="上一轮回答"
        onClose={vi.fn()}
        onRetryCurrent={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: '新建会话重试' })).toBeNull();
    expect(screen.getByText('你可以清空这轮回答后在当前会话重新生成。')).toBeTruthy();
  });

  it('传入 onRetryBranch 时仍显示新建会话重试入口', () => {
    render(
      <RetryModeDialog
        open
        messagePreview="上一轮回答"
        onClose={vi.fn()}
        onRetryCurrent={vi.fn()}
        onRetryBranch={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: '新建会话重试' })).toBeTruthy();
  });
});
