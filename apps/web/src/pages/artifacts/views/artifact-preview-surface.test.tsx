// @vitest-environment jsdom

import { useState } from 'react';
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

function createImageArtifact(overrides: Partial<ArtifactRecord> = {}): ArtifactRecord {
  return {
    ...createArtifact(),
    type: 'image',
    title: '生成图',
    content: 'AAAA',
    ...overrides,
  };
}

const galleryArtifacts: ArtifactRecord[] = ['A', 'B', 'C'].map((content, index) =>
  createImageArtifact({ id: `img-${index + 1}`, title: `图${index + 1}`, content }),
);

/** 模拟父组件：持有图集下标，切换时把新下标回填给预览面。 */
function GalleryHarness({ onIndexChange }: { readonly onIndexChange?: (index: number) => void }) {
  const [index, setIndex] = useState(0);
  const artifact = galleryArtifacts[index] ?? galleryArtifacts[0]!;
  const items = galleryArtifacts.map((item) => ({
    src: `data:image/png;base64,${item.content}`,
    alt: item.title,
    caption: item.title,
    fileName: `${item.title}.png`,
  }));

  return (
    <ArtifactPreviewSurface
      artifact={artifact}
      content={artifact.content}
      imageGallery={{
        items,
        index,
        onIndexChange: (next) => {
          setIndex(next);
          onIndexChange?.(next);
        },
      }}
    />
  );
}

function currentLightboxSrc(): string | null {
  return (
    document.querySelector<HTMLImageElement>('.image-lightbox__image')?.getAttribute('src') ?? null
  );
}

describe('ArtifactPreviewSurface — 图片图集', () => {
  it('有图集 prop 时点击图片打开查看器，左右切换同步父组件索引', () => {
    const onIndexChange = vi.fn();
    render(<GalleryHarness onIndexChange={onIndexChange} />);

    fireEvent.click(screen.getByRole('button', { name: '放大查看图片：图1' }));

    expect(currentLightboxSrc()).toBe('data:image/png;base64,A');
    expect(screen.getByText('1 / 3')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '下一张' }));
    expect(onIndexChange).toHaveBeenCalledWith(1);
    expect(currentLightboxSrc()).toBe('data:image/png;base64,B');
    expect(screen.getByText('2 / 3')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '上一张' }));
    expect(currentLightboxSrc()).toBe('data:image/png;base64,A');
    expect(screen.getByText('1 / 3')).toBeTruthy();
  });

  it('图集只有一张时不渲染切换按钮与进度', () => {
    const artifact = createImageArtifact({ id: 'only-1', title: '单图' });
    render(
      <ArtifactPreviewSurface
        artifact={artifact}
        content={artifact.content}
        imageGallery={{
          items: [
            { src: `data:image/png;base64,${artifact.content}`, alt: '单图', caption: '单图' },
          ],
          index: 0,
          onIndexChange: vi.fn(),
        }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '放大查看图片：单图' }));

    expect(currentLightboxSrc()).toBe('data:image/png;base64,AAAA');
    expect(screen.queryByRole('button', { name: '上一张' })).toBeNull();
    expect(screen.queryByRole('button', { name: '下一张' })).toBeNull();
    expect(document.querySelector('.image-lightbox__counter')).toBeNull();
  });

  it('没有 imageGallery 时保持原渲染，点击仍可单图放大', () => {
    render(<ArtifactPreviewSurface artifact={createImageArtifact()} content="AAAA" />);

    const image = screen.getByAltText('生成图');
    expect(image.getAttribute('src')).toBe('data:image/png;base64,AAAA');

    fireEvent.click(screen.getByRole('button', { name: '放大查看图片：生成图' }));

    expect(currentLightboxSrc()).toBe('data:image/png;base64,AAAA');
    expect(screen.queryByRole('button', { name: '下一张' })).toBeNull();
  });

  it('content 已是 data URL 时直接使用；裸 base64 按 metadata.mimeType 拼接', () => {
    const { unmount } = render(
      <ArtifactPreviewSurface
        artifact={createImageArtifact({
          id: 'data-url',
          title: '直传 data URL',
          metadata: { mimeType: 'image/webp' },
        })}
        content="data:image/webp;base64,ZZZ"
      />,
    );
    expect(screen.getByAltText('直传 data URL').getAttribute('src')).toBe(
      'data:image/webp;base64,ZZZ',
    );
    unmount();

    render(
      <ArtifactPreviewSurface
        artifact={createImageArtifact({
          id: 'jpeg',
          title: 'jpeg 产物',
          metadata: { mimeType: 'image/jpeg' },
        })}
        content="BBBB"
      />,
    );
    expect(screen.getByAltText('jpeg 产物').getAttribute('src')).toBe(
      'data:image/jpeg;base64,BBBB',
    );
  });
});
