import { describe, expect, it } from 'vitest';

import { recoverActiveAssistantStream } from './stream-recovery.js';

describe('recoverActiveAssistantStream', () => {
  it('恢复活动流时保留 usage，并且允许后续附加 upstreamSummary', () => {
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

    expect(recovered).toMatchObject({
      text: 'hello',
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
      },
    });
    expect(recovered?.upstreamSummary).toBeUndefined();
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
