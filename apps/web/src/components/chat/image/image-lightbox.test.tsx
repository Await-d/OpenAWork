// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImageLightbox, type ImageLightboxItem } from './image-lightbox.js';

const galleryItems: readonly ImageLightboxItem[] = [
  { src: '/images/a.png', alt: '图一', caption: '第一张', fileName: 'a.png' },
  { src: '/images/b.png', alt: '图二', caption: '第二张', fileName: 'b.png' },
  { src: '/images/c.png', alt: '图三', caption: '第三张', fileName: 'c.png' },
];

function getImage(): HTMLImageElement {
  const img = document.querySelector<HTMLImageElement>('.image-lightbox__image');
  if (!img) throw new Error('查看器图片未渲染');
  return img;
}

function getButton(name: string): HTMLButtonElement {
  return screen.getByRole('button', { name }) as HTMLButtonElement;
}

/** token 断言只看实际声明，避免 CSS 注释里提到的 token 名干扰 `not.toContain`。 */
function stripCssComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '');
}

afterEach(() => {
  cleanup();
});

describe('ImageLightbox 单图模式（向后兼容）', () => {
  it('沿用 src / alt / caption / fileName，且不渲染图集导航与进度', () => {
    render(
      <ImageLightbox
        open
        src="/images/legacy.png"
        alt="旧图"
        caption="单图说明"
        fileName="legacy.png"
        onClose={vi.fn()}
      />,
    );

    const img = getImage();
    expect(img.getAttribute('src')).toBe('/images/legacy.png');
    expect(img.getAttribute('alt')).toBe('旧图');
    expect(screen.getByText('单图说明')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '上一张' })).toBeNull();
    expect(screen.queryByRole('button', { name: '下一张' })).toBeNull();
    expect(document.querySelector('.image-lightbox__counter')).toBeNull();
  });

  it('open 为真但 src 为空字符串时不渲染空壳', () => {
    render(<ImageLightbox open src="" onClose={vi.fn()} />);
    expect(document.querySelector('.image-lightbox')).toBeNull();
  });

  it('open 为真但 items 为空数组且无 src 时不渲染空壳', () => {
    render(<ImageLightbox open items={[]} onClose={vi.fn()} />);
    expect(document.querySelector('.image-lightbox')).toBeNull();
  });

  it('未打开时不渲染任何内容', () => {
    render(<ImageLightbox open={false} src="/images/legacy.png" onClose={vi.fn()} />);
    expect(document.querySelector('.image-lightbox')).toBeNull();
  });
});

describe('ImageLightbox 图集模式', () => {
  it('非受控模式：点击下一张 / 上一张切换图片、更新进度并回调索引', () => {
    const onIndexChange = vi.fn();
    render(
      <ImageLightbox open items={galleryItems} onClose={vi.fn()} onIndexChange={onIndexChange} />,
    );

    expect(getImage().getAttribute('src')).toBe('/images/a.png');
    expect(screen.getByText('1 / 3')).toBeTruthy();

    fireEvent.click(getButton('下一张'));
    expect(onIndexChange).toHaveBeenCalledWith(1);
    expect(getImage().getAttribute('src')).toBe('/images/b.png');
    expect(screen.getByText('2 / 3')).toBeTruthy();

    fireEvent.click(getButton('下一张'));
    expect(getImage().getAttribute('src')).toBe('/images/c.png');
    expect(screen.getByText('3 / 3')).toBeTruthy();

    fireEvent.click(getButton('上一张'));
    expect(getImage().getAttribute('src')).toBe('/images/b.png');
  });

  it('边界处切换按钮禁用且不循环', () => {
    render(<ImageLightbox open items={galleryItems} onClose={vi.fn()} />);

    expect(getButton('上一张').disabled).toBe(true);
    expect(getButton('下一张').disabled).toBe(false);

    fireEvent.click(getButton('下一张'));
    fireEvent.click(getButton('下一张'));
    expect(getImage().getAttribute('src')).toBe('/images/c.png');
    expect(getButton('下一张').disabled).toBe(true);
    expect(getButton('上一张').disabled).toBe(false);

    // 最后一张继续点「下一张」：停在原地，不回到第一张
    fireEvent.click(getButton('下一张'));
    expect(getImage().getAttribute('src')).toBe('/images/c.png');

    fireEvent.click(getButton('上一张'));
    fireEvent.click(getButton('上一张'));
    expect(getImage().getAttribute('src')).toBe('/images/a.png');

    // 第一张继续点「上一张」：停在原地，不跳到末尾
    fireEvent.click(getButton('上一张'));
    expect(getImage().getAttribute('src')).toBe('/images/a.png');
  });

  it('受控 index 优先于内部状态，越界时 clamp 到有效范围', () => {
    const { rerender } = render(
      <ImageLightbox open items={galleryItems} index={1} onClose={vi.fn()} />,
    );
    expect(getImage().getAttribute('src')).toBe('/images/b.png');
    expect(screen.getByText('2 / 3')).toBeTruthy();

    rerender(<ImageLightbox open items={galleryItems} index={9} onClose={vi.fn()} />);
    expect(getImage().getAttribute('src')).toBe('/images/c.png');

    rerender(<ImageLightbox open items={galleryItems} index={-4} onClose={vi.fn()} />);
    expect(getImage().getAttribute('src')).toBe('/images/a.png');
  });

  it('caption 跟随当前图片，没有 caption 时仍显示进度', () => {
    render(<ImageLightbox open items={galleryItems} onClose={vi.fn()} />);
    expect(screen.getByText('第一张')).toBeTruthy();

    fireEvent.click(getButton('下一张'));
    expect(screen.getByText('第二张')).toBeTruthy();
    expect(screen.queryByText('第一张')).toBeNull();

    cleanup();
    render(
      <ImageLightbox
        open
        items={[{ src: '/images/1.png' }, { src: '/images/2.png' }]}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('1 / 2')).toBeTruthy();
    expect(document.querySelector('.image-lightbox__caption-text')).toBeNull();
  });
});

describe('ImageLightbox 键盘交互', () => {
  it('方向键在图集模式切换，边界处 no-op', () => {
    render(<ImageLightbox open items={galleryItems} onClose={vi.fn()} />);

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(getImage().getAttribute('src')).toBe('/images/b.png');

    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(getImage().getAttribute('src')).toBe('/images/a.png');

    // 已在第一张：再按左键仍是第一张
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(getImage().getAttribute('src')).toBe('/images/a.png');
  });

  it('单图模式不拦截方向键', () => {
    render(<ImageLightbox open src="/images/only.png" alt="单图" onClose={vi.fn()} />);

    const event = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      cancelable: true,
      bubbles: true,
    });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(getImage().getAttribute('src')).toBe('/images/only.png');
  });

  it('Esc 关闭查看器', () => {
    const onClose = vi.fn();
    render(<ImageLightbox open items={galleryItems} onClose={onClose} />);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('ImageLightbox 变换状态', () => {
  it('切换图片时重置缩放与旋转', () => {
    render(<ImageLightbox open items={galleryItems} onClose={vi.fn()} />);

    fireEvent.click(screen.getByTitle('放大 (+)'));
    fireEvent.click(screen.getByTitle('右旋 90° (R)'));
    expect(getImage().style.transform).toContain('rotate(90deg)');
    expect(getImage().style.transform).toContain('scale(1.25)');

    fireEvent.click(getButton('下一张'));
    expect(getImage().style.transform).toContain('rotate(0deg)');
    expect(getImage().style.transform).toContain('scale(1)');
  });
});

describe('ImageLightbox 主题 token 使用', () => {
  // vitest 的 root / cwd 是 apps/web（vitest.config.ts 所在目录）。
  const readCss = (relativePath: string): string =>
    readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
  const cssSource = stripCssComments(readCss('src/components/chat/image/image-lightbox.css'));
  const imageDisplayCssSource = stripCssComments(
    readCss('src/components/chat/tool-call/generate-image/image-display.css'),
  );

  it('浮层按钮 / 导航 / caption 使用中性浮层 token，禁止 accent 填充文字色', () => {
    // --fg-on-accent 在暗色主题下是近黑色，只允许出现在 accent 实色填充之上。
    expect(cssSource).not.toContain('--fg-on-accent');
    // 历史 bug：caption 曾把背景 token（--bg-raised）当文字色用。
    expect(cssSource).not.toContain('--bg-raised');
    // 白色硬编码描边 / 背景全部替换为 token（遮罩 rgba(0,0,0,0.82) 除外）。
    expect(cssSource).not.toContain('rgba(255, 255, 255');
    expect(cssSource).not.toContain('rgba(255,255,255');

    expect(cssSource).toContain('color: var(--fg-strong)');
    expect(cssSource).toContain('background: var(--bg-elevated)');
    expect(cssSource).toContain('border: 1px solid var(--border-emphasis)');
    // 工具栏分隔线走 --border-emphasis，而不是 rgba(255,255,255,0.15)
    expect(cssSource).toContain('background: var(--border-emphasis)');
  });

  it('工具栏按钮 / 图集导航覆盖 hover / active / disabled / focus-visible 与 focus ring', () => {
    expect(cssSource).toContain('.image-lightbox__tool-btn:hover:not(:disabled)');
    expect(cssSource).toContain('.image-lightbox__tool-btn:active:not(:disabled)');
    expect(cssSource).toContain('.image-lightbox__tool-btn:disabled');
    expect(cssSource).toContain('.image-lightbox__tool-btn:focus-visible');
    expect(cssSource).toContain('.image-lightbox__nav:hover:not(:disabled)');
    expect(cssSource).toContain('.image-lightbox__nav:active:not(:disabled)');
    expect(cssSource).toContain('.image-lightbox__nav:disabled');
    expect(cssSource).toContain('.image-lightbox__nav:focus-visible');
    expect(cssSource).toContain('outline: 2px solid var(--accent)');
    expect(cssSource).toContain('box-shadow: 0 0 0 4px var(--accent-subtle)');
  });

  it('渲染出的按钮走 token 化 class，而不是内联硬编码颜色', () => {
    render(<ImageLightbox open items={galleryItems} onClose={vi.fn()} />);

    const toolTitles = [
      '缩小 (−)',
      '重置缩放 (0)',
      '放大 (+)',
      '左旋 90°',
      '右旋 90° (R)',
      '重置全部 (0)',
      '下载图片',
      '关闭 (Esc)',
    ];
    for (const title of toolTitles) {
      const btn = screen.getByTitle(title);
      expect(btn.className).toContain('image-lightbox__tool-btn');
      expect(btn.getAttribute('style')).toBeNull();
    }

    for (const name of ['上一张', '下一张']) {
      const btn = getButton(name);
      expect(btn.className).toContain('image-lightbox__nav');
      expect(btn.getAttribute('style')).toBeNull();
    }
  });

  it('image-display 的 hover 按钮同样使用中性浮层 token 与 focus 态', () => {
    expect(imageDisplayCssSource).not.toContain('--fg-on-accent');
    expect(imageDisplayCssSource).not.toContain('background: var(--border-strong)');
    expect(imageDisplayCssSource).toContain('background: var(--bg-elevated)');
    expect(imageDisplayCssSource).toContain('color: var(--fg-strong)');
    expect(imageDisplayCssSource).toContain('.generate-image-display__hover-btn:hover');
    expect(imageDisplayCssSource).toContain('.generate-image-display__hover-btn:focus-visible');
  });
});
