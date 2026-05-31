import { afterEach, describe, expect, it, vi } from 'vitest';

import { HttpError } from '../gateway/http.js';
import { createSshClient } from './ssh.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('createSshClient', () => {
  it('list 成功时返回 connections 列表', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({ connections: [{ id: 'ssh-1', host: 'localhost', port: 22, username: 'root', status: 'connected' }] }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createSshClient('http://localhost:3000');
    const result = await client.list('token-1');

    expect(result[0]?.id).toBe('ssh-1');
  });

  it('create 失败时会保留后端 error 文案', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 409,
        json: async () => ({ error: 'connection already exists' }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createSshClient('http://localhost:3000');

    await expect(
      client.create('token-1', { host: 'localhost', port: 22, username: 'root' }),
    ).rejects.toThrow('connection already exists');
  });

  it('upload 网络异常时会转换成中文网络错误', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('Failed to fetch');
    }) as typeof fetch;

    const client = createSshClient('http://localhost:3000');

    await expect(
      client.upload('token-1', {
        connectionId: 'ssh-1',
        path: '/tmp/demo.txt',
        contentBase64: 'aGVsbG8=',
      }),
    ).rejects.toThrow('网络异常，上传 SSH 文件失败。');
  });

  it('readFile 404 时会保留 HttpError 状态码', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 404,
        json: async () => ({ error: 'ssh file not found' }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createSshClient('http://localhost:3000');

    try {
      await client.readFile('token-1', 'ssh-1', '/tmp/demo.txt');
      throw new Error('expected readFile to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).status).toBe(404);
      expect((error as Error).message).toContain('ssh file not found');
    }
  });

  it('create 会读取 ApiErrorResponse.data.message', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 400,
        json: async () => ({
          name: 'BadRequest',
          data: { message: '请求体参数无效。', kind: 'Body' },
        }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createSshClient('http://localhost:3000');

    await expect(
      client.create('token-1', { host: 'localhost', port: 22, username: 'root' }),
    ).rejects.toThrow('请求体参数无效。');
  });
});
