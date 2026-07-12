import { describe, expect, it } from 'vitest';
import {
  parseDingTalkInboundMessage,
  parseDiscordInboundMessage,
  parseFeishuInboundMessage,
  parseQQInboundMessage,
  parseSlackInboundMessage,
  parseTelegramInboundMessage,
  parseWeComInboundMessage,
  parseWeixinInboundMessage,
  parseWhatsAppInboundMessage,
} from '../../channels/inbound-parsers.js';
import type { ChannelInstance } from '../../channels/types.js';

function makeChannel(
  type: ChannelInstance['type'],
  config: Record<string, string> = {},
): ChannelInstance {
  return {
    id: `${type}-channel`,
    type,
    name: `${type}-channel`,
    enabled: true,
    config,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('channel inbound parsers', () => {
  it('解析通用 relay envelope', () => {
    const parsed = parseTelegramInboundMessage(
      JSON.stringify({
        chatId: 'chat-1',
        senderId: 'user-1',
        senderName: 'Alice',
        content: 'hello',
        messageId: 'msg-1',
        timestamp: 1_788_000_000_000,
      }),
    );

    expect(parsed).toMatchObject({
      id: 'msg-1',
      chatId: 'chat-1',
      senderId: 'user-1',
      senderName: 'Alice',
      content: 'hello',
    });
  });

  it('解析 Discord Gateway MESSAGE_CREATE，并忽略 bot 消息', () => {
    const parsed = parseDiscordInboundMessage({
      t: 'MESSAGE_CREATE',
      d: {
        id: 'm-discord',
        channel_id: 'c-discord',
        content: 'ship it',
        timestamp: '2026-07-08T12:00:00.000Z',
        author: { id: 'u-discord', username: 'Dev' },
      },
    });
    const bot = parseDiscordInboundMessage({
      t: 'MESSAGE_CREATE',
      d: {
        id: 'm-bot',
        channel_id: 'c-discord',
        content: 'ignore',
        author: { id: 'bot', username: 'Bot', bot: true },
      },
    });

    expect(parsed).toMatchObject({
      id: 'm-discord',
      chatId: 'c-discord',
      senderId: 'u-discord',
      senderName: 'Dev',
      content: 'ship it',
    });
    expect(bot).toBeNull();
  });

  it('按配置要求 Telegram 群聊必须 @ 机器人，并规范 /command@bot 形式', () => {
    const context = {
      channel: makeChannel('telegram', { requireMentionInGroup: 'true' }),
      botUsername: 'OpenAWorkBot',
    };
    const addressed = parseTelegramInboundMessage(
      {
        message: {
          message_id: 1001,
          from: { id: 42, first_name: 'Alice' },
          chat: { id: -1001, title: '产品群', type: 'supergroup' },
          text: '/stats@OpenAWorkBot',
          date: 1_788_000_000,
        },
      },
      context,
    );
    const ignored = parseTelegramInboundMessage(
      {
        message: {
          message_id: 1002,
          from: { id: 42, first_name: 'Alice' },
          chat: { id: -1001, title: '产品群', type: 'supergroup' },
          text: '普通群聊消息',
          date: 1_788_000_000,
        },
      },
      context,
    );

    expect(addressed).toMatchObject({
      chatId: '-1001',
      chatName: '产品群',
      content: '/stats',
    });
    expect(ignored).toBeNull();
  });

  it('Telegram relay envelope 也会遵守群聊 mention 门槛', () => {
    const context = {
      channel: makeChannel('telegram', { requireMentionInGroup: 'true' }),
      botUsername: 'OpenAWorkBot',
    };
    const addressed = parseTelegramInboundMessage(
      {
        chatId: '-1001',
        senderId: '42',
        senderName: 'Alice',
        content: '@OpenAWorkBot /stats',
        messageId: 'relay-tg-1',
        timestamp: 1_788_000_000_000,
      },
      context,
    );
    const ignored = parseTelegramInboundMessage(
      {
        chatId: '-1001',
        senderId: '42',
        senderName: 'Alice',
        content: '/stats',
        messageId: 'relay-tg-2',
        timestamp: 1_788_000_000_000,
      },
      context,
    );

    expect(addressed).toMatchObject({
      id: 'relay-tg-1',
      chatId: '-1001',
      content: '/stats',
    });
    expect(ignored).toBeNull();
  });

  it('Telegram 缺少 botUsername 时，不会把任意 @ 当成群聊命中', () => {
    const ignored = parseTelegramInboundMessage(
      {
        message: {
          message_id: 1003,
          from: { id: 42, first_name: 'Alice' },
          chat: { id: -1001, title: '产品群', type: 'supergroup' },
          text: '@OtherBot 普通消息',
          date: 1_788_000_000,
        },
      },
      {
        channel: makeChannel('telegram', { requireMentionInGroup: 'true' }),
      },
    );

    expect(ignored).toBeNull();
  });

  it('按配置要求 Discord 群频道必须 @ 机器人', () => {
    const context = {
      channel: makeChannel('discord', { requireMentionInGroup: 'true' }),
      botId: 'discord-bot-1',
    };
    const addressed = parseDiscordInboundMessage(
      {
        t: 'MESSAGE_CREATE',
        d: {
          id: 'm-discord-mentioned',
          guild_id: 'guild-1',
          channel_id: 'c-discord',
          content: '<@discord-bot-1> ship it',
          timestamp: '2026-07-08T12:00:00.000Z',
          mentions: [{ id: 'discord-bot-1' }],
          author: { id: 'u-discord', username: 'Dev' },
        },
      },
      context,
    );
    const ignored = parseDiscordInboundMessage(
      {
        t: 'MESSAGE_CREATE',
        d: {
          id: 'm-discord-ignored',
          guild_id: 'guild-1',
          channel_id: 'c-discord',
          content: 'ship it',
          timestamp: '2026-07-08T12:00:00.000Z',
          author: { id: 'u-discord', username: 'Dev' },
        },
      },
      context,
    );

    expect(addressed).toMatchObject({
      id: 'm-discord-mentioned',
      chatId: 'c-discord',
      content: 'ship it',
    });
    expect(ignored).toBeNull();
  });

  it('Discord 缺少 botUserId 时，不会把任意 mention 当成群频道命中', () => {
    const ignored = parseDiscordInboundMessage(
      {
        t: 'MESSAGE_CREATE',
        d: {
          id: 'm-discord-other-mention',
          guild_id: 'guild-1',
          channel_id: 'c-discord',
          content: '<@someone-else> ship it',
          timestamp: '2026-07-08T12:00:00.000Z',
          mentions: [{ id: 'someone-else' }],
          author: { id: 'u-discord', username: 'Dev' },
        },
      },
      {
        channel: makeChannel('discord', { requireMentionInGroup: 'true' }),
      },
    );

    expect(ignored).toBeNull();
  });

  it('按配置要求 Slack 频道必须 @ 机器人', () => {
    const context = {
      channel: makeChannel('slack', { requireMentionInGroup: 'true' }),
      botId: 'U-BOT-1',
    };
    const addressed = parseSlackInboundMessage(
      {
        ts: '1788000000.001',
        channel: 'C123456',
        channel_type: 'channel',
        user: 'U123',
        username: 'Slack User',
        text: '<@U-BOT-1> summarize this',
      },
      context,
    );
    const ignored = parseSlackInboundMessage(
      {
        ts: '1788000000.002',
        channel: 'C123456',
        channel_type: 'channel',
        user: 'U123',
        username: 'Slack User',
        text: 'summarize this',
      },
      context,
    );

    expect(addressed).toMatchObject({
      chatId: 'C123456',
      senderId: 'U123',
      content: 'summarize this',
    });
    expect(ignored).toBeNull();
  });

  it('Slack 缺少 botUserId 时，不会把任意 mention 当成群频道命中', () => {
    const ignored = parseSlackInboundMessage(
      {
        ts: '1788000000.003',
        channel: 'C123456',
        channel_type: 'channel',
        user: 'U123',
        username: 'Slack User',
        text: '<@U-OTHER-1> summarize this',
      },
      {
        channel: makeChannel('slack', { requireMentionInGroup: 'true' }),
      },
    );

    expect(ignored).toBeNull();
  });

  it('解析飞书 im.message.receive_v1 文本事件', () => {
    const parsed = parseFeishuInboundMessage({
      header: { event_type: 'im.message.receive_v1' },
      event: {
        message: {
          message_id: 'm-feishu',
          chat_id: 'oc-chat',
          content: JSON.stringify({ text: '收到' }),
          create_time: '1788000000',
        },
        sender: { sender_id: { open_id: 'ou-user' } },
      },
    });

    expect(parsed).toMatchObject({
      id: 'm-feishu',
      chatId: 'oc-chat',
      senderId: 'ou-user',
      content: '收到',
    });
  });

  it('解析飞书图片和音频消息为可读占位文本', () => {
    const image = parseFeishuInboundMessage({
      header: { event_type: 'im.message.receive_v1' },
      event: {
        message: {
          message_id: 'm-feishu-image',
          chat_id: 'oc-chat',
          message_type: 'image',
          content: JSON.stringify({ image_key: 'img-key-1' }),
        },
        sender: { sender_id: { open_id: 'ou-user' } },
      },
    });
    const audio = parseFeishuInboundMessage({
      header: { event_type: 'im.message.receive_v1' },
      event: {
        message: {
          message_id: 'm-feishu-audio',
          chat_id: 'oc-chat',
          message_type: 'audio',
          content: JSON.stringify({ file_key: 'audio-key-1' }),
        },
        sender: { sender_id: { open_id: 'ou-user' } },
      },
    });

    expect(image).toMatchObject({
      id: 'm-feishu-image',
      content: '[User sent an image: img-key-1]',
    });
    expect(audio).toMatchObject({
      id: 'm-feishu-audio',
      content: '[User sent an audio message: audio-key-1]',
    });
  });

  it('解析钉钉 Stream 机器人消息', () => {
    const parsed = parseDingTalkInboundMessage({
      headers: { topic: '/v1.0/im/bot/messages/get' },
      data: JSON.stringify({
        conversationId: 'cid',
        senderStaffId: 'staff-1',
        senderNick: 'Ding User',
        msgId: 'm-ding',
        msgCreateTime: '1788000000000',
        text: { content: JSON.stringify({ content: '钉钉消息' }) },
      }),
    });

    expect(parsed).toMatchObject({
      id: 'm-ding',
      chatId: 'cid',
      senderId: 'staff-1',
      senderName: 'Ding User',
      content: '钉钉消息',
    });
  });

  it('解析企业微信文本回调', () => {
    const parsed = parseWeComInboundMessage({
      MsgType: 'text',
      ChatId: 'wecom-chat',
      FromUserName: 'wecom-user',
      Content: '企业微信消息',
      MsgId: 'm-wecom',
      CreateTime: '1788000000',
    });

    expect(parsed).toMatchObject({
      id: 'm-wecom',
      chatId: 'wecom-chat',
      senderId: 'wecom-user',
      content: '企业微信消息',
    });
  });

  it('按配置要求企业微信群聊必须 @ 机器人', () => {
    const context = {
      channel: makeChannel('wecom', { requireMentionInGroup: 'true', botName: 'OpenAWorkBot' }),
      botName: 'OpenAWorkBot',
    };
    const addressed = parseWeComInboundMessage(
      {
        MsgType: 'text',
        ChatId: 'wecom-group',
        FromUserName: 'wecom-user',
        Content: '@OpenAWorkBot 企业微信群消息',
        MsgId: 'm-wecom-mentioned',
        CreateTime: '1788000000',
      },
      context,
    );
    const ignored = parseWeComInboundMessage(
      {
        MsgType: 'text',
        ChatId: 'wecom-group',
        FromUserName: 'wecom-user',
        Content: '普通群聊消息',
        MsgId: 'm-wecom-ignored',
        CreateTime: '1788000000',
      },
      context,
    );

    expect(addressed).toMatchObject({
      chatId: 'wecom-group',
      content: '企业微信群消息',
    });
    expect(ignored).toBeNull();
  });

  it('企业微信缺少 botName 时，不会把任意 @ 文本当成群聊命中', () => {
    const ignored = parseWeComInboundMessage(
      {
        MsgType: 'text',
        ChatId: 'wecom-group',
        FromUserName: 'wecom-user',
        Content: '@OtherBot 企业微信群消息',
        MsgId: 'm-wecom-other-bot',
        CreateTime: '1788000000',
      },
      {
        channel: makeChannel('wecom', { requireMentionInGroup: 'true' }),
      },
    );

    expect(ignored).toBeNull();
  });

  it('解析微信公众平台 getupdates 文本消息', () => {
    const parsed = parseWeixinInboundMessage({
      message_type: 1,
      from_user_id: 'weixin-user',
      message_id: 1788001,
      create_time_ms: 1_788_000_000_000,
      context_token: 'ctx-1',
      item_list: [{ type: 1, text_item: { text: '微信消息' } }],
    });

    expect(parsed).toMatchObject({
      id: '1788001',
      chatId: 'weixin-user',
      senderId: 'weixin-user',
      senderName: 'weixin-user',
      content: '微信消息',
      timestamp: 1_788_000_000_000,
    });
  });

  it('解析微信公众平台群会话元信息并保留发送者', () => {
    const parsed = parseWeixinInboundMessage({
      message_type: 1,
      chat_id: 'weixin-group-1',
      chat_name: '产品群',
      from_user_id: 'weixin-user',
      sender_name: 'Alice',
      message_id: 1788003,
      create_time_ms: 1_788_000_000_000,
      context_token: 'ctx-group',
      item_list: [{ type: 1, text_item: { text: '群里消息' } }],
    });

    expect(parsed).toMatchObject({
      id: '1788003',
      chatId: 'weixin-group-1',
      chatName: '产品群',
      senderId: 'weixin-user',
      senderName: 'Alice',
      content: '群里消息',
    });
  });

  it('解析 WhatsApp Cloud API webhook 消息', () => {
    const parsed = parseWhatsAppInboundMessage({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    id: 'm-wa',
                    from: '15550001111',
                    timestamp: '1788000000',
                    text: { body: 'whatsapp hello' },
                  },
                ],
                contacts: [{ wa_id: '15550001111', profile: { name: 'WA User' } }],
              },
            },
          ],
        },
      ],
    });

    expect(parsed).toMatchObject({
      id: 'm-wa',
      chatId: '15550001111',
      senderName: 'WA User',
      content: 'whatsapp hello',
    });
  });

  it('解析 WhatsApp 群会话元信息并区分会话与发送者', () => {
    const parsed = parseWhatsAppInboundMessage({
      entry: [
        {
          changes: [
            {
              value: {
                conversation: { id: '1203630-group@g.us', name: 'OpenAWork Group' },
                messages: [
                  {
                    id: 'm-wa-group',
                    from: '15550001111',
                    author: '15550002222',
                    timestamp: '1788000000',
                    text: { body: 'group hello' },
                  },
                ],
                contacts: [{ wa_id: '15550002222', profile: { name: 'WA Group User' } }],
              },
            },
          ],
        },
      ],
    });

    expect(parsed).toMatchObject({
      id: 'm-wa-group',
      chatId: '1203630-group@g.us',
      chatName: 'OpenAWork Group',
      senderId: '15550002222',
      senderName: 'WA Group User',
      content: 'group hello',
    });
  });

  it('解析 QQ group/c2c/channel 事件并规范 chatId', () => {
    const envelope = parseQQInboundMessage({
      chatId: 'group:g-open',
      senderId: 'member-open',
      senderName: 'QQ User',
      content: 'relay 消息',
      messageId: 'relay-message',
      timestamp: 1_788_000_000_000,
    });
    const group = parseQQInboundMessage({
      t: 'GROUP_AT_MESSAGE_CREATE',
      d: {
        id: 'm-group',
        group_openid: 'g-open',
        content: '<@123> 做个计划',
        timestamp: '2026-07-08T12:00:00.000Z',
        author: { member_openid: 'member-open', username: 'QQ User' },
      },
    });
    const c2c = parseQQInboundMessage({
      t: 'C2C_MESSAGE_CREATE',
      d: {
        id: 'm-c2c',
        content: '私聊',
        author: { user_openid: 'u-open' },
      },
    });
    const direct = parseQQInboundMessage({
      t: 'DIRECT_MESSAGE_CREATE',
      d: {
        id: 'm-direct',
        channel_id: 'dm-channel',
        guild_id: 'guild-1',
        content: '频道私信',
        author: { id: 'author-1', username: 'Direct User' },
      },
    });
    const attachmentOnly = parseQQInboundMessage({
      t: 'GROUP_AT_MESSAGE_CREATE',
      d: {
        id: 'm-image',
        group_openid: 'g-open',
        content: '',
        attachments: [{ content_type: 'image/png' }],
        author: { member_openid: 'member-open', username: 'QQ User' },
      },
    });

    expect(envelope).toMatchObject({
      id: 'group:g-open|relay-message',
      chatId: 'group:g-open',
      content: 'relay 消息',
    });
    expect(group).toMatchObject({
      id: 'group:g-open|m-group',
      chatId: 'group:g-open',
      senderId: 'member-open',
      content: '做个计划',
    });
    expect(c2c).toMatchObject({
      id: 'c2c:u-open|m-c2c',
      chatId: 'c2c:u-open',
      senderId: 'u-open',
      content: '私聊',
    });
    expect(direct).toMatchObject({
      id: 'channel:dm-channel|m-direct',
      chatId: 'channel:dm-channel',
      senderId: 'author-1',
      senderName: 'Direct User',
      content: '频道私信',
    });
    expect(attachmentOnly).toMatchObject({
      id: 'group:g-open|m-image',
      chatId: 'group:g-open',
      content: '[User sent an image]',
    });
  });
});
