import { describe, expect, it } from 'vitest';

import type { ChatMessagePart } from '../../conversation-runtime/messages/support.js';
import { groupMessageParts } from './parts-grouping-helper.js';

describe('groupMessageParts', () => {
  it('保留夹在两段文本之间的工具位置', () => {
    const parts: ChatMessagePart[] = [
      { id: 'text-before', type: 'text', text: '第一段说明' },
      {
        id: 'tool-between',
        type: 'tool',
        toolCallId: 'tool-between',
        toolName: 'read_file',
        input: { path: 'config.json' },
        output: 'ok',
        status: 'completed',
      },
      { id: 'text-after', type: 'text', text: '第二段说明' },
    ];

    expect(groupMessageParts(parts).map((part) => part.type)).toEqual([
      'text',
      'tool-single',
      'text',
    ]);
  });

  it('保留流中合法的相邻重复文本分片', () => {
    const grouped = groupMessageParts([
      { id: 'text-1', type: 'text', text: '重复文本' },
      { id: 'text-2', type: 'text', text: '  重复文本  ' },
    ]);

    expect(grouped).toHaveLength(2);
    expect(grouped.map((part) => part.type)).toEqual(['text', 'text']);
    expect(grouped.map((part) => (part.type === 'text' ? part.part.id : ''))).toEqual([
      'text-1',
      'text-2',
    ]);
  });

  it('保留思考、正文、工具和重复正文的原始顺序', () => {
    const grouped = groupMessageParts([
      { id: 'reasoning-1', type: 'reasoning', text: '先分析' },
      { id: 'text-1', type: 'text', text: '继续' },
      {
        id: 'tool-1',
        type: 'tool',
        toolCallId: 'tool-1',
        toolName: 'read',
        input: { path: 'a.ts' },
        status: 'completed',
      },
      { id: 'text-2', type: 'text', text: '继续' },
      { id: 'reasoning-2', type: 'reasoning', text: '再检查' },
    ]);

    expect(grouped.map((part) => part.type)).toEqual([
      'reasoning',
      'text',
      'tool-single',
      'text',
      'reasoning',
    ]);
  });
});
