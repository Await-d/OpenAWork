import type { RunEvent } from '@openAwork/shared';
import { describe, expect, it } from 'vitest';

import {
  recoverActiveAssistantStream,
  recoveredStreamHasVisibleContent,
} from './stream-recovery.js';

describe('recoveredStreamHasVisibleContent', () => {
  const base = {
    messageId: null,
    parts: [],
    startedAt: null,
    text: '',
    thinkingBlocks: [],
    toolCalls: [],
    usage: null,
  } satisfies Parameters<typeof recoveredStreamHasVisibleContent>[0];

  it('只有 usage 的空快照不算可见内容（不能撑起流式气泡）', () => {
    expect(recoveredStreamHasVisibleContent(base)).toBe(false);
    expect(
      recoveredStreamHasVisibleContent({
        ...base,
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, round: 3 },
      }),
    ).toBe(false);
  });

  it('任一类进行中片段都算可见内容', () => {
    expect(recoveredStreamHasVisibleContent({ ...base, text: '输出中' })).toBe(true);
    expect(
      recoveredStreamHasVisibleContent({ ...base, parts: [{ id: 'p', type: 'text', text: 'x' }] }),
    ).toBe(true);
    expect(
      recoveredStreamHasVisibleContent({
        ...base,
        thinkingBlocks: [{ key: 'k', text: '思考', startedAt: 1 }],
      }),
    ).toBe(true);
    expect(
      recoveredStreamHasVisibleContent({
        ...base,
        toolCalls: [{ toolCallId: 'c', toolName: 'bash', input: {}, status: 'running' }],
      }),
    ).toBe(true);
  });
});

describe('recoverActiveAssistantStream', () => {
  it('最后一轮已落库（usage 是轮结束信号）时不把它的正文当成进行中轮', () => {
    const recovered = recoverActiveAssistantStream({
      hasActiveStream: true,
      activeStreamStartedAt: 100,
      sessionStateStatus: 'running',
      messages: [],
      runEvents: [
        {
          type: 'text_delta',
          delta: 'hello',
          runId: 'run-1',
          occurredAt: 120,
        },
        {
          type: 'usage',
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30,
          round: 1,
          runId: 'run-1',
          occurredAt: 130,
        },
      ],
    });

    // `usage` 在 `finalizeAssistant` 落库之后发出，所以这轮内容已经由 transcript
    // 负责；快照再持有它，attach 就会用下一轮的键把同一批内容重复提交一次。
    expect(recovered).toMatchObject({
      text: '',
      parts: [],
      toolCalls: [],
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
      },
    });
    expect(recovered?.upstreamSummary).toBeUndefined();
  });

  it('多轮 run 的恢复快照只保留最后一个 usage 之后的进行中轮', () => {
    const recovered = recoverActiveAssistantStream({
      hasActiveStream: true,
      activeStreamStartedAt: 100,
      sessionStateStatus: 'running',
      messages: [],
      runEvents: [
        {
          type: 'text_delta',
          delta: '第一轮输出',
          runId: 'run-multi',
          occurredAt: 110,
        },
        {
          type: 'tool_call_delta',
          toolCallId: 'call-1',
          toolName: 'bash',
          inputDelta: '{"command":"ls"}',
          runId: 'run-multi',
          occurredAt: 115,
        },
        {
          type: 'usage',
          inputTokens: 1,
          outputTokens: 2,
          totalTokens: 3,
          round: 1,
          runId: 'run-multi',
          occurredAt: 120,
        },
        {
          type: 'tool_result',
          toolCallId: 'call-1',
          toolName: 'bash',
          output: { ok: true },
          isError: false,
          runId: 'run-multi',
          occurredAt: 130,
        },
        {
          type: 'text_delta',
          delta: '第二轮输出',
          runId: 'run-multi',
          occurredAt: 140,
        },
      ],
    });

    expect(recovered?.text).toBe('第二轮输出');
    expect(recovered?.parts.map((part) => part.type)).toEqual(['text']);
    // usage 仍是本轮之前已完成的轮次（网关每轮只发一次），调用方据此推出当前轮。
    expect(recovered?.usage?.round).toBe(1);
  });

  it('run 已终态（最后事件是 done）时不产出恢复快照', () => {
    const recovered = recoverActiveAssistantStream({
      hasActiveStream: true,
      activeStreamStartedAt: 100,
      sessionStateStatus: 'paused',
      messages: [],
      runEvents: [
        {
          type: 'text_delta',
          delta: '我先确认一下',
          runId: 'run-question',
          occurredAt: 110,
        },
        {
          type: 'usage',
          inputTokens: 5,
          outputTokens: 6,
          totalTokens: 11,
          round: 11,
          runId: 'run-question',
          occurredAt: 120,
        },
        {
          type: 'done',
          stopReason: 'tool_permission',
          runId: 'run-question',
          occurredAt: 130,
        } as RunEvent,
      ],
    });

    // 提问 / 审批暂停后主 run 立刻 done，这轮内容已落库，快照不应再充当「进行中」。
    expect(recovered).toBeNull();
  });

  it('恢复活动流时保留最早解析到的上游路由信息', () => {
    const recovered = recoverActiveAssistantStream({
      hasActiveStream: true,
      activeStreamStartedAt: 100,
      sessionStateStatus: 'running',
      messages: [],
      runEvents: [
        {
          type: 'upstream_route',
          modelId: 'gpt-5.4',
          providerId: 'openai-fast',
          runId: 'run-1',
          occurredAt: 110,
        },
        {
          type: 'text_delta',
          delta: 'hello',
          runId: 'run-1',
          occurredAt: 120,
        },
      ],
    });

    expect(recovered?.upstreamRoute).toEqual({
      modelId: 'gpt-5.4',
      providerId: 'openai-fast',
    });
  });

  it('按事件到达顺序恢复文本和工具，并把工具结果合并到原位置', () => {
    const recovered = recoverActiveAssistantStream({
      hasActiveStream: true,
      activeStreamStartedAt: 100,
      sessionStateStatus: 'running',
      messages: [],
      runEvents: [
        {
          type: 'text_delta',
          delta: '先检查配置。',
          runId: 'run-ordered',
          occurredAt: 110,
        },
        {
          type: 'tool_call_delta',
          toolCallId: 'tool-read',
          toolName: 'read_file',
          inputDelta: '{"path":"config.json"}',
          runId: 'run-ordered',
          occurredAt: 120,
        },
        {
          type: 'tool_result',
          toolCallId: 'tool-read',
          toolName: 'read_file',
          output: { exists: true },
          isError: false,
          runId: 'run-ordered',
          occurredAt: 130,
        },
        {
          type: 'text_delta',
          delta: '配置正常，再检查入口。',
          runId: 'run-ordered',
          occurredAt: 140,
        },
        {
          type: 'tool_call_delta',
          toolCallId: 'tool-entry',
          toolName: 'read_file',
          inputDelta: '{"path":"index.ts"}',
          runId: 'run-ordered',
          occurredAt: 150,
        },
      ],
    });

    expect(recovered?.parts.map((part) => part.type)).toEqual(['text', 'tool', 'text', 'tool']);
    expect(recovered?.parts[1]).toMatchObject({
      type: 'tool',
      toolCallId: 'tool-read',
      output: { exists: true },
      status: 'completed',
    });
  });
});
