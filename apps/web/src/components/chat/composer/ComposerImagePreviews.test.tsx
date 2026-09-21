// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttachmentItem } from '@openAwork/shared-ui';
import { ComposerImagePreviews } from './ComposerImagePreviews.js';

const twoImages: readonly AttachmentItem[] = [
  { id: 'a', name: 'a.png', type: 'image', sizeBytes: 1 },
  { id: 'b', name: 'b.png', type: 'image', sizeBytes: 1 },
];

const filesById = new Map<string, File>([
  ['a', new File(['a'], 'a.png', { type: 'image/png' })],
  ['b', new File(['b'], 'b.png', { type: 'image/png' })],
]);

function lightboxImageSrc(): string | null {
  const img = document.querySelector<HTMLImageElement>('.image-lightbox__image');
  return img?.getAttribute('src') ?? null;
}

describe('ComposerImagePreviews', () => {
  beforeEach(() => {
    Object.assign(URL, {
      createObjectURL: vi.fn((file: File) => `blob:${file.name}`),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('点击缩略图打开查看器，多图可左右切换', () => {
    render(
      <ComposerImagePreviews
        attachmentItems={twoImages}
        attachmentFilesById={filesById}
        onRemoveAttachment={vi.fn()}
      />,
    );

    expect(document.querySelector('.image-lightbox')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '放大查看图片：a.png' }));

    expect(lightboxImageSrc()).toBe('blob:a.png');
    expect(screen.getByText('1 / 2')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '下一张' }));
    expect(lightboxImageSrc()).toBe('blob:b.png');
    expect(screen.getByText('2 / 2')).toBeTruthy();
  });

  it('直接点击第二张缩略图时查看器定位到该图', () => {
    render(
      <ComposerImagePreviews
        attachmentItems={twoImages}
        attachmentFilesById={filesById}
        onRemoveAttachment={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '放大查看图片：b.png' }));

    expect(lightboxImageSrc()).toBe('blob:b.png');
    expect(screen.getByText('2 / 2')).toBeTruthy();
  });

  it('单图查看器不渲染左右切换', () => {
    render(
      <ComposerImagePreviews
        attachmentItems={twoImages.slice(0, 1)}
        attachmentFilesById={filesById}
        onRemoveAttachment={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '放大查看图片：a.png' }));

    expect(lightboxImageSrc()).toBe('blob:a.png');
    expect(screen.queryByRole('button', { name: '上一张' })).toBeNull();
    expect(screen.queryByRole('button', { name: '下一张' })).toBeNull();
    expect(document.querySelector('.image-lightbox__counter')).toBeNull();
  });

  it('非图片附件不渲染缩略图，也不参与图集', () => {
    render(
      <ComposerImagePreviews
        attachmentItems={[{ id: 'doc', name: 'doc.pdf', type: 'file', sizeBytes: 1 }]}
        attachmentFilesById={filesById}
        onRemoveAttachment={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: /放大查看图片/ })).toBeNull();
    expect(document.querySelector('.composer-image-previews')).toBeNull();
  });
});
