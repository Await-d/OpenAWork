import { describe, expect, it } from 'vitest';
import type { ChatRenderEntry } from '../../chat/message/chat-message-group-list.js';
import { groupChatRenderEntries } from './group-render-entries.js';

function assistantEntry(id: string, groupIdentityKey?: string): ChatRenderEntry {
  return {
    message: {
      id,
      role: 'assistant',
      content: `message:${id}`,
      ...(groupIdentityKey ? { agentId: groupIdentityKey } : {}),
    },
    ...(groupIdentityKey ? { groupIdentityKey } : {}),
    renderContent: () => null,
  };
}

describe('groupChatRenderEntries', () => {
  it('相邻 assistant 且来源身份相同时合并到同一组', () => {
    const groups = groupChatRenderEntries([
      assistantEntry('a1', 'interaction-agent'),
      assistantEntry('a2', 'interaction-agent'),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.entries).toHaveLength(2);
  });

  it('相邻 assistant 但来源身份不同，不再误并组', () => {
    const groups = groupChatRenderEntries([
      assistantEntry('a1', 'interaction-agent'),
      assistantEntry('a2', 'prometheus'),
      assistantEntry('a3', 'prometheus'),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0]?.entries).toHaveLength(1);
    expect(groups[1]?.entries).toHaveLength(2);
  });
});
