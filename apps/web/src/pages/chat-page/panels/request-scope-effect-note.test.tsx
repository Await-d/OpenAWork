// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { RequestScopeEffectNote } from './request-scope-effect-note.js';

afterEach(() => {
  cleanup();
});

describe('RequestScopeEffectNote', () => {
  it('显示聚焦 request 的作用范围', () => {
    render(
      <RequestScopeEffectNote
        title="当前工具视图已聚焦"
        requestId="req-123"
        visibleCount={2}
        totalCount={8}
        summary="2 条 · 错误 1 / 卡住 0 / 工具 2"
        description="仅显示当前 request 的工具调用。"
      />,
    );

    expect(screen.getByTestId('request-scope-effect-note')).toBeTruthy();
    expect(screen.getByText('当前工具视图已聚焦')).toBeTruthy();
    expect(screen.getByText('req-123')).toBeTruthy();
    expect(screen.getByText('2/8 条')).toBeTruthy();
    expect(screen.getByText('2 条 · 错误 1 / 卡住 0 / 工具 2')).toBeTruthy();
    expect(screen.getByText('仅显示当前 request 的工具调用。')).toBeTruthy();
  });

  it('可展示当前可见数与 request 总数', () => {
    render(
      <RequestScopeEffectNote
        title="当前工具视图已聚焦"
        requestId="req-456"
        visibleCount={1}
        totalCount={3}
      />,
    );

    expect(screen.getByText('1/3 条')).toBeTruthy();
  });
});
