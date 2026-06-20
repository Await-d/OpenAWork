// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { createTeamPhaseAClient } from '@openAwork/web-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTeamEventsConnectionStore } from '../../../../../stores/team/team-events.js';
import {
  computeTeamPhaseASettingsRetryDelay,
  formatTeamPhaseASettingsLoadError,
  useRecoverableConstitutionRead,
  useRecoverableForceApplyStateRead,
  useInstructionStackPreviewRead,
  useRecoverablePersonaRead,
  useRecoverableUserMemoryRead,
} from './use-team-phase-a-settings-read-model.js';

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

describe('computeTeamPhaseASettingsRetryDelay', () => {
  it('按指数退避增长并在上限处封顶', () => {
    expect(computeTeamPhaseASettingsRetryDelay(0)).toBe(2000);
    expect(computeTeamPhaseASettingsRetryDelay(1)).toBe(4000);
    expect(computeTeamPhaseASettingsRetryDelay(2)).toBe(8000);
    expect(computeTeamPhaseASettingsRetryDelay(10)).toBe(30000);
  });
});

describe('formatTeamPhaseASettingsLoadError', () => {
  it('可重试错误会提示自动重试和旧数据保留', () => {
    const message = formatTeamPhaseASettingsLoadError({
      baseMessage: 'constitution unavailable',
      hasRetainedData: true,
      nextRetryAtMs: new Date('2026-05-26T12:00:00.000Z').getTime(),
      retainedDataLabel: '宪法数据',
      retryable: true,
    });

    expect(message).toContain('constitution unavailable');
    expect(message).toContain('自动重试');
    expect(message).toContain('最近一次成功宪法数据');
  });
});

describe('useRecoverableConstitutionRead', () => {
  it('失败时保留旧宪法数据，并在自动重试后恢复', async () => {
    vi.useFakeTimers();
    const client = createTeamPhaseAClient(GATEWAY_URL);
    let constitutionCallCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = resolveRequestUrl(input);
        if (url === `${GATEWAY_URL}/team/workspaces/tw-1/constitution`) {
          constitutionCallCount += 1;
          if (constitutionCallCount === 2) {
            return jsonResponse({ error: 'constitution unavailable' }, 503);
          }
          return jsonResponse({
            teamWorkspaceId: 'tw-1',
            body: constitutionCallCount >= 3 ? 'constitution-b' : 'constitution-a',
            version: constitutionCallCount >= 3 ? 2 : 1,
            updatedAt: '2026-05-26T00:00:00.000Z',
          });
        }
        if (url === `${GATEWAY_URL}/team/constitution-templates`) {
          return jsonResponse({
            templates: [
              { id: 'tpl-1', name: '模板', description: 'desc', recommendedFor: '', body: 'body' },
            ],
          });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const { result } = renderHook(() =>
      useRecoverableConstitutionRead({
        client,
        teamWorkspaceId: 'tw-1',
        token: 'token-1',
      }),
    );

    await flushAsyncWork();
    expect(result.current.constitution?.body).toBe('constitution-a');
    expect(result.current.templates).toHaveLength(1);

    act(() => {
      result.current.refresh();
    });
    await flushAsyncWork();

    expect(result.current.constitution?.body).toBe('constitution-a');
    expect(result.current.error).toContain('constitution unavailable');
    expect(result.current.error).toContain('最近一次成功宪法数据');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    await flushAsyncWork();

    expect(result.current.constitution?.body).toBe('constitution-b');
    expect(result.current.error).toBeNull();
  });
});

describe('useRecoverableUserMemoryRead', () => {
  it('离线事件会立刻提示错误，恢复联网后自动补拉', async () => {
    const client = createTeamPhaseAClient(GATEWAY_URL);
    let requestCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = resolveRequestUrl(input);
        if (url === `${GATEWAY_URL}/team/user-memory`) {
          requestCount += 1;
          return jsonResponse({ body: requestCount >= 2 ? 'memory-b' : 'memory-a' });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const { result } = renderHook(() =>
      useRecoverableUserMemoryRead({
        client,
        token: 'token-1',
      }),
    );

    await flushAsyncWork();
    expect(result.current.memory?.body).toBe('memory-a');

    setNavigatorOnline(false);
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });

    expect(result.current.error).toContain('当前网络离线，个人长期记忆暂时不可用。');

    setNavigatorOnline(true);
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    await flushAsyncWork();

    expect(result.current.memory?.body).toBe('memory-b');
    expect(result.current.error).toBeNull();
  });
});

describe('useRecoverablePersonaRead', () => {
  it('切换 layer 后失败不会错误保留上一层 SOUL，并在重试后恢复', async () => {
    vi.useFakeTimers();
    const client = createTeamPhaseAClient(GATEWAY_URL);
    const calls = new Map<string, number>();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = resolveRequestUrl(input);
        const key = url;
        calls.set(key, (calls.get(key) ?? 0) + 1);
        const count = calls.get(key) ?? 0;

        if (url === `${GATEWAY_URL}/team/personas/reception?key=default`) {
          return jsonResponse({
            roleLayer: 'reception',
            key: 'default',
            persona: null,
            effective: { soulMd: 'reception-soul', isDefault: true },
          });
        }
        if (url === `${GATEWAY_URL}/team/personas/pm1?key=default`) {
          if (count === 1) {
            return jsonResponse({ error: 'persona unavailable' }, 503);
          }
          return jsonResponse({
            roleLayer: 'pm1',
            key: 'default',
            persona: null,
            effective: { soulMd: 'pm1-soul', isDefault: true },
          });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const { result, rerender } = renderHook(
      ({ layer }: { layer: 'reception' | 'pm1' }) =>
        useRecoverablePersonaRead({
          client,
          roleLayer: layer,
          token: 'token-1',
        }),
      {
        initialProps: { layer: 'reception' as 'reception' | 'pm1' },
      },
    );

    await flushAsyncWork();
    expect(result.current.personaResponse?.effective.soulMd).toBe('reception-soul');

    rerender({ layer: 'pm1' });
    await flushAsyncWork();

    expect(result.current.personaResponse).toBeNull();
    expect(result.current.error).toContain('persona unavailable');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    await flushAsyncWork();

    expect(result.current.personaResponse?.effective.soulMd).toBe('pm1-soul');
    expect(result.current.error).toBeNull();
  });
});

describe('useRecoverableForceApplyStateRead', () => {
  it('失败时保留旧 ForceApply 状态，并在自动重试后恢复', async () => {
    vi.useFakeTimers();
    const client = createTeamPhaseAClient(GATEWAY_URL);
    let requestCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = resolveRequestUrl(input);
        if (url === `${GATEWAY_URL}/team/force-apply/state`) {
          requestCount += 1;
          if (requestCount === 2) {
            return jsonResponse({ error: 'force apply unavailable' }, 503);
          }
          return jsonResponse({
            usedInWindow: requestCount >= 3 ? 2 : 1,
            maxInWindow: 5,
            lastAppliedAt: '2026-05-26T00:00:00.000Z',
          });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const { result } = renderHook(() =>
      useRecoverableForceApplyStateRead({
        client,
        token: 'token-1',
      }),
    );

    await flushAsyncWork();
    expect(result.current.state?.usedInWindow).toBe(1);

    act(() => {
      result.current.refresh();
    });
    await flushAsyncWork();

    expect(result.current.state?.usedInWindow).toBe(1);
    expect(result.current.error).toContain('force apply unavailable');
    expect(result.current.error).toContain('最近一次成功ForceApply 状态');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    await flushAsyncWork();

    expect(result.current.state?.usedInWindow).toBe(2);
    expect(result.current.error).toBeNull();
  });
});

describe('useInstructionStackPreviewRead', () => {
  it('预览失败时保留旧预览，并在自动重试后恢复', async () => {
    vi.useFakeTimers();
    const client = createTeamPhaseAClient(GATEWAY_URL);
    let requestCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = resolveRequestUrl(input);
        const parsed = new URL(url);
        if (
          parsed.pathname === '/team/instruction-stack/preview' &&
          parsed.searchParams.get('roleLayer') === 'executor' &&
          parsed.searchParams.get('teamWorkspaceId') === 'tw-1'
        ) {
          requestCount += 1;
          if (requestCount === 2) {
            return jsonResponse({ error: 'preview unavailable' }, 503);
          }
          return jsonResponse({
            stableBlock: requestCount >= 3 ? 'preview-b' : 'preview-a',
            estimatedTokens: 1200,
            oversize: false,
            layers: {
              agentsMd: true,
              architectureMd: true,
              constitution: true,
              projectMemory: true,
              lessonsLearned: false,
              userMemory: true,
              workspaceKnowledge: false,
              soul: true,
            },
          });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const { result } = renderHook(() =>
      useInstructionStackPreviewRead({
        client,
        token: 'token-1',
      }),
    );

    act(() => {
      result.current.previewInstructionStack({
        roleLayer: 'executor',
        teamWorkspaceId: 'tw-1',
      });
    });
    await flushAsyncWork();

    expect(result.current.preview?.stableBlock).toBe('preview-a');

    act(() => {
      result.current.previewInstructionStack({
        roleLayer: 'executor',
        teamWorkspaceId: 'tw-1',
      });
    });
    await flushAsyncWork();

    expect(result.current.preview?.stableBlock).toBe('preview-a');
    expect(result.current.error).toContain('preview unavailable');
    expect(result.current.error).toContain('最近一次成功预览结果');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    await flushAsyncWork();

    expect(result.current.preview?.stableBlock).toBe('preview-b');
    expect(result.current.error).toBeNull();
  });
});
