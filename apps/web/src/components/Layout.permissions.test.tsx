// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Layout from './Layout.js';
import { useAuthStore } from '../stores/auth.js';

const replyMock = vi.fn(async () => undefined);
const listPendingMock = vi.fn(async () => [
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

vi.mock('@openAwork/web-client', () => ({
  createSessionsClient: vi.fn(() => ({
    list: vi.fn(async () => []),
    create: vi.fn(async () => ({ id: 'new-session' })),
    get: vi.fn(async () => ({ messages: [] })),
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
});
