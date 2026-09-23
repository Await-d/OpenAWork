import { describe, expect, it } from 'vitest';
import { parseDiscordInboundMessage } from '../../channels/inbound-parsers.js';
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

function makeDiscordMessage(message: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    t: 'MESSAGE_CREATE',
    d: {
      id: 'm-discord',
      channel_id: 'c-discord',
      content: '',
      timestamp: '2026-07-08T12:00:00.000Z',
      author: { id: 'u-discord', username: 'Dev' },
      ...message,
    },
  };
}

function makeImageAttachment(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'att-1',
    filename: 'cat.png',
    content_type: 'image/png',
    size: 2048,
    url: 'https://cdn.discordapp.com/attachments/1/2/cat.png',
    proxy_url: 'https://media.discordapp.net/attachments/1/2/cat.png',
    ...overrides,
  };
}

describe('Discord 入站图片附件解析', () => {
  it('无文本 + 单张图片附件 → 占位文本并映射图片信息', () => {
    const parsed = parseDiscordInboundMessage(
      makeDiscordMessage({ attachments: [makeImageAttachment()] }),
    );

    expect(parsed).not.toBeNull();
    expect(parsed?.content).toBe('[User sent an image]');
    expect(parsed?.images).toHaveLength(1);
    expect(parsed?.images?.[0]).toEqual({
      imageUrl: 'https://cdn.discordapp.com/attachments/1/2/cat.png',
      mediaType: 'image/png',
      fileName: 'cat.png',
    });
  });

  it('文本 + 图片 → 保留原文并同时携带 images', () => {
    const parsed = parseDiscordInboundMessage(
      makeDiscordMessage({ content: '看看这张图', attachments: [makeImageAttachment()] }),
    );

    expect(parsed).toMatchObject({ chatId: 'c-discord', content: '看看这张图' });
    expect(parsed?.images?.[0]).toMatchObject({
      imageUrl: 'https://cdn.discordapp.com/attachments/1/2/cat.png',
      mediaType: 'image/png',
    });
  });

  it('非图片附件（无文本）→ 仍然返回 null，不影响原有行为', () => {
    const attachmentOnly = parseDiscordInboundMessage(
      makeDiscordMessage({
        attachments: [
          makeImageAttachment({ filename: 'archive.zip', content_type: 'application/zip' }),
        ],
      }),
    );
    const withText = parseDiscordInboundMessage(
      makeDiscordMessage({
        content: '附件在这',
        attachments: [
          makeImageAttachment({ filename: 'archive.zip', content_type: 'application/zip' }),
        ],
      }),
    );

    expect(attachmentOnly).toBeNull();
    expect(withText).toMatchObject({ content: '附件在这' });
    expect(withText).not.toHaveProperty('images');
  });

  it('图片附件超过 4 张时只保留前 4 张', () => {
    const attachments = Array.from({ length: 5 }, (_, index) =>
      makeImageAttachment({
        id: `att-${index}`,
        filename: `photo-${index}.png`,
        url: `https://cdn.discordapp.com/attachments/1/${index}/photo-${index}.png`,
      }),
    );
    const parsed = parseDiscordInboundMessage(makeDiscordMessage({ attachments }));

    expect(parsed?.images).toHaveLength(4);
    expect(parsed?.images?.map((image) => image.fileName)).toEqual([
      'photo-0.png',
      'photo-1.png',
      'photo-2.png',
      'photo-3.png',
    ]);
  });

  it('缺少 content_type 时按扩展名兜底推断 mediaType（大小写不敏感）', () => {
    const parsed = parseDiscordInboundMessage(
      makeDiscordMessage({
        attachments: [makeImageAttachment({ content_type: undefined, filename: 'photo.JPG' })],
      }),
    );

    expect(parsed?.content).toBe('[User sent an image]');
    expect(parsed?.images?.[0]).toMatchObject({
      mediaType: 'image/jpeg',
      fileName: 'photo.JPG',
    });
  });

  it('url 缺失时回退到 proxy_url', () => {
    const parsed = parseDiscordInboundMessage(
      makeDiscordMessage({
        attachments: [makeImageAttachment({ url: undefined })],
      }),
    );

    expect(parsed?.images?.[0]).toMatchObject({
      imageUrl: 'https://media.discordapp.net/attachments/1/2/cat.png',
      mediaType: 'image/png',
    });
  });

  it('要求 @ 的群频道里纯图片且未提及 → 仍被丢弃（提及过滤不回归）', () => {
    const parsed = parseDiscordInboundMessage(
      makeDiscordMessage({
        guild_id: 'guild-1',
        attachments: [makeImageAttachment()],
      }),
      {
        channel: makeChannel('discord', { requireMentionInGroup: 'true' }),
        botId: 'discord-bot-1',
      },
    );

    expect(parsed).toBeNull();
  });

  it('要求 @ 的群频道里图片消息带 @ 文本 → 正常解析为纯图片消息', () => {
    const parsed = parseDiscordInboundMessage(
      makeDiscordMessage({
        guild_id: 'guild-1',
        content: '<@discord-bot-1>',
        mentions: [{ id: 'discord-bot-1' }],
        attachments: [makeImageAttachment()],
      }),
      {
        channel: makeChannel('discord', { requireMentionInGroup: 'true' }),
        botId: 'discord-bot-1',
      },
    );

    expect(parsed?.content).toBe('[User sent an image]');
    expect(parsed?.images).toHaveLength(1);
  });

  it('普通文本消息回归：行为不变且不携带 images 字段', () => {
    const parsed = parseDiscordInboundMessage(makeDiscordMessage({ content: 'ship it' }));

    expect(parsed).toMatchObject({
      id: 'm-discord',
      chatId: 'c-discord',
      senderId: 'u-discord',
      senderName: 'Dev',
      content: 'ship it',
    });
    expect(parsed).not.toHaveProperty('images');
  });
});
