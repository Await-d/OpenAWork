// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../../../../stores/auth/auth.js';
import { useTeamEventsConnectionStore } from '../../../../../stores/team/team-events.js';
import {
  computeTeamArtifactsRetryDelay,
  formatTeamArtifactsLoadError,
  useTeamArtifactData,
} from './use-team-artifact-data.js';

const GATEWAY_URL = 'https://gw.test';
const PM1_SESSION_ID = 'pm1-session';
const PM2_SESSION_ID = 'pm2-session';

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

async function flushAsyncWork(rounds = 10): Promise<void> {
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

function createArtifact(id: string, phase: string, content: string) {
  return {
    id,
    content,
    phase,
    title: `${phase}-${id}`,
  };
}

function getPhaseKey(url: string): string {
  const parsed = new URL(url);
  const phase = parsed.searchParams.get('phase');
  const sessionId = parsed.searchParams.get('sessionId');
  return `${phase ?? 'none'}:${sessionId ?? 'none'}`;
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

describe('computeTeamArtifactsRetryDelay', () => {
  it('按指数退避增长并在上限处封顶', () => {
    expect(computeTeamArtifactsRetryDelay(0)).toBe(2000);
    expect(computeTeamArtifactsRetryDelay(1)).toBe(4000);
    expect(computeTeamArtifactsRetryDelay(2)).toBe(8000);
    expect(computeTeamArtifactsRetryDelay(10)).toBe(30000);
  });
});

describe('formatTeamArtifactsLoadError', () => {
  it('可重试错误会提示自动重试和旧产物链保留', () => {
    const message = formatTeamArtifactsLoadError({
      hasCachedArtifacts: true,
      nextRetryAtMs: new Date('2026-05-26T12:00:00.000Z').getTime(),
      result: {
        errorMessage: 'artifact unavailable',
        retryable: true,
      },
    });

    expect(message).toContain('artifact unavailable');
    expect(message).toContain('自动重试');
    expect(message).toContain('最近一次成功产物链');
  });
});

describe('useTeamArtifactData', () => {
  it('单个 phase 失败时保留旧产物，并在自动重试后恢复', async () => {
    vi.useFakeTimers();
    const requestCount = new Map<string, number>();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = resolveRequestUrl(input);
        const phaseKey = getPhaseKey(url);
        requestCount.set(phaseKey, (requestCount.get(phaseKey) ?? 0) + 1);
        const count = requestCount.get(phaseKey) ?? 0;

        if (phaseKey === `spec:${PM1_SESSION_ID}`) {
          if (count === 2) {
            return jsonResponse({ error: 'spec unavailable' }, 503);
          }
          return jsonResponse({
            artifacts: [createArtifact(count >= 3 ? 'spec-b' : 'spec-a', 'spec', `spec-${count}`)],
          });
        }
        if (phaseKey === `plan:${PM1_SESSION_ID}`) {
          return jsonResponse({ artifacts: [createArtifact('plan-a', 'plan', 'plan')] });
        }
        if (phaseKey === `tasks:${PM1_SESSION_ID}`) {
          return jsonResponse({ artifacts: [createArtifact('tasks-a', 'tasks', 'tasks')] });
        }
        if (phaseKey === `review:${PM2_SESSION_ID}`) {
          return jsonResponse({ artifacts: [createArtifact('review-a', 'review', 'review')] });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const { result } = renderHook(() =>
      useTeamArtifactData({
        pm1ArtifactSessionId: PM1_SESSION_ID,
        pm2ArtifactSessionId: PM2_SESSION_ID,
      }),
    );

    await flushAsyncWork();
    expect(result.current.specArtifact?.id).toBe('spec-a');
    expect(result.current.planArtifact?.id).toBe('plan-a');
    expect(result.current.reviewArtifact?.id).toBe('review-a');

    act(() => {
      result.current.refreshArtifacts();
    });
    await flushAsyncWork();

    expect(result.current.specArtifact?.id).toBe('spec-a');
    expect(result.current.artifactError).toContain('spec');
    expect(result.current.artifactError).toContain('spec unavailable');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    await flushAsyncWork();

    expect(result.current.specArtifact?.id).toBe('spec-b');
    expect(result.current.artifactError).toBeNull();
  });

  it('离线事件会立刻提示错误，恢复联网后自动补拉', async () => {
    const requestCount = new Map<string, number>();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = resolveRequestUrl(input);
        const phaseKey = getPhaseKey(url);
        requestCount.set(phaseKey, (requestCount.get(phaseKey) ?? 0) + 1);
        const count = requestCount.get(phaseKey) ?? 0;

        if (phaseKey === `spec:${PM1_SESSION_ID}`) {
          return jsonResponse({
            artifacts: [createArtifact(count >= 2 ? 'spec-b' : 'spec-a', 'spec', 'spec')],
          });
        }
        if (phaseKey === `plan:${PM1_SESSION_ID}`) {
          return jsonResponse({ artifacts: [createArtifact('plan-a', 'plan', 'plan')] });
        }
        if (phaseKey === `tasks:${PM1_SESSION_ID}`) {
          return jsonResponse({ artifacts: [createArtifact('tasks-a', 'tasks', 'tasks')] });
        }
        if (phaseKey === `review:${PM2_SESSION_ID}`) {
          return jsonResponse({ artifacts: [createArtifact('review-a', 'review', 'review')] });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const { result } = renderHook(() =>
      useTeamArtifactData({
        pm1ArtifactSessionId: PM1_SESSION_ID,
        pm2ArtifactSessionId: PM2_SESSION_ID,
      }),
    );

    await flushAsyncWork();
    expect(result.current.specArtifact?.id).toBe('spec-a');

    setNavigatorOnline(false);
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });

    expect(result.current.artifactError).toContain('当前网络离线，团队产物链暂时不可用。');
    expect(result.current.specArtifact?.id).toBe('spec-a');

    setNavigatorOnline(true);
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    await flushAsyncWork();

    expect(result.current.specArtifact?.id).toBe('spec-b');
    expect(result.current.artifactError).toBeNull();
  });

  it('会优先选择指定的 review artifact，而不是会话下的最新一条', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = resolveRequestUrl(input);
        const phaseKey = getPhaseKey(url);

        if (phaseKey === `spec:${PM1_SESSION_ID}`) {
          return jsonResponse({ artifacts: [] });
        }
        if (phaseKey === `plan:${PM1_SESSION_ID}`) {
          return jsonResponse({ artifacts: [] });
        }
        if (phaseKey === `tasks:${PM1_SESSION_ID}`) {
          return jsonResponse({ artifacts: [] });
        }
        if (phaseKey === `review:${PM2_SESSION_ID}`) {
          return jsonResponse({
            artifacts: [
              createArtifact('review-latest', 'review', '最新评审正文'),
              createArtifact('review-target', 'review', '目标评审正文'),
            ],
          });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const { result } = renderHook(() =>
      useTeamArtifactData({
        pm1ArtifactSessionId: PM1_SESSION_ID,
        pm2ArtifactSessionId: PM2_SESSION_ID,
        preferredReviewArtifactId: 'review-target',
      }),
    );

    await flushAsyncWork();

    expect(result.current.reviewArtifact?.id).toBe('review-target');
    expect(result.current.reviewArtifact?.content).toBe('目标评审正文');
  });

  it('传入 preferredArtifactCreatedBeforeMs 时，会回看指定时间点之前最近的产物', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = resolveRequestUrl(input);
        const phaseKey = getPhaseKey(url);

        if (phaseKey === `spec:${PM1_SESSION_ID}`) {
          return jsonResponse({
            artifacts: [
              {
                ...createArtifact('spec-new', 'spec', '新版本 spec'),
                createdAt: '2026-06-17T11:40:00.000Z',
              },
              {
                ...createArtifact('spec-old', 'spec', '旧版本 spec'),
                createdAt: '2026-06-17T07:35:00.000Z',
              },
            ],
          });
        }
        if (phaseKey === `plan:${PM1_SESSION_ID}`) {
          return jsonResponse({ artifacts: [] });
        }
        if (phaseKey === `tasks:${PM1_SESSION_ID}`) {
          return jsonResponse({ artifacts: [] });
        }
        if (phaseKey === `review:${PM2_SESSION_ID}`) {
          return jsonResponse({ artifacts: [] });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const { result } = renderHook(() =>
      useTeamArtifactData({
        pm1ArtifactSessionId: PM1_SESSION_ID,
        pm2ArtifactSessionId: PM2_SESSION_ID,
        preferredArtifactCreatedBeforeMs: Date.parse('2026-06-17T08:00:00.000Z'),
      }),
    );

    await flushAsyncWork();

    expect(result.current.specArtifact?.id).toBe('spec-old');
    expect(result.current.specArtifact?.content).toBe('旧版本 spec');
  });
});
