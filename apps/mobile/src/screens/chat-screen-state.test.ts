import { describe, expect, it } from 'vitest';
import type { MobileChatMessage } from '../chat/chat-message-content.js';
import { reconcileMobileChatMessages } from './chat-screen-state.js';

interface TestMessage extends MobileChatMessage {
  streaming?: boolean;
}

describe('reconcileMobileChatMessages', () => {
  it('历史快照返回时保留当前本地 user 与 streaming assistant', () => {
    const previous: TestMessage[] = [
      { id: 'u-1', role: 'user', content: '当前请求' },
      { id: 'a-1', role: 'assistant', content: '已收到', streaming: true },
    ];
    const snapshot: TestMessage[] = [{ id: 'old-user', role: 'user', content: '旧历史' }];

    const reconciled = reconcileMobileChatMessages(previous, snapshot);

    expect(reconciled.map((message) => message.id)).toEqual(['old-user', 'u-1', 'a-1']);
    expect(reconciled[2]?.streaming).toBe(true);
  });

  it('快照重复 id 只保留一条，并保留本地流式消息的最新内容', () => {
    const previous: TestMessage[] = [
      { id: 'a-1', role: 'assistant', content: '本地增量', streaming: true },
    ];
    const snapshot: TestMessage[] = [
      { id: 'a-1', role: 'assistant', content: '旧快照' },
      { id: 'a-1', role: 'assistant', content: '重复旧快照' },
    ];

    const reconciled = reconcileMobileChatMessages(previous, snapshot);

    expect(reconciled).toHaveLength(1);
    expect(reconciled[0]).toEqual(previous[0]);
  });

  it('服务端用不同 id 返回相同 user 内容时不重复显示本地消息', () => {
    const previous: TestMessage[] = [
      { id: 'u-local', role: 'user', content: '同一请求' },
      { id: 'a-1', role: 'assistant', content: '生成中', streaming: true },
    ];
    const snapshot: TestMessage[] = [
      { id: 'u-server', role: 'user', content: '同一请求' },
      { id: 'a-old', role: 'assistant', content: '旧快照' },
    ];

    const reconciled = reconcileMobileChatMessages(previous, snapshot);

    expect(reconciled.map((message) => message.id)).toEqual(['u-local', 'a-old', 'a-1']);
  });
});
