import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MENTION_SEARCH_LIMIT } from '../../../components/conversation-runtime/messages/composer.js';

const { createWorkspaceClientMock, searchFileIndexResultMock } = vi.hoisted(() => {
  const searchFileIndexResultMock = vi.fn();
  return {
    searchFileIndexResultMock,
    createWorkspaceClientMock: vi.fn(() => ({
      searchFileIndexResult: searchFileIndexResultMock,
    })),
  };
});

vi.mock('@openAwork/web-client', () => ({
  createWorkspaceClient: createWorkspaceClientMock,
}));

import {
  createTeamMentionFileSearch,
  readTeamMentionWorkspaceDirectory,
} from './team-mention-file-search.js';

beforeEach(() => {
  createWorkspaceClientMock.mockClear();
  searchFileIndexResultMock.mockClear();
});

describe('readTeamMentionWorkspaceDirectory', () => {
  it('metadata 缺失或 workingDirectory 非法时返回 null', () => {
    expect(readTeamMentionWorkspaceDirectory(null)).toBeNull();
    expect(readTeamMentionWorkspaceDirectory({})).toBeNull();
    expect(readTeamMentionWorkspaceDirectory({ workingDirectory: 42 })).toBeNull();
    expect(readTeamMentionWorkspaceDirectory({ workingDirectory: '' })).toBeNull();
  });

  it('读取非空字符串 workingDirectory', () => {
    expect(readTeamMentionWorkspaceDirectory({ workingDirectory: '/workspace/demo' })).toBe(
      '/workspace/demo',
    );
  });
});

describe('createTeamMentionFileSearch', () => {
  it('无工作区目录时返回空结果且不创建客户端', async () => {
    const search = createTeamMentionFileSearch({
      workspaceDirectory: null,
      gatewayUrl: 'https://gateway.test',
      token: 'token-test',
    });

    await expect(search('index', new AbortController().signal)).resolves.toEqual({
      files: [],
      directories: [],
    });
    expect(createWorkspaceClientMock).not.toHaveBeenCalled();
    expect(searchFileIndexResultMock).not.toHaveBeenCalled();
  });

  it('有工作区目录时携带 query / limit / signal 委派给工作区客户端', async () => {
    searchFileIndexResultMock.mockResolvedValueOnce({
      ok: true,
      retryable: false,
      truncated: false,
      files: ['src/app.ts'],
      directories: ['src'],
    });
    const search = createTeamMentionFileSearch({
      workspaceDirectory: '/workspace/demo',
      gatewayUrl: 'https://gateway.test',
      token: 'token-test',
    });
    const controller = new AbortController();

    const result = await search('app', controller.signal);

    expect(createWorkspaceClientMock).toHaveBeenCalledWith('https://gateway.test');
    expect(searchFileIndexResultMock).toHaveBeenCalledWith('token-test', '/workspace/demo', {
      query: 'app',
      limit: MENTION_SEARCH_LIMIT,
      signal: controller.signal,
    });
    expect(result).toEqual({ files: ['src/app.ts'], directories: ['src'] });
  });

  it('客户端返回 !ok 时抛出错误信息', async () => {
    searchFileIndexResultMock.mockResolvedValueOnce({
      ok: false,
      retryable: true,
      errorMessage: '检索工作区文件索引失败。',
      files: [],
      directories: [],
      truncated: false,
    });
    const search = createTeamMentionFileSearch({
      workspaceDirectory: '/workspace/demo',
      gatewayUrl: 'https://gateway.test',
      token: 'token-test',
    });

    await expect(search('app', new AbortController().signal)).rejects.toThrow(
      '检索工作区文件索引失败。',
    );
  });

  it('客户端返回 !ok 且无错误信息时使用兜底文案', async () => {
    searchFileIndexResultMock.mockResolvedValueOnce({
      ok: false,
      retryable: true,
      files: [],
      directories: [],
      truncated: false,
    });
    const search = createTeamMentionFileSearch({
      workspaceDirectory: '/workspace/demo',
      gatewayUrl: 'https://gateway.test',
      token: 'token-test',
    });

    await expect(search('app', new AbortController().signal)).rejects.toThrow(
      '检索工作区文件索引失败。',
    );
  });
});
