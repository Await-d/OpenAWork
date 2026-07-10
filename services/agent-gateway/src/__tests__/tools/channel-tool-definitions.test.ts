import { describe, expect, it } from 'vitest';
import {
  channelMediaInputSchema,
  pluginListGroupsInputSchema,
  pluginMediaInputSchema,
  pluginMessageInputSchema,
  pluginMessagesInputSchema,
} from '../../tools/channel-tool-definitions.js';

describe('channel tool definitions', () => {
  it('Given common channel tool schemas When current-channel placeholders are parsed Then they fall back to session context', () => {
    expect(
      pluginMessageInputSchema.parse({
        plugin_id: 'current',
        chat_id: '__default__',
        content: '你好',
      }),
    ).toEqual({ content: '你好', plugin_id: undefined, chat_id: undefined });

    expect(
      pluginMessagesInputSchema.parse({
        plugin_id: '__CURRENT_CHANNEL__',
        chat_id: 'default',
        count: '3',
      }),
    ).toEqual({ plugin_id: undefined, chat_id: undefined, count: 3 });

    expect(pluginListGroupsInputSchema.parse({ plugin_id: '   ' })).toEqual({
      plugin_id: undefined,
    });

    expect(
      pluginMediaInputSchema.parse({
        file_path: '/tmp/a.png',
        message_id: 'chat-1:message-42',
        content: '  ',
      }),
    ).toEqual({ file_path: '/tmp/a.png', message_id: 'chat-1:message-42' });

    expect(
      channelMediaInputSchema.parse({
        plugin_id: '',
        chat_id: 'current',
        file_path: '/tmp/a.png',
        message_id: 'chat-1:message-42',
        content: '  ',
      }),
    ).toEqual({
      file_path: '/tmp/a.png',
      message_id: 'chat-1:message-42',
      plugin_id: undefined,
      chat_id: undefined,
    });
  });

  it('Given common channel tool schemas When explicit ids are parsed Then they are preserved for context validation', () => {
    expect(
      pluginMessageInputSchema.parse({
        plugin_id: 'channel-1',
        chat_id: 'chat-1',
        content: '你好',
      }),
    ).toEqual({ plugin_id: 'channel-1', chat_id: 'chat-1', content: '你好' });

    expect(
      channelMediaInputSchema.parse({
        plugin_id: 'channel-1',
        chat_id: 'chat-1',
        file_path: '/tmp/a.png',
        message_id: 'chat-1:message-42',
      }),
    ).toEqual({
      plugin_id: 'channel-1',
      chat_id: 'chat-1',
      file_path: '/tmp/a.png',
      message_id: 'chat-1:message-42',
    });
  });
});
