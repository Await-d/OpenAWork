// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import type { CapabilityDescriptor, ManagedAgentRecord } from '@openAwork/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../../../stores/auth/auth.js';
import { useTeamEventsConnectionStore } from '../../../../stores/team/team-events.js';
import {
  computeTeamRoleBindingsRetryDelay,
  formatTeamRoleBindingsLoadError,
  useTeamRuntimeRoleBindings,
} from './use-team-runtime-role-bindings.js';

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

function createAgent(
  id: string,
  label: string,
  coreRole: ManagedAgentRecord['canonicalRole'] extends infer T
    ? T extends { coreRole: infer R }
      ? R
      : never
    : never,
): ManagedAgentRecord {
  return {
    id,
    label,
    description: `${label} agent`,
    aliases: [],
    canonicalRole: { coreRole },
    origin: 'builtin',
    source: 'builtin',
    enabled: true,
    removable: false,
    resettable: true,
    hasOverrides: false,
    createdAt: '2026-05-26T00:00:00.000Z',
    updatedAt: '2026-05-26T00:00:00.000Z',
  };
}

function createCapability(id: string, coreRole: CapabilityDescriptor['canonicalRole'] extends infer T
  ? T extends { coreRole: infer R }
    ? R
    : never
  : never): CapabilityDescriptor {
  return {
    id,
    kind: 'tool',
    label: id,
    description: `${id} capability`,
    source: 'builtin',
    canonicalRole: { coreRole },
  };
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

describe('computeTeamRoleBindingsRetryDelay', () => {
  it('按指数退避增长并在上限处封顶', () => {
    expect(computeTeamRoleBindingsRetryDelay(0)).toBe(2000);
    expect(computeTeamRoleBindingsRetryDelay(1)).toBe(4000);
    expect(computeTeamRoleBindingsRetryDelay(2)).toBe(8000);
    expect(computeTeamRoleBindingsRetryDelay(10)).toBe(30000);
  });
});

describe('formatTeamRoleBindingsLoadError', () => {
  it('可重试错误会提示自动重试和旧数据保留', () => {
    const message = formatTeamRoleBindingsLoadError({
      hasCachedData: true,
      nextRetryAtMs: new Date('2026-05-26T12:00:00.000Z').getTime(),
      result: {
        errorMessage: 'capabilities unavailable',
        retryable: true,
      },
    });

    expect(message).toContain('capabilities unavailable');
    expect(message).toContain('自动重试');
    expect(message).toContain('最近一次成功角色绑定数据');
  });
});

describe('useTeamRuntimeRoleBindings', () => {
  it('失败时保留旧 agents/capabilities，并在自动重试后恢复', async () => {
    vi.useFakeTimers();
    let capabilitiesCallCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = resolveRequestUrl(input);
        if (url === `${GATEWAY_URL}/agents`) {
          return jsonResponse({
            agents: [
              createAgent('prometheus', 'Prometheus', 'planner'),
              createAgent('momus', 'Momus', 'reviewer'),
            ],
          });
        }
        if (url === `${GATEWAY_URL}/capabilities`) {
          capabilitiesCallCount += 1;
          if (capabilitiesCallCount === 2) {
            return jsonResponse({ error: 'capabilities unavailable' }, 503);
          }
          return jsonResponse({
            capabilities: [
              createCapability(
                capabilitiesCallCount >= 3 ? 'planner-v2' : 'planner-v1',
                'planner',
              ),
            ],
          });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const { result } = renderHook(() => useTeamRuntimeRoleBindings());

    await flushAsyncWork();
    expect(result.current.agents.map((agent) => agent.id)).toEqual(['prometheus', 'momus']);
    expect(result.current.roleCards.find((card) => card.role === 'planner')?.selectedAgent?.id).toBe(
      'prometheus',
    );
    expect(
      result.current.roleCards.find((card) => card.role === 'planner')?.recommendedCapabilities[0]
        ?.id,
    ).toBe('planner-v1');

    act(() => {
      useTeamEventsConnectionStore.setState({ lastRecoveredAt: Date.now() });
    });
    await flushAsyncWork();

    expect(result.current.error).toContain('capabilities unavailable');
    expect(result.current.error).toContain('最近一次成功角色绑定数据');
    expect(
      result.current.roleCards.find((card) => card.role === 'planner')?.recommendedCapabilities[0]
        ?.id,
    ).toBe('planner-v1');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    await flushAsyncWork();

    expect(result.current.error).toBeNull();
    expect(
      result.current.roleCards.find((card) => card.role === 'planner')?.recommendedCapabilities[0]
        ?.id,
    ).toBe('planner-v2');
  });

  it('离线事件会立刻提示错误，恢复联网后自动补拉', async () => {
    let capabilitiesCallCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = resolveRequestUrl(input);
        if (url === `${GATEWAY_URL}/agents`) {
          return jsonResponse({
            agents: [createAgent('prometheus', 'Prometheus', 'planner')],
          });
        }
        if (url === `${GATEWAY_URL}/capabilities`) {
          capabilitiesCallCount += 1;
          return jsonResponse({
            capabilities: [
              createCapability(
                capabilitiesCallCount >= 2 ? 'planner-v2' : 'planner-v1',
                'planner',
              ),
            ],
          });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const { result } = renderHook(() => useTeamRuntimeRoleBindings());

    await flushAsyncWork();
    expect(result.current.agents.map((agent) => agent.id)).toEqual(['prometheus']);

    setNavigatorOnline(false);
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });

    expect(result.current.error).toContain('当前网络离线，执行角色绑定数据暂时不可用。');
    expect(result.current.error).toContain('最近一次成功角色绑定数据');

    setNavigatorOnline(true);
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    await flushAsyncWork();

    expect(result.current.error).toBeNull();
    expect(
      result.current.roleCards.find((card) => card.role === 'planner')?.recommendedCapabilities[0]
        ?.id,
    ).toBe('planner-v2');
  });
});
