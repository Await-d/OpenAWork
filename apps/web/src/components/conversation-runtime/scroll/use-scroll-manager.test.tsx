// @vitest-environment jsdom

import type { Dispatch, SetStateAction, UIEvent } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHAT_LAYOUT_WAIT_MAX_FRAMES, CHAT_TRUE_BOTTOM_TOLERANCE_PX } from './scroll-constants.js';
import { useScrollManager, type ScrollManagerEffects } from './use-scroll-manager.js';

const CLIENT_HEIGHT = 400;
const SPACER_HEIGHT = 80;
const ANCHOR_HEIGHT = 120;

let clockNow = 0;
let manualFrameQueue: { callback: FrameRequestCallback; id: number }[] | null = null;

class MockResizeObserver implements ResizeObserver {
  static instances: MockResizeObserver[] = [];

  readonly callback: ResizeObserverCallback;
  readonly observedElements: Element[] = [];

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    MockResizeObserver.instances.push(this);
  }

  disconnect(): void {
    this.observedElements.length = 0;
  }

  observe(target: Element): void {
    this.observedElements.push(target);
  }

  trigger(): void {
    this.callback([], this);
  }

  unobserve(target: Element): void {
    const index = this.observedElements.indexOf(target);
    if (index >= 0) this.observedElements.splice(index, 1);
  }
}

function createRect(top: number, height: number, width = 800): DOMRect {
  return {
    bottom: top + height,
    height,
    left: 0,
    right: width,
    top,
    width,
    x: 0,
    y: top,
    toJSON: () => ({}),
  };
}

interface BooleanStateSpy {
  get: () => boolean;
  setter: Dispatch<SetStateAction<boolean>>;
}

function createBooleanStateSpy(initialValue: boolean): BooleanStateSpy {
  let value = initialValue;
  const spy = vi.fn((next: SetStateAction<boolean>) => {
    value = typeof next === 'function' ? next(value) : next;
  });
  return { get: () => value, setter: spy };
}

interface ScrollHarness {
  readonly refs: Parameters<typeof useScrollManager>[0];
  readonly setters: Parameters<typeof useScrollManager>[1];
  readonly scrollRegion: HTMLDivElement;
  readonly scrollTo: ReturnType<typeof vi.fn>;
  dispose: () => void;
  getShowScrollToBottom: () => boolean;
  getHasPendingFollowContent: () => boolean;
  getScrollTop: () => number;
  getScrollHeight: () => number;
  setScrollTop: (next: number) => void;
  setScrollHeight: (next: number) => void;
  setClientHeight: (next: number) => void;
  setAnchorContentBottom: (next: number) => void;
  setAnchorContentTop: (next: number) => void;
  flushLastMessageToViewportBottom: () => void;
  removeAssistantGroup: () => void;
  addTrailingUserGroup: (contentTop: number, contentBottom: number) => void;
  swapGroupsForPlainSibling: () => void;
  advanceClock: (ms: number) => void;
  scrollEvent: () => UIEvent<HTMLDivElement>;
  dispatchWheelOnRegion: (deltaY: number) => void;
  dispatchTouchGesture: (startY: number, currentY: number) => void;
  getObserver: () => MockResizeObserver | undefined;
  enableManualFrames: () => void;
  flushAnimationFrame: () => void;
  getPendingFrameCount: () => number;
}

const activeHarnesses: ScrollHarness[] = [];

function createScrollHarness(): ScrollHarness {
  const scrollRegion = document.createElement('div');
  const contentColumn = document.createElement('div');
  const assistantGroup = document.createElement('div');
  assistantGroup.setAttribute('data-chat-group-root', 'true');
  assistantGroup.setAttribute('data-role', 'assistant');
  const bottom = document.createElement('div');
  contentColumn.append(assistantGroup, bottom);
  scrollRegion.appendChild(contentColumn);
  document.body.appendChild(scrollRegion);

  let scrollTop = 600;
  let scrollHeight = 1000;
  let clientHeight = CLIENT_HEIGHT;
  let anchorContentTop = 880;
  let anchorContentBottom = 1000;

  Object.defineProperty(scrollRegion, 'clientHeight', {
    configurable: true,
    get: () => clientHeight,
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
  Object.defineProperty(scrollRegion, 'getBoundingClientRect', {
    configurable: true,
    value: () => createRect(0, clientHeight),
  });
  Object.defineProperty(assistantGroup, 'getBoundingClientRect', {
    configurable: true,
    value: () => createRect(anchorContentTop - scrollTop, anchorContentBottom - anchorContentTop),
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

  const showScrollToBottom = createBooleanStateSpy(false);
  const hasPendingFollowContent = createBooleanStateSpy(false);

  const harness: ScrollHarness = {
    refs: {
      scrollRegionRef: { current: scrollRegion },
      bottomRef: { current: bottom },
      pendingScrollFrameRef: { current: null },
      contentColumnRef: { current: contentColumn },
      editorPaneRef: { current: null },
      textareaRef: { current: null },
    },
    setters: {
      setShowScrollToBottom: showScrollToBottom.setter,
      setHasPendingFollowContent: hasPendingFollowContent.setter,
    },
    scrollRegion,
    scrollTo,
    dispose: () => {
      scrollRegion.remove();
    },
    getShowScrollToBottom: showScrollToBottom.get,
    getHasPendingFollowContent: hasPendingFollowContent.get,
    getScrollTop: () => scrollTop,
    getScrollHeight: () => scrollHeight,
    setScrollTop: (next) => {
      scrollTop = next;
    },
    setScrollHeight: (next) => {
      scrollHeight = next;
    },
    setClientHeight: (next) => {
      clientHeight = next;
    },
    setAnchorContentBottom: (next) => {
      anchorContentBottom = next;
    },
    setAnchorContentTop: (next) => {
      anchorContentTop = next;
    },
    flushLastMessageToViewportBottom: () => {
      anchorContentBottom = scrollTop + clientHeight;
      anchorContentTop = anchorContentBottom - ANCHOR_HEIGHT;
    },
    removeAssistantGroup: () => {
      assistantGroup.remove();
    },
    addTrailingUserGroup: (contentTop, contentBottom) => {
      const userGroup = document.createElement('div');
      userGroup.setAttribute('data-chat-group-root', 'true');
      userGroup.setAttribute('data-role', 'user');
      Object.defineProperty(userGroup, 'getBoundingClientRect', {
        configurable: true,
        value: () => createRect(contentTop - scrollTop, contentBottom - contentTop),
      });
      contentColumn.insertBefore(userGroup, bottom);
    },
    swapGroupsForPlainSibling: () => {
      // 普通兄弟节点（虚拟化容器 / 权限快捷条）：有真实高度，但不是消息组。
      assistantGroup.remove();
      const plainSibling = document.createElement('div');
      Object.defineProperty(plainSibling, 'getBoundingClientRect', {
        configurable: true,
        value: () =>
          createRect(anchorContentTop - scrollTop, anchorContentBottom - anchorContentTop),
      });
      contentColumn.insertBefore(plainSibling, bottom);
    },
    advanceClock: (ms) => {
      clockNow += ms;
    },
    scrollEvent: () => ({ currentTarget: scrollRegion }) as unknown as UIEvent<HTMLDivElement>,
    dispatchWheelOnRegion: (deltaY) => {
      scrollRegion.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY }));
    },
    dispatchTouchGesture: (startY, currentY) => {
      for (const [type, clientY] of [
        ['touchstart', startY],
        ['touchmove', currentY],
      ] as const) {
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'touches', { value: [{ clientY }] });
        scrollRegion.dispatchEvent(event);
      }
    },
    getObserver: () => MockResizeObserver.instances[MockResizeObserver.instances.length - 1],
    enableManualFrames: () => {
      manualFrameQueue = [];
    },
    flushAnimationFrame: () => {
      const next = manualFrameQueue?.shift();
      if (next) next.callback(0);
    },
    getPendingFrameCount: () => manualFrameQueue?.length ?? 0,
  };
  activeHarnesses.push(harness);
  return harness;
}

/** 初始状态：视口贴在绝对底部（跟随启用），末条消息底边在 spacer 之上。 */
function setupEngagedAtBottom(harness: ScrollHarness): void {
  harness.setScrollHeight(1000 + SPACER_HEIGHT);
  harness.setScrollTop(680);
  harness.setAnchorContentBottom(1000);
  harness.setAnchorContentTop(1000 - ANCHOR_HEIGHT);
}

function renderManager(
  harness: ScrollHarness,
  overrides: Partial<ScrollManagerEffects> = {},
): {
  manager: () => ReturnType<typeof useScrollManager>;
  setEffects: (next: Partial<ScrollManagerEffects>) => void;
} {
  const effects: ScrollManagerEffects = {
    sessionKey: 'session-1',
    messagesLength: 1,
    visibleStreaming: false,
    visibleStreamBufferLength: 0,
    editorMode: false,
    ...overrides,
  };
  const view = renderHook(() => useScrollManager(harness.refs, harness.setters, effects));
  return {
    manager: () => view.result.current,
    setEffects: (next) => {
      Object.assign(effects, next);
      view.rerender();
    },
  };
}

beforeEach(() => {
  clockNow = 0;
  manualFrameQueue = null;
  MockResizeObserver.instances.length = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => clockNow);
  let frameId = 0;
  vi.stubGlobal('ResizeObserver', MockResizeObserver);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frameId += 1;
    if (manualFrameQueue !== null) {
      manualFrameQueue.push({ callback, id: frameId });
    } else {
      callback(0);
    }
    return frameId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    if (manualFrameQueue === null) return;
    const index = manualFrameQueue.findIndex((frame) => frame.id === id);
    if (index >= 0) manualFrameQueue.splice(index, 1);
  });
});

afterEach(() => {
  cleanup();
  for (const harness of activeHarnesses) harness.dispose();
  activeHarnesses.length = 0;
  manualFrameQueue = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useScrollManager', () => {
  it('内容在底部小幅增高时也会立刻贴底', () => {
    const harness = createScrollHarness();

    renderManager(harness);

    expect(MockResizeObserver.instances).toHaveLength(1);
    harness.setScrollHeight(1016);

    harness.getObserver()?.trigger();

    expect(harness.scrollTo).toHaveBeenCalledWith({ top: 616, behavior: 'auto' });
    expect(harness.getScrollTop()).toBe(616);
  });

  it('流式期间用户上滑后暂停自动跟随，不再被拉回底部', () => {
    const harness = createScrollHarness();
    setupEngagedAtBottom(harness);
    const { manager, setEffects } = renderManager(harness, {
      visibleStreaming: true,
      visibleStreamBufferLength: 3,
    });

    act(() => {
      harness.dispatchWheelOnRegion(-120);
    });
    expect(manager().isFollowEngaged()).toBe(false);
    expect(harness.getShowScrollToBottom()).toBe(true);

    harness.setScrollTop(520);
    harness.advanceClock(50);
    act(() => {
      manager().handleScroll(harness.scrollEvent());
    });

    // 流式继续增长：buffer 变化 + 内容列 resize 都不能把视口拉回去
    harness.setScrollHeight(1240);
    harness.advanceClock(50);
    setEffects({ visibleStreamBufferLength: 7 });
    harness.getObserver()?.trigger();

    expect(harness.scrollTo).not.toHaveBeenCalled();
    expect(harness.getScrollTop()).toBe(520);
    expect(manager().isFollowEngaged()).toBe(false);
  });

  it('用户重新滚到最近处后恢复自动跟随', () => {
    const harness = createScrollHarness();
    setupEngagedAtBottom(harness);
    const { manager, setEffects } = renderManager(harness, {
      visibleStreaming: true,
      visibleStreamBufferLength: 3,
    });

    act(() => {
      harness.dispatchWheelOnRegion(-120);
    });
    harness.setScrollTop(520);
    harness.advanceClock(50);
    act(() => {
      manager().handleScroll(harness.scrollEvent());
    });
    expect(manager().isFollowEngaged()).toBe(false);

    // 用户滚回绝对底部：位置证明已回到 latest
    harness.setScrollTop(680);
    harness.advanceClock(50);
    act(() => {
      manager().handleScroll(harness.scrollEvent());
    });
    expect(manager().isFollowEngaged()).toBe(true);
    expect(harness.getShowScrollToBottom()).toBe(false);

    harness.setScrollHeight(1240);
    harness.advanceClock(50);
    setEffects({ visibleStreamBufferLength: 9 });

    expect(harness.scrollTo).toHaveBeenLastCalledWith({ top: 840, behavior: 'auto' });
    expect(harness.getScrollTop()).toBe(840);
  });

  it('点击回到底部按钮后立即恢复跟随', () => {
    const harness = createScrollHarness();
    setupEngagedAtBottom(harness);
    const { manager, setEffects } = renderManager(harness, {
      visibleStreaming: true,
      visibleStreamBufferLength: 3,
    });

    act(() => {
      harness.dispatchWheelOnRegion(-120);
    });
    harness.setScrollTop(520);
    harness.advanceClock(50);
    act(() => {
      manager().handleScroll(harness.scrollEvent());
    });
    expect(manager().isFollowEngaged()).toBe(false);

    // 显式传入 'smooth' 也被强制为即时滚动：协议层的程序化滚动一律 'auto'，
    // 否则动画中间位置会被 reconcile 误判为外部滚动。
    act(() => {
      manager().scrollToBottom('smooth', 'latest-edge');
    });

    expect(harness.scrollTo).toHaveBeenLastCalledWith({ top: 680, behavior: 'auto' });
    expect(harness.getScrollTop()).toBe(680);
    expect(manager().isFollowEngaged()).toBe(true);
    expect(harness.getShowScrollToBottom()).toBe(false);

    harness.setScrollHeight(1240);
    harness.advanceClock(50);
    setEffects({ visibleStreamBufferLength: 11 });
    expect(harness.getScrollTop()).toBe(840);
  });

  it('程序化跟随产生的 scroll 事件不误判为用户离开', () => {
    const harness = createScrollHarness();
    setupEngagedAtBottom(harness);
    const { manager, setEffects } = renderManager(harness, {
      visibleStreaming: true,
      visibleStreamBufferLength: 2,
    });

    harness.setScrollHeight(1200);
    harness.advanceClock(50);
    setEffects({ visibleStreamBufferLength: 3 });
    expect(harness.getScrollTop()).toBe(800);

    // 程序化 scrollTo 之后浏览器派发的 scroll 事件：按位置处理，不含任何用户意图
    harness.advanceClock(50);
    act(() => {
      manager().handleScroll(harness.scrollEvent());
    });
    expect(manager().isFollowEngaged()).toBe(true);
    expect(harness.getShowScrollToBottom()).toBe(false);

    harness.setScrollHeight(1320);
    harness.advanceClock(50);
    setEffects({ visibleStreamBufferLength: 4 });
    expect(harness.scrollTo).toHaveBeenLastCalledWith({ top: 920, behavior: 'auto' });
    expect(harness.getScrollTop()).toBe(920);
  });

  it('iOS 惯性结束后不误恢复跟随', () => {
    const harness = createScrollHarness();
    setupEngagedAtBottom(harness);
    const { manager } = renderManager(harness, {
      visibleStreaming: true,
      visibleStreamBufferLength: 3,
    });

    // 手指向下滑（内容朝更早滚动）→ 离开 latest
    act(() => {
      harness.dispatchTouchGesture(600, 700);
    });
    expect(manager().isFollowEngaged()).toBe(false);

    // 惯性阶段只有 scroll 事件、没有任何新的输入事件；位置仍远离 latest → 不恢复
    for (const top of [480, 420, 360]) {
      harness.setScrollTop(top);
      harness.advanceClock(50);
      act(() => {
        manager().handleScroll(harness.scrollEvent());
      });
    }

    expect(manager().isFollowEngaged()).toBe(false);
    expect(harness.getShowScrollToBottom()).toBe(true);
    expect(harness.scrollTo).not.toHaveBeenCalled();
  });

  it('流式内容增高本身不算用户意图', () => {
    const harness = createScrollHarness();
    setupEngagedAtBottom(harness);
    const { manager, setEffects } = renderManager(harness, {
      visibleStreaming: true,
      visibleStreamBufferLength: 2,
    });

    harness.setScrollHeight(1200);
    harness.advanceClock(50);
    setEffects({ visibleStreamBufferLength: 3 });
    harness.setScrollHeight(1300);
    harness.advanceClock(50);
    harness.getObserver()?.trigger();

    expect(manager().isFollowEngaged()).toBe(true);
    expect(harness.getShowScrollToBottom()).toBe(false);
    expect(harness.getHasPendingFollowContent()).toBe(false);
    expect(harness.getScrollTop()).toBe(900);
  });

  it('底部 spacer 区内仍算离开底部，会挂起跟随', () => {
    const harness = createScrollHarness();
    setupEngagedAtBottom(harness);
    const { manager } = renderManager(harness, {
      visibleStreaming: true,
      visibleStreamBufferLength: 3,
    });

    act(() => {
      harness.dispatchWheelOnRegion(-120);
    });
    harness.setScrollTop(300);
    harness.advanceClock(50);
    act(() => {
      manager().handleScroll(harness.scrollEvent());
    });
    expect(manager().isFollowEngaged()).toBe(false);

    // 把末条消息停在视口底部（最自然的阅读位置）：距绝对底部恰好一个 spacer。
    // 两态模型下这是**非程序化位置**（用户 / 外部滚出来的），只有回到真正底部
    // 才恢复；spacer 区内的宽松边缘判定不再适用于它。
    harness.setScrollTop(600);
    harness.flushLastMessageToViewportBottom();
    harness.advanceClock(50);
    act(() => {
      manager().handleScroll(harness.scrollEvent());
    });

    const distanceToBottom = harness.getScrollHeight() - harness.getScrollTop() - CLIENT_HEIGHT;
    expect(distanceToBottom).toBe(SPACER_HEIGHT);
    expect(SPACER_HEIGHT).toBeGreaterThan(CHAT_TRUE_BOTTOM_TOLERANCE_PX);
    expect(manager().isFollowEngaged()).toBe(false);
    expect(harness.getShowScrollToBottom()).toBe(true);
  });

  it('上滑一个滚轮刻度（小于 spacer 高度）也会挂起跟随', () => {
    const harness = createScrollHarness();
    setupEngagedAtBottom(harness);
    const { manager, setEffects } = renderManager(harness, {
      visibleStreaming: true,
      visibleStreamBufferLength: 3,
    });

    // 一个滚轮刻度（~50px）远小于 80px spacer：旧的两态合一判定会把它当成
    // 「仍在 latest 边缘」并在下一帧对账撤销挂起。
    act(() => {
      harness.dispatchWheelOnRegion(-50);
    });
    harness.setScrollTop(630);
    harness.advanceClock(50);
    act(() => {
      manager().handleScroll(harness.scrollEvent());
    });

    expect(manager().isFollowEngaged()).toBe(false);
    expect(manager().isFollowingRef.current).toBe(false);
    expect(harness.getShowScrollToBottom()).toBe(true);

    // 流式继续增长：不得把视口拽回底部
    harness.setScrollHeight(1240);
    harness.advanceClock(50);
    setEffects({ visibleStreamBufferLength: 7 });
    harness.getObserver()?.trigger();

    expect(harness.scrollTo).not.toHaveBeenCalled();
    expect(harness.getScrollTop()).toBe(630);
    expect(manager().isFollowEngaged()).toBe(false);
  });

  it('只有回到真正底部才恢复跟随', () => {
    const harness = createScrollHarness();
    setupEngagedAtBottom(harness);
    const { manager, setEffects } = renderManager(harness, {
      visibleStreaming: true,
      visibleStreamBufferLength: 3,
    });

    act(() => {
      harness.dispatchWheelOnRegion(-50);
    });
    harness.setScrollTop(630);
    harness.advanceClock(50);
    act(() => {
      manager().handleScroll(harness.scrollEvent());
    });
    expect(manager().isFollowEngaged()).toBe(false);

    // 内容增长后回到新的绝对底部（840 = 1240 - 400）：位置不再是记录落点
    // （680），但 distanceToBottom = 0 ⇒ 真正底部 ⇒ 恢复。
    harness.setScrollHeight(1240);
    harness.setScrollTop(840);
    harness.advanceClock(50);
    act(() => {
      manager().handleScroll(harness.scrollEvent());
    });

    expect(manager().isFollowEngaged()).toBe(true);
    expect(harness.getShowScrollToBottom()).toBe(false);

    // 恢复后继续跟随：新内容把视口重新贴到新底部
    harness.setScrollHeight(1320);
    harness.advanceClock(50);
    setEffects({ visibleStreamBufferLength: 9 });
    expect(harness.scrollTo).toHaveBeenLastCalledWith({ top: 920, behavior: 'auto' });
    expect(harness.getScrollTop()).toBe(920);
  });

  it('程序化落点之后的内容增长不会被误判为外部滚动', () => {
    const harness = createScrollHarness();
    setupEngagedAtBottom(harness);
    const { manager, setEffects } = renderManager(harness, {
      visibleStreaming: true,
      visibleStreamBufferLength: 3,
    });

    // 自动跟随落到 800 并记录程序化落点
    harness.setScrollHeight(1200);
    harness.advanceClock(50);
    setEffects({ visibleStreamBufferLength: 4 });
    expect(harness.getScrollTop()).toBe(800);

    // 锚点底边被推到视口下方、内容继续增高，但 scrollTop 保持不动（仍是落点）
    harness.setAnchorContentTop(1200);
    harness.setAnchorContentBottom(1320);
    harness.setScrollHeight(1300);
    harness.advanceClock(50);
    harness.getObserver()?.trigger();

    expect(manager().isFollowEngaged()).toBe(true);
    expect(manager().isFollowingRef.current).toBe(true);
    expect(harness.scrollTo).toHaveBeenLastCalledWith({ top: 900, behavior: 'auto' });
    expect(harness.getScrollTop()).toBe(900);
  });

  it('restoreScrollTop 恢复到历史中部会挂起跟随', () => {
    const harness = createScrollHarness();
    setupEngagedAtBottom(harness);
    const { manager, setEffects } = renderManager(harness, {
      visibleStreaming: true,
      visibleStreamBufferLength: 3,
    });

    act(() => {
      manager().restoreScrollTop(400);
    });

    expect(harness.getScrollTop()).toBe(400);
    expect(manager().isFollowEngaged()).toBe(false);
    expect(harness.getShowScrollToBottom()).toBe(true);

    // 恢复后的内容增长：位置仍等于记录落点（程序化），但悬挂状态必须保持
    harness.scrollTo.mockClear();
    harness.setScrollHeight(1240);
    harness.advanceClock(50);
    setEffects({ visibleStreamBufferLength: 7 });
    harness.getObserver()?.trigger();

    expect(harness.scrollTo).not.toHaveBeenCalled();
    expect(harness.getScrollTop()).toBe(400);
    expect(manager().isFollowEngaged()).toBe(false);
  });

  it('restoreScrollTop 恢复到真正底部会继续跟随', () => {
    const harness = createScrollHarness();
    setupEngagedAtBottom(harness);
    const { manager } = renderManager(harness, {
      visibleStreaming: true,
      visibleStreamBufferLength: 3,
    });

    // 先增长内容：恢复落点 840 与挂载时的程序化落点 680 不同，
    // 这样「恢复被标记为程序化」才是可证伪的（否则位置判定可能命中旧落点）。
    harness.setScrollHeight(1240);
    harness.advanceClock(50);

    act(() => {
      manager().restoreScrollTop(840);
    });

    expect(harness.getScrollTop()).toBe(840);
    expect(manager().isFollowEngaged()).toBe(true);
    expect(harness.getShowScrollToBottom()).toBe(false);

    // 增长不改动 scrollTop：位置仍等于恢复落点 ⇒ 程序化位置 ⇒ 不得视为外部滚动
    harness.setScrollHeight(1300);
    harness.advanceClock(50);
    harness.getObserver()?.trigger();

    expect(manager().isFollowEngaged()).toBe(true);
    expect(harness.scrollTo).toHaveBeenLastCalledWith({ top: 900, behavior: 'auto' });
    expect(harness.getScrollTop()).toBe(900);
    expect(harness.getShowScrollToBottom()).toBe(false);
  });

  it('容器未完成布局时的对账会在有界帧数内重试', () => {
    const harness = createScrollHarness();
    setupEngagedAtBottom(harness);
    const { manager } = renderManager(harness, {
      visibleStreaming: true,
      visibleStreamBufferLength: 3,
    });

    // 先挂起跟随
    act(() => {
      harness.dispatchWheelOnRegion(-120);
    });
    harness.setScrollTop(600);
    harness.advanceClock(50);
    act(() => {
      manager().handleScroll(harness.scrollEvent());
    });
    expect(manager().isFollowEngaged()).toBe(false);

    // 布局未完成：对账不能在 clientHeight 为 0 的第一帧就放弃
    harness.enableManualFrames();
    harness.setClientHeight(0);
    harness.setScrollTop(680);
    act(() => {
      manager().handleScroll(harness.scrollEvent());
    });
    harness.flushAnimationFrame();
    harness.flushAnimationFrame();
    expect(harness.getPendingFrameCount()).toBe(1);

    // clientHeight 恢复 ⇒ 重试帧完成真正的测量并结算（回到真正底部 ⇒ 恢复）
    harness.setClientHeight(CLIENT_HEIGHT);
    harness.flushAnimationFrame();
    expect(manager().isFollowEngaged()).toBe(true);
    expect(harness.getPendingFrameCount()).toBe(0);

    // 帧预算：clientHeight 持续为 0 时最多重试 CHAT_LAYOUT_WAIT_MAX_FRAMES 帧，
    // 不会无限排队，也不会依赖计时器
    harness.setClientHeight(0);
    harness.setScrollTop(300);
    harness.advanceClock(50);
    act(() => {
      manager().handleScroll(harness.scrollEvent());
    });
    for (let frame = 0; frame < CHAT_LAYOUT_WAIT_MAX_FRAMES + 1; frame += 1) {
      harness.flushAnimationFrame();
      expect(harness.getPendingFrameCount()).toBeLessThanOrEqual(1);
    }
    expect(harness.getPendingFrameCount()).toBe(0);

    // 预算耗尽后即使继续给帧也不会再重试
    harness.flushAnimationFrame();
    harness.flushAnimationFrame();
    expect(harness.getPendingFrameCount()).toBe(0);
  });

  it('离开底部展示回底按钮，回到最近处隐藏', () => {
    const harness = createScrollHarness();
    setupEngagedAtBottom(harness);
    const { manager } = renderManager(harness, {
      visibleStreaming: true,
      visibleStreamBufferLength: 3,
    });

    expect(harness.getShowScrollToBottom()).toBe(false);

    act(() => {
      harness.dispatchWheelOnRegion(-120);
    });
    expect(harness.getShowScrollToBottom()).toBe(true);

    harness.setScrollTop(300);
    harness.advanceClock(50);
    act(() => {
      manager().handleScroll(harness.scrollEvent());
    });
    expect(harness.getShowScrollToBottom()).toBe(true);

    harness.setScrollTop(680);
    harness.advanceClock(50);
    act(() => {
      manager().handleScroll(harness.scrollEvent());
    });
    expect(harness.getShowScrollToBottom()).toBe(false);
    expect(manager().isFollowEngaged()).toBe(true);
  });

  it('锚点缺失时容差回落到小值', () => {
    const harness = createScrollHarness();
    setupEngagedAtBottom(harness);
    const { manager } = renderManager(harness, {
      visibleStreaming: true,
      visibleStreamBufferLength: 3,
    });

    harness.removeAssistantGroup();
    harness.advanceClock(50);
    act(() => {
      harness.dispatchWheelOnRegion(-120);
    });

    // 距底 80px（= spacer 高度）> 32px 容差：旧的 420px 兜底会误判为“附近”
    harness.setScrollTop(600);
    harness.advanceClock(50);
    act(() => {
      manager().handleScroll(harness.scrollEvent());
    });
    expect(manager().isFollowEngaged()).toBe(false);
    expect(harness.getShowScrollToBottom()).toBe(true);

    // 距底 20px ≤ 32px 容差：恢复
    harness.setScrollTop(660);
    harness.advanceClock(50);
    act(() => {
      manager().handleScroll(harness.scrollEvent());
    });
    expect(manager().isFollowEngaged()).toBe(true);
    expect(harness.getShowScrollToBottom()).toBe(false);
  });

  it('滚动区域外的滚轮事件不算用户意图', () => {
    const harness = createScrollHarness();
    setupEngagedAtBottom(harness);
    const { manager } = renderManager(harness);

    act(() => {
      document.body.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -120 }));
    });

    expect(manager().isFollowEngaged()).toBe(true);
    expect(harness.getShowScrollToBottom()).toBe(false);
  });

  it('无元素焦点时 PageUp 触发离开 latest', () => {
    const harness = createScrollHarness();
    setupEngagedAtBottom(harness);
    const { manager } = renderManager(harness);

    act(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'PageUp' }));
    });

    expect(manager().isFollowEngaged()).toBe(false);
    expect(harness.getShowScrollToBottom()).toBe(true);
  });

  it('输入框聚焦时 ArrowUp 不算用户意图', () => {
    const harness = createScrollHarness();
    setupEngagedAtBottom(harness);
    const { manager } = renderManager(harness);
    const composer = document.createElement('textarea');
    document.body.appendChild(composer);
    composer.focus();

    act(() => {
      composer.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowUp' }));
    });

    expect(manager().isFollowEngaged()).toBe(true);
    expect(harness.getShowScrollToBottom()).toBe(false);
    composer.remove();
  });

  it('原生滚动条拖拽（无输入事件的 scroll）会暂停自动跟随', () => {
    const harness = createScrollHarness();
    setupEngagedAtBottom(harness);
    const { manager, setEffects } = renderManager(harness, {
      visibleStreaming: true,
      visibleStreamBufferLength: 3,
    });

    // 跟随运行后记录了程序化落点 680；全程没有任何 wheel/touch/key 事件
    expect(manager().isFollowEngaged()).toBe(true);

    // 原生滚动条拖拽：scrollTop 偏离记录落点且远离 latest → 必须挂起
    harness.setScrollTop(520);
    harness.advanceClock(50);
    act(() => {
      manager().handleScroll(harness.scrollEvent());
    });

    expect(manager().isFollowEngaged()).toBe(false);
    expect(manager().isFollowingRef.current).toBe(false);
    expect(harness.getShowScrollToBottom()).toBe(true);

    // 流式继续增长 + 内容列 resize 都不能把视口拉回去
    harness.setScrollHeight(1240);
    harness.advanceClock(50);
    setEffects({ visibleStreamBufferLength: 7 });
    harness.getObserver()?.trigger();

    expect(harness.scrollTo).not.toHaveBeenCalled();
    expect(harness.getScrollTop()).toBe(520);
    expect(manager().isFollowEngaged()).toBe(false);
  });

  it('程序化跟随后的内容增长不会被误判为用户离开', () => {
    const harness = createScrollHarness();
    setupEngagedAtBottom(harness);
    const { manager } = renderManager(harness, {
      visibleStreaming: true,
      visibleStreamBufferLength: 3,
    });

    // 锚点上方内容增高（工具卡展开 / 图片解码）：锚点底边被推到视口下方，
    // 但 scrollTop 仍等于本模块记录的程序化落点 → 不能被当成外部滚动。
    harness.setAnchorContentTop(1000);
    harness.setAnchorContentBottom(1120);
    harness.setScrollHeight(1200);
    harness.advanceClock(50);
    harness.getObserver()?.trigger();

    expect(manager().isFollowEngaged()).toBe(true);
    expect(manager().isFollowingRef.current).toBe(true);
    expect(harness.scrollTo).toHaveBeenLastCalledWith({ top: 800, behavior: 'auto' });
    expect(harness.getScrollTop()).toBe(800);
  });

  it('幽灵挂起会在下一次测量时自愈', () => {
    const harness = createScrollHarness();
    setupEngagedAtBottom(harness);
    const { manager } = renderManager(harness, {
      visibleStreaming: true,
      visibleStreamBufferLength: 3,
    });

    // 零位移的 wheel-up（已经贴底还要继续上滑）也会写入挂起标志
    act(() => {
      harness.dispatchWheelOnRegion(-120);
    });
    expect(manager().isFollowEngaged()).toBe(false);
    expect(harness.getShowScrollToBottom()).toBe(true);

    // 位置仍精确停在 latest 边缘 → 下一次测量必须清除这个幽灵挂起（无计时器）
    harness.getObserver()?.trigger();

    expect(manager().isFollowEngaged()).toBe(true);
    expect(manager().isFollowingRef.current).toBe(true);
    expect(harness.getShowScrollToBottom()).toBe(false);
  });

  it('尾随 user 消息时锚点取最后一条消息组', () => {
    const harness = createScrollHarness();
    setupEngagedAtBottom(harness);
    const { manager } = renderManager(harness, {
      visibleStreaming: true,
      visibleStreamBufferLength: 3,
    });

    // 会话以 user 消息结尾：assistant 组仍完全可见（旧实现据此误判已到 latest），
    // 但真正的最后一条消息组在折叠线下方。
    harness.addTrailingUserGroup(1080, 1240);
    harness.setScrollHeight(1320);
    harness.setScrollTop(600);
    harness.advanceClock(50);
    act(() => {
      manager().handleScroll(harness.scrollEvent());
    });

    expect(manager().isFollowEngaged()).toBe(false);
    expect(harness.getShowScrollToBottom()).toBe(true);
  });

  it('锚点前一个兄弟不是消息组时不使用它', () => {
    const harness = createScrollHarness();
    setupEngagedAtBottom(harness);
    const { manager } = renderManager(harness, {
      visibleStreaming: true,
      visibleStreamBufferLength: 3,
    });

    // 兄弟节点（虚拟化容器 / 权限快捷条）有真实高度，但不是消息组 → 不构成锚点
    harness.swapGroupsForPlainSibling();

    act(() => {
      harness.dispatchWheelOnRegion(-120);
    });
    harness.setScrollTop(600);
    harness.advanceClock(50);
    act(() => {
      manager().handleScroll(harness.scrollEvent());
    });

    // 距底 80px > 32px 严格容差 → 仍是离开（旧实现会把普通兄弟当锚点 → 误判已在 latest）
    expect(manager().isFollowEngaged()).toBe(false);
    expect(harness.getShowScrollToBottom()).toBe(true);

    // 距底 20px ≤ 32px → 恢复
    harness.setScrollTop(660);
    harness.advanceClock(50);
    act(() => {
      manager().handleScroll(harness.scrollEvent());
    });
    expect(manager().isFollowEngaged()).toBe(true);
    expect(harness.getShowScrollToBottom()).toBe(false);
  });

  it('sessionKey 变化会重置跟随与中断状态', () => {
    const harness = createScrollHarness();
    setupEngagedAtBottom(harness);
    const { manager, setEffects } = renderManager(harness, { sessionKey: 'session-a' });

    act(() => {
      harness.dispatchWheelOnRegion(-120);
    });
    expect(manager().isFollowEngaged()).toBe(false);
    expect(harness.getShowScrollToBottom()).toBe(true);

    // 会话切换不经过空列表：中断状态不能泄漏到新会话
    harness.setScrollTop(680);
    setEffects({ sessionKey: 'session-b' });

    expect(manager().isFollowEngaged()).toBe(true);
    expect(manager().isFollowingRef.current).toBe(true);
    expect(harness.getShowScrollToBottom()).toBe(false);
    expect(harness.getHasPendingFollowContent()).toBe(false);
  });

  it('瞬时清空 messagesLength 不会丢弃用户的滚动保持', () => {
    const harness = createScrollHarness();
    setupEngagedAtBottom(harness);
    const { manager, setEffects } = renderManager(harness, {
      visibleStreaming: true,
      visibleStreamBufferLength: 3,
    });

    act(() => {
      harness.dispatchWheelOnRegion(-120);
    });
    harness.setScrollTop(520);
    harness.advanceClock(50);
    act(() => {
      manager().handleScroll(harness.scrollEvent());
    });
    expect(manager().isFollowEngaged()).toBe(false);

    // 重连 / refetch 的瞬时清空（messages / 流式 / buffer 同时归零）：
    // 只收起 UI 标志，不丢弃滚动保持
    setEffects({ messagesLength: 0, visibleStreaming: false, visibleStreamBufferLength: 0 });
    expect(manager().isFollowEngaged()).toBe(false);
    expect(harness.getShowScrollToBottom()).toBe(false);

    // 内容回来之后仍然保持挂起，不被拉回底部
    setEffects({ messagesLength: 3 });
    harness.setScrollHeight(1240);
    harness.advanceClock(50);
    harness.getObserver()?.trigger();

    expect(manager().isFollowEngaged()).toBe(false);
    expect(harness.scrollTo).not.toHaveBeenCalled();
    expect(harness.getScrollTop()).toBe(520);
  });

  it('forceFollowToLatest 在有界帧数内贴底并在 clientHeight 为 0 时不放弃', () => {
    const harness = createScrollHarness();
    setupEngagedAtBottom(harness);
    const { manager } = renderManager(harness);

    harness.setScrollTop(200);
    const cleanup = manager().forceFollowToLatest('auto');
    expect(harness.scrollTo).toHaveBeenLastCalledWith({ top: 680, behavior: 'auto' });
    expect(harness.getScrollTop()).toBe(680);
    cleanup();

    // clientHeight 为 0（CSS containment / 路由过渡）时不能在 settle 第一帧就放弃
    harness.setScrollTop(200);
    harness.setClientHeight(0);
    harness.enableManualFrames();
    const cleanupZeroHeight = manager().forceFollowToLatest('auto');

    harness.flushAnimationFrame();
    expect(harness.getScrollTop()).toBe(200);

    harness.setClientHeight(CLIENT_HEIGHT);
    harness.flushAnimationFrame();
    expect(harness.getScrollTop()).toBe(680);
    cleanupZeroHeight();
  });

  it('返回的跟随 ref 名称为 isFollowingRef', () => {
    const harness = createScrollHarness();
    setupEngagedAtBottom(harness);
    const { manager } = renderManager(harness);

    expect(manager().isFollowingRef.current).toBe(true);
    expect('isNearBottomRef' in manager()).toBe(false);

    act(() => {
      harness.dispatchWheelOnRegion(-120);
    });
    expect(manager().isFollowingRef.current).toBe(false);
  });

  it('区域不可滚动时的上滑意图被忽略，短会话增长后仍会贴底', () => {
    const harness = createScrollHarness();
    harness.setScrollHeight(CLIENT_HEIGHT);
    harness.setScrollTop(0);
    harness.setAnchorContentTop(CLIENT_HEIGHT - ANCHOR_HEIGHT);
    harness.setAnchorContentBottom(CLIENT_HEIGHT);
    const { manager, setEffects } = renderManager(harness, {
      visibleStreaming: true,
      visibleStreamBufferLength: 3,
    });

    // 不可滚动：手势既没有位移，也不会产生 scroll 事件
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowUp' }));
    });
    expect(manager().isFollowEngaged()).toBe(true);

    // 流式内容长到超过视口后必须继续贴底，而不是永久停在顶部
    harness.setScrollHeight(900);
    harness.setAnchorContentTop(780);
    harness.setAnchorContentBottom(900);
    harness.advanceClock(50);
    setEffects({ visibleStreamBufferLength: 7 });

    expect(manager().isFollowEngaged()).toBe(true);
    expect(harness.getScrollTop()).toBe(500);
  });

  it('挂起后落回陈旧的程序化落点不会误恢复跟随', () => {
    const harness = createScrollHarness();
    setupEngagedAtBottom(harness);
    const { manager } = renderManager(harness);

    act(() => {
      harness.dispatchWheelOnRegion(-100);
    });
    harness.setScrollTop(580);
    harness.advanceClock(50);
    act(() => {
      manager().handleScroll(harness.scrollEvent());
    });
    expect(manager().isFollowEngaged()).toBe(false);

    harness.setScrollHeight(1240);
    harness.advanceClock(50);
    harness.getObserver()?.trigger();
    expect(manager().isFollowEngaged()).toBe(false);

    // 回到旧的程序化落点 680：离真正底部（840）仍有 160px，不得误恢复
    harness.setScrollTop(680);
    harness.advanceClock(50);
    act(() => {
      manager().handleScroll(harness.scrollEvent());
    });
    expect(manager().isFollowEngaged()).toBe(false);
  });

  it('上滑挂起后向下滚回最新边缘（末条消息贴视口底）会恢复跟随', () => {
    const harness = createScrollHarness();
    setupEngagedAtBottom(harness);
    const { manager } = renderManager(harness, {
      visibleStreaming: true,
      visibleStreamBufferLength: 3,
    });

    // 上滑显式离开 latest
    act(() => {
      harness.dispatchWheelOnRegion(-120);
    });
    harness.setScrollTop(560);
    harness.advanceClock(50);
    act(() => {
      manager().handleScroll(harness.scrollEvent());
    });
    expect(manager().isFollowEngaged()).toBe(false);

    // 用户滚回「末条消息贴视口底」的自然阅读位置：距绝对底部恰好一个 spacer。
    // 位置路径必须仍然挂起（非程序化位置只有回到真正底部才恢复）。
    harness.setScrollTop(600);
    harness.advanceClock(50);
    act(() => {
      manager().handleScroll(harness.scrollEvent());
    });
    const distanceToBottom = harness.getScrollHeight() - harness.getScrollTop() - CLIENT_HEIGHT;
    expect(distanceToBottom).toBe(SPACER_HEIGHT);
    expect(SPACER_HEIGHT).toBeGreaterThan(CHAT_TRUE_BOTTOM_TOLERANCE_PX);
    expect(manager().isFollowEngaged()).toBe(false);

    // 向下显式意图 + 视口已在 latest 边缘内 ⇒ 用户是在追最新内容，恢复跟随并立即贴底
    act(() => {
      harness.dispatchWheelOnRegion(120);
    });

    expect(manager().isFollowEngaged()).toBe(true);
    expect(harness.getShowScrollToBottom()).toBe(false);
    expect(harness.getScrollTop()).toBe(680);
  });

  it('向下意图但锚点仍在视口下方（历史中部）不恢复跟随', () => {
    const harness = createScrollHarness();
    setupEngagedAtBottom(harness);
    const { manager } = renderManager(harness, {
      visibleStreaming: true,
      visibleStreamBufferLength: 3,
    });

    act(() => {
      harness.dispatchWheelOnRegion(-120);
    });
    expect(manager().isFollowEngaged()).toBe(false);

    // 视口远在锚点上方：latest 边缘判定为 false，向下意图不得恢复跟随
    harness.setScrollHeight(2000);
    harness.setScrollTop(200);
    harness.setAnchorContentTop(1900);
    harness.setAnchorContentBottom(2000);
    harness.advanceClock(50);
    act(() => {
      manager().handleScroll(harness.scrollEvent());
    });
    expect(manager().isFollowEngaged()).toBe(false);

    act(() => {
      harness.dispatchWheelOnRegion(120);
    });
    expect(manager().isFollowEngaged()).toBe(false);
    expect(harness.getShowScrollToBottom()).toBe(true);
  });

  it('向上意图即使落在 latest 边缘内也不恢复跟随', () => {
    const harness = createScrollHarness();
    setupEngagedAtBottom(harness);
    const { manager } = renderManager(harness, {
      visibleStreaming: true,
      visibleStreamBufferLength: 3,
    });

    act(() => {
      harness.dispatchWheelOnRegion(-120);
    });
    expect(manager().isFollowEngaged()).toBe(false);

    // 视口落在宽松边缘内（距绝对底部一个 spacer），但向上意图意味着用户在翻历史
    harness.setScrollTop(600);
    harness.advanceClock(50);
    act(() => {
      manager().handleScroll(harness.scrollEvent());
    });
    expect(manager().isFollowEngaged()).toBe(false);

    act(() => {
      harness.dispatchWheelOnRegion(-120);
    });
    expect(manager().isFollowEngaged()).toBe(false);
    expect(harness.getShowScrollToBottom()).toBe(true);
  });
});
