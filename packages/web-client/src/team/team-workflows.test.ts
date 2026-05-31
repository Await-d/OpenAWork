import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTeamWorkflowsClient } from './team-workflows.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('createTeamWorkflowsClient.listResult', () => {
  it('成功时返回团队工作流列表', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({
          workflows: [
            {
              _dbId: 'wf-1',
              id: 'workflow-1',
              name: 'Workflow A',
              description: 'desc',
              version: '1',
              source: 'custom',
              entryStepId: 'step-1',
              steps: [],
              defaultBindings: {},
              tags: [],
            },
          ],
        }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createTeamWorkflowsClient('http://localhost:3000');
    const result = await client.listResult('token-1');

    expect(result).toMatchObject({
      ok: true,
      retryable: false,
      workflows: [{ _dbId: 'wf-1', id: 'workflow-1', name: 'Workflow A' }],
    });
  });

  it('HTTP 错误时返回结构化失败信息', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 503,
        json: async () => ({ error: 'team workflows unavailable' }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createTeamWorkflowsClient('http://localhost:3000');
    const result = await client.listResult('token-1');

    expect(result).toMatchObject({
      ok: false,
      retryable: true,
      errorMessage: 'team workflows unavailable',
      status: 503,
      workflows: [],
    });
  });

  it('listResult 会读取 ApiErrorResponse.data.message', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 400,
        json: async () => ({
          name: 'BadRequest',
          data: { message: '团队工作流配置无效。', kind: 'Body' },
        }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createTeamWorkflowsClient('http://localhost:3000');
    const result = await client.listResult('token-1');

    expect(result).toMatchObject({
      ok: false,
      retryable: false,
      errorMessage: '团队工作流配置无效。',
      status: 400,
    });
  });

  it('list 在失败时会抛出结构化错误文案', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 503,
        json: async () => ({ error: 'team workflows unavailable' }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createTeamWorkflowsClient('http://localhost:3000');

    await expect(client.list('token-1')).rejects.toThrow('team workflows unavailable');
  });
});

describe('createTeamWorkflowsClient mutation error handling', () => {
  it('create 会保留后端 error 文案', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 409,
        json: async () => ({ error: 'workflow already exists' }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createTeamWorkflowsClient('http://localhost:3000');

    await expect(
      client.create('token-1', {
        id: 'workflow-a',
        name: 'Workflow A',
        description: 'desc',
        version: '1',
        source: 'custom',
        entryStepId: 'step-1',
        steps: [],
        defaultBindings: {},
        tags: [],
      }),
    ).rejects.toThrow('workflow already exists');
  });

  it('update 网络异常时会转换成中文网络错误', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('Failed to fetch');
    }) as typeof fetch;

    const client = createTeamWorkflowsClient('http://localhost:3000');

    await expect(
      client.update('token-1', 'wf-1', {
        id: 'workflow-a',
        name: 'Workflow A',
        description: 'desc',
        version: '1',
        source: 'custom',
        entryStepId: 'step-1',
        steps: [],
        defaultBindings: {},
        tags: [],
      }),
    ).rejects.toThrow('网络异常，更新团队工作流失败。');
  });

  it('remove 未登录时会给出明确错误', async () => {
    const client = createTeamWorkflowsClient('http://localhost:3000');

    await expect(client.remove(null, 'wf-1')).rejects.toThrow('未登录，无法删除团队工作流。');
  });
});
