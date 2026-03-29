import { describe, expect, it } from 'vitest';
import type { Message } from '@openAwork/shared';
import { extractLatestChildSessionSummary } from '../task-result-extraction.js';

describe('task result extraction', () => {
  it('extracts the latest real assistant summary while skipping trailing assistant_event payloads', () => {
    const messages: Message[] = [
      {
        id: 'assistant-1',
        role: 'assistant',
        createdAt: 1,
        content: [{ type: 'text', text: '第一版摘要' }],
      },
      {
        id: 'assistant-event-1',
        role: 'assistant',
        createdAt: 2,
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              type: 'assistant_event',
              payload: {
                kind: 'agent',
                title: '子代理已完成 · 检索',
                message: '结果：第一版摘要\n会话：child-1',
                status: 'success',
              },
            }),
          },
        ],
      },
      {
        id: 'assistant-2',
        role: 'assistant',
        createdAt: 3,
        content: [{ type: 'text', text: '最终真实摘要' }],
      },
      {
        id: 'assistant-event-2',
        role: 'assistant',
        createdAt: 4,
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              type: 'assistant_event',
              payload: {
                kind: 'agent',
                title: '子代理已完成 · 审查',
                message: '结果：最终真实摘要\n会话：child-2',
                status: 'success',
              },
            }),
          },
        ],
      },
    ];

    expect(extractLatestChildSessionSummary(messages)).toBe('最终真实摘要');
  });

  it('skips empty assistant text and returns the nearest non-empty summary', () => {
    const messages: Message[] = [
      {
        id: 'assistant-1',
        role: 'assistant',
        createdAt: 1,
        content: [{ type: 'text', text: '可用摘要' }],
      },
      {
        id: 'assistant-2',
        role: 'assistant',
        createdAt: 2,
        content: [{ type: 'text', text: '   ' }],
      },
    ];

    expect(extractLatestChildSessionSummary(messages)).toBe('可用摘要');
  });

  it('returns an empty string when no real assistant summary exists', () => {
    const messages: Message[] = [
      {
        id: 'user-1',
        role: 'user',
        createdAt: 1,
        content: [{ type: 'text', text: '请执行任务' }],
      },
      {
        id: 'assistant-event-1',
        role: 'assistant',
        createdAt: 2,
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              type: 'assistant_event',
              payload: {
                kind: 'agent',
                title: '子代理已完成 · 检索',
                message: '结果：无可用摘要\n会话：child-1',
                status: 'success',
              },
            }),
          },
        ],
      },
    ];

    expect(extractLatestChildSessionSummary(messages)).toBe('');
  });

  it('ignores tool-call-only assistant entries and falls back to the previous textual summary', () => {
    const messages: Message[] = [
      {
        id: 'assistant-1',
        role: 'assistant',
        createdAt: 1,
        content: [{ type: 'text', text: '前一条真实结论' }],
      },
      {
        id: 'assistant-2',
        role: 'assistant',
        createdAt: 2,
        content: [
          {
            type: 'tool_call',
            toolCallId: 'call-1',
            toolName: 'read',
            input: { filePath: '/tmp/demo.txt' },
          },
        ],
      },
    ];

    expect(extractLatestChildSessionSummary(messages)).toBe('前一条真实结论');
  });

  it('strips assistant error display prefixes before returning the child summary', () => {
    const messages: Message[] = [
      {
        id: 'assistant-1',
        role: 'assistant',
        createdAt: 1,
        content: [
          {
            type: 'text',
            text: '[错误: MODEL_ERROR] Upstream request failed (500): 子代理上游失败',
          },
        ],
      },
    ];

    expect(extractLatestChildSessionSummary(messages)).toBe(
      'Upstream request failed (500): 子代理上游失败',
    );
  });

  it('also strips English-style error prefixes before returning the child summary', () => {
    const messages: Message[] = [
      {
        id: 'assistant-1',
        role: 'assistant',
        createdAt: 1,
        content: [
          {
            type: 'text',
            text: '[Error: MODEL_ERROR] Upstream request failed (500): child failed',
          },
        ],
      },
    ];

    expect(extractLatestChildSessionSummary(messages)).toBe(
      'Upstream request failed (500): child failed',
    );
  });

  it('skips assistant_event wrappers even when they contain extra blank text parts', () => {
    const messages: Message[] = [
      {
        id: 'assistant-1',
        role: 'assistant',
        createdAt: 1,
        content: [{ type: 'text', text: '上一条真实摘要' }],
      },
      {
        id: 'assistant-event-1',
        role: 'assistant',
        createdAt: 2,
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              type: 'assistant_event',
              payload: {
                kind: 'agent',
                title: '子代理已完成 · 检索',
                message: '结果：上一条真实摘要\n会话：child-1',
                status: 'success',
              },
            }),
          },
          {
            type: 'text',
            text: '   ',
          },
        ],
      },
    ];

    expect(extractLatestChildSessionSummary(messages)).toBe('上一条真实摘要');
  });
});
