// @vitest-environment jsdom
/**
 * useTeamConversationState v0.1 骨架测试
 *
 * 覆盖：
 * 1. 没有 sessionId / token / enabled=false 时进入空闲态（不发请求）
 * 2. sessionId 存在时调用 getRecovery 并把 messages/state_status/pending 写入 state
 * 3. getRecovery 失败时优雅降级，state 保持空但不抛错
 * 4. setter 暴露给消费方使用
 *
 * 参考：use-session-terminals.test.tsx 的 mock fetch 风格。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { RunEvent } from '@openAwork/shared';
import {
  computeTeamConversationProvidersRetryDelay,
  computeTeamConversationRecoveryRetryDelay,
  formatTeamConversationProvidersLoadError,
  formatTeamConversationRecoveryLoadError,
  useTeamConversationState,
} from './use-team-conversation-state.js';
import { useLayerStore } from '../../../stores/team/team-events.js';
import * as sessionListEvents from '../../../utils/session/session-list-events.js';

const SESSION_ID = 'session-test-001';
const TOKEN = 'tok-fake';
const GATEWAY = 'https://gw.test';
const EMAIL = 'qa@example.com';

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static readonly CLOSED = 3;
  static readonly OPEN = 1;

  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onopen: (() => void) | null = null;
  readyState = MockWebSocket.OPEN;
  sentPayloads: string[] = [];
  url: string;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(payload: string) {
    this.sentPayloads.push(payload);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
  }
}

interface RecoveryFixture {
  pendingPermissions?: unknown[];
  pendingQuestions?: unknown[];
  session?: {
    id: string;
    metadata_json?: string;
    role_layer?: string | null;
    runEvents?: RunEvent[];
    state_status?: 'idle' | 'running' | 'paused';
    substate?: string | null;
    messages?: unknown[];
  };
  todoLanes?: { lanes: unknown[] };
  tasks?: unknown[];
  children?: unknown[];
  ratings?: unknown[];
  activeStream?: unknown;
  totalMessageCount?: number;
  totalTurnCount?: number | null;
}

function stubRecovery(payload: RecoveryFixture | { error: true }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      if ('error' in payload && payload.error) {
        return new Response(null, { status: 500 });
      }
      // 默认 recovery 响应（不报错的路径）—— 注意 server 返回的是
      // `{ recovery: SessionRecoveryReadModel }`，hook 中的 sessionsClient
      // 会自动解包 .recovery 字段。所以这里 mock 必须把 fixture 包在
      // `{ recovery: ... }` 里。
      const fixture: RecoveryFixture = 'error' in payload ? {} : (payload as RecoveryFixture);
      const recovery = {
        pendingPermissions: fixture.pendingPermissions ?? [],
        pendingQuestions: fixture.pendingQuestions ?? [],
        session: fixture.session ?? {
          id: SESSION_ID,
          state_status: 'idle',
          messages: [],
        },
        todoLanes: fixture.todoLanes ?? { lanes: [] },
        tasks: fixture.tasks ?? [],
        children: fixture.children ?? [],
        ratings: fixture.ratings ?? [],
        activeStream: fixture.activeStream ?? null,
        totalMessageCount: fixture.totalMessageCount,
        totalTurnCount: fixture.totalTurnCount ?? null,
      };
      return new Response(JSON.stringify({ recovery }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
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
  // 默认每个测试都先 stub 一次空 fetch，避免漏 stub 导致请求泄漏
  stubRecovery({});
  setNavigatorOnline(true);
  MockWebSocket.instances.length = 0;
  useLayerStore.getState().clear();
});

afterEach(() => {
  cleanup();
  useLayerStore.getState().clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  setNavigatorOnline(true);
});

describe('team conversation recovery helpers', () => {
  it('computeTeamConversationRecoveryRetryDelay 按指数退避增长并封顶', () => {
    expect(computeTeamConversationRecoveryRetryDelay(0)).toBe(2000);
    expect(computeTeamConversationRecoveryRetryDelay(1)).toBe(4000);
    expect(computeTeamConversationRecoveryRetryDelay(2)).toBe(8000);
    expect(computeTeamConversationRecoveryRetryDelay(10)).toBe(30000);
  });

  it('formatTeamConversationRecoveryLoadError 会提示保留旧快照', () => {
    const message = formatTeamConversationRecoveryLoadError({
      hasCachedSnapshot: true,
      nextRetryAtMs: new Date('2026-05-26T12:00:00.000Z').getTime(),
      result: {
        errorMessage: 'recovery unavailable',
        retryable: true,
      },
    });

    expect(message).toContain('recovery unavailable');
    expect(message).toContain('自动重试');
    expect(message).toContain('最近一次成功会话快照');
  });

  it('provider retry helpers 会提示保留旧列表', () => {
    expect(computeTeamConversationProvidersRetryDelay(0)).toBe(2000);
    expect(computeTeamConversationProvidersRetryDelay(10)).toBe(30000);
    const message = formatTeamConversationProvidersLoadError({
      hasCachedProviders: true,
      nextRetryAtMs: new Date('2026-05-26T12:30:00.000Z').getTime(),
      result: {
        errorMessage: 'providers unavailable',
        retryable: true,
      },
    });
    expect(message).toContain('providers unavailable');
    expect(message).toContain('最近一次成功Provider 列表');
  });
});

describe('useTeamConversationState — 空闲态', () => {
  it('sessionId 为 null 时不发请求且 state 保持空', () => {
    const { result } = renderHook(() =>
      useTeamConversationState({
        sessionId: null,
        currentUserEmail: EMAIL,
        gatewayUrl: GATEWAY,
        token: TOKEN,
      }),
    );

    expect(result.current.messages).toEqual([]);
    expect(result.current.sessionStateStatus).toBeNull();
    expect(result.current.isSessionSnapshotReady).toBe(false);
    expect(result.current.pendingPermissions).toEqual([]);
    expect(result.current.pendingQuestions).toEqual([]);
    // 没发请求
    expect(fetch).not.toHaveBeenCalled();
  });

  it('token 为 null 时不发请求', () => {
    renderHook(() =>
      useTeamConversationState({
        sessionId: SESSION_ID,
        currentUserEmail: EMAIL,
        gatewayUrl: GATEWAY,
        token: null,
      }),
    );

    expect(fetch).not.toHaveBeenCalled();
  });

  it('enabled=false 时不发请求', () => {
    renderHook(() =>
      useTeamConversationState({
        sessionId: SESSION_ID,
        currentUserEmail: EMAIL,
        gatewayUrl: GATEWAY,
        token: TOKEN,
        enabled: false,
      }),
    );

    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('useTeamConversationState — 加载快照', () => {
  it('sessionId 存在时调用 getRecovery 并写入 state', async () => {
    const publishSessionPendingPermissionSpy = vi.spyOn(
      sessionListEvents,
      'publishSessionPendingPermission',
    );
    stubRecovery({
      session: {
        id: SESSION_ID,
        state_status: 'running',
        messages: [
          {
            id: 'm1',
            role: 'user',
            content: 'hello',
            createdAtMs: 1700000000000,
          },
          {
            id: 'm2',
            role: 'assistant',
            content: 'hi back',
            createdAtMs: 1700000001000,
          },
        ],
        runEvents: [
          {
            type: 'text_delta',
            delta: '正在分析任务',
          },
        ],
      },
      pendingPermissions: [
        {
          requestId: 'perm1',
          sessionId: SESSION_ID,
          toolName: 'bash',
          scope: 'bash pwd',
          reason: '读取当前目录',
          riskLevel: 'low',
          status: 'pending',
          createdAt: '2026-06-15T00:00:00.000Z',
        },
      ],
      pendingQuestions: [{ requestId: 'q1', status: 'pending', questions: [] }],
    });

    const { result } = renderHook(() =>
      useTeamConversationState({
        sessionId: SESSION_ID,
        currentUserEmail: EMAIL,
        gatewayUrl: GATEWAY,
        token: TOKEN,
      }),
    );

    await waitFor(() => {
      expect(result.current.isSessionSnapshotReady).toBe(true);
    });

    expect(result.current.messages.length).toBe(2);
    expect(result.current.messages[0]?.id).toBe('m1');
    expect(result.current.sessionStateStatus).toBe('running');
    expect(result.current.remoteSessionBusyState).toBe('running');
    expect(result.current.pendingPermissions).toHaveLength(1);
    expect(result.current.pendingQuestions).toHaveLength(1);
    expect(result.current.runEvents).toHaveLength(1);
    expect(publishSessionPendingPermissionSpy).toHaveBeenCalledWith(
      SESSION_ID,
      expect.objectContaining({
        requestId: 'perm1',
        targetSessionId: SESSION_ID,
      }),
    );
  });

  it('recovery.children 中的团队层级会进入 childSessions', async () => {
    stubRecovery({
      session: {
        id: SESSION_ID,
        state_status: 'idle',
        messages: [],
      },
      children: [
        {
          id: 'child-pm1',
          role_layer: 'pm1',
          messages: [{ id: 'pm1-msg', role: 'assistant', content: 'PM1 详情' }],
        },
        {
          id: 'child-executor',
          role_layer: 'executor',
          messages: [{ id: 'executor-msg', role: 'assistant', content: '执行详情' }],
        },
      ],
    });

    const { result } = renderHook(() =>
      useTeamConversationState({
        sessionId: SESSION_ID,
        currentUserEmail: EMAIL,
        gatewayUrl: GATEWAY,
        token: TOKEN,
      }),
    );

    await waitFor(() => {
      expect(result.current.isSessionSnapshotReady).toBe(true);
    });

    expect(result.current.childSessions.map((child) => child.role_layer)).toEqual([
      'pm1',
      'executor',
    ]);
    expect(result.current.childSessions[0]?.messages[0]?.content).toBe('PM1 详情');
    expect(result.current.childSessions[1]?.messages[0]?.content).toBe('执行详情');
  });

  it('切换 sessionId 时清空旧消息并重新加载目标层会话', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/sessions/root-session/recovery')) {
        return new Response(
          JSON.stringify({
            recovery: {
              pendingPermissions: [],
              pendingQuestions: [],
              session: {
                id: 'root-session',
                state_status: 'idle',
                messages: [{ id: 'root-message', role: 'assistant', content: '主对话内容' }],
              },
              todoLanes: { lanes: [] },
              tasks: [],
              children: [],
              ratings: [],
              activeStream: null,
              totalTurnCount: null,
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.includes('/sessions/pm1-session/recovery')) {
        return new Response(
          JSON.stringify({
            recovery: {
              pendingPermissions: [],
              pendingQuestions: [],
              session: {
                id: 'pm1-session',
                role_layer: 'pm1',
                state_status: 'idle',
                messages: [{ id: 'pm1-message', role: 'assistant', content: 'PM1 层内容' }],
              },
              todoLanes: { lanes: [] },
              tasks: [],
              children: [],
              ratings: [],
              activeStream: null,
              totalTurnCount: null,
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result, rerender } = renderHook(
      ({ sessionId }: { sessionId: string }) =>
        useTeamConversationState({
          sessionId,
          currentUserEmail: EMAIL,
          gatewayUrl: GATEWAY,
          token: TOKEN,
        }),
      { initialProps: { sessionId: 'root-session' } },
    );

    await waitFor(() => {
      expect(result.current.messages[0]?.id).toBe('root-message');
    });

    rerender({ sessionId: 'pm1-session' });

    await waitFor(() => {
      expect(result.current.messages).toEqual([]);
    });
    await waitFor(() => {
      expect(result.current.messages[0]?.id).toBe('pm1-message');
    });
    expect(result.current.messages[0]?.content).toBe('PM1 层内容');
  });

  it('从 session metadata 恢复固定模型选择', async () => {
    stubRecovery({
      session: {
        id: SESSION_ID,
        state_status: 'idle',
        messages: [],
        metadata_json: JSON.stringify({
          providerId: 'anthropic-fixed',
          modelId: 'claude-fixed',
        }),
      },
    });

    const { result } = renderHook(() =>
      useTeamConversationState({
        sessionId: SESSION_ID,
        currentUserEmail: EMAIL,
        gatewayUrl: GATEWAY,
        token: TOKEN,
        defaults: {
          activeProviderId: 'settings-provider',
          activeModelId: 'settings-model',
        },
      }),
    );

    await waitFor(() => {
      expect(result.current.isSessionSnapshotReady).toBe(true);
    });

    expect(result.current.activeProviderId).toBe('anthropic-fixed');
    expect(result.current.activeModelId).toBe('claude-fixed');
  });

  it('直接打开角色子会话时会补写已有 layer 节点缺失的 rootSessionId', async () => {
    useLayerStore.getState().addNode({
      sessionId: SESSION_ID,
      roleLayer: 'executor',
      parentSessionId: 'session-pm2',
      state: 'idle',
      displayName: '前端开发者',
      personaKey: 'executor:frontend',
    });
    stubRecovery({
      session: {
        id: SESSION_ID,
        role_layer: 'executor',
        state_status: 'idle',
        messages: [],
        metadata_json: JSON.stringify({
          parentSessionId: 'session-pm2',
          teamRoleInstance: {
            rootSessionId: 'session-root',
            roleLayer: 'executor',
            personaKey: 'executor:frontend',
            displayName: '前端开发者',
          },
        }),
      },
    });

    renderHook(() =>
      useTeamConversationState({
        sessionId: SESSION_ID,
        currentUserEmail: EMAIL,
        gatewayUrl: GATEWAY,
        token: TOKEN,
      }),
    );

    await waitFor(() => {
      expect(useLayerStore.getState().nodes.get(SESSION_ID)?.rootSessionId).toBe('session-root');
    });
  });

  it('recovery metadata 缺少 parentSessionId 时保留已有 team 父链', async () => {
    useLayerStore.getState().addNode({
      sessionId: SESSION_ID,
      roleLayer: 'pm1',
      parentSessionId: 'team-root-session',
      state: 'idle',
    });
    stubRecovery({
      session: {
        id: SESSION_ID,
        role_layer: 'pm1',
        state_status: 'idle',
        messages: [],
        metadata_json: JSON.stringify({
          teamRoleInstance: {
            rootSessionId: 'team-root-session',
            roleLayer: 'pm1',
          },
        }),
      },
    });

    renderHook(() =>
      useTeamConversationState({
        sessionId: SESSION_ID,
        currentUserEmail: EMAIL,
        gatewayUrl: GATEWAY,
        token: TOKEN,
      }),
    );

    await waitFor(() => {
      expect(useLayerStore.getState().nodes.get(SESSION_ID)?.parentSessionId).toBe(
        'team-root-session',
      );
    });
  });

  it('recovery.session 透传 team_parent_session_id 时可直接建立 team 父链', async () => {
    stubRecovery({
      session: {
        id: SESSION_ID,
        role_layer: 'pm2',
        state_status: 'idle',
        messages: [],
        metadata_json: JSON.stringify({
          teamRoleInstance: {
            rootSessionId: 'team-root-session',
            roleLayer: 'pm2',
          },
        }),
        // 后端 recovery 新增显式字段，前端不应再只依赖 metadata.parentSessionId
        ['team_parent_session_id' as never]: 'pm1-session',
      } as unknown as RecoveryFixture['session'],
    });

    renderHook(() =>
      useTeamConversationState({
        sessionId: SESSION_ID,
        currentUserEmail: EMAIL,
        gatewayUrl: GATEWAY,
        token: TOKEN,
      }),
    );

    await waitFor(() => {
      expect(useLayerStore.getState().nodes.get(SESSION_ID)?.parentSessionId).toBe('pm1-session');
    });
  });

  it('getRecovery 失败时降级为空白态', async () => {
    stubRecovery({ error: true });

    const { result } = renderHook(() =>
      useTeamConversationState({
        sessionId: SESSION_ID,
        currentUserEmail: EMAIL,
        gatewayUrl: GATEWAY,
        token: TOKEN,
      }),
    );

    await waitFor(() => {
      expect(result.current.isSessionLoading).toBe(false);
    });

    expect(result.current.messages).toEqual([]);
    expect(result.current.isSessionSnapshotReady).toBe(false);
    expect(result.current.sessionStateStatus).toBeNull();
  });

  it('已有快照后再次失败时保留旧消息，并在自动重试后恢复', async () => {
    vi.useFakeTimers();
    let requestCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        requestCount += 1;
        if (requestCount === 2) {
          return new Response(JSON.stringify({ error: 'recovery unavailable' }), {
            status: 503,
            headers: { 'content-type': 'application/json' },
          });
        }
        const messageId = requestCount >= 3 ? 'm-recovered' : 'm-initial';
        return new Response(
          JSON.stringify({
            recovery: {
              pendingPermissions: [],
              pendingQuestions: [],
              session: {
                id: SESSION_ID,
                state_status: 'running',
                messages: [
                  {
                    id: messageId,
                    role: 'assistant',
                    content: messageId,
                    createdAtMs: 1700000000000,
                  },
                ],
              },
              todoLanes: { lanes: [] },
              tasks: [],
              children: [],
              ratings: [],
              activeStream: null,
            },
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }),
    );

    const { result } = renderHook(() =>
      useTeamConversationState({
        sessionId: SESSION_ID,
        currentUserEmail: EMAIL,
        gatewayUrl: GATEWAY,
        token: TOKEN,
      }),
    );

    await flushAsyncWork();
    expect(result.current.isSessionSnapshotReady).toBe(true);
    expect(result.current.messages[0]?.id).toBe('m-initial');

    await act(async () => {
      await result.current.reload();
    });

    expect(result.current.messages[0]?.id).toBe('m-initial');
    expect(result.current.snapshotError).toContain('recovery unavailable');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    await flushAsyncWork();
    expect(result.current.messages[0]?.id).toBe('m-recovered');
    expect(result.current.snapshotError).toBeNull();
  });

  it('离线时立即报错并保留旧快照，恢复联网后自动补拉', async () => {
    let requestCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        requestCount += 1;
        const messageId = requestCount >= 2 ? 'm-online-again' : 'm-online';
        return new Response(
          JSON.stringify({
            recovery: {
              pendingPermissions: [],
              pendingQuestions: [],
              session: {
                id: SESSION_ID,
                state_status: 'running',
                messages: [
                  {
                    id: messageId,
                    role: 'assistant',
                    content: messageId,
                    createdAtMs: 1700000000000,
                  },
                ],
              },
              todoLanes: { lanes: [] },
              tasks: [],
              children: [],
              ratings: [],
              activeStream: null,
            },
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }),
    );

    const { result } = renderHook(() =>
      useTeamConversationState({
        sessionId: SESSION_ID,
        currentUserEmail: EMAIL,
        gatewayUrl: GATEWAY,
        token: TOKEN,
        enableWriters: true,
      }),
    );

    await waitFor(() => {
      expect(result.current.messages[0]?.id).toBe('m-online');
    });

    setNavigatorOnline(false);
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });

    expect(result.current.messages[0]?.id).toBe('m-online');
    expect(result.current.snapshotError).toContain('当前网络离线，团队会话快照暂时不可用。');

    setNavigatorOnline(true);
    act(() => {
      window.dispatchEvent(new Event('online'));
    });

    await waitFor(() => {
      expect(result.current.messages[0]?.id).toBe('m-online-again');
    });
    expect(result.current.snapshotError).toBeNull();
  });

  it('recovery 返回 totalTurnCount 时会暴露 hiddenMessageCount', async () => {
    stubRecovery({
      session: {
        id: SESSION_ID,
        state_status: 'running',
        messages: [
          {
            id: 'm-user-1',
            role: 'user',
            content: '第一轮',
            createdAtMs: 1700000000000,
          },
          {
            id: 'm-assistant-1',
            role: 'assistant',
            content: '收到',
            createdAtMs: 1700000001000,
          },
        ],
      },
      totalTurnCount: 5,
    });

    const { result } = renderHook(() =>
      useTeamConversationState({
        sessionId: SESSION_ID,
        currentUserEmail: EMAIL,
        gatewayUrl: GATEWAY,
        token: TOKEN,
      }),
    );

    await waitFor(() => {
      expect(result.current.isSessionSnapshotReady).toBe(true);
    });

    expect(result.current.hiddenMessageCount).toBe(4);
  });

  it('loadEarlierMessages 会扩大 messageLimit 并降低 hiddenMessageCount', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      const parsed = new URL(url);
      const messageLimit = Number(parsed.searchParams.get('messageLimit') ?? '0');
      const userTurnCount = messageLimit >= 30 ? 4 : 1;
      const messages = Array.from({ length: userTurnCount }).flatMap((_, index) => [
        {
          id: `u-${index + 1}`,
          role: 'user',
          content: `用户消息 ${index + 1}`,
          createdAtMs: 1700000000000 + index * 2000,
        },
        {
          id: `a-${index + 1}`,
          role: 'assistant',
          content: `助手回复 ${index + 1}`,
          createdAtMs: 1700000001000 + index * 2000,
        },
      ]);
      return new Response(
        JSON.stringify({
          recovery: {
            pendingPermissions: [],
            pendingQuestions: [],
            session: {
              id: SESSION_ID,
              state_status: 'running',
              messages,
            },
            todoLanes: { lanes: [] },
            tasks: [],
            children: [],
            ratings: [],
            activeStream: null,
            totalTurnCount: 12,
          },
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() =>
      useTeamConversationState({
        sessionId: SESSION_ID,
        currentUserEmail: EMAIL,
        gatewayUrl: GATEWAY,
        token: TOKEN,
      }),
    );

    await waitFor(() => {
      expect(result.current.isSessionSnapshotReady).toBe(true);
    });

    expect(fetchMock.mock.calls[0]?.[0]).toContain('messageLimit=10');
    expect(result.current.hiddenMessageCount).toBe(11);

    await act(async () => {
      await result.current.loadEarlierMessages();
    });

    expect(fetchMock.mock.calls[1]?.[0]).toContain('messageLimit=30');
    expect(result.current.hiddenMessageCount).toBe(8);
  });
});

describe('useTeamConversationState — composer setter 暴露', () => {
  it('setInput / setActiveProviderId / setActiveModelId 可用', () => {
    const { result } = renderHook(() =>
      useTeamConversationState({
        sessionId: null,
        currentUserEmail: EMAIL,
        gatewayUrl: GATEWAY,
        token: TOKEN,
      }),
    );

    act(() => {
      result.current.setInput('hello world');
      result.current.setActiveProviderId('anthropic');
      result.current.setActiveModelId('claude-sonnet-4');
    });

    expect(result.current.input).toBe('hello world');
    expect(result.current.activeProviderId).toBe('anthropic');
    expect(result.current.activeModelId).toBe('claude-sonnet-4');
  });

  it('defaults 选项被 hook 使用作为初始值', () => {
    const { result } = renderHook(() =>
      useTeamConversationState({
        sessionId: null,
        currentUserEmail: EMAIL,
        gatewayUrl: GATEWAY,
        token: TOKEN,
        defaults: {
          activeProviderId: 'openai',
          activeModelId: 'gpt-4o',
          thinkingEnabled: true,
          reasoningEffort: 'high',
        },
      }),
    );

    expect(result.current.activeProviderId).toBe('openai');
    expect(result.current.activeModelId).toBe('gpt-4o');
    expect(result.current.thinkingEnabled).toBe(true);
    expect(result.current.reasoningEffort).toBe('high');
  });

  it('TeamConversationState 只暴露 team 需要的模型思考字段，不暴露其它 chat-only setter', () => {
    const { result } = renderHook(() =>
      useTeamConversationState({
        sessionId: null,
        currentUserEmail: EMAIL,
        gatewayUrl: GATEWAY,
        token: TOKEN,
      }),
    );
    const state = result.current as unknown as Record<string, unknown>;
    expect(state['dialogueMode']).toBeUndefined();
    expect(state['setDialogueMode']).toBeUndefined();
    expect(state['yoloMode']).toBeUndefined();
    expect(state['setYoloMode']).toBeUndefined();
    expect(state['webSearchEnabled']).toBeUndefined();
    expect(state['thinkingEnabled']).toBe(false);
    expect(state['setThinkingEnabled']).toBeTypeOf('function');
    expect(state['reasoningEffort']).toBe('medium');
    expect(state['setReasoningEffort']).toBeTypeOf('function');
    expect(state['manualAgentId']).toBeUndefined();
  });

  it('loadProviders 失败时保留旧 provider 列表，并在自动重试后恢复', async () => {
    vi.useFakeTimers();
    let recoveryCount = 0;
    let providersCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.startsWith(`${GATEWAY}/sessions/${SESSION_ID}/recovery`)) {
          recoveryCount += 1;
          return new Response(
            JSON.stringify({
              recovery: {
                pendingPermissions: [],
                pendingQuestions: [],
                session: {
                  id: SESSION_ID,
                  state_status: 'idle',
                  messages: [],
                },
                todoLanes: { lanes: [] },
                tasks: [],
                children: [],
                ratings: [],
                activeStream: null,
              },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        if (url.startsWith(`${GATEWAY}/settings/providers`)) {
          providersCount += 1;
          if (providersCount === 2) {
            return new Response(JSON.stringify({ error: 'providers unavailable' }), {
              status: 503,
              headers: { 'content-type': 'application/json' },
            });
          }
          return new Response(
            JSON.stringify({
              activeSelection: {
                chat: {
                  providerId: 'openai',
                  modelId: providersCount >= 3 ? 'gpt-4.1' : 'gpt-4o',
                },
              },
              providers: [
                {
                  id: 'openai',
                  name: 'OpenAI',
                  type: 'cloud',
                  enabled: true,
                  defaultModels: [
                    {
                      id: providersCount >= 3 ? 'gpt-4.1' : 'gpt-4o',
                      label: providersCount >= 3 ? 'GPT-4.1' : 'GPT-4o',
                      enabled: true,
                    },
                  ],
                },
              ],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const { result } = renderHook(() =>
      useTeamConversationState({
        sessionId: SESSION_ID,
        currentUserEmail: EMAIL,
        gatewayUrl: GATEWAY,
        token: TOKEN,
        enableWriters: true,
      }),
    );

    await flushAsyncWork();
    expect(result.current.providers[0]?.defaultModels[0]?.id).toBe('gpt-4o');

    await act(async () => {
      await result.current.loadProviders();
    });

    expect(result.current.providers[0]?.defaultModels[0]?.id).toBe('gpt-4o');
    expect(result.current.providersError).toContain('providers unavailable');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    await flushAsyncWork();

    expect(result.current.providers[0]?.defaultModels[0]?.id).toBe('gpt-4.1');
    expect(result.current.providersError).toBeNull();
  });
});

describe('useTeamConversationState — 派生状态', () => {
  it('streaming + streamBuffer 都为空时 visibleStreaming = false', () => {
    const { result } = renderHook(() =>
      useTeamConversationState({
        sessionId: null,
        currentUserEmail: EMAIL,
        gatewayUrl: GATEWAY,
        token: TOKEN,
      }),
    );

    expect(result.current.visibleStreaming).toBe(false);
  });

  it('sessionStateStatus 为 idle 时 remoteSessionBusyState 为 null', async () => {
    stubRecovery({
      session: { id: SESSION_ID, state_status: 'idle', messages: [] },
    });

    const { result } = renderHook(() =>
      useTeamConversationState({
        sessionId: SESSION_ID,
        currentUserEmail: EMAIL,
        gatewayUrl: GATEWAY,
        token: TOKEN,
      }),
    );

    await waitFor(() => {
      expect(result.current.isSessionSnapshotReady).toBe(true);
    });

    expect(result.current.sessionStateStatus).toBe('idle');
    expect(result.current.remoteSessionBusyState).toBeNull();
  });

  it('sessionStateStatus 为 paused 时 remoteSessionBusyState = paused', async () => {
    stubRecovery({
      session: { id: SESSION_ID, state_status: 'paused', messages: [] },
    });

    const { result } = renderHook(() =>
      useTeamConversationState({
        sessionId: SESSION_ID,
        currentUserEmail: EMAIL,
        gatewayUrl: GATEWAY,
        token: TOKEN,
      }),
    );

    await waitFor(() => {
      expect(result.current.isSessionSnapshotReady).toBe(true);
    });

    expect(result.current.remoteSessionBusyState).toBe('paused');
  });
});

describe('useTeamConversationState — submitInbound (v0.2)', () => {
  it('recovery.session 中无 role_layer/substate 字段时 hook 状态为 null', async () => {
    stubRecovery({
      session: { id: SESSION_ID, state_status: 'idle', messages: [] },
    });

    const { result } = renderHook(() =>
      useTeamConversationState({
        sessionId: SESSION_ID,
        currentUserEmail: EMAIL,
        gatewayUrl: GATEWAY,
        token: TOKEN,
      }),
    );

    await waitFor(() => {
      expect(result.current.isSessionSnapshotReady).toBe(true);
    });

    expect(result.current.roleLayer).toBeNull();
    expect(result.current.substate).toBeNull();
  });

  it('recovery.session 中带 role_layer (Phase B) 时透传到 hook', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              recovery: {
                pendingPermissions: [],
                pendingQuestions: [],
                session: {
                  id: SESSION_ID,
                  state_status: 'running',
                  messages: [],
                  role_layer: 'pm1',
                },
                todoLanes: { lanes: [] },
                tasks: [],
                children: [],
                ratings: [],
                activeStream: null,
              },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
      ),
    );

    const { result } = renderHook(() =>
      useTeamConversationState({
        sessionId: SESSION_ID,
        currentUserEmail: EMAIL,
        gatewayUrl: GATEWAY,
        token: TOKEN,
      }),
    );

    await waitFor(() => {
      expect(result.current.isSessionSnapshotReady).toBe(true);
    });

    expect(result.current.roleLayer).toBe('pm1');
    expect(result.current.substate).toBeNull();
  });

  it('recovery.session 中带 substate (L1.3 改造 2 落地后) 时透传', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              recovery: {
                pendingPermissions: [],
                pendingQuestions: [],
                session: {
                  id: SESSION_ID,
                  state_status: 'running',
                  messages: [],
                  role_layer: 'pm1',
                  substate: 'drafting_plan',
                },
                todoLanes: { lanes: [] },
                tasks: [],
                children: [],
                ratings: [],
                activeStream: null,
              },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
      ),
    );

    const { result } = renderHook(() =>
      useTeamConversationState({
        sessionId: SESSION_ID,
        currentUserEmail: EMAIL,
        gatewayUrl: GATEWAY,
        token: TOKEN,
      }),
    );

    await waitFor(() => {
      expect(result.current.isSessionSnapshotReady).toBe(true);
    });

    expect(result.current.roleLayer).toBe('pm1');
    expect(result.current.substate).toBe('drafting_plan');
  });

  it('sessionId 为 null 时 submitInbound 抛错', async () => {
    const { result } = renderHook(() =>
      useTeamConversationState({
        sessionId: null,
        currentUserEmail: EMAIL,
        gatewayUrl: GATEWAY,
        token: TOKEN,
      }),
    );

    await expect(result.current.submitInbound('user_input', { text: 'hi' })).rejects.toThrow(
      '当前团队会话不存在，无法提交团队消息。',
    );
  });

  it('token 缺失时抛错', async () => {
    const { result } = renderHook(() =>
      useTeamConversationState({
        sessionId: SESSION_ID,
        currentUserEmail: EMAIL,
        gatewayUrl: GATEWAY,
        token: null,
      }),
    );

    await expect(result.current.submitInbound('user_input', { text: 'hi' })).rejects.toThrow(
      '未登录，无法提交团队消息。',
    );
  });

  it('enableWriters=false 时 startStream 抛中文只读错误', async () => {
    const { result } = renderHook(() =>
      useTeamConversationState({
        sessionId: SESSION_ID,
        currentUserEmail: EMAIL,
        gatewayUrl: GATEWAY,
        token: TOKEN,
        enableWriters: false,
      }),
    );

    await expect(result.current.startStream('hello')).rejects.toThrow(
      '当前会话为只读模式，无法发送消息。',
    );
  });

  it('startStream 会为支持思考的 team 模型下发 thinkingEnabled 与 reasoningEffort', async () => {
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);
    class InertEventSource {
      close(): void {
        return undefined;
      }
    }
    vi.stubGlobal('EventSource', InertEventSource as unknown as typeof EventSource);

    const { result } = renderHook(() =>
      useTeamConversationState({
        sessionId: SESSION_ID,
        currentUserEmail: EMAIL,
        gatewayUrl: GATEWAY,
        token: TOKEN,
        enableWriters: true,
        defaults: {
          activeProviderId: 'openai',
          activeModelId: 'gpt-5.4',
          thinkingEnabled: true,
          reasoningEffort: 'xhigh',
        },
      }),
    );

    act(() => {
      result.current.setProviders([
        {
          id: 'openai',
          name: 'OpenAI',
          type: 'openai',
          enabled: true,
          defaultModels: [
            {
              id: 'gpt-5.4',
              label: 'GPT-5.4',
              enabled: true,
              supportsThinking: true,
            },
          ],
        },
      ]);
    });

    await act(async () => {
      await result.current.startStream('team reasoning');
    });
    MockWebSocket.instances[0]?.onopen?.();

    const payload = JSON.parse(MockWebSocket.instances[0]?.sentPayloads[0] ?? '{}') as {
      model?: string;
      providerId?: string;
      reasoningEffort?: string;
      thinkingEnabled?: boolean;
    };
    expect(payload.model).toBe('gpt-5.4');
    expect(payload.providerId).toBe('openai');
    expect(payload.thinkingEnabled).toBe(true);
    expect(payload.reasoningEffort).toBe('xhigh');
  });

  it('成功提交 user_input 时 POST 到正确端点 + 返回 messageId', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      // 第一个调用是 reload 的 getRecovery（GET）
      if (url.includes('/recovery')) {
        return new Response(
          JSON.stringify({
            recovery: {
              pendingPermissions: [],
              pendingQuestions: [],
              session: { id: SESSION_ID, state_status: 'idle', messages: [] },
              todoLanes: { lanes: [] },
              tasks: [],
              children: [],
              ratings: [],
              activeStream: null,
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      // 第二个调用是 submitInbound 的 POST
      if (url.includes('/inbound-messages')) {
        expect(init?.method).toBe('POST');
        const body = JSON.parse((init?.body as string) ?? '{}');
        expect(body.messageType).toBe('user_input');
        expect(body.payload.text).toBe('hello team');
        return new Response(
          JSON.stringify({ messageId: 'imsg-001', createdAt: '2026-05-16T15:00:00Z' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() =>
      useTeamConversationState({
        sessionId: SESSION_ID,
        currentUserEmail: EMAIL,
        gatewayUrl: GATEWAY,
        token: TOKEN,
      }),
    );

    await waitFor(() => {
      expect(result.current.isSessionSnapshotReady).toBe(true);
    });

    const response = await result.current.submitInbound('user_input', { text: 'hello team' });

    expect(response.messageId).toBe('imsg-001');
    expect(response.createdAt).toBe('2026-05-16T15:00:00Z');

    // 验证 URL
    const inboundCall = fetchMock.mock.calls.find(([u]) => String(u).includes('/inbound-messages'));
    expect(inboundCall?.[0]).toBe(`${GATEWAY}/team/sessions/${SESSION_ID}/inbound-messages`);
  });

  it('回复子会话 pending question 时使用目标会话 ID', async () => {
    const childSessionId = 'child-question-session';
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/recovery')) {
        return new Response(
          JSON.stringify({
            recovery: {
              pendingPermissions: [],
              pendingQuestions: [
                {
                  requestId: 'question-child-1',
                  sessionId: childSessionId,
                  title: '需要补充上下文',
                  toolName: 'question',
                  status: 'pending',
                  questions: [],
                  createdAt: '2026-06-16T11:00:00.000Z',
                },
              ],
              session: { id: SESSION_ID, state_status: 'paused', messages: [] },
              todoLanes: { lanes: [] },
              tasks: [],
              children: [],
              ratings: [],
              activeStream: null,
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.includes('/questions/reply')) {
        expect(init?.method).toBe('POST');
        const body = JSON.parse((init?.body as string) ?? '{}');
        expect(body).toEqual({
          answers: [['自己查看上下文任务']],
          requestId: 'question-child-1',
          status: 'answered',
        });
        return new Response(null, { status: 204 });
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() =>
      useTeamConversationState({
        sessionId: SESSION_ID,
        currentUserEmail: EMAIL,
        gatewayUrl: GATEWAY,
        token: TOKEN,
      }),
    );

    await waitFor(() => {
      expect(result.current.isSessionSnapshotReady).toBe(true);
    });

    await act(async () => {
      await result.current.replyQuestion(
        'question-child-1',
        'answered',
        [['自己查看上下文任务']],
        { targetSessionId: childSessionId },
      );
    });

    const replyCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/questions/reply'));
    expect(replyCall?.[0]).toBe(`${GATEWAY}/sessions/${childSessionId}/questions/reply`);
  });

  it('clarification_answer 载荷类型守卫', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/recovery')) {
        return new Response(
          JSON.stringify({
            recovery: {
              pendingPermissions: [],
              pendingQuestions: [],
              session: { id: SESSION_ID, state_status: 'idle', messages: [] },
              todoLanes: { lanes: [] },
              tasks: [],
              children: [],
              ratings: [],
              activeStream: null,
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.includes('/inbound-messages')) {
        const body = JSON.parse((init?.body as string) ?? '{}');
        expect(body.messageType).toBe('clarification_answer');
        expect(body.payload.questionId).toBe('q1');
        expect(body.payload.answer).toBe('OAuth 2.0');
        expect(body.payload.answeredBy).toBe('user');
        return new Response(
          JSON.stringify({ messageId: 'imsg-002', createdAt: '2026-05-16T15:01:00Z' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() =>
      useTeamConversationState({
        sessionId: SESSION_ID,
        currentUserEmail: EMAIL,
        gatewayUrl: GATEWAY,
        token: TOKEN,
      }),
    );

    await waitFor(() => {
      expect(result.current.isSessionSnapshotReady).toBe(true);
    });

    const response = await result.current.submitInbound('clarification_answer', {
      questionId: 'q1',
      answer: 'OAuth 2.0',
      answeredBy: 'user',
      answeredAt: 1700000000000,
    });
    expect(response.messageId).toBe('imsg-002');
  });

  it('clientIdempotencyKey 与 expiresAt 透传', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/recovery')) {
        return new Response(
          JSON.stringify({
            recovery: {
              pendingPermissions: [],
              pendingQuestions: [],
              session: { id: SESSION_ID, state_status: 'idle', messages: [] },
              todoLanes: { lanes: [] },
              tasks: [],
              children: [],
              ratings: [],
              activeStream: null,
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.includes('/inbound-messages')) {
        const body = JSON.parse((init?.body as string) ?? '{}');
        expect(body.clientIdempotencyKey).toBe('idem-abc');
        expect(body.expiresAt).toBe(1700001000000);
        return new Response(
          JSON.stringify({ messageId: 'imsg-003', createdAt: '2026-05-16T15:02:00Z' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() =>
      useTeamConversationState({
        sessionId: SESSION_ID,
        currentUserEmail: EMAIL,
        gatewayUrl: GATEWAY,
        token: TOKEN,
      }),
    );

    await waitFor(() => {
      expect(result.current.isSessionSnapshotReady).toBe(true);
    });

    await result.current.submitInbound(
      'user_input',
      { text: 'with idempotency' },
      { clientIdempotencyKey: 'idem-abc', expiresAt: 1700001000000 },
    );
  });

  it('后端 404（端点未落地）时抛 HttpError 而非崩溃', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/recovery')) {
        return new Response(
          JSON.stringify({
            recovery: {
              pendingPermissions: [],
              pendingQuestions: [],
              session: { id: SESSION_ID, state_status: 'idle', messages: [] },
              todoLanes: { lanes: [] },
              tasks: [],
              children: [],
              ratings: [],
              activeStream: null,
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      // 模拟后端端点尚未落地
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() =>
      useTeamConversationState({
        sessionId: SESSION_ID,
        currentUserEmail: EMAIL,
        gatewayUrl: GATEWAY,
        token: TOKEN,
      }),
    );

    await waitFor(() => {
      expect(result.current.isSessionSnapshotReady).toBe(true);
    });

    await expect(
      result.current.submitInbound('user_input', { text: 'should fail' }),
    ).rejects.toThrow('目标团队会话不存在，无法提交团队反向消息。');
  });
});

describe('useTeamConversationState — startStream 并发保护 (🔴#2)', () => {
  it('流式进行中再次 startStream 抛中文错误而非静默丢弃', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/recovery')) {
        return new Response(
          JSON.stringify({
            recovery: {
              pendingPermissions: [],
              pendingQuestions: [],
              session: { id: SESSION_ID, state_status: 'idle', messages: [] },
              todoLanes: { lanes: [] },
              tasks: [],
              children: [],
              ratings: [],
              activeStream: null,
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(null, { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    // gatewayClient.stream 会真正 new WebSocket(...)：用 MockWebSocket 顶替，
    // 避免 jsdom 真实 WS 在异步回调里抛 "event argument must be an instance of
    // Event" 的 unhandled error（污染整个 suite）。EventSource（SSE fallback）
    // 同理用一个惰性桩顶替。
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);
    class InertEventSource {
      close(): void {
        /* noop */
      }
    }
    vi.stubGlobal('EventSource', InertEventSource as unknown as typeof EventSource);

    const { result } = renderHook(() =>
      useTeamConversationState({
        sessionId: SESSION_ID,
        currentUserEmail: EMAIL,
        gatewayUrl: GATEWAY,
        token: TOKEN,
        enableWriters: true,
      }),
    );

    await waitFor(() => {
      expect(result.current.isSessionSnapshotReady).toBe(true);
    });

    // 第一次发送：进入流式态（streamingRef 同步置 true）。gatewayClient.stream
    // 是 fire-and-forget，不会 await，所以调用返回后 streaming 已为 true。
    await act(async () => {
      await result.current.startStream('first message');
    });

    await waitFor(() => {
      expect(result.current.streaming).toBe(true);
    });

    // 第二次发送：必须抛错（旧实现是静默 return，会让上层丢消息）。
    await expect(result.current.startStream('second message')).rejects.toThrow(/正在生成回复/);
  });
});
