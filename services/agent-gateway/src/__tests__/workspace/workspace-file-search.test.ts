import { describe, expect, it } from 'vitest';
import type {
  CachedWorkspaceFileIndex,
  WorkspaceFileIndexEntry,
} from '../../workspace/workspace-file-index.js';
import {
  searchWorkspaceFileIndex,
  WORKSPACE_FILE_SEARCH_DEFAULT_LIMIT,
  WORKSPACE_FILE_SEARCH_MAX_LIMIT,
} from '../../workspace/workspace-file-search.js';

function buildIndex(relativePaths: readonly string[]): CachedWorkspaceFileIndex {
  const files: WorkspaceFileIndexEntry[] = [];
  const directories = new Set<string>();

  for (const relativePath of relativePaths) {
    const segments = relativePath.split('/');
    const label = segments[segments.length - 1] ?? relativePath;
    files.push({
      relativePath,
      label,
      lowerLabel: label.toLowerCase(),
      lowerPath: relativePath.toLowerCase(),
      depth: segments.length,
    });
    for (let depth = 1; depth < segments.length; depth += 1) {
      directories.add(segments.slice(0, depth).join('/'));
    }
  }

  return {
    rootPath: '/fixture-root',
    files,
    directories: [...directories].sort((left, right) => left.localeCompare(right)),
    truncated: false,
    builtAt: 0,
  };
}

const browseIndex = buildIndex([
  'README.md',
  'apps/desktop.config.ts',
  'apps/web/src/App.tsx',
  'docs/guide.md',
  'src/index.ts',
  'src/pages/chat-page/ChatPage.tsx',
]);

const rankingIndex = buildIndex([
  'src/chat',
  'chat-a.ts',
  'chat-page.tsx',
  'deep/dir/chat-b.ts',
  'src/my-chat.ts',
  'chat/helper.ts',
  'x/chat-tools/notes.md',
]);

describe('searchWorkspaceFileIndex 常量', () => {
  it('默认与最大 limit 分别为 20 / 50', () => {
    expect(WORKSPACE_FILE_SEARCH_DEFAULT_LIMIT).toBe(20);
    expect(WORKSPACE_FILE_SEARCH_MAX_LIMIT).toBe(50);
  });
});

describe('searchWorkspaceFileIndex 浏览模式', () => {
  it('空查询时根目录只列直接子目录与根文件，且目录在前', () => {
    const result = searchWorkspaceFileIndex({
      index: browseIndex,
      query: '',
      limit: WORKSPACE_FILE_SEARCH_DEFAULT_LIMIT,
    });

    expect(result).toEqual({
      files: ['README.md'],
      directories: ['apps', 'docs', 'src'],
    });
  });

  it('apps/ 只返回直接子级，孙级被排除', () => {
    const result = searchWorkspaceFileIndex({ index: browseIndex, query: 'apps/', limit: 20 });

    expect(result).toEqual({
      files: ['apps/desktop.config.ts'],
      directories: ['apps/web'],
    });
  });

  it('目录片段过滤大小写不敏感', () => {
    const result = searchWorkspaceFileIndex({ index: browseIndex, query: 'SRC/INDEX', limit: 20 });

    expect(result).toEqual({ files: ['src/index.ts'], directories: [] });
  });

  it('片段无匹配时不返回任何条目', () => {
    const result = searchWorkspaceFileIndex({ index: browseIndex, query: 'src/zzz', limit: 20 });

    expect(result).toEqual({ files: [], directories: [] });
  });

  it('前导斜杠被归一化：/src 与 src 行为一致', () => {
    const withLeadingSlash = searchWorkspaceFileIndex({
      index: browseIndex,
      query: '/src',
      limit: 20,
    });
    const withoutLeadingSlash = searchWorkspaceFileIndex({
      index: browseIndex,
      query: 'src',
      limit: 20,
    });

    expect(withLeadingSlash).toEqual(withoutLeadingSlash);
  });

  it('浏览模式下带前导斜杠的目录查询同样命中', () => {
    const withLeadingSlash = searchWorkspaceFileIndex({
      index: browseIndex,
      query: '/apps/',
      limit: 20,
    });
    const withoutLeadingSlash = searchWorkspaceFileIndex({
      index: browseIndex,
      query: 'apps/',
      limit: 20,
    });

    expect(withLeadingSlash).toEqual(withoutLeadingSlash);
    expect(withLeadingSlash).toEqual({
      files: ['apps/desktop.config.ts'],
      directories: ['apps/web'],
    });
  });

  it('仅由斜杠组成的查询等价于根浏览', () => {
    expect(searchWorkspaceFileIndex({ index: browseIndex, query: '/', limit: 20 })).toEqual(
      searchWorkspaceFileIndex({ index: browseIndex, query: '', limit: 20 }),
    );
  });
});

describe('searchWorkspaceFileIndex 搜索模式', () => {
  it('精确 > 前缀 > 子串 > 路径子串，同分文件在前、浅层在前', () => {
    const result = searchWorkspaceFileIndex({ index: rankingIndex, query: 'chat', limit: 20 });

    expect(result).toEqual({
      files: [
        'src/chat',
        'chat-a.ts',
        'chat-page.tsx',
        'deep/dir/chat-b.ts',
        'src/my-chat.ts',
        'chat/helper.ts',
        'x/chat-tools/notes.md',
      ],
      directories: ['chat', 'x/chat-tools'],
    });
  });

  it('无匹配时返回空结果', () => {
    const result = searchWorkspaceFileIndex({ index: rankingIndex, query: 'zzz', limit: 20 });

    expect(result).toEqual({ files: [], directories: [] });
  });
});

describe('searchWorkspaceFileIndex limit 与空索引', () => {
  it('浏览模式按目录优先截断到 limit', () => {
    const result = searchWorkspaceFileIndex({ index: browseIndex, query: '', limit: 2 });

    expect(result).toEqual({ files: [], directories: ['apps', 'docs'] });
  });

  it('搜索模式截断到 limit 且文件目录共享额度', () => {
    const result = searchWorkspaceFileIndex({ index: rankingIndex, query: 'chat', limit: 2 });

    expect(result).toEqual({ files: ['src/chat'], directories: ['chat'] });
  });

  it('空索引对任意查询都返回空结果', () => {
    const emptyIndex: CachedWorkspaceFileIndex = {
      rootPath: '/fixture-root',
      files: [],
      directories: [],
      truncated: false,
      builtAt: 0,
    };

    expect(searchWorkspaceFileIndex({ index: emptyIndex, query: '', limit: 20 })).toEqual({
      files: [],
      directories: [],
    });
    expect(searchWorkspaceFileIndex({ index: emptyIndex, query: 'chat', limit: 20 })).toEqual({
      files: [],
      directories: [],
    });
  });

  it('不存在的目录前缀返回空结果', () => {
    const result = searchWorkspaceFileIndex({ index: browseIndex, query: 'zzz/', limit: 20 });

    expect(result).toEqual({ files: [], directories: [] });
  });
});
