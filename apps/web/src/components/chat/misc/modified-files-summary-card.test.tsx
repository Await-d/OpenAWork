// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModifiedFilesSummaryContent } from '@openAwork/shared';
import { ModifiedFilesSummaryCard } from './modified-files-summary-card.js';

const openFile = vi.fn();

vi.mock('../../../App.js', () => ({
  useFileEditorContext: () => ({ current: openFile }),
}));

const FILE_PATH = 'packages/web-client/src/infra/plugins.ts';

const summary: ModifiedFilesSummaryContent = {
  type: 'modified_files_summary',
  title: '本轮改动',
  summary: '更新了周报',
  files: [
    {
      file: FILE_PATH,
      before: '',
      after: 'x',
      additions: 122,
      deletions: 106,
      status: 'modified',
      sourceKind: 'structured_tool_diff',
      guaranteeLevel: 'medium',
    },
  ],
};

beforeEach(() => {
  openFile.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ModifiedFilesSummaryCard', () => {
  it('文件路径渲染为可点击按钮，点击经 FileEditorContext 打开', () => {
    render(<ModifiedFilesSummaryCard summary={summary} />);

    const pathButton = screen.getByRole('button', { name: FILE_PATH });
    expect(pathButton.dataset['interactive']).toBe('true');

    fireEvent.click(pathButton);

    // 原样传递 token：绝对化由 openFile 内部统一处理，报错文案才对得上用户看到的路径。
    expect(openFile).toHaveBeenCalledWith(FILE_PATH);
  });

  it('状态标签与增删统计仍按原样渲染', () => {
    render(<ModifiedFilesSummaryCard summary={summary} />);

    expect(screen.getByText('修改')).toBeTruthy();
    expect(screen.getByText('工具 · medium')).toBeTruthy();
    expect(screen.getByText('+122 / -106')).toBeTruthy();
    expect(screen.getByText('1 个文件 · +122 / -106')).toBeTruthy();
  });

  it('files 为空时渲染 null', () => {
    const { container } = render(<ModifiedFilesSummaryCard summary={{ ...summary, files: [] }} />);
    expect(container.innerHTML).toBe('');
  });
});
