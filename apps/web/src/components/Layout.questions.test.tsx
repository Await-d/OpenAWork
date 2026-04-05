// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Layout from './Layout.js';
import { useAuthStore } from '../stores/auth.js';
import { requestCurrentSessionRefresh } from '../utils/session-list-events.js';

const replyMock = vi.fn(async () => undefined);
const listPendingQuestionsMock = vi.fn<
  (
    _token?: string,
    _sessionId?: string,
    _options?: { signal?: AbortSignal },
  ) => Promise<
    Array<{
      requestId: string;
      sessionId: string;
      toolName: string;
      title: string;
      questions: Array<{
        header: string;
        question: string;
        options: Array<{ label: string; description: string }>;
      }>;
      status: 'pending';
      createdAt: string;
    }>
  >
>(async () => [
  {
    requestId: 'question-1',
    sessionId: 'session-1',
    toolName: 'question',
    title: '目录',
    questions: [
      {
        header: '目录',
        question: '请选择要查看的目录',
        options: [{ label: 'workspace', description: '查看工作目录' }],
      },
    ],
    status: 'pending',
    createdAt: new Date().toISOString(),
  },
]);
const getRecoveryMock = vi.fn(
  async (token: string, sessionId: string, options?: { signal?: AbortSignal }) => ({
    activeStream: null,
    children: [],
    pendingPermissions: [],
    pendingQuestions: await listPendingQuestionsMock(token, sessionId, options),
    ratings: [],
    session: { messages: [] },
    tasks: [],
    todoLanes: { main: [], temp: [] },
  }),
);

vi.mock('@openAwork/web-client', () => ({
  createSessionsClient: vi.fn(() => ({
    list: vi.fn(async () => []),
    create: vi.fn(async () => ({ id: 'new-session' })),
    get: vi.fn(async () => ({ messages: [] })),
    getRecovery: getRecoveryMock,
    rename: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
  })),
  createCommandsClient: vi.fn(() => ({ list: vi.fn(async () => []) })),
  createPermissionsClient: vi.fn(() => ({
    listPending: vi.fn(async () => []),
    reply: vi.fn(async () => undefined),
  })),
  createQuestionsClient: vi.fn(() => ({
    listPending: listPendingQuestionsMock,
    reply: replyMock,
  })),
  HttpError: class HttpError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
  withTokenRefresh: vi.fn(async (_gatewayUrl, _tokenStore, callback) => callback('token-123')),
}));

vi.mock('../utils/session-transfer.js', () => ({
  exportSession: vi.fn(),
  importSession: vi.fn(),
}));

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  listPendingQuestionsMock.mockClear();
  getRecoveryMock.mockClear();
  replyMock.mockClear();
  useAuthStore.setState({
    accessToken: 'token-123',
    refreshToken: null,
    tokenExpiresAt: Date.now() + 60_000,
    email: 'admin@openAwork.local',
    gatewayUrl: 'http://localhost:3000',
    webAccessEnabled: false,
    webPort: 3000,
  });

  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount();
    });
  }
  root = null;
  container?.remove();
  container = null;
  delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT;
});

async function renderLayout() {
  await act(async () => {
    root!.render(
      <MemoryRouter initialEntries={['/chat/session-1']}>
        <Routes>
          <Route path="/chat/:sessionId" element={<Layout />}>
            <Route index element={<div>chat page</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
  });

  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  return container!;
}

describe('Layout question prompt integration', () => {
  it('loads pending questions and submits an answer', async () => {
    const rendered = await renderLayout();
    expect(rendered.textContent).toContain('会话等待回答');
    expect(rendered.textContent).toContain('请选择要查看的目录');

    const optionButton = Array.from(rendered.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('workspace'),
    );
    const submitButton = Array.from(rendered.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('提交回答'),
    );

    act(() => {
      optionButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    act(() => {
      submitButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(replyMock).toHaveBeenCalledWith('token-123', 'session-1', {
      requestId: 'question-1',
      status: 'answered',
      answers: [['workspace']],
    });
  });

  it('shows a submitting state while answering', async () => {
    let resolveReply: (() => void) | null = null;
    replyMock.mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          resolveReply = () => resolve(undefined);
        }),
    );

    const rendered = await renderLayout();
    const optionButton = Array.from(rendered.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('workspace'),
    );
    const submitButton = Array.from(rendered.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('提交回答'),
    ) as HTMLButtonElement | undefined;

    act(() => {
      optionButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    act(() => {
      submitButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(rendered.textContent).toContain('正在提交回答');
    expect(submitButton?.disabled).toBe(true);

    await act(async () => {
      resolveReply?.();
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  it('keeps the prompt visible and shows an inline error when answering fails', async () => {
    replyMock.mockRejectedValueOnce(new Error('提交回答失败，请重试。'));

    const rendered = await renderLayout();
    const optionButton = Array.from(rendered.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('workspace'),
    );
    const submitButton = Array.from(rendered.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('提交回答'),
    );

    act(() => {
      optionButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    act(() => {
      submitButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(rendered.textContent).toContain('会话等待回答');
    expect(rendered.textContent).toContain('提交回答失败，请重试。');
    expect(rendered.textContent).toContain('workspace');
  });

  it('dismisses stale prompts after a resolved-question conflict', async () => {
    const rendered = await renderLayout();
    listPendingQuestionsMock.mockResolvedValueOnce([]);

    replyMock.mockRejectedValueOnce({
      message: 'Failed to reply question request: 409',
      status: 409,
      data: { error: 'Question request already resolved' },
    });

    const dismissButton = Array.from(rendered.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('暂不回答'),
    );

    act(() => {
      dismissButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(rendered.textContent).not.toContain('会话等待回答');
  });

  it('reloads pending questions when the current session requests refresh', async () => {
    await renderLayout();
    listPendingQuestionsMock.mockResolvedValueOnce([]);

    act(() => {
      requestCurrentSessionRefresh('session-1');
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(listPendingQuestionsMock).toHaveBeenCalledTimes(2);
  });

  it('preserves selected answers when the same question is refreshed', async () => {
    const rendered = await renderLayout();

    const optionButton = Array.from(rendered.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('workspace'),
    );

    act(() => {
      optionButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const submitBeforeRefresh = Array.from(rendered.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('提交回答'),
    ) as HTMLButtonElement | undefined;
    expect(submitBeforeRefresh?.disabled).toBe(false);

    act(() => {
      requestCurrentSessionRefresh('session-1');
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const submitAfterRefresh = Array.from(rendered.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('提交回答'),
    ) as HTMLButtonElement | undefined;
    expect(submitAfterRefresh?.disabled).toBe(false);
  });

  it('refreshes the current session after replying to a child-session question', async () => {
    listPendingQuestionsMock.mockImplementationOnce(async () => [
      {
        requestId: 'question-child-1',
        sessionId: 'child-session-1',
        toolName: 'question',
        title: '子会话目录',
        questions: [
          {
            header: '目录',
            question: '请选择要查看的目录',
            options: [{ label: 'workspace', description: '查看工作目录' }],
          },
        ],
        status: 'pending',
        createdAt: new Date().toISOString(),
      },
    ]);
    listPendingQuestionsMock.mockResolvedValue([]);

    const rendered = await renderLayout();
    const dismissButton = Array.from(rendered.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('暂不回答'),
    );

    act(() => {
      dismissButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const currentSessionRefreshCalls = getRecoveryMock.mock.calls.filter(
      (call) => call[1] === 'session-1',
    );
    expect(currentSessionRefreshCalls.length).toBeGreaterThanOrEqual(2);
    expect(replyMock).toHaveBeenCalledWith('token-123', 'child-session-1', {
      requestId: 'question-child-1',
      status: 'dismissed',
    });
  });
});
