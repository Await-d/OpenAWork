import { describe, expect, it } from 'vitest';
import { serializeChannelMessages } from '../../tools/channel-tool-runtime.js';

describe('channel tool runtime', () => {
  it('Given current Telegram context When channel messages are serialized Then replyMessageId is directly usable by PluginReplyMessage', () => {
    const output = serializeChannelMessages(
      [
        {
          id: 'message-42',
          chatId: 'chat-1',
          content: '需要回复的消息',
          senderId: 'sender-1',
          senderName: '用户一',
          timestamp: 1_788_000_000_001,
        },
      ],
      { pluginId: 'channel-1', pluginType: 'telegram', chatId: 'chat-1' },
    );

    expect(output).toBe(
      JSON.stringify([
        {
          id: 'message-42',
          replyMessageId: 'chat-1:message-42',
          senderId: 'sender-1',
          senderName: '用户一',
          chatId: 'chat-1',
          content: '需要回复的消息',
          timestamp: 1_788_000_000_001,
        },
      ]),
    );
  });
});
