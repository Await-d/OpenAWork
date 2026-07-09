// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../stores/auth/auth.js';
import { useResourceCatalog } from './useResourceCatalog.js';

const GATEWAY_URL = 'https://gw.test';

function resetAuthStore(accessToken: string | null): void {
  useAuthStore.setState({
    accessToken,
    email: accessToken ? 'qa@example.com' : null,
    gatewayUrl: GATEWAY_URL,
    refreshToken: null,
    tokenExpiresAt: null,
    webAccessEnabled: false,
    webExposeLan: false,
    webPort: 3000,
  });
}

beforeEach(() => {
  localStorage.clear();
  resetAuthStore('token-test');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  resetAuthStore(null);
});

describe('useResourceCatalog', () => {
  it('通过 web-client 动态读取 /resources 目录', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(`${GATEWAY_URL}/resources`);
      expect(init?.headers).toMatchObject({
        Authorization: 'Bearer token-test',
      });
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
                integration: 'builtin',
                path: '/resources/agents/builtin/oracle.md',
                systemPrompt: '严格审查',
              },
            ],
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
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useResourceCatalog());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBeNull();
    expect(result.current.resources.skills[0]?.id).toBe('com.openAwork.resource.pdf');
    expect(result.current.resources.agents[0]?.systemPrompt).toBe('严格审查');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('没有登录 token 时返回空目录且不请求网关', async () => {
    resetAuthStore(null);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useResourceCatalog());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBeNull();
    expect(result.current.resources.skills).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('上传资源后立即使用返回目录刷新状态', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/resources/uploads')) {
        expect(init?.method).toBe('POST');
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
                  path: 'user://prompts/user-resource-1',
                  source: 'user',
                  removable: true,
                  content: '总结今天的工作',
                },
              ],
              extensions: [],
              mcps: [],
            },
          }),
          { status: 201, headers: { 'content-type': 'application/json' } },
        );
      }
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
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useResourceCatalog());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await result.current.uploadResource({
      area: 'prompts',
      name: 'daily-summary',
      title: '每日总结',
      content: '总结今天的工作',
    });

    await waitFor(() => {
      expect(result.current.resources.prompts[0]).toMatchObject({
        id: 'user-resource-1',
        integration: 'user',
        removable: true,
      });
    });
  });

  it('删除资源后立即使用返回目录刷新状态', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/resources/uploads/user-resource-1')) {
        expect(init?.method).toBe('DELETE');
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
      }
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
                path: 'user://prompts/user-resource-1',
                source: 'user',
                removable: true,
                content: '总结今天的工作',
              },
            ],
            extensions: [],
            mcps: [],
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useResourceCatalog());

    await waitFor(() => {
      expect(result.current.resources.prompts).toHaveLength(1);
    });

    await result.current.removeResource('user-resource-1');

    await waitFor(() => {
      expect(result.current.resources.prompts).toEqual([]);
    });
  });
});
