import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannelMessage } from '../../channels/types.js';

// channelFetch 是 whatsapp-media 唯一的网络出口：mock 掉它即可在无网络条件下
// 覆盖「media 元数据 → 二进制」两步下载的全部成功 / 降级分支。
const channelFetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
vi.mock('../../channels/channel-http.js', () => ({
  channelFetch: (url: string, init?: RequestInit): Promise<Response> => channelFetchMock(url, init),
}));

const {
  WHATSAPP_GRAPH_API_BASE,
  WHATSAPP_INBOUND_IMAGE_MAX_BYTES,
  attachWhatsAppInboundImages,
  downloadWhatsAppInboundImage,
} = await import('../../channels/whatsapp-media.js');
const { parseWhatsAppInboundMessage } = await import('../../channels/inbound-parsers/whatsapp.js');

const ACCESS_TOKEN = 'wa-access-token';
const MEDIA_ID = 'media-1';
const DOWNLOAD_URL = 'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=abc&ext=1';

/** PNG 魔数（12 字节，满足 sniffImageMediaType 的最小长度要求）。 */
const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

/** 不匹配任何已知图片魔数的 12 字节负载，用于验证 mimeType 回退。 */
const UNKNOWN_BYTES = Buffer.from('not-an-image');

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function binaryResponse(bytes: Buffer, status = 200, contentType?: string): Response {
  return new Response(new Uint8Array(bytes), {
    status,
    ...(contentType ? { headers: { 'content-type': contentType } } : {}),
  });
}

function readCall(index: number): { readonly url: string; readonly init: RequestInit } {
  const call = channelFetchMock.mock.calls[index];
  if (!call) {
    throw new Error(`channelFetch 第 ${index + 1} 次调用不存在`);
  }
  return { url: call[0], init: call[1] ?? {} };
}

/** 真实 WhatsApp Cloud API webhook 结构：entry → changes → value → messages。 */
function whatsappWebhook(messageExtra: Record<string, unknown>): unknown {
  return {
    entry: [
      {
        changes: [
          {
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '15550000000', phone_number_id: 'phone-1' },
              messages: [
                {
                  id: 'wamid.1',
                  from: '15550001111',
                  timestamp: '1788000000',
                  ...messageExtra,
                },
              ],
              contacts: [{ wa_id: '15550001111', profile: { name: 'WA User' } }],
            },
          },
        ],
      },
    ],
  };
}

function imagePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: MEDIA_ID, mime_type: 'image/jpeg', sha256: 'hash-1', ...overrides };
}

function inboundMessage(raw: unknown): ChannelMessage {
  return {
    id: 'wamid.1',
    senderId: '15550001111',
    senderName: 'WA User',
    chatId: '15550001111',
    content: '[User sent an image]',
    timestamp: 1_788_000_000_000,
    raw,
  };
}

function downloadInput(
  overrides: Partial<Parameters<typeof downloadWhatsAppInboundImage>[0]> = {},
) {
  return {
    accessToken: ACCESS_TOKEN,
    mediaId: MEDIA_ID,
    ...overrides,
  };
}

beforeEach(() => {
  channelFetchMock.mockReset();
  // 失败降级路径会 warn，测试里静音以免污染输出；用例本身只在必要处断言 warn。
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('downloadWhatsAppInboundImage', () => {
  it('两步下载成功：按魔数判定 mediaType、转 base64 并透传 fileName', async () => {
    channelFetchMock
      .mockResolvedValueOnce(
        jsonResponse({ url: DOWNLOAD_URL, mime_type: 'image/jpeg', file_size: 1000 }),
      )
      .mockResolvedValueOnce(binaryResponse(PNG_BYTES));

    const attachment = await downloadWhatsAppInboundImage(
      downloadInput({ mimeType: 'image/jpeg', fileName: 'photo.png' }),
    );

    expect(attachment).toEqual({
      base64: PNG_BYTES.toString('base64'),
      mediaType: 'image/png',
      fileName: 'photo.png',
    });
    expect(channelFetchMock).toHaveBeenCalledTimes(2);

    const metadataCall = readCall(0);
    expect(metadataCall.url).toBe(`${WHATSAPP_GRAPH_API_BASE}/${MEDIA_ID}`);
    expect(metadataCall.init.headers).toEqual({ Authorization: `Bearer ${ACCESS_TOKEN}` });
    expect(metadataCall.init).toMatchObject({ timeoutMs: 30_000 });

    const downloadCall = readCall(1);
    expect(downloadCall.url).toBe(DOWNLOAD_URL);
    expect(downloadCall.init.headers).toEqual({ Authorization: `Bearer ${ACCESS_TOKEN}` });
    expect(downloadCall.init).toMatchObject({ timeoutMs: 30_000 });
  });

  it('入参 fileSize 超限时直接返回 null，且零网络请求', async () => {
    const attachment = await downloadWhatsAppInboundImage(
      downloadInput({ fileSize: WHATSAPP_INBOUND_IMAGE_MAX_BYTES + 1 }),
    );

    expect(attachment).toBeNull();
    expect(channelFetchMock).not.toHaveBeenCalled();
  });

  it('第一步返回 error 时返回 null，且不再下载', async () => {
    channelFetchMock.mockResolvedValueOnce(
      jsonResponse({ error: { message: 'Invalid OAuth access token' } }),
    );

    const attachment = await downloadWhatsAppInboundImage(downloadInput());

    expect(attachment).toBeNull();
    expect(channelFetchMock).toHaveBeenCalledTimes(1);
  });

  it('第一步响应缺少 url 时返回 null，且不再下载', async () => {
    channelFetchMock.mockResolvedValueOnce(jsonResponse({ mime_type: 'image/jpeg' }));

    const attachment = await downloadWhatsAppInboundImage(downloadInput());

    expect(attachment).toBeNull();
    expect(channelFetchMock).toHaveBeenCalledTimes(1);
  });

  it('第一步返回的 file_size 超限时返回 null，且不再下载', async () => {
    channelFetchMock.mockResolvedValueOnce(
      jsonResponse({ url: DOWNLOAD_URL, file_size: WHATSAPP_INBOUND_IMAGE_MAX_BYTES + 1 }),
    );

    const attachment = await downloadWhatsAppInboundImage(downloadInput());

    expect(attachment).toBeNull();
    expect(channelFetchMock).toHaveBeenCalledTimes(1);
  });

  it('第二步 HTTP 500 时返回 null', async () => {
    channelFetchMock
      .mockResolvedValueOnce(jsonResponse({ url: DOWNLOAD_URL, mime_type: 'image/jpeg' }))
      .mockResolvedValueOnce(new Response('upstream down', { status: 500 }));

    const attachment = await downloadWhatsAppInboundImage(downloadInput());

    expect(attachment).toBeNull();
    expect(channelFetchMock).toHaveBeenCalledTimes(2);
  });

  it('魔数无法识别时回退调用方 mimeType（octet-stream 响应头不采纳）', async () => {
    channelFetchMock
      .mockResolvedValueOnce(jsonResponse({ url: DOWNLOAD_URL, mime_type: 'image/jpeg' }))
      .mockResolvedValueOnce(binaryResponse(UNKNOWN_BYTES, 200, 'application/octet-stream'));

    const attachment = await downloadWhatsAppInboundImage(
      downloadInput({ mimeType: 'image/heic' }),
    );

    expect(attachment).toEqual({
      base64: UNKNOWN_BYTES.toString('base64'),
      mediaType: 'image/heic',
    });
  });

  it('无调用方 mimeType 时回退第二步响应头的 image/* 类型', async () => {
    channelFetchMock
      .mockResolvedValueOnce(jsonResponse({ url: DOWNLOAD_URL }))
      .mockResolvedValueOnce(binaryResponse(UNKNOWN_BYTES, 200, 'image/webp; charset=binary'));

    const attachment = await downloadWhatsAppInboundImage(downloadInput());

    expect(attachment).toEqual({
      base64: UNKNOWN_BYTES.toString('base64'),
      mediaType: 'image/webp',
    });
  });

  it('魔数、调用方与响应 mime 都无法确定 mediaType 时返回 null（不猜测）', async () => {
    channelFetchMock
      .mockResolvedValueOnce(jsonResponse({ url: DOWNLOAD_URL }))
      .mockResolvedValueOnce(binaryResponse(UNKNOWN_BYTES));

    const attachment = await downloadWhatsAppInboundImage(downloadInput());

    expect(attachment).toBeNull();
  });

  it('网络异常不向调用方抛出，而是 warn 后返回 null', async () => {
    channelFetchMock.mockRejectedValueOnce(new Error('socket hang up'));

    await expect(downloadWhatsAppInboundImage(downloadInput())).resolves.toBeNull();
    expect(console.warn).toHaveBeenCalledWith(
      '[whatsapp] 入站图片下载失败',
      expect.objectContaining({ mediaId: MEDIA_ID, error: 'socket hang up' }),
    );
  });
});

describe('attachWhatsAppInboundImages', () => {
  it('含 image 的消息下载成功 → 返回带 images 的新消息', async () => {
    channelFetchMock
      .mockResolvedValueOnce(jsonResponse({ url: DOWNLOAD_URL, mime_type: 'image/jpeg' }))
      .mockResolvedValueOnce(binaryResponse(PNG_BYTES));

    const message = inboundMessage(whatsappWebhook({ image: imagePayload() }));
    const enriched = await attachWhatsAppInboundImages({ accessToken: ACCESS_TOKEN, message });

    expect(enriched).not.toBe(message);
    expect(enriched).toEqual({
      ...message,
      images: [{ base64: PNG_BYTES.toString('base64'), mediaType: 'image/png' }],
    });
    expect(readCall(0).url).toBe(`${WHATSAPP_GRAPH_API_BASE}/${MEDIA_ID}`);
    expect(channelFetchMock).toHaveBeenCalledTimes(2);
  });

  it('无 image 的消息原样返回同一对象，且零网络请求', async () => {
    const message = inboundMessage(whatsappWebhook({ text: { body: 'hello' } }));
    const enriched = await attachWhatsAppInboundImages({ accessToken: ACCESS_TOKEN, message });

    expect(enriched).toBe(message);
    expect(channelFetchMock).not.toHaveBeenCalled();
  });

  it('image 缺少 id 时原样返回，且零网络请求', async () => {
    const message = inboundMessage(whatsappWebhook({ image: { mime_type: 'image/jpeg' } }));
    const enriched = await attachWhatsAppInboundImages({ accessToken: ACCESS_TOKEN, message });

    expect(enriched).toBe(message);
    expect(channelFetchMock).not.toHaveBeenCalled();
  });

  it('下载失败时原样返回占位符消息（不带 images 键）', async () => {
    channelFetchMock.mockResolvedValueOnce(jsonResponse({ error: { message: 'expired' } }));

    const message = inboundMessage(whatsappWebhook({ image: imagePayload() }));
    const enriched = await attachWhatsAppInboundImages({ accessToken: ACCESS_TOKEN, message });

    expect(enriched).toBe(message);
    expect(enriched).not.toHaveProperty('images');
  });
});

describe('parseWhatsAppInboundMessage 图片消息接线', () => {
  it('无 text 的 image 消息 → content 为占位符，chatId 正确', () => {
    const parsed = parseWhatsAppInboundMessage(whatsappWebhook({ image: imagePayload() }));

    expect(parsed).toMatchObject({
      id: 'wamid.1',
      chatId: '15550001111',
      senderName: 'WA User',
      content: '[User sent an image]',
    });
    // parser 不下载、不产 images（下载在服务层 enrich 阶段）。
    expect(parsed?.images).toBeUndefined();
  });

  it('带 caption 的 image 消息 → content 为 caption', () => {
    const parsed = parseWhatsAppInboundMessage(
      whatsappWebhook({ image: imagePayload({ caption: '看这张图' }) }),
    );

    expect(parsed).toMatchObject({
      chatId: '15550001111',
      content: '看这张图',
    });
  });

  it('image 与 text 同时存在时 text 正文优先', () => {
    const parsed = parseWhatsAppInboundMessage(
      whatsappWebhook({ text: { body: '正文' }, image: imagePayload({ caption: 'caption' }) }),
    );

    expect(parsed).toMatchObject({ content: '正文' });
  });

  it('非图片且无文本的消息仍返回 null（回归）', () => {
    const parsed = parseWhatsAppInboundMessage(
      whatsappWebhook({ type: 'reaction', reaction: { emoji: '👍', message_id: 'wamid.0' } }),
    );

    expect(parsed).toBeNull();
  });
});
