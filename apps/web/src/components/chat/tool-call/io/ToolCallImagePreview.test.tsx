import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ToolCallImagePreview } from './ToolCallImagePreview.js';

afterEach(() => {
  cleanup();
});

describe('ToolCallImagePreview', () => {
  it('source 为 null 时不渲染任何内容', () => {
    const { container } = render(<ToolCallImagePreview source={null} />);

    expect(container.firstChild).toBeNull();
    expect(document.body.textContent).toBe('');
  });

  it('inline 源直接渲染缩略图 img，且不发起任何请求', () => {
    const src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';

    render(<ToolCallImagePreview source={{ kind: 'inline', src, alt: '已查看的图片' }} />);

    const image = screen.getByRole('img');
    expect(image.getAttribute('src')).toBe(src);
    expect(image.getAttribute('alt')).toBe('已查看的图片');
    expect(screen.getByRole('button', { name: '放大查看图片：已查看的图片' })).toBeTruthy();
  });

  it('remote 源同样直出图片地址', () => {
    render(
      <ToolCallImagePreview
        source={{ kind: 'remote', src: 'https://example.com/photo.png', alt: '已查看的图片' }}
      />,
    );

    expect(screen.getByRole('img').getAttribute('src')).toBe('https://example.com/photo.png');
  });

  it('点击缩略图打开 ImageLightbox', () => {
    render(
      <ToolCallImagePreview
        source={{
          kind: 'inline',
          src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==',
          alt: '已查看的图片',
        }}
      />,
    );

    expect(document.querySelector('.image-lightbox')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '放大查看图片：已查看的图片' }));

    expect(document.querySelector('.image-lightbox')).not.toBeNull();
    expect(screen.getByRole('button', { name: '关闭预览' })).toBeTruthy();
  });

  it('error 态显示简短中文错误与重试按钮', () => {
    // 无登录态时 artifact 源无法读取，hook 会给出可读中文错误（不发请求）。
    render(
      <ToolCallImagePreview
        source={{ kind: 'artifact', artifactId: 'artifact-1', alt: '桌面截图' }}
      />,
    );

    expect(screen.getByText('未登录，无法加载图片产物')).toBeTruthy();
    const retryButton = screen.getByRole('button', { name: '重试' });
    expect(retryButton).toBeTruthy();
    // 点击重试不应崩溃，且仍然停留在可重试的错误态。
    fireEvent.click(retryButton);
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy();
  });

  it('workspace 源未登录时给出可读错误而不是抛异常', () => {
    render(
      <ToolCallImagePreview
        source={{ kind: 'workspace', path: '/workspace/a.png', alt: '已查看的图片' }}
      />,
    );

    expect(screen.getByText('未登录，无法读取工作区图片')).toBeTruthy();
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy();
  });
});
