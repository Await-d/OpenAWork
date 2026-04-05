// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Layout from './Layout.js';
import { useAuthStore } from '../stores/auth.js';

const replyMock = vi.fn(async () => undefined);
const listPendingMock = vi.fn<
  (
    _token?: string,
    _sessionId?: string,
    _options?: { signal?: AbortSignal },
  ) => Promise<
    Array<{
      requestId: string;
      sessionId: string;
      toolName: string;
      scope: string;
      reason: string;
      riskLevel: 'medium';
      previewAction: string;
      status: 'pending';
      createdAt: string;
    }>
  >
>(async () => [
  {
    requestId: 'perm-1',
    sessionId: 'session-1',
    toolName: 'file_write',
    scope: '/tmp/demo.txt',
    reason: '需要写入测试文件',
    riskLevel: 'medium',
    previewAction: 'write demo',
    status: 'pending',
    createdAt: new Date().toISOString(),
  },
]);
const getRecoveryMock = vi.fn(
  async (token: string, sessionId: string, options?: { signal?: AbortSignal }) => ({
    activeStream: null,
    children: [],
    pendingPermissions: await listPendingMock(token, sessionId, options),
    pendingQuestions: [],
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
  createCommandsClient: vi.fn(() => ({
    list: vi.fn(async () => []),
  })),
  createPermissionsClient: vi.fn(() => ({
    listPending: listPendingMock,
    reply: replyMock,
  })),
  createQuestionsClient: vi.fn(() => ({
    listPending: vi.fn(async () => []),
    reply: vi.fn(async () => undefined),
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
  listPendingMock.mockClear();
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

describe('Layout permission prompt integration', () => {
  it('loads pending permission requests and sends replies', async () => {
    const rendered = await renderLayout();
    expect(rendered.textContent).toContain('权限请求');
    expect(rendered.textContent).toContain('file_write');

    const approveButton = Array.from(rendered.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('本次会话同意'),
    );

    act(() => {
      approveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(replyMock).toHaveBeenCalledWith('token-123', 'session-1', {
      requestId: 'perm-1',
      decision: 'session',
    });
  });

  it('shows a submitting state while replying', async () => {
    let resolveReply: (() => void) | null = null;
    replyMock.mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          resolveReply = () => resolve(undefined);
        }),
    );

    const rendered = await renderLayout();
    const approveButton = Array.from(rendered.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('本次会话同意'),
    ) as HTMLButtonElement | undefined;

    act(() => {
      approveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(rendered.textContent).toContain('正在提交“本次会话同意”');
    expect(approveButton?.disabled).toBe(true);

    await act(async () => {
      resolveReply?.();
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  it('keeps the prompt visible and shows an inline error when reply fails', async () => {
    replyMock.mockRejectedValueOnce(new Error('权限处理失败，请重试。'));

    const rendered = await renderLayout();
    const approveButton = Array.from(rendered.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('同意本次'),
    );

    act(() => {
      approveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(rendered.textContent).toContain('权限请求');
    expect(rendered.textContent).toContain('权限处理失败，请重试。');
  });

  it('dismisses stale prompts after a resolved-request conflict', async () => {
    const rendered = await renderLayout();
    listPendingMock.mockResolvedValueOnce([]);

    replyMock.mockRejectedValueOnce({
      message: 'Failed to reply permission request: 409',
      status: 409,
      error: 'Permission request already resolved',
      data: { error: 'Permission request already resolved' },
    });

    const approveButton = Array.from(rendered.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('同意本次'),
    );

    act(() => {
      approveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(rendered.textContent).not.toContain('权限请求');
  });
});
