import { afterEach, describe, expect, it, vi } from 'vitest';

import { createResourcesClient } from './resources.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('createResourcesClient resource writes', () => {
  it('upload 会 POST 用户资源并解析刷新后的目录', async () => {
    const calls: Array<{ readonly url: string; readonly init?: RequestInit }> = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(
        JSON.stringify({
          resources: {
            skills: [],
            agents: [],
            agentTemplates: [],
            commands: [],
            souls: [],
            prompts: [
              {
                id: 'user-resource-1',
                name: 'daily-summary',
                title: '每日总结',
                description: '用户上传',
                integration: 'user',
                source: 'user',
                removable: true,
                path: 'user://prompts/user-resource-1',
                content: '总结今天的工作',
              },
            ],
            extensions: [],
            mcps: [],
          },
        }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;

    const client = createResourcesClient('http://localhost:3000');
    const resources = await client.upload('token-123', {
      area: 'prompts',
      name: 'daily-summary',
      title: '每日总结',
      content: '总结今天的工作',
    });

    expect(calls[0]).toMatchObject({
      url: 'http://localhost:3000/resources/uploads',
      init: {
        method: 'POST',
        headers: { Authorization: 'Bearer token-123', 'Content-Type': 'application/json' },
      },
    });
    expect(resources.prompts[0]).toMatchObject({
      id: 'user-resource-1',
      integration: 'user',
      removable: true,
      source: 'user',
    });
  });

  it('remove 会 DELETE 用户资源并解析刷新后的目录', async () => {
    const calls: Array<{ readonly url: string; readonly init?: RequestInit }> = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(
        JSON.stringify({
          resources: {
            skills: [],
            agents: [],
            agentTemplates: [],
            commands: [],
            souls: [],
            prompts: [],
            extensions: [],
            mcps: [],
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;

    const client = createResourcesClient('http://localhost:3000');
    const resources = await client.remove('token-123', 'user-resource-1');

    expect(calls[0]).toMatchObject({
      url: 'http://localhost:3000/resources/uploads/user-resource-1',
      init: {
        method: 'DELETE',
        headers: { Authorization: 'Bearer token-123' },
      },
    });
    expect(resources.prompts).toEqual([]);
  });
});
