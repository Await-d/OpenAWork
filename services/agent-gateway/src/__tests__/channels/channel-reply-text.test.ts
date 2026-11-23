import { describe, expect, it } from 'vitest';
import type { Message, MessageContent } from '@openAwork/shared';
import { extractChannelReplyText } from '../../channels/channel-reply-text.js';

function assistantMessage(content: MessageContent[]): Message {
  return {
    id: 'msg-1',
    role: 'assistant',
    content,
    createdAt: 1_788_000_000_000,
  };
}

describe('extractChannelReplyText', () => {
  it('只返回正文，丢弃 reasoning 片段', () => {
    const text = extractChannelReplyText(
      assistantMessage([
        { type: 'reasoning', text: '用户想让我查一下天气，先看有没有工具。' },
        { type: 'text', text: '今天北京晴，18℃。' },
      ]),
    );

    expect(text).toBe('今天北京晴，18℃。');
  });

  it('丢弃工具调用入参与工具输出', () => {
    const text = extractChannelReplyText(
      assistantMessage([
        {
          type: 'tool_call',
          toolCallId: 'call-1',
          toolName: 'read_file',
          input: { path: '/etc/passwd' },
        },
        { type: 'tool_result', toolCallId: 'call-1', output: 'root:x:0:0', isError: false },
        { type: 'text', text: '文件已读取完毕。' },
      ]),
    );

    expect(text).toBe('文件已读取完毕。');
  });

  it('多个正文片段按换行拼接', () => {
    const text = extractChannelReplyText(
      assistantMessage([
        { type: 'text', text: '第一段' },
        { type: 'reasoning', text: '中间的思考' },
        { type: 'text', text: '第二段' },
      ]),
    );

    expect(text).toBe('第一段\n第二段');
  });

  it('只有 reasoning 时返回空串（不得用思考内容兜底）', () => {
    const text = extractChannelReplyText(
      assistantMessage([{ type: 'reasoning', text: '我想了很久，最后决定什么都不说。' }]),
    );

    expect(text).toBe('');
  });

  it('空白正文被忽略', () => {
    const text = extractChannelReplyText(
      assistantMessage([
        { type: 'text', text: '   ' },
        { type: 'text', text: '正文' },
      ]),
    );

    expect(text).toBe('正文');
  });

  it('消息为 undefined 时返回空串', () => {
    expect(extractChannelReplyText(undefined)).toBe('');
  });
});
