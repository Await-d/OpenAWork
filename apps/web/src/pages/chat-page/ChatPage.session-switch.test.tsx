// @vitest-environment jsdom
/**
 * ChatPage 会话切换回归护栏（组装层瘦身前置 P0 tripwire）
 *
 * 组装层里最危险的一段是「会话切换 mega effect」：它必须在加载新会话快照前
 * 把 messages / rightPanel / todos / serverTotalTurnCount / 流式状态等全部重置，
 * 否则用户会看到上一个会话的残留数据。
 *
 * 本文件种下两个可区分的会话（A / B），沿真实路由切换，断言：
 *  1. 切到 B 后 B 的消息必须出现（切换链路没断）
 *  2. A 的消息必须消失（没有把 A 的消息合并/残留进来）
 *  3. A 的「已卸载轮次」计数器必须被清掉（chat-load-earlier 不再显示 A 的条数）
 *
 * 网络隔离：与 ChatPage.test.tsx 相同的部分 mock + 全局 fetch/WS/SSE 替身。
 *
 * 踩坑记录（不要删除）：recovery fixture 的 `todoLanes` 必须是
 * `{ main, temp }`——`prepareSessionRecoveryState` 会直接对 lanes 调 `.map`，
 * 缺字段会让整条 `.then` 抛错并被静默 `.catch`，表现为「页面永远空白」。
 */

import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../stores/auth/auth.js';
import { useUIStateStore } from '../../stores/ui/uiState.js';
import ChatPage from './ChatPage.js';

const { getRecoveryMock } = vi.hoisted(() => ({ getRecoveryMock: vi.fn() }));

vi.mock('@openAwork/web-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openAwork/web-client')>();
  return {
    ...actual,
    // 只覆写会话恢复读数：它是 ChatPage 首屏的主数据源，需要确定性。
    // 其余方法与纯函数保持真实实现（配合下方 fetch 替身，不会产生网络 I/O）。
    createSessionsClient: (gatewayUrl: string) => ({
      ...actual.createSessionsClient(gatewayUrl),
      getRecovery: getRecoveryMock,
    }),
  };
});

const SESSION_A_MESSAGE = '会话A独有内容-ALPHA-7f3d';
const SESSION_B_MESSAGE = '会话B独有内容-BRAVO-9c1e';
const NOTICE_A_DESCRIPTION = '会话A子代理任务-ALPHA';
const NOTICE_B_DESCRIPTION = '会话B子代理任务-BRAVO';

interface RecoveryOptions {
  readonly messages: Array<{ content: string; id: string; role: 'assistant' | 'user' }>;
  /** 子代理完成通知（`role: 'synthetic'`）；走独立通道，不进 transcript。 */
  readonly notices?: Array<{ description: string; id: string }>;
  readonly totalTurnCount?: number;
}

function buildRecovery(sessionId: string, options: RecoveryOptions) {
  return {
    activeStream: null,
    children: [],
    pendingPermissions: [],
    pendingQuestions: [],
    ratings: [],
    session: {
      id: sessionId,
      messages: [
        ...options.messages.map((message, index) => ({
          content: message.content,
          createdAtMs: 1_700_000_000_000 + index,
          id: message.id,
          role: message.role,
        })),
        ...(options.notices ?? []).map((notice, index) => ({
          content: [{ text: `scout 已完成 · ${notice.description}`, type: 'text' }],
          createdAt: 1_700_000_100_000 + index,
          description: notice.description,
          id: notice.id,
          metadata: { agent: 'scout', source: 'subagent', state: 'done' },
          role: 'synthetic',
        })),
      ],
      state_status: 'idle',
    },
    tasks: [],
    todoLanes: { main: [], temp: [] },
    ...(options.totalTurnCount === undefined ? {} : { totalTurnCount: options.totalTurnCount }),
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * 会话加载链路上的真实客户端会按 URL 解析响应体，缺字段会在渲染期炸掉
 * （例如终端列表缺 `terminals` 会让 mergeServerSnapshot 收到 undefined）。
 * 因此这里按端点给出最小合法载荷，其余端点统一返回 {}。
 */
function readRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function createFetchStub(): ReturnType<typeof vi.fn> {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = readRequestUrl(input);
    if (url.includes('/terminals')) {
      return jsonResponse({ terminals: [] });
    }
    if (url.includes('/file-changes')) {
      return jsonResponse({ fileChanges: [], fileChangesByRequest: [] });
    }
    return jsonResponse({});
  });
}

class InertWebSocket {
  static readonly CLOSED = 3;
  static readonly OPEN = 1;
  readonly readyState = InertWebSocket.CLOSED;
  readonly url: string;

  constructor(url: string) {
    this.url = url;
  }

  addEventListener(): void {
    return undefined;
  }

  close(): void {
    return undefined;
  }

  removeEventListener(): void {
    return undefined;
  }

  send(): void {
    return undefined;
  }
}

class InertEventSource {
  static readonly CLOSED = 2;
  static readonly OPEN = 1;
  readonly readyState = InertEventSource.CLOSED;
  readonly url: string;

  constructor(url: string) {
    this.url = url;
  }

  addEventListener(): void {
    return undefined;
  }

  close(): void {
    return undefined;
  }

  removeEventListener(): void {
    return undefined;
  }
}

/**
 * 只读消息流本身的文本，不要在整页上做模糊文本匹配：
 * 同一条用户消息还会出现在 UserHistoryJumpList 的跳转标签里，
 * 全页匹配会命中两处（且无法区分「消息流残留」与「跳转列表残留」）。
 *
 * 同时排除子代理通知群组（`data-role="synthetic"`）——通知是独立时间线行，
 * 不属于消息流；本函数只统计消息群组。
 */
function readRenderedMessageGroupTexts(): string[] {
  return Array.from(
    document.querySelectorAll('[data-chat-group-root="true"]:not([data-role="synthetic"])'),
  ).map((group) => group.textContent ?? '');
}

/** 只读子代理通知行本身（`data-component="subagent-notice"`），避免整页文本模糊匹配。 */
function readRenderedNoticeTexts(): string[] {
  return Array.from(document.querySelectorAll('[data-component="subagent-notice"]')).map(
    (node) => node.textContent ?? '',
  );
}

function renderChatPageAt(initialPath: string) {
  const router = createMemoryRouter([{ path: '/chat/:sessionId?', element: <ChatPage /> }], {
    initialEntries: [initialPath],
  });
  render(<RouterProvider router={router} />);
  return router;
}

async function switchToSession(router: ReturnType<typeof createMemoryRouter>, path: string) {
  await act(async () => {
    await router.navigate(path);
  });
}

interface ScrollGeometryHandle {
  readScrollToCalls: () => number[];
  readScrollTop: () => number;
  setScrollTop: (top: number) => void;
}

/**
 * jsdom 不做布局：把滚动区装配成「可控几何 + 可观测滚动原语」。
 * 三个只读几何量必须显式定义才能被滚动决策代码读到，`scrollTo` 也必须替身化
 * ——真实的 `Element.scrollTo` 在 jsdom 里是 no-op，位置永远不会变化。
 */
function installScrollGeometry(
  region: HTMLDivElement,
  geometry: { clientHeight: number; scrollHeight: number; scrollTop: number },
): ScrollGeometryHandle {
  let currentScrollTop = geometry.scrollTop;
  const scrollToCalls: number[] = [];
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
    get: () => currentScrollTop,
    set: (value: number) => {
      currentScrollTop = value;
    },
  });
  Object.defineProperty(region, 'scrollTo', {
    configurable: true,
    value: (options?: ScrollToOptions | number) => {
      const top = typeof options === 'number' ? options : options?.top;
      if (typeof top !== 'number') return;
      scrollToCalls.push(top);
      currentScrollTop = top;
    },
  });
  return {
    readScrollToCalls: () => [...scrollToCalls],
    readScrollTop: () => currentScrollTop,
    setScrollTop: (top: number) => {
      currentScrollTop = top;
    },
  };
}

/** 装配滚动几何；缺失即抛错，避免断言在无滚动区的页面上静默通过。 */
async function installScrollRegion(geometry: {
  clientHeight: number;
  scrollHeight: number;
  scrollTop: number;
}): Promise<ScrollGeometryHandle> {
  const region = await waitFor(() => {
    const found = document.querySelector<HTMLDivElement>('[data-testid="chat-scroll-region"]');
    if (!found) throw new Error('chat-scroll-region 未挂载');
    return found;
  });
  return installScrollGeometry(region, geometry);
}

/**
 * 等待滚动结算完成（两层 rAF + ResizeObserver 回调）再断言。
 *
 * 不能用 `waitFor` 包住「期望值」断言：结算前的中间值可能恰好等于期望值，
 * 抢跑通过会让护栏失去判别力（实测旧实现会在第一次 poll 时假通过）。
 */
async function settleScroll(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
  });
}

beforeEach(() => {
  useUIStateStore.setState({
    chatView: 'home',
    editorFullScreen: false,
    lastChatPath: null,
    reviewPanelOpened: false,
    rightOpen: false,
    sidePanelActiveTab: 'review',
    sidePanelActiveTabBySession: {},
    terminalPanelOpened: false,
    workbenchLayoutMode: 'classic',
  });
  useAuthStore.setState({
    accessToken: 'token-test',
    email: 'qa@example.com',
    gatewayUrl: 'https://gateway.test',
  });
  getRecoveryMock.mockImplementation(async (_token: string, sessionId: string) => {
    if (sessionId === 'session-a') {
      return buildRecovery(sessionId, {
        messages: [{ content: SESSION_A_MESSAGE, id: 'msg-a-1', role: 'user' }],
        notices: [{ description: NOTICE_A_DESCRIPTION, id: 'task-job:session-a-child' }],
        totalTurnCount: 9,
      });
    }
    if (sessionId === 'session-b') {
      return buildRecovery(sessionId, {
        messages: [{ content: SESSION_B_MESSAGE, id: 'msg-b-1', role: 'user' }],
        notices: [{ description: NOTICE_B_DESCRIPTION, id: 'task-job:session-b-child' }],
        totalTurnCount: 1,
      });
    }
    return buildRecovery(sessionId, { messages: [] });
  });
  vi.stubGlobal('fetch', createFetchStub());
  vi.stubGlobal('WebSocket', InertWebSocket);
  vi.stubGlobal('EventSource', InertEventSource);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ChatPage — 会话切换', () => {
  it('切到会话 B 后渲染 B 的消息，且不残留 A 的消息', async () => {
    const router = renderChatPageAt('/chat/session-a');

    await waitFor(
      () => {
        expect(readRenderedMessageGroupTexts().join('\n')).toContain(SESSION_A_MESSAGE);
      },
      { timeout: 5000 },
    );

    await switchToSession(router, '/chat/session-b');

    await waitFor(
      () => {
        expect(readRenderedMessageGroupTexts().join('\n')).toContain(SESSION_B_MESSAGE);
      },
      { timeout: 5000 },
    );

    const afterSwitch = readRenderedMessageGroupTexts();
    expect(afterSwitch.join('\n')).not.toContain(SESSION_A_MESSAGE);
    expect(afterSwitch).toHaveLength(1);
  });

  it('切到会话 B 后清掉 A 的「已卸载轮次」，不再显示 A 的分页按钮', async () => {
    const router = renderChatPageAt('/chat/session-a');

    await waitFor(
      () => {
        expect(screen.queryByTestId('chat-load-earlier')).not.toBeNull();
      },
      { timeout: 5000 },
    );

    expect(screen.getByTestId('chat-load-earlier').textContent).toContain('8');

    await switchToSession(router, '/chat/session-b');

    await waitFor(
      () => {
        expect(readRenderedMessageGroupTexts().join('\n')).toContain(SESSION_B_MESSAGE);
      },
      { timeout: 5000 },
    );

    expect(screen.queryByTestId('chat-load-earlier')).toBeNull();
  });

  it('从会话 B 切回会话 A 时同样只显示 A 的内容', async () => {
    const router = renderChatPageAt('/chat/session-b');

    await waitFor(
      () => {
        expect(readRenderedMessageGroupTexts().join('\n')).toContain(SESSION_B_MESSAGE);
      },
      { timeout: 5000 },
    );

    await switchToSession(router, '/chat/session-a');

    await waitFor(
      () => {
        expect(readRenderedMessageGroupTexts().join('\n')).toContain(SESSION_A_MESSAGE);
      },
      { timeout: 5000 },
    );

    expect(readRenderedMessageGroupTexts().join('\n')).not.toContain(SESSION_B_MESSAGE);
  });

  it('切到会话 B 后渲染 B 的子代理完成通知，且不残留 A 的通知', async () => {
    const router = renderChatPageAt('/chat/session-a');

    await waitFor(
      () => {
        expect(readRenderedNoticeTexts().join('\n')).toContain(NOTICE_A_DESCRIPTION);
      },
      { timeout: 5000 },
    );

    await switchToSession(router, '/chat/session-b');

    await waitFor(
      () => {
        expect(readRenderedNoticeTexts().join('\n')).toContain(NOTICE_B_DESCRIPTION);
      },
      { timeout: 5000 },
    );

    const noticesAfterSwitch = readRenderedNoticeTexts().join('\n');
    expect(noticesAfterSwitch).not.toContain(NOTICE_A_DESCRIPTION);
  });

  it('切到会话 B 后收起预览视图，但保留工作区级预览地址', async () => {
    const router = renderChatPageAt('/chat/session-a');

    await waitFor(
      () => {
        expect(readRenderedMessageGroupTexts().join('\n')).toContain(SESSION_A_MESSAGE);
      },
      { timeout: 5000 },
    );

    // 模拟「A 会话里打开过预览」：视图状态停在 browser，一级 tab 停在预览。
    // tab 走 action 写入（与真实点击同路径），保证会话桶与镜像同步。
    useUIStateStore.setState({
      browserActive: true,
      editorMode: true,
      editorPaneTabByWorkspace: { '/home/await/project/OpenAWork': 'browser' },
      browserPreviewUrlByWorkspace: {
        '/home/await/project/OpenAWork': 'http://localhost:5173',
      },
    });
    useUIStateStore.getState().setSidePanelActiveTab('preview');

    await switchToSession(router, '/chat/session-b');

    await waitFor(
      () => {
        expect(readRenderedMessageGroupTexts().join('\n')).toContain(SESSION_B_MESSAGE);
      },
      { timeout: 5000 },
    );

    const state = useUIStateStore.getState();
    // 预览视图必须被收起：否则旧会话的页面会永久停在 keep-alive 的预览宿主里。
    expect(state.editorMode).toBe(false);
    expect(state.editorPaneTabByWorkspace['/home/await/project/OpenAWork']).toBe('code');
    expect(state.sidePanelActiveTab).toBe('review');
    expect(state.browserActive).toBe(false);
    // 地址桶属于工作区维度记忆，刻意保留。
    expect(state.browserPreviewUrlByWorkspace['/home/await/project/OpenAWork']).toBe(
      'http://localhost:5173',
    );
  });

  it('会话面板一级 tab 按会话记忆：A 停在代码 → 切 B 回落审查 → 切回 A 仍是代码', async () => {
    const router = renderChatPageAt('/chat/session-a');

    await waitFor(
      () => {
        expect(readRenderedMessageGroupTexts().join('\n')).toContain(SESSION_A_MESSAGE);
      },
      { timeout: 5000 },
    );

    // 等同用户在停靠面板点「代码」：action 同时写当前会话桶。
    act(() => {
      useUIStateStore.getState().setSidePanelActiveTab('code');
    });

    await switchToSession(router, '/chat/session-b');
    await waitFor(
      () => {
        expect(readRenderedMessageGroupTexts().join('\n')).toContain(SESSION_B_MESSAGE);
      },
      { timeout: 5000 },
    );
    expect(useUIStateStore.getState().sidePanelActiveTab).toBe('review');

    await switchToSession(router, '/chat/session-a');
    await waitFor(
      () => {
        expect(readRenderedMessageGroupTexts().join('\n')).toContain(SESSION_A_MESSAGE);
      },
      { timeout: 5000 },
    );
    expect(useUIStateStore.getState().sidePanelActiveTab).toBe('code');
  });

  it('切会话只更新选中态，不把子会话写进新会话的「上次查看」记忆', async () => {
    // A 已经记住自己看过的子会话；切到 B 时若在 effect 里监听 selectedChildSessionId
    // 落库，就会把 A 的子会话 id 写成 B 的记忆（B 之后打开会指向不存在的子会话）。
    useUIStateStore.setState({
      activeChildSessionIdBySession: { 'session-a': 'child-of-a' },
    });

    const router = renderChatPageAt('/chat/session-a');
    await waitFor(
      () => {
        expect(readRenderedMessageGroupTexts().join('\n')).toContain(SESSION_A_MESSAGE);
      },
      { timeout: 5000 },
    );

    await switchToSession(router, '/chat/session-b');
    await waitFor(
      () => {
        expect(readRenderedMessageGroupTexts().join('\n')).toContain(SESSION_B_MESSAGE);
      },
      { timeout: 5000 },
    );

    const buckets = useUIStateStore.getState().activeChildSessionIdBySession;
    // A 的记忆保持原样，B 不得凭空多出一条（自动选择不回填记忆）。
    expect(buckets['session-a']).toBe('child-of-a');
    expect(buckets['session-b']).toBeUndefined();
  });

  it('首屏挂载不回收预览视图（刷新后仍停在上次预览）', async () => {
    // 刷新场景：lastChatPath 与当前路由一致（持久化恢复），因此不会触发会话换镜。
    useUIStateStore.setState({
      editorMode: true,
      editorPaneTabByWorkspace: { '/home/await/project/OpenAWork': 'browser' },
      browserPreviewUrlByWorkspace: {
        '/home/await/project/OpenAWork': 'http://localhost:5173',
      },
      lastChatPath: '/chat/session-a',
      sidePanelActiveTab: 'preview',
    });

    renderChatPageAt('/chat/session-a');

    await waitFor(
      () => {
        expect(readRenderedMessageGroupTexts().join('\n')).toContain(SESSION_A_MESSAGE);
      },
      { timeout: 5000 },
    );

    const state = useUIStateStore.getState();
    expect(state.editorMode).toBe(true);
    expect(state.editorPaneTabByWorkspace['/home/await/project/OpenAWork']).toBe('browser');
    expect(state.sidePanelActiveTab).toBe('preview');
  });

  it('切回「上次停在最新处」的会话时贴底，而不是按旧布局的绝对位置恢复', async () => {
    const router = renderChatPageAt('/chat/session-a');

    await waitFor(
      () => {
        expect(readRenderedMessageGroupTexts().join('\n')).toContain(SESSION_A_MESSAGE);
      },
      { timeout: 5000 },
    );

    // 长列表 + 用户停在最新处：总高 2000 − 视口 600 − 位置 1320 = 距底 80px
    // （末条消息贴视口底，只剩底部 spacer）。
    const scroll = await installScrollRegion({
      clientHeight: 600,
      scrollHeight: 2000,
      scrollTop: 1320,
    });

    await switchToSession(router, '/chat/session-b');
    await waitFor(
      () => {
        expect(readRenderedMessageGroupTexts().join('\n')).toContain(SESSION_B_MESSAGE);
      },
      { timeout: 5000 },
    );

    // 切回 A：缓存命中，且离开时距底 80px ⇒ 必须判定为「停在最新处」。
    scroll.setScrollTop(1320);
    await switchToSession(router, '/chat/session-a');
    await settleScroll();

    // 贴底落点 = 2000 − 600 = 1400。旧实现按缓存的绝对位置恢复到 1320，并且
    // 因为该落点不在真正底部而挂起跟随，此后内容增长也不会再自动贴底——
    // 这正是「切换会话后停在第一条消息处」的成因，本断言是其回归护栏。
    expect(scroll.readScrollToCalls().at(-1)).toBe(1400);
    expect(scroll.readScrollTop()).toBe(1400);
  });

  it('切回「上次停在历史中部」的会话时保留阅读位置，不强行贴底', async () => {
    const router = renderChatPageAt('/chat/session-a');

    await waitFor(
      () => {
        expect(readRenderedMessageGroupTexts().join('\n')).toContain(SESSION_A_MESSAGE);
      },
      { timeout: 5000 },
    );

    // 总高 2000 − 视口 600 − 位置 400 = 距底 1000px：用户明确翻到了历史里。
    const scroll = await installScrollRegion({
      clientHeight: 600,
      scrollHeight: 2000,
      scrollTop: 400,
    });

    await switchToSession(router, '/chat/session-b');
    await waitFor(
      () => {
        expect(readRenderedMessageGroupTexts().join('\n')).toContain(SESSION_B_MESSAGE);
      },
      { timeout: 5000 },
    );

    scroll.setScrollTop(400);
    await switchToSession(router, '/chat/session-a');
    await settleScroll();

    // 反向护栏：贴底修复不得把「刻意停在历史里阅读」的用户也一并弹到底部。
    // 该落点不在真正底部 ⇒ 跟随被挂起，后续内容增长也不得把视口拉走。
    expect(scroll.readScrollTop()).toBe(400);
  });
});
