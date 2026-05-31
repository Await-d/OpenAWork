// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import type { WorkflowTemplateRecord } from '@openAwork/web-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../../../stores/auth/auth.js';
import { useTeamEventsConnectionStore } from '../../../../stores/team/team-events.js';
import {
  computeTeamWorkflowTemplatesRetryDelay,
  formatTeamWorkflowTemplatesLoadError,
  useTeamWorkflowTemplates,
} from './use-team-workflow-templates.js';

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

function createTemplate(id: string, name: string): WorkflowTemplateRecord {
  return {
    id,
    name,
    description: `${name} description`,
    category: 'team-playbook',
    metadata: {
      teamTemplate: {
        defaultProvider: 'openai',
        optionalAgentIds: [],
        requiredRoles: ['leader', 'planner', 'researcher', 'executor', 'reviewer'],
      },
    },
    nodes: [],
    edges: [],
    createdAt: '2026-05-26T00:00:00.000Z',
    updatedAt: '2026-05-26T00:00:00.000Z',
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

describe('computeTeamWorkflowTemplatesRetryDelay', () => {
  it('按指数退避增长并在上限处封顶', () => {
    expect(computeTeamWorkflowTemplatesRetryDelay(0)).toBe(2000);
    expect(computeTeamWorkflowTemplatesRetryDelay(1)).toBe(4000);
    expect(computeTeamWorkflowTemplatesRetryDelay(2)).toBe(8000);
    expect(computeTeamWorkflowTemplatesRetryDelay(10)).toBe(30000);
  });
});

describe('formatTeamWorkflowTemplatesLoadError', () => {
  it('可重试错误会提示自动重试和旧数据保留', () => {
    const message = formatTeamWorkflowTemplatesLoadError({
      hasCachedData: true,
      nextRetryAtMs: new Date('2026-05-26T12:00:00.000Z').getTime(),
      result: {
        errorMessage: 'templates unavailable',
        retryable: true,
      },
    });

    expect(message).toContain('templates unavailable');
    expect(message).toContain('自动重试');
    expect(message).toContain('最近一次成功模板数据');
  });
});

describe('useTeamWorkflowTemplates', () => {
  it('失败时保留旧模板数据，并在自动重试后恢复', async () => {
    vi.useFakeTimers();
    let templatesCallCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = resolveRequestUrl(input);
        if (url === `${GATEWAY_URL}/workflows/templates`) {
          templatesCallCount += 1;
          if (templatesCallCount === 2) {
            return jsonResponse({ error: 'team templates unavailable' }, 503);
          }
          return jsonResponse([
            createTemplate(
              templatesCallCount >= 3 ? 'tpl-b' : 'tpl-a',
              templatesCallCount >= 3 ? 'Template B' : 'Template A',
            ),
          ]);
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const { result } = renderHook(() => useTeamWorkflowTemplates());

    await flushAsyncWork();
    expect(result.current.templateCount).toBe(1);
    expect(result.current.templates[0]?.name).toBe('Template A');
    expect(result.current.templateCards.some((card) => card.name === 'Template A')).toBe(true);

    act(() => {
      useTeamEventsConnectionStore.setState({ lastRecoveredAt: Date.now() });
    });
    await flushAsyncWork();

    expect(result.current.error).toContain('team templates unavailable');
    expect(result.current.error).toContain('最近一次成功模板数据');
    expect(result.current.templates[0]?.name).toBe('Template A');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    await flushAsyncWork();

    expect(result.current.error).toBeNull();
    expect(result.current.templateCards.some((card) => card.name === 'Template B')).toBe(true);
  });

  it('离线事件会立刻提示错误，恢复联网后自动补拉', async () => {
    let templateCallCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = resolveRequestUrl(input);
        if (url === `${GATEWAY_URL}/workflows/templates`) {
          templateCallCount += 1;
          return jsonResponse([
            createTemplate(
              templateCallCount >= 2 ? 'tpl-2' : 'tpl-1',
              templateCallCount >= 2 ? 'Template B' : 'Template A',
            ),
          ]);
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const { result } = renderHook(() => useTeamWorkflowTemplates());

    await flushAsyncWork();
    expect(result.current.templates[0]?.name).toBe('Template A');

    setNavigatorOnline(false);
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });

    expect(result.current.error).toContain('当前网络离线，团队模板暂时不可用。');
    expect(result.current.error).toContain('最近一次成功模板数据');

    setNavigatorOnline(true);
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    await flushAsyncWork();

    expect(result.current.error).toBeNull();
    expect(result.current.templates[0]?.name).toBe('Template B');
  });
});
