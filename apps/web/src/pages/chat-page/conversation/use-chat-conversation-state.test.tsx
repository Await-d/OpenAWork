// @vitest-environment jsdom
/**
 * useChatConversationState v0.1 骨架测试
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
import { useChatConversationState } from './use-chat-conversation-state.js';

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
    state_status?: 'idle' | 'running' | 'paused';
    messages?: unknown[];
    runEvents?: unknown[];
  };
  todoLanes?: { lanes: unknown[] };
  tasks?: unknown[];
  children?: unknown[];
  ratings?: unknown[];
  activeStream?: unknown;
  totalMessageCount?: number;
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
      };
      return new Response(JSON.stringify({ recovery }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
}

beforeEach(() => {
  // 默认每个测试都先 stub 一次空 fetch，避免漏 stub 导致请求泄漏
  stubRecovery({});
  MockWebSocket.instances.length = 0;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useChatConversationState — 空闲态', () => {
  it('sessionId 为 null 时不发请求且 state 保持空', () => {
    const { result } = renderHook(() =>
      useChatConversationState({
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
      useChatConversationState({
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
      useChatConversationState({
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

describe('useChatConversationState — 加载快照', () => {
  it('sessionId 存在时调用 getRecovery 并写入 state', async () => {
    stubRecovery({
      activeStream: {
        clientRequestId: 'req-1',
        heartbeatAtMs: 1700000001200,
        lastSeq: 2,
        sessionId: SESSION_ID,
        startedAtMs: 1700000000500,
      },
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
            delta: 'hi',
            runId: 'run-1',
            occurredAt: 1700000001100,
          },
          {
            type: 'done',
            stopReason: 'end_turn',
            runId: 'run-1',
            occurredAt: 1700000001200,
            upstreamSummary: {
              stopReason: 'end_turn',
              textDeltaCount: 3,
              reasoningDeltaCount: 1,
              toolCallDeltaCount: 0,
              sawDone: true,
              sawError: false,
              stalled: false,
            },
          },
        ],
      },
      pendingPermissions: [{ id: 'perm1' }],
      pendingQuestions: [{ id: 'q1' }],
    });

    const { result } = renderHook(() =>
      useChatConversationState({
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
    expect(result.current.latestUpstreamSummary).toEqual({
      stopReason: 'end_turn',
      textDeltaCount: 3,
      reasoningDeltaCount: 1,
      toolCallDeltaCount: 0,
      sawDone: true,
      sawError: false,
      stalled: false,
    });
    expect(result.current.sessionStateStatus).toBe('running');
    expect(result.current.remoteSessionBusyState).toBe('running');
    expect(result.current.pendingPermissions).toHaveLength(1);
    expect(result.current.pendingQuestions).toHaveLength(1);
  });

  it('getRecovery 失败时降级为空白态', async () => {
    stubRecovery({ error: true });

    const { result } = renderHook(() =>
      useChatConversationState({
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
});

describe('useChatConversationState — composer setter 暴露', () => {
  it('setInput / setActiveProviderId / setDialogueMode 等 setter 可用', () => {
    const { result } = renderHook(() =>
      useChatConversationState({
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
      result.current.setDialogueMode('coding');
      result.current.setYoloMode(true);
      result.current.setWebSearchEnabled(false);
      result.current.setThinkingEnabled(true);
      result.current.setReasoningEffort('high');
    });

    expect(result.current.input).toBe('hello world');
    expect(result.current.activeProviderId).toBe('anthropic');
    expect(result.current.activeModelId).toBe('claude-sonnet-4');
    expect(result.current.dialogueMode).toBe('coding');
    expect(result.current.yoloMode).toBe(true);
    expect(result.current.webSearchEnabled).toBe(false);
    expect(result.current.thinkingEnabled).toBe(true);
    expect(result.current.reasoningEffort).toBe('high');
  });

  it('defaults 选项被 hook 使用作为初始值', () => {
    const { result } = renderHook(() =>
      useChatConversationState({
        sessionId: null,
        currentUserEmail: EMAIL,
        gatewayUrl: GATEWAY,
        token: TOKEN,
        defaults: {
          activeProviderId: 'openai',
          activeModelId: 'gpt-4o',
          dialogueMode: 'clarify',
          yoloMode: true,
          thinkingEnabled: true,
          reasoningEffort: 'low',
        },
      }),
    );

    expect(result.current.activeProviderId).toBe('openai');
    expect(result.current.activeModelId).toBe('gpt-4o');
    expect(result.current.dialogueMode).toBe('clarify');
    expect(result.current.yoloMode).toBe(true);
    expect(result.current.thinkingEnabled).toBe(true);
    expect(result.current.reasoningEffort).toBe('low');
  });
});

describe('useChatConversationState — 派生状态', () => {
  it('streaming + streamBuffer 都为空时 visibleStreaming = false', () => {
    const { result } = renderHook(() =>
      useChatConversationState({
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
      useChatConversationState({
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

    expect(result.current.sessionStateStatus).toBe('idle');
    expect(result.current.remoteSessionBusyState).toBeNull();
  });

  it('sessionStateStatus 为 paused 时 remoteSessionBusyState = paused', async () => {
    stubRecovery({
      session: { id: SESSION_ID, state_status: 'paused', messages: [] },
    });

    const { result } = renderHook(() =>
      useChatConversationState({
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

    expect(result.current.remoteSessionBusyState).toBe('paused');
  });
});

describe('useChatConversationState — submitInbound (v0.2)', () => {
  it('recovery.session 中无 role_layer/substate 字段时 hook 状态为 null', async () => {
    stubRecovery({
      session: { id: SESSION_ID, state_status: 'idle', messages: [] },
    });

    const { result } = renderHook(() =>
      useChatConversationState({
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
      useChatConversationState({
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
      useChatConversationState({
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
      useChatConversationState({
        sessionId: null,
        currentUserEmail: EMAIL,
        gatewayUrl: GATEWAY,
        token: TOKEN,
      }),
    );

    await expect(result.current.submitInbound('user_input', { text: 'hi' })).rejects.toThrow(
      '当前会话不存在，无法提交团队消息。',
    );
  });

  it('token 缺失时抛错', async () => {
    const { result } = renderHook(() =>
      useChatConversationState({
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
      useChatConversationState({
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
      useChatConversationState({
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
      useChatConversationState({
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
      useChatConversationState({
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
      useChatConversationState({
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
