// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImagePreview } from './ImagePreview.js';

const INJECTED_STYLE_SELECTOR = '[data-image-preview-styles]';

function headStyles(): HTMLStyleElement[] {
  return Array.from(document.head.querySelectorAll<HTMLStyleElement>(INJECTED_STYLE_SELECTOR));
}

/**
 * 清掉已注入样式并重新加载模块：单例注入的模块级标记跨用例会保留，
 * 只有重新加载才能让「首次注入」在每个用例里都从零开始。
 */
async function loadFreshImagePreview(): Promise<typeof ImagePreview> {
  for (const styleElement of headStyles()) styleElement.remove();
  vi.resetModules();
  const freshModule = await import('./ImagePreview.js');
  return freshModule.ImagePreview;
}

/** 取出选择器对应的规则块，用于断言「这条声明确实写在正确的规则里」。 */
function cssRuleBlock(css: string, selector: string): string {
  const start = css.indexOf(selector);
  if (start === -1) return '';
  const end = css.indexOf('}', start);
  return end === -1 ? css.slice(start) : css.slice(start, end + 1);
}

describe('ImagePreview', () => {
  afterEach(() => {
    cleanup();
  });

  it('缺省 onOpen 时保持纯展示：不渲染放大按钮，行为与旧版一致', () => {
    const { container } = render(<ImagePreview src="/images/a.png" alt="图一" />);

    expect(container.querySelector('img')?.getAttribute('src')).toBe('/images/a.png');
    expect(screen.queryByRole('button')).toBeNull();
    expect(container.querySelector('style')).toBeNull();
  });

  it('传入 onOpen 后缩略图变为键盘可达的原生按钮，点击触发回调', () => {
    const onOpen = vi.fn();
    render(<ImagePreview src="/images/a.png" alt="图一" onOpen={onOpen} />);

    const trigger = screen.getByRole('button', { name: '放大查看图片' });
    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger.getAttribute('type')).toBe('button');
    expect(trigger.getAttribute('tabindex')).toBeNull();
    expect(screen.queryByText('×')).toBeNull();

    fireEvent.click(trigger);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('缺省 onOpen / onRemove 时既不注入样式，也不在容器上新增属性', async () => {
    const FreshImagePreview = await loadFreshImagePreview();
    const { container } = render(<FreshImagePreview src="/images/a.png" alt="图一" />);

    expect(headStyles()).toHaveLength(0);
    expect(container.firstElementChild?.attributes).toHaveLength(1);
    expect(container.firstElementChild?.children).toHaveLength(1);
    expect(container.firstElementChild?.firstElementChild?.tagName).toBe('IMG');
  });

  it('openLabel 自定义无障碍名称，交互态样式注入 head 且不含不可见配色的残留', async () => {
    const FreshImagePreview = await loadFreshImagePreview();
    render(
      <FreshImagePreview
        src="/images/a.png"
        alt="图一"
        onOpen={vi.fn()}
        openLabel="放大查看图片：a.png"
      />,
    );

    expect(screen.getByRole('button', { name: '放大查看图片：a.png' })).toBeTruthy();

    const css = headStyles()[0]?.textContent ?? '';
    expect(css).toContain(':hover');
    expect(css).toContain(':active');
    expect(css).toContain(':focus-visible');

    const zoomFocusRule = cssRuleBlock(
      css,
      '[data-openawork-image-preview] [data-image-preview-zoom]:focus-visible',
    );
    expect(zoomFocusRule).toContain('outline: 2px solid var(--accent)');
    expect(zoomFocusRule).toContain('box-shadow: 0 0 0 4px var(--accent-subtle)');

    const removeHoverRule = cssRuleBlock(
      css,
      '[data-openawork-image-preview] > button:not([data-image-preview-zoom]):hover',
    );
    expect(removeHoverRule).toContain('--openawork-image-preview-remove-bg: var(--bg-hover)');
    const removeActiveRule = cssRuleBlock(
      css,
      '[data-openawork-image-preview] > button:not([data-image-preview-zoom]):active',
    );
    expect(removeActiveRule).toContain('--openawork-image-preview-remove-bg: var(--bg-active)');

    expect(css).not.toContain('--fg-on-accent');
    expect(css).not.toContain('rgba(0, 0, 0, 0.6)');
  });

  it('zoom 按钮三态经自定义属性真正生效，内联不再写死会压掉 :hover / :active 的值', async () => {
    const FreshImagePreview = await loadFreshImagePreview();
    render(<FreshImagePreview src="/images/a.png" alt="图一" onOpen={vi.fn()} />);

    const zoomButton = screen.getByRole('button', { name: '放大查看图片' });
    const inlineStyle = zoomButton.getAttribute('style') ?? '';
    const css = headStyles()[0]?.textContent ?? '';

    // 默认态只引用自定义属性并回退 transparent：未 hover 时视觉与旧版逐像素一致。
    expect(zoomButton.style.background).toContain('var(--openawork-image-preview-zoom-bg');
    expect(zoomButton.style.background).toContain('transparent');
    // 写死背景、或把同名自定义属性内联定义，都会让样式表三态被更高优先级的内联声明压掉。
    expect(inlineStyle).not.toContain('background: transparent;');
    expect(inlineStyle).not.toMatch(/--openawork-image-preview-[a-z-]+:\s/);

    const zoomHoverRule = cssRuleBlock(
      css,
      '[data-openawork-image-preview] [data-image-preview-zoom]:hover',
    );
    expect(zoomHoverRule).toContain('--openawork-image-preview-zoom-bg: var(--accent-subtle)');
    const zoomActiveRule = cssRuleBlock(
      css,
      '[data-openawork-image-preview] [data-image-preview-zoom]:active',
    );
    expect(zoomActiveRule).toContain('--openawork-image-preview-zoom-bg: var(--accent-muted)');
  });

  it('移除按钮改用中性浮层配色，不再把近黑的 --fg-on-accent 压在深色遮罩上', () => {
    render(<ImagePreview src="/images/a.png" alt="图一" onRemove={vi.fn()} />);

    const removeButton = screen.getByText('×');
    const inlineStyle = removeButton.getAttribute('style') ?? '';

    expect(removeButton.style.color).toContain('var(--fg-strong');
    expect(inlineStyle).toContain('var(--bg-elevated');
    expect(inlineStyle).toContain('var(--border-emphasis');
    expect(inlineStyle).toContain('box-sizing: border-box');
    expect(inlineStyle).not.toMatch(/--openawork-image-preview-[a-z-]+:\s/);
    expect(inlineStyle).not.toContain('--fg-on-accent');
    expect(inlineStyle).not.toContain('rgba(0, 0, 0, 0.6)');
  });

  it('多个实例只注入一份样式：composer 三张缩略图在 head 中仍只有 1 份', async () => {
    const FreshImagePreview = await loadFreshImagePreview();
    const onOpen = vi.fn();
    render(
      <>
        <FreshImagePreview src="/images/a.png" alt="图一" onOpen={onOpen} onRemove={vi.fn()} />
        <FreshImagePreview src="/images/b.png" alt="图二" onOpen={onOpen} onRemove={vi.fn()} />
        <FreshImagePreview src="/images/c.png" alt="图三" onOpen={onOpen} onRemove={vi.fn()} />
      </>,
    );

    expect(document.querySelectorAll('[data-openawork-image-preview]')).toHaveLength(3);
    expect(headStyles()).toHaveLength(1);
    expect(document.querySelector('[data-openawork-image-preview] > style')).toBeNull();
  });

  it('移除按钮与放大按钮是并列兄弟节点，移除不会误触发放大', () => {
    const onOpen = vi.fn();
    const onRemove = vi.fn();
    render(
      <ImagePreview
        src="/images/a.png"
        alt="图一"
        onOpen={onOpen}
        onRemove={onRemove}
        openLabel="放大查看图片"
      />,
    );

    const trigger = screen.getByRole('button', { name: '放大查看图片' });
    expect(trigger.querySelector('button')).toBeNull();

    fireEvent.click(screen.getByText('×'));
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });
});
