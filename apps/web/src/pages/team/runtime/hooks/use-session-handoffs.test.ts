// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import type { HandoffRecord } from '@openAwork/web-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../../../stores/auth/auth.js';
import {
  useHandoffStore,
  useLayerStore,
  useTeamEventsConnectionStore,
  useTeamNotificationStore,
} from '../../../../stores/team/team-events.js';
import {
  computeSessionHandoffsRetryDelay,
  formatSessionHandoffsLoadError,
  useSessionHandoffs,
} from './use-session-handoffs.js';

const GATEWAY_URL = 'https://gw.test';
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

async function flushAsyncWork(rounds = 8): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function createHandoff(id: string, overrides: Partial<HandoffRecord> = {}): HandoffRecord {
  return {
    id,
    userId: 'user-1',
    fromSessionId: SESSION_ID,
    fromRoleLayer: 'pm1',
    toRoleLayer: 'pm2',
    toSessionId: 'session-2',
    payload: {},
    state: 'running',
    claimToken: null,
    claimedAt: null,
    startedAt: '2026-05-26T08:00:00.000Z',
    completedAt: null,
    failureReason: null,
    retryCount: 0,
    createdAt: '2026-05-26T08:00:00.000Z',
    updatedAt: '2026-05-26T08:00:00.000Z',
    ...overrides,
  };
}

function resetTeamStores(): void {
  useHandoffStore.getState().clear();
  useLayerStore.getState().clear();
  useTeamNotificationStore.getState().clear();
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

function setNavigatorOnline(value: boolean): void {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    value,
  });
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

describe('computeSessionHandoffsRetryDelay', () => {
  it('按指数退避增长，并在上限封顶', () => {
    expect(computeSessionHandoffsRetryDelay(0)).toBe(2000);
    expect(computeSessionHandoffsRetryDelay(1)).toBe(4000);
    expect(computeSessionHandoffsRetryDelay(2)).toBe(8000);
    expect(computeSessionHandoffsRetryDelay(10)).toBe(15000);
  });
});

describe('formatSessionHandoffsLoadError', () => {
  it('可重试错误会提示自动重试和保留快照', () => {
    const message = formatSessionHandoffsLoadError({
      nextRetryAtMs: new Date('2026-05-25T12:00:00.000Z').getTime(),
      result: {
        handoffs: [],
        ok: false,
        retryable: true,
        errorMessage: '网关超时',
      },
    });

    expect(message).toContain('网关超时');
    expect(message).toContain('自动重试');
    expect(message).toContain('最近一次成功快照');
  });

  it('不可重试错误只返回基础错误信息', () => {
    expect(
      formatSessionHandoffsLoadError({
        result: {
          handoffs: [],
          ok: false,
          retryable: false,
          errorMessage: '认证失效',
          status: 401,
        },
      }),
    ).toBe('认证失效');
  });
});

describe('useSessionHandoffs', () => {
  it('初次挂载不会因为 realtime effect 再额外重拉一次', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = resolveRequestUrl(input);
      if (url === `${GATEWAY_URL}/team/sessions/${SESSION_ID}/handoffs`) {
        return jsonResponse({ handoffs: [createHandoff('handoff-1')] });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useSessionHandoffs(SESSION_ID));

    await flushAsyncWork();
    expect(result.current.handoffs.map((record) => record.id)).toEqual(['handoff-1']);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    await flushAsyncWork();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('失败后保留旧快照并在自动重试后恢复', async () => {
    vi.useFakeTimers();
    let requestCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = resolveRequestUrl(input);
        if (url === `${GATEWAY_URL}/team/sessions/${SESSION_ID}/handoffs`) {
          requestCount += 1;
          if (requestCount === 1) {
            return jsonResponse({ handoffs: [createHandoff('handoff-a')] });
          }
          if (requestCount === 2) {
            return jsonResponse({ error: '网关超时' }, 503);
          }
          return jsonResponse({ handoffs: [createHandoff('handoff-b')] });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const { result } = renderHook(() => useSessionHandoffs(SESSION_ID));

    await flushAsyncWork();
    expect(result.current.handoffs.map((record) => record.id)).toEqual(['handoff-a']);

    act(() => {
      result.current.refresh();
    });
    await flushAsyncWork();

    expect(result.current.handoffs.map((record) => record.id)).toEqual(['handoff-a']);
    expect(result.current.error).toContain('网关超时');
    expect(result.current.error).toContain('最近一次成功快照');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    await flushAsyncWork();

    expect(result.current.handoffs.map((record) => record.id)).toEqual(['handoff-b']);
    expect(result.current.error).toBeNull();
  });

  it('离线事件会立刻提示错误，恢复联网后自动补拉', async () => {
    let requestCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = resolveRequestUrl(input);
        if (url === `${GATEWAY_URL}/team/sessions/${SESSION_ID}/handoffs`) {
          requestCount += 1;
          return jsonResponse({
            handoffs: [createHandoff(requestCount === 1 ? 'handoff-a' : 'handoff-b')],
          });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const { result } = renderHook(() => useSessionHandoffs(SESSION_ID));

    await flushAsyncWork();
    expect(result.current.handoffs.map((record) => record.id)).toEqual(['handoff-a']);

    setNavigatorOnline(false);
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });

    expect(result.current.handoffs.map((record) => record.id)).toEqual(['handoff-a']);
    expect(result.current.error).toContain('当前网络离线，handoff 列表暂时不可用。');
    expect(result.current.error).toContain('最近一次成功快照');

    setNavigatorOnline(true);
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    await flushAsyncWork();

    expect(result.current.handoffs.map((record) => record.id)).toEqual(['handoff-b']);
    expect(result.current.error).toBeNull();
  });

  it('team-events 重连恢复后会自动补拉 handoff 快照', async () => {
    let requestCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = resolveRequestUrl(input);
        if (url === `${GATEWAY_URL}/team/sessions/${SESSION_ID}/handoffs`) {
          requestCount += 1;
          return jsonResponse({
            handoffs: [createHandoff(requestCount === 1 ? 'handoff-a' : 'handoff-b')],
          });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const { result } = renderHook(() => useSessionHandoffs(SESSION_ID));

    await flushAsyncWork();
    expect(result.current.handoffs.map((record) => record.id)).toEqual(['handoff-a']);

    act(() => {
      useTeamEventsConnectionStore.setState({ lastRecoveredAt: Date.now() });
    });
    await flushAsyncWork();

    expect(result.current.handoffs.map((record) => record.id)).toEqual(['handoff-b']);
    expect(result.current.error).toBeNull();
  });

  it('applyPreview 会合并新 handoff，并移除已不再属于当前 session 的旧记录', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = resolveRequestUrl(input);
        if (url === `${GATEWAY_URL}/team/sessions/${SESSION_ID}/handoffs`) {
          return jsonResponse({
            handoffs: [
              createHandoff('handoff-a', {
                fromSessionId: 'pm1-session',
                toSessionId: SESSION_ID,
                toRoleLayer: 'pm2',
              }),
            ],
          });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const { result } = renderHook(() => useSessionHandoffs(SESSION_ID));

    await flushAsyncWork();
    expect(result.current.handoffs.map((record) => record.id)).toEqual(['handoff-a']);

    act(() => {
      result.current.applyPreview([
        createHandoff('handoff-a', {
          fromSessionId: 'pm1-session',
          toSessionId: null,
          state: 'pending',
          toRoleLayer: 'pm2',
        }),
        createHandoff('handoff-b', {
          fromSessionId: SESSION_ID,
          toSessionId: 'pm1-replay',
          fromRoleLayer: 'reception',
          toRoleLayer: 'pm1',
          state: 'pending',
        }),
      ]);
    });

    expect(result.current.handoffs.map((record) => record.id)).toEqual(['handoff-b']);
    expect(result.current.handoffs[0]).toMatchObject({
      fromSessionId: SESSION_ID,
      id: 'handoff-b',
      state: 'pending',
      toRoleLayer: 'pm1',
    });
    expect(useHandoffStore.getState().handoffs.get('handoff-a')).toMatchObject({
      id: 'handoff-a',
      sessionId: 'pm1-session',
      state: 'pending',
      toRoleLayer: 'pm2',
    });
    expect(useHandoffStore.getState().handoffs.get('handoff-b')).toMatchObject({
      id: 'handoff-b',
      sessionId: 'pm1-replay',
      state: 'pending',
      toRoleLayer: 'pm1',
    });
  });
});
