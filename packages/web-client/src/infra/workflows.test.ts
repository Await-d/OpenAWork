import { afterEach, describe, expect, it, vi } from 'vitest';

import { createWorkflowsClient } from './workflows.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('createWorkflowsClient.listTemplatesResult', () => {
  it('成功时返回模板列表', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        json: async () => [{ id: 'tpl-1', name: 'Template A', category: 'team-playbook' }],
      } as unknown as Response;
    }) as typeof fetch;

    const client = createWorkflowsClient('http://localhost:3000');
    const result = await client.listTemplatesResult('token-1');

    expect(result).toMatchObject({
      ok: true,
      retryable: false,
      templates: [{ id: 'tpl-1', name: 'Template A' }],
    });
  });

  it('HTTP 错误时返回结构化失败信息', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 503,
        json: async () => ({ error: 'templates unavailable' }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createWorkflowsClient('http://localhost:3000');
    const result = await client.listTemplatesResult('token-1');

    expect(result).toMatchObject({
      ok: false,
      retryable: true,
      errorMessage: 'templates unavailable',
      status: 503,
      templates: [],
    });
  });

  it('listTemplatesResult 会读取 ApiErrorResponse.data.message', async () => {
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

    const client = createWorkflowsClient('http://localhost:3000');
    const result = await client.listTemplatesResult('token-1');

    expect(result).toMatchObject({
      ok: false,
      retryable: false,
      errorMessage: '请求体参数无效。',
      status: 400,
      templates: [],
    });
  });
});

describe('createWorkflowsClient mutation error handling', () => {
  it('createTemplate 会保留后端 error 文案', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 409,
        json: async () => ({ error: 'template already exists' }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createWorkflowsClient('http://localhost:3000');

    await expect(
      client.createTemplate('token-1', {
        name: 'Template A',
        category: 'team-playbook',
        nodes: [],
        edges: [],
      }),
    ).rejects.toThrow('template already exists');
  });

  it('updateTemplate 网络异常时会转换成中文网络错误', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('Failed to fetch');
    }) as typeof fetch;

    const client = createWorkflowsClient('http://localhost:3000');

    await expect(
      client.updateTemplate('token-1', 'tpl-1', {
        name: 'Template B',
      }),
    ).rejects.toThrow('网络异常，更新工作流模板失败。');
  });

  it('removeTemplate 403 时会给出权限错误文案', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 403,
        json: async () => ({}),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createWorkflowsClient('http://localhost:3000');

    await expect(client.removeTemplate('token-1', 'tpl-1')).rejects.toThrow(
      '认证失效或当前账号无权删除工作流模板。',
    );
  });

  it('optimizePrompt 会保留后端 error 文案', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 500,
        json: async () => ({ error: 'AI_API_KEY missing' }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createWorkflowsClient('http://localhost:3000');

    await expect(
      client.optimizePrompt('token-1', {
        originalPrompt: 'summarize this',
      }),
    ).rejects.toThrow('AI_API_KEY missing');
  });

  it('translate 网络异常时会转换成中文网络错误', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('Failed to fetch');
    }) as typeof fetch;

    const client = createWorkflowsClient('http://localhost:3000');

    await expect(
      client.translate('token-1', [
        {
          id: 'task-1',
          content: 'hello',
          fileName: 'note.md',
          targetLanguage: 'zh-CN',
        },
      ]),
    ).rejects.toThrow('网络异常，翻译工作流任务失败。');
  });
});
