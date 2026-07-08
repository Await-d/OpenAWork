import { describe, expect, it } from 'vitest';
import {
  parseDingTalkInboundMessage,
  parseDiscordInboundMessage,
  parseFeishuInboundMessage,
  parseQQInboundMessage,
  parseTelegramInboundMessage,
  parseWeComInboundMessage,
  parseWhatsAppInboundMessage,
} from '../../channels/inbound-parsers.js';

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

  it('解析 QQ group/c2c/channel 事件并规范 chatId', () => {
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

    expect(group).toMatchObject({
      id: 'm-group',
      chatId: 'group:g-open',
      senderId: 'member-open',
      content: '做个计划',
    });
    expect(c2c).toMatchObject({
      id: 'm-c2c',
      chatId: 'c2c:u-open',
      senderId: 'u-open',
      content: '私聊',
    });
  });
});
