// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';
import { useScrollManager } from './use-scroll-manager.js';

class MockResizeObserver implements ResizeObserver {
  static instances: MockResizeObserver[] = [];

  readonly callback: ResizeObserverCallback;
  readonly observedElements: Element[] = [];

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    MockResizeObserver.instances.push(this);
  }

  disconnect(): void {}

  observe(target: Element): void {
    this.observedElements.push(target);
  }

  trigger(): void {
    this.callback([], this);
  }

  unobserve(_target: Element): void {}
}

interface ScrollHarness {
  readonly refs: Parameters<typeof useScrollManager>[0];
  readonly scrollTo: ReturnType<typeof vi.fn>;
  getScrollTop: () => number;
  setScrollHeight: (nextScrollHeight: number) => void;
}

function createScrollHarness(): ScrollHarness {
  const scrollRegion = document.createElement('div');
  const contentColumn = document.createElement('div');
  const bottom = document.createElement('div');
  contentColumn.appendChild(bottom);
  scrollRegion.appendChild(contentColumn);

  let scrollTop = 600;
  let scrollHeight = 1000;

  Object.defineProperty(scrollRegion, 'clientHeight', {
    configurable: true,
    value: 400,
  });
  Object.defineProperty(scrollRegion, 'scrollHeight', {
    configurable: true,
    get: () => scrollHeight,
  });
  Object.defineProperty(scrollRegion, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (value: number) => {
      scrollTop = value;
    },
  });

  const scrollTo = vi.fn((options?: ScrollToOptions | number, _y?: number) => {
    if (typeof options === 'number') {
      scrollTop = options;
      return;
    }
    if (typeof options?.top === 'number') {
      scrollTop = options.top;
    }
  });

  Object.defineProperty(scrollRegion, 'scrollTo', {
    configurable: true,
    value: scrollTo,
  });

  return {
    refs: {
      scrollRegionRef: { current: scrollRegion },
      bottomRef: { current: bottom },
      pendingScrollFrameRef: { current: null },
      contentColumnRef: { current: contentColumn },
      editorPaneRef: { current: null },
      textareaRef: { current: null },
    },
    scrollTo,
    getScrollTop: () => scrollTop,
    setScrollHeight: (nextScrollHeight) => {
      scrollHeight = nextScrollHeight;
    },
  };
}

beforeEach(() => {
  MockResizeObserver.instances.length = 0;
  let frameId = 0;
  vi.stubGlobal('ResizeObserver', MockResizeObserver);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frameId += 1;
    callback(0);
    return frameId;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useScrollManager', () => {
  it('内容在底部小幅增高时也会立刻贴底', () => {
    const harness = createScrollHarness();

    renderHook(() =>
      useScrollManager(
        harness.refs,
        {
          setShowScrollToBottom: vi.fn(),
          setHasPendingFollowContent: vi.fn(),
        },
        {
          messagesLength: 1,
          visibleStreaming: false,
          visibleStreamBufferLength: 0,
          editorMode: false,
        },
      ),
    );

    expect(MockResizeObserver.instances).toHaveLength(1);
    harness.setScrollHeight(1016);

    MockResizeObserver.instances[0]?.trigger();

    expect(harness.scrollTo).toHaveBeenCalledWith({ top: 616, behavior: 'auto' });
    expect(harness.getScrollTop()).toBe(616);
  });
});
