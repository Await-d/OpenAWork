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

  it('折叠协调阶段产生的相邻重复文本分片', () => {
    const grouped = groupMessageParts([
      { id: 'text-1', type: 'text', text: '重复文本' },
      { id: 'text-2', type: 'text', text: '  重复文本  ' },
    ]);

    expect(grouped).toHaveLength(1);
    expect(grouped[0]).toMatchObject({ type: 'text', part: { id: 'text-1', text: '重复文本' } });
  });
});
