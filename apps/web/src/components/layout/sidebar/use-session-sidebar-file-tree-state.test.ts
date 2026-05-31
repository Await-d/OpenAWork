// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { FileTreeNode } from '../../common/modal/WorkspacePickerModal.js';
import {
  insertSessionSidebarFileTreeNode,
  removeSessionSidebarFileTreeNode,
  renameSessionSidebarFileTreeNode,
  sortSessionSidebarFileTreeNodes,
} from './use-session-sidebar-file-tree-state.js';

const ROOT_PATH = '/workspace/demo';

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
