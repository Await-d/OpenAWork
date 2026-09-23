import { describe, expect, it } from 'vitest';
import { parseQQInboundMessage } from '../../channels/inbound-parsers.js';

const QQ_IMAGE_URL = 'https://multimedia.nt.qq.com.cn/download?appid=1000&fileid=abc123';

function makeImageAttachment(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    content_type: 'image/jpeg',
    url: QQ_IMAGE_URL,
    filename: 'photo.jpg',
    size: 2048,
    ...overrides,
  };
}

function makeC2CEvent(event: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    t: 'C2C_MESSAGE_CREATE',
    d: {
      id: 'm-c2c',
      content: '',
      timestamp: '2026-07-08T12:00:00.000Z',
      author: { user_openid: 'u-open' },
      ...event,
    },
  };
}

function makeGroupEvent(event: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    t: 'GROUP_AT_MESSAGE_CREATE',
    d: {
      id: 'm-group',
      group_openid: 'g-open',
      content: '',
      timestamp: '2026-07-08T12:00:00.000Z',
      author: { member_openid: 'member-open', username: 'QQ User' },
      ...event,
    },
  };
}

function makeChannelEvent(event: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    t: 'AT_MESSAGE_CREATE',
    d: {
      id: 'm-channel',
      channel_id: 'channel-1',
      guild_id: 'guild-1',
      content: '',
      timestamp: '2026-07-08T12:00:00.000Z',
      author: { id: 'author-1', username: 'Channel User' },
      ...event,
    },
  };
}

describe('QQ 入站图片附件解析', () => {
  it('C2C 纯图片消息 → 占位文本、规范 chatId 并映射 QQ CDN 图片信息', () => {
    const parsed = parseQQInboundMessage(makeC2CEvent({ attachments: [makeImageAttachment()] }));

    expect(parsed).not.toBeNull();
    expect(parsed?.content).toBe('[User sent an image]');
    expect(parsed?.chatId).toBe('c2c:u-open');
    expect(parsed?.images).toHaveLength(1);
    expect(parsed?.images?.[0]).toEqual({
      imageUrl: QQ_IMAGE_URL,
      mediaType: 'image/jpeg',
      fileName: 'photo.jpg',
    });
  });

  it('GROUP_AT 纯图片消息 → 保留 group chatId 并携带 images', () => {
    const parsed = parseQQInboundMessage(makeGroupEvent({ attachments: [makeImageAttachment()] }));

    expect(parsed).toMatchObject({
      chatId: 'group:g-open',
      content: '[User sent an image]',
    });
    expect(parsed?.images?.[0]).toMatchObject({
      imageUrl: QQ_IMAGE_URL,
      mediaType: 'image/jpeg',
      fileName: 'photo.jpg',
    });
  });

  it('频道 AT_MESSAGE_CREATE 图片消息 → chatId 为 channel:<id> 且携带 images', () => {
    const parsed = parseQQInboundMessage(
      makeChannelEvent({ attachments: [makeImageAttachment()] }),
    );

    expect(parsed).toMatchObject({
      chatId: 'channel:channel-1',
      content: '[User sent an image]',
    });
    expect(parsed?.images).toHaveLength(1);
  });

  it('图片附件超过 4 张时只保留前 4 张', () => {
    const attachments = Array.from({ length: 5 }, (_, index) =>
      makeImageAttachment({
        filename: `photo-${index}.jpg`,
        url: `https://multimedia.nt.qq.com.cn/download?fileid=${index}`,
      }),
    );
    const parsed = parseQQInboundMessage(makeGroupEvent({ attachments }));

    expect(parsed?.images).toHaveLength(4);
    expect(parsed?.images?.map((image) => image.fileName)).toEqual([
      'photo-0.jpg',
      'photo-1.jpg',
      'photo-2.jpg',
      'photo-3.jpg',
    ]);
  });

  it('非图片附件（video/mp4）→ 无 images 键，占位符保持原行为', () => {
    const parsed = parseQQInboundMessage(
      makeC2CEvent({
        attachments: [
          {
            content_type: 'video/mp4',
            url: 'https://multimedia.nt.qq.com.cn/download?fileid=video',
            filename: 'clip.mp4',
            size: 4096,
          },
        ],
      }),
    );

    expect(parsed).not.toBeNull();
    expect(parsed?.content).toBe('[User sent a video]');
    expect(parsed).not.toHaveProperty('images');
  });

  it('图片附件缺 url → 跳过该附件（无 images，占位文本仍返回）', () => {
    const parsed = parseQQInboundMessage(
      makeC2CEvent({ attachments: [makeImageAttachment({ url: undefined })] }),
    );

    expect(parsed).not.toBeNull();
    expect(parsed?.content).toBe('[User sent an image]');
    expect(parsed).not.toHaveProperty('images');
  });

  it('文本 + 图片 → content 为原文且同时携带 images', () => {
    const parsed = parseQQInboundMessage(
      makeC2CEvent({ content: '看看这张图', attachments: [makeImageAttachment()] }),
    );

    expect(parsed?.content).toBe('看看这张图');
    expect(parsed?.images).toHaveLength(1);
  });

  it('content_type 大小写不敏感，且 filename 缺失时不带 fileName', () => {
    const parsed = parseQQInboundMessage(
      makeC2CEvent({
        attachments: [makeImageAttachment({ content_type: 'IMAGE/PNG', filename: undefined })],
      }),
    );

    expect(parsed?.images).toHaveLength(1);
    expect(parsed?.images?.[0]).toEqual({
      imageUrl: QQ_IMAGE_URL,
      mediaType: 'IMAGE/PNG',
    });
    expect(parsed?.images?.[0]).not.toHaveProperty('fileName');
  });
});
