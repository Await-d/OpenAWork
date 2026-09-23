import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannelInstance } from '../../channels/types.js';

// channelFetch 是 whatsapp-media 唯一的网络出口：mock 掉它即可在无网络条件下覆盖
// 「上传媒体 → 发消息」两步出站的全部成功 / 失败分支。
const channelFetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
vi.mock('../../channels/channel-http.js', () => ({
  channelFetch: (url: string, init?: RequestInit): Promise<Response> => channelFetchMock(url, init),
}));

const { WHATSAPP_GRAPH_API_BASE, sendWhatsAppMedia } =
  await import('../../channels/whatsapp-media.js');
const { WhatsAppChannelService } = await import('../../channels/whatsapp.js');

const ACCESS_TOKEN = 'wa-access-token';
const PHONE_NUMBER_ID = 'phone-1';
const MEDIA_ID = 'media-upload-1';

/** PNG 魔数（12 字节，仅作为可区分的二进制负载）。 */
const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

interface CapturedInit extends RequestInit {
  readonly timeoutMs?: number;
}

function buildInstance(): ChannelInstance {
  return {
    id: 'wa-outbound-media',
    type: 'whatsapp',
    name: 'wa',
    enabled: true,
    config: {
      phoneNumberId: PHONE_NUMBER_ID,
      accessToken: ACCESS_TOKEN,
      verifyToken: 'verify-1',
    },
    createdAt: 0,
    updatedAt: 0,
  };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function captureRequest(index: number): { readonly url: string; readonly init: CapturedInit } {
  const call = channelFetchMock.mock.calls[index];
  if (!call) {
    throw new Error(`channelFetch 第 ${index + 1} 次调用不存在`);
  }
  return { url: call[0], init: call[1] ?? {} };
}

function readForm(init: CapturedInit): FormData {
  if (!(init.body instanceof FormData)) {
    throw new Error('期望 multipart FormData 请求体');
  }
  return init.body;
}

function readJsonBody(init: CapturedInit): Record<string, unknown> {
  if (typeof init.body !== 'string') {
    throw new Error('期望 JSON 字符串请求体');
  }
  return JSON.parse(init.body) as Record<string, unknown>;
}

function readFilePart(form: FormData, name: string): File {
  const entry = form.get(name);
  if (!(entry instanceof File)) {
    throw new Error(`multipart 缺少 file 部件：${name}`);
  }
  return entry;
}

beforeEach(() => {
  channelFetchMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('WhatsAppChannelService 出站发图', () => {
  it('sendImage 两步成功：上传 multipart type=image，随后按媒体 ID 发消息并透传 caption', async () => {
    channelFetchMock
      .mockResolvedValueOnce(jsonResponse({ id: MEDIA_ID }))
      .mockResolvedValueOnce(jsonResponse({ messages: [{ id: 'wamid.sent-1' }] }));
    const signal = new AbortController().signal;
    const service = new WhatsAppChannelService(buildInstance(), vi.fn());

    const result = await service.sendImage('8613800000000', {
      buffer: PNG_BYTES,
      fileName: 'photo.jpg',
      text: '看这张图',
      signal,
      sourceUrl: 'https://example.com/photo.jpg',
    });

    expect(result).toEqual({ messageId: 'wamid.sent-1' });
    expect(channelFetchMock).toHaveBeenCalledTimes(2);

    const upload = captureRequest(0);
    expect(upload.url).toBe(`${WHATSAPP_GRAPH_API_BASE}/${PHONE_NUMBER_ID}/media`);
    expect(upload.init.method).toBe('POST');
    expect(upload.init.timeoutMs).toBe(60_000);
    expect(upload.init.signal).toBe(signal);
    // multipart 的 boundary 必须由 fetch 生成，不能手动设置 Content-Type。
    expect(upload.init.headers).toEqual({ Authorization: `Bearer ${ACCESS_TOKEN}` });
    const form = readForm(upload.init);
    expect(form.get('messaging_product')).toBe('whatsapp');
    expect(form.get('type')).toBe('image');
    const file = readFilePart(form, 'file');
    expect(file.size).toBe(PNG_BYTES.byteLength);
    expect(file.name).toBe('photo.jpg');

    const send = captureRequest(1);
    expect(send.url).toBe(`${WHATSAPP_GRAPH_API_BASE}/${PHONE_NUMBER_ID}/messages`);
    expect(send.init.method).toBe('POST');
    expect(send.init.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ACCESS_TOKEN}`,
    });
    expect(readJsonBody(send.init)).toStrictEqual({
      messaging_product: 'whatsapp',
      to: '8613800000000',
      type: 'image',
      image: { id: MEDIA_ID, caption: '看这张图' },
    });
  });

  it('sendImage 无 text 时 image 正文不带 caption 键', async () => {
    channelFetchMock
      .mockResolvedValueOnce(jsonResponse({ id: MEDIA_ID }))
      .mockResolvedValueOnce(jsonResponse({ messages: [{ id: 'wamid.sent-2' }] }));
    const service = new WhatsAppChannelService(buildInstance(), vi.fn());

    await service.sendImage('8613800000000', { buffer: PNG_BYTES });

    const send = captureRequest(1);
    // 默认文件名兜底为 image.jpg（接口 fileName 可选）。
    const upload = readForm(captureRequest(0).init);
    expect(readFilePart(upload, 'file').name).toBe('image.jpg');
    expect(readJsonBody(send.init)['image']).toStrictEqual({ id: MEDIA_ID });
  });

  it('replyImage 按 "<chatId>:<msgId>" 拆出 chatId 重发（WhatsApp 无引用回复语义）', async () => {
    channelFetchMock
      .mockResolvedValueOnce(jsonResponse({ id: MEDIA_ID }))
      .mockResolvedValueOnce(jsonResponse({ messages: [{ id: 'wamid.sent-3' }] }));
    const service = new WhatsAppChannelService(buildInstance(), vi.fn());

    const result = await service.replyImage('8613800000000:abc', {
      buffer: PNG_BYTES,
      fileName: 'reply.png',
      text: '回复图',
    });

    expect(result).toEqual({ messageId: 'wamid.sent-3' });
    const send = captureRequest(1);
    expect(send.url).toBe(`${WHATSAPP_GRAPH_API_BASE}/${PHONE_NUMBER_ID}/messages`);
    expect(readJsonBody(send.init)).toMatchObject({ to: '8613800000000', type: 'image' });
  });
});

describe('WhatsAppChannelService 出站发文件', () => {
  it('sendFile 两步成功：上传 multipart type=document，发送带 document.filename', async () => {
    channelFetchMock
      .mockResolvedValueOnce(jsonResponse({ id: MEDIA_ID }))
      .mockResolvedValueOnce(jsonResponse({ messages: [{ id: 'wamid.file-1' }] }));
    const service = new WhatsAppChannelService(buildInstance(), vi.fn());

    const result = await service.sendFile('8613800000000', {
      buffer: PNG_BYTES,
      fileName: 'report.pdf',
      fileType: 'pdf',
      text: '季度报表',
    });

    expect(result).toEqual({ messageId: 'wamid.file-1' });
    expect(channelFetchMock).toHaveBeenCalledTimes(2);

    const upload = captureRequest(0);
    expect(upload.url).toBe(`${WHATSAPP_GRAPH_API_BASE}/${PHONE_NUMBER_ID}/media`);
    const form = readForm(upload.init);
    expect(form.get('messaging_product')).toBe('whatsapp');
    expect(form.get('type')).toBe('document');
    expect(readFilePart(form, 'file').name).toBe('report.pdf');

    const send = captureRequest(1);
    expect(readJsonBody(send.init)).toStrictEqual({
      messaging_product: 'whatsapp',
      to: '8613800000000',
      type: 'document',
      document: { id: MEDIA_ID, filename: 'report.pdf', caption: '季度报表' },
    });
  });
});

describe('sendWhatsAppMedia 失败与兜底', () => {
  it('上传失败：抛 WhatsApp media upload failed 且不再发消息', async () => {
    channelFetchMock.mockResolvedValueOnce(jsonResponse({ error: { message: 'bad' } }, 400));

    await expect(
      sendWhatsAppMedia({
        accessToken: ACCESS_TOKEN,
        phoneNumberId: PHONE_NUMBER_ID,
        to: '8613800000000',
        buffer: PNG_BYTES,
        fileName: 'photo.jpg',
        kind: 'image',
      }),
    ).rejects.toThrow('WhatsApp media upload failed: bad');
    expect(channelFetchMock).toHaveBeenCalledTimes(1);
  });

  it('发送失败：抛 WhatsApp send media failed 并带上游 message', async () => {
    channelFetchMock
      .mockResolvedValueOnce(jsonResponse({ id: MEDIA_ID }))
      .mockResolvedValueOnce(
        jsonResponse({ error: { message: 'Recipient not in allowed list' } }, 400),
      );

    await expect(
      sendWhatsAppMedia({
        accessToken: ACCESS_TOKEN,
        phoneNumberId: PHONE_NUMBER_ID,
        to: '8613800000000',
        buffer: PNG_BYTES,
        fileName: 'photo.jpg',
        kind: 'image',
      }),
    ).rejects.toThrow('WhatsApp send media failed: Recipient not in allowed list');
    expect(channelFetchMock).toHaveBeenCalledTimes(2);
  });

  it('成功但上游未回 messages 时 messageId 兜底为空串', async () => {
    channelFetchMock
      .mockResolvedValueOnce(jsonResponse({ id: MEDIA_ID }))
      .mockResolvedValueOnce(jsonResponse({}));

    await expect(
      sendWhatsAppMedia({
        accessToken: ACCESS_TOKEN,
        phoneNumberId: PHONE_NUMBER_ID,
        to: '8613800000000',
        buffer: PNG_BYTES,
        fileName: 'photo.jpg',
        kind: 'file',
      }),
    ).resolves.toEqual({ messageId: '' });
  });
});
