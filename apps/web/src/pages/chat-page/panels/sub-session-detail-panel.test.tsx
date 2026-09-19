// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { SessionTask } from '@openAwork/web-client';
import type { ChatMessage } from '../../../components/conversation-runtime/messages/support.js';
import { SubSessionDetailPanel } from './sub-session-detail-panel.js';

const { useSubSessionDetailMock } = vi.hoisted(() => ({
  useSubSessionDetailMock: vi.fn(),
}));

vi.mock('../hooks/use-sub-session-detail.js', () => ({
  useSubSessionDetail: useSubSessionDetailMock,
}));

const CLIENT_HEIGHT = 400;
const SESSION_ID = 'child-session-1';

class MockResizeObserver implements ResizeObserver {
  readonly observedElements: Element[] = [];

  observe(target: Element): void {
    this.observedElements.push(target);
  }

  unobserve(target: Element): void {
    const index = this.observedElements.indexOf(target);
    if (index >= 0) this.observedElements.splice(index, 1);
  }

  disconnect(): void {
    this.observedElements.length = 0;
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

interface ScrollGeometry {
  region: HTMLDivElement;
  scrollTo: Mock;
  getScrollTop: () => number;
  setScrollTop: (next: number) => void;
  setScrollHeight: (next: number) => void;
  dispatchWheelUp: () => void;
  dispatchScroll: () => void;
}

function installScrollGeometry(region: HTMLDivElement): ScrollGeometry {
  let scrollTop = 0;
  let scrollHeight = 1400;

  Object.defineProperty(region, 'clientHeight', { configurable: true, get: () => CLIENT_HEIGHT });
  Object.defineProperty(region, 'scrollHeight', {
    configurable: true,
    get: () => scrollHeight,
  });
  Object.defineProperty(region, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (value: number) => {
      scrollTop = value;
    },
  });
  Object.defineProperty(region, 'getBoundingClientRect', {
    configurable: true,
    value: () => createRect(0, CLIENT_HEIGHT),
  });

  const scrollTo = vi.fn((options?: ScrollToOptions | number) => {
    if (typeof options === 'number') {
      scrollTop = options;
      return;
    }
    if (typeof options?.top === 'number') {
      scrollTop = options.top;
    }
  });
  Object.defineProperty(region, 'scrollTo', { configurable: true, value: scrollTo });

  return {
    region,
    scrollTo,
    getScrollTop: () => scrollTop,
    setScrollTop: (next) => {
      scrollTop = next;
    },
    setScrollHeight: (next) => {
      scrollHeight = next;
    },
    dispatchWheelUp: () => {
      act(() => {
        region.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -120 }));
      });
    },
    dispatchScroll: () => {
      fireEvent.scroll(region);
    },
  };
}

function createUserMessage(id: string, content: string): ChatMessage {
  return { id, role: 'user', content, createdAt: 1_700_000_000_000, status: 'completed' };
}

function createDetailState(messages: ChatMessage[], sessionId: string | null) {
  return {
    error: null,
    loading: false,
    messages,
    pendingPermissions: [],
    refresh: async (): Promise<void> => undefined,
    session: sessionId === null ? null : { id: sessionId },
    tasks: [],
  };
}

interface PanelHarness {
  region: HTMLDivElement;
  geometry: ScrollGeometry;
  commitMessages: (messages: ChatMessage[]) => void;
}

function createPanelElement() {
  return (
    <SubSessionDetailPanel
      childSessionId={SESSION_ID}
      currentUserEmail="user@example.com"
      gatewayUrl="http://localhost:3000"
      onOpenFullSession={() => undefined}
      token="test-token"
    />
  );
}

function renderPanelHarness(): PanelHarness {
  useSubSessionDetailMock.mockReturnValue(createDetailState([], null));
  const view = render(createPanelElement());
  const region = screen.getByTestId('sub-session-scroll-region') as HTMLDivElement;
  const geometry = installScrollGeometry(region);

  // 真实场景中会话详情异步到达；这一步等价于「打开子会话 → 首批内容就位」。
  const commitMessages = (messages: ChatMessage[]): void => {
    useSubSessionDetailMock.mockReturnValue(createDetailState(messages, SESSION_ID));
    act(() => {
      view.rerender(createPanelElement());
    });
  };

  commitMessages([createUserMessage('message-1', '第一条')]);
  return { region, geometry, commitMessages };
}

beforeEach(() => {
  let frameId = 0;
  vi.stubGlobal('ResizeObserver', MockResizeObserver);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frameId += 1;
    callback(0);
    return frameId;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});

afterEach(() => {
  cleanup();
  useSubSessionDetailMock.mockReset();
  vi.unstubAllGlobals();
});

describe('SubSessionDetailPanel 滚动协议', () => {
  it('子会话：用户上滑后新消息提交不会把视口拉回底部', () => {
    const harness = renderPanelHarness();

    // 打开子会话即贴底一次（初始贴底），且按钮不出现
    expect(harness.geometry.scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: 'auto' });
    expect(harness.geometry.getScrollTop()).toBe(1000);
    expect(screen.queryByTestId('sub-session-scroll-bottom')).toBeNull();

    // DOM 锚点契约：消息组带 data-chat-group-root，底部哨兵紧跟最后一组之后
    const groups = harness.region.querySelectorAll('[data-chat-group-root="true"]');
    expect(groups).toHaveLength(1);
    expect(groups[0]?.nextElementSibling).not.toBeNull();
    expect(groups[0]?.nextElementSibling?.hasAttribute('data-chat-group-root')).toBe(false);

    // 用户上滑：显式输入意图 → 挂起跟随
    harness.geometry.dispatchWheelUp();
    harness.geometry.setScrollTop(300);
    harness.geometry.dispatchScroll();
    expect(screen.getByTestId('sub-session-scroll-bottom')).not.toBeNull();

    // 新消息提交（内容同时增高）：跟随已挂起 → 不得把视口拉回底部
    const scrollCallsBeforeCommit = harness.geometry.scrollTo.mock.calls.length;
    harness.geometry.setScrollHeight(1560);
    harness.commitMessages([
      createUserMessage('message-1', '第一条'),
      createUserMessage('message-2', '第二条'),
    ]);

    expect(harness.geometry.scrollTo.mock.calls.length).toBe(scrollCallsBeforeCommit);
    expect(harness.geometry.getScrollTop()).toBe(300);
    expect(screen.getByTestId('sub-session-scroll-bottom')).not.toBeNull();
  });

  it('子会话：会话数据就绪但 id 与期望不一致时仍会在开屏时贴底', () => {
    // 会话记录的 id 与面板持有的 childSessionId 不一致（临时 / 乐观 id）：
    // 旧门槛 `session.id === childSessionId` 在这种状态下永远不成立，开屏贴底会静默失效。
    const mismatchedSessionId = `${SESSION_ID}-optimistic`;

    // 打开瞬间详情仍在加载
    useSubSessionDetailMock.mockReturnValue(createDetailState([], null));
    const view = render(createPanelElement());
    const region = screen.getByTestId('sub-session-scroll-region') as HTMLDivElement;
    const geometry = installScrollGeometry(region);

    // 用户先上滑 → 协议层自动跟随被挂起：此时唯一能让面板贴底的路径
    // 就是面板自己的一次性「开屏贴底」。
    geometry.dispatchWheelUp();
    expect(geometry.scrollTo).not.toHaveBeenCalled();

    // 子会话数据就绪（消息已渲染），但会话记录 id 与期望不一致
    useSubSessionDetailMock.mockReturnValue(
      createDetailState([createUserMessage('message-1', '第一条')], mismatchedSessionId),
    );
    act(() => {
      view.rerender(createPanelElement());
    });

    // 仍必须贴底，且只贴一次
    expect(geometry.scrollTo).toHaveBeenCalledTimes(1);
    expect(geometry.scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: 'auto' });
    expect(geometry.getScrollTop()).toBe(1000);

    // 一次性：同一子会话后续消息提交不得重跑开屏贴底（用户上滑后仍停在原处）
    geometry.setScrollHeight(1560);
    geometry.dispatchWheelUp();
    geometry.setScrollTop(300);
    geometry.dispatchScroll();
    const scrollCallsBeforeCommit = geometry.scrollTo.mock.calls.length;

    useSubSessionDetailMock.mockReturnValue(
      createDetailState(
        [createUserMessage('message-1', '第一条'), createUserMessage('message-2', '第二条')],
        mismatchedSessionId,
      ),
    );
    act(() => {
      view.rerender(createPanelElement());
    });

    expect(geometry.scrollTo.mock.calls.length).toBe(scrollCallsBeforeCommit);
    expect(geometry.getScrollTop()).toBe(300);
  });

  it('子会话：回到最近处后恢复自动跟随', () => {
    const harness = renderPanelHarness();

    harness.geometry.dispatchWheelUp();
    harness.geometry.setScrollTop(300);
    harness.geometry.dispatchScroll();
    expect(screen.getByTestId('sub-session-scroll-bottom')).not.toBeNull();

    // 位置回到最新边缘 → 恢复跟随、按钮隐藏
    harness.geometry.setScrollTop(1000);
    harness.geometry.dispatchScroll();
    expect(screen.queryByTestId('sub-session-scroll-bottom')).toBeNull();

    // 内容继续增长：自动跟随重新生效（贴到新底部）
    harness.geometry.setScrollHeight(1560);
    harness.commitMessages([
      createUserMessage('message-1', '第一条'),
      createUserMessage('message-2', '第二条'),
    ]);

    expect(harness.geometry.scrollTo).toHaveBeenLastCalledWith({ top: 1160, behavior: 'auto' });
    expect(harness.geometry.getScrollTop()).toBe(1160);
  });

  it('子会话：点击回到底部后恢复跟随', () => {
    const harness = renderPanelHarness();

    harness.geometry.dispatchWheelUp();
    harness.geometry.setScrollTop(300);
    harness.geometry.dispatchScroll();

    fireEvent.click(screen.getByTestId('sub-session-scroll-bottom'));

    expect(screen.queryByTestId('sub-session-scroll-bottom')).toBeNull();
    expect(harness.geometry.scrollTo).toHaveBeenLastCalledWith({ top: 1000, behavior: 'auto' });
    expect(harness.geometry.getScrollTop()).toBe(1000);

    // 点击之后跟随重新启用：后续内容增长继续贴底
    harness.geometry.setScrollHeight(1560);
    harness.commitMessages([
      createUserMessage('message-1', '第一条'),
      createUserMessage('message-2', '第二条'),
    ]);
    expect(harness.geometry.getScrollTop()).toBe(1160);
  });

  it('子会话：不存在忽略窗口', () => {
    const harness = renderPanelHarness();

    harness.geometry.dispatchWheelUp();
    harness.geometry.setScrollTop(300);
    harness.geometry.dispatchScroll();

    // 程序化回底（等同点击回底按钮）
    fireEvent.click(screen.getByTestId('sub-session-scroll-bottom'));
    expect(screen.queryByTestId('sub-session-scroll-bottom')).toBeNull();
    expect(harness.geometry.getScrollTop()).toBe(1000);

    // 紧随其后的外部滚动（原生滚动条拖拽）必须立即更新跟随状态：
    // 旧实现用「程序化滚动后忽略 scroll 事件 420ms」会把这一帧吞掉，按钮不会出现。
    harness.geometry.setScrollTop(0);
    harness.geometry.dispatchScroll();

    expect(screen.getByTestId('sub-session-scroll-bottom')).not.toBeNull();
  });
});

function createFailedTask(): SessionTask {
  return {
    blockedBy: [],
    completedSubtaskCount: 0,
    createdAt: 1_700_000_000_000,
    depth: 0,
    errorMessage: '构建失败：TypeError: boom',
    id: 'task-failed-1',
    priority: 'medium',
    readySubtaskCount: 0,
    status: 'failed',
    subtaskCount: 0,
    tags: [],
    title: '修复登录',
    unmetDependencyCount: 0,
    updatedAt: 1_700_000_000_000,
  };
}

describe('SubSessionDetailPanel 失败横幅', () => {
  it('失败的子任务会在详情面板内展示具体错误原因，且头部计数保留', () => {
    useSubSessionDetailMock.mockReturnValue({
      ...createDetailState([createUserMessage('message-1', '第一条')], SESSION_ID),
      tasks: [createFailedTask()],
    });

    render(createPanelElement());

    const alert = screen.getByRole('alert', { name: '子代理执行失败' });

    expect(alert.textContent).toContain('修复登录');
    expect(screen.getByText('构建失败：TypeError: boom')).not.toBeNull();
    expect(screen.getByText('失败 1')).not.toBeNull();
  });

  it('会话级错误但无失败任务时展示会话级 fallback', () => {
    useSubSessionDetailMock.mockReturnValue({
      ...createDetailState([createUserMessage('message-1', '第一条')], SESSION_ID),
      session: { id: SESSION_ID, state_status: 'error' },
      tasks: [],
    });

    render(createPanelElement());

    expect(screen.getByRole('alert', { name: '子代理执行失败' })).not.toBeNull();
    expect(screen.getByText(/未记录任务级错误详情/)).not.toBeNull();
  });

  it('没有失败任务且会话状态正常时不展示失败横幅', () => {
    useSubSessionDetailMock.mockReturnValue(
      createDetailState([createUserMessage('message-1', '第一条')], SESSION_ID),
    );

    render(createPanelElement());

    expect(screen.queryByRole('alert', { name: '子代理执行失败' })).toBeNull();
  });
});
