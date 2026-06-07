// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import type {
  SharedSessionDetailRecord,
  SharedSessionPresenceRecord,
  TeamRuntimeReadModel,
} from '@openAwork/web-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../../stores/auth/auth.js';
import {
  useClarificationStore,
  useHandoffStore,
  useLayerStore,
  useTeamEventsConnectionStore,
  useTeamNotificationStore,
} from '../../../stores/team/team-events.js';
import { useTeamToolCallStore } from '../../../stores/team/team-usage.js';
import {
  computeSharedSessionDetailRetryDelay,
  computeSharedSessionPresenceRetryDelay,
  computeTeamRuntimeSnapshotRetryDelay,
  formatSharedSessionDetailLoadError,
  formatSharedSessionPresenceLoadError,
  formatTeamRuntimeLoadError,
  useTeamCollaboration,
} from './use-team-collaboration.js';

const GATEWAY_URL = 'https://gw.test';
const TEAM_WORKSPACE_ID = 'team-1';
const SESSION_ID = 'session-1';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
    },
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

function resetTeamStores(): void {
  useHandoffStore.getState().clear();
  useLayerStore.getState().clear();
  useTeamNotificationStore.getState().clear();
  useClarificationStore.getState().clear();
  useTeamToolCallStore.getState().clear();
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

function createRuntimeFixture(overrides: Partial<TeamRuntimeReadModel> = {}): TeamRuntimeReadModel {
  return {
    auditLogs: [],
    clarifications: [],
    diagnostics: undefined,
    handoffs: [],
    members: [],
    messages: [],
    notifications: [],
    runtimeTaskGroups: [],
    sessionShares: [],
    sessions: [],
    sharedSessions: [],
    tasks: [],
    ...overrides,
  };
}

interface SharedDetailFixtureInput {
  comments?: SharedSessionDetailRecord['comments'];
  pendingPermissions?: SharedSessionDetailRecord['pendingPermissions'];
  pendingQuestions?: SharedSessionDetailRecord['pendingQuestions'];
  presence?: SharedSessionDetailRecord['presence'];
  session?: Partial<SharedSessionDetailRecord['session']>;
  share?: Partial<SharedSessionDetailRecord['share']>;
}

function createSharedDetailFixture(
  overrides: SharedDetailFixtureInput = {},
): SharedSessionDetailRecord {
  const sessionId = overrides.share?.sessionId ?? overrides.session?.id ?? SESSION_ID;
  return {
    comments: overrides.comments ?? [],
    pendingPermissions: overrides.pendingPermissions ?? [],
    pendingQuestions: overrides.pendingQuestions ?? [],
    presence: overrides.presence ?? [],
    share: {
      sessionId,
      title: '共享会话',
      stateStatus: 'running',
      workspacePath: '/workspace/demo',
      sharedByEmail: 'owner@example.com',
      permission: 'operate',
      createdAt: '2026-05-26T08:00:00.000Z',
      updatedAt: '2026-05-26T08:00:00.000Z',
      shareCreatedAt: '2026-05-26T08:05:00.000Z',
      shareUpdatedAt: '2026-05-26T08:05:00.000Z',
      ...overrides.share,
    },
    session: {
      id: sessionId,
      title: '共享会话',
      state_status: 'running',
      messages: [],
      ...overrides.session,
    },
  };
}

function createSharedPresence(viewerEmail = 'viewer@example.com'): SharedSessionPresenceRecord {
  return {
    active: true,
    firstSeenAt: '2026-05-26T08:10:00.000Z',
    lastSeenAt: '2026-05-26T08:12:00.000Z',
    viewerEmail,
    viewerUserId: 'viewer-1',
  };
}

beforeEach(() => {
  localStorage.clear();
  resetTeamStores();
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
  resetTeamStores();
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

describe('computeTeamRuntimeSnapshotRetryDelay', () => {
  it('按指数退避增长并在上限处封顶', () => {
    expect(computeTeamRuntimeSnapshotRetryDelay(0)).toBe(2000);
    expect(computeTeamRuntimeSnapshotRetryDelay(1)).toBe(4000);
    expect(computeTeamRuntimeSnapshotRetryDelay(2)).toBe(8000);
    expect(computeTeamRuntimeSnapshotRetryDelay(10)).toBe(30000);
  });
});

describe('formatTeamRuntimeLoadError', () => {
  it('可重试错误会提示自动重试和旧快照保留', () => {
    const message = formatTeamRuntimeLoadError({
      hasCachedSnapshot: true,
      nextRetryAtMs: new Date('2026-05-26T12:00:00.000Z').getTime(),
      result: {
        errorMessage: 'team runtime unavailable',
        retryable: true,
      },
    });

    expect(message).toContain('team runtime unavailable');
    expect(message).toContain('自动重试');
    expect(message).toContain('最近一次成功快照');
  });

  it('不可重试错误只保留基础错误文案', () => {
    expect(
      formatTeamRuntimeLoadError({
        hasCachedSnapshot: false,
        result: {
          errorMessage: '认证失效',
          retryable: false,
        },
      }),
    ).toBe('认证失效');
  });
});

describe('computeSharedSessionDetailRetryDelay', () => {
  it('按指数退避增长并在上限处封顶', () => {
    expect(computeSharedSessionDetailRetryDelay(0)).toBe(2000);
    expect(computeSharedSessionDetailRetryDelay(1)).toBe(4000);
    expect(computeSharedSessionDetailRetryDelay(2)).toBe(8000);
    expect(computeSharedSessionDetailRetryDelay(10)).toBe(15000);
  });
});

describe('computeSharedSessionPresenceRetryDelay', () => {
  it('presence 重试按指数退避增长并在上限处封顶', () => {
    expect(computeSharedSessionPresenceRetryDelay(0)).toBe(5000);
    expect(computeSharedSessionPresenceRetryDelay(1)).toBe(10000);
    expect(computeSharedSessionPresenceRetryDelay(2)).toBe(20000);
    expect(computeSharedSessionPresenceRetryDelay(10)).toBe(30000);
  });
});

describe('formatSharedSessionPresenceLoadError', () => {
  it('优先使用共享会话在线状态错误文案', () => {
    expect(
      formatSharedSessionPresenceLoadError({
        errorMessage: 'presence unavailable',
        retryable: true,
      }),
    ).toBe('presence unavailable');
  });

  it('缺省时使用默认 presence 文案', () => {
    expect(
      formatSharedSessionPresenceLoadError({
        errorMessage: '',
        retryable: false,
      }),
    ).toBe('共享会话在线状态暂时无法刷新。');
  });
});

describe('formatSharedSessionDetailLoadError', () => {
  it('可重试错误会提示自动重试和旧详情保留', () => {
    const message = formatSharedSessionDetailLoadError({
      hasCachedDetail: true,
      nextRetryAtMs: new Date('2026-05-26T12:30:00.000Z').getTime(),
      result: {
        errorMessage: 'shared detail unavailable',
        retryable: true,
      },
    });

    expect(message).toContain('shared detail unavailable');
    expect(message).toContain('自动重试');
    expect(message).toContain('最近一次成功详情');
  });

  it('不可重试错误只保留基础错误文案', () => {
    expect(
      formatSharedSessionDetailLoadError({
        hasCachedDetail: false,
        result: {
          errorMessage: '共享会话不存在',
          retryable: false,
        },
      }),
    ).toBe('共享会话不存在');
  });

  it('可重试且有旧详情时会提示保留最近一次成功详情', () => {
    const message = formatSharedSessionDetailLoadError({
      hasCachedDetail: true,
      result: {
        errorMessage: 'presence sync failed',
        retryable: true,
      },
    });

    expect(message).toContain('presence sync failed');
    expect(message).toContain('最近一次成功详情');
  });
});

describe('useTeamCollaboration', () => {
  it('runtime 快照里的 sessions.paused 会保留到前端状态', async () => {
    const runtime = createRuntimeFixture({
      sessions: [
        {
          id: SESSION_ID,
          metadataJson: '{}',
          parentSessionId: null,
          paused: true,
          roleLayer: 'pm1',
          stateStatus: 'running',
          title: '暂停中的会话',
          updatedAt: '2026-05-26T08:00:00.000Z',
          workspacePath: '/workspace/demo',
        },
      ],
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = resolveRequestUrl(input);
        if (url === `${GATEWAY_URL}/team/runtime?teamWorkspaceId=${TEAM_WORKSPACE_ID}`) {
          return jsonResponse(runtime);
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const { result } = renderHook(() => useTeamCollaboration(TEAM_WORKSPACE_ID));

    await flushAsyncWork();

    expect(result.current.sessions).toEqual([
      expect.objectContaining({
        id: SESSION_ID,
        paused: true,
        stateStatus: 'running',
      }),
    ]);
  });

  it('runtime 快照里的 toolCallRecords 会回灌到工具统计 store', async () => {
    const runtime = createRuntimeFixture({
      usageRecords: [
        {
          sessionId: SESSION_ID,
          layer: 'pm1',
          agentId: 'agent-reader',
          provider: null,
          model: null,
          inputTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          costUsd: 0,
          callCount: 0,
          totalDurationMs: 0,
          toolCallCount: 2,
          toolErrorCount: 1,
          updatedAt: '2026-05-26T08:00:00.000Z',
        },
      ],
      toolCallRecords: [
        {
          sessionId: SESSION_ID,
          layer: 'pm1',
          agentId: 'agent-reader',
          toolName: 'read',
          invocations: 2,
          successes: 1,
          failures: 1,
          totalDurationMs: 210,
          durations: [90, 120],
          errorSamples: [{ errorType: 'timeout', count: 1 }],
        },
      ],
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = resolveRequestUrl(input);
        if (url === `${GATEWAY_URL}/team/runtime?teamWorkspaceId=${TEAM_WORKSPACE_ID}`) {
          return jsonResponse(runtime);
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    renderHook(() => useTeamCollaboration(TEAM_WORKSPACE_ID));

    await flushAsyncWork();

    const toolState = useTeamToolCallStore.getState();
    expect(toolState.byTool.get('read')).toMatchObject({
      invocations: 2,
      failures: 1,
      totalDurationMs: 210,
      errorSamples: [{ errorType: 'timeout', count: 1 }],
    });
    expect(toolState.bySessionTool.get(SESSION_ID)?.get('read')?.durations).toEqual([90, 120]);
    expect(toolState.byAgent.get('agent-reader')?.get('read')).toBe(2);
  });

  it('runtime 刷新失败时保留旧快照并在定时器触发后自动恢复', async () => {
    vi.useFakeTimers();
    const firstRuntime = createRuntimeFixture({
      members: [
        {
          id: 'member-1',
          name: 'Alice',
          email: 'alice@example.com',
          role: 'member',
          avatarUrl: null,
          status: 'working',
          createdAt: '2026-05-26T08:00:00.000Z',
        },
      ],
    });
    const recoveredRuntime = createRuntimeFixture({
      members: [
        {
          id: 'member-2',
          name: 'Bob',
          email: 'bob@example.com',
          role: 'member',
          avatarUrl: null,
          status: 'idle',
          createdAt: '2026-05-26T08:10:00.000Z',
        },
      ],
    });
    let runtimeCallCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = resolveRequestUrl(input);
        if (url === `${GATEWAY_URL}/team/runtime?teamWorkspaceId=${TEAM_WORKSPACE_ID}`) {
          runtimeCallCount += 1;
          if (runtimeCallCount === 1) {
            return jsonResponse(firstRuntime);
          }
          if (runtimeCallCount === 2) {
            return jsonResponse({ error: 'runtime unavailable' }, 503);
          }
          return jsonResponse(recoveredRuntime);
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const { result } = renderHook(() => useTeamCollaboration(TEAM_WORKSPACE_ID));

    await flushAsyncWork();
    expect(result.current.members.map((member) => member.name)).toEqual(['Alice']);

    let refreshOk = true;
    await act(async () => {
      refreshOk = await result.current.refresh();
    });

    expect(refreshOk).toBe(false);
    expect(result.current.members.map((member) => member.name)).toEqual(['Alice']);
    expect(result.current.error).toContain('runtime unavailable');
    expect(result.current.error).toContain('最近一次成功快照');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    await flushAsyncWork();
    expect(result.current.members.map((member) => member.name)).toEqual(['Bob']);
    expect(result.current.error).toBeNull();
  });

  it('共享详情重拉失败时保留当前详情，并在自动重试后恢复', async () => {
    vi.useFakeTimers();
    const runtime = createRuntimeFixture({
      sharedSessions: [
        {
          sessionId: SESSION_ID,
          title: '共享会话',
          stateStatus: 'running',
          workspacePath: '/workspace/demo',
          sharedByEmail: 'owner@example.com',
          permission: 'operate',
          createdAt: '2026-05-26T08:00:00.000Z',
          updatedAt: '2026-05-26T08:00:00.000Z',
          shareCreatedAt: '2026-05-26T08:05:00.000Z',
          shareUpdatedAt: '2026-05-26T08:05:00.000Z',
        },
      ],
    });
    const firstDetail = createSharedDetailFixture();
    const recoveredDetail = createSharedDetailFixture({
      comments: [
        {
          authorEmail: 'reviewer@example.com',
          content: '已恢复',
          createdAt: '2026-05-26T08:20:00.000Z',
          id: 'comment-1',
          sessionId: SESSION_ID,
        },
      ],
    });
    let detailCallCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = resolveRequestUrl(input);
        if (url === `${GATEWAY_URL}/team/runtime?teamWorkspaceId=${TEAM_WORKSPACE_ID}`) {
          return jsonResponse(runtime);
        }
        if (url === `${GATEWAY_URL}/sessions/shared-with-me/${SESSION_ID}`) {
          detailCallCount += 1;
          if (detailCallCount === 1) {
            return jsonResponse(firstDetail);
          }
          if (detailCallCount === 2) {
            return jsonResponse({ error: 'shared detail unavailable' }, 503);
          }
          return jsonResponse(recoveredDetail);
        }
        if (url === `${GATEWAY_URL}/sessions/shared-with-me/${SESSION_ID}/presence`) {
          return jsonResponse({ presence: [] });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const { result } = renderHook(() => useTeamCollaboration(TEAM_WORKSPACE_ID));

    await flushAsyncWork();
    expect(result.current.selectedSharedSession?.share.sessionId).toBe(SESSION_ID);
    expect(result.current.selectedSharedSession?.comments).toHaveLength(0);

    act(() => {
      useTeamEventsConnectionStore.setState({ lastRecoveredAt: Date.now() });
    });
    await flushAsyncWork();
    expect(result.current.sharedOperateError).toContain('shared detail unavailable');
    expect(result.current.sharedOperateError).toContain('最近一次成功详情');
    expect(result.current.selectedSharedSession?.share.sessionId).toBe(SESSION_ID);
    expect(result.current.selectedSharedSession?.comments).toHaveLength(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    await flushAsyncWork();
    expect(result.current.selectedSharedSession?.comments).toHaveLength(1);
    expect(result.current.sharedOperateError).toBeNull();
  });

  it('presence 同步失败时不会误报 lastSyncedAt，并在重试成功后更新', async () => {
    vi.useFakeTimers();
    const runtime = createRuntimeFixture({
      sharedSessions: [
        {
          sessionId: SESSION_ID,
          title: '共享会话',
          stateStatus: 'running',
          workspacePath: '/workspace/demo',
          sharedByEmail: 'owner@example.com',
          permission: 'operate',
          createdAt: '2026-05-26T08:00:00.000Z',
          updatedAt: '2026-05-26T08:00:00.000Z',
          shareCreatedAt: '2026-05-26T08:05:00.000Z',
          shareUpdatedAt: '2026-05-26T08:05:00.000Z',
        },
      ],
    });
    let presenceCallCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = resolveRequestUrl(input);
        if (url === `${GATEWAY_URL}/team/runtime?teamWorkspaceId=${TEAM_WORKSPACE_ID}`) {
          return jsonResponse(runtime);
        }
        if (url === `${GATEWAY_URL}/sessions/shared-with-me/${SESSION_ID}`) {
          return jsonResponse(createSharedDetailFixture());
        }
        if (url === `${GATEWAY_URL}/sessions/shared-with-me/${SESSION_ID}/presence`) {
          presenceCallCount += 1;
          if (presenceCallCount === 1) {
            return jsonResponse({ error: 'presence unavailable' }, 503);
          }
          return jsonResponse({ presence: [createSharedPresence()] });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const { result } = renderHook(() => useTeamCollaboration(TEAM_WORKSPACE_ID));

    await flushAsyncWork();
    expect(result.current.selectedSharedSession?.share.sessionId).toBe(SESSION_ID);

    await flushAsyncWork();
    expect(result.current.sharedPresenceError).toBe('presence unavailable');
    expect(result.current.sharedPresenceLastSyncedAt).toBeNull();
    expect(result.current.sharedPresenceNextRetryAt).not.toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    await flushAsyncWork();
    expect(result.current.sharedPresenceError).toBeNull();
    expect(result.current.sharedPresenceLastSyncedAt).not.toBeNull();
    expect(result.current.selectedSharedSession?.presence[0]?.viewerEmail).toBe(
      'viewer@example.com',
    );
  });

  it('关闭 autoSelectSharedSession 后不会默认选中第一条共享会话', async () => {
    const runtime = createRuntimeFixture({
      sharedSessions: [
        {
          sessionId: SESSION_ID,
          title: '共享会话',
          stateStatus: 'running',
          workspacePath: '/workspace/demo',
          sharedByEmail: 'owner@example.com',
          permission: 'operate',
          createdAt: '2026-05-26T08:00:00.000Z',
          updatedAt: '2026-05-26T08:00:00.000Z',
          shareCreatedAt: '2026-05-26T08:05:00.000Z',
          shareUpdatedAt: '2026-05-26T08:05:00.000Z',
        },
      ],
    });
    let sharedDetailCallCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = resolveRequestUrl(input);
        if (url === `${GATEWAY_URL}/team/runtime?teamWorkspaceId=${TEAM_WORKSPACE_ID}`) {
          return jsonResponse(runtime);
        }
        if (url === `${GATEWAY_URL}/sessions/shared-with-me/${SESSION_ID}`) {
          sharedDetailCallCount += 1;
          return jsonResponse(createSharedDetailFixture());
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const { result } = renderHook(() =>
      useTeamCollaboration(TEAM_WORKSPACE_ID, { autoSelectSharedSession: false }),
    );

    await flushAsyncWork();

    expect(result.current.selectedSharedSessionId).toBeNull();
    expect(result.current.selectedSharedSession).toBeNull();
    expect(sharedDetailCallCount).toBe(0);
  });

  it('共享列表暂空时，保留显式选中的共享会话并继续拉取详情', async () => {
    const runtime = createRuntimeFixture({
      sharedSessions: [],
    });
    let sharedDetailCallCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = resolveRequestUrl(input);
        if (url === `${GATEWAY_URL}/team/runtime?teamWorkspaceId=${TEAM_WORKSPACE_ID}`) {
          return jsonResponse(runtime);
        }
        if (url === `${GATEWAY_URL}/sessions/shared-with-me/${SESSION_ID}`) {
          sharedDetailCallCount += 1;
          return jsonResponse(createSharedDetailFixture());
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const { result } = renderHook(() =>
      useTeamCollaboration(TEAM_WORKSPACE_ID, { autoSelectSharedSession: false }),
    );

    await flushAsyncWork();

    await act(async () => {
      result.current.setSelectedSharedSessionId(SESSION_ID);
    });
    await flushAsyncWork();

    expect(result.current.selectedSharedSessionId).toBe(SESSION_ID);
    expect(result.current.selectedSharedSession?.share.sessionId).toBe(SESSION_ID);
    expect(sharedDetailCallCount).toBe(1);
  });
});
