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

beforeEach(() => {
  useUIStateStore.setState({
    chatView: 'home',
    editorFullScreen: false,
    reviewPanelOpened: false,
    rightOpen: false,
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
});
