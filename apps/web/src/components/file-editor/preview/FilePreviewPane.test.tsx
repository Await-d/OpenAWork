// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FilePreviewPane } from './FilePreviewPane.js';
import { OPEN_LINK_PREVIEW_EVENT } from '../../../utils/preview/link-preview.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('FilePreviewPane', () => {
  it('图片内容包含 Unicode 字符时不会在渲染期抛错', () => {
    expect(() =>
      render(<FilePreviewPane path="/workspace/demo/封面.png" content="你好，世界" />),
    ).not.toThrow();

    const image = screen.getByRole('img');
    expect(image.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
  });

  // 右键 / 键盘呼出菜单由 ContentContextMenuHost 承接（见该组件与
  // content-context-menu-items 的测试）——本组件只管渲染，不再持有菜单逻辑。

  it('图片预览：点击缩略图打开查看器', () => {
    render(<FilePreviewPane path="/workspace/demo/封面.png" content="你好，世界" />);

    expect(document.querySelector('.image-lightbox')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '放大查看图片：封面.png' }));

    expect(document.querySelector('.image-lightbox__image')?.getAttribute('src')).toMatch(
      /^data:image\/png;base64,/,
    );
    expect(screen.getByText('封面.png')).toBeTruthy();
  });

  it('Markdown 预览：正文图片可点击打开查看器', async () => {
    render(
      <FilePreviewPane
        path="/workspace/demo/README.md"
        content={'# 文档\n\n![封面](/images/cover.png)'}
      />,
    );

    // Markdown 渲染器是 lazy 加载的，并行跑全量测试时需要更宽的超时窗口。
    const trigger = await screen.findByRole(
      'button',
      { name: '放大查看图片：封面' },
      { timeout: 5000 },
    );
    expect(document.querySelector('.image-lightbox')).toBeNull();

    fireEvent.click(trigger);

    expect(document.querySelector('.image-lightbox__image')?.getAttribute('src')).toBe(
      '/images/cover.png',
    );
  });

  it('Markdown 预览：链接图片不再渲染成嵌套按钮，点击不打开查看器', async () => {
    render(
      <FilePreviewPane
        path="/workspace/demo/README.md"
        content={'[![封面](/images/cover.png)](/home)'}
      />,
    );

    const link = await screen.findByRole('link', { name: '封面' }, { timeout: 5000 });
    expect(link.getAttribute('href')).toBe('/home');
    expect(link.querySelector('img')?.getAttribute('src')).toBe('/images/cover.png');
    expect(link.querySelector('button')).toBeNull();

    const image = link.querySelector('img');
    expect(image).toBeTruthy();
    if (image) fireEvent.click(image);
    expect(document.querySelector('.image-lightbox')).toBeNull();
  });

  it('Markdown 预览：页面认领后链接预览接管点击', async () => {
    render(
      <FilePreviewPane path="/workspace/demo/README.md" content={'[官网](https://example.com)'} />,
    );

    const link = await screen.findByRole('link', { name: '官网' }, { timeout: 5000 });

    const urls: string[] = [];
    const listener: EventListener = (event) => {
      urls.push((event as CustomEvent<{ url: string }>).detail.url);
      event.preventDefault();
    };
    window.addEventListener(OPEN_LINK_PREVIEW_EVENT, listener);
    const result = fireEvent.click(link);
    window.removeEventListener(OPEN_LINK_PREVIEW_EVENT, listener);

    expect(result).toBe(false);
    expect(urls).toEqual(['https://example.com']);
  });
});
