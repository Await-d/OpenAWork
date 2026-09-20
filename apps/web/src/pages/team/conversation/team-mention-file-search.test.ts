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
  readTeamMentionSshConnectionId,
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

describe('readTeamMentionSshConnectionId', () => {
  it('metadata 缺失或 sshConnectionId 非法时返回 null', () => {
    expect(readTeamMentionSshConnectionId(null)).toBeNull();
    expect(readTeamMentionSshConnectionId({})).toBeNull();
    expect(readTeamMentionSshConnectionId({ sshConnectionId: 42 })).toBeNull();
    expect(readTeamMentionSshConnectionId({ sshConnectionId: '   ' })).toBeNull();
  });

  it('读取并 trim 非空字符串 sshConnectionId', () => {
    expect(readTeamMentionSshConnectionId({ sshConnectionId: ' conn-1 ' })).toBe('conn-1');
  });
});

describe('createTeamMentionFileSearch', () => {
  it('无工作区目录时返回空结果且不创建客户端', async () => {
    const search = createTeamMentionFileSearch({
      workspaceDirectory: null,
      gatewayUrl: 'https://gateway.test',
      token: 'token-test',
      sessionId: 'session-1',
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
      sessionId: null,
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

  it('已有会话时把 sessionId 透传给索引检索（网关据此解析 SSH 绑定）', async () => {
    searchFileIndexResultMock.mockResolvedValueOnce({
      ok: true,
      retryable: false,
      truncated: false,
      files: [],
      directories: [],
    });
    const search = createTeamMentionFileSearch({
      workspaceDirectory: '/home/await/projects/remote',
      gatewayUrl: 'https://gateway.test',
      token: 'token-test',
      sessionId: 'session-9',
    });
    const controller = new AbortController();

    await search('app', controller.signal);

    expect(searchFileIndexResultMock).toHaveBeenCalledWith(
      'token-test',
      '/home/await/projects/remote',
      {
        query: 'app',
        limit: MENTION_SEARCH_LIMIT,
        signal: controller.signal,
        sessionId: 'session-9',
      },
    );
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
      sessionId: null,
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
      sessionId: null,
    });

    await expect(search('app', new AbortController().signal)).rejects.toThrow(
      '检索工作区文件索引失败。',
    );
  });
});
