import { describe, expect, it } from 'vitest';
import type { Message } from '@openAwork/shared';
import { extractLatestChildSessionSummary } from '../../task/task-result-extraction.js';

function assistantMessage(id: string, text: string): Message {
  return {
    id,
    role: 'assistant',
    content: [{ type: 'text', text }],
    createdAt: 1,
  };
}

function userMessage(id: string, text: string): Message {
  return {
    id,
    role: 'user',
    content: [{ type: 'text', text }],
    createdAt: 1,
  };
}

function uiEventMessage(id: string): Message {
  return {
    id,
    role: 'assistant',
    content: [
      {
        type: 'text',
        text: JSON.stringify({ type: 'assistant_event', source: 'openawork_internal' }),
      },
    ],
    createdAt: 1,
  };
}

describe('extractLatestChildSessionSummary', () => {
  it('取最后一条有文本的 assistant 消息（忽略 user / tool 消息）', () => {
    expect(
      extractLatestChildSessionSummary([
        userMessage('u-1', '任务 prompt'),
        assistantMessage('a-1', '过程性说明。'),
        assistantMessage('a-2', '最终结论。'),
        userMessage('u-2', '继续'),
      ]),
    ).toBe('最终结论。');
  });

  it('跳过整条都是 UI 事件的 assistant 消息', () => {
    expect(
      extractLatestChildSessionSummary([
        assistantMessage('a-1', '最终结论。'),
        uiEventMessage('a-2'),
      ]),
    ).toBe('最终结论。');
  });

  it('剥离子代理错误前缀', () => {
    expect(
      extractLatestChildSessionSummary([assistantMessage('a-1', '[错误: 上游超时] 已回滚改动。')]),
    ).toBe('已回滚改动。');
  });

  it('只在最近 20 条消息的窗口内查找（对齐参考库 limit:20）', () => {
    const messages: Message[] = [
      assistantMessage('old', '更早的历史总结。'),
      ...Array.from({ length: 20 }, (_value, index) =>
        userMessage(`u-${index}`, `填充消息 ${index}`),
      ),
    ];

    expect(messages).toHaveLength(21);
    expect(extractLatestChildSessionSummary(messages)).toBe('');
  });

  it('窗口内命中：倒数第 20 条仍是有效候选', () => {
    const messages: Message[] = [
      userMessage('filler', '更早的填充'),
      assistantMessage('hit', '窗口内的总结。'),
      ...Array.from({ length: 19 }, (_value, index) =>
        userMessage(`u-${index}`, `填充消息 ${index}`),
      ),
    ];

    expect(messages).toHaveLength(21);
    expect(extractLatestChildSessionSummary(messages)).toBe('窗口内的总结。');
  });

  it('没有可用文本时返回空字符串', () => {
    expect(extractLatestChildSessionSummary([userMessage('u-1', '只有用户消息')])).toBe('');
    expect(extractLatestChildSessionSummary([assistantMessage('a-1', '')])).toBe('');
    expect(extractLatestChildSessionSummary([])).toBe('');
  });
});
