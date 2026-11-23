import { describe, expect, it } from 'vitest';
import { parseDirectoryListing, parseDirectoryTree } from './directory-listing.js';

describe('parseDirectoryTree', () => {
  it('识别实际 list JSON 字符串并保留深度、路径、计数', () => {
    const nodes = [{ path: '/repo/src', name: 'src', type: 'directory', children: [] }];
    expect(
      parseDirectoryTree(JSON.stringify({ path: '/repo', depth: 2, visitedEntries: 4, nodes })),
    ).toMatchObject({ path: '/repo', depth: 2, visited: 4, nodes });
  });

  it('保留旧节点与 read 文本格式', () => {
    expect(parseDirectoryTree({ nodes: [{ name: 'src', type: 'dir' }] })?.nodes).toHaveLength(1);
    expect(parseDirectoryListing('dir src\nfile index.ts')).toEqual([
      { isDir: true, name: 'src' },
      { isDir: false, name: ' index.ts' },
    ]);
  });

  it.each([
    undefined,
    '',
    '{"nodes":[',
    { nodes: [null] },
    { nodes: [{ name: 1 }] },
    { nodes: [{ name: 'src', children: 'bad' }] },
    { nodes: [], error: 'permission denied' },
    { nodes: [], ok: false },
    { nodes: [], status: 'pending' },
    { nodes: [], status: 'running' },
  ])('拒绝缺失、残缺或错误输出 %j', (output) => {
    expect(parseDirectoryTree(output)).toBeNull();
  });
});
