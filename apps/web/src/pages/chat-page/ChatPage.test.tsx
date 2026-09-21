// @vitest-environment jsdom
/**
 * ChatPage 组装层回归护栏（组装层瘦身前置 P0 tripwire）
 *
 * 本文件只做「装配契约」断言，不重复覆盖已抽出的域 hook 逻辑：
 *  1. 渲染冒烟：classic 布局下工作台外壳 / 会话视图 / 滚动区都在 DOM 中。
 *  2. classic ↔ fusion 容器切换：由 uiState.workbenchLayoutMode 驱动，
 *     切换后容器 testid 必须互斥出现，且 ChatConversationView 在两个分支都挂载。
 *  3. 渲染期间不得产生 unhandled rejection（页面自带大量 fire-and-forget 异步）。
 *
 * 网络隔离：@openAwork/web-client 被部分 mock（仅覆写 createSessionsClient 的
 * getRecovery 读数），其余方法仍走真实实现；全局 fetch / WebSocket / EventSource
 * 一律替换为返回空载荷的替身，保证任何路径都不会发起真实网络 I/O。
 */

import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, RouterProvider, createMemoryRouter } from 'react-router';
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

function emptyRecovery(sessionId: string) {
  return {
    activeStream: null,
    children: [],
    pendingPermissions: [],
    pendingQuestions: [],
    ratings: [],
    session: { id: sessionId, messages: [], state_status: 'idle' },
    tasks: [],
    todoLanes: { main: [], temp: [] },
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

interface RejectionRecord {
  readonly reason: unknown;
}

function installRejectionTracker(): {
  rejections: RejectionRecord[];
  uninstall: () => void;
} {
  const rejections: RejectionRecord[] = [];
  const onUnhandled = (reason: unknown): void => {
    rejections.push({ reason });
  };
  process.on('unhandledRejection', onUnhandled);
  return {
    rejections,
    uninstall: () => {
      process.off('unhandledRejection', onUnhandled);
    },
  };
}

function resetUiState(): void {
  useUIStateStore.setState({
    chatView: 'home',
    editorFullScreen: false,
    reviewPanelOpened: false,
    rightOpen: false,
    sidePanelActiveTab: 'review',
    terminalPanelOpened: false,
    workbenchLayoutMode: 'fusion',
  });
}

beforeEach(() => {
  resetUiState();
  useAuthStore.setState({
    accessToken: 'token-test',
    email: 'qa@example.com',
    gatewayUrl: 'https://gateway.test',
  });
  getRecoveryMock.mockImplementation(async (_token: string, sessionId: string) =>
    emptyRecovery(sessionId),
  );
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
  resetUiState();
});

describe('ChatPage — classic 布局渲染冒烟', () => {
  it('默认 classic 布局渲染工作台外壳 / 主列 / 会话滚动区', async () => {
    useUIStateStore.setState({ workbenchLayoutMode: 'classic' });

    render(
      <MemoryRouter initialEntries={['/chat']}>
        <ChatPage />
      </MemoryRouter>,
    );

    const workbench = screen.getByTestId('classic-chat-workbench');
    const mainColumn = screen.getByTestId('classic-chat-main-column');

    expect(workbench.contains(mainColumn)).toBe(true);
    // ChatConversationView 已在 classic 分支挂载。
    expect(screen.getByTestId('chat-scroll-region')).not.toBeNull();
    expect(screen.getByTestId('chat-content-column')).not.toBeNull();
    // classic 布局不得渲染 fusion 外壳。
    expect(screen.queryByTestId('fusion-chat-main-shell')).toBeNull();
  });

  it('会话加载链路（/chat/session-a）不产生 unhandled rejection', async () => {
    useUIStateStore.setState({ workbenchLayoutMode: 'classic' });
    const tracker = installRejectionTracker();
    try {
      const router = createMemoryRouter([{ path: '/chat/:sessionId?', element: <ChatPage /> }], {
        initialEntries: ['/chat/session-a'],
      });
      render(<RouterProvider router={router} />);

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        await Promise.resolve();
      });

      expect(screen.getByTestId('chat-scroll-region')).not.toBeNull();
      expect(tracker.rejections.map((entry) => String(entry.reason))).toEqual([]);
    } finally {
      tracker.uninstall();
    }
  });
});

describe('ChatPage — classic ↔ fusion 容器切换', () => {
  it('切到 fusion 时只渲染 fusion 外壳，且会话视图仍在', () => {
    useUIStateStore.setState({ workbenchLayoutMode: 'classic' });

    const view = render(
      <MemoryRouter initialEntries={['/chat']}>
        <ChatPage />
      </MemoryRouter>,
    );

    expect(screen.queryByTestId('classic-chat-workbench')).not.toBeNull();
    expect(screen.queryByTestId('fusion-chat-main-shell')).toBeNull();

    act(() => {
      useUIStateStore.setState({ workbenchLayoutMode: 'fusion' });
    });
    view.rerender(
      <MemoryRouter initialEntries={['/chat']}>
        <ChatPage />
      </MemoryRouter>,
    );

    expect(screen.queryByTestId('classic-chat-workbench')).toBeNull();
    expect(screen.queryByTestId('fusion-chat-main-shell')).not.toBeNull();
    expect(screen.queryByTestId('fusion-chat-conversation-pane')).not.toBeNull();
    // 两个分支都必须挂载同一份会话视图（滚动区是分支无关锚点）。
    expect(screen.getByTestId('chat-scroll-region')).not.toBeNull();
  });

  it('从 fusion 切回 classic 时容器回滚且不遗留 fusion 外壳', () => {
    useUIStateStore.setState({ workbenchLayoutMode: 'fusion' });

    const view = render(
      <MemoryRouter initialEntries={['/chat']}>
        <ChatPage />
      </MemoryRouter>,
    );

    expect(screen.queryByTestId('fusion-chat-main-shell')).not.toBeNull();

    act(() => {
      useUIStateStore.setState({ workbenchLayoutMode: 'classic' });
    });
    view.rerender(
      <MemoryRouter initialEntries={['/chat']}>
        <ChatPage />
      </MemoryRouter>,
    );

    expect(screen.queryByTestId('fusion-chat-main-shell')).toBeNull();
    expect(screen.queryByTestId('classic-chat-workbench')).not.toBeNull();
    expect(screen.getByTestId('chat-scroll-region')).not.toBeNull();
  });
});
