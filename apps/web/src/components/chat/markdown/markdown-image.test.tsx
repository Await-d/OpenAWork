import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarkdownImage, MarkdownImageInsideLinkContext } from './markdown-image.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const lightboxSrc = (): string | null =>
  document.querySelector('.image-lightbox__image')?.getAttribute('src') ?? null;

/*
 * jsdom 没有布局引擎：坍缩判定现在基于渲染尺寸，需要按用例注入 rect，并复刻真实
 * Chromium 对只有 viewBox 的 SVG 返回 150×150 默认对象尺寸的行为。
 */
function createDomRect(width: number, height: number): DOMRect {
  return {
    bottom: height,
    height,
    left: 0,
    right: width,
    top: 0,
    width,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect;
}

function stubRender(image: HTMLElement, naturalSize: number, width: number, height: number): void {
  Object.defineProperty(image, 'naturalWidth', { configurable: true, value: naturalSize });
  Object.defineProperty(image, 'naturalHeight', { configurable: true, value: naturalSize });
  const rect = createDomRect(width, height);
  vi.spyOn(image, 'getBoundingClientRect').mockReturnValue(rect);
  vi.spyOn(image, 'getClientRects').mockReturnValue({
    length: 1,
    item: (index: number): DOMRect | null => (index === 0 ? rect : null),
  } as unknown as DOMRectList);
}

/** 组件的测量发生在下一帧（若环境没有 rAF 则同步测量，无需冲刷）。 */
async function flushMeasurementFrame(): Promise<void> {
  if (typeof requestAnimationFrame !== 'function') return;
  await act(async () => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        resolve();
      });
    });
  });
}

describe('MarkdownImage 链接内回退', () => {
  it('链接内渲染为纯 <img>：没有按钮，点击也不打开灯箱', () => {
    render(
      <MarkdownImageInsideLinkContext value={true}>
        <MarkdownImage src="/logo-openai.svg" alt="Logo" title="站点 Logo" />
      </MarkdownImageInsideLinkContext>,
    );

    const image = screen.getByRole('img', { name: 'Logo' });
    expect(image.tagName).toBe('IMG');
    expect(image.getAttribute('src')).toBe('/logo-openai.svg');
    expect(image.getAttribute('title')).toBe('站点 Logo');
    expect(screen.queryByRole('button')).toBeNull();

    fireEvent.click(image);
    expect(document.querySelector('.image-lightbox')).toBeNull();
  });

  it('无 Provider（独立使用）时行为不变：仍可点击放大', () => {
    render(<MarkdownImage src="/images/arch.png" alt="架构图" />);

    const trigger = screen.getByRole('button', { name: '放大查看图片：架构图' });
    expect(trigger.querySelector('img')?.getAttribute('src')).toBe('/images/arch.png');

    fireEvent.click(trigger);
    expect(lightboxSrc()).toBe('/images/arch.png');
  });
});

describe('无内禀尺寸图片的兜底标记', () => {
  it('渲染坍缩（Chromium 报告 naturalWidth=150 但渲染 2×2）的 SVG 加载后标记为 none', async () => {
    render(<MarkdownImage src="/logo-openai.svg" alt="Logo" />);

    const image = screen.getByRole('img', { name: 'Logo' });
    stubRender(image, 150, 2, 2);
    fireEvent.load(image);
    await flushMeasurementFrame();

    expect(image.getAttribute('data-intrinsic-size')).toBe('none');
  });

  it('有内禀尺寸的 PNG 不被打标记', async () => {
    render(<MarkdownImage src="/images/cover.png" alt="封面" />);

    const image = screen.getByRole('img', { name: '封面' });
    stubRender(image, 192, 194, 194);
    fireEvent.load(image);
    await flushMeasurementFrame();

    expect(image.hasAttribute('data-intrinsic-size')).toBe(false);
  });
});

describe('image-zoom-trigger.css 兜底契约', () => {
  // vitest 的 root / cwd 是 apps/web（vitest.config.ts 所在目录）。
  const cssSource = readFileSync(
    path.resolve(process.cwd(), 'src/components/common/display/image-zoom-trigger.css'),
    'utf8',
  ).replace(/\/\*[\s\S]*?\*\//g, '');

  it('只给无内禀尺寸标记加最小尺寸，未给全部图片强加固定尺寸', () => {
    const fallbackRule = /\[data-intrinsic-size=["']none["']\]\s*\{([^}]*)\}/u.exec(cssSource);

    expect(fallbackRule).toBeTruthy();
    expect(fallbackRule?.[1]).toMatch(/min-width:\s*var\(--spacing-12,\s*48px\)/u);
    expect(fallbackRule?.[1]).toMatch(/min-height:\s*var\(--spacing-12,\s*48px\)/u);

    const baseRule = /\.image-zoom-trigger__image\s*\{([^}]*)\}/u.exec(cssSource);
    expect(baseRule?.[1]).not.toMatch(/(?:^|\s)(?:min-)?(?:width|height):/u);
  });
});
