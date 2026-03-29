// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SessionsPage from './SessionsPage.js';
import * as ToastNotification from '../components/ToastNotification.js';
import { preloadRouteModuleByPath } from '../routes/preloadable-route-modules.js';
import { useAuthStore } from '../stores/auth.js';
import { useUIStateStore } from '../stores/uiState.js';
import { requestSessionListRefresh } from '../utils/session-list-events.js';

vi.mock('../routes/preloadable-route-modules.js', () => ({
  preloadRouteModuleByPath: vi.fn(() => null),
}));

const listMock = vi.fn(async () => [
  {
    id: 'session-1',
    title: '代码评审',
    state_status: 'running',
    updated_at: '2026-03-22T10:00:00.000Z',
    metadata_json: JSON.stringify({
      workingDirectory: '/repo/project',
      dialogueMode: 'coding',
      yoloMode: true,
      modelId: 'claude-sonnet-4',
    }),
  },
]);

const createMock = vi.fn(async () => ({ id: 'session-new' }));
const getMock = vi.fn(async () => ({ messages: [] }));
const deleteMock = vi.fn(async () => undefined);

vi.mock('@openAwork/web-client', () => ({
  createSessionsClient: vi.fn(() => ({
    list: listMock,
    create: createMock,
    get: getMock,
    delete: deleteMock,
    rename: vi.fn(async () => undefined),
    importSession: vi.fn(async () => ({ sessionId: 'imported' })),
  })),
  withTokenRefresh: vi.fn(
    async (_gatewayUrl: string, _store: unknown, fn: (token: string) => Promise<unknown>) =>
      fn('token-123'),
  ),
  HttpError: class HttpError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

vi.mock('../components/WorkspacePickerModal.js', () => ({
  default: ({
    isOpen,
    onSelect,
  }: {
    isOpen: boolean;
    onSelect: (path: string) => void | Promise<void>;
  }) =>
    isOpen ? (
      <button
        type="button"
        onClick={() => {
          void onSelect('/repo/project');
        }}
      >
        选择测试工作区
      </button>
    ) : null,
}));

vi.mock('../utils/session-transfer.js', () => ({
  exportSession: vi.fn(),
  importSession: vi.fn(),
}));

const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
  const rawUrl =
    typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const url = new URL(rawUrl, 'http://localhost:3000');
  if (url.pathname.endsWith('/settings/providers')) {
    return {
      ok: true,
      json: async () => ({
        providers: [
          {
            id: 'openai',
            name: 'OpenAI',
            type: 'openai',
            enabled: true,
            defaultModels: [
              {
                id: 'gpt-5',
                label: 'GPT-5',
                enabled: true,
                supportsThinking: true,
              },
            ],
          },
        ],
        activeSelection: {
          chat: { providerId: 'openai', modelId: 'gpt-5' },
          fast: { providerId: 'openai', modelId: 'gpt-5' },
        },
        defaultThinking: {
          chat: { enabled: true, effort: 'high' },
          fast: { enabled: false, effort: 'medium' },
        },
      }),
    } as Response;
  }
  if (url.pathname.endsWith('/workspace/review/status')) {
    return {
      ok: true,
      json: async () => ({
        changes: [
          {
            path: 'src/app.ts',
            status: 'modified',
            linesAdded: 8,
            linesDeleted: 2,
          },
        ],
      }),
    } as Response;
  }
  if (url.pathname.endsWith('/workspace/review/diff')) {
    return {
      ok: true,
      json: async () => ({ diff: '@@\n-old\n+new\n' }),
    } as Response;
  }
  if (url.pathname.endsWith('/workspace/review/revert') && init?.method === 'POST') {
    return {
      ok: true,
      json: async () => ({ ok: true }),
    } as Response;
  }
  throw new Error(`Unhandled fetch: ${url.pathname}`);
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.stubGlobal('fetch', fetchMock);
  listMock.mockClear();
  createMock.mockClear();
  deleteMock.mockClear();
  fetchMock.mockClear();
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
    savedWorkspacePaths: [],
    selectedWorkspacePath: null,
    fileTreeRootPath: null,
    activeSessionWorkspace: null,
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

async function renderSessionsPage() {
  await act(async () => {
    root!.render(
      <MemoryRouter initialEntries={['/sessions']}>
        <Routes>
          <Route path="/sessions" element={<SessionsPage />} />
          <Route path="/chat/:sessionId" element={<div>chat route</div>} />
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

describe('SessionsPage file review integration', () => {
  it('renders a CSS-driven running indicator for active sessions', async () => {
    const rendered = await renderSessionsPage();

    const runningIndicator = rendered.querySelector(
      '[data-session-id="session-1"] [data-session-running="true"]',
    );

    expect(runningIndicator).not.toBeNull();
    expect(runningIndicator?.className).toContain('omo-session-running-dot');
  });

  it('shows a file change review section for sessions with workingDirectory metadata', async () => {
    const rendered = await renderSessionsPage();

    const cardButton = Array.from(rendered.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('代码评审'),
    );

    act(() => {
      cardButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(rendered.textContent).toContain('文件改动审阅');
    expect(rendered.textContent).toContain('src/app.ts');
    expect(rendered.textContent).toContain('查看差异');
    expect(rendered.textContent).toContain('还原');
    expect(rendered.textContent).toContain('编程');
    expect(rendered.textContent).toContain('YOLO');
    expect(rendered.textContent).toContain('Claude Sonnet 4');
  });

  it('selects a session when clicking the empty area of the card', async () => {
    const rendered = await renderSessionsPage();
    const sessionCard = rendered.querySelector('[data-session-id="session-1"]');

    act(() => {
      sessionCard?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(rendered.textContent).toContain('文件改动审阅');
    expect(rendered.textContent).toContain('代码评审');
  });

  it('preloads the chat route before opening the selected session', async () => {
    const rendered = await renderSessionsPage();
    const sessionCard = rendered.querySelector('[data-session-id="session-1"]');

    act(() => {
      sessionCard?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const openChatButton = Array.from(rendered.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '打开对话',
    );

    act(() => {
      openChatButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(preloadRouteModuleByPath).toHaveBeenCalledWith('/chat/session-1');
  });

  it('refreshes sessions when the shared refresh event fires', async () => {
    listMock
      .mockResolvedValueOnce([
        {
          id: 'session-1',
          title: '先创建的会话',
          state_status: 'idle',
          updated_at: '2026-03-22T08:00:00.000Z',
          metadata_json: '',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'session-2',
          title: '刚刚活跃的会话',
          state_status: 'running',
          updated_at: '2026-03-22T12:00:00.000Z',
          metadata_json: '',
        },
      ]);

    const rendered = await renderSessionsPage();
    expect(rendered.textContent).toContain('先创建的会话');

    act(() => {
      requestSessionListRefresh();
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(rendered.textContent).toContain('刚刚活跃的会话');
  });

  it('keeps saved workspaces visible when there are no sessions', async () => {
    listMock.mockResolvedValueOnce([]);
    useUIStateStore.setState({
      savedWorkspacePaths: ['/repo/project'],
      selectedWorkspacePath: '/repo/project',
      fileTreeRootPath: '/repo/project',
    });

    const rendered = await renderSessionsPage();

    expect(rendered.textContent).toContain('project');
    expect(rendered.textContent).toContain('/repo/project');
    expect(rendered.textContent).toContain('暂无会话，可在此工作区中新建一个会话。');
    expect(rendered.textContent).not.toContain('还没有会话');
  });

  it('persists the workspace path when creating a workspace-backed session', async () => {
    const rendered = await renderSessionsPage();

    const workspaceCreateButton = rendered.querySelector('button[title="选择工作区后新建会话"]');

    act(() => {
      workspaceCreateButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
    });

    const selectWorkspaceButton = Array.from(rendered.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('选择测试工作区'),
    );

    act(() => {
      selectWorkspaceButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(createMock).toHaveBeenCalledWith('token-123', {
      metadata: {
        modelId: 'gpt-5',
        providerId: 'openai',
        reasoningEffort: 'high',
        thinkingEnabled: true,
        workingDirectory: '/repo/project',
      },
    });
    expect(useUIStateStore.getState().savedWorkspacePaths).toContain('/repo/project');
  });

  it('keeps the workspace group visible after deleting its last session', async () => {
    useUIStateStore.setState({
      savedWorkspacePaths: ['/repo/project'],
      selectedWorkspacePath: '/repo/project',
      fileTreeRootPath: '/repo/project',
    });

    const rendered = await renderSessionsPage();

    const sessionTitleButton = Array.from(rendered.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('代码评审'),
    );
    const sessionCard = sessionTitleButton?.closest('li');

    act(() => {
      sessionCard?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
    });

    const deleteButton = Array.from(rendered.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '删除',
    );

    act(() => {
      deleteButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(deleteMock).toHaveBeenCalledWith('token-123', 'session-1');
    expect(rendered.textContent).toContain('project');
    expect(rendered.textContent).toContain('暂无会话，可在此工作区中新建一个会话。');
    expect(rendered.textContent).not.toContain('还没有会话');
    expect(useUIStateStore.getState().savedWorkspacePaths).toContain('/repo/project');
  });

  it('deletes all sessions in a workspace from the workspace header context menu', async () => {
    listMock.mockResolvedValueOnce([
      {
        id: 'session-1',
        title: '代码评审',
        state_status: 'running',
        updated_at: '2026-03-22T10:00:00.000Z',
        metadata_json: JSON.stringify({ workingDirectory: '/repo/project' }),
      },
      {
        id: 'session-2',
        title: '实现细节',
        state_status: 'idle',
        updated_at: '2026-03-22T09:00:00.000Z',
        metadata_json: JSON.stringify({ workingDirectory: '/repo/project' }),
      },
    ]);
    useUIStateStore.setState({
      savedWorkspacePaths: ['/repo/project'],
      selectedWorkspacePath: '/repo/project',
      fileTreeRootPath: '/repo/project',
    });
    const toastSpy = vi.spyOn(ToastNotification, 'toast').mockImplementation(() => undefined);

    const rendered = await renderSessionsPage();
    const workspaceHeader = Array.from(rendered.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('project'),
    );

    act(() => {
      workspaceHeader?.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, clientX: 120, clientY: 180 }),
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    const deleteWorkspaceButton = Array.from(rendered.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '删除工作区及 2 个会话',
    );

    act(() => {
      deleteWorkspaceButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
    });

    const confirmDeleteButton = Array.from(rendered.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '确认删除全部',
    );

    act(() => {
      confirmDeleteButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(deleteMock).toHaveBeenCalledWith('token-123', 'session-1');
    expect(deleteMock).toHaveBeenCalledWith('token-123', 'session-2');
    expect(useUIStateStore.getState().savedWorkspacePaths).toEqual([]);
    expect(useUIStateStore.getState().selectedWorkspacePath).toBeNull();
    expect(useUIStateStore.getState().fileTreeRootPath).toBeNull();
    expect(toastSpy).toHaveBeenCalledWith('已删除工作区「project」及 2 个会话', 'success');
  });

  it('keeps the workspace header visible while search hides its sessions, so the whole workspace can still be deleted', async () => {
    useUIStateStore.setState({
      savedWorkspacePaths: ['/repo/project'],
      selectedWorkspacePath: '/repo/project',
      fileTreeRootPath: '/repo/project',
    });
    const toastSpy = vi.spyOn(ToastNotification, 'toast').mockImplementation(() => undefined);

    const rendered = await renderSessionsPage();
    const searchInput = rendered.querySelector(
      'input[placeholder="搜索会话…"]',
    ) as HTMLInputElement | null;

    act(() => {
      if (searchInput) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
          searchInput,
          '未命中',
        );
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(rendered.textContent).toContain('project');
    expect(rendered.textContent).toContain('当前筛选条件下暂无匹配会话。');

    const workspaceHeader = Array.from(rendered.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('project'),
    );

    act(() => {
      workspaceHeader?.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, clientX: 120, clientY: 180 }),
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    const deleteWorkspaceButton = Array.from(rendered.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '删除工作区及 1 个会话',
    );

    act(() => {
      deleteWorkspaceButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
    });

    const confirmDeleteButton = Array.from(rendered.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '确认删除全部',
    );

    act(() => {
      confirmDeleteButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(deleteMock).toHaveBeenCalledWith('token-123', 'session-1');
    expect(useUIStateStore.getState().savedWorkspacePaths).toEqual([]);
    expect(toastSpy).toHaveBeenCalledWith('已删除工作区「project」及 1 个会话', 'success');
  });

  it('allows deleting all sessions from the unbound workspace group', async () => {
    listMock.mockResolvedValueOnce([
      {
        id: 'session-unbound-1',
        title: '独立对话',
        state_status: 'idle',
        updated_at: '2026-03-22T10:00:00.000Z',
        metadata_json: '',
      },
    ]);
    const toastSpy = vi.spyOn(ToastNotification, 'toast').mockImplementation(() => undefined);
    const removeWorkspaceSpy = vi.spyOn(useUIStateStore.getState(), 'removeSavedWorkspacePath');

    const rendered = await renderSessionsPage();
    const workspaceHeader = Array.from(rendered.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('未绑定工作区'),
    );

    act(() => {
      workspaceHeader?.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, clientX: 120, clientY: 180 }),
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    const deleteWorkspaceButton = Array.from(rendered.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '删除未绑定会话（1 个）',
    );

    act(() => {
      deleteWorkspaceButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
    });

    const confirmDeleteButton = Array.from(rendered.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '确认删除全部',
    );

    act(() => {
      confirmDeleteButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(deleteMock).toHaveBeenCalledWith('token-123', 'session-unbound-1');
    expect(removeWorkspaceSpy).not.toHaveBeenCalled();
    expect(toastSpy).toHaveBeenCalledWith('已删除未绑定工作区中的 1 个会话', 'success');
  });

  it('does not delete workspace sessions when the workspace delete dialog is cancelled', async () => {
    useUIStateStore.setState({
      savedWorkspacePaths: ['/repo/project'],
      selectedWorkspacePath: '/repo/project',
      fileTreeRootPath: '/repo/project',
    });
    const rendered = await renderSessionsPage();
    const workspaceHeader = Array.from(rendered.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('project'),
    );

    act(() => {
      workspaceHeader?.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, clientX: 120, clientY: 180 }),
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    const deleteWorkspaceButton = Array.from(rendered.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '删除工作区及 1 个会话',
    );

    act(() => {
      deleteWorkspaceButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
    });

    const cancelButton = Array.from(rendered.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '取消',
    );

    act(() => {
      cancelButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(deleteMock).not.toHaveBeenCalled();
    expect(useUIStateStore.getState().savedWorkspacePaths).toEqual(['/repo/project']);
  });

  it('treats a 404 delete response as already deleted and removes the session from the list', async () => {
    const { HttpError } = await import('@openAwork/web-client');
    deleteMock.mockRejectedValueOnce(new HttpError('Failed to delete session: 404', 404));

    const rendered = await renderSessionsPage();
    const sessionTitleButton = Array.from(rendered.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('代码评审'),
    );
    const sessionCard = sessionTitleButton?.closest('li');

    act(() => {
      sessionCard?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
    });

    const deleteButton = Array.from(rendered.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '删除',
    );

    act(() => {
      deleteButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(deleteMock).toHaveBeenCalledWith('token-123', 'session-1');
    expect(rendered.textContent).not.toContain('代码评审');
  });

  it('ignores repeated delete clicks while the same session delete is in flight', async () => {
    let resolveDelete: (() => void) | null = null;
    deleteMock.mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          resolveDelete = () => resolve(undefined);
        }),
    );

    const rendered = await renderSessionsPage();
    const sessionTitleButton = Array.from(rendered.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('代码评审'),
    );
    const sessionCard = sessionTitleButton?.closest('li');

    act(() => {
      sessionCard?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
    });

    const deleteButton = Array.from(rendered.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '删除',
    ) as HTMLButtonElement | undefined;

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

  it('keeps actions visible on the next session when deleting a hovered session', async () => {
    listMock.mockResolvedValueOnce([
      {
        id: 'session-1',
        title: '第一个会话',
        state_status: 'running',
        updated_at: '2026-03-22T10:00:00.000Z',
        metadata_json: '',
      },
      {
        id: 'session-2',
        title: '第二个会话',
        state_status: 'idle',
        updated_at: '2026-03-22T09:00:00.000Z',
        metadata_json: '',
      },
    ]);

    const rendered = await renderSessionsPage();
    const firstCard = rendered.querySelector('[data-session-id="session-1"]');
    const secondCard = rendered.querySelector('[data-session-id="session-2"]');

    expect(firstCard).not.toBeNull();
    expect(secondCard).not.toBeNull();

    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => secondCard),
    });

    act(() => {
      firstCard?.dispatchEvent(
        new MouseEvent('mouseover', { bubbles: true, clientX: 16, clientY: 24 }),
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    const activeDeleteButtonBefore = Array.from(rendered.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '删除' && button.tabIndex === 0,
    );

    act(() => {
      activeDeleteButtonBefore?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(deleteMock).toHaveBeenCalledWith('token-123', 'session-1');
    expect(rendered.textContent).not.toContain('第一个会话');
    expect(rendered.textContent).toContain('第二个会话');

    const activeDeleteButtonAfter = Array.from(rendered.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '删除' && button.tabIndex === 0,
    );

    expect(activeDeleteButtonAfter).toBeDefined();
  });
});
