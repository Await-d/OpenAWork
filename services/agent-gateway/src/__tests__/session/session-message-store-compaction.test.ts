import { describe, expect, it } from 'vitest';
import type { Message } from '@openAwork/shared';
import { buildCompactionMarkerContent } from '../../compaction/compaction-marker.js';
import {
  buildPreparedUpstreamConversation,
  filterVisibleSessionMessages,
} from '../../session/session-message-store.js';

function textMessage(id: string, role: 'user' | 'assistant', text: string): Message {
  return {
    id,
    role,
    content: [{ type: 'text', text }],
    createdAt: Date.now(),
  };
}

function compactionMarker(
  id: string,
  summary: string,
  tailStartMessageId?: string,
  trigger: 'automatic' | 'manual' = 'manual',
): Message {
  const built = buildCompactionMarkerContent({
    source: 'openawork_internal',
    markerType: 'compaction_marker',
    summary,
    trigger,
    ...(tailStartMessageId ? { tailStartMessageId } : {}),
  });

  return {
    id,
    role: 'assistant',
    content: built.content,
    createdAt: Date.now(),
    clientRequestId: built.clientRequestId,
  };
}

describe('session message store compaction boundary', () => {
  it('在会话可见消息中裁掉压缩前历史并隐藏 marker 本身', () => {
    const visible = filterVisibleSessionMessages([
      textMessage('old-1', 'user', '旧历史 1'),
      textMessage('tail-1', 'user', '近期历史 1'),
      textMessage('tail-2', 'assistant', '近期回复 2'),
      compactionMarker('compact-1', '压缩摘要', 'tail-1'),
      textMessage('new-1', 'user', '压缩后的新问题'),
    ]);

    expect(visible.map((message) => message.id)).toEqual(['tail-1', 'tail-2', 'new-1']);
  });

  it('在旧 compaction 路径中保留 marker 对应的 tail 历史供下一轮压缩使用', () => {
    const prepared = buildPreparedUpstreamConversation(
      [
        textMessage('old-1', 'user', '旧历史 1'),
        textMessage('tail-1', 'user', '保留的近期历史'),
        textMessage('tail-2', 'assistant', '保留的近期回复'),
        compactionMarker('compact-1', '压缩摘要', 'tail-1'),
        textMessage('new-1', 'user', '压缩后的新问题'),
      ],
      { contextWindow: 1 },
    );

    expect(prepared.normalizedMessages).toEqual([
      { role: 'user', content: 'What did we do so far?' },
      { role: 'assistant', content: '压缩摘要' },
      { role: 'user', content: '保留的近期历史' },
      { role: 'assistant', content: '保留的近期回复' },
      { role: 'user', content: '压缩后的新问题' },
    ]);
  });
});
