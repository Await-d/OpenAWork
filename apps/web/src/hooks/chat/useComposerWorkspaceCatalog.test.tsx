// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useComposerWorkspaceCatalog } from './useComposerWorkspaceCatalog.js';

const GATEWAY_URL = 'https://gw.test';

const loggerMocks = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('../../utils/log/logger.js', () => ({
  logger: loggerMocks,
}));

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function resolveRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

async function flushAsyncWork(rounds = 6): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('useComposerWorkspaceCatalog', () => {
  it('通过 web-client 读取并整理当前会话能力目录', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(resolveRequestUrl(input)).toBe(`${GATEWAY_URL}/capabilities?sessionId=session-1`);
        expect(init?.headers).toMatchObject({
          Authorization: 'Bearer token-a',
        });
        return jsonResponse({
          capabilities: [
            {
              id: 'skill-2',
              kind: 'skill',
              label: 'Beta Skill',
              description: 'beta',
              source: 'builtin',
            },
            {
              id: 'skill-1',
              kind: 'skill',
              label: 'Alpha Skill',
              description: 'alpha',
              source: 'installed',
            },
            {
              id: 'tool-bash',
              kind: 'tool',
              label: 'bash',
              description: 'run shell',
              source: 'runtime',
              callable: true,
            },
            {
              id: 'tool-lsp',
              kind: 'tool',
              label: 'lsp_goto_definition',
              description: 'lsp',
              source: 'runtime',
              callable: true,
            },
            {
              id: 'agent-1',
              kind: 'agent',
              label: 'Planner',
              description: 'plan',
              source: 'builtin',
              callable: false,
            },
            {
              id: 'mcp-1',
              kind: 'mcp',
              label: 'Filesystem MCP',
              description: 'mcp',
              source: 'builtin',
              callable: false,
            },
          ],
        });
      }) as typeof fetch,
    );

    const { result } = renderHook(() =>
      useComposerWorkspaceCatalog({
        enabled: true,
        gatewayUrl: GATEWAY_URL,
        sessionId: 'session-1',
        token: 'token-a',
      }),
    );

    await waitFor(() => {
      expect(result.current.installedSkills).toHaveLength(2);
    });

    expect(result.current.installedSkills.map((skill) => skill.id)).toEqual(['skill-1', 'skill-2']);
    expect(result.current.agentTools.map((tool) => tool.name)).toEqual(['bash']);
    expect(result.current.agents.map((agent) => agent.id)).toEqual(['agent-1']);
    expect(result.current.mcpServers.map((mcp) => mcp.id)).toEqual(['mcp-1']);
  });

  it('重试型失败时保留旧目录并在自动重试后恢复', async () => {
    vi.useFakeTimers();
    let callCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        callCount += 1;
        if (callCount === 2) {
          return jsonResponse({ error: 'capabilities unavailable' }, 503);
        }
        return jsonResponse({
          capabilities: [
            {
              id: callCount >= 3 ? 'skill-v2' : 'skill-v1',
              kind: 'skill',
              label: callCount >= 3 ? 'Skill V2' : 'Skill V1',
              description: 'skill',
              source: 'builtin',
            },
            {
              id: callCount >= 3 ? 'agent-v2' : 'agent-v1',
              kind: 'agent',
              label: callCount >= 3 ? 'Agent V2' : 'Agent V1',
              description: 'agent',
              source: 'builtin',
              callable: false,
            },
          ],
        });
      }) as typeof fetch,
    );

    const { result, rerender } = renderHook(
      (props: { token: string }) =>
        useComposerWorkspaceCatalog({
          enabled: true,
          gatewayUrl: GATEWAY_URL,
          sessionId: 'session-1',
          token: props.token,
        }),
      {
        initialProps: { token: 'token-a' },
      },
    );

    await flushAsyncWork();
    expect(result.current.installedSkills[0]?.id).toBe('skill-v1');
    expect(result.current.agents[0]?.id).toBe('agent-v1');

    rerender({ token: 'token-b' });
    await flushAsyncWork();

    expect(result.current.installedSkills[0]?.id).toBe('skill-v1');
    expect(result.current.agents[0]?.id).toBe('agent-v1');
    expect(loggerMocks.warn).toHaveBeenCalledWith(
      'failed to load composer workspace catalog, will retry',
      expect.objectContaining({
        attempt: 1,
        delayMs: 2_000,
        error: expect.any(Error),
        gatewayUrl: GATEWAY_URL,
        sessionId: 'session-1',
      }),
    );

    await vi.advanceTimersByTimeAsync(2_000);
    await flushAsyncWork();

    expect(result.current.installedSkills[0]?.id).toBe('skill-v2');
    expect(result.current.agents[0]?.id).toBe('agent-v2');
    expect(loggerMocks.error).not.toHaveBeenCalled();
  });

  it('切换到新会话后若首次请求可重试失败，则不会继续展示旧会话目录', async () => {
    vi.useFakeTimers();
    const sessionCalls = new Map<string, number>();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(resolveRequestUrl(input));
        const sessionId = url.searchParams.get('sessionId') ?? 'none';
        const nextCount = (sessionCalls.get(sessionId) ?? 0) + 1;
        sessionCalls.set(sessionId, nextCount);

        if (sessionId === 'session-1') {
          return jsonResponse({
            capabilities: [
              {
                id: 'skill-a',
                kind: 'skill',
                label: 'Skill A',
                description: 'skill-a',
                source: 'builtin',
              },
              {
                id: 'agent-a',
                kind: 'agent',
                label: 'Agent A',
                description: 'agent-a',
                source: 'builtin',
                callable: false,
              },
            ],
          });
        }

        if (sessionId === 'session-2' && nextCount === 1) {
          return jsonResponse({ error: 'capabilities unavailable' }, 503);
        }

        return jsonResponse({
          capabilities: [
            {
              id: 'skill-b',
              kind: 'skill',
              label: 'Skill B',
              description: 'skill-b',
              source: 'builtin',
            },
            {
              id: 'agent-b',
              kind: 'agent',
              label: 'Agent B',
              description: 'agent-b',
              source: 'builtin',
              callable: false,
            },
          ],
        });
      }) as typeof fetch,
    );

    const { result, rerender } = renderHook(
      (props: { sessionId: string }) =>
        useComposerWorkspaceCatalog({
          enabled: true,
          gatewayUrl: GATEWAY_URL,
          sessionId: props.sessionId,
          token: 'token-a',
        }),
      {
        initialProps: { sessionId: 'session-1' },
      },
    );

    await flushAsyncWork();
    expect(result.current.installedSkills[0]?.id).toBe('skill-a');
    expect(result.current.agents[0]?.id).toBe('agent-a');

    rerender({ sessionId: 'session-2' });
    await flushAsyncWork();

    expect(result.current.installedSkills).toEqual([]);
    expect(result.current.agents).toEqual([]);
    expect(loggerMocks.warn).toHaveBeenCalledWith(
      'failed to load composer workspace catalog, will retry',
      expect.objectContaining({
        attempt: 1,
        delayMs: 2_000,
        error: expect.any(Error),
        gatewayUrl: GATEWAY_URL,
        sessionId: 'session-2',
      }),
    );

    await vi.advanceTimersByTimeAsync(2_000);
    await flushAsyncWork();

    expect(result.current.installedSkills[0]?.id).toBe('skill-b');
    expect(result.current.agents[0]?.id).toBe('agent-b');
  });
});
