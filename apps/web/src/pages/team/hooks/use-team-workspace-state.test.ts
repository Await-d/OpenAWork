// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import type { TeamWorkspaceDetail, TeamWorkspaceSummary } from '@openAwork/web-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../../stores/auth/auth.js';
import { useTeamEventsConnectionStore } from '../../../stores/team/team-events.js';
import {
  computeTeamWorkspaceStateRetryDelay,
  formatTeamWorkspaceStateLoadError,
  useTeamWorkspaceState,
} from './use-team-workspace-state.js';

const GATEWAY_URL = 'https://gw.test';
const WORKSPACE_ID = 'tw-1';

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

function resetTeamEventsConnectionStore(): void {
  useTeamEventsConnectionStore.setState({
    lastCloseCode: null,
    lastError: null,
    lastOpenAt: null,
    lastProtocolErrorCode: null,
    lastRecoveredAt: null,
    nextRetryAt: null,
    reconnectAttempt: 0,
    state: 'idle',
  });
}

function createWorkspaceSummary(
  id: string,
  name: string,
  overrides: Partial<TeamWorkspaceSummary> = {},
): TeamWorkspaceSummary {
  return {
    id,
    name,
    description: null,
    visibility: 'private',
    defaultWorkingRoot: '/workspace/demo',
    defaultTeamRoster: [],
    createdByUserId: 'user-1',
    createdAt: '2026-05-26T08:00:00.000Z',
    updatedAt: '2026-05-26T08:00:00.000Z',
    ...overrides,
  };
}

function createWorkspaceDetail(
  id: string,
  name: string,
  overrides: Partial<TeamWorkspaceDetail> = {},
): TeamWorkspaceDetail {
  return createWorkspaceSummary(id, name, overrides);
}

beforeEach(() => {
  localStorage.clear();
  resetTeamEventsConnectionStore();
  setNavigatorOnline(true);
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
  vi.useRealTimers();
  localStorage.clear();
  resetTeamEventsConnectionStore();
  setNavigatorOnline(true);
  useAuthStore.setState({
    accessToken: null,
    email: null,
    gatewayUrl: 'http://localhost:3000',
    refreshToken: null,
    tokenExpiresAt: null,
    webAccessEnabled: false,
    webExposeLan: false,
    webPort: 3000,
  });
});

describe('computeTeamWorkspaceStateRetryDelay', () => {
  it('按指数退避增长并在上限处封顶', () => {
    expect(computeTeamWorkspaceStateRetryDelay(0)).toBe(2000);
    expect(computeTeamWorkspaceStateRetryDelay(1)).toBe(4000);
    expect(computeTeamWorkspaceStateRetryDelay(2)).toBe(8000);
    expect(computeTeamWorkspaceStateRetryDelay(10)).toBe(30000);
  });
});

describe('formatTeamWorkspaceStateLoadError', () => {
  it('可重试错误会提示自动重试和旧工作区数据保留', () => {
    const message = formatTeamWorkspaceStateLoadError({
      hasCachedWorkspaceData: true,
      nextRetryAtMs: new Date('2026-05-26T12:00:00.000Z').getTime(),
      result: {
        errorMessage: 'workspace unavailable',
        retryable: true,
      },
    });

    expect(message).toContain('workspace unavailable');
    expect(message).toContain('自动重试');
    expect(message).toContain('最近一次成功工作区数据');
  });
});

describe('useTeamWorkspaceState', () => {
  it('刷新失败时保留旧工作区数据，并在自动重试后恢复', async () => {
    vi.useFakeTimers();
    let listCallCount = 0;
    let detailCallCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = resolveRequestUrl(input);
        if (url === `${GATEWAY_URL}/team/workspaces`) {
          listCallCount += 1;
          if (listCallCount === 2) {
            return jsonResponse({ error: 'workspace list unavailable' }, 503);
          }
          return jsonResponse([
            createWorkspaceSummary(
              WORKSPACE_ID,
              listCallCount >= 3 ? 'Workspace B' : 'Workspace A',
            ),
          ]);
        }
        if (url === `${GATEWAY_URL}/team/workspaces/${WORKSPACE_ID}`) {
          detailCallCount += 1;
          return jsonResponse(
            createWorkspaceDetail(
              WORKSPACE_ID,
              detailCallCount >= 2 ? 'Workspace B' : 'Workspace A',
            ),
          );
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const { result } = renderHook(() => useTeamWorkspaceState(WORKSPACE_ID));

    await flushAsyncWork();
    expect(result.current.workspaces[0]?.name).toBe('Workspace A');
    expect(result.current.activeWorkspace?.name).toBe('Workspace A');

    act(() => {
      result.current.refresh();
    });
    await flushAsyncWork();

    expect(result.current.workspaces[0]?.name).toBe('Workspace A');
    expect(result.current.activeWorkspace?.name).toBe('Workspace A');
    expect(result.current.error).toContain('workspace list unavailable');
    expect(result.current.error).toContain('最近一次成功工作区数据');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    await flushAsyncWork();

    expect(result.current.workspaces[0]?.name).toBe('Workspace B');
    expect(result.current.activeWorkspace?.name).toBe('Workspace B');
    expect(result.current.error).toBeNull();
  });

  it('离线事件会立刻提示错误，恢复联网后自动补拉', async () => {
    let detailCallCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = resolveRequestUrl(input);
        if (url === `${GATEWAY_URL}/team/workspaces`) {
          return jsonResponse([createWorkspaceSummary(WORKSPACE_ID, 'Workspace A')]);
        }
        if (url === `${GATEWAY_URL}/team/workspaces/${WORKSPACE_ID}`) {
          detailCallCount += 1;
          return jsonResponse(
            createWorkspaceDetail(
              WORKSPACE_ID,
              detailCallCount >= 2 ? 'Workspace B' : 'Workspace A',
            ),
          );
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const { result } = renderHook(() => useTeamWorkspaceState(WORKSPACE_ID));

    await flushAsyncWork();
    expect(result.current.activeWorkspace?.name).toBe('Workspace A');

    setNavigatorOnline(false);
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });

    expect(result.current.activeWorkspace?.name).toBe('Workspace A');
    expect(result.current.error).toContain('当前网络离线，团队工作区暂时不可用。');
    expect(result.current.error).toContain('最近一次成功工作区数据');

    setNavigatorOnline(true);
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    await flushAsyncWork();

    expect(result.current.activeWorkspace?.name).toBe('Workspace B');
    expect(result.current.error).toBeNull();
  });
});
