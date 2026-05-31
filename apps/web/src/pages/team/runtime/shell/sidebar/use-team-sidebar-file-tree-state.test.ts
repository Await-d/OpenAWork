// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  computeTeamSidebarFileTreeRetryDelay,
  formatTeamSidebarFileTreeLoadError,
  useTeamSidebarFileTreeState,
} from './use-team-sidebar-file-tree-state.js';

const GATEWAY_URL = 'https://gw.test';
const ROOT_PATH = '/workspace/demo';

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

async function flushAsyncWork(rounds = 8): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function setNavigatorOnline(value: boolean): void {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    value,
  });
}

beforeEach(() => {
  localStorage.clear();
  setNavigatorOnline(true);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  localStorage.clear();
  setNavigatorOnline(true);
});

describe('computeTeamSidebarFileTreeRetryDelay', () => {
  it('按指数退避增长并在上限处封顶', () => {
    expect(computeTeamSidebarFileTreeRetryDelay(0)).toBe(2000);
    expect(computeTeamSidebarFileTreeRetryDelay(1)).toBe(4000);
    expect(computeTeamSidebarFileTreeRetryDelay(2)).toBe(8000);
    expect(computeTeamSidebarFileTreeRetryDelay(10)).toBe(30000);
  });
});

describe('formatTeamSidebarFileTreeLoadError', () => {
  it('可重试错误会提示自动重试和旧文件树保留', () => {
    const message = formatTeamSidebarFileTreeLoadError({
      hasCachedTree: true,
      nextRetryAtMs: new Date('2026-05-26T12:00:00.000Z').getTime(),
      result: {
        errorMessage: 'tree unavailable',
        retryable: true,
      },
    });

    expect(message).toContain('tree unavailable');
    expect(message).toContain('自动重试');
    expect(message).toContain('最近一次成功文件树');
  });
});

describe('useTeamSidebarFileTreeState', () => {
  it('失败时保留旧树，并在自动重试后恢复', async () => {
    vi.useFakeTimers();
    let requestCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = resolveRequestUrl(input);
        if (url.startsWith(`${GATEWAY_URL}/workspace/tree?`)) {
          requestCount += 1;
          if (requestCount === 2) {
            return jsonResponse({ error: 'tree unavailable' }, 503);
          }
          return jsonResponse({
            nodes: [
              {
                path: requestCount >= 3 ? `${ROOT_PATH}/src-new` : `${ROOT_PATH}/src`,
                name: requestCount >= 3 ? 'src-new' : 'src',
                type: 'directory',
              },
            ],
          });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const { result } = renderHook(() =>
      useTeamSidebarFileTreeState({
        active: true,
        gatewayUrl: GATEWAY_URL,
        token: 'token-1',
        workspacePath: ROOT_PATH,
      }),
    );

    await flushAsyncWork();
    expect(result.current.treeNodes[0]?.name).toBe('src');

    act(() => {
      result.current.handleRefresh();
    });
    await flushAsyncWork();

    expect(result.current.treeNodes[0]?.name).toBe('src');
    expect(result.current.treeError).toContain('tree unavailable');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    await flushAsyncWork();

    expect(result.current.treeNodes[0]?.name).toBe('src-new');
    expect(result.current.treeError).toBeNull();
  });

  it('离线时立即报错并在联网后自动补拉', async () => {
    let requestCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = resolveRequestUrl(input);
        if (url.startsWith(`${GATEWAY_URL}/workspace/tree?`)) {
          requestCount += 1;
          return jsonResponse({
            nodes: [
              {
                path: requestCount >= 2 ? `${ROOT_PATH}/src-new` : `${ROOT_PATH}/src`,
                name: requestCount >= 2 ? 'src-new' : 'src',
                type: 'directory',
              },
            ],
          });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const { result } = renderHook(() =>
      useTeamSidebarFileTreeState({
        active: true,
        gatewayUrl: GATEWAY_URL,
        token: 'token-1',
        workspacePath: ROOT_PATH,
      }),
    );

    await flushAsyncWork();
    expect(result.current.treeNodes[0]?.name).toBe('src');

    setNavigatorOnline(false);
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });

    expect(result.current.treeError).toContain('当前网络离线，文件树暂时不可用。');

    setNavigatorOnline(true);
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    await flushAsyncWork();

    expect(result.current.treeNodes[0]?.name).toBe('src-new');
    expect(result.current.treeError).toBeNull();
  });
});
