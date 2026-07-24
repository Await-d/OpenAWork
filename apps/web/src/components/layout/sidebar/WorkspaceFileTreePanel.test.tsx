// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceFileTreePanel } from './WorkspaceFileTreePanel.js';

type MockContextTarget = {
  readonly directoryPath: string;
  readonly name: string;
  readonly path: string;
  readonly type: 'file' | 'directory';
  readonly x: number;
  readonly y: number;
};

type MockTreeNode = {
  readonly name: string;
  readonly path: string;
  readonly type: 'file' | 'directory';
};

type MockSidebarState = {
  readonly applyCreatedEntry: ReturnType<typeof vi.fn>;
  readonly applyDeletedEntry: ReturnType<typeof vi.fn>;
  readonly applyRenamedEntry: ReturnType<typeof vi.fn>;
  readonly contextTarget: MockContextTarget;
  readonly ensureRootPath: ReturnType<typeof vi.fn>;
  fileTree: MockTreeNode[];
  fileTreeError: string | null;
  fileTreeLoading: boolean;
  readonly handleRefreshFileTree: ReturnType<typeof vi.fn>;
  readonly handleToggleDirWithLoad: ReturnType<typeof vi.fn>;
  readonly refreshDirectory: ReturnType<typeof vi.fn>;
  readonly setFileTreeError: ReturnType<typeof vi.fn>;
};

const authState = vi.hoisted(() => ({
  accessToken: 'token-test' as string | null,
  gatewayUrl: 'https://gateway.test',
}));

const uiState = vi.hoisted(() => ({
  activeFilePathByWorkspace: {} as Record<string, string | null>,
  bumpWorkspaceTreeVersion: vi.fn(),
  expandedDirs: [] as string[],
  fileTreeRootPath: '/workspace/demo',
  removeSavedWorkspacePath: vi.fn(),
  setExpandedDirs: vi.fn(),
}));

const sidebarState: MockSidebarState = vi.hoisted(() => ({
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
  } satisfies MockContextTarget,
  ensureRootPath: vi.fn(async () => '/workspace/demo'),
  fileTree: [
    {
      name: 'index.ts',
      path: '/workspace/demo/src/index.ts',
      type: 'file' as const,
    },
  ] as MockTreeNode[],
  fileTreeError: null as string | null,
  fileTreeLoading: false,
  handleRefreshFileTree: vi.fn(),
  handleToggleDirWithLoad: vi.fn(),
  refreshDirectory: vi.fn(async () => true),
  setFileTreeError: vi.fn(),
}));

const workspaceClientMocks = vi.hoisted(() => ({
  createDirectory: vi.fn(async () => undefined),
  createFile: vi.fn(async () => undefined),
  deleteEntry: vi.fn(async () => undefined),
  renameEntry: vi.fn(async () => undefined),
}));

vi.mock('@openAwork/web-client', () => ({
  createWorkspaceClient: () => workspaceClientMocks,
}));

vi.mock('../../../stores/auth/auth.js', () => ({
  useAuthStore: (
    selector?: (state: { accessToken: string | null; gatewayUrl: string }) => unknown,
  ) => {
    return typeof selector === 'function' ? selector(authState) : authState;
  },
}));

vi.mock('../../../stores/ui/uiState.js', () => ({
  useUIStateStore: (
    selector?: (state: {
      activeFilePathByWorkspace: Record<string, string | null>;
      bumpWorkspaceTreeVersion: () => void;
      expandedDirs: string[];
      fileTreeRootPath: string | null;
      removeSavedWorkspacePath: (path: string) => void;
      setExpandedDirs: (dirs: string[]) => void;
    }) => unknown,
  ) => {
    return typeof selector === 'function' ? selector(uiState) : uiState;
  },
}));

vi.mock('./use-session-sidebar-file-tree-state.js', () => ({
  useSessionSidebarFileTreeState: () => ({
    applyCreatedEntry: sidebarState.applyCreatedEntry,
    applyDeletedEntry: sidebarState.applyDeletedEntry,
    applyRenamedEntry: sidebarState.applyRenamedEntry,
    ensureRootPath: sidebarState.ensureRootPath,
    fileTree: sidebarState.fileTree,
    fileTreeError: sidebarState.fileTreeError,
    fileTreeLoading: sidebarState.fileTreeLoading,
    handleRefreshFileTree: sidebarState.handleRefreshFileTree,
    handleToggleDirWithLoad: sidebarState.handleToggleDirWithLoad,
    refreshDirectory: sidebarState.refreshDirectory,
    setFileTreeError: sidebarState.setFileTreeError,
  }),
}));

vi.mock('./SidebarHelpers.js', () => ({
  FileTreeView: ({
    onNodeContextMenu,
  }: {
    readonly onNodeContextMenu?: (target: MockContextTarget) => void;
  }) => (
    <button
      type="button"
      onContextMenu={(event) => {
        event.preventDefault();
        onNodeContextMenu?.(sidebarState.contextTarget);
      }}
    >
      文件树节点
    </button>
  ),
}));

function renderPanel() {
  return render(
    <WorkspaceFileTreePanel
      allowMutations={false}
      fetchTree={vi.fn(async () => [])}
      onOpenFile={vi.fn()}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  uiState.fileTreeRootPath = '/workspace/demo';
  uiState.expandedDirs = [];
  sidebarState.fileTree = [
    {
      name: 'index.ts',
      path: '/workspace/demo/src/index.ts',
      type: 'file',
    },
  ];
  sidebarState.fileTreeError = null;
  sidebarState.fileTreeLoading = false;
});

afterEach(() => {
  cleanup();
});

describe('WorkspaceFileTreePanel', () => {
  it('只读模式隐藏根目录新建按钮，并且右键菜单不暴露变更操作', () => {
    renderPanel();

    expect(screen.queryByTitle('在根目录新建文件')).toBeNull();
    expect(screen.queryByTitle('在根目录新建文件夹')).toBeNull();

    fireEvent.contextMenu(screen.getByRole('button', { name: '文件树节点' }));

    expect(screen.getByRole('menu', { name: '文件树操作菜单' })).not.toBeNull();
    expect(screen.getByRole('menuitem', { name: '打开文件' })).not.toBeNull();
    expect(screen.getByRole('menuitem', { name: '复制完整路径' })).not.toBeNull();
    expect(screen.getByRole('menuitem', { name: /刷新/ })).not.toBeNull();
    expect(screen.queryByRole('menuitem', { name: /新建文件$/ })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /新建文件夹$/ })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /重命名/ })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /删除/ })).toBeNull();
  });

  it('只读模式在空目录时展示浏览型空状态文案', () => {
    sidebarState.fileTree = [];

    renderPanel();

    expect(screen.getByText('当前目录为空，可在此浏览目录并从工作区中打开文件')).not.toBeNull();
  });

  it('路径不兼容错误时展示切换工作区按钮', () => {
    sidebarState.fileTreeError =
      '当前网关运行在 Windows，无法访问 POSIX 路径：/home/await/project/00001.demo。请将会话工作区切换到当前设备可访问的目录。';

    const onSwitchWorkspace = vi.fn();
    render(
      <WorkspaceFileTreePanel
        allowMutations={false}
        fetchTree={vi.fn(async () => [])}
        onOpenFile={vi.fn()}
        onSwitchWorkspace={onSwitchWorkspace}
      />,
    );

    const btn = screen.getByRole('button', { name: '切换工作区' });
    fireEvent.click(btn);
    expect(onSwitchWorkspace).toHaveBeenCalledOnce();
  });

  it('路径不兼容但未提供 onSwitchWorkspace 时不展示切换按钮', () => {
    sidebarState.fileTreeError =
      '当前网关运行在 Windows，无法访问 POSIX 路径：/home/await/project/00001.demo。请将会话工作区切换到当前设备可访问的目录。';

    renderPanel();

    expect(screen.queryByRole('button', { name: '切换工作区' })).toBeNull();
  });

  it('普通错误不展示切换工作区按钮', () => {
    sidebarState.fileTreeError = '读取文件树失败';

    render(
      <WorkspaceFileTreePanel
        allowMutations={false}
        fetchTree={vi.fn(async () => [])}
        onOpenFile={vi.fn()}
        onSwitchWorkspace={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: '切换工作区' })).toBeNull();
  });
});
