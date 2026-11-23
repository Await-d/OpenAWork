// @vitest-environment jsdom
/**
 * 团队会话「后台流（多路 SSE）」实时渲染回归测试。
 *
 * 背景：多路 SSE 连接是**常驻**的 —— 网关只在连接建立那一刻判定一次「有无活跃流」，
 * 之后即便流已结束也不会关闭连接。早前把「连接存在」当成「正在流式输出」，于是
 * `streaming` 永久为 true，带来两个用户可见故障：
 *
 *   1. composer 一直提示「正在生成回复」并拒绝发送；
 *   2. 快照 reload 被流式守卫丢弃，最终回复（以及层级消息）只能刷新页面才出现。
 *
 * 这里锁定修复后的两条不变量：
 *   - `streaming` 由真实事件驱动：内容事件置位、终态事件复位；
 *   - multi-attach 活跃时快照仍然合流（服务端快照始终是权威真相）。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { RunEvent } from '@openAwork/shared';
import type { HandoffEvent } from '../../../stores/team/team-events.js';
import { useLayerStore, useTeamNotificationStore } from '../../../stores/team/team-events.js';
import { useMultiAttachStore } from '../../../stores/team/multi-attach-store.js';
import {
  isMultiAttachContentEvent,
  isMultiAttachTerminalEvent,
} from './use-team-conversation-state-streaming.js';
import { useTeamConversationState } from './use-team-conversation-state.js';

const SESSION_ID = 'session-multi-attach-001';
const TOKEN = 'tok-fake';
const GATEWAY = 'https://gw.test';
const EMAIL = 'qa@example.com';

function userMessage(id: string, content: string, createdAtMs: number) {
  return { id, role: 'user', content, createdAtMs };
}

function assistantMessage(id: string, content: string, createdAtMs: number) {
  return { id, role: 'assistant', content, createdAtMs };
}

function recoveryResponse(messages: unknown[]): Response {
  return new Response(
    JSON.stringify({
      recovery: {
        pendingPermissions: [],
        pendingQuestions: [],
        session: { id: SESSION_ID, state_status: 'running', messages },
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

function stubRecovery(messages: unknown[]) {
  const fetchMock = vi.fn(async () => recoveryResponse(messages));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderTeamConversation() {
  return renderHook(() =>
    useTeamConversationState({
      sessionId: SESSION_ID,
      currentUserEmail: EMAIL,
      gatewayUrl: GATEWAY,
      token: TOKEN,
    }),
  );
}

/** 把多路 SSE 标记为「已连接」——调用后 multiAttachActive 应为 true（streaming 不变）。 */
async function connectMultiAttach(): Promise<void> {
  await act(async () => {
    useMultiAttachStore.getState().setSessionState(SESSION_ID, 'connected');
  });
  await settleAsyncWork();
}

async function emitMultiAttachEvent(event: RunEvent, rowId: number): Promise<void> {
  await act(async () => {
    useMultiAttachStore.getState().dispatchEvent(SESSION_ID, event, { rowId });
  });
  await settleAsyncWork();
}

async function pushTeamEvent(event: HandoffEvent): Promise<void> {
  await act(async () => {
    useTeamNotificationStore.getState().push(event);
  });
  await settleAsyncWork();
}

/** 反复让出微任务，等 hook 在飞的 recovery 请求结算（reload 有去重锁）。 */
async function settleAsyncWork(): Promise<void> {
  for (let index = 0; index < 6; index += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

beforeEach(() => {
  useLayerStore.getState().clear();
  useTeamNotificationStore.getState().clear();
  useMultiAttachStore.getState().removeSession(SESSION_ID);
});

afterEach(() => {
  cleanup();
  useLayerStore.getState().clear();
  useTeamNotificationStore.getState().clear();
  useMultiAttachStore.getState().removeSession(SESSION_ID);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('multi-attach 事件分类', () => {
  it('内容/工具事件算作流式内容', () => {
    expect(isMultiAttachContentEvent({ type: 'text_delta', delta: 'x' })).toBe(true);
    expect(isMultiAttachContentEvent({ type: 'thinking_delta', delta: 'x' })).toBe(true);
    expect(
      isMultiAttachContentEvent({
        type: 'tool_result',
        toolCallId: 'tc',
        toolName: 'read',
        output: 'ok',
        isError: false,
      }),
    ).toBe(true);
  });

  it('usage / 提问 / 权限事件不算流式内容', () => {
    expect(
      isMultiAttachContentEvent({
        type: 'usage',
        round: 1,
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
      }),
    ).toBe(false);
    expect(isMultiAttachContentEvent({ type: 'done', stopReason: 'end_turn' })).toBe(false);
  });

  it('done 与终态 error 判定为终态', () => {
    expect(isMultiAttachTerminalEvent({ type: 'done', stopReason: 'end_turn' })).toBe(true);
    expect(
      isMultiAttachTerminalEvent({ type: 'error', code: 'STREAM_ERROR', message: 'boom' }),
    ).toBe(true);
  });

  it('流内非终态 error 不判定为终态（流仍在继续）', () => {
    expect(
      isMultiAttachTerminalEvent({
        type: 'error',
        code: 'TOOL_ERROR',
        message: '单次工具调用被放弃',
      }),
    ).toBe(false);
  });
});

describe('useTeamConversationState —— 多路 SSE 与 streaming 解耦', () => {
  it('连接成功本身不进入流式；内容事件才置位，终态事件复位', async () => {
    stubRecovery([userMessage('m1', '帮我规划', 1_700_000_000_000)]);
    const { result } = renderTeamConversation();
    await waitFor(() => expect(result.current.messages).toHaveLength(1));

    await connectMultiAttach();
    // 连接常驻但还没有输出 —— 不得让 UI 停在「正在生成回复」。
    expect(result.current.streaming).toBe(false);

    await emitMultiAttachEvent({ type: 'text_delta', delta: '收到，', occurredAt: Date.now() }, 1);
    expect(result.current.streaming).toBe(true);

    await emitMultiAttachEvent({ type: 'done', stopReason: 'end_turn' }, 2);
    await waitFor(() => expect(result.current.streaming).toBe(false));
  });

  it('多路 SSE 活跃（streaming 为 true）时，快照刷新仍然合流', async () => {
    const fetchMock = stubRecovery([userMessage('m1', '帮我规划', 1_700_000_000_000)]);
    const { result } = renderTeamConversation();
    await waitFor(() => expect(result.current.messages).toHaveLength(1));

    await connectMultiAttach();
    await emitMultiAttachEvent(
      { type: 'text_delta', delta: '正在处理…', occurredAt: Date.now() },
      1,
    );
    expect(result.current.streaming).toBe(true);

    // 网关把后台流的最终回复持久化进会话快照。
    fetchMock.mockImplementation(async () =>
      recoveryResponse([
        userMessage('m1', '帮我规划', 1_700_000_000_000),
        assistantMessage('m2', '规划已就绪', 1_700_000_001_000),
      ]),
    );

    // 团队事件触发的 reload 必须能落进消息列表 —— 这正是「必须刷新页面才看到」
    // 的根因所在。
    await pushTeamEvent({
      type: 'session.substate.changed',
      sessionId: SESSION_ID,
      timestamp: Date.now(),
      payload: { substate: 'executing' },
    });

    await waitFor(() =>
      expect(result.current.messages.some((message) => message.id === 'm2')).toBe(true),
    );
    // 合流不应把仍在流式中的本地视图切掉。
    expect(result.current.streaming).toBe(true);
  });
});
