// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { FocusedRequestBanner } from './focused-request-banner.js';

afterEach(() => {
  cleanup();
});

describe('FocusedRequestBanner', () => {
  it('渲染请求摘要并触发复制/取消聚焦回调', () => {
    const onCopy = vi.fn();
    const onClear = vi.fn();

    render(
      <FocusedRequestBanner
        requestId="req-focus-1"
        summary="2 条 · 错误 1 / 卡住 0 / 工具 1"
        onCopy={onCopy}
        onClear={onClear}
      />,
    );

    expect(screen.getByTestId('focused-request-banner')).toBeTruthy();
    expect(screen.getByText('req-focus-1')).toBeTruthy();
    expect(screen.getByText(/2 条 · 错误 1 \/ 卡住 0 \/ 工具 1/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '复制诊断上下文' }));
    fireEvent.click(screen.getByRole('button', { name: '取消聚焦' }));

    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('未提供 onCopy 时不渲染复制按钮', () => {
    render(<FocusedRequestBanner requestId="req-focus-2" onClear={vi.fn()} />);

    expect(screen.queryByRole('button', { name: '复制诊断上下文' })).toBeNull();
    expect(screen.getByRole('button', { name: '取消聚焦' })).toBeTruthy();
  });
});
