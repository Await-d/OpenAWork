// @vitest-environment jsdom

import type { UIEvent } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMultiAttachStore } from '../../../stores/team/multi-attach-store.js';
import { useLayerStore } from '../../../stores/team/team-events.js';
import { useTeamConversationState } from './use-team-conversation-state.js';

const SESSION_A = 'team-session-a';
const SESSION_B = 'team-session-b';
const TOKEN = 'tok-fake';
const GATEWAY = 'https://gw.test';
const EMAIL = 'qa@example.com';

const CLIENT_HEIGHT = 400;
const ANCHOR_HEIGHT = 120;

class MockResizeObserver implements ResizeObserver {
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

function stubRecovery(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            recovery: {
              pendingPermissions: [],
              pendingQuestions: [],
              session: { id: SESSION_A, state_status: 'idle', messages: [] },
              todoLanes: { lanes: [] },
              tasks: [],
              children: [],
              ratings: [],
              activeStream: null,
              totalTurnCount: null,
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    ),
  );
}

interface TeamScrollDom {
  readonly scrollRegion: HTMLDivElement;
  readonly contentColumn: HTMLDivElement;
  readonly bottom: HTMLDivElement;
  readonly scrollTo: ReturnType<typeof vi.fn>;
  getScrollTop: () => number;
  setScrollTop: (next: number) => void;
  setScrollHeight: (next: number) => void;
  scrollEvent: () => UIEvent<HTMLDivElement>;
  dispatchWheelUp: () => void;
  dispose: () => void;
}

const activeScrollDoms: TeamScrollDom[] = [];

function createTeamScrollDom(): TeamScrollDom {
  const scrollRegion = document.createElement('div');
  const contentColumn = document.createElement('div');
  const anchorGroup = document.createElement('div');
  anchorGroup.setAttribute('data-chat-group-root', 'true');
  const bottom = document.createElement('div');
  contentColumn.append(anchorGroup, bottom);
  scrollRegion.appendChild(contentColumn);
  document.body.appendChild(scrollRegion);

  let scrollTop = 680;
  let scrollHeight = 1080;
  let clientHeight = CLIENT_HEIGHT;
  const anchorContentTop = 880;

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
  Object.defineProperty(anchorGroup, 'getBoundingClientRect', {
    configurable: true,
    value: () => createRect(anchorContentTop - scrollTop, ANCHOR_HEIGHT),
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
  Object.defineProperty(scrollRegion, 'scrollTo', { configurable: true, value: scrollTo });

  const dom: TeamScrollDom = {
    scrollRegion,
    contentColumn,
    bottom,
    scrollTo,
    getScrollTop: () => scrollTop,
    setScrollTop: (next) => {
      scrollTop = next;
    },
    setScrollHeight: (next) => {
      scrollHeight = next;
    },
    scrollEvent: () => ({ currentTarget: scrollRegion }) as unknown as UIEvent<HTMLDivElement>,
    dispatchWheelUp: () => {
      scrollRegion.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -120 }));
    },
    dispose: () => {
      scrollRegion.remove();
    },
  };
  activeScrollDoms.push(dom);
  return dom;
}

type TeamHookView = ReturnType<typeof renderHookWithSession>;

function renderHookWithSession(sessionId: string) {
  return renderHook(
    ({ activeSessionId }: { activeSessionId: string }) =>
      useTeamConversationState({
        sessionId: activeSessionId,
        currentUserEmail: EMAIL,
        gatewayUrl: GATEWAY,
        token: TOKEN,
      }),
    { initialProps: { activeSessionId: sessionId } },
  );
}

async function mountTeam(sessionId: string): Promise<{ dom: TeamScrollDom; view: TeamHookView }> {
  const dom = createTeamScrollDom();
  const view = renderHookWithSession(sessionId);
  await waitFor(() => {
    expect(view.result.current.isSessionSnapshotReady).toBe(true);
  });
  const state = view.result.current;
  state.scrollRegionRef.current = dom.scrollRegion;
  state.bottomRef.current = dom.bottom;
  state.contentColumnRef.current = dom.contentColumn;
  return { dom, view };
}

/**
 * 多路 SSE 真实链路：store 收到 connected 后 hook 进入流式态并注册 handler，
 * 分发的 RunEvent 直接喂给 `useConversationStream`。必须在同一个 act 内完成
 * 「连接 + 分发」：effect 依赖中的 stream 句柄每次渲染都会重建，跨 act 后
 * handler 会被 cleanup 重置为「本地流式中」并把事件当作本地流式丢弃。
 */
function startStreamingWithGrowth(sessionId: string, delta: string, rowId: number): void {
  act(() => {
    useMultiAttachStore.getState().setSessionState(sessionId, 'connected');
    useMultiAttachStore
      .getState()
      .dispatchEvent(sessionId, { type: 'text_delta', delta }, { rowId });
  });
}

function appendAssistantMessage(view: TeamHookView, id: string): void {
  act(() => {
    view.result.current.setMessages((previous) => [
      ...previous,
      { id, role: 'assistant', content: id, createdAt: Date.now() },
    ]);
  });
}

function suspendFollowing(view: TeamHookView, dom: TeamScrollDom): void {
  act(() => {
    dom.dispatchWheelUp();
  });
  act(() => {
    dom.setScrollTop(520);
    view.result.current.onScroll(dom.scrollEvent());
  });
}

beforeEach(() => {
  stubRecovery();
  useLayerStore.getState().clear();
  useMultiAttachStore.setState({
    sessions: new Map(),
    handlers: new Map(),
    processedRowIds: new Map(),
    pendingEvents: new Map(),
  });
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
  for (const dom of activeScrollDoms) dom.dispose();
  activeScrollDoms.length = 0;
  useLayerStore.getState().clear();
  useMultiAttachStore.setState({
    sessions: new Map(),
    handlers: new Map(),
    processedRowIds: new Map(),
    pendingEvents: new Map(),
  });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useTeamConversationState — 滚动跟随（team 侧接线）', () => {
  it('团队会话：流式期间用户上滑后不会被拉回底部', async () => {
    const { dom, view } = await mountTeam(SESSION_A);

    suspendFollowing(view, dom);
    expect(view.result.current.showScrollToBottom).toBe(true);

    dom.setScrollHeight(1240);
    startStreamingWithGrowth(SESSION_A, '更多内容', 1);

    expect(view.result.current.streamBuffer).toBe('更多内容');
    expect(view.result.current.visibleStreaming).toBe(true);
    expect(dom.scrollTo).not.toHaveBeenCalledWith({ top: 840, behavior: 'auto' });
    expect(dom.getScrollTop()).toBe(520);
    expect(view.result.current.showScrollToBottom).toBe(true);
  });

  it('团队会话：滚回最近处后恢复自动跟随', async () => {
    const { dom, view } = await mountTeam(SESSION_A);
    startStreamingWithGrowth(SESSION_A, '初始内容', 1);

    suspendFollowing(view, dom);
    expect(view.result.current.showScrollToBottom).toBe(true);

    act(() => {
      dom.setScrollTop(680);
      view.result.current.onScroll(dom.scrollEvent());
    });
    expect(view.result.current.showScrollToBottom).toBe(false);

    dom.setScrollHeight(1240);
    appendAssistantMessage(view, 'm-follow');

    expect(dom.scrollTo).toHaveBeenLastCalledWith({ top: 840, behavior: 'auto' });
    expect(dom.getScrollTop()).toBe(840);
    expect(view.result.current.showScrollToBottom).toBe(false);
  });

  it('团队会话：点击回到底部恢复跟随', async () => {
    const { dom, view } = await mountTeam(SESSION_A);
    startStreamingWithGrowth(SESSION_A, '初始内容', 1);

    suspendFollowing(view, dom);
    expect(view.result.current.showScrollToBottom).toBe(true);

    act(() => {
      view.result.current.scrollToBottom();
    });

    expect(dom.scrollTo).toHaveBeenLastCalledWith({ top: 680, behavior: 'auto' });
    expect(dom.getScrollTop()).toBe(680);
    expect(view.result.current.showScrollToBottom).toBe(false);
  });

  it('团队会话：切换会话会重置用户的滚动保持', async () => {
    const { dom, view } = await mountTeam(SESSION_A);
    startStreamingWithGrowth(SESSION_A, '初始内容', 1);

    suspendFollowing(view, dom);
    expect(view.result.current.showScrollToBottom).toBe(true);

    view.rerender({ activeSessionId: SESSION_B });
    await waitFor(() => {
      expect(view.result.current.isSessionSnapshotReady).toBe(true);
    });
    expect(view.result.current.showScrollToBottom).toBe(false);

    dom.setScrollHeight(1240);
    startStreamingWithGrowth(SESSION_B, '新会话内容', 10);

    expect(view.result.current.streamBuffer).toBe('新会话内容');
    expect(dom.scrollTo).toHaveBeenLastCalledWith({ top: 840, behavior: 'auto' });
    expect(dom.getScrollTop()).toBe(840);
    expect(view.result.current.showScrollToBottom).toBe(false);
  });

  it('团队会话：流式内容增长本身不算用户意图', async () => {
    const { dom, view } = await mountTeam(SESSION_A);

    dom.setScrollHeight(1200);
    startStreamingWithGrowth(SESSION_A, '第一段', 1);
    expect(view.result.current.visibleStreaming).toBe(true);
    expect(dom.scrollTo).toHaveBeenLastCalledWith({ top: 800, behavior: 'auto' });
    expect(dom.getScrollTop()).toBe(800);
    expect(view.result.current.showScrollToBottom).toBe(false);

    dom.setScrollHeight(1320);
    appendAssistantMessage(view, 'm-growth');
    expect(dom.getScrollTop()).toBe(920);
    expect(dom.scrollTo).toHaveBeenLastCalledWith({ top: 920, behavior: 'auto' });
    expect(view.result.current.showScrollToBottom).toBe(false);
  });
});
