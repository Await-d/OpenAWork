// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  computeTeamDefaultRosterRetryDelay,
  formatTeamDefaultRosterLoadError,
  useTeamDefaultRosterState,
} from './use-team-default-roster-state.js';
import { useTeamEventsConnectionStore } from '../../../../../stores/team/team-events.js';

const GATEWAY_URL = 'https://gw.test';

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

beforeEach(() => {
  localStorage.clear();
  resetTeamEventsConnectionStore();
  setNavigatorOnline(true);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  localStorage.clear();
  resetTeamEventsConnectionStore();
  setNavigatorOnline(true);
});

describe('computeTeamDefaultRosterRetryDelay', () => {
  it('按指数退避增长并在上限处封顶', () => {
    expect(computeTeamDefaultRosterRetryDelay(0)).toBe(2000);
    expect(computeTeamDefaultRosterRetryDelay(1)).toBe(4000);
    expect(computeTeamDefaultRosterRetryDelay(2)).toBe(8000);
    expect(computeTeamDefaultRosterRetryDelay(10)).toBe(30000);
  });
});

describe('formatTeamDefaultRosterLoadError', () => {
  it('可重试错误会提示自动重试和旧 roster 保留', () => {
    const message = formatTeamDefaultRosterLoadError({
      hasCachedWorkspace: true,
      nextRetryAtMs: new Date('2026-05-26T12:00:00.000Z').getTime(),
      result: {
        errorMessage: 'roster unavailable',
        retryable: true,
      },
    });

    expect(message).toContain('roster unavailable');
    expect(message).toContain('自动重试');
    expect(message).toContain('最近一次成功默认固定团队');
  });
});

describe('useTeamDefaultRosterState', () => {
  it('失败时保留旧 workspace，并在自动重试后恢复', async () => {
    vi.useFakeTimers();
    let requestCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = resolveRequestUrl(input);
        if (url === `${GATEWAY_URL}/team/workspaces/tw-1`) {
          requestCount += 1;
          if (requestCount === 2) {
            return jsonResponse({ error: 'workspace unavailable' }, 503);
          }
          return jsonResponse({
            id: 'tw-1',
            name: requestCount >= 3 ? 'Workspace B' : 'Workspace A',
            description: null,
            visibility: 'private',
            defaultWorkingRoot: '/workspace/demo',
            defaultTeamRoster: [],
            createdByUserId: 'user-1',
            createdAt: '2026-05-26T00:00:00.000Z',
            updatedAt: requestCount >= 3 ? '2026-05-26T01:00:00.000Z' : '2026-05-26T00:00:00.000Z',
          });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const { result } = renderHook(() =>
      useTeamDefaultRosterState({
        gatewayUrl: GATEWAY_URL,
        teamWorkspaceId: 'tw-1',
        token: 'token-1',
      }),
    );

    await flushAsyncWork();
    expect(result.current.workspace?.name).toBe('Workspace A');

    act(() => {
      result.current.refresh();
    });
    await flushAsyncWork();

    expect(result.current.workspace?.name).toBe('Workspace A');
    expect(result.current.error).toContain('workspace unavailable');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    await flushAsyncWork();

    expect(result.current.workspace?.name).toBe('Workspace B');
    expect(result.current.error).toBeNull();
  });

  it('离线事件会立刻提示错误，恢复联网后自动补拉', async () => {
    let requestCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = resolveRequestUrl(input);
        if (url === `${GATEWAY_URL}/team/workspaces/tw-1`) {
          requestCount += 1;
          return jsonResponse({
            id: 'tw-1',
            name: requestCount >= 2 ? 'Workspace B' : 'Workspace A',
            description: null,
            visibility: 'private',
            defaultWorkingRoot: '/workspace/demo',
            defaultTeamRoster: [],
            createdByUserId: 'user-1',
            createdAt: '2026-05-26T00:00:00.000Z',
            updatedAt: '2026-05-26T00:00:00.000Z',
          });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const { result } = renderHook(() =>
      useTeamDefaultRosterState({
        gatewayUrl: GATEWAY_URL,
        teamWorkspaceId: 'tw-1',
        token: 'token-1',
      }),
    );

    await flushAsyncWork();
    expect(result.current.workspace?.name).toBe('Workspace A');

    setNavigatorOnline(false);
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });

    expect(result.current.error).toContain('当前网络离线，默认固定团队暂时不可用。');

    setNavigatorOnline(true);
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    await flushAsyncWork();

    expect(result.current.workspace?.name).toBe('Workspace B');
    expect(result.current.error).toBeNull();
  });
});
