// @vitest-environment jsdom
/**
 * useChatPendingActions v0.1 骨架测试
 *
 * 覆盖：
 * 1. 初始状态：所有队列与草稿为空
 * 2. activePendingQuestion 派生：只取首条 status==='pending' 的问题
 * 3. activePendingQuestion 切换时 inline 草稿被重置
 * 4. toggleInlineQuestionOption 单选 / 多选语义
 * 5. handleInlineQuestionCustomInput 写入对应 index
 * 6. replyInlineQuestion 缺 token / 无 active 问题时静默返回
 * 7. replyInlineQuestion 成功后 pendingQuestions 移除该 requestId
 * 8. replyInlineQuestion 409 / 404 时也移除 + toast
 * 9. handleInlinePermissionDecision 缺 token 时设置 streamError
 * 10. handleInlinePermissionDecision 成功后 messages / pending / right-panel 都被
 *     更新（通过 setter spy 检测）
 * 11. resolveInlinePermissionActions 返回 4 个按钮 + 携带 pending 决策状态
 * 12. resolveInlinePermissionActions 对未知 requestId 返回 undefined
 *
 * 参考：use-chat-conversation-state.test.tsx 的 fetch stub 风格。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useChatPendingActions } from './use-chat-pending-actions.js';
import type { PendingPermissionRequest, PendingQuestionRequest } from '@openAwork/web-client';

const TOKEN = 'tok-fake';
const GATEWAY = 'https://gw.test';
const SESSION_ID = 'session-test-001';

function makeQuestion(
  requestId: string,
  status: 'pending' | 'answered' | 'dismissed' = 'pending',
): PendingQuestionRequest {
  return {
    requestId,
    sessionId: SESSION_ID,
    questions: [
      { question: 'q1', options: ['A', 'B'], multiple: false },
      { question: 'q2', options: ['X', 'Y'], multiple: true },
    ],
    status,
    createdAt: 1700000000000,
  } as unknown as PendingQuestionRequest;
}

function makePermissionRequest(requestId: string): PendingPermissionRequest {
  return {
    requestId,
    sessionId: SESSION_ID,
    toolName: 'shell',
    toolInput: { command: 'rm -rf /' },
    createdAt: 1700000000000,
  } as unknown as PendingPermissionRequest;
}

function makeOptions(overrides?: Partial<Parameters<typeof useChatPendingActions>[0]>) {
  return {
    gatewayUrl: GATEWAY,
    token: TOKEN,
    currentSessionId: SESSION_ID,
    setMessages: vi.fn() as never,
    setRightPanelState: vi.fn() as never,
    setStreamError: vi.fn() as never,
    ...(overrides ?? {}),
  };
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(null, { status: 204 })),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useChatPendingActions — 初始 + 派生', () => {
  it('初始队列与 inline 草稿都为空', () => {
    const { result } = renderHook(() => useChatPendingActions(makeOptions()));

    expect(result.current.pendingPermissions).toEqual([]);
    expect(result.current.pendingQuestions).toEqual([]);
    expect(result.current.activePendingQuestion).toBeNull();
    expect(result.current.inlineQuestionAnswers).toEqual([]);
    expect(result.current.inlineQuestionCustomInputs).toEqual([]);
    expect(result.current.inlineQuestionReplyStatus).toBeNull();
    expect(result.current.inlineQuestionReplyError).toBeNull();
    expect(result.current.inlinePermissionPendingDecision).toBeNull();
    expect(result.current.inlinePermissionErrors).toEqual({});
  });

  it('activePendingQuestion 选第一条 pending 状态的问题', () => {
    const { result } = renderHook(() => useChatPendingActions(makeOptions()));

    act(() => {
      result.current.setPendingQuestions([
        makeQuestion('q-answered', 'answered'),
        makeQuestion('q-pending-1'),
        makeQuestion('q-pending-2'),
      ]);
    });

    expect(result.current.activePendingQuestion?.requestId).toBe('q-pending-1');
  });

  it('activePendingQuestion 切换后 inline 草稿被重置为对应问题数', async () => {
    const { result } = renderHook(() => useChatPendingActions(makeOptions()));

    act(() => {
      result.current.setPendingQuestions([makeQuestion('q1')]);
    });

    await waitFor(() => {
      expect(result.current.inlineQuestionAnswers.length).toBe(2);
      expect(result.current.inlineQuestionCustomInputs.length).toBe(2);
    });
  });
});

describe('useChatPendingActions — inline 问题草稿', () => {
  it('toggleInlineQuestionOption 单选互斥', async () => {
    const { result } = renderHook(() => useChatPendingActions(makeOptions()));

    act(() => {
      result.current.setPendingQuestions([makeQuestion('q1')]);
    });
    await waitFor(() => {
      expect(result.current.inlineQuestionAnswers.length).toBe(2);
    });

    act(() => {
      result.current.toggleInlineQuestionOption(0, 'A', false);
    });
    expect(result.current.inlineQuestionAnswers[0]).toEqual(['A']);

    act(() => {
      result.current.toggleInlineQuestionOption(0, 'B', false);
    });
    expect(result.current.inlineQuestionAnswers[0]).toEqual(['B']);

    // 再点击同一个选项 → 取消选择
    act(() => {
      result.current.toggleInlineQuestionOption(0, 'B', false);
    });
    expect(result.current.inlineQuestionAnswers[0]).toEqual([]);
  });

  it('toggleInlineQuestionOption 多选累加 / 取消', async () => {
    const { result } = renderHook(() => useChatPendingActions(makeOptions()));

    act(() => {
      result.current.setPendingQuestions([makeQuestion('q1')]);
    });
    await waitFor(() => {
      expect(result.current.inlineQuestionAnswers.length).toBe(2);
    });

    act(() => {
      result.current.toggleInlineQuestionOption(1, 'X', true);
      result.current.toggleInlineQuestionOption(1, 'Y', true);
    });
    expect(result.current.inlineQuestionAnswers[1]).toEqual(['X', 'Y']);

    act(() => {
      result.current.toggleInlineQuestionOption(1, 'X', true);
    });
    expect(result.current.inlineQuestionAnswers[1]).toEqual(['Y']);
  });

  it('handleInlineQuestionCustomInput 写入对应 index', async () => {
    const { result } = renderHook(() => useChatPendingActions(makeOptions()));

    act(() => {
      result.current.setPendingQuestions([makeQuestion('q1')]);
    });
    await waitFor(() => {
      expect(result.current.inlineQuestionCustomInputs.length).toBe(2);
    });

    act(() => {
      result.current.handleInlineQuestionCustomInput(1, 'extra context');
    });
    expect(result.current.inlineQuestionCustomInputs[1]).toBe('extra context');
  });
});

describe('useChatPendingActions — replyInlineQuestion', () => {
  it('缺 token 时静默返回', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useChatPendingActions(makeOptions({ token: null })));

    act(() => {
      result.current.setPendingQuestions([makeQuestion('q1')]);
    });

    await act(async () => {
      await result.current.replyInlineQuestion('answered');
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('成功后 pendingQuestions 移除该 requestId', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useChatPendingActions(makeOptions()));

    act(() => {
      result.current.setPendingQuestions([makeQuestion('q1')]);
    });

    await act(async () => {
      await result.current.replyInlineQuestion('answered');
    });

    expect(fetchMock).toHaveBeenCalled();
    expect(result.current.pendingQuestions).toEqual([]);
    expect(result.current.inlineQuestionReplyError).toBeNull();
  });

  it('409/404 时也清掉该 question (后端已过期)', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: 'Question request expired' }), {
          status: 409,
          headers: { 'content-type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useChatPendingActions(makeOptions()));

    act(() => {
      result.current.setPendingQuestions([makeQuestion('q1')]);
    });

    await act(async () => {
      await result.current.replyInlineQuestion('answered');
    });

    expect(result.current.pendingQuestions).toEqual([]);
    expect(result.current.inlineQuestionReplyError).toBeNull();
  });
});

describe('useChatPendingActions — handleInlinePermissionDecision', () => {
  it('缺 token 时设置 streamError 并直接返回', async () => {
    const setStreamError = vi.fn();
    const { result } = renderHook(() =>
      useChatPendingActions(makeOptions({ token: null, setStreamError: setStreamError as never })),
    );

    await act(async () => {
      await result.current.handleInlinePermissionDecision(makePermissionRequest('p1'), 'session');
    });

    expect(setStreamError).toHaveBeenCalledWith('当前未登录，无法处理权限审批。');
  });

  it('成功路径：reply 返回后 pending 队列移除并通知右栏与 messages', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    const setMessages = vi.fn();
    const setRightPanelState = vi.fn();

    const { result } = renderHook(() =>
      useChatPendingActions(
        makeOptions({
          setMessages: setMessages as never,
          setRightPanelState: setRightPanelState as never,
        }),
      ),
    );

    act(() => {
      result.current.setPendingPermissions([makePermissionRequest('p1')]);
    });

    await act(async () => {
      await result.current.handleInlinePermissionDecision(makePermissionRequest('p1'), 'session');
    });

    expect(result.current.pendingPermissions).toEqual([]);
    expect(setMessages).toHaveBeenCalled();
    expect(setRightPanelState).toHaveBeenCalled();
  });
});

describe('useChatPendingActions — resolveInlinePermissionActions', () => {
  it('未知 requestId 返回 undefined', () => {
    const { result } = renderHook(() => useChatPendingActions(makeOptions()));
    expect(result.current.resolveInlinePermissionActions('unknown')).toBeUndefined();
  });

  it('已知请求返回 4 个按钮 + helper 文案', () => {
    const { result } = renderHook(() => useChatPendingActions(makeOptions()));

    act(() => {
      result.current.setPendingPermissions([makePermissionRequest('p1')]);
    });

    const actions = result.current.resolveInlinePermissionActions('p1');
    expect(actions).toBeDefined();
    expect(actions?.items.map((it) => it.id)).toEqual(['session', 'once', 'permanent', 'reject']);
    expect(actions?.items.find((it) => it.id === 'reject')?.danger).toBe(true);
    expect(actions?.items.find((it) => it.id === 'session')?.primary).toBe(true);
  });
});
