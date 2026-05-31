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
