// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../../../stores/auth/auth.js';
import { useTeamEventsConnectionStore } from '../../../../stores/team/team-events.js';
import { useTeamWorkspaceKnowledge } from './use-team-workspace-knowledge.js';

const GATEWAY_URL = 'https://gw.test';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function resolveRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function resolveRequestMethod(input: RequestInfo | URL, init: RequestInit | undefined): string {
  if (input instanceof Request) return input.method;
  return init?.method ?? 'GET';
}

beforeEach(() => {
  useTeamEventsConnectionStore.setState({
    lastRecoveredAt: null,
  });
  useAuthStore.setState({
    accessToken: 'token-test',
    email: 'qa@example.com',
    gatewayUrl: GATEWAY_URL,
    refreshToken: null,
    tokenExpiresAt: null,
    webAccessEnabled: false,
    webExposeLan: false,
    webPort: 3000,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useTeamEventsConnectionStore.setState({
    lastRecoveredAt: null,
  });
  useAuthStore.setState({
    accessToken: null,
    email: null,
    gatewayUrl: 'http://localhost:3000',
    refreshToken: null,
    tokenExpiresAt: null,
  });
});

describe('useTeamWorkspaceKnowledge', () => {
  it('未指定层级时不把指令栈预览默认为 reception', async () => {
    const requestUrls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = resolveRequestUrl(input);
      requestUrls.push(url);

      if (url.includes('/team/artifacts')) {
        return jsonResponse({ artifacts: [] });
      }
      if (url.includes('/team/instruction-stack/preview')) {
        return jsonResponse({
          stableBlock: 'BASE STACK',
          estimatedTokens: 12,
          oversize: false,
          layers: {
            agentsMd: false,
            architectureMd: false,
            constitution: false,
            projectMemory: false,
            lessonsLearned: false,
            userMemory: false,
            workspaceKnowledge: false,
            soul: false,
          },
        });
      }
      if (url.includes('/team/workspaces/ws-1/knowledge')) {
        return jsonResponse({
          knowledge: [],
          persistedKnowledge: [],
          persistedKnowledgeTruncated: true,
          workspace: { id: 'ws-1', name: 'WS', workspaceRoot: null },
        });
      }
      return jsonResponse({}, 404);
    });

    const { result } = renderHook(() => useTeamWorkspaceKnowledge('ws-1'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    const previewUrl = requestUrls.find((url) => url.includes('/team/instruction-stack/preview'));
    expect(previewUrl).toBeDefined();
    expect(previewUrl).not.toContain('roleLayer=');
    const knowledgeUrl = requestUrls.find((url) => url.includes('/team/workspaces/ws-1/knowledge'));
    expect(knowledgeUrl).toContain('limit=1200');
    expect(result.current.persistedKnowledgeTruncated).toBe(true);
  });

  it('按当前层级拉取知识和指令栈，并在保存后刷新', async () => {
    const requestUrls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = resolveRequestUrl(input);
      const method = resolveRequestMethod(input, init);
      requestUrls.push(url);

      if (url.includes('/team/artifacts')) {
        return jsonResponse({ artifacts: [] });
      }
      if (url.includes('/team/instruction-stack/preview')) {
        return jsonResponse({
          stableBlock:
            '<team-instruction layer="workspace-knowledge:executor">执行层知识</team-instruction>',
          estimatedTokens: 42,
          oversize: false,
          layers: {
            agentsMd: false,
            architectureMd: false,
            constitution: false,
            projectMemory: false,
            lessonsLearned: false,
            userMemory: false,
            workspaceKnowledge: true,
            soul: false,
          },
        });
      }
      if (url.includes('/team/workspaces/ws-1/knowledge') && method === 'POST') {
        return jsonResponse({
          created: true,
          knowledge: {
            confidence: 1,
            createdAt: '2026-06-08T00:00:00.000Z',
            enabled: true,
            id: 'memory-1',
            key: 'artifact:spec',
            priority: 70,
            roleLayers: ['executor'],
            source: 'manual',
            teamWorkspaceId: 'ws-1',
            type: 'project_context',
            updatedAt: '2026-06-08T00:00:00.000Z',
            value: '执行层知识',
            workspaceRoot: null,
          },
        });
      }
      if (url.includes('/team/workspaces/ws-1/knowledge')) {
        return jsonResponse({
          knowledge: [],
          persistedKnowledge: [],
          workspace: { id: 'ws-1', name: 'WS', workspaceRoot: null },
        });
      }
      return jsonResponse({}, 404);
    });

    const { result } = renderHook(() =>
      useTeamWorkspaceKnowledge('ws-1', { roleLayer: 'executor', search: '执行层' }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(requestUrls.some((url) => url.includes('roleLayer=executor'))).toBe(true);
    expect(requestUrls.some((url) => url.includes('search=%E6%89%A7%E8%A1%8C%E5%B1%82'))).toBe(
      true,
    );

    await act(async () => {
      await result.current.saveKnowledge({
        key: 'artifact:spec',
        roleLayers: ['executor'],
        type: 'project_context',
        value: '执行层知识',
      });
    });

    await waitFor(() => {
      expect(
        requestUrls.filter((url) => url.includes('/team/instruction-stack/preview')).length,
      ).toBeGreaterThanOrEqual(2);
      expect(
        requestUrls.filter((url) => url.includes('/team/workspaces/ws-1/knowledge')).length,
      ).toBeGreaterThanOrEqual(3);
    });
  });

  it('同一工作区保存后刷新失败时保留刚入库的知识缓存', async () => {
    let knowledgeListCount = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = resolveRequestUrl(input);
      const method = resolveRequestMethod(input, init);

      if (url.includes('/team/artifacts')) {
        return jsonResponse({ artifacts: [] });
      }
      if (url.includes('/team/instruction-stack/preview')) {
        return jsonResponse({
          stableBlock: '',
          estimatedTokens: 0,
          oversize: false,
          layers: {
            agentsMd: false,
            architectureMd: false,
            constitution: false,
            projectMemory: false,
            lessonsLearned: false,
            userMemory: false,
            workspaceKnowledge: false,
            soul: false,
          },
        });
      }
      if (url.includes('/team/workspaces/ws-1/knowledge') && method === 'POST') {
        return jsonResponse({
          created: true,
          knowledge: knowledgeRecord({ id: 'memory-saved', roleLayers: ['executor'] }),
        });
      }
      if (url.includes('/team/workspaces/ws-1/knowledge')) {
        knowledgeListCount += 1;
        if (knowledgeListCount === 1) {
          return jsonResponse({
            knowledge: [],
            persistedKnowledge: [],
            persistedKnowledgeTruncated: false,
            workspace: { id: 'ws-1', name: 'WS', workspaceRoot: null },
          });
        }
        return jsonResponse({ error: '知识库暂时不可用' }, 503);
      }
      return jsonResponse({}, 404);
    });

    const { result } = renderHook(() =>
      useTeamWorkspaceKnowledge('ws-1', { roleLayer: 'executor' }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.saveKnowledge({
        key: 'artifact:spec',
        roleLayers: ['executor'],
        type: 'project_context',
        value: '执行层知识',
      });
    });

    await waitFor(() => expect(result.current.error).toBe('知识库暂时不可用'));
    expect(result.current.storedKnowledge.map((item) => item.id)).toEqual(['memory-saved']);
    expect(result.current.persistedKnowledge.map((item) => item.id)).toEqual(['memory-saved']);
  });

  it('透传全量入库状态，且保存当前层不可读知识时不污染当前层列表', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = resolveRequestUrl(input);
      const method = resolveRequestMethod(input, init);

      if (url.includes('/team/artifacts')) {
        return jsonResponse({ artifacts: [] });
      }
      if (url.includes('/team/instruction-stack/preview')) {
        return jsonResponse({
          stableBlock: '',
          estimatedTokens: 0,
          oversize: false,
          layers: {
            agentsMd: false,
            architectureMd: false,
            constitution: false,
            projectMemory: false,
            lessonsLearned: false,
            userMemory: false,
            workspaceKnowledge: false,
            soul: false,
          },
        });
      }
      if (url.includes('/team/workspaces/ws-1/knowledge') && method === 'POST') {
        return jsonResponse({
          created: false,
          knowledge: knowledgeRecord({ id: 'memory-pm1', roleLayers: ['pm1'] }),
        });
      }
      if (url.includes('/team/workspaces/ws-1/knowledge')) {
        return jsonResponse({
          knowledge: [],
          persistedKnowledge: [knowledgeRecord({ id: 'memory-pm1', roleLayers: ['pm1'] })],
          workspace: { id: 'ws-1', name: 'WS', workspaceRoot: null },
        });
      }
      return jsonResponse({}, 404);
    });

    const { result } = renderHook(() =>
      useTeamWorkspaceKnowledge('ws-1', { roleLayer: 'executor' }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.storedKnowledge).toEqual([]);
    expect(result.current.persistedKnowledge.map((item) => item.id)).toEqual(['memory-pm1']);

    await act(async () => {
      await result.current.saveKnowledge({
        key: 'artifact:spec',
        roleLayers: ['pm1'],
        type: 'project_context',
        value: 'PM1 知识',
      });
    });

    expect(result.current.storedKnowledge).toEqual([]);
    expect(result.current.persistedKnowledge[0]?.roleLayers).toEqual(['pm1']);
  });

  it('保存当前搜索不可见的知识时不污染当前搜索列表', async () => {
    let savedArtifact = false;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = resolveRequestUrl(input);
      const method = resolveRequestMethod(input, init);

      if (url.includes('/team/artifacts')) {
        return jsonResponse({ artifacts: [] });
      }
      if (url.includes('/team/instruction-stack/preview')) {
        return jsonResponse({
          stableBlock: '',
          estimatedTokens: 0,
          oversize: false,
          layers: {
            agentsMd: false,
            architectureMd: false,
            constitution: false,
            projectMemory: false,
            lessonsLearned: false,
            userMemory: false,
            workspaceKnowledge: false,
            soul: false,
          },
        });
      }
      if (url.includes('/team/workspaces/ws-1/knowledge') && method === 'POST') {
        savedArtifact = true;
        return jsonResponse({
          created: true,
          knowledge: knowledgeRecord({
            id: 'memory-artifact',
            key: 'artifact:spec',
            type: 'project_context',
            value: '需求规格。',
          }),
        });
      }
      if (url.includes('/team/workspaces/ws-1/knowledge')) {
        return jsonResponse({
          knowledge: [],
          persistedKnowledge: savedArtifact
            ? [
                knowledgeRecord({
                  id: 'memory-artifact',
                  key: 'artifact:spec',
                  type: 'project_context',
                  value: '需求规格。',
                }),
              ]
            : [],
          workspace: { id: 'ws-1', name: 'WS', workspaceRoot: null },
        });
      }
      return jsonResponse({}, 404);
    });

    const { result } = renderHook(() => useTeamWorkspaceKnowledge('ws-1', { search: '架构' }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.saveKnowledge({
        key: 'artifact:spec',
        type: 'project_context',
        value: '需求规格。',
      });
    });

    expect(result.current.storedKnowledge).toEqual([]);
    expect(result.current.persistedKnowledge.map((item) => item.id)).toEqual(['memory-artifact']);
  });

  it('同一工作区刷新失败时用界面搜索别名过滤缓存知识', async () => {
    let knowledgeListCount = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = resolveRequestUrl(input);

      if (url.includes('/team/artifacts')) {
        return jsonResponse({ artifacts: [] });
      }
      if (url.includes('/team/instruction-stack/preview')) {
        return jsonResponse({
          stableBlock: '',
          estimatedTokens: 0,
          oversize: false,
          layers: {
            agentsMd: false,
            architectureMd: false,
            constitution: false,
            projectMemory: false,
            lessonsLearned: false,
            userMemory: false,
            workspaceKnowledge: false,
            soul: false,
          },
        });
      }
      if (url.includes('/team/workspaces/ws-1/knowledge')) {
        knowledgeListCount += 1;
        if (knowledgeListCount === 1) {
          return jsonResponse({
            knowledge: [
              knowledgeRecord({
                id: 'memory-preference',
                type: 'preference',
                value: '默认使用中文回复。',
              }),
              knowledgeRecord({
                id: 'memory-rule',
                key: 'manual:constitution-rule',
                type: 'instruction',
                value: '所有变更都要复查。',
              }),
            ],
            persistedKnowledge: [],
            workspace: { id: 'ws-1', name: 'WS', workspaceRoot: null },
          });
        }
        return jsonResponse({ error: '知识库暂时不可用' }, 503);
      }
      return jsonResponse({}, 404);
    });

    const { result } = renderHook(() => useTeamWorkspaceKnowledge('ws-1', { search: '个人记忆' }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.storedKnowledge.map((item) => item.id)).toEqual(['memory-preference']);

    act(() => {
      useTeamEventsConnectionStore.setState({
        lastRecoveredAt: Date.now(),
      });
    });

    await waitFor(() => expect(result.current.error).toBe('知识库暂时不可用'));
    expect(result.current.storedKnowledge.map((item) => item.id)).toEqual(['memory-preference']);
  });

  it('同一工作区刷新失败时架构搜索不会泛化命中全部项目上下文缓存', async () => {
    let knowledgeListCount = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = resolveRequestUrl(input);

      if (url.includes('/team/artifacts')) {
        return jsonResponse({ artifacts: [] });
      }
      if (url.includes('/team/instruction-stack/preview')) {
        return jsonResponse({
          stableBlock: '',
          estimatedTokens: 0,
          oversize: false,
          layers: {
            agentsMd: false,
            architectureMd: false,
            constitution: false,
            projectMemory: false,
            lessonsLearned: false,
            userMemory: false,
            workspaceKnowledge: false,
            soul: false,
          },
        });
      }
      if (url.includes('/team/workspaces/ws-1/knowledge')) {
        knowledgeListCount += 1;
        if (knowledgeListCount === 1) {
          return jsonResponse({
            knowledge: [
              knowledgeRecord({
                id: 'memory-product',
                key: 'manual:product-boundary',
                type: 'project_context',
                value: '普通项目上下文。',
              }),
              knowledgeRecord({
                id: 'memory-architecture',
                key: 'manual:architecture-boundary',
                type: 'project_context',
                value: '网关统一出入口。',
              }),
            ],
            persistedKnowledge: [],
            workspace: { id: 'ws-1', name: 'WS', workspaceRoot: null },
          });
        }
        return jsonResponse({ error: '知识库暂时不可用' }, 503);
      }
      return jsonResponse({}, 404);
    });

    const { result } = renderHook(() => useTeamWorkspaceKnowledge('ws-1', { search: '架构' }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.storedKnowledge.map((item) => item.id)).toEqual(['memory-architecture']);

    act(() => {
      useTeamEventsConnectionStore.setState({
        lastRecoveredAt: Date.now(),
      });
    });

    await waitFor(() => expect(result.current.error).toBe('知识库暂时不可用'));
    expect(result.current.storedKnowledge.map((item) => item.id)).toEqual(['memory-architecture']);
  });

  it('同一工作区刷新失败时 arch 缩写不会误命中 archive 缓存', async () => {
    let knowledgeListCount = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = resolveRequestUrl(input);

      if (url.includes('/team/artifacts')) {
        return jsonResponse({ artifacts: [] });
      }
      if (url.includes('/team/instruction-stack/preview')) {
        return jsonResponse({
          stableBlock: '',
          estimatedTokens: 0,
          oversize: false,
          layers: {
            agentsMd: false,
            architectureMd: false,
            constitution: false,
            projectMemory: false,
            lessonsLearned: false,
            userMemory: false,
            workspaceKnowledge: false,
            soul: false,
          },
        });
      }
      if (url.includes('/team/workspaces/ws-1/knowledge')) {
        knowledgeListCount += 1;
        if (knowledgeListCount === 1) {
          return jsonResponse({
            knowledge: [
              knowledgeRecord({
                id: 'memory-archive',
                key: 'manual:archive-policy',
                type: 'project_context',
                value: '归档策略。',
              }),
              knowledgeRecord({
                id: 'memory-arch',
                key: 'manual:arch-boundary',
                type: 'project_context',
                value: '模块边界。',
              }),
              knowledgeRecord({
                id: 'memory-architecture',
                key: 'manual:architecture-boundary',
                type: 'project_context',
                value: '网关统一出入口。',
              }),
            ],
            persistedKnowledge: [],
            workspace: { id: 'ws-1', name: 'WS', workspaceRoot: null },
          });
        }
        return jsonResponse({ error: '知识库暂时不可用' }, 503);
      }
      return jsonResponse({}, 404);
    });

    const { result } = renderHook(() => useTeamWorkspaceKnowledge('ws-1', { search: 'arch' }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.storedKnowledge.map((item) => item.id)).toEqual([
      'memory-arch',
      'memory-architecture',
    ]);

    act(() => {
      useTeamEventsConnectionStore.setState({
        lastRecoveredAt: Date.now(),
      });
    });

    await waitFor(() => expect(result.current.error).toBe('知识库暂时不可用'));
    expect(result.current.storedKnowledge.map((item) => item.id)).toEqual([
      'memory-arch',
      'memory-architecture',
    ]);
  });

  it('同一工作区刷新失败时 fact 搜索不会误命中 artifact 缓存', async () => {
    let knowledgeListCount = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = resolveRequestUrl(input);

      if (url.includes('/team/artifacts')) {
        return jsonResponse({ artifacts: [] });
      }
      if (url.includes('/team/instruction-stack/preview')) {
        return jsonResponse({
          stableBlock: '',
          estimatedTokens: 0,
          oversize: false,
          layers: {
            agentsMd: false,
            architectureMd: false,
            constitution: false,
            projectMemory: false,
            lessonsLearned: false,
            userMemory: false,
            workspaceKnowledge: false,
            soul: false,
          },
        });
      }
      if (url.includes('/team/workspaces/ws-1/knowledge')) {
        knowledgeListCount += 1;
        if (knowledgeListCount === 1) {
          return jsonResponse({
            knowledge: [
              knowledgeRecord({
                id: 'memory-artifact',
                key: 'artifact:spec-1',
                type: 'project_context',
                value: '需求规格。',
              }),
              knowledgeRecord({
                id: 'memory-fact',
                key: 'manual:release-fact',
                type: 'fact',
                value: '仓库采用 pnpm。',
              }),
            ],
            persistedKnowledge: [],
            workspace: { id: 'ws-1', name: 'WS', workspaceRoot: null },
          });
        }
        return jsonResponse({ error: '知识库暂时不可用' }, 503);
      }
      return jsonResponse({}, 404);
    });

    const { result } = renderHook(() => useTeamWorkspaceKnowledge('ws-1', { search: 'fact' }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.storedKnowledge.map((item) => item.id)).toEqual(['memory-fact']);

    act(() => {
      useTeamEventsConnectionStore.setState({
        lastRecoveredAt: Date.now(),
      });
    });

    await waitFor(() => expect(result.current.error).toBe('知识库暂时不可用'));
    expect(result.current.storedKnowledge.map((item) => item.id)).toEqual(['memory-fact']);
  });

  it('同一工作区刷新失败时项目记忆搜索会排除产物和架构缓存', async () => {
    let knowledgeListCount = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = resolveRequestUrl(input);

      if (url.includes('/team/artifacts')) {
        return jsonResponse({ artifacts: [] });
      }
      if (url.includes('/team/instruction-stack/preview')) {
        return jsonResponse({
          stableBlock: '',
          estimatedTokens: 0,
          oversize: false,
          layers: {
            agentsMd: false,
            architectureMd: false,
            constitution: false,
            projectMemory: false,
            lessonsLearned: false,
            userMemory: false,
            workspaceKnowledge: false,
            soul: false,
          },
        });
      }
      if (url.includes('/team/workspaces/ws-1/knowledge')) {
        knowledgeListCount += 1;
        if (knowledgeListCount === 1) {
          return jsonResponse({
            knowledge: [
              knowledgeRecord({
                id: 'memory-project',
                key: 'manual:project-root',
                type: 'project_context',
                value: '模块边界说明。',
              }),
              knowledgeRecord({
                id: 'memory-rule',
                key: 'manual:constitution-rule',
                type: 'instruction',
                value: '所有变更需要复查。',
              }),
              knowledgeRecord({
                id: 'memory-artifact',
                key: 'artifact:spec-1',
                type: 'project_context',
                value: '需求规格。',
              }),
              knowledgeRecord({
                id: 'memory-manual-artifact',
                key: 'manual:artifact-plan',
                type: 'project_context',
                value: '实施计划。',
              }),
              knowledgeRecord({
                id: 'memory-architecture',
                key: 'manual:architecture-boundary',
                type: 'project_context',
                value: '网关统一出入口。',
              }),
              knowledgeRecord({
                id: 'memory-fact',
                key: 'manual:release-fact',
                type: 'fact',
                value: '仓库采用 pnpm。',
              }),
            ],
            persistedKnowledge: [],
            workspace: { id: 'ws-1', name: 'WS', workspaceRoot: null },
          });
        }
        return jsonResponse({ error: '知识库暂时不可用' }, 503);
      }
      return jsonResponse({}, 404);
    });

    const { result } = renderHook(() => useTeamWorkspaceKnowledge('ws-1', { search: '项目记忆' }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.storedKnowledge.map((item) => item.id)).toEqual(['memory-project']);

    act(() => {
      useTeamEventsConnectionStore.setState({
        lastRecoveredAt: Date.now(),
      });
    });

    await waitFor(() => expect(result.current.error).toBe('知识库暂时不可用'));
    expect(result.current.storedKnowledge.map((item) => item.id)).toEqual(['memory-project']);
  });

  it('同一工作区刷新失败时产物搜索不会泛化命中全部项目上下文缓存', async () => {
    let knowledgeListCount = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = resolveRequestUrl(input);

      if (url.includes('/team/artifacts')) {
        return jsonResponse({ artifacts: [] });
      }
      if (url.includes('/team/instruction-stack/preview')) {
        return jsonResponse({
          stableBlock: '',
          estimatedTokens: 0,
          oversize: false,
          layers: {
            agentsMd: false,
            architectureMd: false,
            constitution: false,
            projectMemory: false,
            lessonsLearned: false,
            userMemory: false,
            workspaceKnowledge: false,
            soul: false,
          },
        });
      }
      if (url.includes('/team/workspaces/ws-1/knowledge')) {
        knowledgeListCount += 1;
        if (knowledgeListCount === 1) {
          return jsonResponse({
            knowledge: [
              knowledgeRecord({
                id: 'memory-product',
                key: 'manual:product-boundary',
                type: 'project_context',
                value: '普通项目上下文。',
              }),
              knowledgeRecord({
                id: 'memory-archive',
                key: 'manual:archive-policy',
                type: 'project_context',
                value: '归档策略。',
              }),
              knowledgeRecord({
                id: 'memory-manual-artifact',
                key: 'manual:artifact-plan',
                type: 'project_context',
                value: '实施计划。',
              }),
              knowledgeRecord({
                id: 'memory-artifact',
                key: 'artifact:spec-1',
                type: 'project_context',
                value: '需求规格。',
              }),
            ],
            persistedKnowledge: [],
            workspace: { id: 'ws-1', name: 'WS', workspaceRoot: null },
          });
        }
        return jsonResponse({ error: '知识库暂时不可用' }, 503);
      }
      return jsonResponse({}, 404);
    });

    const { result } = renderHook(() => useTeamWorkspaceKnowledge('ws-1', { search: '产物' }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.storedKnowledge.map((item) => item.id)).toEqual([
      'memory-manual-artifact',
      'memory-artifact',
    ]);

    act(() => {
      useTeamEventsConnectionStore.setState({
        lastRecoveredAt: Date.now(),
      });
    });

    await waitFor(() => expect(result.current.error).toBe('知识库暂时不可用'));
    expect(result.current.storedKnowledge.map((item) => item.id)).toEqual([
      'memory-manual-artifact',
      'memory-artifact',
    ]);
  });

  it('同一工作区刷新失败时完整图谱入口保留全部缓存知识', async () => {
    let knowledgeListCount = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = resolveRequestUrl(input);

      if (url.includes('/team/artifacts')) {
        return jsonResponse({ artifacts: [] });
      }
      if (url.includes('/team/instruction-stack/preview')) {
        return jsonResponse({
          stableBlock: '',
          estimatedTokens: 0,
          oversize: false,
          layers: {
            agentsMd: false,
            architectureMd: false,
            constitution: false,
            projectMemory: false,
            lessonsLearned: false,
            userMemory: false,
            workspaceKnowledge: false,
            soul: false,
          },
        });
      }
      if (url.includes('/team/workspaces/ws-1/knowledge')) {
        knowledgeListCount += 1;
        if (knowledgeListCount === 1) {
          return jsonResponse({
            knowledge: [
              knowledgeRecord({ id: 'memory-alpha', value: 'alpha 知识。' }),
              knowledgeRecord({ id: 'memory-beta', value: 'beta 知识。' }),
            ],
            persistedKnowledge: [],
            workspace: { id: 'ws-1', name: 'WS', workspaceRoot: null },
          });
        }
        return jsonResponse({ error: '知识库暂时不可用' }, 503);
      }
      return jsonResponse({}, 404);
    });

    const { result } = renderHook(() => useTeamWorkspaceKnowledge('ws-1', { search: '完整图谱' }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.storedKnowledge.map((item) => item.id)).toEqual([
      'memory-alpha',
      'memory-beta',
    ]);

    act(() => {
      useTeamEventsConnectionStore.setState({
        lastRecoveredAt: Date.now(),
      });
    });

    await waitFor(() => expect(result.current.error).toBe('知识库暂时不可用'));
    expect(result.current.storedKnowledge.map((item) => item.id)).toEqual([
      'memory-alpha',
      'memory-beta',
    ]);
  });

  it('从窄查询切回完整图谱且刷新失败时使用全量入库缓存兜底', async () => {
    let knowledgeListCount = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = resolveRequestUrl(input);

      if (url.includes('/team/artifacts')) {
        return jsonResponse({ artifacts: [] });
      }
      if (url.includes('/team/instruction-stack/preview')) {
        return jsonResponse({
          stableBlock: '',
          estimatedTokens: 0,
          oversize: false,
          layers: {
            agentsMd: false,
            architectureMd: false,
            constitution: false,
            projectMemory: false,
            lessonsLearned: false,
            userMemory: false,
            workspaceKnowledge: false,
            soul: false,
          },
        });
      }
      if (url.includes('/team/workspaces/ws-1/knowledge')) {
        knowledgeListCount += 1;
        if (knowledgeListCount === 1) {
          return jsonResponse({
            knowledge: [
              knowledgeRecord({
                id: 'memory-architecture',
                key: 'manual:architecture-boundary',
                type: 'project_context',
                value: '网关统一出入口。',
              }),
            ],
            persistedKnowledge: [
              knowledgeRecord({
                id: 'memory-project',
                key: 'manual:project-root',
                type: 'project_context',
                value: '模块边界说明。',
              }),
              knowledgeRecord({
                id: 'memory-architecture',
                key: 'manual:architecture-boundary',
                type: 'project_context',
                value: '网关统一出入口。',
              }),
            ],
            workspace: { id: 'ws-1', name: 'WS', workspaceRoot: null },
          });
        }
        return jsonResponse({ error: '知识库暂时不可用' }, 503);
      }
      return jsonResponse({}, 404);
    });

    const { rerender, result } = renderHook(
      ({ search }: { search: string }) => useTeamWorkspaceKnowledge('ws-1', { search }),
      { initialProps: { search: '架构' } },
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.storedKnowledge.map((item) => item.id)).toEqual(['memory-architecture']);

    rerender({ search: '完整图谱' });

    await waitFor(() => expect(result.current.error).toBe('知识库暂时不可用'));
    expect(result.current.storedKnowledge.map((item) => item.id)).toEqual([
      'memory-project',
      'memory-architecture',
    ]);
  });

  it('同一工作区刷新失败时层级词只按指定层级范围过滤缓存', async () => {
    let knowledgeListCount = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = resolveRequestUrl(input);

      if (url.includes('/team/artifacts')) {
        return jsonResponse({ artifacts: [] });
      }
      if (url.includes('/team/instruction-stack/preview')) {
        return jsonResponse({
          stableBlock: '',
          estimatedTokens: 0,
          oversize: false,
          layers: {
            agentsMd: false,
            architectureMd: false,
            constitution: false,
            projectMemory: false,
            lessonsLearned: false,
            userMemory: false,
            workspaceKnowledge: false,
            soul: false,
          },
        });
      }
      if (url.includes('/team/workspaces/ws-1/knowledge')) {
        knowledgeListCount += 1;
        if (knowledgeListCount === 1) {
          return jsonResponse({
            knowledge: [
              knowledgeRecord({
                id: 'memory-global',
                key: 'manual:global-context',
                roleLayers: null,
                value: '所有层级可读。',
              }),
              knowledgeRecord({
                id: 'memory-pm1',
                key: 'manual:pm1-context',
                roleLayers: ['pm1'],
                value: 'PM1 层专用规划约束。',
              }),
              knowledgeRecord({
                id: 'memory-reviewer',
                key: 'manual:reviewer-note',
                roleLayers: ['reviewer'],
                value: '正文提到 PM1，但只给评审层读取。',
              }),
            ],
            persistedKnowledge: [],
            workspace: { id: 'ws-1', name: 'WS', workspaceRoot: null },
          });
        }
        return jsonResponse({ error: '知识库暂时不可用' }, 503);
      }
      return jsonResponse({}, 404);
    });

    const { result } = renderHook(() => useTeamWorkspaceKnowledge('ws-1', { search: 'pm1' }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.storedKnowledge.map((item) => item.id)).toEqual(['memory-pm1']);

    act(() => {
      useTeamEventsConnectionStore.setState({
        lastRecoveredAt: Date.now(),
      });
    });

    await waitFor(() => expect(result.current.error).toBe('知识库暂时不可用'));
    expect(result.current.storedKnowledge.map((item) => item.id)).toEqual(['memory-pm1']);
  });
});

function knowledgeRecord(
  overrides: Partial<{
    id: string;
    key: string;
    roleLayers: Array<'reception' | 'pm1' | 'pm2' | 'executor' | 'reviewer'> | null;
    type: 'preference' | 'fact' | 'instruction' | 'project_context' | 'learned_pattern';
    value: string;
  }> = {},
) {
  return {
    confidence: 1,
    createdAt: '2026-06-08T00:00:00.000Z',
    enabled: true,
    id: overrides.id ?? 'memory-1',
    key: overrides.key ?? 'artifact:spec',
    priority: 70,
    roleLayers: overrides.roleLayers ?? null,
    source: 'manual',
    teamWorkspaceId: 'ws-1',
    type: overrides.type ?? 'project_context',
    updatedAt: '2026-06-08T00:00:00.000Z',
    value: overrides.value ?? 'PM1 知识',
    workspaceRoot: null,
  };
}
