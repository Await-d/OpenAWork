// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ArtifactRecord } from '@openAwork/artifacts';

import { copyTextToClipboard } from '../../../components/layout/file-tree/file-tree-actions.js';
import { ArtifactPreviewSurface } from './artifact-preview-surface.js';

// 剪贴板走的是「安全上下文 + navigator.clipboard，否则隐藏 textarea + execCommand」，
// jsdom 两条都不完整；这里只关心菜单把什么文本交了出去。
vi.mock('../../../components/layout/file-tree/file-tree-actions.js', () => ({
  copyTextToClipboard: vi.fn(async () => undefined),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

const CONTENT = '{\n  "answer": 42\n}';

/** 'code' 不在可预览类型里，走 CodeFallback 分支 —— 同步渲染，适合断言菜单。 */
function createArtifact(): ArtifactRecord {
  return {
    id: 'artifact-1',
    sessionId: 'session-1',
    userId: 'user-1',
    type: 'code',
    title: '示例产物',
    content: CONTENT,
    version: 1,
    parentVersionId: null,
    metadata: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function stubSelection(anchorNode: Node | null, text: string): void {
  vi.spyOn(window, 'getSelection').mockReturnValue({
    isCollapsed: anchorNode === null,
    anchorNode,
    rangeCount: anchorNode === null ? 0 : 1,
    toString: () => text,
    getRangeAt: () => ({
      toString: () => text,
      getBoundingClientRect: () => ({ left: 0, top: 0, height: 0 }),
    }),
  } as unknown as Selection);
}

function renderSurface() {
  return render(<ArtifactPreviewSurface artifact={createArtifact()} content={CONTENT} />);
}

describe('ArtifactPreviewSurface — 右键菜单', () => {
  it('菜单收敛成内容级复制，不出现路径 / 引用 / 关闭等无意义项', () => {
    renderSurface();
    stubSelection(null, '');

    fireEvent.contextMenu(screen.getByTestId('artifact-preview-host'));

    expect(screen.getByRole('menu')).toBeTruthy();
    expect(screen.getByText('复制全部内容')).toBeTruthy();
    expect(screen.queryByText('复制完整路径')).toBeNull();
    expect(screen.queryByText('复制相对路径')).toBeNull();
    expect(screen.queryByText('引用到对话')).toBeNull();
    expect(screen.queryByText('关闭')).toBeNull();
  });

  it('复制全部内容把产物正文交出去', async () => {
    renderSurface();
    stubSelection(null, '');

    fireEvent.contextMenu(screen.getByTestId('artifact-preview-host'));
    fireEvent.click(screen.getByText('复制全部内容'));

    await waitFor(() => expect(copyTextToClipboard).toHaveBeenCalledWith(CONTENT));
  });

  it('宿主内有选区时补上「复制选中内容」', async () => {
    renderSurface();
    const host = screen.getByTestId('artifact-preview-host');
    stubSelection(host, '  "answer": 42  ');

    fireEvent.contextMenu(host);

    fireEvent.click(screen.getByText('复制选中内容'));
    await waitFor(() => expect(copyTextToClipboard).toHaveBeenCalledWith('"answer": 42'));
  });
});

describe('ArtifactPreviewSurface — 键盘呼出', () => {
  it('菜单键与 Shift+F10 都能呼出菜单', () => {
    renderSurface();
    const host = screen.getByTestId('artifact-preview-host');
    stubSelection(null, '');

    expect(fireEvent.keyDown(host, { key: 'ContextMenu' })).toBe(false);
    expect(screen.getByRole('menu')).toBeTruthy();
  });
});
