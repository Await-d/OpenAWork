// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TeamSidebarWithFileTree } from './TeamSidebarWithFileTree.js';

type MockContextTarget = {
  directoryPath: string;
  name: string;
  path: string;
  type: 'file' | 'directory';
  x: number;
  y: number;
};

const state = vi.hoisted(() => ({
  applyCreatedEntry: vi.fn(),
  applyDeletedEntry: vi.fn(),
  applyRenamedEntry: vi.fn(),
  contextTarget: {
    directoryPath: '/workspace/demo/src',
    name: 'index.ts',
    path: '/workspace/demo/src/index.ts',
    type: 'file' as const,
    x: 12,
    y: 16,
  } as MockContextTarget,
  handleRefresh: vi.fn(),
  handleToggleDir: vi.fn(),
  onOpenFile: vi.fn(),
  refreshDirectory: vi.fn(async () => true),
  treeNodes: [
    {
      name: 'index.ts',
      path: '/workspace/demo/src/index.ts',
      type: 'file' as const,
    },
  ],
}));

const workspaceClientMocks = vi.hoisted(() => ({
  createDirectory: vi.fn(async () => undefined),
  createFile: vi.fn(async () => undefined),
  deleteEntry: vi.fn(async () => undefined),
  renameEntry: vi.fn(async () => undefined),
}));

const copyTextToClipboardMock = vi.hoisted(() => vi.fn(async () => undefined));
const dispatchComposerReferenceMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => vi.fn());
const authState = vi.hoisted(() => ({
  accessToken: 'token-test' as string | null,
  gatewayUrl: 'https://gateway.test',
}));

vi.mock('@openAwork/web-client', () => ({
  createWorkspaceClient: () => workspaceClientMocks,
}));

vi.mock('../../../../../stores/auth/auth.js', () => ({
  useAuthStore: (
    selector?: (state: { accessToken: string | null; gatewayUrl: string }) => unknown,
  ) => {
    return typeof selector === 'function' ? selector(authState) : authState;
  },
}));

vi.mock('../../../../../components/common/feedback/ToastNotification.js', () => ({
  toast: toastMock,
}));

vi.mock('../../../../../utils/chat/composer-reference-events.js', () => ({
  dispatchComposerReference: dispatchComposerReferenceMock,
}));

vi.mock('../../../../../components/layout/file-tree/file-tree-actions.js', () => ({
  copyTextToClipboard: copyTextToClipboardMock,
  getFileTreeRelativePath: (rootPath: string | null, targetPath: string) => {
    if (!rootPath) return null;
    const normalizedRoot = rootPath.replace(/\/+$/, '');
    const normalizedTarget = targetPath.replace(/\/+$/, '');
    if (normalizedRoot === normalizedTarget) return '.';
    const prefix = `${normalizedRoot}/`;
    return normalizedTarget.startsWith(prefix) ? normalizedTarget.slice(prefix.length) : null;
  },
  isValidFileTreeEntryName: (entryName: string) =>
    entryName.length > 0 && !/[\\/]/.test(entryName) && entryName !== '.' && entryName !== '..',
  joinFileTreePath: (directoryPath: string, entryName: string) =>
    directoryPath === '/' ? `/${entryName}` : `${directoryPath}/${entryName}`,
}));

vi.mock('../../../../../components/layout/sidebar/SidebarHelpers.js', () => ({
  FileTreeView: ({
    onNodeContextMenu,
  }: {
    onNodeContextMenu?: (target: MockContextTarget) => void;
  }) => (
    <button
      type="button"
      aria-label="文件树节点"
      onContextMenu={(event) => {
        event.preventDefault();
        onNodeContextMenu?.(state.contextTarget);
      }}
    >
      文件树节点
    </button>
  ),
}));

vi.mock('../../../../../components/layout/file-tree/FileTreeContextMenu.js', () => ({
  default: ({
    canCreateSession,
    onCreateFile,
    onCreateFolder,
    onCopyPath,
    onCopyRelativePath,
    onDelete,
    onRename,
    onReferenceInChat,
    onCreateSession,
  }: {
    canCreateSession: boolean;
    onCreateFile: () => void;
    onCreateFolder: () => void;
    onCopyPath: () => void;
    onCopyRelativePath: () => void;
    onDelete?: () => void;
    onRename?: () => void;
    onReferenceInChat?: (() => void) | undefined;
    onCreateSession?: (() => void) | undefined;
  }) => (
    <div role="menu" aria-label="文件树操作菜单">
      <button type="button" onClick={onCopyPath}>
        复制完整路径
      </button>
      <button type="button" onClick={onCopyRelativePath}>
        复制相对路径
      </button>
      <button type="button" onClick={onCreateFile}>
        新建文件
      </button>
      <button type="button" onClick={onCreateFolder}>
        新建文件夹
      </button>
      {onRename ? (
        <button type="button" onClick={onRename}>
          重命名文件
        </button>
      ) : null}
      {onDelete ? (
        <button type="button" onClick={onDelete}>
          删除文件
        </button>
      ) : null}
      {onReferenceInChat ? (
        <button type="button" onClick={onReferenceInChat}>
          引用到对话
        </button>
      ) : null}
      {onCreateSession ? (
        <button type="button" onClick={onCreateSession} disabled={!canCreateSession}>
          以此目录新建会话
        </button>
      ) : null}
    </div>
  ),
}));

vi.mock('./use-team-sidebar-file-tree-state.js', () => ({
  useTeamSidebarFileTreeState: () => ({
    applyCreatedEntry: state.applyCreatedEntry,
    applyDeletedEntry: state.applyDeletedEntry,
    applyRenamedEntry: state.applyRenamedEntry,
    expandedDirs: new Set<string>(),
    handleRefresh: state.handleRefresh,
    handleToggleDir: state.handleToggleDir,
    refreshDirectory: state.refreshDirectory,
    treeError: null,
    treeLoading: false,
    treeNodes: state.treeNodes,
  }),
}));

vi.mock('./use-team-file-preview.js', () => ({
  useTeamFilePreview: () => ({
    close: vi.fn(),
    content: '',
    error: null,
    loading: false,
    path: null,
    preview: vi.fn(),
  }),
}));

vi.mock('./TeamFilePreviewPanel.js', () => ({
  TeamFilePreviewPanel: () => null,
}));

vi.mock('../modals/NewTeamSessionModal.js', () => ({
  NewTeamSessionModal: ({
    initialWorkingDirectory,
  }: {
    initialWorkingDirectory?: string | null;
  }) => (
    <div data-testid="new-team-session-modal">
      {initialWorkingDirectory ? `工作目录:${initialWorkingDirectory}` : '工作目录:默认'}
    </div>
  ),
}));

function renderSidebar() {
  return render(
    <TeamSidebarWithFileTree
      collapsed={false}
      onToggleCollapsed={() => {}}
      workspaceGroups={[]}
      selectedTeamId=""
      onSelectTeam={() => {}}
      onSubmitDraft={vi.fn(async () => undefined)}
      teamWorkspaceId="workspace-1"
      workspacePath="/workspace/demo"
      onOpenFile={state.onOpenFile}
    />,
  );
}

function renderSidebarWithProps(
  props: Partial<React.ComponentProps<typeof TeamSidebarWithFileTree>> = {},
) {
  return render(
    <TeamSidebarWithFileTree
      collapsed={false}
      onToggleCollapsed={() => {}}
      workspaceGroups={[]}
      selectedTeamId=""
      onSelectTeam={() => {}}
      onSubmitDraft={vi.fn(async () => undefined)}
      teamWorkspaceId="workspace-1"
      workspacePath="/workspace/demo"
      onOpenFile={state.onOpenFile}
      {...props}
    />,
  );
}

function getDisconnectedGatewayToolbarButtons(): readonly [HTMLElement, HTMLElement, HTMLElement] {
  const buttons = screen.getAllByTitle('当前未连接到网关');
  expect(buttons).toHaveLength(3);
  const [createFileButton, createFolderButton, refreshButton] = buttons;

  if (!createFileButton || !createFolderButton || !refreshButton) {
    throw new Error('Expected disconnected file-tree toolbar buttons');
  }

  return [createFileButton, createFolderButton, refreshButton];
}

beforeEach(() => {
  cleanup();
  vi.restoreAllMocks();
  state.applyCreatedEntry.mockReset();
  state.applyDeletedEntry.mockReset();
  state.applyRenamedEntry.mockReset();
  state.handleRefresh.mockReset();
  state.handleToggleDir.mockReset();
  state.onOpenFile.mockReset();
  state.refreshDirectory.mockReset().mockResolvedValue(true);
  state.treeNodes = [
    {
      name: 'index.ts',
      path: '/workspace/demo/src/index.ts',
      type: 'file',
    },
  ];
  workspaceClientMocks.createDirectory.mockReset().mockResolvedValue(undefined);
  workspaceClientMocks.createFile.mockReset().mockResolvedValue(undefined);
  workspaceClientMocks.deleteEntry.mockReset().mockResolvedValue(undefined);
  workspaceClientMocks.renameEntry.mockReset().mockResolvedValue(undefined);
  copyTextToClipboardMock.mockReset().mockResolvedValue(undefined);
  dispatchComposerReferenceMock.mockReset();
  toastMock.mockReset();
  authState.accessToken = 'token-test';
  state.contextTarget = {
    directoryPath: '/workspace/demo/src',
    name: 'index.ts',
    path: '/workspace/demo/src/index.ts',
    type: 'file',
    x: 12,
    y: 16,
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('TeamSidebarWithFileTree', () => {
  it('文件节点菜单暴露真实引用入口，但不会对文件暴露目录建会话入口', () => {
    renderSidebar();

    fireEvent.contextMenu(screen.getByRole('button', { name: '文件树节点' }));

    expect(screen.getByRole('menu', { name: '文件树操作菜单' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '引用到对话' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '以此目录新建会话' })).toBeNull();
  });

  it('目录节点右键后会以该目录为 workingDirectory 打开新建会话弹窗', () => {
    state.contextTarget = {
      directoryPath: '/workspace/demo/src',
      name: 'src',
      path: '/workspace/demo/src',
      type: 'directory',
      x: 12,
      y: 16,
    } as MockContextTarget;

    renderSidebar();
    fireEvent.contextMenu(screen.getByRole('button', { name: '文件树节点' }));

    fireEvent.click(screen.getByRole('button', { name: '以此目录新建会话' }));

    expect(screen.getByTestId('new-team-session-modal').textContent).toContain(
      '工作目录:/workspace/demo/src',
    );
  });

  it('没有会话管理权限时禁用顶部新建会话，且目录菜单不会再打开新建会话弹窗', async () => {
    state.contextTarget = {
      directoryPath: '/workspace/demo/src',
      name: 'src',
      path: '/workspace/demo/src',
      type: 'directory',
      x: 12,
      y: 16,
    } as MockContextTarget;

    renderSidebarWithProps({
      canManageSessionEntries: false,
    });

    const newSessionButton = screen.getByRole('button', { name: '新建会话' });
    expect(newSessionButton.hasAttribute('disabled')).toBe(true);
    expect(newSessionButton.getAttribute('title')).toBe('当前工作区不可写');

    fireEvent.contextMenu(screen.getByRole('button', { name: '文件树节点' }));

    const createFromDirectoryButton = screen.getByRole('button', { name: '以此目录新建会话' });
    expect(createFromDirectoryButton.hasAttribute('disabled')).toBe(true);
    fireEvent.click(createFromDirectoryButton);

    await waitFor(() => {
      expect(screen.queryByTestId('new-team-session-modal')).toBeNull();
    });
  });

  it('未连接到网关时会禁用文件树工具条的所有网关操作入口', () => {
    authState.accessToken = null;

    renderSidebar();

    const [createFileButton, createFolderButton, refreshButton] =
      getDisconnectedGatewayToolbarButtons();

    expect(refreshButton?.hasAttribute('disabled')).toBe(true);
    expect(createFileButton?.hasAttribute('disabled')).toBe(true);
    expect(createFolderButton?.hasAttribute('disabled')).toBe(true);

    fireEvent.click(refreshButton);
    expect(state.handleRefresh).not.toHaveBeenCalled();
  });

  it('引用到对话会分发真实 composer reference 事件并提示成功', () => {
    renderSidebar();
    fireEvent.contextMenu(screen.getByRole('button', { name: '文件树节点' }));

    fireEvent.click(screen.getByRole('button', { name: '引用到对话' }));

    expect(dispatchComposerReferenceMock).toHaveBeenCalledWith('@src/index.ts ');
    expect(toastMock).toHaveBeenCalledWith('已引用文件到对话输入框', 'success');
  });

  it('文件节点右键菜单会走真实新建/重命名/删除文件链路', async () => {
    const promptSpy = vi.spyOn(window, 'prompt');
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    renderSidebar();
    fireEvent.contextMenu(screen.getByRole('button', { name: '文件树节点' }));

    promptSpy.mockReturnValueOnce('feature.ts');
    fireEvent.click(screen.getByRole('button', { name: '新建文件' }));

    await waitFor(() => {
      expect(workspaceClientMocks.createFile).toHaveBeenCalledWith(
        'token-test',
        '/workspace/demo/src/feature.ts',
      );
    });
    expect(state.applyCreatedEntry).toHaveBeenCalledWith({
      directoryPath: '/workspace/demo/src',
      entry: {
        name: 'feature.ts',
        path: '/workspace/demo/src/feature.ts',
        type: 'file',
      },
    });
    expect(state.onOpenFile).toHaveBeenCalledWith('/workspace/demo/src/feature.ts');

    fireEvent.contextMenu(screen.getByRole('button', { name: '文件树节点' }));
    promptSpy.mockReturnValueOnce('renamed.ts');
    fireEvent.click(screen.getByRole('button', { name: '重命名文件' }));

    await waitFor(() => {
      expect(workspaceClientMocks.renameEntry).toHaveBeenCalledWith(
        'token-test',
        '/workspace/demo/src/index.ts',
        '/workspace/demo/src/renamed.ts',
      );
    });
    expect(state.applyRenamedEntry).toHaveBeenCalledWith({
      oldPath: '/workspace/demo/src/index.ts',
      newName: 'renamed.ts',
      newPath: '/workspace/demo/src/renamed.ts',
    });

    fireEvent.contextMenu(screen.getByRole('button', { name: '文件树节点' }));
    fireEvent.click(screen.getByRole('button', { name: '删除文件' }));

    await waitFor(() => {
      expect(workspaceClientMocks.deleteEntry).toHaveBeenCalledWith(
        'token-test',
        '/workspace/demo/src/index.ts',
      );
    });
    expect(confirmSpy).toHaveBeenCalled();
    expect(state.applyDeletedEntry).toHaveBeenCalledWith('/workspace/demo/src/index.ts');
  });

  it('目录节点右键菜单会走真实新建文件夹链路', async () => {
    state.contextTarget = {
      directoryPath: '/workspace/demo/src',
      name: 'src',
      path: '/workspace/demo/src',
      type: 'directory',
      x: 12,
      y: 16,
    } as MockContextTarget;
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('nested-dir');

    renderSidebar();
    fireEvent.contextMenu(screen.getByRole('button', { name: '文件树节点' }));
    fireEvent.click(screen.getByRole('button', { name: '新建文件夹' }));

    await waitFor(() => {
      expect(workspaceClientMocks.createDirectory).toHaveBeenCalledWith(
        'token-test',
        '/workspace/demo/src/nested-dir',
      );
    });
    expect(state.applyCreatedEntry).toHaveBeenCalledWith({
      directoryPath: '/workspace/demo/src',
      entry: {
        children: [],
        name: 'nested-dir',
        path: '/workspace/demo/src/nested-dir',
        type: 'directory',
      },
    });
    expect(promptSpy).toHaveBeenCalled();
  });

  it('目录为空时仍可通过根目录工具条创建第一个文件', async () => {
    state.treeNodes = [];
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('root.ts');

    renderSidebar();

    expect(screen.getByText('目录为空')).toBeTruthy();
    fireEvent.click(screen.getByTitle('在根目录新建文件'));

    await waitFor(() => {
      expect(workspaceClientMocks.createFile).toHaveBeenCalledWith(
        'token-test',
        '/workspace/demo/root.ts',
      );
    });
    expect(state.applyCreatedEntry).toHaveBeenCalledWith({
      directoryPath: '/workspace/demo',
      entry: {
        name: 'root.ts',
        path: '/workspace/demo/root.ts',
        type: 'file',
      },
    });
    expect(promptSpy).toHaveBeenCalled();
  });

  it('未连接网关时不会触发文件树工具条的网关操作', () => {
    authState.accessToken = null;

    renderSidebar();

    const [createFileBtn, createFolderBtn, refreshBtn] = getDisconnectedGatewayToolbarButtons();

    expect(createFileBtn?.hasAttribute('disabled')).toBe(true);
    expect(createFolderBtn?.hasAttribute('disabled')).toBe(true);
    expect(refreshBtn?.hasAttribute('disabled')).toBe(true);

    fireEvent.click(createFileBtn);
    fireEvent.click(createFolderBtn);
    fireEvent.click(refreshBtn);

    expect(workspaceClientMocks.createFile).not.toHaveBeenCalled();
    expect(workspaceClientMocks.createDirectory).not.toHaveBeenCalled();
    expect(state.handleRefresh).not.toHaveBeenCalled();
  });

  it('复制完整路径后会显示成功反馈', async () => {
    renderSidebar();
    fireEvent.contextMenu(screen.getByRole('button', { name: '文件树节点' }));

    fireEvent.click(screen.getByRole('button', { name: '复制完整路径' }));

    await waitFor(() => {
      expect(copyTextToClipboardMock).toHaveBeenCalledWith('/workspace/demo/src/index.ts');
    });
    expect(toastMock).toHaveBeenCalledWith('已复制完整路径', 'success');
  });

  it('复制相对路径会优先复制 workspace 内相对路径', async () => {
    renderSidebar();
    fireEvent.contextMenu(screen.getByRole('button', { name: '文件树节点' }));

    fireEvent.click(screen.getByRole('button', { name: '复制相对路径' }));

    await waitFor(() => {
      expect(copyTextToClipboardMock).toHaveBeenCalledWith('src/index.ts');
    });
    expect(toastMock).toHaveBeenCalledWith('已复制相对路径', 'success');
  });
});
