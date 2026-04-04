// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionSidebar } from './SessionSidebar.js';
import * as ToastNotification from '../ToastNotification.js';
import { preloadRouteModuleByPath } from '../../routes/preloadable-route-modules.js';
import { useAuthStore } from '../../stores/auth.js';
import { useUIStateStore } from '../../stores/uiState.js';
import type { FileTreeNode } from '../WorkspacePickerModal.js';
import { buildWorkspaceSessionCollections } from '../../utils/session-grouping.js';

vi.mock('../../routes/preloadable-route-modules.js', () => ({
  preloadRouteModuleByPath: vi.fn(() => null),
}));

const useSessionsMockState = {
  sessions: [] as Array<{
    id: string;
    state_status?: 'idle' | 'running' | 'paused';
    title: string | null;
    updated_at: string;
    metadata_json?: string;
  }>,
  groupedSessions: [] as Array<{
    workspacePath: string | null;
    workspaceLabel: string;
    sessions: Array<{
      id: string;
      state_status?: 'idle' | 'running' | 'paused';
      title: string | null;
      updated_at: string;
      metadata_json?: string;
    }>;
  }>,
  get groupedSessionTrees() {
    return this.groupedSessions.map((group) => ({
      ...group,
      roots: group.sessions.map((session) => ({ session, children: [] })),
    }));
  },
  get sessionCountByWorkspace() {
    return buildWorkspaceSessionCollections(this.sessions).sessionCountByWorkspace;
  },
  get workspaceSessionIdsByGroupKey() {
    return buildWorkspaceSessionCollections(this.sessions).sessionIdsByGroupKey;
  },
  renamingSessionId: null as string | null,
  renameValue: '',
  setRenameValue: vi.fn(),
  hoveredSessionId: null as string | null,
  setHoveredSessionId: vi.fn(),
  isDeletingSession: vi.fn(() => false),
  collapsedGroups: new Set<string>(),
  toggleGroupCollapsed: vi.fn(),
  sessionSearch: '',
  setSessionSearch: vi.fn(),
  newSession: vi.fn(async () => undefined),
  startRename: vi.fn(),
  commitRename: vi.fn(async () => undefined),
  quickDeleteSession: vi.fn(async (_sessionId?: string) => true),
  quickExportSession: vi.fn(async () => undefined),
  exportSessionAsMarkdown: vi.fn(async () => undefined),
  exportSessionAsJson: vi.fn(async () => undefined),
};

vi.mock('../../hooks/useSessions.js', () => ({
  useSessions: () => useSessionsMockState,
}));

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function flushEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;

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

  useSessionsMockState.sessions = [];
  useSessionsMockState.groupedSessions = [];
  useSessionsMockState.renamingSessionId = null;
  useSessionsMockState.renameValue = '';
  useSessionsMockState.hoveredSessionId = null;
  useSessionsMockState.collapsedGroups = new Set<string>();
  useSessionsMockState.sessionSearch = '';
  useSessionsMockState.setRenameValue.mockReset();
  useSessionsMockState.setHoveredSessionId.mockReset();
  useSessionsMockState.isDeletingSession.mockReset();
  useSessionsMockState.isDeletingSession.mockReturnValue(false);
  useSessionsMockState.toggleGroupCollapsed.mockReset();
  useSessionsMockState.setSessionSearch.mockReset();
  useSessionsMockState.newSession.mockReset();
  useSessionsMockState.startRename.mockReset();
  useSessionsMockState.commitRename.mockReset();
  useSessionsMockState.quickDeleteSession.mockReset();
  useSessionsMockState.quickDeleteSession.mockImplementation(async (_sessionId?: string) => true);
  useSessionsMockState.quickExportSession.mockReset();
  useSessionsMockState.exportSessionAsMarkdown.mockReset();
  useSessionsMockState.exportSessionAsJson.mockReset();

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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT;
});

describe('SessionSidebar file tree actions', () => {
  it('supports refreshing and creating entries from the file tree', async () => {
    useUIStateStore.setState({
      selectedWorkspacePath: '/repo',
      fileTreeRootPath: '/repo',
    });

    const fetchRootPath = vi.fn(async () => '/repo');
    const fetchTree = vi.fn(async (path: string): Promise<FileTreeNode[]> => {
      if (path === '/repo') {
        return [
          { path: '/repo/src', name: 'src', type: 'directory' },
          { path: '/repo/README.md', name: 'README.md', type: 'file' },
        ];
      }

      if (path === '/repo/src') {
        return [{ path: '/repo/src/index.ts', name: 'index.ts', type: 'file' }];
      }

      return [];
    });
    const onOpenFile = vi.fn();

    const networkMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const rawUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(rawUrl, 'http://localhost:3000');

      if (url.pathname === '/workspace/file' && init?.method === 'POST') {
        return {
          ok: true,
          json: async () => ({ success: true, path: '/repo/src/notes.md' }),
        } as Response;
      }

      if (url.pathname === '/workspace/directory' && init?.method === 'POST') {
        return {
          ok: true,
          json: async () => ({ success: true, path: '/repo/guides' }),
        } as Response;
      }

      throw new Error(`Unhandled request: ${url.pathname}`);
    });

    const promptMock = vi.fn().mockReturnValueOnce('notes.md').mockReturnValueOnce('guides');

    vi.stubGlobal('fetch', networkMock);
    vi.stubGlobal('prompt', promptMock);
    vi.stubGlobal('alert', vi.fn());

    await act(async () => {
      root!.render(
        <MemoryRouter>
          <SessionSidebar
            onOpenFile={onOpenFile}
            fetchRootPath={fetchRootPath}
            fetchTree={fetchTree}
            onOpenWorkspacePicker={() => undefined}
          />
        </MemoryRouter>,
      );
    });

    const filesTab = Array.from(container!.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('文件树'),
    );
    act(() => {
      filesTab?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushEffects();

    expect(fetchRootPath).not.toHaveBeenCalled();
    expect(fetchTree).toHaveBeenCalledWith('/repo', 1);
    expect(container?.textContent).toContain('/repo');

    const refreshButton = container?.querySelector('button[title="刷新目录"]');
    const refreshCallsBefore = fetchTree.mock.calls.length;
    act(() => {
      refreshButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushEffects();
    expect(fetchTree.mock.calls.length).toBeGreaterThan(refreshCallsBefore);

    const directoryButton = Array.from(container!.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'src',
    );
    act(() => {
      directoryButton?.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, clientX: 80, clientY: 120 }),
      );
    });
    await flushEffects();

    const createFileButton = Array.from(container!.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('在src中新建文件'),
    );
    act(() => {
      createFileButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushEffects();

    expect(networkMock).toHaveBeenCalledWith(
      'http://localhost:3000/workspace/file',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ path: '/repo/src/notes.md', content: '' }),
      }),
    );
    expect(fetchTree).toHaveBeenCalledWith('/repo/src', 1);
    expect(onOpenFile).toHaveBeenCalledWith('/repo/src/notes.md');

    const fileButton = Array.from(container!.querySelectorAll('button')).find((button) =>
      button.textContent?.trim().endsWith('README.md'),
    );
    act(() => {
      fileButton?.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, clientX: 90, clientY: 140 }),
      );
    });
    await flushEffects();

    expect(container?.textContent).toContain('在README.md 所在目录中新建文件夹');

    const createFolderButton = container?.querySelector('button[title="在根目录新建文件夹"]');
    act(() => {
      createFolderButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushEffects();

    expect(networkMock).toHaveBeenCalledWith(
      'http://localhost:3000/workspace/directory',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ path: '/repo/guides' }),
      }),
    );
    expect(promptMock).toHaveBeenCalledTimes(2);
  });

  it('keeps the file tree empty until a workspace is selected', async () => {
    const fetchRootPath = vi.fn(async () => '/repo');
    const fetchTree = vi.fn(async () => [] as FileTreeNode[]);

    await act(async () => {
      root!.render(
        <MemoryRouter>
          <SessionSidebar
            fetchRootPath={fetchRootPath}
            fetchTree={fetchTree}
            onOpenWorkspacePicker={() => undefined}
          />
        </MemoryRouter>,
      );
    });

    const filesTab = Array.from(container!.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('文件树'),
    );
    act(() => {
      filesTab?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await flushEffects();

    expect(fetchRootPath).not.toHaveBeenCalled();
    expect(fetchTree).not.toHaveBeenCalled();
    expect(container?.textContent).toContain('请先选择工作区，文件树才会显示对应目录内容');
    expect(container?.textContent).toContain('尚未选择工作区');
  });

  it('keeps empty saved workspaces visible and allows manual deletion', async () => {
    useUIStateStore.setState({
      savedWorkspacePaths: ['/repo/empty'],
      selectedWorkspacePath: '/repo/empty',
      fileTreeRootPath: '/repo/empty',
    });
    useSessionsMockState.groupedSessions = [
      {
        workspacePath: '/repo/empty',
        workspaceLabel: 'empty',
        sessions: [],
      },
    ];

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ changes: [] }),
      })),
    );

    await act(async () => {
      root!.render(
        <MemoryRouter>
          <SessionSidebar
            fetchRootPath={vi.fn(async () => '/repo')}
            fetchTree={vi.fn(async () => [])}
            onOpenWorkspacePicker={() => undefined}
          />
        </MemoryRouter>,
      );
    });

    await flushEffects();

    expect(container?.textContent).toContain('暂无会话，可在此工作区中新建一个会话。');
    expect((container?.textContent?.match(/暂无会话/g) ?? []).length).toBe(1);
    const toastSpy = vi.spyOn(ToastNotification, 'toast').mockImplementation(() => undefined);

    const workspaceButton = Array.from(container!.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('empty'),
    );

    act(() => {
      workspaceButton?.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, clientX: 120, clientY: 180 }),
      );
    });

    await flushEffects();

    const deleteWorkspaceButton = Array.from(container!.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '移除工作区 empty',
    );

    expect(deleteWorkspaceButton).toBeDefined();

    act(() => {
      deleteWorkspaceButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await flushEffects();

    expect(container?.textContent).toContain('确认移除这个工作区？');

    const confirmDeleteButton = Array.from(container!.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '确认移除工作区',
    );

    act(() => {
      confirmDeleteButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await flushEffects();

    expect(toastSpy).toHaveBeenCalledWith('已移除工作区「empty」', 'success');
    expect(useUIStateStore.getState().savedWorkspacePaths).toEqual([]);
    expect(useUIStateStore.getState().selectedWorkspacePath).toBeNull();
    expect(useUIStateStore.getState().fileTreeRootPath).toBeNull();
  });

  it('offers deleting a workspace header even when search hides its sessions and removes all sessions', async () => {
    useUIStateStore.setState({
      savedWorkspacePaths: ['/repo/alpha'],
      selectedWorkspacePath: '/repo/alpha',
      fileTreeRootPath: '/repo/alpha',
    });
    useSessionsMockState.sessions = [
      {
        id: 'session-1',
        title: '设计讨论',
        updated_at: '2026-03-21T10:00:00.000Z',
        metadata_json: JSON.stringify({ workingDirectory: '/repo/alpha' }),
      },
    ];
    useSessionsMockState.groupedSessions = [
      {
        workspacePath: '/repo/alpha',
        workspaceLabel: 'alpha',
        sessions: [],
      },
    ];
    useSessionsMockState.sessionSearch = '未命中';

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ changes: [] }),
      })),
    );

    await act(async () => {
      root!.render(
        <MemoryRouter>
          <SessionSidebar
            fetchRootPath={vi.fn(async () => '/repo')}
            fetchTree={vi.fn(async () => [])}
            onOpenWorkspacePicker={() => undefined}
          />
        </MemoryRouter>,
      );
    });

    await flushEffects();

    expect(container?.textContent).toContain('当前筛选条件下暂无匹配会话。');
    const toastSpy = vi.spyOn(ToastNotification, 'toast').mockImplementation(() => undefined);
    const removeWorkspaceSpy = vi.spyOn(useUIStateStore.getState(), 'removeSavedWorkspacePath');

    const workspaceButton = Array.from(container!.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('alpha'),
    );

    act(() => {
      workspaceButton?.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, clientX: 120, clientY: 180 }),
      );
    });

    await flushEffects();

    const deleteWorkspaceButton = Array.from(container!.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '删除工作区及 1 个会话',
    );

    expect(deleteWorkspaceButton).toBeDefined();

    act(() => {
      deleteWorkspaceButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container?.textContent).toContain('确认删除该工作区及其全部会话？');

    const confirmDeleteButton = Array.from(container!.querySelectorAll('button')).find(
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

    expect(useSessionsMockState.quickDeleteSession).toHaveBeenCalledWith('session-1', {
      suppressToast: true,
    });
    expect(removeWorkspaceSpy).toHaveBeenCalledWith('/repo/alpha');
    expect(toastSpy).toHaveBeenCalledWith('已删除工作区「alpha」及 1 个会话', 'success');
  });

  it('does not delete a workspace group when the confirmation is cancelled', async () => {
    useUIStateStore.setState({
      savedWorkspacePaths: ['/repo/alpha'],
      selectedWorkspacePath: '/repo/alpha',
      fileTreeRootPath: '/repo/alpha',
    });
    useSessionsMockState.sessions = [
      {
        id: 'session-1',
        title: '设计讨论',
        updated_at: '2026-03-21T10:00:00.000Z',
        metadata_json: JSON.stringify({ workingDirectory: '/repo/alpha' }),
      },
    ];
    useSessionsMockState.groupedSessions = [
      {
        workspacePath: '/repo/alpha',
        workspaceLabel: 'alpha',
        sessions: useSessionsMockState.sessions,
      },
    ];

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ changes: [] }),
      })),
    );
    const toastSpy = vi.spyOn(ToastNotification, 'toast').mockImplementation(() => undefined);

    await act(async () => {
      root!.render(
        <MemoryRouter>
          <SessionSidebar
            fetchRootPath={vi.fn(async () => '/repo')}
            fetchTree={vi.fn(async () => [])}
            onOpenWorkspacePicker={() => undefined}
          />
        </MemoryRouter>,
      );
    });

    await flushEffects();

    const workspaceButton = Array.from(container!.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('alpha'),
    );

    act(() => {
      workspaceButton?.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, clientX: 120, clientY: 180 }),
      );
    });

    await flushEffects();

    const deleteWorkspaceButton = Array.from(container!.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '删除工作区及 1 个会话',
    );

    act(() => {
      deleteWorkspaceButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await flushEffects();

    const cancelButton = Array.from(container!.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '取消',
    );

    act(() => {
      cancelButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await flushEffects();

    expect(useSessionsMockState.quickDeleteSession).not.toHaveBeenCalled();
    expect(toastSpy).not.toHaveBeenCalled();
    expect(useUIStateStore.getState().savedWorkspacePaths).toEqual(['/repo/alpha']);
  });

  it('keeps the workspace when bulk deletion only partially succeeds and shows a warning summary', async () => {
    useUIStateStore.setState({
      savedWorkspacePaths: ['/repo/project'],
      selectedWorkspacePath: '/repo/project',
      fileTreeRootPath: '/repo/project',
    });
    useSessionsMockState.sessions = [
      {
        id: 'session-1',
        title: '设计讨论',
        updated_at: '2026-03-21T10:00:00.000Z',
        metadata_json: JSON.stringify({ workingDirectory: '/repo/project' }),
      },
      {
        id: 'session-2',
        title: '实现细节',
        updated_at: '2026-03-21T09:00:00.000Z',
        metadata_json: JSON.stringify({ workingDirectory: '/repo/project' }),
      },
    ];
    useSessionsMockState.groupedSessions = [
      {
        workspacePath: '/repo/project',
        workspaceLabel: 'project',
        sessions: useSessionsMockState.sessions,
      },
    ];
    useSessionsMockState.quickDeleteSession
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ changes: [] }),
      })),
    );
    const toastSpy = vi.spyOn(ToastNotification, 'toast').mockImplementation(() => undefined);
    const removeWorkspaceSpy = vi.spyOn(useUIStateStore.getState(), 'removeSavedWorkspacePath');

    await act(async () => {
      root!.render(
        <MemoryRouter>
          <SessionSidebar
            fetchRootPath={vi.fn(async () => '/repo')}
            fetchTree={vi.fn(async () => [])}
            onOpenWorkspacePicker={() => undefined}
          />
        </MemoryRouter>,
      );
    });

    await flushEffects();

    const workspaceButton = Array.from(container!.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('project'),
    );

    act(() => {
      workspaceButton?.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, clientX: 120, clientY: 180 }),
      );
    });

    await flushEffects();

    const deleteWorkspaceButton = Array.from(container!.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '删除工作区及 2 个会话',
    );

    act(() => {
      deleteWorkspaceButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await flushEffects();

    const confirmDeleteButton = Array.from(container!.querySelectorAll('button')).find(
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

    expect(useSessionsMockState.quickDeleteSession).toHaveBeenCalledWith('session-1', {
      suppressToast: true,
    });
    expect(useSessionsMockState.quickDeleteSession).toHaveBeenCalledWith('session-2', {
      suppressToast: true,
    });
    expect(removeWorkspaceSpy).not.toHaveBeenCalled();
    expect(toastSpy).toHaveBeenCalledWith(
      '工作区「project」删除未完成：已删除 1 个会话，1 个失败，工作区未移除。',
      'warning',
      4200,
    );
    expect(useUIStateStore.getState().savedWorkspacePaths).toEqual(['/repo/project']);
  });

  it('allows deleting all sessions from the unbound workspace group', async () => {
    useSessionsMockState.sessions = [
      {
        id: 'session-unbound-1',
        title: '未绑定会话',
        updated_at: '2026-03-21T10:00:00.000Z',
      },
    ];
    useSessionsMockState.groupedSessions = [
      {
        workspacePath: null,
        workspaceLabel: '未绑定工作区',
        sessions: useSessionsMockState.sessions,
      },
    ];

    const toastSpy = vi.spyOn(ToastNotification, 'toast').mockImplementation(() => undefined);
    const removeWorkspaceSpy = vi.spyOn(useUIStateStore.getState(), 'removeSavedWorkspacePath');

    await act(async () => {
      root!.render(
        <MemoryRouter>
          <SessionSidebar
            fetchRootPath={vi.fn(async () => '/repo')}
            fetchTree={vi.fn(async () => [])}
            onOpenWorkspacePicker={() => undefined}
          />
        </MemoryRouter>,
      );
    });

    await flushEffects();

    const workspaceButton = Array.from(container!.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('未绑定工作区'),
    );

    act(() => {
      workspaceButton?.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, clientX: 120, clientY: 180 }),
      );
    });

    await flushEffects();

    const deleteWorkspaceButton = Array.from(container!.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '删除未绑定会话（1 个）',
    );

    act(() => {
      deleteWorkspaceButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await flushEffects();

    const confirmDeleteButton = Array.from(container!.querySelectorAll('button')).find(
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

    expect(useSessionsMockState.quickDeleteSession).toHaveBeenCalledWith('session-unbound-1', {
      suppressToast: true,
    });
    expect(removeWorkspaceSpy).not.toHaveBeenCalled();
    expect(toastSpy).toHaveBeenCalledWith('已删除未绑定工作区中的 1 个会话', 'success');
  });

  it('ignores repeated confirm clicks and keeps the dialog open while workspace deletion is in flight', async () => {
    useUIStateStore.setState({
      savedWorkspacePaths: ['/repo/project'],
      selectedWorkspacePath: '/repo/project',
      fileTreeRootPath: '/repo/project',
    });
    useSessionsMockState.sessions = [
      {
        id: 'session-1',
        title: '设计讨论',
        updated_at: '2026-03-21T10:00:00.000Z',
        metadata_json: JSON.stringify({ workingDirectory: '/repo/project' }),
      },
    ];
    useSessionsMockState.groupedSessions = [
      {
        workspacePath: '/repo/project',
        workspaceLabel: 'project',
        sessions: useSessionsMockState.sessions,
      },
    ];

    let resolveDelete: (() => void) | null = null;
    useSessionsMockState.quickDeleteSession.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          resolveDelete = () => resolve(true);
        }),
    );

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ changes: [] }),
      })),
    );

    await act(async () => {
      root!.render(
        <MemoryRouter>
          <SessionSidebar
            fetchRootPath={vi.fn(async () => '/repo')}
            fetchTree={vi.fn(async () => [])}
            onOpenWorkspacePicker={() => undefined}
          />
        </MemoryRouter>,
      );
    });

    await flushEffects();

    const workspaceButton = Array.from(container!.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('project'),
    );

    act(() => {
      workspaceButton?.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, clientX: 120, clientY: 180 }),
      );
    });

    await flushEffects();

    const deleteWorkspaceButton = Array.from(container!.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '删除工作区及 1 个会话',
    );

    act(() => {
      deleteWorkspaceButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await flushEffects();

    const confirmDeleteButton = Array.from(container!.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '确认删除全部',
    ) as HTMLButtonElement | undefined;
    const cancelButton = Array.from(container!.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '取消',
    ) as HTMLButtonElement | undefined;

    act(() => {
      confirmDeleteButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      confirmDeleteButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      cancelButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await flushEffects();

    expect(useSessionsMockState.quickDeleteSession).toHaveBeenCalledTimes(1);
    expect(container?.textContent).toContain('确认删除该工作区及其全部会话？');

    await act(async () => {
      resolveDelete?.();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container?.textContent).not.toContain('确认删除该工作区及其全部会话？');
  });

  it('renders compact mode badges for session items', async () => {
    useSessionsMockState.sessions = [
      {
        id: 'session-mode-1',
        title: '模式校验',
        updated_at: '2026-03-22T10:00:00.000Z',
        metadata_json: JSON.stringify({
          workingDirectory: '/repo/project',
          dialogueMode: 'coding',
          yoloMode: true,
          modelId: 'claude-sonnet-4',
        }),
      },
    ];
    useSessionsMockState.groupedSessions = [
      {
        workspacePath: '/repo/project',
        workspaceLabel: 'project',
        sessions: useSessionsMockState.sessions,
      },
    ];

    await act(async () => {
      root!.render(
        <MemoryRouter initialEntries={['/chat/session-mode-1']}>
          <SessionSidebar
            fetchRootPath={vi.fn(async () => '/repo/project')}
            fetchTree={vi.fn(async () => [])}
            onOpenWorkspacePicker={() => undefined}
          />
        </MemoryRouter>,
      );
    });

    await flushEffects();

    expect(container?.textContent).toContain('模式校验');
    expect(container?.textContent).toContain('编程');
    expect(container?.textContent).toContain('YOLO');
    expect(container?.textContent).toContain('Claude Sonnet 4');
  });

  it('preloads the chat route when hovering a session row', async () => {
    useSessionsMockState.sessions = [
      {
        id: 'session-1',
        title: '第一个会话',
        updated_at: '2026-03-22T10:00:00.000Z',
        metadata_json: JSON.stringify({ workingDirectory: '/repo/project' }),
      },
    ];
    useSessionsMockState.groupedSessions = [
      {
        workspacePath: '/repo/project',
        workspaceLabel: 'project',
        sessions: useSessionsMockState.sessions,
      },
    ];

    await act(async () => {
      root!.render(
        <MemoryRouter initialEntries={['/chat/session-1']}>
          <SessionSidebar
            fetchRootPath={vi.fn(async () => '/repo/project')}
            fetchTree={vi.fn(async () => [])}
            onOpenWorkspacePicker={() => undefined}
          />
        </MemoryRouter>,
      );
    });

    await flushEffects();

    const firstCard = container?.querySelector('[data-session-id="session-1"]');

    act(() => {
      firstCard?.dispatchEvent(
        new MouseEvent('mouseover', { bubbles: true, clientX: 18, clientY: 28 }),
      );
    });

    expect(preloadRouteModuleByPath).toHaveBeenCalledWith('/chat/session-1');
  });

  it('marks running and paused rows without rendering trailing status text', async () => {
    useSessionsMockState.sessions = [
      {
        id: 'session-running',
        state_status: 'running',
        title: '会话 A',
        updated_at: '2026-03-22T10:00:00.000Z',
        metadata_json: JSON.stringify({ workingDirectory: '/repo/project' }),
      },
      {
        id: 'session-paused',
        state_status: 'paused',
        title: '会话 B',
        updated_at: '2026-03-22T09:30:00.000Z',
        metadata_json: JSON.stringify({ workingDirectory: '/repo/project' }),
      },
    ];
    useSessionsMockState.groupedSessions = [
      {
        workspacePath: '/repo/project',
        workspaceLabel: 'project',
        sessions: useSessionsMockState.sessions,
      },
    ];

    await act(async () => {
      root!.render(
        <MemoryRouter initialEntries={['/chat/session-running']}>
          <SessionSidebar
            fetchRootPath={vi.fn(async () => '/repo/project')}
            fetchTree={vi.fn(async () => [])}
            onOpenWorkspacePicker={() => undefined}
          />
        </MemoryRouter>,
      );
    });

    await flushEffects();

    const runningCard = container?.querySelector('[data-session-id="session-running"]');
    const pausedCard = container?.querySelector('[data-session-id="session-paused"]');

    expect(runningCard?.getAttribute('data-session-state')).toBe('running');
    expect(pausedCard?.getAttribute('data-session-state')).toBe('paused');
    expect(runningCard?.querySelector('[data-session-state-indicator]')).toBeNull();
    expect(pausedCard?.querySelector('[data-session-state-indicator]')).toBeNull();
    expect(runningCard?.textContent).not.toContain('运行中');
    expect(pausedCard?.textContent).not.toContain('等待处理');

    act(() => {
      runningCard?.dispatchEvent(
        new MouseEvent('mouseover', { bubbles: true, clientX: 24, clientY: 30 }),
      );
    });

    expect(runningCard?.getAttribute('data-session-state')).toBe('running');
  });

  it('keeps idle rows free of status text and clears running visual state after rerendering to idle', async () => {
    useSessionsMockState.sessions = [
      {
        id: 'session-1',
        state_status: 'running',
        title: '会话状态切换',
        updated_at: '2026-03-22T10:00:00.000Z',
        metadata_json: JSON.stringify({ workingDirectory: '/repo/project' }),
      },
    ];
    useSessionsMockState.groupedSessions = [
      {
        workspacePath: '/repo/project',
        workspaceLabel: 'project',
        sessions: useSessionsMockState.sessions,
      },
    ];

    await act(async () => {
      root!.render(
        <MemoryRouter initialEntries={['/chat/session-1']}>
          <SessionSidebar
            fetchRootPath={vi.fn(async () => '/repo/project')}
            fetchTree={vi.fn(async () => [])}
            onOpenWorkspacePicker={() => undefined}
          />
        </MemoryRouter>,
      );
    });

    await flushEffects();

    const runningCard = container?.querySelector('[data-session-id="session-1"]');
    expect(runningCard?.getAttribute('data-session-state')).toBe('running');

    useSessionsMockState.sessions = [
      {
        id: 'session-1',
        state_status: 'idle',
        title: '会话状态切换',
        updated_at: '2026-03-22T10:02:00.000Z',
        metadata_json: JSON.stringify({ workingDirectory: '/repo/project' }),
      },
      {
        id: 'session-2',
        state_status: 'idle',
        title: '空闲会话',
        updated_at: '2026-03-22T09:30:00.000Z',
        metadata_json: JSON.stringify({ workingDirectory: '/repo/project' }),
      },
    ];
    useSessionsMockState.groupedSessions = [
      {
        workspacePath: '/repo/project',
        workspaceLabel: 'project',
        sessions: useSessionsMockState.sessions,
      },
    ];

    await act(async () => {
      root!.render(
        <MemoryRouter initialEntries={['/chat/session-1']}>
          <SessionSidebar
            fetchRootPath={vi.fn(async () => '/repo/project')}
            fetchTree={vi.fn(async () => [])}
            onOpenWorkspacePicker={() => undefined}
          />
        </MemoryRouter>,
      );
    });

    await flushEffects();

    const updatedCard = container?.querySelector('[data-session-id="session-1"]');
    const idleCard = container?.querySelector('[data-session-id="session-2"]');

    expect(updatedCard?.getAttribute('data-session-state')).toBe('idle');
    expect(updatedCard?.textContent).not.toContain('运行中');
    expect(idleCard?.textContent).not.toContain('等待处理');
    expect(idleCard?.getAttribute('data-session-state')).toBe('idle');
  });

  it('recomputes hovered session from pointer after deleting the hovered row', async () => {
    useSessionsMockState.setHoveredSessionId.mockImplementation((value: string | null) => {
      useSessionsMockState.hoveredSessionId = value;
    });
    useSessionsMockState.quickDeleteSession.mockImplementation(async (sessionId?: string) => {
      if (!sessionId) {
        return false;
      }
      useSessionsMockState.sessions = useSessionsMockState.sessions.filter(
        (session) => session.id !== sessionId,
      );
      useSessionsMockState.groupedSessions = [
        {
          workspacePath: '/repo/project',
          workspaceLabel: 'project',
          sessions: useSessionsMockState.sessions,
        },
      ];
      return true;
    });
    useSessionsMockState.sessions = [
      {
        id: 'session-1',
        title: '第一个会话',
        updated_at: '2026-03-22T10:00:00.000Z',
        metadata_json: JSON.stringify({ workingDirectory: '/repo/project' }),
      },
      {
        id: 'session-2',
        title: '第二个会话',
        updated_at: '2026-03-22T09:00:00.000Z',
        metadata_json: JSON.stringify({ workingDirectory: '/repo/project' }),
      },
    ];
    useSessionsMockState.groupedSessions = [
      {
        workspacePath: '/repo/project',
        workspaceLabel: 'project',
        sessions: useSessionsMockState.sessions,
      },
    ];

    await act(async () => {
      root!.render(
        <MemoryRouter initialEntries={['/chat/session-1']}>
          <SessionSidebar
            fetchRootPath={vi.fn(async () => '/repo/project')}
            fetchTree={vi.fn(async () => [])}
            onOpenWorkspacePicker={() => undefined}
          />
        </MemoryRouter>,
      );
    });

    await flushEffects();

    const firstCard = container?.querySelector('[data-session-id="session-1"]');
    const secondCard = container?.querySelector('[data-session-id="session-2"]');
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => secondCard as Element | null),
    });

    act(() => {
      firstCard?.dispatchEvent(
        new MouseEvent('mouseover', { bubbles: true, clientX: 18, clientY: 28 }),
      );
    });

    await act(async () => {
      root!.render(
        <MemoryRouter initialEntries={['/chat/session-1']}>
          <SessionSidebar
            fetchRootPath={vi.fn(async () => '/repo/project')}
            fetchTree={vi.fn(async () => [])}
            onOpenWorkspacePicker={() => undefined}
          />
        </MemoryRouter>,
      );
    });

    await flushEffects();

    const deleteButton = firstCard?.querySelector('button[title="删除"]');

    act(() => {
      deleteButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      root!.render(
        <MemoryRouter initialEntries={['/chat/session-1']}>
          <SessionSidebar
            fetchRootPath={vi.fn(async () => '/repo/project')}
            fetchTree={vi.fn(async () => [])}
            onOpenWorkspacePicker={() => undefined}
          />
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(useSessionsMockState.setHoveredSessionId).toHaveBeenLastCalledWith('session-2');
  });
});
