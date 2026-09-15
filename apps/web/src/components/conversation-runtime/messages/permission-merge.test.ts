/**
 * 共置测试：`permission-merge.ts`。
 *
 * 权限交互在本地消息列表里有两条线：
 *
 * - 工具调用本身携带 `pendingPermissionRequestId`（等待审批）；
 * - 运行事件流会插入一张独立的 `permission` 卡片。
 *
 * 审批/拒绝/结果回填必须同时更新 `content`（持久化轨迹）与 `parts`
 * （渲染真源），且绝不能动到无关消息。这里固定每个公开函数的结果形状
 * 与引用保留规则。
 */
import { describe, expect, it } from 'vitest';
import {
  applyPermissionDecisionToLocalAssistantMessages,
  applyToolResultToLocalAssistantMessages,
  clearResolvedPendingPermissionFromMessage,
  dismissPermissionEventMessage,
  upsertPermissionEventMessage,
} from './permission-merge.js';
import { createAssistantEventCardContent, parseAssistantEventContent } from './card-codec.js';
import type { ChatMessage, ChatMessagePart } from './message-model.js';
import type { AssistantTraceToolCall, RunEvent } from '@openAwork/shared';
import {
  contentFromParts,
  createAssistantTraceContent,
  parseAssistantTraceContent,
} from './trace-codec.js';

const PENDING_TOOL_CALL: AssistantTraceToolCall = {
  toolCallId: 'tool-1',
  toolName: 'Bash',
  input: { command: 'rm -rf /tmp/cache' },
  pendingPermissionRequestId: 'req-1',
  status: 'paused',
};

const RUNNING_TOOL_CALL: AssistantTraceToolCall = {
  toolCallId: 'tool-2',
  toolName: 'Read',
  input: { file: 'a.ts' },
  status: 'running',
};

function buildTraceMessage(
  toolCalls: AssistantTraceToolCall[],
  text = '需要你先确认。',
): ChatMessage {
  return {
    id: 'assistant-1',
    role: 'assistant',
    content: createAssistantTraceContent({ text, toolCalls }),
    status: 'completed',
  };
}

function buildPartMessage(): ChatMessage {
  const parts: ChatMessagePart[] = [
    { id: 'assistant-1:text', type: 'text', text: '需要你先确认。' },
    {
      id: 'tool-1',
      type: 'tool',
      toolCallId: 'tool-1',
      toolName: 'Bash',
      input: {},
      pendingPermissionRequestId: 'req-1',
      status: 'paused',
    },
    {
      id: 'tool-2',
      type: 'tool',
      toolCallId: 'tool-2',
      toolName: 'Read',
      input: {},
      status: 'completed',
      output: 'ok',
    },
  ];
  return {
    id: 'assistant-1',
    role: 'assistant',
    content: contentFromParts(parts),
    parts,
    status: 'completed',
  };
}

function buildPermissionCard(requestId: string, id = 'card-1', createdAt = 500): ChatMessage {
  return {
    id,
    role: 'assistant',
    content: createAssistantEventCardContent({
      kind: 'permission',
      title: '等待权限 · Bash',
      message: 'session · high',
      requestId,
      status: 'paused',
    }),
    createdAt,
    status: 'completed',
  };
}

function toolResultEvent(
  overrides: Partial<Extract<RunEvent, { type: 'tool_result' }>>,
): Extract<RunEvent, { type: 'tool_result' }> {
  return {
    type: 'tool_result',
    toolCallId: 'tool-1',
    toolName: 'Bash',
    output: null,
    isError: false,
    ...overrides,
  };
}

describe('clearResolvedPendingPermissionFromMessage', () => {
  it('非 assistant 消息原样返回', () => {
    const user: ChatMessage = { id: 'u-1', role: 'user', content: '问题' };
    expect(clearResolvedPendingPermissionFromMessage(user, 'req-1')).toBe(user);
  });

  it('没有匹配的 pendingPermissionRequestId 时原样返回', () => {
    const message = buildTraceMessage([PENDING_TOOL_CALL]);
    expect(clearResolvedPendingPermissionFromMessage(message, 'req-other')).toBe(message);
  });

  it('纯文本 assistant 消息（无 trace）原样返回', () => {
    const message: ChatMessage = { id: 'a-1', role: 'assistant', content: '普通回复' };
    expect(clearResolvedPendingPermissionFromMessage(message, 'req-1')).toBe(message);
  });

  it('清空最后一个待审批调用后降级为纯文本正文', () => {
    const message = buildTraceMessage([PENDING_TOOL_CALL]);
    const cleared = clearResolvedPendingPermissionFromMessage(message, 'req-1');

    expect(cleared).not.toBeNull();
    expect(cleared?.id).toBe('assistant-1');
    expect(cleared?.status).toBe('completed');
    expect(parseAssistantTraceContent(cleared?.content ?? '')).toBeNull();
    expect(cleared?.content).toBe('需要你先确认。');
    expect(cleared?.toolCallCount).toBeUndefined();
  });

  it('仅含待审批调用的消息被整体丢弃', () => {
    const message = buildTraceMessage([PENDING_TOOL_CALL], '');
    expect(clearResolvedPendingPermissionFromMessage(message, 'req-1')).toBeNull();
  });

  it('保留其他不相关的工具调用', () => {
    const message = buildTraceMessage([PENDING_TOOL_CALL, RUNNING_TOOL_CALL]);
    const cleared = clearResolvedPendingPermissionFromMessage(message, 'req-1');

    const trace = parseAssistantTraceContent(cleared?.content ?? '');
    expect(trace?.text).toBe('需要你先确认。');
    expect(trace?.toolCalls.map((toolCall) => toolCall.toolCallId)).toEqual(['tool-2']);
    expect(cleared?.toolCallCount).toBe(1);
  });

  it('同时从 parts 中移除对应工具分片并保留其他分片引用', () => {
    const message = buildPartMessage();
    const cleared = clearResolvedPendingPermissionFromMessage(message, 'req-1');

    expect(cleared?.parts?.map((part) => part.id)).toEqual(['assistant-1:text', 'tool-2']);
    expect(cleared?.parts?.[0]).toBe(message.parts?.[0]);
    expect(cleared?.parts?.[1]).toBe(message.parts?.[2]);
    expect(parseAssistantTraceContent(cleared?.content ?? '')?.toolCalls).toHaveLength(1);
  });
});

describe('applyPermissionDecisionToLocalAssistantMessages', () => {
  it('拒绝：工具标记失败并写入默认拒绝文案', () => {
    const messages = [buildTraceMessage([PENDING_TOOL_CALL])];
    const next = applyPermissionDecisionToLocalAssistantMessages(messages, 'req-1', 'reject');

    const toolCall = parseAssistantTraceContent(next[0]?.content ?? '')?.toolCalls[0];
    expect(toolCall).toEqual({
      toolCallId: 'tool-1',
      toolName: 'Bash',
      input: { command: 'rm -rf /tmp/cache' },
      isError: true,
      output: '权限已拒绝，工具未执行。',
      status: 'failed',
    });
    expect(toolCall).not.toHaveProperty('pendingPermissionRequestId');
    expect(next[0]?.status).toBe('completed');
  });

  it('拒绝带反馈：追加用户反馈文案', () => {
    const messages = [buildTraceMessage([PENDING_TOOL_CALL])];
    const next = applyPermissionDecisionToLocalAssistantMessages(
      messages,
      'req-1',
      'reject',
      '不要执行删除',
    );

    const toolCall = parseAssistantTraceContent(next[0]?.content ?? '')?.toolCalls[0];
    expect(toolCall?.output).toBe('权限已拒绝。用户反馈: 不要执行删除');
  });

  it('批准：工具恢复运行并标记 resumedAfterApproval', () => {
    const messages = [buildTraceMessage([PENDING_TOOL_CALL])];
    const next = applyPermissionDecisionToLocalAssistantMessages(messages, 'req-1', 'once');

    const toolCall = parseAssistantTraceContent(next[0]?.content ?? '')?.toolCalls[0];
    expect(toolCall?.status).toBe('running');
    expect(toolCall?.resumedAfterApproval).toBe(true);
    expect(toolCall?.isError).toBe(false);
    expect(toolCall?.output).toBeUndefined();
    expect(toolCall).not.toHaveProperty('pendingPermissionRequestId');
  });

  it('parts 同步更新为运行态且无关分片保持引用', () => {
    const message = buildPartMessage();
    const next = applyPermissionDecisionToLocalAssistantMessages([message], 'req-1', 'session');

    const updated = next[0]?.parts?.[1];
    expect(updated).toMatchObject({ status: 'running', resumedAfterApproval: true });
    expect(updated).not.toHaveProperty('pendingPermissionRequestId');
    expect(next[0]?.parts?.[0]).toBe(message.parts?.[0]);
    expect(next[0]?.parts?.[2]).toBe(message.parts?.[2]);
  });

  it('没有匹配请求的消息保持原引用', () => {
    const user: ChatMessage = { id: 'u-1', role: 'user', content: '问题' };
    const assistant = buildTraceMessage([RUNNING_TOOL_CALL]);
    const messages = [user, assistant];
    const next = applyPermissionDecisionToLocalAssistantMessages(messages, 'req-1', 'reject');

    expect(next).toHaveLength(2);
    expect(next[0]).toBe(user);
    expect(next[1]).toBe(assistant);
  });

  it('不修改输入消息列表本身', () => {
    const messages = [buildTraceMessage([PENDING_TOOL_CALL])];
    const before = messages[0]?.content;

    applyPermissionDecisionToLocalAssistantMessages(messages, 'req-1', 'once');

    expect(messages[0]?.content).toBe(before);
  });
});

describe('dismissPermissionEventMessage', () => {
  it('移除 requestId 匹配的权限卡片，保留其他卡片与非 assistant 消息', () => {
    const user: ChatMessage = { id: 'u-1', role: 'user', content: '问题' };
    const permissionCard = buildPermissionCard('req-1');
    const otherPermissionCard = buildPermissionCard('req-2', 'card-2');
    const questionCard: ChatMessage = {
      id: 'card-3',
      role: 'assistant',
      content: createAssistantEventCardContent({
        kind: 'question',
        title: '等待回答',
        message: '请选择',
        requestId: 'req-1',
        status: 'paused',
      }),
      status: 'completed',
    };

    const next = dismissPermissionEventMessage(
      [user, permissionCard, otherPermissionCard, questionCard],
      'req-1',
    );

    expect(next.map((message) => message.id)).toEqual(['u-1', 'card-2', 'card-3']);
    expect(next[0]).toBe(user);
    expect(next[1]).toBe(otherPermissionCard);
    expect(next[2]).toBe(questionCard);
  });
});

describe('applyToolResultToLocalAssistantMessages', () => {
  it('成功结果：工具标记 completed 并写入输出', () => {
    const message = buildTraceMessage([RUNNING_TOOL_CALL]);
    const next = applyToolResultToLocalAssistantMessages([message], {
      type: 'tool_result',
      toolCallId: 'tool-2',
      toolName: 'Read',
      output: { ok: true },
      isError: false,
    });

    const toolCall = parseAssistantTraceContent(next[0]?.content ?? '')?.toolCalls[0];
    expect(toolCall).toMatchObject({ status: 'completed', output: { ok: true }, isError: false });
  });

  it('错误结果：工具标记 failed 并保留 isError', () => {
    const message = buildTraceMessage([RUNNING_TOOL_CALL]);
    const next = applyToolResultToLocalAssistantMessages(
      [message],
      toolResultEvent({ toolCallId: 'tool-2', output: 'boom', isError: true }),
    );

    const toolCall = parseAssistantTraceContent(next[0]?.content ?? '')?.toolCalls[0];
    expect(toolCall).toMatchObject({ status: 'failed', output: 'boom', isError: true });
  });

  it('待审批结果：工具转为 paused 并挂起请求 ID', () => {
    const message = buildTraceMessage([RUNNING_TOOL_CALL]);
    const next = applyToolResultToLocalAssistantMessages(
      [message],
      toolResultEvent({
        toolCallId: 'tool-2',
        output: 'waiting for approval',
        pendingPermissionRequestId: 'req-9',
      }),
    );

    const toolCall = parseAssistantTraceContent(next[0]?.content ?? '')?.toolCalls[0];
    expect(toolCall).toMatchObject({
      status: 'paused',
      pendingPermissionRequestId: 'req-9',
      isError: false,
    });
  });

  it('审批已通过的结果清除挂起状态并标记 resumedAfterApproval', () => {
    const message = buildTraceMessage([PENDING_TOOL_CALL]);
    const next = applyToolResultToLocalAssistantMessages(
      [message],
      toolResultEvent({
        output: 'done',
        pendingPermissionRequestId: 'req-1',
        resumedAfterApproval: true,
      }),
    );

    const toolCall = parseAssistantTraceContent(next[0]?.content ?? '')?.toolCalls[0];
    expect(toolCall).toMatchObject({ status: 'completed', resumedAfterApproval: true });
    expect(toolCall).not.toHaveProperty('pendingPermissionRequestId');
  });

  it('无匹配 toolCallId 时返回原数组', () => {
    const messages = [buildTraceMessage([RUNNING_TOOL_CALL])];
    expect(
      applyToolResultToLocalAssistantMessages(messages, toolResultEvent({ toolCallId: 'missing' })),
    ).toBe(messages);
  });

  it('parts 同步更新且无关分片保持引用', () => {
    const message = buildPartMessage();
    const next = applyToolResultToLocalAssistantMessages(
      [message],
      toolResultEvent({ output: 'done' }),
    );

    expect(next[0]?.parts?.[1]).toMatchObject({ status: 'completed', output: 'done' });
    expect(next[0]?.parts?.[0]).toBe(message.parts?.[0]);
    expect(next[0]?.parts?.[2]).toBe(message.parts?.[2]);
  });

  it('保留非 assistant 消息', () => {
    const user: ChatMessage = { id: 'u-1', role: 'user', content: '问题' };
    const message = buildTraceMessage([RUNNING_TOOL_CALL]);
    const next = applyToolResultToLocalAssistantMessages(
      [user, message],
      toolResultEvent({ toolCallId: 'tool-2', output: 'ok' }),
    );

    expect(next[0]).toBe(user);
  });
});

describe('upsertPermissionEventMessage', () => {
  it('没有既有卡片时追加一条新消息', () => {
    const user: ChatMessage = { id: 'u-1', role: 'user', content: '问题' };
    const next = upsertPermissionEventMessage([user], {
      type: 'permission_asked',
      requestId: 'req-1',
      toolName: 'Bash',
      scope: 'session',
      reason: '需要执行命令',
      riskLevel: 'high',
      occurredAt: 1_234,
    });

    expect(next).toHaveLength(2);
    expect(next[0]).toBe(user);
    expect(next[1]?.role).toBe('assistant');
    expect(next[1]?.id).toEqual(expect.any(String));
    expect(next[1]?.id.length).toBeGreaterThan(0);
    expect(next[1]?.createdAt).toBe(1_234);
    expect(next[1]?.status).toBe('completed');
    expect(parseAssistantEventContent(next[1]?.content ?? '')).toMatchObject({
      kind: 'permission',
      requestId: 'req-1',
    });
  });

  it('命中原卡片时原位替换并保留 id 与 createdAt', () => {
    const user: ChatMessage = { id: 'u-1', role: 'user', content: '问题' };
    const card = buildPermissionCard('req-1', 'card-1', 500);
    const next = upsertPermissionEventMessage([user, card], {
      type: 'permission_replied',
      requestId: 'req-1',
      decision: 'once',
      occurredAt: 9_999,
    });

    expect(next).toHaveLength(2);
    expect(next[0]).toBe(user);
    expect(next[1]?.id).toBe('card-1');
    expect(next[1]?.createdAt).toBe(500);
    expect(next[1]?.content).toBe(
      createAssistantEventCardContent({
        kind: 'permission',
        title: '权限已响应',
        message: '本次允许',
        requestId: 'req-1',
        status: 'success',
      }),
    );
  });

  it('重复的同请求卡片在命中后只保留一条', () => {
    const cardA = buildPermissionCard('req-1', 'card-a');
    const cardB = buildPermissionCard('req-1', 'card-b');
    const next = upsertPermissionEventMessage([cardA, cardB], {
      type: 'permission_replied',
      requestId: 'req-1',
      decision: 'reject',
    });

    expect(next).toHaveLength(1);
    expect(next[0]?.id).toBe('card-a');
  });

  it('requestId 不同的卡片保持不变', () => {
    const cardA = buildPermissionCard('req-1', 'card-a');
    const cardB = buildPermissionCard('req-2', 'card-b');
    const next = upsertPermissionEventMessage([cardA, cardB], {
      type: 'permission_replied',
      requestId: 'req-2',
      decision: 'permanent',
    });

    expect(next).toHaveLength(2);
    expect(next[0]).toBe(cardA);
    expect(next[1]?.id).toBe('card-b');
    expect(next[1]?.content).toContain('永久允许');
  });

  it('空列表也能追加', () => {
    const next = upsertPermissionEventMessage([], {
      type: 'permission_asked',
      requestId: 'req-1',
      toolName: 'Bash',
      scope: 'session',
      reason: '原因',
      riskLevel: 'low',
    });

    expect(next).toHaveLength(1);
    expect(next[0]?.status).toBe('completed');
  });
});
