import { describe, expect, it } from 'vitest';
import { parseWeComInboundMessage } from '../../channels/inbound-parsers.js';
import type { ChannelInstance } from '../../channels/types.js';

const PIC_URL = 'https://wecom.example.com/media/pic-1.jpg';

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

describe('企业微信入站图片消息解析', () => {
  it('图片消息无 Content 时产出占位文本并把 PicUrl 直映射为图片附件', () => {
    const parsed = parseWeComInboundMessage({
      MsgType: 'image',
      FromUserName: 'wecom-user',
      PicUrl: PIC_URL,
      MediaId: 'media-1',
      MsgId: 'm-wecom-image',
      CreateTime: '1788000000',
    });

    expect(parsed).not.toBeNull();
    expect(parsed?.content).toBe('[User sent an image]');
    expect(parsed?.chatId).toBe('wecom-user');
    expect(parsed?.images).toHaveLength(1);
    expect(parsed?.images?.[0]).toEqual({ imageUrl: PIC_URL, mediaType: 'image/jpeg' });
  });

  it('图片消息缺少 PicUrl 时返回 null', () => {
    const parsed = parseWeComInboundMessage({
      MsgType: 'image',
      FromUserName: 'wecom-user',
      MediaId: 'media-1',
      MsgId: 'm-wecom-image-no-url',
      CreateTime: '1788000000',
    });

    expect(parsed).toBeNull();
  });

  it('未支持的消息类型（voice）仍返回 null，不回归', () => {
    const parsed = parseWeComInboundMessage({
      MsgType: 'voice',
      FromUserName: 'wecom-user',
      MediaId: 'media-voice',
      MsgId: 'm-wecom-voice',
      CreateTime: '1788000000',
    });

    expect(parsed).toBeNull();
  });

  it('文本消息回归：Content 解析、ChatId 优先于 FromUserName、MsgId 作 id、无 images 键', () => {
    const parsed = parseWeComInboundMessage({
      MsgType: 'text',
      ChatId: 'wecom-chat',
      FromUserName: 'wecom-user',
      Content: '企业微信消息',
      MsgId: 'm-wecom-text',
      CreateTime: '1788000000',
    });

    expect(parsed).toMatchObject({
      id: 'm-wecom-text',
      chatId: 'wecom-chat',
      senderId: 'wecom-user',
      senderName: 'wecom-user',
      content: '企业微信消息',
    });
    expect(parsed).not.toHaveProperty('images');
  });

  it('require-mention 群聊中未 @ 的图片消息被丢弃', () => {
    const context = {
      channel: makeChannel('wecom', { requireMentionInGroup: 'true', botName: 'OpenAWorkBot' }),
      botName: 'OpenAWorkBot',
    };
    const ignored = parseWeComInboundMessage(
      {
        MsgType: 'image',
        ChatId: 'wecom-group',
        FromUserName: 'wecom-user',
        PicUrl: PIC_URL,
        MsgId: 'm-wecom-group-image',
        CreateTime: '1788000000',
      },
      context,
    );

    expect(ignored).toBeNull();
  });

  it('require-mention 群聊中已 @ 的图片消息通过并携带 images', () => {
    const context = {
      channel: makeChannel('wecom', { requireMentionInGroup: 'true', botName: 'OpenAWorkBot' }),
      botName: 'OpenAWorkBot',
    };
    const parsed = parseWeComInboundMessage(
      {
        MsgType: 'image',
        ChatId: 'wecom-group',
        FromUserName: 'wecom-user',
        PicUrl: PIC_URL,
        IsMentioned: true,
        MsgId: 'm-wecom-group-image-mentioned',
        CreateTime: '1788000000',
      },
      context,
    );

    expect(parsed?.content).toBe('[User sent an image]');
    expect(parsed?.chatId).toBe('wecom-group');
    expect(parsed?.images).toEqual([{ imageUrl: PIC_URL, mediaType: 'image/jpeg' }]);
  });
});
