import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImageZoomTrigger } from './ImageZoomTrigger.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/*
 * jsdom 没有布局引擎：`getBoundingClientRect()` / `getClientRects()` / `img.complete`
 * 都需要按用例精确注入，才能分别模拟「渲染坍缩」「渲染正常」「尚未参与布局」三态。
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

function createRectList(...rects: readonly DOMRect[]): DOMRectList {
  return {
    length: rects.length,
    item: (index: number): DOMRect | null => rects[index] ?? null,
  } as unknown as DOMRectList;
}

/** 精确控制图片的布局盒：`hasLayoutBox` 为 false 表示隐藏 / 尚未参与布局。 */
function stubLayout(image: HTMLImageElement): {
  setRect: (width: number, height: number, hasLayoutBox: boolean) => void;
} {
  const rectSpy = vi.spyOn(image, 'getBoundingClientRect');
  const rectsSpy = vi.spyOn(image, 'getClientRects');
  const setRect = (width: number, height: number, hasLayoutBox: boolean): void => {
    const rect = createDomRect(width, height);
    rectSpy.mockReturnValue(rect);
    rectsSpy.mockReturnValue(hasLayoutBox ? createRectList(rect) : createRectList());
  };
  setRect(0, 0, false);
  return { setRect };
}

/** jsdom 不会真正加载图片：显式控制 `img.complete`，模拟 load 事件前后的状态。 */
function stubLoadComplete(): (complete: boolean) => void {
  const spy = vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(false);
  return (complete: boolean): void => {
    spy.mockReturnValue(complete);
  };
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

/** jsdom 没有 ResizeObserver / IntersectionObserver：装可手动触发的替身。 */
function installObserverStub(name: 'ResizeObserver' | 'IntersectionObserver'): {
  trigger: () => void;
} {
  const callbacks: Array<(entries: IntersectionObserverEntry[]) => void> = [];
  class TestObserver {
    constructor(callback: (entries: IntersectionObserverEntry[]) => void) {
      callbacks.push(callback);
    }
    observe(): void {
      return undefined;
    }
    unobserve(): void {
      return undefined;
    }
    disconnect(): void {
      return undefined;
    }
  }
  vi.stubGlobal(name, TestObserver);
  const intersectingEntry = { isIntersecting: true } as unknown as IntersectionObserverEntry;
  return {
    trigger: () => {
      for (const callback of callbacks) callback([intersectingEntry]);
    },
  };
}

/** 复刻真实 Chromium：只有 viewBox 的 SVG 会被解码成 150×150 的默认对象尺寸。 */
function emulateViewBoxOnlySvgNaturalSize(image: HTMLImageElement): void {
  Object.defineProperty(image, 'naturalWidth', { configurable: true, value: 150 });
  Object.defineProperty(image, 'naturalHeight', { configurable: true, value: 150 });
}

describe('ImageZoomTrigger 按渲染尺寸判定无内禀尺寸图片', () => {
  it('已加载但渲染坍缩为 0×0 → 打上 data-intrinsic-size=none', async () => {
    const setComplete = stubLoadComplete();
    render(<ImageZoomTrigger src="/logo-openai.svg" alt="Logo" onOpen={vi.fn()} />);
    const image = screen.getByRole<HTMLImageElement>('img', { name: 'Logo' });
    emulateViewBoxOnlySvgNaturalSize(image);
    const layout = stubLayout(image);
    layout.setRect(0, 0, true);

    setComplete(true);
    fireEvent.load(image);
    await flushMeasurementFrame();

    // 旧实现（naturalWidth/naturalHeight <= 0）在这里恒为 false，本用例会失败。
    expect(image.getAttribute('data-intrinsic-size')).toBe('none');
  });

  it('已加载但渲染坍缩为 2×2（聊天 Markdown 的 1px 边框）→ 打上标记', async () => {
    const setComplete = stubLoadComplete();
    render(<ImageZoomTrigger src="/logo-openai.svg" alt="Logo" onOpen={vi.fn()} />);
    const image = screen.getByRole<HTMLImageElement>('img', { name: 'Logo' });
    emulateViewBoxOnlySvgNaturalSize(image);
    const layout = stubLayout(image);
    layout.setRect(2, 2, true);

    setComplete(true);
    fireEvent.load(image);
    await flushMeasurementFrame();

    expect(image.getAttribute('data-intrinsic-size')).toBe('none');
  });

  it('已加载且渲染尺寸正常（PNG 194×194）→ 不打标记，尺寸不受干预', async () => {
    const setComplete = stubLoadComplete();
    render(<ImageZoomTrigger src="/pwa-192x192.png" alt="封面" onOpen={vi.fn()} />);
    const image = screen.getByRole<HTMLImageElement>('img', { name: '封面' });
    Object.defineProperty(image, 'naturalWidth', { configurable: true, value: 192 });
    Object.defineProperty(image, 'naturalHeight', { configurable: true, value: 192 });
    const layout = stubLayout(image);
    layout.setRect(194, 194, true);

    setComplete(true);
    fireEvent.load(image);
    await flushMeasurementFrame();

    expect(image.hasAttribute('data-intrinsic-size')).toBe(false);
  });

  it('已在隐藏容器中且未参与布局（rect 为 0）→ 不打标记', async () => {
    const setComplete = stubLoadComplete();
    render(<ImageZoomTrigger src="/logo-openai.svg" alt="Logo" onOpen={vi.fn()} />);
    const image = screen.getByRole<HTMLImageElement>('img', { name: 'Logo' });
    emulateViewBoxOnlySvgNaturalSize(image);
    const layout = stubLayout(image);
    layout.setRect(0, 0, false);

    setComplete(true);
    fireEvent.load(image);
    await flushMeasurementFrame();

    // 0×0 但没有布局盒 = 暂时不可见，属于正常态，不能当作坍缩。
    expect(image.hasAttribute('data-intrinsic-size')).toBe(false);
  });

  it('从隐藏容器变为可见且仍坍缩时，由 IntersectionObserver 补打标记', async () => {
    const intersectionObserver = installObserverStub('IntersectionObserver');
    const setComplete = stubLoadComplete();
    render(<ImageZoomTrigger src="/logo-openai.svg" alt="Logo" onOpen={vi.fn()} />);
    const image = screen.getByRole<HTMLImageElement>('img', { name: 'Logo' });
    emulateViewBoxOnlySvgNaturalSize(image);
    const layout = stubLayout(image);
    layout.setRect(0, 0, false);

    setComplete(true);
    fireEvent.load(image);
    await flushMeasurementFrame();
    expect(image.hasAttribute('data-intrinsic-size')).toBe(false);

    // 容器展开：元素开始参与布局，但图片依旧没有内容基准。
    layout.setRect(0, 0, true);
    act(() => {
      intersectionObserver.trigger();
    });
    await flushMeasurementFrame();

    expect(image.getAttribute('data-intrinsic-size')).toBe('none');
  });

  it('容器收窄导致已加载图片坍缩时，由 ResizeObserver 补打标记', async () => {
    const resizeObserver = installObserverStub('ResizeObserver');
    const setComplete = stubLoadComplete();
    render(<ImageZoomTrigger src="/pwa-192x192.png" alt="封面" onOpen={vi.fn()} />);
    const image = screen.getByRole<HTMLImageElement>('img', { name: '封面' });
    Object.defineProperty(image, 'naturalWidth', { configurable: true, value: 192 });
    Object.defineProperty(image, 'naturalHeight', { configurable: true, value: 192 });
    const layout = stubLayout(image);
    layout.setRect(194, 194, true);

    setComplete(true);
    fireEvent.load(image);
    await flushMeasurementFrame();
    expect(image.hasAttribute('data-intrinsic-size')).toBe(false);

    layout.setRect(0, 0, true);
    act(() => {
      resizeObserver.trigger();
    });
    await flushMeasurementFrame();

    expect(image.getAttribute('data-intrinsic-size')).toBe('none');
  });

  it('换图后不复用上一张图的坍缩标记', async () => {
    const setComplete = stubLoadComplete();
    const { rerender } = render(
      <ImageZoomTrigger src="/logo-openai.svg" alt="Logo" onOpen={vi.fn()} />,
    );
    const image = screen.getByRole<HTMLImageElement>('img', { name: 'Logo' });
    const layout = stubLayout(image);
    layout.setRect(0, 0, true);

    setComplete(true);
    fireEvent.load(image);
    await flushMeasurementFrame();
    expect(image.getAttribute('data-intrinsic-size')).toBe('none');

    // 换成有内禀尺寸的 PNG：旧标记不能残留到新图。
    setComplete(false);
    layout.setRect(194, 194, true);
    rerender(<ImageZoomTrigger src="/pwa-192x192.png" alt="Logo" onOpen={vi.fn()} />);
    setComplete(true);
    fireEvent.load(image);
    await flushMeasurementFrame();

    expect(image.hasAttribute('data-intrinsic-size')).toBe(false);
  });
});
