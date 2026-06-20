// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import type { TeamWorkspaceSnapshot } from '@openAwork/web-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../../stores/auth/auth.js';
import {
  useHandoffStore,
  useLayerStore,
  useTeamEventsConnectionStore,
} from '../../../stores/team/team-events.js';
import {
  computeTeamWorkspaceSnapshotRetryDelay,
  formatTeamWorkspaceSnapshotLoadError,
  useTeamWorkspaceSnapshotState,
} from './use-team-workspace-snapshot-state.js';

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

function createWorkspaceSnapshot(
  sessionId: string,
  workspaceName = 'Workspace A',
): TeamWorkspaceSnapshot {
  return {
    workspace: {
      id: WORKSPACE_ID,
      name: workspaceName,
      description: null,
      visibility: 'private',
      defaultWorkingRoot: '/workspace/demo',
      defaultTeamRoster: [],
      createdByUserId: 'user-1',
      createdAt: '2026-05-26T08:00:00.000Z',
      updatedAt: '2026-05-26T08:00:00.000Z',
    },
    sessions: [
      {
        id: sessionId,
        metadataJson: '{}',
        parentSessionId: null,
        roleLayer: 'reception',
        stateStatus: 'running',
        title: 'Reception',
        updatedAt: '2026-05-26T08:00:00.000Z',
        workspacePath: '/workspace/demo',
      },
    ],
    sharedSessions: [],
    sessionShares: [],
    runtimeTaskGroups: [],
    auditLogs: [],
    clarifications: [],
    handoffs: [
      {
        id: `handoff-${sessionId}`,
        userId: 'user-1',
        fromSessionId: 'session-root',
        toSessionId: sessionId,
        fromRoleLayer: 'reception',
        toRoleLayer: 'pm1',
        payload: {},
        state: 'completed',
        claimToken: null,
        paused: false,
        claimedAt: null,
        completedAt: '2026-05-26T08:10:00.000Z',
        failureReason: null,
        retryCount: 0,
        createdAt: '2026-05-26T08:00:00.000Z',
        startedAt: '2026-05-26T08:01:00.000Z',
        updatedAt: '2026-05-26T08:10:00.000Z',
      },
    ],
    members: [],
    messages: [],
    notifications: [],
    tasks: [],
  };
}

beforeEach(() => {
  localStorage.clear();
  resetTeamEventsConnectionStore();
  useHandoffStore.getState().clear();
  useLayerStore.getState().clear();
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
  useHandoffStore.getState().clear();
  useLayerStore.getState().clear();
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

describe('computeTeamWorkspaceSnapshotRetryDelay', () => {
  it('按指数退避增长并在上限处封顶', () => {
    expect(computeTeamWorkspaceSnapshotRetryDelay(0)).toBe(2000);
    expect(computeTeamWorkspaceSnapshotRetryDelay(1)).toBe(4000);
    expect(computeTeamWorkspaceSnapshotRetryDelay(2)).toBe(8000);
    expect(computeTeamWorkspaceSnapshotRetryDelay(10)).toBe(30000);
  });
});

describe('formatTeamWorkspaceSnapshotLoadError', () => {
  it('可重试错误会提示自动重试和旧快照保留', () => {
    const message = formatTeamWorkspaceSnapshotLoadError({
      hasCachedSnapshot: true,
      nextRetryAtMs: new Date('2026-05-26T12:30:00.000Z').getTime(),
      result: {
        errorMessage: 'snapshot unavailable',
        retryable: true,
      },
    });

    expect(message).toContain('snapshot unavailable');
    expect(message).toContain('自动重试');
    expect(message).toContain('最近一次成功工作区快照');
  });
});

describe('useTeamWorkspaceSnapshotState', () => {
  it('刷新失败时保留旧快照，并在自动重试后恢复', async () => {
    vi.useFakeTimers();
    let requestCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = resolveRequestUrl(input);
        if (url === `${GATEWAY_URL}/team/workspaces/${WORKSPACE_ID}/runtime`) {
          requestCount += 1;
          if (requestCount === 2) {
            return jsonResponse({ error: 'workspace snapshot unavailable' }, 503);
          }
          return jsonResponse(
            createWorkspaceSnapshot(requestCount >= 3 ? 'session-b' : 'session-a'),
          );
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const { result } = renderHook(() => useTeamWorkspaceSnapshotState(WORKSPACE_ID));

    await flushAsyncWork();
    expect(result.current.snapshot?.sessions[0]?.id).toBe('session-a');

    act(() => {
      result.current.refresh();
    });
    await flushAsyncWork();

    expect(result.current.snapshot?.sessions[0]?.id).toBe('session-a');
    expect(result.current.error).toContain('workspace snapshot unavailable');
    expect(result.current.error).toContain('最近一次成功工作区快照');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    await flushAsyncWork();

    expect(result.current.snapshot?.sessions[0]?.id).toBe('session-b');
    expect(result.current.error).toBeNull();
  });

  it('team-events 恢复后会自动补拉工作区快照', async () => {
    let requestCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = resolveRequestUrl(input);
        if (url === `${GATEWAY_URL}/team/workspaces/${WORKSPACE_ID}/runtime`) {
          requestCount += 1;
          return jsonResponse(
            createWorkspaceSnapshot(requestCount >= 2 ? 'session-b' : 'session-a'),
          );
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const { result } = renderHook(() => useTeamWorkspaceSnapshotState(WORKSPACE_ID));

    await flushAsyncWork();
    expect(result.current.snapshot?.sessions[0]?.id).toBe('session-a');

    act(() => {
      useTeamEventsConnectionStore.setState({ lastRecoveredAt: Date.now() });
    });
    await flushAsyncWork();

    expect(result.current.snapshot?.sessions[0]?.id).toBe('session-b');
    expect(result.current.error).toBeNull();
  });

  it('成功加载快照后会同步历史层级会话和 handoff 到 team runtime stores', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = resolveRequestUrl(input);
        if (url === `${GATEWAY_URL}/team/workspaces/${WORKSPACE_ID}/runtime`) {
          return jsonResponse(createWorkspaceSnapshot('session-history'));
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    renderHook(() => useTeamWorkspaceSnapshotState(WORKSPACE_ID));

    await flushAsyncWork();

    expect(useLayerStore.getState().nodes.get('session-history')).toMatchObject({
      roleLayer: 'reception',
      state: 'running',
    });
    expect(useHandoffStore.getState().handoffs.get('handoff-session-history')).toMatchObject({
      sessionId: 'session-history',
      state: 'completed',
      toRoleLayer: 'pm1',
    });
  });
});
