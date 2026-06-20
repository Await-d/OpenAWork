// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../stores/auth/auth.js';
import { useUIStateStore } from '../../stores/ui/uiState.js';
import { useWorkspace } from './useWorkspace.js';

const SESSION_ID = 'session-1';

function resetUIStateStore(): void {
  useUIStateStore.setState({
    ...useUIStateStore.getState(),
    activeSessionWorkspace: null,
  });
}

beforeEach(() => {
  localStorage.clear();
  resetUIStateStore();
  useAuthStore.setState({
    accessToken: 'token-test',
    email: 'qa@example.com',
    gatewayUrl: 'https://gw-a.test',
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
  resetUIStateStore();
});

describe('useWorkspace', () => {
  it('没有激活会话时 setWorkspace 抛中文错误', async () => {
    const { result } = renderHook(() => useWorkspace(null));

    await expect(result.current.setWorkspace('/workspace/demo')).rejects.toThrow(
      '当前没有激活的会话，无法绑定工作区。',
    );
  });

  it('没有激活会话时 clearWorkspace 抛中文错误', async () => {
    const { result } = renderHook(() => useWorkspace(null));

    await expect(result.current.clearWorkspace()).rejects.toThrow(
      '当前没有激活的会话，无法清空工作区。',
    );
  });

  it('reload 失败时保留已知 workingDirectory', async () => {
    let requestCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/sessions/session-1')) {
          requestCount += 1;
          if (requestCount === 1) {
            return new Response(
              JSON.stringify({
                session: {
                  id: SESSION_ID,
                  metadata_json: JSON.stringify({ workingDirectory: '/workspace/one' }),
                },
              }),
              { status: 200, headers: { 'content-type': 'application/json' } },
            );
          }
          return new Response(JSON.stringify({ error: 'session unavailable' }), {
            status: 503,
            headers: { 'content-type': 'application/json' },
          });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const { result } = renderHook(() => useWorkspace(SESSION_ID));

    await waitFor(() => {
      expect(result.current.workingDirectory).toBe('/workspace/one');
    });

    act(() => {
      useAuthStore.setState((state) => ({ ...state, gatewayUrl: 'https://gw-b.test' }));
    });

    await waitFor(() => {
      expect(result.current.error).toContain('session unavailable');
    });

    expect(result.current.workingDirectory).toBe('/workspace/one');
  });

  it('切换到其他 session 时不会继续显示上一个 session 的工作区', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/sessions/session-1')) {
          return new Response(
            JSON.stringify({
              session: {
                id: 'session-1',
                metadata_json: JSON.stringify({ workingDirectory: '/workspace/one' }),
              },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        if (url.includes('/sessions/session-2')) {
          return new Response(JSON.stringify({ error: 'session-2 unavailable' }), {
            status: 503,
            headers: { 'content-type': 'application/json' },
          });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const { result, rerender } = renderHook(
      ({ currentSessionId }: { currentSessionId: string | null }) => useWorkspace(currentSessionId),
      {
        initialProps: {
          currentSessionId: 'session-1',
        },
      },
    );

    await waitFor(() => {
      expect(result.current.workingDirectory).toBe('/workspace/one');
    });

    rerender({ currentSessionId: 'session-2' });

    await waitFor(() => {
      expect(result.current.error).toContain('session-2 unavailable');
    });

    expect(result.current.workingDirectory).toBeNull();
  });

  it('fetchFile 会读取结构化结果并带上当前 workspaceRoot', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/sessions/session-1')) {
        return new Response(
          JSON.stringify({
            session: {
              id: SESSION_ID,
              metadata_json: JSON.stringify({ workingDirectory: '/workspace/demo' }),
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.includes('/workspace/file')) {
        return new Response(
          JSON.stringify({
            content: 'export const demo = 1;',
            truncated: true,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useWorkspace(SESSION_ID));

    await waitFor(() => {
      expect(result.current.workingDirectory).toBe('/workspace/demo');
    });

    let fileResult: Awaited<ReturnType<typeof result.current.fetchFile>> | null = null;
    await act(async () => {
      fileResult = await result.current.fetchFile('/workspace/demo/src/index.ts');
    });

    expect(fileResult).toEqual({
      content: 'export const demo = 1;',
      truncated: true,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        '/workspace/file?path=%2Fworkspace%2Fdemo%2Fsrc%2Findex.ts&workspaceRoot=%2Fworkspace%2Fdemo',
      ),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer token-test',
        }),
      }),
    );
  });

  it('fetchWorkspaceRoots 在无可用根目录时抛中文错误', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/sessions/session-1')) {
          return new Response(
            JSON.stringify({
              session: {
                id: SESSION_ID,
                metadata_json: JSON.stringify({ workingDirectory: '/workspace/demo' }),
              },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        if (url.includes('/workspace/root')) {
          return new Response(JSON.stringify({ roots: [] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const { result } = renderHook(() => useWorkspace(SESSION_ID));

    await waitFor(() => {
      expect(result.current.workingDirectory).toBe('/workspace/demo');
    });

    await expect(result.current.fetchWorkspaceRoots()).rejects.toThrow(
      '当前账号下没有可用工作区根目录。',
    );
  });

  it('createDirectory 会调用工作区目录创建接口', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/sessions/session-1')) {
        return new Response(
          JSON.stringify({
            session: {
              id: SESSION_ID,
              metadata_json: JSON.stringify({ workingDirectory: '/workspace/demo' }),
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.includes('/workspace/directory')) {
        expect(init?.method).toBe('POST');
        expect(init?.body).toBe(JSON.stringify({ path: '/workspace/demo/feature' }));
        return new Response(null, { status: 204 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useWorkspace(SESSION_ID));

    await waitFor(() => {
      expect(result.current.workingDirectory).toBe('/workspace/demo');
    });

    await act(async () => {
      await result.current.createDirectory('/workspace/demo/feature');
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://gw-a.test/workspace/directory',
      expect.objectContaining({
        body: JSON.stringify({ path: '/workspace/demo/feature' }),
        headers: expect.objectContaining({
          Authorization: 'Bearer token-test',
        }),
        method: 'POST',
      }),
    );
  });
});
