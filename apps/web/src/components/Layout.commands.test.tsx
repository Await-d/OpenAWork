// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Layout from './Layout.js';
import { preloadRouteModuleByPath } from '../routes/preloadable-route-modules.js';
import { useAuthStore } from '../stores/auth.js';

vi.mock('../routes/preloadable-route-modules.js', () => ({
  preloadRouteModuleByPath: vi.fn(() => null),
}));

const listMock = vi.fn(async () => []);
const listCommandsMock = vi.fn(async () => [
  {
    id: 'remote-chat',
    label: '远端新建对话',
    description: '来自服务端命令源',
    shortcut: 'C',
    contexts: ['palette'],
    execution: 'client',
    action: { kind: 'navigate', to: '/chat' },
  },
]);
const listPendingMock = vi.fn(async () => []);
const replyMock = vi.fn(async () => undefined);

vi.mock('@openAwork/web-client', () => ({
  createSessionsClient: vi.fn(() => ({
    list: listMock,
    create: vi.fn(async () => ({ id: 'new-session' })),
    get: vi.fn(async () => ({ messages: [] })),
    rename: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
  })),
  createCommandsClient: vi.fn(() => ({
    list: listCommandsMock,
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
  listMock.mockClear();
  listCommandsMock.mockClear();
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

describe('Layout service-backed command palette', () => {
  it('shows command palette entries from the server-backed command registry', async () => {
    const rendered = await renderLayout();

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }),
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(rendered.textContent).toContain('远端新建对话');
    expect(rendered.textContent).toContain('来自服务端命令源');
  });

  it('preloads the route before executing a command palette navigation command', async () => {
    const rendered = await renderLayout();

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }),
      );
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const chatCommand = Array.from(rendered.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('远端新建对话'),
    );

    act(() => {
      chatCommand?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(preloadRouteModuleByPath).toHaveBeenCalledWith('/chat');
  });
});
