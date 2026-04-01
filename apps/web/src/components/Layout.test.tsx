// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Layout from './Layout.js';
import { preloadRouteModuleByPath } from '../routes/preloadable-route-modules.js';
import { useAuthStore } from '../stores/auth.js';
import { useUIStateStore } from '../stores/uiState.js';
import { logger } from '../utils/logger.js';
import { publishSessionPendingPermission } from '../utils/session-list-events.js';

vi.mock('../routes/preloadable-route-modules.js', () => ({
  preloadRouteModuleByPath: vi.fn(() => null),
}));

const listMock = vi.fn(async () => [
  {
    id: 'session-1',
    title: '设计讨论',
    updated_at: '2026-03-21T10:00:00.000Z',
    metadata_json: JSON.stringify({ workingDirectory: '/repo/alpha' }),
  },
]);
const getMock = vi.fn(async () => ({ messages: [{ id: 'm1', role: 'user', content: 'hello' }] }));
const renameMock = vi.fn(async () => undefined);
const deleteMock = vi.fn(async () => undefined);
const listPendingPermissionsMock = vi.fn(async () => []);
const replyPermissionMock = vi.fn(async () => undefined);
const listCommandsMock = vi.fn(async () => [
  {
    id: 'nav-chat',
    label: '新建对话',
    description: '前往 Chat 页面',
    shortcut: 'C',
    contexts: ['palette'],
    execution: 'client',
    action: { kind: 'navigate', to: '/chat' },
  },
  {
    id: 'nav-sessions',
    label: '会话列表',
    description: '查看所有会话',
    shortcut: 'S',
    contexts: ['palette'],
    execution: 'client',
    action: { kind: 'navigate', to: '/sessions' },
  },
  {
    id: 'nav-settings',
    label: '设置',
    shortcut: ',',
    contexts: ['palette'],
    execution: 'client',
    action: { kind: 'navigate', to: '/settings' },
  },
]);

vi.mock('@openAwork/web-client', () => ({
  createSessionsClient: vi.fn(() => ({
    list: listMock,
    create: vi.fn(async () => ({ id: 'new-session' })),
    get: getMock,
    rename: renameMock,
    delete: deleteMock,
  })),
  createCommandsClient: vi.fn(() => ({
    list: listCommandsMock,
  })),
  createPermissionsClient: vi.fn(() => ({
    listPending: listPendingPermissionsMock,
    reply: replyPermissionMock,
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
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  listMock.mockClear();
  listCommandsMock.mockClear();
  getMock.mockClear();
  renameMock.mockClear();
  deleteMock.mockClear();
  listPendingPermissionsMock.mockClear();
  replyPermissionMock.mockClear();
  useAuthStore.setState({
    accessToken: 'token-123',
    refreshToken: null,
    tokenExpiresAt: Date.now() + 60_000,
    email: 'admin@openAwork.local',
    gatewayUrl: 'http://localhost:3000',
    webAccessEnabled: false,
    webPort: 3000,
  });
  useUIStateStore.setState({
    leftSidebarOpen: true,
    sidebarTab: 'sessions',
    chatView: 'home',
    lastChatPath: null,
    pinnedSessions: [],
    expandedDirs: [],
    fileTreeRootPath: null,
    workspaceTreeVersion: 0,
    savedWorkspacePaths: [],
    selectedWorkspacePath: null,
    activeSessionWorkspace: null,
    editorMode: false,
    splitPos: 50,
    openFilePaths: [],
    activeFilePath: null,
  });
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
  vi.unstubAllGlobals();
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

async function renderLayoutWithRoutes(initialEntry = '/settings') {
  await act(async () => {
    root!.render(
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route element={<Layout />}>
            <Route
              path="/settings"
              element={<div data-testid="settings-route">settings page</div>}
            />
            <Route
              path="/chat/:sessionId?"
              element={<div data-testid="chat-route">chat session route</div>}
            />
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

describe('Layout sidebar session quick actions', () => {
  it('loads pending permissions for the active chat session on initial render', async () => {
    await renderLayout();

    expect(listPendingPermissionsMock).toHaveBeenCalledWith(
      'token-123',
      'session-1',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('replies to the target child session when the parent surfaces a child permission request', async () => {
    await renderLayout();

    act(() => {
      publishSessionPendingPermission('session-1', {
        requestId: 'req-child',
        targetSessionId: 'child-1',
        toolName: 'bash',
        scope: 'workspace:/repo',
        reason: '执行命令',
        riskLevel: 'high',
      });
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const approveButton = Array.from(container!.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('同意本次'),
    );
    expect(approveButton).toBeTruthy();

    await act(async () => {
      approveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(replyPermissionMock).toHaveBeenCalledWith('token-123', 'child-1', {
      decision: 'once',
      requestId: 'req-child',
    });
  });

  it('renders the top bar at 44px height', async () => {
    const rendered = await renderLayoutWithRoutes('/settings');

    const topbar = rendered.querySelector('[data-testid="layout-topbar"]');
    expect(topbar).not.toBeNull();
    expect((topbar as HTMLDivElement).style.height).toBe('44px');
  });

  it('shows quick action buttons for a session item', async () => {
    const rendered = await renderLayout();

    expect(rendered.querySelector('button[title="重命名"]')).not.toBeNull();
    expect(rendered.querySelector('button[title="导出"]')).not.toBeNull();
    expect(rendered.querySelector('button[title="删除"]')).not.toBeNull();
  });

  it('renames and deletes a session from the sidebar quick actions', async () => {
    const rendered = await renderLayout();

    const renameButton = rendered.querySelector('button[title="重命名"]');
    act(() => {
      renameButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const input = Array.from(rendered.querySelectorAll('input')).find(
      (field) => field.getAttribute('placeholder') !== '搜索会话…',
    ) as HTMLInputElement | undefined;
    expect(input).toBeDefined();
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, '新的会话名');
      input?.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    act(() => {
      input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(renameMock).toHaveBeenCalledWith('token-123', 'session-1', '新的会话名');

    const deleteButton = rendered.querySelector('button[title="删除"]');
    act(() => {
      deleteButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(deleteMock).toHaveBeenCalledWith('token-123', 'session-1');
  });

  it('ignores repeated delete clicks while the same session deletion is in flight', async () => {
    let resolveDelete: (() => void) | null = null;
    deleteMock.mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          resolveDelete = () => resolve(undefined);
        }),
    );

    const rendered = await renderLayoutWithRoutes('/chat/session-1');
    const deleteButton = rendered.querySelector('button[title="删除"]') as HTMLButtonElement | null;

    act(() => {
      deleteButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      deleteButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(deleteMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveDelete?.();
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  it('treats a 404 delete response as already deleted in the sidebar flow', async () => {
    const { HttpError } = await import('@openAwork/web-client');
    deleteMock.mockRejectedValueOnce(new HttpError('Failed to delete session: 404', 404));
    const loggerErrorSpy = vi.spyOn(logger, 'error');

    const rendered = await renderLayoutWithRoutes('/chat/session-1');
    const deleteButton = rendered.querySelector('button[title="删除"]') as HTMLButtonElement | null;

    act(() => {
      deleteButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(deleteMock).toHaveBeenCalledWith('token-123', 'session-1');
    expect(loggerErrorSpy).not.toHaveBeenCalled();
  });

  it('stores a workspace selected from the sidebar picker', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const rawUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(rawUrl, 'http://localhost:3000');

      if (url.pathname === '/workspace/root') {
        return {
          ok: true,
          json: async () => ({ root: '/repo', roots: ['/repo', '/repo-b'] }),
        } as Response;
      }

      if (url.pathname === '/workspace/tree') {
        return {
          ok: true,
          json: async () => ({
            nodes: [{ path: '/repo/apps', name: 'apps', type: 'directory' }],
          }),
        } as Response;
      }

      if (url.pathname === '/workspace/validate') {
        return { ok: true, json: async () => ({ valid: true, path: '/repo' }) } as Response;
      }

      if (url.pathname === '/workspace/review/status') {
        return { ok: true, json: async () => ({ changes: [] }) } as Response;
      }

      throw new Error(`Unhandled fetch path: ${url.pathname}${url.search}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    const rendered = await renderLayout();
    const openWorkspaceButton = rendered.querySelector(
      'button[title="选择工作区后新建会话"]',
    ) as HTMLButtonElement | null;

    expect(openWorkspaceButton).not.toBeNull();

    act(() => {
      openWorkspaceButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const selectCurrent = Array.from(rendered.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '选择当前文件夹',
    );

    act(() => {
      selectCurrent?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(useUIStateStore.getState().savedWorkspacePaths).toEqual(['/repo']);
    expect(useUIStateStore.getState().selectedWorkspacePath).toBe('/repo');
    expect(useUIStateStore.getState().fileTreeRootPath).toBe('/repo');
    expect(
      fetchMock.mock.calls.some(([input]) => {
        const rawUrl =
          typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        return rawUrl.includes('/sessions/session-1/workspace');
      }),
    ).toBe(false);
  });

  it('restores the last chat session when returning from another page', async () => {
    useUIStateStore.setState({ lastChatPath: '/chat/session-1' });

    const rendered = await renderLayoutWithRoutes('/settings');
    const chatLink = Array.from(rendered.querySelectorAll('a')).find(
      (link) => link.textContent?.trim() === '对话',
    ) as HTMLAnchorElement | undefined;

    expect(rendered.querySelector('[data-testid="settings-route"]')).not.toBeNull();
    expect(chatLink?.getAttribute('href')).toBe('/chat/session-1');

    act(() => {
      chatLink?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }),
      );
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(rendered.querySelector('[data-testid="chat-route"]')).not.toBeNull();
  });

  it('preloads the settings route before the keyboard shortcut navigation', async () => {
    await renderLayoutWithRoutes('/chat/session-1');

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: ',', ctrlKey: true, bubbles: true }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(preloadRouteModuleByPath).toHaveBeenCalledWith('/settings');
  });
});
