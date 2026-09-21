// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InputImageContent } from '@openAwork/shared';
import { HistoryEditAttachments } from './history-edit-attachments.js';

const twoImages: readonly InputImageContent[] = [
  { type: 'input_image', imageUrl: 'data:image/png;base64,a', fileName: 'a.png' },
  { type: 'input_image', imageUrl: 'data:image/png;base64,b', fileName: 'b.png' },
];

function lightboxImageSrc(): string | null {
  const img = document.querySelector<HTMLImageElement>('.image-lightbox__image');
  return img?.getAttribute('src') ?? null;
}

describe('HistoryEditAttachments', () => {
  afterEach(() => {
    cleanup();
  });

  it('点击缩略图打开查看器，多图可左右切换', () => {
    render(<HistoryEditAttachments inputParts={twoImages} onRemove={vi.fn()} />);

    expect(document.querySelector('.image-lightbox')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '放大查看图片：a.png' }));

    expect(lightboxImageSrc()).toBe('data:image/png;base64,a');
    expect(screen.getByText('1 / 2')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '下一张' }));
    expect(lightboxImageSrc()).toBe('data:image/png;base64,b');
    expect(screen.getByText('2 / 2')).toBeTruthy();
  });

  it('单图查看器不渲染左右切换', () => {
    render(<HistoryEditAttachments inputParts={twoImages.slice(0, 1)} onRemove={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '放大查看图片：a.png' }));

    expect(lightboxImageSrc()).toBe('data:image/png;base64,a');
    expect(screen.queryByRole('button', { name: '上一张' })).toBeNull();
    expect(screen.queryByRole('button', { name: '下一张' })).toBeNull();
    expect(document.querySelector('.image-lightbox__counter')).toBeNull();
  });

  it('无 imageUrl 的附件保持占位展示且不参与图集', () => {
    const parts: readonly InputImageContent[] = [
      { type: 'input_image', imageUrl: 'data:image/png;base64,a', fileName: 'a.png' },
      { type: 'input_image', fileName: 'b.png' },
    ];
    render(<HistoryEditAttachments inputParts={parts} onRemove={vi.fn()} />);

    expect(screen.getByText('图片已附加')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '放大查看图片：b.png' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '放大查看图片：a.png' }));

    expect(lightboxImageSrc()).toBe('data:image/png;base64,a');
    expect(screen.queryByRole('button', { name: '上一张' })).toBeNull();
    expect(screen.queryByRole('button', { name: '下一张' })).toBeNull();
  });

  it('移除按钮行为不变', () => {
    const onRemove = vi.fn();
    render(<HistoryEditAttachments inputParts={twoImages} onRemove={onRemove} />);

    fireEvent.click(screen.getByRole('button', { name: '移除 b.png' }));
    expect(onRemove).toHaveBeenCalledWith(1);
  });
});
