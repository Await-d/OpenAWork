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
});
