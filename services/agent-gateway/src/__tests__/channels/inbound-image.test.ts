import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannelMessage } from '../../channels/types.js';

// channelFetch 是 inbound-image 唯一的网络出口：mock 掉它即可在无网络条件下
// 覆盖下载成功 / 各类降级分支。
const channelFetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
vi.mock('../../channels/channel-http.js', () => ({
  channelFetch: (url: string, init?: RequestInit): Promise<Response> => channelFetchMock(url, init),
}));

const { DEFAULT_INBOUND_IMAGE_MAX_BYTES, downloadInboundImage, inlineRemoteImages } =
  await import('../../channels/inbound-image.js');
const { attachDiscordInboundImages } = await import('../../channels/discord-media.js');
const { attachQQInboundImages } = await import('../../channels/qq-media.js');

const CDN_URL = 'https://cdn.example.com/media/pic-1.png';

/** PNG 魔数（12 字节，满足 sniffImageMediaType 的最小长度要求）。 */
const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

function imageMessage(images: ChannelMessage['images']): ChannelMessage {
  return {
    id: 'm-1',
    senderId: 'user-1',
    senderName: 'user-1',
    chatId: 'chat-1',
    content: '[User sent an image]',
    timestamp: 0,
    ...(images ? { images } : {}),
    raw: {},
  };
}

function binaryResponse(bytes: Buffer, status = 200, headers: Record<string, string> = {}) {
  return new Response(new Uint8Array(bytes), { status, headers });
}

beforeEach(() => {
  channelFetchMock.mockReset();
});

describe('downloadInboundImage', () => {
  it('下载成功 → base64 附件（mime 以魔数为准）', async () => {
    channelFetchMock.mockResolvedValueOnce(binaryResponse(PNG_BYTES));

    await expect(
      downloadInboundImage({ url: CDN_URL, tag: 'discord', mimeType: 'image/jpeg' }),
    ).resolves.toEqual({ base64: PNG_BYTES.toString('base64'), mediaType: 'image/png' });
  });

  it('声明长度超限时零读取短路', async () => {
    channelFetchMock.mockResolvedValueOnce(
      binaryResponse(PNG_BYTES, 200, {
        'content-length': String(DEFAULT_INBOUND_IMAGE_MAX_BYTES + 1),
      }),
    );

    await expect(downloadInboundImage({ url: CDN_URL, tag: 'qq' })).resolves.toBeNull();
  });

  it('私网 / 回环地址零请求短路', async () => {
    await expect(
      downloadInboundImage({ url: 'http://169.254.169.254/latest/meta-data', tag: 'qq' }),
    ).resolves.toBeNull();
    expect(channelFetchMock).not.toHaveBeenCalled();
  });

  it('上游 HTTP 错误不抛错，只返回 null', async () => {
    channelFetchMock.mockResolvedValueOnce(binaryResponse(Buffer.from(''), 500));

    await expect(downloadInboundImage({ url: CDN_URL, tag: 'wecom' })).resolves.toBeNull();
  });
});

describe('inlineRemoteImages', () => {
  it('无 images 字段 / 全是已内联附件时原样返回同一对象，零网络请求', async () => {
    const withoutImages = imageMessage(undefined);
    await expect(inlineRemoteImages(withoutImages, { tag: 'discord' })).resolves.toBe(
      withoutImages,
    );

    const inline = imageMessage([{ base64: PNG_BYTES.toString('base64'), mediaType: 'image/png' }]);
    await expect(inlineRemoteImages(inline, { tag: 'discord' })).resolves.toBe(inline);
    expect(channelFetchMock).not.toHaveBeenCalled();
  });

  it('多张图中单张失败 → 只保留成功的，并移除远程地址', async () => {
    channelFetchMock
      .mockResolvedValueOnce(binaryResponse(Buffer.from(''), 500))
      .mockResolvedValueOnce(binaryResponse(PNG_BYTES));

    const message = imageMessage([
      { imageUrl: 'https://cdn.example.com/broken.png', mediaType: 'image/png' },
      { imageUrl: 'https://cdn.example.com/ok.png', mediaType: 'image/png', fileName: 'ok.png' },
    ]);
    const enriched = await inlineRemoteImages(message, { tag: 'discord' });

    expect(enriched.images).toEqual([
      { base64: PNG_BYTES.toString('base64'), mediaType: 'image/png', fileName: 'ok.png' },
    ]);
    expect(channelFetchMock).toHaveBeenCalledTimes(2);
  });

  it('全部失败 → 移除 images 键，保留占位符正文', async () => {
    channelFetchMock.mockResolvedValueOnce(binaryResponse(Buffer.from(''), 500));

    const message = imageMessage([{ imageUrl: CDN_URL, mediaType: 'image/png' }]);
    const enriched = await inlineRemoteImages(message, { tag: 'qq' });

    expect(enriched).not.toHaveProperty('images');
    expect(enriched.content).toBe('[User sent an image]');
  });

  it('已内联与远程混排时保留本地图、追加下载结果', async () => {
    channelFetchMock.mockResolvedValueOnce(binaryResponse(PNG_BYTES));

    const local = { base64: 'AAAA', mediaType: 'image/png' } as const;
    const message = imageMessage([local, { imageUrl: CDN_URL, mediaType: 'image/png' }]);
    const enriched = await inlineRemoteImages(message, { tag: 'qq' });

    expect(enriched.images).toEqual([
      local,
      { base64: PNG_BYTES.toString('base64'), mediaType: 'image/png' },
    ]);
  });
});

describe('通道薄封装委托', () => {
  it('Discord / QQ 都把 CDN 地址内联为 base64', async () => {
    channelFetchMock
      .mockResolvedValueOnce(binaryResponse(PNG_BYTES))
      .mockResolvedValueOnce(binaryResponse(PNG_BYTES));

    const discord = await attachDiscordInboundImages(
      imageMessage([{ imageUrl: CDN_URL, mediaType: 'image/png' }]),
    );
    const qq = await attachQQInboundImages(
      imageMessage([{ imageUrl: CDN_URL, mediaType: 'image/png' }]),
    );

    expect(discord.images).toEqual([
      { base64: PNG_BYTES.toString('base64'), mediaType: 'image/png' },
    ]);
    expect(qq.images).toEqual([{ base64: PNG_BYTES.toString('base64'), mediaType: 'image/png' }]);
  });
});
