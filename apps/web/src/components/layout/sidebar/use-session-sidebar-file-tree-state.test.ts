// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FileTreeNode } from '../../common/modal/WorkspacePickerModal.js';
import {
  insertSessionSidebarFileTreeNode,
  removeSessionSidebarFileTreeNode,
  renameSessionSidebarFileTreeNode,
  sortSessionSidebarFileTreeNodes,
  useSessionSidebarFileTreeState,
} from './use-session-sidebar-file-tree-state.js';

const ROOT_PATH = '/workspace/demo';

type SetExpandedDirs = (updater: Set<string> | ((prev: Set<string>) => Set<string>)) => void;

afterEach(() => {
  cleanup();
});

describe('sortSessionSidebarFileTreeNodes', () => {
  it('目录排在文件前，并按名称排序', () => {
    const sorted = sortSessionSidebarFileTreeNodes([
      { path: `${ROOT_PATH}/b.ts`, name: 'b.ts', type: 'file' },
      { path: `${ROOT_PATH}/src`, name: 'src', type: 'directory' },
      { path: `${ROOT_PATH}/a.ts`, name: 'a.ts', type: 'file' },
    ]);

    expect(sorted.map((node) => node.name)).toEqual(['src', 'a.ts', 'b.ts']);
  });
});

describe('insertSessionSidebarFileTreeNode', () => {
  it('会向目标目录插入并排序子节点', () => {
    const nodes: FileTreeNode[] = [
      {
        path: `${ROOT_PATH}/src`,
        name: 'src',
        type: 'directory',
        children: [{ path: `${ROOT_PATH}/src/z.ts`, name: 'z.ts', type: 'file' }],
      },
    ];

    const next = insertSessionSidebarFileTreeNode(nodes, `${ROOT_PATH}/src`, {
      path: `${ROOT_PATH}/src/a.ts`,
      name: 'a.ts',
      type: 'file',
    });

    expect(next[0]?.children?.map((node) => node.name)).toEqual(['a.ts', 'z.ts']);
  });
});

describe('removeSessionSidebarFileTreeNode', () => {
  it('会从任意层级移除目标节点', () => {
    const nodes: FileTreeNode[] = [
      {
        path: `${ROOT_PATH}/src`,
        name: 'src',
        type: 'directory',
        children: [{ path: `${ROOT_PATH}/src/a.ts`, name: 'a.ts', type: 'file' }],
      },
    ];

    const next = removeSessionSidebarFileTreeNode(nodes, `${ROOT_PATH}/src/a.ts`);

    expect(next[0]?.children).toEqual([]);
  });
});

describe('renameSessionSidebarFileTreeNode', () => {
  it('会更新目录自身及其后代路径', () => {
    const nodes: FileTreeNode[] = [
      {
        path: `${ROOT_PATH}/src`,
        name: 'src',
        type: 'directory',
        children: [
          {
            path: `${ROOT_PATH}/src/index.ts`,
            name: 'index.ts',
            type: 'file',
          },
        ],
      },
    ];

    const next = renameSessionSidebarFileTreeNode(
      nodes,
      `${ROOT_PATH}/src`,
      `${ROOT_PATH}/source`,
      'source',
    );

    expect(next[0]?.name).toBe('source');
    expect(next[0]?.path).toBe(`${ROOT_PATH}/source`);
    expect(next[0]?.children?.[0]?.path).toBe(`${ROOT_PATH}/source/index.ts`);
  });
});

describe('useSessionSidebarFileTreeState 展开目录会话记忆', () => {
  it('同一会话内切换工作区会清空展开目录', async () => {
    const setExpandedDirs = vi.fn<SetExpandedDirs>();
    const fetchTree = vi.fn(async (): Promise<FileTreeNode[]> => []);

    const { rerender } = renderHook(
      ({ rootPath }: { rootPath: string }) =>
        useSessionSidebarFileTreeState({
          active: true,
          expandedDirsArr: [],
          expandedDirsSessionKey: 'session-a',
          fetchTree,
          fileTreeRootPath: rootPath,
          setExpandedDirs,
        }),
      { initialProps: { rootPath: ROOT_PATH } },
    );

    await waitFor(() => {
      expect(fetchTree).toHaveBeenCalled();
    });
    setExpandedDirs.mockClear();

    rerender({ rootPath: `${ROOT_PATH}/other` });

    await waitFor(() => {
      expect(setExpandedDirs).toHaveBeenCalled();
    });
    const cleared = setExpandedDirs.mock.calls[0]?.[0];
    expect(cleared).toBeInstanceOf(Set);
    expect((cleared as Set<string>).size).toBe(0);
  });

  it('切换会话时不清空展开目录，并恢复新会话已展开的子节点', async () => {
    const setExpandedDirs = vi.fn<SetExpandedDirs>();
    const fetchTree = vi.fn(async (path: string): Promise<FileTreeNode[]> => {
      if (path === ROOT_PATH) {
        return [{ path: `${ROOT_PATH}/src`, name: 'src', type: 'directory' }];
      }
      if (path === `${ROOT_PATH}/src`) {
        return [{ path: `${ROOT_PATH}/src/index.ts`, name: 'index.ts', type: 'file' }];
      }
      return [];
    });

    const { result, rerender } = renderHook(
      ({ sessionKey, expandedDirs }: { sessionKey: string; expandedDirs: readonly string[] }) =>
        useSessionSidebarFileTreeState({
          active: true,
          expandedDirsArr: expandedDirs,
          expandedDirsSessionKey: sessionKey,
          fetchTree,
          fileTreeRootPath: ROOT_PATH,
          setExpandedDirs,
        }),
      { initialProps: { sessionKey: 'session-a', expandedDirs: [] as readonly string[] } },
    );

    await waitFor(() => {
      expect(result.current.fileTree.length).toBeGreaterThan(0);
    });
    setExpandedDirs.mockClear();

    rerender({ sessionKey: 'session-b', expandedDirs: [`${ROOT_PATH}/src`] });

    await waitFor(() => {
      expect(result.current.fileTree[0]?.children?.[0]?.path).toBe(`${ROOT_PATH}/src/index.ts`);
    });
    expect(setExpandedDirs).not.toHaveBeenCalled();
  });

  it('从 null 工作区异步解析出根路径时不清空所在会话的展开目录', async () => {
    const setExpandedDirs = vi.fn<SetExpandedDirs>();
    const fetchTree = vi.fn(async (): Promise<FileTreeNode[]> => []);

    const { rerender } = renderHook(
      ({ rootPath }: { rootPath: string | null }) =>
        useSessionSidebarFileTreeState({
          active: true,
          expandedDirsArr: [],
          expandedDirsSessionKey: 'session-b',
          fetchTree,
          fileTreeRootPath: rootPath,
          setExpandedDirs,
        }),
      { initialProps: { rootPath: null as string | null } },
    );

    setExpandedDirs.mockClear();

    rerender({ rootPath: ROOT_PATH });

    await waitFor(() => {
      expect(fetchTree).toHaveBeenCalled();
    });
    expect(setExpandedDirs).not.toHaveBeenCalled();
  });

  it('同一会话内从非 null 根路径切换到另一根路径仍会清空展开目录', async () => {
    const setExpandedDirs = vi.fn<SetExpandedDirs>();
    const fetchTree = vi.fn(async (): Promise<FileTreeNode[]> => []);

    const { rerender } = renderHook(
      ({ rootPath }: { rootPath: string }) =>
        useSessionSidebarFileTreeState({
          active: true,
          expandedDirsArr: [],
          expandedDirsSessionKey: 'session-b',
          fetchTree,
          fileTreeRootPath: rootPath,
          setExpandedDirs,
        }),
      { initialProps: { rootPath: ROOT_PATH } },
    );

    await waitFor(() => {
      expect(fetchTree).toHaveBeenCalled();
    });
    setExpandedDirs.mockClear();

    rerender({ rootPath: `${ROOT_PATH}/other` });

    await waitFor(() => {
      expect(setExpandedDirs).toHaveBeenCalled();
    });
    const cleared = setExpandedDirs.mock.calls[0]?.[0];
    expect(cleared).toBeInstanceOf(Set);
    expect((cleared as Set<string>).size).toBe(0);
  });

  it('加载根节点后会为已展开目录拉取并展示子节点', async () => {
    const fetchTree = vi.fn(async (path: string): Promise<FileTreeNode[]> => {
      if (path === ROOT_PATH) {
        return [{ path: `${ROOT_PATH}/src`, name: 'src', type: 'directory' }];
      }
      if (path === `${ROOT_PATH}/src`) {
        return [{ path: `${ROOT_PATH}/src/index.ts`, name: 'index.ts', type: 'file' }];
      }
      return [];
    });

    const { result } = renderHook(() =>
      useSessionSidebarFileTreeState({
        active: true,
        expandedDirsArr: [`${ROOT_PATH}/src`],
        expandedDirsSessionKey: 'session-a',
        fetchTree,
        fileTreeRootPath: ROOT_PATH,
        setExpandedDirs: vi.fn<SetExpandedDirs>(),
      }),
    );

    await waitFor(() => {
      expect(result.current.fileTree[0]?.children?.[0]?.path).toBe(`${ROOT_PATH}/src/index.ts`);
    });
    expect(fetchTree).toHaveBeenCalledWith(`${ROOT_PATH}/src`, 1);
  });
});
