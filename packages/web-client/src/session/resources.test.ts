import { afterEach, describe, expect, it, vi } from 'vitest';

import { createResourcesClient } from './resources.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('createResourcesClient', () => {
  it('listResult 成功时读取完整资源目录', async () => {
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      calls.push(typeof input === 'string' ? input : input.toString());
      return new Response(
        JSON.stringify({
          resources: {
            skills: [
              {
                id: 'com.openAwork.resource.pdf',
                name: 'pdf',
                title: 'PDF',
                description: 'PDF 处理',
                integration: 'builtin',
                visibility: 'catalog',
                feature: 'skills',
                usageKind: 'skill',
                path: '/resources/skills/builtin/pdf.md',
                content: '处理 PDF',
                capabilities: ['document.pdf'],
                permissions: [],
              },
            ],
            agents: [
              {
                id: 'oracle',
                name: 'oracle',
                displayName: 'oracle',
                description: '审查',
                color: '#6366F1',
                integration: 'builtin',
                visibility: 'catalog',
                feature: 'agents',
                usageKind: 'agent',
                path: '/resources/agents/builtin/oracle.md',
                systemPrompt: '严格审查',
              },
            ],
            agentTemplates: [
              {
                id: 'resource-agent-template-soul',
                name: 'SOUL',
                title: 'SOUL.md',
                description: '工作区人设模板',
                integration: 'reference',
                visibility: 'feature',
                feature: 'team',
                usageKind: 'agent-template',
                path: '/resources/agents/reference/templates/SOUL.md',
                content: 'SOUL 模板',
              },
            ],
            commands: [],
            souls: [
              {
                id: 'resource-soul-balanced-collaborator',
                name: 'balanced-collaborator',
                title: '稳健协作者',
                description: '通道人设',
                integration: 'reference',
                visibility: 'feature',
                feature: 'channels',
                usageKind: 'channel-persona',
                path: '/resources/souls/reference/balanced-collaborator.md',
                content: '人设内容',
              },
            ],
            prompts: [],
            extensions: [],
            mcps: [
              {
                id: 'websearch',
                name: 'websearch',
                title: 'Web Search',
                description: '联网搜索',
                integration: 'builtin',
                visibility: 'catalog',
                feature: 'mcps',
                usageKind: 'mcp-server',
                path: '/resources/mcps/builtin/websearch.json',
                transport: 'sse',
                builtinKind: 'system',
                enabledByDefault: true,
              },
            ],
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;

    const client = createResourcesClient('http://localhost:3000');
    const result = await client.listResult('token-123');

    expect(calls).toEqual(['http://localhost:3000/resources']);
    expect(result).toMatchObject({
      ok: true,
      retryable: false,
      resources: {
        skills: [
          {
            id: 'com.openAwork.resource.pdf',
            integration: 'builtin',
            visibility: 'catalog',
            feature: 'skills',
            usageKind: 'skill',
          },
        ],
        agents: [
          {
            id: 'oracle',
            color: '#6366F1',
            systemPrompt: '严格审查',
          },
        ],
        agentTemplates: [
          {
            id: 'resource-agent-template-soul',
            visibility: 'feature',
            feature: 'team',
            usageKind: 'agent-template',
          },
        ],
        souls: [
          {
            id: 'resource-soul-balanced-collaborator',
            visibility: 'feature',
            feature: 'channels',
            usageKind: 'channel-persona',
          },
        ],
        mcps: [
          {
            id: 'websearch',
            builtinKind: 'system',
          },
        ],
      },
    });
    expect(result.resources.skills[0]?.capabilities).toEqual(['document.pdf']);
  });

  it('listResult 在 HTTP 错误时返回结构化失败信息', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ error: 'resources unavailable' }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const client = createResourcesClient('http://localhost:3000');
    const result = await client.listResult('token-123');

    expect(result).toMatchObject({
      ok: false,
      retryable: true,
      errorMessage: 'resources unavailable',
      status: 503,
      resources: {
        skills: [],
        agents: [],
        mcps: [],
      },
    });
  });

  it('listResult 网络异常时会转换成中文网络错误', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('Failed to fetch');
    }) as typeof fetch;

    const client = createResourcesClient('http://localhost:3000');
    const result = await client.listResult('token-123');

    expect(result).toMatchObject({
      ok: false,
      retryable: true,
      errorMessage: '网络异常，加载资源目录失败。',
    });
  });

  it('list 在失败时抛出资源目录错误', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ data: { message: '无权读取资源目录。' } }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const client = createResourcesClient('http://localhost:3000');

    await expect(client.list('token-123')).rejects.toThrow('无权读取资源目录。');
  });
});
