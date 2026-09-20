// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceClient } from '@openAwork/web-client';
import {
  __clearBareFilenameResolutionCacheForTest,
  resolveBareFilename,
} from './resolve-bare-filename.js';

const REMOTE_SESSION_IDENTITY = {
  sessionId: 'sess-ssh-1',
  sshConnectionId: null,
  remote: true,
} as const;
const REMOTE_DRAFT_IDENTITY = {
  sessionId: null,
  sshConnectionId: 'conn-ssh-1',
  remote: true,
} as const;

interface ClientMockOptions {
  hits?: Array<{ path: string }>;
  searchFiles?: string[];
  searchOk?: boolean;
  searchThrows?: boolean;
}

function createClientMock(options: ClientMockOptions = {}) {
  const hits = options.hits ?? [{ path: '/workspace/demo/src/index.ts' }];
  const searchFiles = options.searchFiles ?? ['src/index.ts'];
  const findByName = vi.fn(async () => hits);
  const searchFileIndexResult = vi.fn(async () => {
    if (options.searchThrows) throw new Error('search failed');
    return {
      ok: options.searchOk ?? true,
      retryable: false,
      files: searchFiles,
      directories: [],
      truncated: false,
    };
  });
  return {
    findByName,
    searchFileIndexResult,
    client: { findByName, searchFileIndexResult } as unknown as WorkspaceClient,
  };
}

beforeEach(() => {
  __clearBareFilenameResolutionCacheForTest();
});

afterEach(() => {
  __clearBareFilenameResolutionCacheForTest();
  vi.restoreAllMocks();
});

describe('resolveBareFilename', () => {
  it('SSH 会话身份下经远端索引解析嵌套裸名到最短相对路径，且不调用 findByName', async () => {
    const { client, findByName, searchFileIndexResult } = createClientMock({
      searchFiles: ['src/deep/create_quotation.py', 'src/create_quotation.py'],
    });

    const resolved = await resolveBareFilename({
      client,
      token: 'token-test',
      workspaceRoot: '/home/await/projects/GHY-Automated-Water-Rain',
      rawPath: 'create_quotation.py',
      identity: REMOTE_SESSION_IDENTITY,
    });

    expect(resolved).toBe('src/create_quotation.py');
    expect(searchFileIndexResult).toHaveBeenCalledWith(
      'token-test',
      '/home/await/projects/GHY-Automated-Water-Rain',
      expect.objectContaining({ query: 'create_quotation.py', sessionId: 'sess-ssh-1' }),
    );
    expect(findByName).not.toHaveBeenCalled();
  });

  it('草稿态仅有 sshConnectionId 时用远端索引解析并携带连接 id', async () => {
    const { client, findByName, searchFileIndexResult } = createClientMock({
      searchFiles: ['lib/util.py'],
    });

    const resolved = await resolveBareFilename({
      client,
      token: 'token-test',
      workspaceRoot: '/home/await/projects/GHY-Automated-Water-Rain',
      rawPath: 'util.py',
      identity: REMOTE_DRAFT_IDENTITY,
    });

    expect(resolved).toBe('lib/util.py');
    expect(searchFileIndexResult).toHaveBeenCalledWith(
      'token-test',
      '/home/await/projects/GHY-Automated-Water-Rain',
      expect.objectContaining({ query: 'util.py', sshConnectionId: 'conn-ssh-1' }),
    );
    expect(findByName).not.toHaveBeenCalled();
  });

  it('远端索引命中多个同段数路径时按字典序取最短且确定的一个', async () => {
    const { client } = createClientMock({
      searchFiles: ['b/x.py', 'a/x.py'],
    });

    const resolved = await resolveBareFilename({
      client,
      token: 'token-test',
      workspaceRoot: '/home/await/projects/demo',
      rawPath: 'x.py',
      identity: REMOTE_SESSION_IDENTITY,
    });

    expect(resolved).toBe('a/x.py');
  });

  it('远端索引无命中时回退裸文件名，且不调用 findByName', async () => {
    const { client, findByName } = createClientMock({ searchFiles: [] });

    const resolved = await resolveBareFilename({
      client,
      token: 'token-test',
      workspaceRoot: '/home/await/projects/demo',
      rawPath: 'missing.py',
      identity: REMOTE_SESSION_IDENTITY,
    });

    expect(resolved).toBe('missing.py');
    expect(findByName).not.toHaveBeenCalled();
  });

  it('远端索引返回失败时回退裸文件名，不抛错', async () => {
    const { client } = createClientMock({ searchOk: false });

    const resolved = await resolveBareFilename({
      client,
      token: 'token-test',
      workspaceRoot: '/home/await/projects/demo',
      rawPath: 'broken.py',
      identity: REMOTE_SESSION_IDENTITY,
    });

    expect(resolved).toBe('broken.py');
  });

  it('远端索引检索抛错时回退裸文件名，不抛错', async () => {
    const { client } = createClientMock({ searchThrows: true });

    const resolved = await resolveBareFilename({
      client,
      token: 'token-test',
      workspaceRoot: '/home/await/projects/demo',
      rawPath: 'throwing.py',
      identity: REMOTE_SESSION_IDENTITY,
    });

    expect(resolved).toBe('throwing.py');
  });

  it('本地解析缓存不会泄漏给 SSH 身份（缓存按身份隔离）', async () => {
    const { client, findByName } = createClientMock();

    const local = await resolveBareFilename({
      client,
      token: 'token-test',
      workspaceRoot: '/workspace/demo',
      rawPath: 'index.ts',
    });
    expect(local).toBe('/workspace/demo/src/index.ts');
    expect(findByName).toHaveBeenCalledTimes(1);

    const remote = await resolveBareFilename({
      client,
      token: 'token-test',
      workspaceRoot: '/home/await/projects/GHY-Automated-Water-Rain',
      rawPath: 'index.ts',
      identity: REMOTE_SESSION_IDENTITY,
    });

    expect(remote).toBe('src/index.ts');
    expect(findByName).toHaveBeenCalledTimes(1);
  });

  it('无身份时保持原有 findByName 解析与缓存行为', async () => {
    const { client, findByName } = createClientMock();

    const first = await resolveBareFilename({
      client,
      token: 'token-test',
      workspaceRoot: '/workspace/demo',
      rawPath: 'index.ts',
    });
    const second = await resolveBareFilename({
      client,
      token: 'token-test',
      workspaceRoot: '/workspace/demo',
      rawPath: 'index.ts',
    });

    expect(first).toBe('/workspace/demo/src/index.ts');
    expect(second).toBe('/workspace/demo/src/index.ts');
    expect(findByName).toHaveBeenCalledTimes(1);
  });
});
