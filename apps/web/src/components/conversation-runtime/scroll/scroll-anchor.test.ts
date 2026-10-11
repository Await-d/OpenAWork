// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  captureScrollAnchor,
  restoreScrollAnchor,
  type ScrollAnchorSnapshot,
} from './scroll-anchor.js';

const activeElements: HTMLElement[] = [];

/** 手动驱动的 rAF 队列：`restoreScrollAnchor` 用双层 rAF 调度，用真实计时器
 * 等待会让用例在并行/高负载下不稳定，这里改为显式 flush。 */
let rafCallbacks = new Map<number, FrameRequestCallback>();
let rafSequence = 0;

function flushFrame(): void {
  const pending = Array.from(rafCallbacks.entries());
  rafCallbacks.clear();
  for (const [, callback] of pending) {
    callback(performance.now());
  }
}

/** 跑完一次双层 rAF（两帧）。 */
function flushFrames(count = 2): void {
  for (let index = 0; index < count; index += 1) {
    flushFrame();
  }
}

function createRegion(): HTMLDivElement {
  const region = document.createElement('div');
  document.body.appendChild(region);
  activeElements.push(region);
  return region;
}

function applyGeometry(
  region: HTMLElement,
  geometry: { scrollHeight: number; clientHeight: number; scrollTop: number; offsetTop?: number },
): void {
  Object.defineProperty(region, 'clientHeight', {
    configurable: true,
    value: geometry.clientHeight,
  });
  Object.defineProperty(region, 'scrollHeight', {
    configurable: true,
    value: geometry.scrollHeight,
  });
  Object.defineProperty(region, 'scrollTop', {
    configurable: true,
    value: geometry.scrollTop,
    writable: true,
  });
  // jsdom 的 getBoundingClientRect 默认全 0；给一个稳定的顶部偏移基准。
  Object.defineProperty(region, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      top: geometry.offsetTop ?? 0,
      bottom: (geometry.offsetTop ?? 0) + geometry.clientHeight,
      left: 0,
      right: 0,
      width: 0,
      height: geometry.clientHeight,
      x: 0,
      y: geometry.offsetTop ?? 0,
    }),
  });
}

function applyElementGeometry(element: HTMLElement, top: number, height: number): void {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      top,
      bottom: top + height,
      left: 0,
      right: 0,
      width: 0,
      height,
      x: 0,
      y: top,
    }),
  });
}

beforeEach(() => {
  document.body.innerHTML = '';
  activeElements.length = 0;
  rafCallbacks = new Map<number, FrameRequestCallback>();
  rafSequence = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
    rafSequence += 1;
    rafCallbacks.set(rafSequence, callback);
    return rafSequence;
  });
  vi.stubGlobal('cancelAnimationFrame', (handle: number): void => {
    rafCallbacks.delete(handle);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const element of activeElements) {
    element.remove();
  }
  activeElements.length = 0;
});

describe('captureScrollAnchor', () => {
  it('滚动区不存在时返回全零快照', () => {
    const snapshot = captureScrollAnchor(null, null);
    expect(snapshot).toEqual({ scrollHeight: 0, scrollTop: 0, anchorTop: null });
  });

  it('记录滚动区几何与锚点绝对偏移', () => {
    const region = createRegion();
    applyGeometry(region, { scrollHeight: 1000, clientHeight: 400, scrollTop: 120, offsetTop: 0 });

    const anchor = document.createElement('div');
    region.appendChild(anchor);
    applyElementGeometry(anchor, 80, 40); // 相对视口顶部 80px ⇒ 绝对 120 + 80 = 200

    const snapshot = captureScrollAnchor(region, anchor);
    expect(snapshot.scrollHeight).toBe(1000);
    expect(snapshot.scrollTop).toBe(120);
    expect(snapshot.anchorTop).toBe(200);
  });

  it('锚点不可测时 anchorTop 保持 null，其余几何仍记录', () => {
    const region = createRegion();
    applyGeometry(region, { scrollHeight: 1000, clientHeight: 400, scrollTop: 120, offsetTop: 0 });

    const snapshot = captureScrollAnchor(region, null);
    expect(snapshot.anchorTop).toBeNull();
    expect(snapshot.scrollHeight).toBe(1000);
    expect(snapshot.scrollTop).toBe(120);
  });
});

describe('restoreScrollAnchor', () => {
  it('锚点节点存在时恢复到加载前的相对视口位置', () => {
    const region = createRegion();
    applyGeometry(region, { scrollHeight: 1000, clientHeight: 400, scrollTop: 120, offsetTop: 0 });

    const anchor = document.createElement('div');
    region.appendChild(anchor);
    applyElementGeometry(anchor, 80, 40);

    const snapshot = captureScrollAnchor(region, anchor);

    // 模拟头部插入 300px 旧内容后：锚点绝对位置 200 → 500，scrollTop 仍 120。
    applyGeometry(region, { scrollHeight: 1300, clientHeight: 400, scrollTop: 120, offsetTop: 0 });
    applyElementGeometry(anchor, 380, 40); // 相对视口 380px

    const cancel = restoreScrollAnchor(region, snapshot, () => anchor);
    flushFrames();
    cancel();

    // 加载前相对视口偏移 = 200 - 120 = 80；目标 scrollTop = 120 + (380 - 80) = 420。
    expect(region.scrollTop).toBe(420);
  });

  it('锚点节点不可查到时回退「距底部距离不变」', () => {
    const region = createRegion();
    applyGeometry(region, { scrollHeight: 1000, clientHeight: 400, scrollTop: 120, offsetTop: 0 });

    const snapshot = captureScrollAnchor(region, null) as ScrollAnchorSnapshot;

    // 头部插入 300px 旧内容后 scrollTop 被浏览器钳在 120。
    applyGeometry(region, { scrollHeight: 1300, clientHeight: 400, scrollTop: 120, offsetTop: 0 });

    const cancel = restoreScrollAnchor(region, snapshot, () => null);
    flushFrames();
    cancel();

    // 回退路径公式：target = scrollHeight - (snapshot.scrollHeight - snapshot.scrollTop)
    // = 1300 - (1000 - 120) = 1300 - 880 = 420。
    expect(region.scrollTop).toBe(420);
  });

  it('恢复目标钳位到 [0, maxScrollTop]', () => {
    const region = createRegion();
    applyGeometry(region, { scrollHeight: 200, clientHeight: 400, scrollTop: 0, offsetTop: 0 });

    const anchor = document.createElement('div');
    region.appendChild(anchor);
    applyElementGeometry(anchor, 0, 40);
    const snapshot = captureScrollAnchor(region, anchor);

    // 头部插入后锚点相对偏移变大，计算目标超出 maxScrollTop，应钳到 max。
    applyGeometry(region, { scrollHeight: 600, clientHeight: 400, scrollTop: 100, offsetTop: 0 });
    applyElementGeometry(anchor, 300, 40);

    const cancel = restoreScrollAnchor(region, snapshot, () => anchor);
    flushFrames();
    cancel();

    // relBefore = 0；relAfter = 300；目标 = 100 + 300 = 400 > max(200) ⇒ 200。
    expect(region.scrollTop).toBe(200);
  });

  it('取消后不再滚动（rAF 被取消）', () => {
    const region = createRegion();
    applyGeometry(region, { scrollHeight: 1000, clientHeight: 400, scrollTop: 120, offsetTop: 0 });

    const snapshot = captureScrollAnchor(region, null);
    const cancel = restoreScrollAnchor(region, snapshot, () => null);
    cancel();

    applyGeometry(region, { scrollHeight: 1300, clientHeight: 400, scrollTop: 120, offsetTop: 0 });
    flushFrames();

    expect(region.scrollTop).toBe(120);
  });

  it('滚动区已脱离文档时不动 scrollTop', () => {
    const region = createRegion();
    applyGeometry(region, { scrollHeight: 1000, clientHeight: 400, scrollTop: 120, offsetTop: 0 });

    const snapshot = captureScrollAnchor(region, null);
    const cancel = restoreScrollAnchor(region, snapshot, () => null);
    region.remove();
    flushFrames(3);
    cancel();

    expect(region.scrollTop).toBe(120);
  });
});