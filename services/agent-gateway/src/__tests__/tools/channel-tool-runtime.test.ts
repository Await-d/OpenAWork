import { describe, expect, it } from 'vitest';
import {
  buildChannelReplyReference,
  serializeChannelMessages,
} from '../../tools/channel-tool-runtime.js';

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

  it('Given prefixed reply ids When building references Then only the current chat prefix is accepted', () => {
    expect(
      buildChannelReplyReference(
        { pluginId: 'channel-1', pluginType: 'qq', chatId: 'c2c:user-open-id' },
        'incoming-msg-id',
      ),
    ).toBe('c2c:user-open-id|incoming-msg-id');
    expect(
      buildChannelReplyReference(
        { pluginId: 'channel-1', pluginType: 'qq', chatId: 'c2c:user-open-id' },
        'c2c:user-open-id|incoming-msg-id',
      ),
    ).toBe('c2c:user-open-id|incoming-msg-id');
    expect(() =>
      buildChannelReplyReference(
        { pluginId: 'channel-1', pluginType: 'qq', chatId: 'c2c:user-open-id' },
        'c2c:other-user|incoming-msg-id',
      ),
    ).toThrow('Reply message_id must belong to the current channel chat.');

    expect(() =>
      buildChannelReplyReference(
        { pluginId: 'channel-1', pluginType: 'telegram', chatId: 'chat-1' },
        'other-chat:message-42',
      ),
    ).toThrow('Reply message_id must belong to the current channel chat.');
  });
});
