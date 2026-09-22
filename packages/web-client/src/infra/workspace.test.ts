import { afterEach, describe, expect, it, vi } from 'vitest';

import { createWorkspaceClient } from './workspace.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('createWorkspaceClient recoverable readers', () => {
  it('listRootsResult 成功时返回 roots 列表', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({ roots: ['/workspace/demo'] }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createWorkspaceClient('http://localhost:3000');
    const result = await client.listRootsResult('token-1');

    expect(result).toMatchObject({
      ok: true,
      retryable: false,
      roots: ['/workspace/demo'],
    });
  });

  it('fetchTreeResult 失败时返回结构化错误', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 503,
        json: async () => ({ error: 'tree unavailable' }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createWorkspaceClient('http://localhost:3000');
    const result = await client.fetchTreeResult('token-1', '/workspace/demo', { depth: 1 });

    expect(result).toMatchObject({
      ok: false,
      retryable: true,
      errorMessage: 'tree unavailable',
      status: 503,
      nodes: [],
    });
  });

  it('fetchTreeResult 会读取 ApiErrorResponse.data.message', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 400,
        json: async () => ({
          name: 'BadRequest',
          data: { message: '查询参数无效。', kind: 'Query' },
        }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createWorkspaceClient('http://localhost:3000');
    const result = await client.fetchTreeResult('token-1', '/workspace/demo', { depth: 1 });

    expect(result).toMatchObject({
      ok: false,
      retryable: false,
      errorMessage: '查询参数无效。',
      status: 400,
      nodes: [],
    });
  });

  it('searchFileIndexResult 返回命中的文件与目录并附带 q/limit', async () => {
    const fetchMock = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({
          files: ['apps/web/src/pages/chat-page/ChatPage.tsx'],
          directories: ['apps/web/src/pages/chat-page'],
          truncated: false,
        }),
      } as unknown as Response;
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const client = createWorkspaceClient('http://localhost:3000');
    const result = await client.searchFileIndexResult('token-1', '/workspace/demo', {
      query: 'ChatPage',
      limit: 10,
    });

    expect(result).toMatchObject({
      ok: true,
      retryable: false,
      files: ['apps/web/src/pages/chat-page/ChatPage.tsx'],
      directories: ['apps/web/src/pages/chat-page'],
      truncated: false,
    });
    const firstCall = fetchMock.mock.calls[0] as [unknown, RequestInit?] | undefined;
    if (!firstCall) {
      throw new Error('expected fetch to be called');
    }
    const requestUrl = String(firstCall[0]);
    expect(requestUrl).toContain('/workspace/files/search?');
    expect(requestUrl).toContain('q=ChatPage');
    expect(requestUrl).toContain('limit=10');
  });

  it('searchFileIndexResult 会过滤非字符串条目', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({ files: ['a.ts', '', 7], directories: [null, 'src'], truncated: true }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createWorkspaceClient('http://localhost:3000');
    const result = await client.searchFileIndexResult('token-1', '/workspace/demo', { query: '' });

    expect(result.files).toEqual(['a.ts']);
    expect(result.directories).toEqual(['src']);
    expect(result.truncated).toBe(true);
  });

  it('searchFileIndexResult 在 q 超出上限被网关以 400 拒绝时返回结构化错误', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 400,
        json: async () => ({
          name: 'BadRequest',
          data: { message: '查询参数无效。', kind: 'Query' },
        }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createWorkspaceClient('http://localhost:3000');
    const result = await client.searchFileIndexResult('token-1', '/workspace/demo', {
      query: 'x'.repeat(5000),
    });

    expect(result).toMatchObject({
      ok: false,
      retryable: false,
      errorMessage: '查询参数无效。',
      status: 400,
      files: [],
      directories: [],
      truncated: false,
    });
  });

  it('reviewStatusResult 失败时返回结构化错误', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 503,
        json: async () => ({ error: 'review status unavailable' }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createWorkspaceClient('http://localhost:3000');
    const result = await client.reviewStatusResult('token-1', '/workspace/demo');

    expect(result).toMatchObject({
      ok: false,
      retryable: true,
      errorMessage: 'review status unavailable',
      status: 503,
      changes: [],
    });
  });
});

describe('createWorkspaceClient mutation error handling', () => {
  it('writeFile 会保留后端 error 文案', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 409,
        json: async () => ({ error: 'file is locked' }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createWorkspaceClient('http://localhost:3000');

    await expect(client.writeFile('token-1', '/workspace/demo/file.ts', 'next')).rejects.toThrow(
      'file is locked',
    );
  });

  it('deleteEntry 网络异常时会转换成中文网络错误', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('Failed to fetch');
    }) as typeof fetch;

    const client = createWorkspaceClient('http://localhost:3000');

    await expect(client.deleteEntry('token-1', '/workspace/demo/file.ts')).rejects.toThrow(
      '网络异常，删除工作区条目失败。',
    );
  });

  it('deleteEntry 会附带 sessionId 与 workspaceRoot 查询参数', async () => {
    const fetchMock = vi.fn(async () => {
      return {
        ok: true,
        status: 204,
      } as unknown as Response;
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const client = createWorkspaceClient('http://localhost:3000');
    await client.deleteEntry('token-1', 'src/index.ts', {
      sessionId: 'session-1',
      workspaceRoot: '/workspace/demo',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstCall = fetchMock.mock.calls[0] as [unknown, RequestInit?] | undefined;
    if (!firstCall) {
      throw new Error('expected fetch to be called');
    }
    const [url] = firstCall;
    expect(String(url)).toContain('/workspace/entry?');
    expect(String(url)).toContain('path=src%2Findex.ts');
    expect(String(url)).toContain('sessionId=session-1');
    expect(String(url)).toContain('workspaceRoot=%2Fworkspace%2Fdemo');
  });

  it('renameEntry 会附带 sessionId 与 workspaceRoot 请求体', async () => {
    const fetchMock = vi.fn(async () => {
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      } as unknown as Response;
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const client = createWorkspaceClient('http://localhost:3000');
    await client.renameEntry('token-1', 'src/index.ts', 'src/main.ts', {
      sessionId: 'session-1',
      workspaceRoot: '/workspace/demo',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstCall = fetchMock.mock.calls[0] as [unknown, RequestInit?] | undefined;
    if (!firstCall) {
      throw new Error('expected fetch to be called');
    }
    const [, init] = firstCall;
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    expect(body).toMatchObject({
      oldPath: 'src/index.ts',
      newPath: 'src/main.ts',
      sessionId: 'session-1',
      workspaceRoot: '/workspace/demo',
    });
  });

  it('listImage-like search 操作 403 时会给出权限文案', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 403,
        json: async () => ({}),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createWorkspaceClient('http://localhost:3000');

    await expect(client.search('token-1', 'needle', '/workspace/demo')).rejects.toThrow(
      '认证失效或当前账号无权搜索工作区内容。',
    );
  });

  it('validatePath 失败时返回 valid=false 和中文错误', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 404,
        json: async () => ({ error: 'workspace path not allowed' }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createWorkspaceClient('http://localhost:3000');
    const result = await client.validatePath('token-1', '/workspace/demo/outside');

    expect(result).toMatchObject({
      valid: false,
      error: 'workspace path not allowed',
    });
  });
});

describe('createWorkspaceClient readFile SSH 身份', () => {
  it('readFileResult 未传身份时请求与本地读取完全一致（不追加身份参数）', async () => {
    const fetchMock = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({ content: 'demo', truncated: false }),
      } as unknown as Response;
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const client = createWorkspaceClient('http://localhost:3000');
    const result = await client.readFileResult('token-1', '/workspace/demo/a.ts', {
      workspaceRoot: '/workspace/demo',
      sessionId: undefined,
      sshConnectionId: undefined,
    });

    expect(result).toMatchObject({
      ok: true,
      retryable: false,
      file: { content: 'demo', truncated: false },
    });
    const firstCall = fetchMock.mock.calls[0] as [unknown, RequestInit?] | undefined;
    if (!firstCall) {
      throw new Error('expected fetch to be called');
    }
    const requestUrl = String(firstCall[0]);
    expect(requestUrl).toContain('/workspace/file?');
    expect(requestUrl).toContain('path=%2Fworkspace%2Fdemo%2Fa.ts');
    expect(requestUrl).toContain('workspaceRoot=%2Fworkspace%2Fdemo');
    expect(requestUrl).not.toContain('sessionId=');
    expect(requestUrl).not.toContain('sshConnectionId=');
  });

  it('readFileResult 会附带 sessionId 与 sshConnectionId 查询参数', async () => {
    const fetchMock = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({ content: 'remote' }),
      } as unknown as Response;
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const client = createWorkspaceClient('http://localhost:3000');
    await client.readFileResult('token-1', '/home/await/projects/demo/a.ts', {
      workspaceRoot: '/home/await/projects/demo',
      sessionId: 'session-1',
      sshConnectionId: 'conn-1',
    });

    const firstCall = fetchMock.mock.calls[0] as [unknown, RequestInit?] | undefined;
    if (!firstCall) {
      throw new Error('expected fetch to be called');
    }
    const requestUrl = String(firstCall[0]);
    expect(requestUrl).toContain('sessionId=session-1');
    expect(requestUrl).toContain('sshConnectionId=conn-1');
  });

  it('readFileBinary 会转发身份查询参数', async () => {
    const fetchMock = vi.fn(async () => {
      return {
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(4),
        headers: new Headers({ 'content-type': 'application/pdf' }),
      } as unknown as Response;
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const client = createWorkspaceClient('http://localhost:3000');
    const result = await client.readFileBinary('token-1', '/home/await/projects/demo/a.pdf', {
      sessionId: 'session-1',
    });

    expect(result.contentType).toBe('application/pdf');
    const firstCall = fetchMock.mock.calls[0] as [unknown, RequestInit?] | undefined;
    if (!firstCall) {
      throw new Error('expected fetch to be called');
    }
    const requestUrl = String(firstCall[0]);
    expect(requestUrl).toContain('/workspace/file/binary?');
    expect(requestUrl).toContain('sessionId=session-1');
    expect(requestUrl).not.toContain('sshConnectionId=');
  });
});

describe('createWorkspaceClient getFileIndexVersion', () => {
  it('携带 path 查询参数与 Authorization 头，并返回 root/version', async () => {
    const fetchMock = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({ root: '/workspace/demo', version: 7 }),
      } as unknown as Response;
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const client = createWorkspaceClient('http://localhost:3000');
    const result = await client.getFileIndexVersion('token-1', '/workspace/demo');

    expect(result).toEqual({ root: '/workspace/demo', version: 7 });
    const firstCall = fetchMock.mock.calls[0] as [unknown, RequestInit?] | undefined;
    if (!firstCall) {
      throw new Error('expected fetch to be called');
    }
    const [url, init] = firstCall;
    expect(String(url)).toContain('/workspace/files/index-version?');
    expect(String(url)).toContain('path=%2Fworkspace%2Fdemo');
    const headers = init?.headers as Record<string, string> | undefined;
    expect(headers?.Authorization).toBe('Bearer token-1');
  });

  it('响应缺少字段时回退为入参 path 与 version 0', async () => {
    globalThis.fetch = vi.fn(async () => {
      return { ok: true, json: async () => ({}) } as unknown as Response;
    }) as typeof fetch;

    const client = createWorkspaceClient('http://localhost:3000');
    const result = await client.getFileIndexVersion('token-1', '/workspace/demo');

    expect(result).toEqual({ root: '/workspace/demo', version: 0 });
  });

  it('省略 path 时不带 path 查询参数（网关回退默认工作区）', async () => {
    const fetchMock = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({ root: '/default-ws', version: 3 }),
      } as unknown as Response;
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const client = createWorkspaceClient('http://localhost:3000');
    const result = await client.getFileIndexVersion('token-1', '');

    expect(result).toEqual({ root: '/default-ws', version: 3 });
    const firstCall = fetchMock.mock.calls[0] as [unknown, RequestInit?] | undefined;
    if (!firstCall) {
      throw new Error('expected fetch to be called');
    }
    const [url] = firstCall;
    expect(String(url)).toBe('http://localhost:3000/workspace/files/index-version');
  });

  it('失败时抛带状态码的 HttpError 并映射权限文案', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 401,
        json: async () => ({}),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createWorkspaceClient('http://localhost:3000');

    await expect(client.getFileIndexVersion('token-1', '/workspace/demo')).rejects.toThrow(
      '认证失效或当前账号无权读取工作区文件索引。',
    );
  });
});
